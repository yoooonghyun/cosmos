# Spec: Cosmos Panel-Tab List — v1

**Status**: Draft
**Created**: 2026-06-28
**Supersedes**: —
**Related plan**: (to be authored at `.sdd/plans/cosmos-panel-tab-list-v1.md`)

---

## Grounding

> Direct investigation run by the architect for this spec (mandatory). Tools were run here, not
> handed in by the orchestrator.

**codegraph_explore queries (one-line takeaways):**

- `CosmosPanel timeline split terminal FileTree ResizeDivider useGenerativePanelTabs useReportPanel
  buildGenerativePanel GenerativePanelKey` — each generative panel owns its tab state via
  `useGenerativePanelTabs` (renderer-local) and REPORTS a `GenerativePanelSnapshot` to the shared
  coordinator via `useReportPanel` on every tab-state change; the terminal reports a
  `TerminalPanelDraft`. The submit path builds a `PromptContext { panel, tab?, dock? }` and calls
  `buildAgentSubmitWithMarker`.
- `sessionSnapshot SessionProvider sessionRegistry useReportPanel GenerativePanelKey TerminalPanel`
  — `SessionRegistry` (`src/renderer/session/sessionRegistry.ts`) MERGES the five per-panel
  contributions into one `SessionSnapshot` and **write-only** trailing-debounce-saves it to main.
  It holds NO React state and exposes NO subscribe/emit — nothing reads live contributions back
  out. `useRestoredGenerativePanel`/`useRestoredTerminalPanel` return the LOAD-ONCE restored
  snapshot, not a live value. **There is no existing reactive cross-panel read path.**
- `TerminalPanel ResizeDivider FileTree fileExplorer split layout persistence width FileTabStrip`
  — `ResizeDivider` (`src/renderer/fileExplorer/ResizeDivider.tsx`) is a bespoke 6px
  `role="separator"` pointer+keyboard drag handle; `FileTree` (`src/renderer/fileExplorer/FileTree.tsx`)
  is a `role="tree"` with a standard roving-tabindex ARIA keymap (Arrow/Home/End/Enter/Space,
  Arrow-Right/Left expand/collapse). The terminal's split widths (`termWidth`/`treeWidth`) are
  explicitly **"renderer-local, NOT persisted"** (TerminalPanel.tsx:139).
- `SessionRegistry FileTree CosmosPanel ActiveComposerProvider ContextChip PromptContext
  DOCK_KIND_BY_PANEL useRecordSubmitContext` — the composer context system: `ActiveComposerProvider`
  holds a `lastSubmitContextRef` (the last-submitted `PromptContext`); `useRecordSubmitContext`
  writes it; the composer `ContextChip` renders a display-only `ContextChipData` derived from the
  ACTIVE panel's live `viewContextCapture` (its current selection), NOT from an arbitrary externally
  selected context. `PromptContext.dock` (`src/shared/promptContext/promptContext.ts`) reuses the
  live `ViewContext` item fields captured from the active panel's selection at submit.

**Read directly:** `.sdd/specs/cosmos-timeline-prompt-context-v1.md` (the marker / one-source-two-
channels mechanism this feature plugs into), `CosmosPanel.tsx`, `useGenerativePanelTabs.ts`,
`sessionRegistry.ts`, `ActiveComposerProvider.tsx`, `ContextChip.tsx`, `FileTree.tsx`,
`ResizeDivider.tsx`, `FileTabStrip.tsx`, `promptContext.ts`.

**LLM wiki (`wiki_query`):** the `wiki_query`/`wiki_ingest` tools were **NOT available in this
session's toolset** (only codegraph + Read/Grep). Grounding was done entirely via codegraph +
direct Read of the cited files; no prior-decision wiki lookup could be performed. Flagging so the
cycle knows the wiki channel was unavailable here, not skipped by choice.

**Key feasibility finding (the crux the prompt asked me to resolve).** The Cosmos panel has **no
existing way to read every panel's current open tabs**. The only cross-panel aggregation today is
the write-only `SessionRegistry`, and the contribution it holds is the *persistence* snapshot,
which `buildGenerativePanel`/`buildGenerativeTab` deliberately make **lossy** (only composed
surfaces are kept — "strips the rest"). So neither the restored snapshot nor the registry's saved
contribution is a faithful list of every currently-open tab. This feature therefore REQUIRES a new
shared, **reactive, read-only** cross-panel view of the live tab lists, sourced from the same
per-panel reporting each panel already performs — NOT the Cosmos panel reaching into any panel's
internals. The exact contract (extend `SessionRegistry` into an observable store, vs. a parallel
publish/subscribe context mirroring `ActiveComposerProvider`) is a Step-2 plan decision; this spec
fixes only the behavior + the non-reach-in / non-lossy / non-secret constraints.

---

## Overview

In the Cosmos panel, show the open tabs of the other panels — the four generative panels (Slack,
Jira, Confluence, Google Calendar) and the Terminal panel — as a tree/list on the RIGHT of a
resizable split, with the conversation timeline on the LEFT, exactly mirroring the Terminal
panel's "terminal LEFT + file-explorer tree RIGHT" layout. Clicking a tab in the tree does NOT
navigate or render it inline; it **adds that panel + tab as the context for the next prompt** the
user submits from the Cosmos composer, reusing the existing `PromptContext` / `<cosmos:context>`
marker / context-chip system so the selection rides the same "one source, two channels" path
(composer chip + embedded marker + grounding). The feature exists so the user can reference work
they have open in another panel when describing a UI in Cosmos, without leaving the Cosmos panel.

---

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### See every panel's open tabs from the Cosmos panel · P1

**As a** cosmos user
**I want to** see, inside the Cosmos panel, a tree listing the open tabs of each other panel,
grouped and labeled by panel
**So that** I have a single place to survey what I have open across Slack, Jira, Confluence,
Calendar, and the Terminal without switching panels

**Acceptance criteria:**

- Given I have two Jira tabs and one Slack tab open, when I look at the Cosmos panel, then a tree
  on the right of the timeline shows a "Jira" group with its two tab labels and a "Slack" group
  with its one tab label.
- Given I open a new tab in the Terminal panel, when I return to the Cosmos panel, then the tree's
  "Terminal" group reflects that newly opened tab (the tree tracks the live tab lists, not a stale
  snapshot).
- Given I rename or close a tab in a source panel, when I look at the Cosmos tree, then the tree
  shows the renamed label / drops the closed tab.

### Resize the timeline / tree split · P1

**As a** cosmos user
**I want to** drag a divider between the timeline and the panel-tab tree
**So that** I can give either side more room, exactly like the Terminal panel's terminal/explorer
split

**Acceptance criteria:**

- Given the Cosmos panel is open, when I drag the divider between the timeline (left) and the tree
  (right), then the two columns resize and neither collapses below a sane minimum.
- Given I use the keyboard on the focused divider (Arrow keys; Shift = coarse), then the columns
  resize by the same steps as the Terminal divider.

### Add a panel+tab as the next prompt's context · P1

**As a** cosmos user
**I want to** click a tab in the tree to attach that panel + tab as the context of my next Cosmos
prompt
**So that** the prompt (and the timeline record of it) is grounded to the work I have open in
another panel

**Acceptance criteria:**

- Given I click the Jira "Sprint board" tab in the tree, when I look at the Cosmos composer, then
  its context chip shows that Jira / "Sprint board" selection (the same "↳ item" treatment as the
  existing view-context chip).
- Given I have selected the Jira "Sprint board" tab and I submit a prompt, when the prompt appears
  in the Cosmos timeline, then its user-prompt bubble shows the Jira / "Sprint board" context
  (carried by the embedded `<cosmos:context>` marker), and the embedded marker / grounding name
  that same panel + tab.
- Given I selected a tab, when I submit, then the run still targets the Cosmos generated-UI surface
  (the wire target is unchanged); only the prompt's context names the selected panel + tab.
- Given I select a tab and then dismiss the context chip (its `×`) before submitting, when I
  submit, then the prompt carries no selected context (clean submit), exactly like dismissing the
  existing view-context chip.

### Empty states · P2

**As a** cosmos user
**I want to** see a calm, explicit state when a panel has no open tabs (or everything is empty)
**So that** the tree never looks broken or ambiguous

**Acceptance criteria:**

- Given a panel in scope has zero open tabs, when I view the tree, then that panel's group shows a
  quiet "No open tabs" line rather than vanishing silently or showing a phantom row.
- Given every in-scope panel has no open tabs (Terminal always has at least one, so this is the
  generative-only case), when I view the tree, then the tree shows a single calm empty state.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Layout & split (reuse the terminal pattern)

| ID     | Requirement |
|--------|-------------|
| FR-001 | The Cosmos panel body MUST present a horizontal SPLIT: the conversation timeline on the LEFT and a panel-tab tree on the RIGHT, separated by a draggable divider — mirroring the Terminal panel's "content LEFT, tree RIGHT" pattern. The docked Open-Prompt composer band MUST remain in its current position (below the split), unchanged. |
| FR-002 | The divider MUST REUSE the existing bespoke `ResizeDivider` (`src/renderer/fileExplorer/ResizeDivider.tsx`) — pointer drag + keyboard (Arrow; Shift = coarse), `role="separator"` — with the same clamp idiom as the Terminal split (neither column drops below a sane minimum). It MUST NOT introduce a new resize primitive or a generic resizable component. |
| FR-003 | The panel-tab tree MUST be visually and behaviorally consistent with the Terminal file-explorer tree (`FileTree`): a `role="tree"` region with the SAME roving-tabindex ARIA keymap (Arrow Up/Down + Home/End to move focus, Enter/Space to activate, Arrow Right/Left to expand/collapse a group). It MUST NOT hand-roll a divergent keymap. |
| FR-004 | The split column widths MUST mirror the Terminal split's behavior. The Terminal split is renderer-local / session-only (NOT persisted); the Cosmos split MUST match that parity by default — see OQ-1 for whether the user wants the Cosmos split width persisted (which would EXCEED terminal parity and add a new snapshot field). |

### Scope & grouping

| ID     | Requirement |
|--------|-------------|
| FR-005 | The tree MUST show the open tabs of exactly these panels, each as a labeled group: **Slack, Jira, Confluence, Google Calendar** (the four generative panels) and **Terminal**. The Cosmos panel's OWN tab(s) MUST NOT appear in its own tree. |
| FR-006 | A panel that is disabled / not present in the rail (a gateable integration the user has not enabled) MUST NOT appear as a group — the tree lists only panels that are actually available, matching rail visibility. |
| FR-007 | Each tab row MUST show that tab's CURRENT display label (the same label the source panel's tab strip shows — e.g. "Terminal 2", a generative panel's name / utterance-derived label). Rows MUST update live as labels change, tabs open, or tabs close. |
| FR-008 | The tree MUST reflect EVERY currently-open tab of each in-scope panel, not a lossy subset. (The existing persistence snapshot keeps only composed surfaces; the cross-panel read this feature adds MUST be the full live tab list, a superset of what persistence keeps.) |

### Cross-panel read (no reach-in, no new tracking)

| ID     | Requirement |
|--------|-------------|
| FR-009 | The Cosmos panel MUST read the other panels' open tabs through a SHARED, reactive, read-only contract sourced from the SAME per-panel reporting each panel already performs (the per-panel tab-state report). The Cosmos panel MUST NOT reach into any panel's internal hook state or component tree, and MUST NOT subscribe to a panel's private events directly. |
| FR-010 | The cross-panel read MUST derive ENTIRELY from view state the panels already hold (their live tab lists — id, label, active id). It MUST NOT trigger any new fetch, new integration call, or new per-keystroke tracking. Each panel's existing per-tab-change report is the only source. |
| FR-011 | Every field exposed through the cross-panel read MUST be a NON-SECRET display/identity value already shown on screen (panel id, tab id, tab label, active flag). It MUST NEVER carry a token, OAuth secret, credential, file path, `~/.claude` location, transcript line, or any dock secret — consistent with the secrets-stay-in-main rule and the `PromptContext`/`ViewContext` whitelist. |

### Click action = attach context to the next prompt

| ID     | Requirement |
|--------|-------------|
| FR-012 | Activating a tab row (click / Enter / Space) MUST NOT navigate to that panel, switch the active rail surface, or render the tab inline. Its ONLY effect is to SELECT that panel + tab as the context for the NEXT prompt submitted from the Cosmos composer. |
| FR-013 | The selection MUST be expressed as a `PromptContext` (`src/shared/promptContext/promptContext.ts`) carrying the `panel` dimension (the selected panel's id + label) and the `tab` dimension (the selected tab's id + label). It MUST reuse this existing shared contract — NOT a new parallel shape. |
| FR-014 | The selected context MUST surface in the Cosmos composer's context chip using the SAME treatment as the existing view-context `ContextChip` (the quiet "↳ item" affordance), so the user sees, before sending, which panel + tab the prompt will be grounded to. |
| FR-015 | On submit with a selection active, the captured `PromptContext` MUST be the SELECTED panel + tab, fed through the existing `buildAgentSubmitWithMarker` path so it is embedded in the trailing `<cosmos:context>` marker AND recorded for the timeline live-seed — the same "one source, two channels" mechanism as `cosmos-timeline-prompt-context-v1`. The wire render target MUST remain `'generated-ui'` (the Cosmos surface); only the prompt's CONTEXT names the selected panel + tab. |
| FR-016 | The selection MUST be per-compose and dismissible, mirroring the existing context-chip dismiss semantics: selecting another tab REPLACES the selection; dismissing the chip (`×`) clears it so the next submit carries no selected context. After a submit, the selection's persistence across subsequent submits is defined by OQ-2 (sticky vs. one-shot). |
| FR-017 | A selected tab that is closed or renamed in its source panel before submit MUST be handled gracefully: a closed selected tab MUST clear the selection (no stale/dangling context); a renamed selected tab SHOULD reflect the new label in the chip. The submit MUST never embed a context for a tab that no longer exists. |

### Dock / selection dimension (determination)

| ID     | Requirement |
|--------|-------------|
| FR-018 | For v1, an activated tab row MUST contribute **panel + tab** only — the two dimensions universally available in any cross-panel tab list. The **dock** dimension (`PromptContext.dock`, the open Slack thread / Jira issue detail / Confluence page / Calendar event) MUST be OMITTED from a tree-click selection in v1, because a non-active panel's per-tab dock/selection (`ViewContext`) is not exposed through any cross-panel read today and sourcing it would require new per-tab dock publishing from every panel. Whether v1 should include the dock dimension is OQ-3. |
| FR-019 | FR-018 MUST NOT change the EXISTING in-composer behavior: submitting directly from a generative panel still captures that panel's live dock/selection into `PromptContext.dock` exactly as today. The tree-click path is an ADDITIVE way to reference another panel's tab; it neither removes nor weakens the existing same-panel dock capture. |

### Empty & resilience states

| ID     | Requirement |
|--------|-------------|
| FR-020 | A panel group with zero open tabs MUST render a quiet, explicit "No open tabs" line under its group header (never a phantom row, never a silently absent group when the panel is enabled). |
| FR-021 | When every in-scope panel has zero open tabs, the tree MUST show a single calm empty state. (Terminal always has at least one tab, so in practice this is the all-generative-empty case.) |
| FR-022 | A malformed / unexpected entry in the cross-panel read MUST be ignored (warn-and-skip) rather than crash the tree — consistent with the project's "invalid payloads warn + ignored, never crash" boundary rule. |

---

## Edge Cases & Constraints

- **Lossy persistence snapshot is NOT the source.** The existing `buildGenerativePanel` persistence
  contribution keeps only composed surfaces, so it is not a faithful list of every open tab; the
  cross-panel read MUST be the full live tab list (FR-008), not the persisted subset.
- **No reach-in.** The Cosmos panel MUST NOT read another panel's internal hook/component state; it
  consumes a shared, reactive, read-only contract built from each panel's existing report (FR-009).
- **Terminal split is not persisted.** The Terminal divider widths are renderer-local; mirroring
  the terminal split means the Cosmos split width is session-only by default (FR-004 / OQ-1).
- **Cosmos excluded from its own tree.** Only Slack/Jira/Confluence/Calendar/Terminal appear; the
  Cosmos panel's own pinned tab is not listed (FR-005).
- **Disabled integrations.** A not-enabled integration's panel is omitted from the tree (FR-006),
  matching rail visibility.
- **Selected tab closed/renamed before submit.** A closed selection clears; a renamed selection
  reflects the new label; the submit never embeds a non-existent tab (FR-017).
- **Dismiss / replace semantics.** Selecting another tab replaces the selection; the chip `×`
  clears it — identical to the existing view-context chip dismiss (FR-016).
- **Non-secret invariant is absolute.** No field in the cross-panel read, the selected
  `PromptContext`, the chip, the marker, or any IPC payload may carry a secret/token/path/raw line
  (FR-011) — the same rule that governs `ViewContext`/`PromptContext`.
- **Out of scope (explicitly):** navigating to / switching to the clicked panel; rendering a tab's
  surface inline in the Cosmos panel; showing the Cosmos panel's own tabs; a show/hide toggle for
  the tree (always-visible, only resizable in v1); persisting the dock dimension cross-panel
  (deferred to OQ-3); any new fetch or per-tab tracking to enrich the tree beyond the labels panels
  already hold; cross-session restoration of the tree's expand/collapse state.

---

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | The Cosmos panel shows a resizable split: timeline LEFT, panel-tab tree RIGHT, with the docked composer below — reusing `ResizeDivider`; the tree uses `FileTree`'s roving ARIA-tree keymap (FR-001..FR-003). |
| SC-002 | The tree lists, grouped and labeled, the live open tabs of Slack, Jira, Confluence, Google Calendar, and Terminal — reflecting opens/closes/renames live and showing EVERY open tab, not just composed ones (FR-005/FR-007/FR-008). The Cosmos panel's own tabs are absent; disabled integrations are absent. |
| SC-003 | The cross-panel read is a shared reactive read-only contract derived from each panel's existing per-tab report; the Cosmos panel reaches into no panel's internals and triggers no new fetch/tracking (FR-009/FR-010). |
| SC-004 | Activating a tab row attaches that panel + tab as the next Cosmos prompt's context: the composer chip shows it (ContextChip treatment), and on submit the `<cosmos:context>` marker + grounding name that panel + tab while the wire target stays `'generated-ui'` (FR-012..FR-015). |
| SC-005 | Selecting another tab replaces the selection; dismissing the chip clears it; a closed selected tab clears before submit; the submit never embeds a non-existent tab (FR-016/FR-017). |
| SC-006 | A tree-click selection contributes panel + tab only (no dock) in v1, while same-panel direct submits still capture dock as today (FR-018/FR-019). |
| SC-007 | A panel with no open tabs shows "No open tabs"; an all-empty tree shows one calm empty state; a malformed read entry is skipped, never crashes (FR-020..FR-022). |
| SC-008 | No token, secret, credential, file path, or raw line appears anywhere in the cross-panel read, the selected `PromptContext`, the chip, or the marker (FR-011). |

---

## Open Questions

- [ ] **OQ-1 — Persist the split width?** The Terminal split is renderer-local / session-only (NOT
  persisted). Mirroring it (FR-004) makes the Cosmos timeline/tree split width session-only too
  (lost on relaunch). Does the user want the Cosmos split width PERSISTED across relaunch? That
  would EXCEED terminal parity and add a new persisted field (a `SESSION_SCHEMA_VERSION` /
  snapshot-shape decision for the plan). Default assumed: session-only, matching the terminal.
- [ ] **OQ-2 — Selection lifetime after submit.** After a prompt is submitted with a selected
  panel+tab, should the selection STICK for the next prompt too (sticky until changed/dismissed),
  or clear automatically (one-shot per submit, like a fresh compose)? The existing view-context
  chip is per-compose/non-sticky; defaulting to one-shot (clear after submit) matches it, but a
  sticky selection may better fit "I'm asking several things about this Jira tab." Needs the user's
  call.
- [ ] **OQ-3 — Include the dock dimension in a tree-click selection (v1 or later)?** v1 contributes
  panel + tab only (FR-018) because a non-active panel's per-tab dock/selection (`ViewContext`) is
  not exposed cross-panel today; sourcing it requires every panel to publish each tab's current
  dock/selection into the cross-panel read. Should v1 invest in per-tab dock publishing so a
  tree-clicked tab can also carry its open Slack thread / Jira issue / Confluence page / Calendar
  event — or ship panel+tab first and defer dock to a follow-up? (The `PromptContext.dock` contract
  and the timeline/chip already support dock; the only gap is SOURCING it cross-panel.)
