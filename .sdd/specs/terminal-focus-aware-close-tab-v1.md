# Spec: Focus-Aware Ctrl+W in the Terminal Panel — v1

**Status**: Draft
**Created**: 2026-06-23
**Supersedes**: —
**Related plan**: .sdd/plans/terminal-focus-aware-close-tab-v1.md

---

## Grounding

> Direct investigation run by the architect before authoring (mandatory handoff report).

**codegraph_explore** queries:
- `FileViewer openFiles FileTab close tab active path TerminalPanel` — found `FileViewer` renders the open-file tabs via `FileTabStrip`; its root is a `flex … outline-none` container; `useFileExplorer` owns the `openFiles`/`activeRelPath`/`closeFile` collection.
- `ShortcutChannel Trigger before-input-event matchShortcut renderer shortcut handler close active panel tab` — `Cmd/Ctrl+W` resolves to the `tab:close` `ShortcutCommand` in `matchShortcut` (main); main `preventDefault`s it and sends `ShortcutChannel.Trigger`; the menu Close item is omitted in `buildAppMenu`.
- `useFileExplorer openFiles activeViewer closeFile onClose FileTabStrip activeRelPath nextActive` — `useFileExplorer.closeFile(relPath)` delegates to the pure `closeFile`/`adjacentActiveId` in `openFiles.ts`, which already computes the next-active tab on close.
- `App.tsx shortcut Trigger handler activeSurface tab:close tab:new useShortcuts onTabClose` — confirmed `useTabShortcuts` is the single per-panel consumer of `onTrigger`, gated by `active`, mapping `tab:close → onCloseTab(activeTabId)`.
- `useExplorerPanes fileExplorer index barrel FileExplorer FileTabStrip activeRelPath onClose onActivate` — `useExplorerPanes(paneId, live, …)` returns `{ viewer, tree }`; it owns the `useFileExplorer` instance whose `openFiles`/`activeRelPath`/`closeFile` are NOT currently surfaced to `TerminalPanel`.

**Direct reads**: `src/renderer/useTabShortcuts.ts` (the `tab:close` map), `src/renderer/TerminalPanel.tsx` (per-tab `TerminalView` hosts `useExplorerPanes`; the panel-level `useTabShortcuts` lives in `TerminalPanel`, the explorer lives in `TerminalView`), `src/main/index.ts` lines 1724–1748 + `buildAppMenu` (Ctrl+W already prevented + forwarded; no menu accelerator).

**memory_recall** queries:
- `terminal file explorer file viewer openFiles tabs Ctrl+W shortcut` — no prior observations (greenfield for this routing decision).

**Takeaways**: The `tab:close` command already arrives in the renderer with no new IPC. The only change is WHERE the Terminal panel routes it. The pure next-active-tab rule already exists (`closeFile`/`adjacentActiveId`). The architectural challenge is that the focus + open-file state lives PER `TerminalView` (per pane), while `useTabShortcuts` lives ONE level up in `TerminalPanel` and only knows the active `paneId` — so the active pane's viewer-focus + open-file state must be lifted to where the routing decision is made.

---

## Overview

When keyboard focus is inside the Terminal panel's **file viewer** (the open-file tab strip
or the viewer body for the active file), `Ctrl/Cmd+W` MUST close the **active open-file tab**
in that viewer, not the panel's terminal tab. When focus is anywhere else in the Terminal
panel (the terminal xterm, the file tree, or nothing in particular), `Ctrl/Cmd+W` keeps its
existing behavior of closing the active terminal panel tab. This makes Ctrl+W behave the way
a user expects given what they are looking at, mirroring VS Code's editor-vs-terminal close.

## User Scenarios

### Close the focused file's tab · P1

**As a** user reading a file in the terminal panel's file viewer
**I want to** press Ctrl+W and have it close the file I'm viewing
**So that** I can dismiss files without losing my terminal tab (and its live `claude` session)

**Acceptance criteria:**

- Given the file viewer has focus and ≥1 open file, when I press Ctrl/Cmd+W, then the
  **active open-file tab** closes and a sensible neighbour becomes active.
- Given the file viewer has focus and I close the **last** open-file tab, then the viewer
  returns to its "Select a file" placeholder and the terminal panel tab is unchanged.
- Given I just clicked a file tab or the viewer body (so focus is in the viewer), when I
  press Ctrl/Cmd+W, then the open-file tab closes — the panel's terminal tab is untouched.

### Terminal-focused Ctrl+W still closes the panel tab · P1

**As a** user typing in the embedded terminal
**I want to** press Ctrl/Cmd+W and have it close the terminal tab as it does today
**So that** the focus-aware behavior never breaks the established panel-tab shortcut

**Acceptance criteria:**

- Given the xterm terminal (left column) has focus, when I press Ctrl/Cmd+W, then the
  active **terminal panel tab** closes (existing behavior, unchanged).
- Given no element in the viewer has focus (e.g. the file tree has focus, or focus is on
  panel chrome), when I press Ctrl/Cmd+W, then the active **terminal panel tab** closes.
- Given the Terminal surface is NOT the active rail surface, when I press Ctrl/Cmd+W, then
  the Terminal panel does nothing (the `active` rail gate is unchanged for all routing).

### Empty viewer falls through · P2

**As a** user whose file viewer is focused but has no open files
**I want** Ctrl/Cmd+W to do the sensible default
**So that** the shortcut is never a dead no-op when there's an obvious target

**Acceptance criteria:**

- Given the file viewer region is focused but **zero** files are open (the "Select a file"
  placeholder), when I press Ctrl/Cmd+W, then the routing falls through to closing the
  active **terminal panel tab** (the recommended default — see OQ-2).

## Functional Requirements

| ID     | Requirement                                                                                                                                                              |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The Terminal panel MUST route the `tab:close` shortcut command to either the file-viewer's active open-file tab OR the active terminal panel tab, based on focus state. |
| FR-002 | When the **active pane's** file viewer region holds focus AND that pane has ≥1 open file, `tab:close` MUST close the file viewer's **active** open-file tab.             |
| FR-003 | When the file viewer's active open-file tab is closed, the next-active open-file tab MUST be chosen by the existing pure adjacency rule (`closeFile`/`adjacentActiveId`). |
| FR-004 | When the active pane's file viewer does NOT hold focus, `tab:close` MUST close the active terminal panel tab (existing behavior).                                       |
| FR-005 | When the active pane's file viewer holds focus but has **zero** open files, `tab:close` MUST fall through to closing the active terminal panel tab (OQ-2 default).      |
| FR-006 | The "file viewer has focus" check MUST cover BOTH the open-file tab strip and the viewer body (the active file's content), and MUST exclude the terminal xterm and the file tree. |
| FR-007 | Focus detection MUST be robust to the user clicking between the terminal, the tree, and the viewer — the route MUST reflect the region the user most recently focused, not a stale value. |
| FR-008 | The routing decision (given: viewer-focused boolean + open-file count → `'file-tab' \| 'panel-tab'`) MUST be a pure function in a `.ts` module with a sibling `.test.ts`. |
| FR-009 | The feature MUST require NO new IPC channel — the `tab:close` command already arrives via `ShortcutChannel.Trigger` → `window.cosmos.shortcuts.onTrigger`.                |
| FR-010 | The feature MUST only change Terminal-panel routing — the other rail panels' `tab:close` behavior MUST be unchanged.                                                     |
| FR-011 | Closing a file via Ctrl/Cmd+W MUST behave identically to closing it via the tab's `X` or Delete/Backspace (same `closeFile` op, same persisted-open-files reporting).    |
| FR-012 | Focus state MUST be tracked only for the **active** terminal pane — an inactive pane's viewer focus MUST never influence routing (only one pane is visible at a time).   |

## Edge Cases & Constraints

- **Per-pane focus state is for the ACTIVE pane only.** All `TerminalView`s stay mounted; the
  routing decision lives at the panel level where `useTabShortcuts` runs and only the active
  `paneId` matters. The active pane's viewer-focus + open-file count are the only inputs.
- **`tab:close` arrives globally** (matched in main regardless of DOM focus, since an
  xterm-focused terminal would otherwise swallow it). So routing CANNOT rely on the keystroke
  reaching a specific DOM node — it must consult a tracked focus state, not the event target.
- **Closing the last open file** empties the viewer to its placeholder; the terminal tab and
  its live PTY session are untouched.
- **Closing a file never touches the terminal**, mirroring the existing open/retarget invariant
  (FR-013 of terminal-file-explorer-v1): the xterm stays mounted + live.
- **Out of scope:** changing main-side shortcut matching; adding the focus-aware behavior to
  non-Terminal panels; any new persisted state (focus is ephemeral); changing the `+`/new-tab,
  `tab:next/prev/jump/last` routing (only `tab:close` is focus-aware).

## Success Criteria

| ID     | Criterion                                                                                                              |
|--------|----------------------------------------------------------------------------------------------------------------------|
| SC-001 | With the file viewer focused and ≥1 open file, Ctrl/Cmd+W closes exactly the active open-file tab and the terminal tab count is unchanged. |
| SC-002 | With the terminal xterm focused, Ctrl/Cmd+W closes the active terminal panel tab (unchanged behavior).               |
| SC-003 | The pure routing predicate has a passing `.test.ts` covering: viewer-focused + files, viewer-focused + empty, not-focused + files, not-focused + empty. |
| SC-004 | No new entry in `src/shared/ipc.ts`; `git grep` shows no added channel for this feature.                              |
| SC-005 | Closing the last open file returns the viewer to "Select a file" with the terminal tab intact.                       |

---

## Open Questions

- [ ] **OQ-1 (focus detection mechanism) — recommended: a `:focus-within`-style check via a
  ref'd viewer container + `focusin`/`focusout` tracking, lifted to the active pane.** The
  `FileViewer` root is already a single `outline-none` container wrapping both the tab strip and
  the body, so a `focus-within` boolean on that container cleanly distinguishes "viewer focused"
  from terminal/tree focus. Recommend tracking it as React state in the active `TerminalView`
  (set on `focusin`/`focusout` of the viewer container) and lifting the active pane's
  `{ viewerFocused, openFileCount }` up to `TerminalPanel` where the routing runs. A pure
  CSS `:focus-within` selector can't be read by the JS handler, and a global `document.activeElement`
  check at keypress time is brittle across the click-to-focus cases (FR-007), so prefer the
  tracked-state approach. Confirm before implementing.

- [ ] **OQ-2 (empty-viewer fallback) — recommended: fall through to closing the panel tab.**
  When the viewer is focused but has zero open files there is no file to close, so Ctrl/Cmd+W
  should do the next most useful thing rather than nothing. Recommend falling through to the
  existing panel-tab close (FR-005). Alternative (a silent no-op) is more surprising. Confirm.

- [ ] **OQ-3 (tree focus) — recommended: tree focus routes to the PANEL tab, NOT the viewer.**
  The file tree is a separate region (the RIGHT dock); a user focused in the tree is navigating
  files, not viewing one, so Ctrl/Cmd+W closing a viewer tab they aren't looking at would be
  surprising. Recommend the tree counts as "not viewer-focused" → panel-tab close (FR-006).
  Alternative (tree focus also closes the active viewer tab, treating tree+viewer as one
  "files" region) is plausible but less predictable; flagged for the user to confirm.
