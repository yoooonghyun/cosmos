# Plan: Slack Thread Replies (generated-UI catalog) — v1

**Status**: Superseded by slack-generative-message-parity-v1 (OQ-4)
**Created**: 2026-06-08
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/slack-thread-replies-v1.md

> Superseded 2026-06-18: replaced by `.sdd/plans/slack-generative-message-parity-v1.md`, which
> reuses the EXISTING native thread view (drill-in) instead of this plan's renderer-local
> inline-expand. See that plan's resolved OQ-1/OQ-4.

---

## Grounding

> Same investigation as the spec's Grounding section (codegraph against the current tree;
> agentmemory empty for this area). The load-bearing facts that drive the mechanism choice:

- `window.cosmos.slack.getReplies(params: SlackRepliesParams)` **already exists** in the
  renderer-exposed `SlackApi` (`src/shared/ipc.ts:371`) and returns
  `SlackResult<SlackPage<SlackMessage>>`. The native panel already uses it
  (`SlackPanel.tsx:948`). **No new IPC contract is needed** for a renderer-local fetch.
- `UiBridge` holds only `{ requestId, callId, socket }` (`uiBridge.ts:39`), **not** the agent's
  composed A2UI spec, and a `target: 'slack'` render frame is **settled immediately**
  (`uiBridge.ts:190`). Main therefore has nothing to mutate/re-push for a Slack surface.
- The renderer-local nav-action convention already exists and is the documented pattern for
  non-write catalog interactions: `SLACK_OPEN_CHANNEL_ACTION` (`slackCatalog/logic.ts:62`),
  intercepted in `SlackPanel.handleSurfaceAction` (`SlackPanel.tsx:715`), never sent to main.
- The native `MessageRow` reply affordance + thread fetch + parent-dedupe is the visual/behavioral
  reference (`SlackPanel.tsx:189`, `:210`, `:935`).

---

## Summary

Make the Slack generated-UI catalog `MessageRow` able to expand a thread's replies **on demand**.
Chosen mechanism: a **renderer-local, catalog-component-owned fetch + local expand** — the catalog
`MessageRow` becomes a small stateful component that, on click of its "N replies" affordance, calls
the **existing** read-only `window.cosmos.slack.getReplies({ channelId, threadTs })` IPC, holds the
fetched replies in **local React state**, and renders them nested/indented under the parent using
the **same `MessageRow`** component. Collapsed by default, no preload, toggle to collapse, inline
error/notice on failure (retryable), and zero new mutation. To carry the thread coordinates, the
`render_slack_ui` `MessageRow` node gains a `channelId` prop (alongside existing `ts`/`replyCount`),
and the catalog also threads the channel context down into a `MessageList`'s rows. The agent surface
stays **display-only**; the interactivity is purely a catalog-component capability and renderer-local
UI state — nothing is persisted into the surface spec or a snapshot.

## Technical Context

| Item              | Value                                                                                                  |
|-------------------|--------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (React renderer; `src/shared` types; MCP render-tool advertised node schema)                |
| Key dependencies  | Existing `window.cosmos.slack.getReplies` IPC; `@a2ui-sdk/react/0.9` catalog; `SlackMessage`/`SlackRepliesParams`/`SlackResult`/`SlackPage` shapes; cosmos `Avatar`/`Alert`/`Button` UI primitives |
| Files to create   | (none required for the core mechanism — see touch list; one optional logic helper)                     |
| Files to modify   | `src/renderer/slackCatalog/components.tsx`, `src/renderer/slackCatalog/logic.ts` (or a new helper), `src/mcp/slackRenderUiServer.ts` (advertise `channelId` on `MessageRow`/`MessageList` nodes), `docs/ARCHITECTURE.md` (§4.8 note) |
| UI-bearing        | YES — new interactive affordance + inline error state. A **design step** (designer, `.sdd/designs/slack-thread-replies-v1.md`) is required between this plan and interface. |

### Chosen mechanism — (2) renderer-local fetch + local expand (refined)

The catalog `MessageRow` is upgraded from a pure display component to a small stateful component:

- It receives `channelId` (new node prop) + `ts` (the parent `threadTs`) + `replyCount`.
- When `replyCount > 0` and `channelId` is present, the "N replies" label becomes a button.
- Click toggles local state `expanded`. On first expand it calls
  `window.cosmos.slack.getReplies({ channelId, threadTs: ts })`, stores
  `SlackResult<SlackPage<SlackMessage>>` in local state, drops the root item (the parent, returned
  as item 0 by Slack — native parity, FR-005), and renders the remaining replies nested/indented,
  each via the **same `MessageRow`** (without a further reply affordance — replies of replies are
  out of scope; nested rows render the static label).
- In-flight click is guarded (FR-006); failure renders an inline `Alert`/`Notice` under the row
  (FR-009), retryable on re-click (FR-010); not-connected maps to its inline message (FR-011);
  empty reply list shows a benign "no replies" state.
- No action is dispatched to the panel or main; this is self-contained catalog interactivity over
  the already-exposed read IPC. The composed surface spec is never mutated; `expanded`/replies are
  renderer-only state (FR-015/FR-016).

**Why this over the user's stated Jira-style direction (mechanism 1 — REJECTED):** Jira's
`JiraActionDispatcher` re-composes its surface deterministically because **main owns the Jira
surface templates** (`JiraSurfaceBuilder` board/detail). A Slack thread surface is **arbitrary,
agent-composed A2UI**, and **main does not retain that spec** — `UiBridge` keeps only
`{requestId, callId, socket}` and settles the `target: 'slack'` render call immediately (it awaits
no action). For main to "re-push with replies nested under the parent" it would have to (a) newly
retain every composed Slack spec, (b) locate the parent node inside an arbitrary agent tree, and
(c) inject a reply subtree — a brand-new spec-patching capability with non-trivial cost and a new
failure surface, all to replicate behavior the renderer can do locally over an IPC that already
exists. Mechanism (1) also pulls main back into the loop for what is fundamentally a display
interaction, eroding the §4.8 "display-only, no deterministic dispatcher" invariant. Mechanism (2)
is lighter, needs **no new IPC and no new main-side machinery**, keeps the agent surface
display-only, and matches the **already-established renderer-local catalog-action precedent**
(`SLACK_OPEN_CHANNEL_ACTION`, `JIRA_OPEN_DETAIL_ACTION`). The only cost is that expanded replies are
renderer-local (re-collapse on restore, re-fetch on click) — explicitly acceptable per FR-016 and
consistent with session-persistence (only composed surface specs are persisted verbatim).

> **User veto point:** this diverges from the "main `slack.openThread` bound-action + re-push"
> direction the request described. If you require the bound-action mechanism for consistency with
> Jira despite the higher cost (new spec retention + arbitrary-tree patching in main), say so and
> the plan switches to mechanism (1) with a `SlackActionDispatcher` + a spec-retention/patch path.

### Mechanism note — fetch lives in the catalog component, not the panel `onAction` seam

A variant of (2) would dispatch a renderer-local `slackNav.openThread` action up to
`SlackPanel.handleSurfaceAction` (like `SLACK_OPEN_CHANNEL_ACTION`). Rejected for THIS feature
because that seam *navigates the whole tab to the native thread view* — it replaces the generated
surface — whereas the user wants replies **nested inline within the composed surface**, under the
specific parent row. Inline nesting is a per-row capability, so the state + fetch belong in the
catalog `MessageRow` itself (the panel seam stays reserved for whole-surface navigation). The
`getReplies` IPC is callable directly from the catalog component (it is on `window.cosmos.slack`,
same as the channel-open precedent's downstream calls).

### Contract / schema touch

- **No `src/shared/ipc.ts` change** — `getReplies` already exists and is validated at the main
  boundary by `validateSlackReplies`. (If review prefers, the existing IPC docstring may note this
  second consumer; not required.)
- **`render_slack_ui` node schema** (`src/mcp/slackRenderUiServer.ts`): advertise an OPTIONAL
  `channelId` prop on the `MessageRow` node (and let `MessageList` carry/propagate a `channelId` so
  the agent can set it once per list). The agent already emits `ts`/`replyCount` from real read
  results; `channelId` is likewise already in hand from the history/search read it composed from.
  A `MessageRow` without `channelId` degrades to the static label (FR-013) — backward compatible.

### Architecture coherence

This introduces a **new, reusable convention**: a catalog component MAY hold renderer-local UI
state and call an **existing read-only IPC** to lazily expand detail **inline**, without dispatching
to the panel/main and without mutating the composed surface spec. ARCHITECTURE §4.8 currently says
the Slack surface is "display-only — no write scope, no write tool, no deterministic dispatcher".
That remains TRUE (no writes, no dispatcher); the doc gains a sentence clarifying that "display-only"
permits **read-only, on-demand inline expansion driven by renderer-local component state over the
existing read IPC** (it is not a write and not a new UI channel). No new pattern in main.

## Implementation Checklist

> Update as work progresses; add inline notes on deviation. (Steps 3–5 are the developer's; this
> plan stops at presentation for user confirmation. The **design step precedes Phase 1**.)

### Phase 0 — Design (designer, prerequisite)

- [ ] `.sdd/designs/slack-thread-replies-v1.md`: reply-button affordance treatment, nested/indented
      reply layout (indent rail vs. inset), in-flight loading state, inline error/notice + empty
      state — all in cosmos palette, reusing `MessageRow`/`Notice`/`Alert`. No new tokens expected.

### Phase 1 — Interface

- [ ] Read spec; confirm Open Question (reply pagination) resolved or scoped first-page-only.
- [ ] Extend the catalog `MessageRowNode` interface (`slackCatalog/components.tsx`) with optional
      `channelId?: string` (parent `ts` already present); thread `channelId` through `MessageListNode`
      so a list can set it once for its rows.
- [ ] Decide reply-state shape (local React state: `expanded`, `loading`, `error`, `replies`);
      keep any pure helpers (e.g. drop-root, error-message mapping) in `slackCatalog/logic.ts` for
      unit-testability (mirrors existing logic.ts split). No invented props beyond `channelId`.

### Phase 2 — Testing

- [ ] Happy path: click expands; `getReplies` called with `{ channelId, threadTs }`; replies render
      nested via `MessageRow`; root item dropped (FR-004/FR-005).
- [ ] No preload: a freshly rendered surface issues zero `getReplies` calls until a click (FR-002).
- [ ] Toggle: re-click collapses; re-click again re-expands (FR-007/FR-008).
- [ ] In-flight guard: a second click during a pending fetch starts no second fetch (FR-006).
- [ ] Failure: `getReplies` → error result renders inline message, no throw; re-click retries
      (FR-009/FR-010); not-connected message (FR-011); empty-replies benign state.
- [ ] Degrade: `MessageRow` without `channelId` shows the static label, no button, no error (FR-013).
- [ ] Read-only/secret: no write path exists; payloads carry no token (FR-014/FR-015).

### Phase 3 — Implementation

- [ ] Upgrade catalog `MessageRow` to the stateful expand component (reusing the same row visuals
      for parent + replies); render nested replies + loading/error/empty per the design spec.
- [ ] Propagate `channelId` from `MessageList` to its `MessageRow`s.
- [ ] Advertise optional `channelId` on `MessageRow`/`MessageList` nodes in
      `src/mcp/slackRenderUiServer.ts` (+ any anti-fabrication grounding note that `channelId` must
      come from a real read).
- [ ] All tests pass; reuse the native parent-dedupe rule and `authorName`/`initials`/`formatTs`
      helpers (no duplicated logic).

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.8: clarify that the Slack generative surface's "display-only"
      posture permits read-only, on-demand **inline thread expansion** via renderer-local component
      state over the existing `getReplies` read IPC (still no writes, no dispatcher, no new UI channel).
- [ ] Update `docs/PROJECT-STRUCTURE.md` if the catalog file responsibilities shift materially.
- [ ] Update this plan with deviations; reconcile `TODO.md` (wrap-up).
- [ ] `memory_save` the mechanism decision (renderer-local inline expand over existing read IPC;
      mechanism-1 rejected because main doesn't retain the agent spec) for future Slack-catalog work.

---

## Deviations & Notes

- **2026-06-08**: Authored. Chose mechanism (2) renderer-local inline expand over the user's
  proposed Jira-style main bound-action (mechanism 1). Rationale recorded in Technical Context;
  user veto point flagged. Reply pagination left as the single Open Question (default
  first-page-only for v1).
