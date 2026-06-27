# Bug: jira-kanban-generation-v1

**Reported:** 2026-06-27
**Severity:** Feature gap (Symptom 2) + Wiring bug (Symptom 1)
**Status:** Root-cause complete; fix proposal pending routing.

---

## Symptom 1 — Skeleton instead of "Generating…" spinner

**What the user sees:** After submitting "build a kanban board" in the Jira Open Prompt, the
content region shows the **DefaultViewSkeleton** (a list of skeleton cards) instead of the
`SurfaceSpinner` "Generating…" animation while the agent runs.

**Root cause — `JiraPanel.tsx:512–528` races `submit()`**

The `ui-catalog-pull-spinner-signal-v1` design intentionally defers the per-tab `inFlight`
flag: `inFlightOnSubmit()` returns `false` (`promptComposerLogic.ts:271`), so `submit()` sets
`inFlight: false` and clears `surface: null`. The spinner only turns on later when the
`ui:generatingBegin` signal arrives (the agent actually called `get_ui_catalog`).

In the window between submit and that signal, the tab is in the state:

```
surface=null, inFlight=false, loadingDefault=undefined, error=undefined
```

The effect at `JiraPanel.tsx:512–528` fires on every render and has the condition:

```tsx
active && isConnected && activeTab && !activeTab.surface && !activeTab.loadingDefault
  && !activeTab.error && !activeTab.inFlight
```

All conditions are true in that window, so `requestDefaultInActiveTab(() =>
window.cosmos.jira.requestDefaultView())` fires, which:

1. Sets `loadingDefault: true` on the tab.
2. Fires the IPC default-view read.
3. The panel renders `DefaultViewSkeleton` because `loadingDefault` is now true.
4. `surfaceSpinnerVisible(...)` at `JiraPanel.tsx:574–580` returns `false` because
   `loadingDefault: true` suppresses the spinner (`promptComposerLogic.ts:190`).

When the agent's `ui:render` frame eventually lands it clears `loadingDefault: false` and
files the generated surface — so the user **never sees the spinner** and sees the default-view
skeleton during the agent run instead.

**The missing guard:** The effect does not check `originatingTabIdRef.current !== null` (which
would indicate a solicited compose is in flight). The check `!activeTab.inFlight` was the
guard before `ui-catalog-pull-spinner-signal-v1` moved the flag from submit-time to
begin-signal time, but that change broke the guard window.

**Fix (spot fix, ~1 line change):**

Add a ref in `JiraPanel.tsx` that tracks whether a submit is awaiting a `ui:generatingBegin`
signal (the compose is in progress but `inFlight` is still false). The cleanest minimal fix is
to expose a boolean `composePending` from `useGenerativePanelTabs` (or a boolean getter for
whether `originatingTabIdRef.current !== null`), and add `!composePending` to the
`requestDefaultInActiveTab` guard effect. Alternatively, guard on the submit having happened
by checking the tab's `untitled === false && surface === null` state combined with a local
`submittedOnceRef` flag in the hook.

**The smallest true fix:** `useGenerativePanelTabs` could expose `inCompose: boolean`
(derived from `originatingTabIdRef.current !== null`) so the panel's default-load effect can
add `&& !inCompose`. This is 1 new field on the return type + 1 guard in `JiraPanel.tsx`.

**Files:**
- `src/renderer/promptComposerLogic.ts:271` — `inFlightOnSubmit()` returns `false`
- `src/renderer/useGenerativePanelTabs.ts:304` — `originatingTabIdRef` (the in-compose gate,
  never exposed)
- `src/renderer/JiraPanel.tsx:512–528` — the default-load effect missing the in-compose guard
- `src/renderer/promptComposerLogic.ts:186–191` — `loadingDefault` suppresses the spinner

**Size:** Spot fix — 2 files, ~5 lines changed.

---

## Symptom 2 — Got default list view, not a kanban board

**What the user sees:** After the run completes, the default Jira list view appears in the
tab (the "my tickets" default board), not a kanban board.

**Root cause — Kanban is UNSUPPORTED in the Jira A2UI catalog**

The Jira custom catalog (`src/renderer/jiraCatalog/index.ts:68`) registers:
`StatusBadge, TicketCard, IssueList, TransitionPicker, CommentRow, CommentList,
AddCommentControl, CreateIssueForm, EditIssueForm, LoadMoreButton, PaginationBar,
Notice, Text, Column, Row`

There is no `KanbanBoard`, `KanbanColumn`, or any partitioned board-layout component. The
`IssueList` component (`jiraCatalog/components.tsx:293`) renders a flat vertical list of
`TicketCard`s — not side-by-side columns.

The agent is taught the catalog via `A2UI_CATALOG_TEXT` (`src/mcp/uiCatalog.ts:39–117`).
That text names the generic SDK types (`Column`, `Row`, `List`, `Card`, etc.) and the Jira
types, but contains **no kanban-specific layout**. The agent may attempt to compose a kanban
using `Row` + multiple `IssueList` instances (multi-region bindings), but:

1. The `IssueList` is a scrolling vertical list, not a fixed kanban column. A `Row` of them
   does not look or behave like a kanban.
2. No agent prompt, system instruction, or `render_jira_ui` description guides the agent to
   compose a multi-`IssueList` board.
3. The most likely outcome is the agent fails to compose a recognizable kanban and either
   falls back to a plain `IssueList`, or calls a Jira search/default read that triggers the
   unsolicited default-board frame (exacerbated by Symptom 1: the `requestDefaultInActiveTab`
   fires while the agent is running and the resulting default-view frame CLOBBERS the tab when
   the composed frame hasn't landed yet — Symptom 1 is also responsible for what the user
   ends up seeing).

**Is kanban SUPPORTED?** No. The infrastructure EXISTS for a multi-region partitioned surface
(`specRebinder.ts:planRegions`, `AdapterBinding`, `bindings` on the bridge frame, the
`KanbanBoardSkeleton` UI in `JiraPanel.tsx:117`), and the multi-region architecture would
ALLOW independent `IssueList` columns. But:

- No `KanbanColumn` / `KanbanBoard` catalog component exists.
- No agent prompt or `render_jira_ui` description tells the agent to compose one.
- The `IssueList` is not styled as a board column (no fixed-width, no column header, no
  `overflow-hidden` clipping for board-column UX).
- The `KanbanBoardSkeleton` (`JiraPanel.tsx:117`) is only shown during tab-switch auto-refresh
  of a `bindings`-bearing surface — it does not prove a kanban surface can be COMPOSED.

**Conclusion:** Kanban board generation is a FEATURE GAP, not a spot wiring bug.
The `KanbanBoardSkeleton` in `JiraPanel.tsx` and the multi-region rebinder are scaffolding
that was added in anticipation of this feature, but the catalog component and agent guidance
are absent. Implementing it properly requires:
- A `KanbanColumn` catalog component (or `IssueList` styled as a board column with a
  status-group header).
- An agent prompt / `render_jira_ui` description that teaches the model to compose
  `status-grouped IssueList` columns in a `Row`.
- Possible: a jira-specific `searchIssues` binding that accepts a `statusCategory` filter as
  the per-column query.

This is SDD work, not a spot fix.

---

## Routing

| Symptom | Classification | Routing |
|---------|---------------|---------|
| Spinner shows skeleton instead | Wiring bug (spot fix, ~5 lines) | developer → `useGenerativePanelTabs` + `JiraPanel` |
| Result is default list, not kanban | Feature gap (catalog + agent guidance absent) | architect → SDD: jira-kanban-board-v1 |

**Do NOT implement Symptom 2 as a spot fix.** The skeleton fix (Symptom 1) may be applied
independently and is safe to do without touching the kanban feature work.
