# Spec: Persist Working Directory & File-Explorer Open Files — v1

**Status**: Draft
**Created**: 2026-06-21
**Supersedes**: —
**Related plan**: .sdd/plans/persist-workdir-open-files-v1.md (to be authored)

---

## Grounding

> Direct investigation run for this spec (codegraph + agentmemory). One-line takeaways follow each query.

**codegraph_explore**
- `sessionSnapshot session snapshot schema version persist migration` — current snapshot lives in `src/shared/ipc/session.ts` (`SessionSnapshot`, `TerminalTabSnapshot`, `SESSION_SCHEMA_VERSION = 7`) and is validated/normalized in `src/main/sessionSnapshot.ts` (`validateSnapshot` — wrong version → `null` → clean session; per-tab/field defaults never crash). `TerminalTabSnapshot.cwd` ALREADY persists the per-tab working directory.
- `openFiles FileViewer fileExplorer open files active focused file state useGenerativePanelTabs sessionRegistry` — open-files state is the pure `OpenFilesState` (`{ files: OpenFile[]; activeRelPath: string | null }`, keyed by root-relative path) in `src/renderer/fileExplorer/openFiles.ts`, held in `useFileExplorer.ts` per `paneId`.
- `useFileExplorer workingDirectory rootPath cwd spawn node-pty terminal pickDirectory open folder project root` — **`useFileExplorer` lines 139–141 explicitly RESET open files to `EMPTY_OPEN_FILES` on every go-live**: "FR-007 (ephemeral): the open-files collection resets to empty whenever the tab (re-)enters its live phase — open tabs never survive a go-live or an app restart (not persisted)." This is the exact behavior the request asks to change.
- `FileExplorer go-live chooseDirectory pickFolder cwd ... TerminalPanel buildTerminalPanel TerminalTabSnapshot cwd` — `TerminalPanel.tsx` already restores terminal tabs (incl. each tab's persisted `cwd`) and auto-resumes restored tabs; the per-pane working directory is `TerminalTabSnapshot.cwd`, and `resolvePaneSpawn` (`src/main/paneSpawn.ts`) makes a resume reuse that stored cwd. Fresh tabs defer spawn to the directory picker (`terminal-open-directory-picker-v1`).

**memory_recall / memory_smart_search**
- `session persistence snapshot schema version migration working directory cwd` — no prior stored memory (empty).
- `terminal file explorer split working directory open files multi-file tabs session persistence` — no prior stored memory (empty).
- Persisted this spec's central finding via `memory_save` (terminal cwd already persisted; open-files are the real gap; schema v7 with concurrent #93 reconciliation).

---

## Overview

On relaunch, cosmos should restore the same working state a terminal tab had when the app last
closed: the directory the tab was operating on, and — within that directory — which files were
open in the file-explorer viewer and which one was focused/active. Today the per-tab working
directory already survives restart, but the file-explorer's open files are deliberately wiped on
every relaunch; this feature makes the open-files set and its active file persist and restore too,
so a user does not lose their place.

---

## User Scenarios

### Working directory survives restart · P1

**As a** cosmos user who has opened a folder in a terminal tab
**I want to** have that working directory restored when I relaunch the app
**So that** I do not have to re-pick the folder every session.

**Acceptance criteria:**

- Given a terminal tab that is live on a working directory, when I quit and relaunch the app, then
  that tab reopens already live on the same working directory (no re-pick required).
- Given multiple terminal tabs each live on its own directory, when I relaunch, then each tab
  restores its own respective directory independently.
- Given a fresh tab that never had a directory picked, when I relaunch, then that tab restores to
  the "pick a folder" state (no directory), exactly as before.

### Open files restore within the working directory · P1

**As a** user who had several files open in the file-explorer viewer
**I want to** see the same files reopened in the same tab strip on relaunch
**So that** I resume reading/working without reopening each file by hand.

**Acceptance criteria:**

- Given a live tab with files A, B, C open in the viewer strip, when I quit and relaunch, then the
  same tab restores files A, B, C open in the same order.
- Given the same scenario, when I relaunch, then each restored open file's content is shown (its
  viewer body is re-read from disk), not a stale cached copy.
- Given a tab that had no files open, when I relaunch, then the tab restores live on its directory
  with an empty viewer strip and the "Select a file" placeholder.

### Focused/active file restores · P1

**As a** user who was viewing one particular file
**I want to** have that exact file focused/active on relaunch
**So that** I land back on what I was looking at.

**Acceptance criteria:**

- Given files A, B, C open with B active, when I relaunch, then B is the active/focused tab and its
  content fills the viewer body.
- Given the active file is restored, when I relaunch, then the file tree highlights that same active
  file (consistent with the live highlight behavior).

### Restore degrades safely · P1

**As a** user whose filesystem changed between sessions
**I want to** have cosmos restore what it can and quietly skip what it can't
**So that** a moved folder or deleted file never blocks or crashes the relaunch.

**Acceptance criteria:**

- Given a persisted working directory that no longer exists on relaunch, when the app starts, then
  that tab does not crash and falls back to a safe state (the "pick a folder" / not-live state for
  that tab), and other tabs are unaffected.
- Given a previously-open file that was deleted/moved/renamed, when the app restores, then that file
  shows the "no longer available" calm state (or is dropped), and the other open files restore
  normally; the active selection falls back safely if the active file vanished.
- Given a snapshot written by an older schema version, when the app starts, then the snapshot is
  treated as unreadable and the session falls back to a clean empty state — never a crash.

---

## Functional Requirements

| ID     | Requirement                                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The system MUST persist each terminal tab's working directory across app restarts. ("Working directory" = the directory a terminal tab is live on — the per-tab `cwd` the `claude` session is spawned/resumed in and the root the file explorer is scoped to.) |
| FR-002 | On relaunch, the system MUST restore each tab to its persisted working directory so the tab reopens already live on that directory without requiring the user to re-pick it.                                                  |
| FR-003 | The system MUST persist, scoped to a tab's working directory, the file-explorer's set of open files (the ordered open-files collection) and which one is the active/focused file.                                            |
| FR-004 | On relaunch, the system MUST restore the open-files set in its original order and the active/focused file for each tab, replacing the current behavior where open files are wiped on every go-live.                           |
| FR-005 | The system MUST re-read each restored open file's content from disk on restore (showing live content), rather than persisting and replaying file contents.                                                                   |
| FR-006 | The system MUST persist open files as the same non-secret, root-relative path identifiers the file explorer already uses; no absolute path, filesystem root, or token may be written into the snapshot.                      |
| FR-007 | If a persisted working directory no longer exists (or is no longer accessible) on relaunch, the system MUST NOT crash; the affected tab MUST fall back to its not-live / "pick a folder" state and other tabs MUST be unaffected. |
| FR-008 | If a previously-open file no longer exists (deleted/moved/renamed) on relaunch, the system MUST surface that file's "no longer available" calm state or drop it, without disturbing the other restored open files.           |
| FR-009 | If the persisted active file is missing on relaunch, the system MUST fall back to a safe active selection (an existing open file, or the empty "Select a file" placeholder when none remain).                                 |
| FR-010 | The empty cases MUST restore cleanly: a tab with no directory picked restores to the not-live state; a live tab with zero open files restores live with an empty viewer strip and the placeholder.                            |
| FR-011 | An older-schema or corrupt/invalid snapshot MUST be treated as unreadable at the main-process boundary and fall back to a clean empty session — warn-and-ignore, never crash, never overwrite a good file with garbage.       |
| FR-012 | A present-but-partial or malformed open-files / active-file value within an otherwise-valid snapshot MUST be normalized at the boundary to safe defaults (e.g. drop invalid entries, null out a missing active path) rather than rejected wholesale. |
| FR-013 | The persisted open-files / active-file state MUST be saved through the existing session-persistence save path (the debounced, flush-on-teardown coordinator) so the latest state survives a quit; this feature MUST NOT introduce a second competing persistence mechanism. |
| FR-014 | This feature's snapshot additions MUST be reconciled into a single coherent schema version with the concurrently-landing settings-redesign (#93) `enabled` change — one version bump, migrations composed in declared order, neither change clobbering the other's fields. |

## Edge Cases & Constraints

- **Working directory deleted/inaccessible on relaunch** → affected tab falls back to not-live
  ("pick a folder"); no crash; siblings unaffected (FR-007).
- **Open file deleted/moved/renamed** → that file restores to "no longer available" / is dropped;
  other open files unaffected; active selection falls back if it was the vanished file (FR-008/FR-009).
- **Empty states** → no-directory tab restores not-live; live tab with zero open files restores with
  the empty strip + placeholder (FR-010).
- **Multiple terminal tabs** → each tab's directory and open-files/active state persist and restore
  independently, keyed by the existing per-tab identity (FR-001/FR-003).
- **Older / corrupt / wrong-version snapshot** → warn-and-ignore at the main boundary → clean empty
  session; partial/malformed in-version values normalized to safe defaults (FR-011/FR-012).
- **No secret leakage** → confirm the plain-JSON snapshot carries only non-secret, root-relative
  identifiers — no absolute path, filesystem root, or token (FR-006). This is a constraint to
  re-verify, since the feature adds new fields to the snapshot.
- **Schema reconciliation with #93 (CRITICAL — see Technical Context)** — the open-files/working-dir
  snapshot extension and #93's `enabled` extension touch the same snapshot and must be merged into
  one version, not two clobbering bumps (FR-014).
- **Out of scope:** persisting file *contents* (restore re-reads from disk — FR-005); persisting tree
  expansion/scroll position, viewer scroll position, or editor selection within a file; persisting
  the file explorer for non-terminal (generative) panels; any change to the directory-picker UX or
  the resume-cwd policy itself (those already persist cwd); cross-tab or cross-machine sync.

## Technical Context & Risks

> Behavior-relevant context the plan must honor (no implementation prescription here).

- **The working-directory half is largely already in place.** Each terminal tab already persists its
  `cwd` in the session snapshot, and restored tabs already auto-resume in that stored directory
  (`resolvePaneSpawn` makes a resume reuse the snapshot cwd; fresh tabs defer to the picker). The
  spec still states FR-001/FR-002 as required behavior so the contract is complete, but the plan
  should treat the working-directory restore primarily as *verify-and-cover*, with the net-new work
  concentrated on the open-files/active-file state.
- **Open files are deliberately ephemeral today.** `useFileExplorer` resets the open-files collection
  to empty on every go-live and on app restart by design (terminal-file-tabs-v1 FR-007). This feature
  reverses that specific decision; the plan must update that decision (and the associated living-doc
  note) coherently rather than leaving a contradiction.
- **CRITICAL coordination — concurrent snapshot change (#93 Settings redesign).** A separate in-flight
  feature (#93) is concurrently extending the SAME session snapshot, adding a per-integration
  `enabled` boolean map with its own schema-version bump and migration. In the main tree this has
  already landed at `SESSION_SCHEMA_VERSION = 7`; a worktree copy is still at the pre-`enabled`
  shape. This feature ALSO extends the snapshot. The two snapshot changes MUST be reconciled:
  a single coherent schema version, migrations composed in order, and neither change dropping or
  overwriting the other's fields (FR-014). **Implementation of this feature MUST sequence after
  #93's snapshot change has landed** so it bumps from the post-#93 version and composes on top of the
  `enabled` migration — it must not race or fork the schema.
- **Validation boundary is the safety net.** All restore degradation (wrong version, missing dir,
  vanished file, malformed value) routes through the existing main-process `validateSnapshot`
  normalize-or-null discipline; the plan must extend that same boundary for the new fields rather than
  trusting renderer-side restore (FR-011/FR-012).

## Success Criteria

| ID     | Criterion                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | After quit + relaunch, every terminal tab that was live reopens live on the same working directory it had before, with no re-pick prompt. |
| SC-002 | After quit + relaunch, a tab's open-files strip shows the same files in the same order, with the same file active/focused, content re-read from disk. |
| SC-003 | A relaunch where a persisted directory no longer exists completes without crash; the affected tab is not-live and other tabs restore normally. |
| SC-004 | A relaunch where a previously-open file was deleted/moved shows that file's "no longer available" state (or it is dropped) while the remaining files restore; the active selection never points at a vanished file. |
| SC-005 | Empty states round-trip: a no-directory tab restores not-live; a live tab with zero open files restores with the empty strip + "Select a file" placeholder. |
| SC-006 | An older-version / corrupt snapshot falls back to a clean empty session (warn-and-ignore), and a malformed-but-in-version open-files value is normalized to safe defaults — verified, no crash. |
| SC-007 | The plain-JSON snapshot, after the new fields are added, contains only non-secret root-relative identifiers — no absolute path, filesystem root, or token (re-verified against FR-006). |
| SC-008 | The final schema carries BOTH the #93 `enabled` map and this feature's open-files/working-dir fields under one version, with migrations composed in order — neither feature's fields are lost when both snapshots are present. |

---

## Open Questions

- [ ] None blocking. The working-directory semantics, the open-files/active-file shape, the
      degradation policy, and the schema-reconciliation constraint are all inferable from the current
      codebase (`TerminalTabSnapshot.cwd`, `OpenFilesState`, `validateSnapshot`) and from the request.
      The one cross-feature dependency (sequence after #93's snapshot change lands) is captured as a
      hard constraint in Technical Context rather than an unresolved question.
