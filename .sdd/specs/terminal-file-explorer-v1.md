# Spec: Terminal File Explorer — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/terminal-file-explorer-v1.md

---

## Grounding

> Direct grounding I ran for this spec (architect-owned; mandatory).

**codegraph_explore**
- `TerminalPanel terminal pty cwd terminalSessionMap session awaiting phase folder selection` →
  `TerminalPanel.tsx` hosts a per-tab `TerminalView` stack; tabs minted by renderer, `paneId` keys
  each. Fresh tabs defer spawn until a directory is picked (`autoStart`/`restoredTabIdsRef`).
- `PtyApi pty:start cwd directory picker openDirectory ptyManager.start main index.ts ipc barrel` →
  `src/shared/ipc/pty.ts` is the `pty:*` barrel; `pty:start` already carries an OPTIONAL `cwd`;
  `pty:pickDirectory` opens the native OS picker in main only.
- `src/shared/ipc.ts ipc channel barrel cosmos preload window.cosmos bridge invoke validate payload`
  → IPC is split into per-domain barrels re-exported through `src/shared/ipc.ts`; `CosmosApi` groups
  `pty/ui/slack/jira/confluence/googleCalendar/agent/shortcuts/session/settings`; every R→M payload
  validated at the main boundary (warn + ignore on invalid).

**Reads (verbatim source already in-context, not re-Read)**
- `src/main/index.ts` 260–370, 660–773 → `terminalSessionMap: Map<paneId,{sessionId,cwd}>` is the
  MAIN-owned source of truth for each pane's cwd (set on every `pty:start`, deleted on dispose);
  `resolveSandboxDir()`; `pty:pickDirectory` handler (`dialog.showOpenDialog`).
- `src/preload/index.ts` → `ptyApi.start(paneId, {cwd})`, `ptyApi.pickDirectory()`.
- `docs/ARCHITECTURE.md` §4.1/§4.2/§4.11 → PTY manager, Terminal panel, panel-tabs semantics; the
  embedded `claude` runs in an isolated **sandbox cwd**, but a user-picked tab cwd can be ANY local
  directory the user chose.
- `package.json` → no `chokidar`; Node `fs.watch` is the zero-dependency option for MVP.

**memory_recall / memory_smart_search**
- `terminal panel cwd directory picker path validation IPC channel security` → no results.
- `terminal open directory picker awaiting phase cwd per-tab session` → no results. (No prior
  recorded decision on a file explorer; the directory-picker decisions are encoded only in
  `pty.ts`/ARCHITECTURE §4.1, which I grounded on directly above.)

---

## Overview

Give each terminal tab a VS Code-style split: the **existing terminal on the left** and a
**read-only file explorer tree on the right**, resizable. The tree is rooted at that tab's chosen
working directory (the same cwd its `claude` session runs in). Clicking a file opens its contents in
a **read-only viewer** (text + image), the way a normal IDE opens a file. The tree stays current
automatically as files are created, deleted, or renamed on disk. This is a read-only navigation +
preview aid; it never modifies the filesystem.

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### Browse the working directory beside the terminal · P1

**As a** developer using the embedded Claude Code terminal
**I want to** see the file tree of the terminal's working directory next to the terminal
**So that** I can navigate the project the agent is operating on without leaving the app

**Acceptance criteria:**
- Given a terminal tab with NO folder opened yet, when I view that tab, then it shows ONLY a single
  centered welcome view with an "Open a folder" affordance (VS-Code welcome style) — no terminal split,
  no tree dock, no viewer.
- Given that welcome view, when I open a folder (the existing directory-picker flow), then the tab
  switches to the three-column split rooted at that folder.
- Given a terminal tab whose working directory is chosen, when I view that tab, then it shows three
  columns left→right: the terminal, a file viewer, and a file tree dock rooted at that directory. The
  file tree dock (far right) is ALWAYS visible (VS-Code-like) — it is never replaced by the viewer.
- Given a directory node in the tree, when I click it, then it expands to reveal its children
  (and collapses on a second click).
- Given the columns, when I drag either divider (terminal|viewer or viewer|tree), then the columns
  resize and — for any drag that changes the terminal's width — the terminal re-fits to its new width
  without losing its session or scrollback.

### Open a file like a normal IDE · P1

**As a** developer browsing the tree
**I want to** click a file and see its contents
**So that** I can read code/config/notes without switching to another editor

**Acceptance criteria:**
- Given a text file in the tree, when I click it, then its contents render in a read-only viewer (the
  MIDDLE column) with the file name shown, while the tree dock stays visible.
- Given an image file (png/jpg/jpeg/gif/webp/svg/bmp/ico), when I click it, then the image renders
  in the viewer.
- Given a file that is binary, too large, or otherwise not previewable, when I click it, then the
  viewer shows a clear "preview not available" state (with the reason) rather than garbage or a crash.
- Given no file is selected yet, when I view the tab, then the middle viewer column shows a calm
  "Select a file" placeholder.
- Given a file is open in the viewer, when I click another file, then the middle viewer retargets to
  the newly clicked file (the tree dock never goes away, so there is no "back to tree" step).

### The tree stays current automatically · P1

**As a** developer whose terminal (or the agent) is creating/removing files
**I want to** the tree to reflect those changes without a manual refresh
**So that** what I see matches the real filesystem

**Acceptance criteria:**
- Given the explorer is showing a directory, when a file/folder is created, deleted, or renamed
  under the root, then the tree updates to reflect it automatically (no user action).
- Given a file currently open in the viewer is deleted on disk, when the change is observed, then
  the viewer shows a "file no longer available" state instead of stale content.

### A tab without a chosen directory has no explorer · P1

**As a** developer who just opened a new terminal tab
**I want to** the explorer to stay empty/disabled until I pick a directory
**So that** the layout matches the tab's lifecycle and roots on a real directory

**Acceptance criteria:**
- Given a freshly-opened terminal tab in its awaiting-directory state (showing `[Open]`), when I
  view it, then the explorer columns (viewer + tree dock) are empty/disabled (no tree, no root) and the
  left column shows the existing open-directory affordance.
- Given that tab, when I pick a directory and its session spawns, then the explorer populates rooted
  at the chosen directory.

### Confined to the chosen root · P1 (security)

**As a** the security boundary of the app
**I want to** every filesystem read/list/watch restricted to inside the tab's chosen root
**So that** the renderer can never read or watch files outside the directory the user chose

**Acceptance criteria:**
- Given a list/read/watch request, when the resolved target escapes the tab's root via `..`,
  an absolute path, or a symlink pointing outside the root, then main refuses it (returns nothing /
  a denied result) and does not read the out-of-root file.
- Given any malformed or out-of-root request, when main validates it at the boundary, then it warns
  and ignores rather than crashing.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Layout & tree

| ID     | Requirement                                                                                          |
|--------|------------------------------------------------------------------------------------------------------|
| FR-001 | A terminal tab with NO folder opened MUST present ONLY a single centered welcome view containing an "Open a folder" affordance (VS-Code welcome style) — no split, no tree dock, no viewer. Once a folder is opened, the tab MUST present three horizontal columns left→right within that tab's panel area: the existing terminal (left), a file viewer (middle), and a file tree dock (right). The file tree dock MUST be ALWAYS visible while the tab is live (it is never replaced by the viewer). If the folder is later cleared (only if such a path exists), the tab MUST return to the welcome view. |
| FR-002 | Each column divider (terminal\|viewer and viewer\|tree) MUST be draggable to resize the adjacent columns, clamped to per-column minimums; for any drag that changes the terminal's width, the terminal MUST re-fit to its new width without losing its PTY session or scrollback. |
| FR-003 | The explorer MUST be rooted at the working directory of that tab's `claude` session (its per-tab cwd), and MUST be per-tab (each tab roots at its own directory). |
| FR-004 | The explorer MUST render a tree of the root's entries; directory nodes MUST be expandable/collapsible, lazily listing children on first expand. |
| FR-005 | The explorer tree MUST distinguish files from directories and show each entry's name; it MUST sort entries deterministically (directories first, then files, each alphabetical, case-insensitive). |
| FR-006 | For a terminal tab in its awaiting-directory state (no chosen cwd yet), the explorer columns (viewer + tree dock) MUST be empty/disabled — no tree and no list/watch requests — and MUST populate once a directory is chosen and the session spawns. |
| FR-007 | The explorer and viewer MUST be read-only: the feature MUST NOT create, rename, move, delete, or write any file. (Out of scope for v1: any write operation.) |

### Viewer

| ID     | Requirement                                                                                          |
|--------|------------------------------------------------------------------------------------------------------|
| FR-008 | Clicking a file in the tree MUST open its contents in a read-only viewer (the middle column) that shows the file name; clicking another file MUST retarget that same viewer to the newly clicked file, behaving like a normal IDE file open. The tree dock stays visible throughout (no "back to tree" affordance). |
| FR-009 | The viewer MUST render UTF-8 text files as read-only text in an embedded code-editor component (preserving whitespace; horizontal/vertical scroll, line numbers). The viewer component MUST be a reused existing editor package (Monaco — VS Code's editor — or an equivalent VS Code open-source component), NOT a hand-rolled text renderer (see Edge Cases / plan). |
| FR-010 | The viewer MUST render images of the supported types (png, jpg, jpeg, gif, webp, svg, bmp, ico) as an image. There is NO image size limit — the file is local, so the viewer MUST display it at any size (no byte cap on images). Images MUST be delivered to the renderer via a dedicated privileged streaming protocol (`cosmos-file://`, mirroring the existing `cosmos-confluence-img://` / `cosmos-slack-img://` proxies), NOT as a base64 `data:` URL, so a large local image streams rather than shipping a huge string over IPC. The protocol MUST path-validate (SSRF-confine) the requested local path to the requesting tab's cwd subtree — it MUST NOT serve arbitrary filesystem reads — and needs no token (purely local files). |
| FR-011 | The viewer MUST show a clear "preview not available" state — never raw bytes — when a file is (a) detected as binary/non-text and not a supported image, or (b) unreadable due to OS permissions. The state SHOULD state the reason. |
| FR-012 | The viewer MUST NOT impose a maximum previewable file size: everything runs locally, so no fetch/memory-overhead byte cap is specified for text or image files. (A directory MAY still bound a single directory's entry count per FR-005/Edge Cases to protect the renderer; that is not a file-content size cap.) |
| FR-013 | The viewer MUST render within the tab's MIDDLE column (between the terminal and the tree dock), the way a normal IDE shows an opened file beside its file tree — not over the terminal. The terminal (left column) MUST remain mounted and live (PTY + scrollback) while a file is open; opening/retargeting a file MUST NOT unmount or resize away the terminal session. |

### Live updates (fs watch)

| ID     | Requirement                                                                                          |
|--------|------------------------------------------------------------------------------------------------------|
| FR-014 | The tree MUST update automatically (no user action) when files/folders are created, deleted, or renamed under the root. |
| FR-015 | Filesystem watching MUST run in the MAIN process; the renderer MUST receive change notifications only as validated IPC events, never by watching the filesystem itself. |
| FR-016 | A watcher MUST be scoped to a single tab's root and MUST be released when that tab is disposed, when the tab's cwd changes, and on app teardown. There MUST be no watcher leak across tab close or window teardown. |
| FR-017 | If a file currently open in the viewer is deleted (observed via watch or on a re-read), the viewer MUST show a "file no longer available" state rather than stale content. |
| FR-018 | The watch→refresh path SHOULD coalesce bursts (debounce) so a flood of filesystem events does not flood IPC or thrash the tree. |
| FR-018a | Filesystem watching MUST use Node's built-in `fs.watch` (zero new dependency) with a re-list-on-event strategy (the renderer re-lists affected directories on a change event rather than trusting per-event granularity). v1 targets macOS/Windows; recursive `fs.watch` is a known limitation on Linux (tracked as a non-blocking follow-up, not in v1 scope). |

### Security — path confinement (first-class)

| ID     | Requirement                                                                                          |
|--------|------------------------------------------------------------------------------------------------------|
| FR-019 | Every directory-list, file-read, and watch request MUST be confined to inside the tab's root: main MUST resolve the requested path and verify it lies within the root, and MUST refuse anything that escapes the root. |
| FR-020 | Confinement MUST reject path traversal (`..` segments) and absolute-path escapes, evaluated AFTER normalization, so an encoded or layered traversal cannot escape. |
| FR-021 | Confinement MUST reject **symlink escape**: a symlink (or a path through a symlinked ancestor) whose real on-disk target resolves outside the root MUST be refused. Resolution MUST use the real (canonical) path of both the root and the target before the containment check. |
| FR-022 | The root itself MUST be the per-tab cwd that main already owns (`terminalSessionMap`), supplied by main — the renderer MUST NOT be trusted to assert an arbitrary root; a request MUST identify its tab (`paneId`) and main MUST look up that tab's root, not accept a root string from the renderer. |
| FR-023 | Every cross-process payload for these channels MUST be validated at the main boundary; an invalid/out-of-root/malformed payload MUST be warned and ignored (or returned as a denied result), and MUST NEVER crash the app and MUST NEVER read an out-of-root file. |
| FR-024 | No token or secret may cross these channels (consistent with the app-wide rule); file contents are the user's own local files inside the chosen root and ride only the typed, validated boundary. |

### Contract & build

| ID     | Requirement                                                                                          |
|--------|------------------------------------------------------------------------------------------------------|
| FR-025 | All new channels MUST be declared in the one typed IPC contract (`src/shared/ipc.ts` via a new per-domain barrel, e.g. `fs.ts`); no ad-hoc channel strings. New channels: list directory, read file, start watch, stop watch, and a watch-change event. |
| FR-026 | New `window.cosmos.*` methods MUST be added through the preload bridge; the plan MUST note that adding them requires a full `npm run dev` restart (not HMR). |
| FR-027 | Path-confinement and tree-building logic MUST live in node-testable `.ts` modules (no Electron/React imports), separate from `.tsx`, so they are unit-tested directly. The `cosmos-file://` URL codec + path validator (FR-028) MUST follow the SAME split: a pure node-testable `.ts` codec/validator, with the privileged-scheme registration + `protocol.handle` wiring in a thin separate Electron module (mirroring `confluenceImageRef.ts` / `confluenceImageProtocol.ts`). |
| FR-028 | Image delivery MUST use a dedicated privileged streaming scheme `cosmos-file://` (FR-010): registered as privileged BEFORE app-ready (`registerSchemesAsPrivileged`) and handled AFTER ready (`protocol.handle`). The handler MUST resolve the requesting tab's root by `paneId` and reuse the SAME path confinement as the read channel (real-path canonicalization; reject `..`/absolute/symlink escape; out-of-root → broken image, never an arbitrary read), MUST carry no token, and MUST never throw (any failure becomes a non-2xx/broken-image Response, never a main crash). |

## Edge Cases & Constraints

- **Symlink escape** (FR-021): a symlink inside the root pointing outside it is refused on both list
  and read; a symlinked directory whose real path is outside the root is not traversed.
- **Path traversal / absolute escape** (FR-020): `../../etc/passwd`, an absolute `/etc/passwd`, or a
  child path that normalizes above the root are all refused.
- **Awaiting-directory tab** (FR-006): no root, so no tree, no watcher, no list/read — explorer is
  empty/disabled.
- **Binary file**: detected (e.g. NUL byte / non-UTF-8) and not a supported image →
  "preview not available (binary)".
- **No file-content size cap** (FR-012): text and image files are read and displayed at any size;
  the feature does NOT refuse a file for being large (local files, no fetch/memory-overhead concern).
- **Permission denied**: a file/dir the OS refuses to read → that entry/read yields a graceful
  denied state, never a crash; sibling entries still list.
- **File deleted while open** (FR-017): viewer shows "file no longer available".
- **Broken/dangling symlink**: listed as an entry but a read/expand yields a graceful unavailable
  state, not a crash.
- **Root deleted or becomes inaccessible**: explorer shows an empty/"directory unavailable" state;
  the terminal pane is unaffected.
- **Very large directory**: listing is bounded/lazy per directory (children listed on expand); the
  plan SHOULD cap or virtualize an extreme single-directory entry count to protect the renderer.
- **Reused editor component (build constraint)**: the text viewer MUST reuse an existing editor
  package (Monaco — VS Code's editor — or an equivalent VS Code open-source component) rather than a
  hand-rolled text renderer (FR-009). Syntax highlighting comes for free from Monaco and is therefore
  IN scope (no extra build cost); the editor is configured strictly read-only.
- **Out of scope (v1)**: any write/create/rename/delete/move; multi-root or arbitrary-root browsing
  (root is always the tab's cwd); file search/grep; opening files in an external editor; diffing;
  git status decoration.

## Success Criteria

| ID     | Criterion                                                                                          |
|--------|----------------------------------------------------------------------------------------------------|
| SC-001 | Opening a terminal tab with a chosen directory shows the terminal on the left and the explorer rooted at that directory on the right, resizable. |
| SC-002 | Clicking a text file shows its text in the reused (Monaco/equivalent) read-only editor; clicking a supported image shows the image at full size (no size cap); clicking a binary/unreadable file shows "preview not available" — never raw bytes, never a crash. |
| SC-003 | Creating/deleting/renaming a file under the root updates the tree automatically within a small delay, with no user action. |
| SC-004 | A request whose resolved path escapes the root via `..`, an absolute path, or a symlink is refused: no out-of-root file is ever read or listed, and the app does not crash. |
| SC-005 | Every malformed or out-of-root IPC payload is warned and ignored at the main boundary; the app never crashes on bad input. |
| SC-006 | Closing a terminal tab (or quitting the app) releases that tab's watcher — no watcher leak. |
| SC-007 | An awaiting-directory tab shows no tree and issues no list/read/watch; it populates only after a directory is chosen. |
| SC-008 | Path-confinement and tree/sort logic are covered by `.ts` unit tests (traversal, absolute escape, symlink escape, root containment, sort order) with no Electron/React imports. |

---

## Open Questions

- [x] **OQ-1 — Layout & where the opened file renders. RESOLVED (user).** The split is
      **terminal LEFT, file explorer RIGHT**, resizable (FR-001). The opened file renders in the
      right (explorer) pane area like a normal IDE shows a file beside its tree (FR-013); the terminal
      (left) stays mounted and live. (This REVERSES the earlier draft, which placed the explorer on
      the left with the viewer as an overlay over the terminal.)
- [x] **OQ-3 — File-content size cap. RESOLVED (user): NO size limit.** Files are local, so there is
      no fetch/memory-overhead concern; the viewer displays text and images at any size with no byte
      cap (FR-010/FR-012). The earlier proposed 2 MiB cap is dropped.
- [x] **OQ-2 — fs watch mechanism. RESOLVED (user): Node's built-in `fs.watch`, no chokidar.** Use
      `fs.watch` (zero new dependency) with a re-list-on-event strategy (re-list affected directories
      on a change rather than trusting per-event granularity), debounced (FR-018/FR-018a). v1 targets
      macOS/Windows; recursive `fs.watch` on Linux is a known limitation tracked as a non-blocking
      follow-up, not a v1 blocker.
- [x] **OQ-4 — Image delivery. RESOLVED (user): dedicated privileged streaming protocol
      `cosmos-file://`, NOT base64 data URLs.** Mirrors the existing `cosmos-confluence-img://` /
      `cosmos-slack-img://` proxies (FR-010/FR-028): register the privileged scheme pre-app-ready, add
      a `protocol.handle` handler post-ready that SSRF/path-validates the requested local path
      (confined to the tab's cwd subtree — no arbitrary reads) and streams the file; no token needed
      (purely local files). Rationale: with no size cap (OQ-3) a stream avoids shipping huge base64
      over IPC. Codec/validator split mirrors `confluenceImageRef.ts` (pure) + `confluenceImageProtocol.ts`
      (thin Electron wiring), per FR-027.

> **All open questions resolved.** OQ-1/OQ-3 (prior revision) and OQ-2/OQ-4 (this revision) are
> closed; no open question remains. The plan is ready for the design step.
