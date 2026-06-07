# Spec: Inline tab rename — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: .sdd/plans/tab-rename-v1.md (to be authored)

---

## Overview

Let a user double-click any panel tab to rename it inline, replacing the tab's
label with an editable text field. A manually renamed tab keeps its custom name
for the rest of that tab's session — the system's automatic relabeling must never
overwrite it. The behavior is uniform across all five rail panels (Terminal,
Generated UI, Slack, Jira, Confluence) because they all share one tab strip.

## User Scenarios

> Prioritized P1 (must) / P2 (should) / P3 (nice to have). Each is independently testable.

### Rename a tab by double-click · P1

**As a** cosmos user
**I want to** double-click a tab and type a new name
**So that** I can give a tab a meaningful label instead of the auto-generated one

**Acceptance criteria:**

- Given a tab strip with at least one tab, when I double-click a tab's label, then
  that tab's label is replaced by a text input pre-filled with the current label,
  with the text selected, and the input is focused.
- Given a tab is in edit mode, when I type a new value and press Enter, then the
  input is replaced by the new (trimmed) label and the tab returns to its normal
  resting state.
- Given a tab is in edit mode, when I click elsewhere so the input loses focus
  (blur), then the edit commits exactly as Enter does.
- Given a tab is in edit mode, when I press Escape, then the edit is cancelled and
  the tab's label reverts to the value it had before editing began.
- Given any panel (Terminal / Generated UI / Slack / Jira / Confluence), the
  rename gesture and behavior are identical, because all five share `PanelTabStrip`.

### A renamed tab keeps its name · P1

**As a** cosmos user who renamed a tab
**I want to** keep my custom name even when the app would otherwise relabel the tab
**So that** my rename is not silently lost when a new run completes

**Acceptance criteria:**

- Given a generative tab (Generated UI / Slack / Jira / Confluence) I have renamed,
  when a new utterance run for that tab completes and a surface lands, then the tab
  keeps my custom label instead of being relabeled from the new utterance.
- Given a Terminal tab I have renamed, when any automatic terminal labeling would
  apply, then the tab keeps my custom label (Terminal tabs are static "Terminal N"
  today, so this is forward-protection: the rename is not overwritten).
- Given I have renamed a tab, when I do nothing further, then the custom label
  persists for the lifetime of that tab (until the tab is closed).

### Editing does not disturb other tab interactions · P1

**As a** cosmos user
**I want to** the rename gesture to not also activate, close, or switch tabs
**So that** editing a label is predictable and reversible

**Acceptance criteria:**

- Given a tab is being double-clicked to rename, when the double-click is detected,
  then the tab is not toggled through any unexpected state by the underlying
  single-click activate (the user ends in edit mode, not in some half-activated
  state).
- Given a tab is in edit mode, when I interact with the input (type, select, click
  inside it), then no activate/close is triggered on that tab.
- Given one tab is being edited, when I double-click a different tab, then editing
  moves to the second tab (the first edit commits or cancels first) — at most one
  tab is editable at a time.
- Given a tab is in edit mode, when that tab is closed, a new run starts for the
  panel, or the active tab changes, then the in-progress edit is cancelled (label
  reverts to its pre-edit value).

### Keyboard-driven rename · P2

**As a** keyboard user
**I want to** start a rename without a mouse
**So that** the feature is usable without pointer input

**Acceptance criteria:**

- Given a tab has keyboard focus, when I press F2, then that tab enters edit mode
  exactly as a double-click would (input focused, current label pre-filled and
  selected).
- Given a tab is in edit mode, Enter commits and Escape cancels, identical to the
  mouse-driven flow, and focus returns to the tab button afterward.

### Empty / whitespace rename is rejected · P1

**As a** cosmos user
**I want to** never end up with a blank, nameless tab
**So that** every tab stays identifiable

**Acceptance criteria:**

- Given a tab is in edit mode, when I commit an empty or whitespace-only value,
  then the tab reverts to its pre-edit label and is NOT marked as renamed.
- Given a tab is in edit mode, when I commit a value with leading/trailing
  whitespace, then the committed label is the trimmed value.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The shared `PanelTabStrip` MUST let a user enter an inline edit mode for a tab's label by double-clicking that tab's label region. |
| FR-002 | On entering edit mode the strip MUST render a single-line text input in place of the label, pre-filled with the tab's current label, with the input focused and its text selected. |
| FR-003 | The strip MUST commit the edit when the user presses Enter OR when the input loses focus (blur), applying the trimmed value as the tab's new label. |
| FR-004 | The strip MUST cancel the edit when the user presses Escape, restoring the tab's label to the value it had immediately before edit mode began. |
| FR-005 | On committing a value that is empty or whitespace-only, the system MUST revert to the pre-edit label and MUST NOT mark the tab as renamed (no blank tabs). |
| FR-006 | On committing a non-empty value, the system MUST trim leading/trailing whitespace before applying it as the label. |
| FR-007 | The system MUST record, per tab, that it has been manually renamed (a "renamed" flag or equivalent) when, and only when, a non-empty rename commits. |
| FR-008 | The generative auto-relabel path (deriving a tab label from its originating utterance when a surface lands) MUST NOT overwrite the label of a tab marked renamed. |
| FR-009 | Any other automatic label path that applies to an existing tab (e.g. terminal relabeling) MUST NOT overwrite the label of a tab marked renamed. |
| FR-010 | While a tab is being edited, the strip MUST NOT trigger that tab's activate or close as a side effect of the edit gesture or input interaction. |
| FR-011 | The double-click that starts a rename MUST NOT leave the tab in an unintended state from the underlying single-click activate handler. |
| FR-012 | At most one tab MAY be in edit mode at any time; starting an edit on another tab MUST first resolve (commit or cancel) any in-progress edit. |
| FR-013 | An in-progress edit MUST be cancelled (revert to pre-edit label) when the edited tab is closed, when a new run starts for the panel, or when the active tab changes. |
| FR-014 | The strip SHOULD let a keyboard user start a rename on the focused tab via F2, with identical commit/cancel semantics to the mouse flow. |
| FR-015 | The inline input MUST have an accessible name identifying it as the tab-label editor (e.g. an `aria-label` referencing the tab being renamed). |
| FR-016 | On entering edit mode focus MUST move to the input; on commit or cancel focus MUST return to the tab's button (keyboard parity with the existing roving-tabindex strip). |
| FR-017 | A renamed label MUST be session-only — it persists for the tab's lifetime but is NOT persisted across app restart, consistent with all existing tab state. |
| FR-018 | The rename behavior MUST be available identically on all five panels (Terminal, Generated UI, Slack, Jira, Confluence) through the single shared `PanelTabStrip`. |
| FR-019 | The strip MUST surface, to the host panel, that a tab's label changed via rename, so the panel can persist the new label + renamed flag into its own tab record (the strip is presentational; the panel owns tab state). |
| FR-020 | Pure, node-testable rename logic (trim + empty-revert + renamed-flag decision; the auto-relabel skip) SHOULD live in `panelTabs.ts` (a `.ts`, not the `.tsx`), consistent with the project's test-split convention. |

## Edge Cases & Constraints

- **Commit equals pre-edit value:** committing the unchanged current label is allowed;
  it MAY still mark the tab renamed (the user explicitly confirmed that name) — this is
  acceptable and not a defect. (Decision: marking renamed on an unchanged-but-non-empty
  commit is fine; the only hard rule is empty/whitespace never marks renamed.)
- **Untitled generative tabs:** an "Untitled" (`+`-created, not-yet-composed) generative
  tab MAY be renamed; once renamed it MUST NOT be relabeled by a later first compose
  (FR-008). The italic-muted "Untitled" treatment ends once a real label is committed.
- **In-flight / error tabs:** a tab may be renamed while in-flight or errored; the
  rename affects only the label, not the lifecycle glyph (spinner / error icon) or the
  error tooltip.
- **Tooltip:** after rename the tab tooltip reflects the new label (the existing strip
  derives its idle tooltip from the label; the error tooltip still shows the run-failure
  message).
- **No length cap added:** long labels remain handled by the existing CSS truncation
  (`max-w-[16rem]` + `truncate`); this feature adds no arbitrary character limit at the
  rename boundary. (The existing `MAX_LABEL_LENGTH` content cap applies only to the
  utterance-derived auto-label path, which a renamed tab no longer takes.)
- **Close `X` and `+` during edit:** the close `X` and the trailing `+` remain
  functional; closing the tab being edited cancels the edit (FR-013); clicking `+` opens
  a new tab and commits/cancels the in-progress edit per FR-012.
- **Single edit at a time:** the strip tracks at most one "editing tab id"; this is
  presentational/local strip state.

- **Out of scope:** persistence of labels across app restart (tabs are session-only,
  FR-017); renaming via a right-click context menu (only double-click + optional F2);
  any change to IPC, main process, MCP servers, or the typed contract — this is a
  renderer-only feature (the strip + the per-panel tab records + the auto-relabel skip).
  Verified during investigation: the auto-relabel paths are entirely renderer-side
  (`useGenerativePanelTabs` `ui:render` subscription; `TerminalPanel` mint-time label),
  so no main/IPC/MCP change is required.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Double-clicking a tab's label in any of the five panels enters inline edit mode with the current label pre-filled and selected. |
| SC-002 | Enter and blur both commit the trimmed label; Escape restores the pre-edit label. |
| SC-003 | Committing an empty/whitespace value leaves the tab's prior label intact and the tab unmarked as renamed. |
| SC-004 | After renaming a generative tab, a subsequent completed run for that tab does NOT change the tab's label. |
| SC-005 | Renaming never causes the tab to also activate or close from the same gesture, and only one tab is editable at a time. |
| SC-006 | A keyboard user can start a rename (F2) and commit/cancel without a pointer, with focus returning to the tab afterward. |
| SC-007 | Pure rename logic (trim/empty-revert/renamed-flag/auto-relabel-skip) is covered by node tests in `panelTabs.test.ts` (no jsdom). |
| SC-008 | No change is required to `src/shared/`, `src/main/`, `src/preload/`, or `src/mcp/` — the diff is renderer-only. |

---

## Open Questions

- None. The F2 keyboard affordance is included as a P2/SHOULD (FR-014) rather than
  left open; if the design step finds it conflicts with the roving-tabindex strip it
  may be deferred, but the spec's intent is to offer keyboard parity.
