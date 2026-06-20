# Spec: Terminal Open-Directory Picker — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: —
**Related plan**: (to be authored — Step 2)

---

## Grounding

> Direct investigation run for this spec (mandatory). Tools were run by the architect, not handed in.

**codegraph_explore**

- `PtyManager PaneSpawnOptions pty:start pty:dispose TerminalPanel PanelTabStrip onNewTab paneId spawn cwd` — confirmed `PaneSpawnOptions` (`src/main/ptyManager.ts:87`) **already** carries optional `cwd`; `PtyManager.start(paneId, opts)` resolves `const cwd = pane.cwd ?? this.options.cwd` (`ptyManager.ts:190`). Per-pane cwd spawn is already supported — REUSE it, do not invent a new option.
- `TerminalView pty:start startPane window.cosmos.pty start useEffect mount` — confirmed the current auto-spawn: `TerminalView`'s mount effect calls `window.cosmos.pty.start(paneId)` unconditionally on mount (`src/renderer/TerminalPanel.tsx:171`). A fresh tab today spawns `claude` immediately with no directory choice. `TerminalPanel.handleNewTab` just `open(mintTab())`s a tab; the spawn is driven entirely by the view mounting.
- `TerminalPanel new tab mintTab open close usePanelTabs` — terminal tabs are minted with `{ id: crypto.randomUUID(), label: terminalLabel(index) }`; the panel always keeps ≥1 tab (re-opens a default when the collection empties).

**Reading the IPC contract + main wiring** (`src/shared/ipc.ts`, `src/main/index.ts`)

- `PtyChannel` has `Start/Input/Resize/Exit/Restart/Dispose` only — there is **no** directory-picker channel. `PtyStartPayload` carries only `{ paneId }`.
- `ipcMain.on(PtyChannel.Start, …)` (`index.ts:655`) validates `{ paneId }`, then `ptyManager.start(paneId, paneSpawnFor(paneId, sandboxDirCached))`. `paneSpawnFor` resolves the cwd (default `sandboxDir = app.getPath('userData')/sandbox`, the isolated sandbox cwd) and resume state.
- Grep for `showOpenDialog` / `dialog.` across `src/` returns **no native OS dialog usage** anywhere — a directory picker is net-new. Electron's `dialog.showOpenDialog({ properties: ['openDirectory'] })` must run in MAIN, behind a NEW typed IPC channel in `src/shared/ipc.ts` + a NEW `window.cosmos.*` preload method.

**codegraph/memory recall**

- `memory_recall` / `memory_smart_search` for "terminal pty cwd spawn claude working directory" and "directory picker dialog" — **no stored prior decisions** on terminal cwd selection. No conflicting precedent.

**Architecture cross-check** (`docs/ARCHITECTURE.md`)

- §4.1/§4.11: one live `claude` session per terminal tab, renderer-minted `paneId`, "each tab spawns via its own `pty:start`"; embedded `claude` runs in an **isolated sandbox cwd** by default (`app.getPath('userData')/sandbox`). This feature lets the user override that per-tab cwd at spawn time. The "each fresh tab auto-spawns" sentence in the architecture will need a follow-up update once this lands (noted under Constraints — architect's responsibility post-plan).

---

## Overview

Today a freshly-opened Terminal tab immediately spawns `claude` in a default working directory, with no chance for the user to choose where it runs. This feature defers the spawn: a new Terminal tab first presents an **[Open]** affordance; clicking it opens the native OS directory picker; once the user selects a directory, `claude` is spawned with its working directory set to that chosen directory. This lets each terminal session run in the project directory the user intends, rather than a fixed sandbox cwd.

## User Scenarios

### Choose a directory before launching Claude Code · P1

**As a** cosmos user opening a new Terminal tab
**I want to** pick the working directory for that tab before Claude Code starts
**So that** Claude Code runs in the project I intend to work on, not a fixed default location

**Acceptance criteria:**

- Given I open a new Terminal tab (via `+`, `Cmd+T`, or the seeded first tab), when the tab appears, then it shows an [Open] affordance and **no** `claude` process is running for that tab (no PTY spawned yet).
- Given a tab in the [Open] state, when I click [Open], then the native OS directory picker opens.
- Given the directory picker is open, when I select a directory and confirm, then `claude` is spawned with its working directory set to the chosen directory and the tab transitions to the live terminal showing the Claude Code TUI.

### Cancel the picker without launching · P1

**As a** user who opened the directory picker by accident or changed my mind
**I want to** cancel the picker
**So that** nothing is launched and I can decide again

**Acceptance criteria:**

- Given the directory picker is open, when I cancel/dismiss it without selecting a directory, then the tab stays in the [Open] state, no `claude` process is spawned, and no error is shown.
- Given a tab returned to the [Open] state after a cancel, when I click [Open] again, then the picker re-opens and the flow can proceed normally.

### Independent per-tab directory selection · P1

**As a** user running multiple terminal tabs
**I want to** each tab to pick its own directory independently
**So that** I can run Claude Code in different projects side by side without one tab affecting another

**Acceptance criteria:**

- Given one Terminal tab is already live in directory A, when I open a second Terminal tab and pick directory B, then the second tab's `claude` runs in B while the first tab's session in A is unaffected.
- Given a tab is in the [Open] state, when I switch to a different live terminal tab and back, then the [Open] tab is still awaiting a directory (it has not spawned) and the live tab is untouched.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                               |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | A freshly-opened Terminal tab MUST NOT auto-spawn `claude`. It MUST instead enter an "awaiting directory" state that presents an [Open] affordance and has no live PTY.   |
| FR-002 | The [Open] affordance MUST, when activated, open the native OS directory picker (file explorer) configured to select a single directory.                                 |
| FR-003 | The directory picker MUST be invoked in the main process via Electron `dialog.showOpenDialog` and reached from the renderer through a NEW typed IPC channel in `src/shared/ipc.ts` and a NEW `window.cosmos.*` preload method. The renderer MUST NOT open the dialog directly. |
| FR-004 | On a valid directory selection, the system MUST spawn `claude` for that tab with its working directory (`cwd`) set to the chosen directory, REUSING the existing `PaneSpawnOptions.cwd` per-pane spawn path. No new spawn option may be invented.                       |
| FR-005 | After a successful spawn, the tab MUST transition from the [Open] state to the live terminal, rendering the Claude Code TUI for that pane exactly as a normally-spawned terminal does (input, output, resize, exit, restart all behave as today).                       |
| FR-006 | If the user cancels/dismisses the picker without choosing a directory, the system MUST NOT spawn anything, MUST leave the tab in the [Open] state, and MUST NOT surface an error.                                                                                       |
| FR-007 | Directory selection MUST be per-tab and independent: each tab's [Open] → pick → spawn affects only that tab's `paneId`; other tabs (live or awaiting) MUST be unaffected.                                                                                               |
| FR-008 | The chosen directory path MUST flow from main → renderer (and the resulting spawn request renderer → main) only through the validated IPC boundary. The payload carrying the path/spawn intent MUST be validated at the main-process boundary; an invalid/malformed payload MUST be warned and ignored, never crash (consistent with every other `pty:*`/`ui:*` channel).                  |
| FR-009 | The Terminal panel MUST continue to always keep ≥1 tab. A newly-seeded first tab (clean session, or after closing the last tab) MUST also start in the [Open] state rather than auto-spawning (it follows the same deferred-spawn rule as FR-001).                       |
| FR-010 | The chosen directory path is a user-selected local filesystem path and is NOT a secret; however it MUST still travel only over the typed, validated IPC boundary and MUST NOT be logged in a way that violates existing logging conventions. No tokens/secrets are involved in this flow. |

## Edge Cases & Constraints

- **Picker cancelled / closed with no selection** → tab stays [Open], no spawn, no error (FR-006).
- **Tab closed while in the [Open] state** → closing it disposes nothing live (no PTY was spawned); the panel still honors the ≥1-tab rule and re-seeds a default [Open] tab if the collection empties (FR-009).
- **Tab closed while the picker is open** is an ambiguous interaction — see Open Questions (OQ-3).
- **Selecting the default/sandbox directory** is a normal selection like any other; no special-casing.
- **UI-bearing feature → a design step follows the plan.** The visual design of the [Open] empty-state (button placement, label, terminal-area treatment while awaiting) is a **designer** concern (`design` skill, `.sdd/designs/terminal-open-directory-picker-v1.md`) between plan and interface. This spec defines only the behavior, not the visual treatment.
- **Implementation constraint (carry into the plan, not the spec's scope):** adding a new `window.cosmos.*` preload method requires a FULL `npm run dev` restart — HMR alone leaves the new method as "not a function" (CLAUDE.md). The plan must call this out.
- **Architecture follow-up (architect-owned, post-plan):** `docs/ARCHITECTURE.md` §4.1/§4.11 describe a fresh tab as auto-spawning its PTY. Once this lands, that description must be updated to "a fresh tab defers spawn until the user selects a directory." Tracked here so the doc does not drift.
- **Out of scope (explicitly):**
  - Remembering the last-used directory across tabs or sessions.
  - A recent-directories list / shortcuts / favorites.
  - Typing or pasting a path manually instead of using the OS picker.
  - Changing the working directory of an already-live terminal (re-pick after spawn).
  - Multi-directory selection (the picker selects exactly one directory).
  - Persisting/restoring the [Open] (awaiting) state across app relaunch beyond what session-persistence already does for terminal tabs (see OQ-2).

## Success Criteria

| ID     | Criterion                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | A newly-opened Terminal tab shows the [Open] affordance and has zero `claude` processes spawned until a directory is chosen.               |
| SC-002 | Clicking [Open] opens the native OS directory picker; selecting a directory spawns `claude` with `cwd` equal to that directory.            |
| SC-003 | Cancelling the picker leaves the tab in the [Open] state with no spawned process and no error message.                                     |
| SC-004 | Two terminal tabs can be launched into two different directories; each session's working directory matches its own selection.              |
| SC-005 | A malformed directory-picker/spawn IPC payload is warned and ignored at the main boundary; the app does not crash.                         |
| SC-006 | No token or secret appears in the new IPC channel, preload method, or any payload introduced by this feature.                              |

---

## Open Questions

- [ ] **OQ-1 — Restart semantics after exit.** When a spawned (post-pick) terminal's `claude` exits, the existing per-tab "Restart claude" affordance restarts in the same `cwd`. Is that the desired behavior (restart in the previously-chosen directory), or should an exited tab fall back to the [Open] state to re-pick? Assumed: **restart in the same directory** (least change, matches current restart). Confirm.
- [ ] **OQ-2 — Restored sessions.** session-persistence already restores terminal tabs and resumes their `claude` sessions with the persisted `cwd`. This feature targets NEWLY-opened tabs. Confirm restored tabs should continue to auto-resume (NOT drop to the [Open] state), so persistence is unchanged.
- [ ] **OQ-3 — Tab closed while the picker is open.** If the user closes the tab (or the picker's owning tab is otherwise removed) while the native dialog is still open, what should happen to a subsequently-returned selection? Assumed: a selection for a no-longer-present tab is safely ignored (no orphan spawn). Confirm this is acceptable rather than blocking tab close while a dialog is open.
- [ ] **OQ-4 — Default starting location of the picker.** Should the directory picker open at a particular default location (e.g. the user's home directory, or the current sandbox cwd), or use the OS default? Assumed: OS default (no `defaultPath`). Confirm if a specific starting directory is wanted.
