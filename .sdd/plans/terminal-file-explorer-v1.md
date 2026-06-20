# Plan: Terminal File Explorer — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/terminal-file-explorer-v1.md

---

## Grounding

> Same direct grounding as the spec (architect-owned). Key takeaways for the HOW:

- **codegraph_explore** (`TerminalPanel ... terminalSessionMap`, `PtyApi pty:start cwd ... ipc barrel`,
  `src/shared/ipc.ts barrel ... validate payload`) established: per-tab `paneId`; per-domain IPC
  barrels re-exported through `src/shared/ipc.ts`; main owns each pane's cwd in `terminalSessionMap`.
- **Reads** of `src/main/index.ts` (260–370, 660–773), `src/preload/index.ts`, `src/shared/ipc/pty.ts`,
  `docs/ARCHITECTURE.md` §4.1/§4.2/§4.11, `package.json`: `pty:pickDirectory` + optional `pty:start`
  `cwd` already exist; `terminalSessionMap.get(paneId).cwd` is the authoritative root; no `chokidar`
  installed (use `fs.watch`).
- **memory_recall/smart_search** (`terminal panel cwd directory picker path validation`, `terminal
  open directory picker awaiting phase`): no prior recorded decisions — nothing to reconcile.

**Revision grounding (2026-06-20, layout/Monaco/no-cap lock-in):**
- **codegraph_explore** `TerminalPanel terminal tabs panel system cwd working directory` → confirmed
  `TerminalPanel.tsx` (src/renderer) renders a per-tab `TerminalView` stack keyed by `paneId`, all
  tabs stay mounted, only the active is shown; the per-tab area is a plain flex column today (no split
  yet) — the right-pane explorer + viewer slot cleanly into each tab's `tabpanel` div. (Note: a stale
  `.claude/worktrees/agent-…/src/renderer/TerminalPanel.tsx` copy also matched; the canonical file is
  `src/renderer/TerminalPanel.tsx`.)
- **memory_recall** `terminal file explorer split Monaco viewer layout` → empty (no prior recorded
  decision); the layout/Monaco/no-cap decisions are now persisted via `memory_save`.
- **Grep** `docs/ARCHITECTURE.md` for §4.1/§4.2/Terminal File Explorer → no existing Terminal File
  Explorer section yet; §4.1 (PTY Manager) / §4.2 (Terminal Panel) / §4.11 (panel tabs) are the
  cross-link anchors and the place to record Monaco as a renderer dependency.

**Revision grounding (2026-06-20 rev 2, OQ-2 `fs.watch` + OQ-4 `cosmos-file://` protocol lock-in):**
- **Read** `src/main/confluenceImageProtocol.ts` + `src/main/confluenceImageRef.ts` (the precedent to
  mirror): confirmed the exact pattern — `registerSchemesAsPrivileged([{ scheme, privileges: {
  standard, secure, supportFetchAPI, stream } }])` at module load BEFORE `app.whenReady`;
  `protocol.handle(scheme, handler)` AFTER ready; the handler decodes a base64url ref, validates
  (SSRF), streams `net.fetch`, and returns a non-2xx `brokenImageResponse` on any failure (never
  throws). PURE codec/validator (`confluenceImageRef.ts`, no Electron, `.test.ts`-covered) is split
  from the thin Electron wiring (`confluenceImageProtocol.ts`). `cosmos-file://` follows the identical
  shape, except it resolves the root by `paneId` and reuses the explorer's `pathConfine` (local files,
  no token/gateway) rather than fetching a remote authed URL.
- The `cosmos-file://` + `fs.watch` decisions are persisted via `memory_save`.

## Summary

Add a VS Code-style 3-column layout inside each terminal tab: the existing terminal (LEFT), a read-only
file viewer (MIDDLE; text via a reused Monaco editor + image at any size), and an always-visible
read-only file-tree dock (RIGHT), with a resizable divider between each pair. Clicking a tree row
opens/retargets the middle viewer; the tree dock is never replaced. The explorer roots at the tab's MAIN-owned cwd
(`terminalSessionMap`), already established by `terminal-open-directory-picker-v1`. A new `fs:*` IPC
domain (list directory, read file, watch start/stop, watch-change event) lives in main; main owns a
per-`paneId` path sandbox and a per-`paneId` `fs.watch`. The load-bearing concern is **path
confinement** — main never trusts a renderer-supplied root: it looks up the tab's root by `paneId`,
canonicalizes (real-path) both root and target, and refuses any `..`, absolute, or symlink escape.
Pure confinement + tree/sort logic lives in node-testable `.ts` modules. The renderer gets one new
`window.cosmos.fs` surface. **Build constraint: the text viewer reuses Monaco (VS Code's editor) —
do NOT hand-roll a text/code viewer; Monaco needs explicit electron-vite renderer/worker wiring.**
This adds a new UI surface, so a **design step (`design` skill / designer)** is required after this
plan is approved and before interface/tests/implementation.

## Technical Context

| Item              | Value                                                                                      |
|-------------------|--------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer + preload)                                       |
| Key dependencies  | **ONE new renderer dependency: `monaco-editor` (VS Code's editor) for the read-only text/code viewer (FR-009) — reused, NOT hand-rolled.** Optionally `@monaco-editor/react` as a thin React loader wrapper (decide in D-6). Needs electron-vite/Vite renderer wiring (worker setup) — see D-6. Otherwise main uses Node `fs`/`fs.watch`/`fs.promises`/`path`; renderer reuses existing shadcn/ui + Tailwind + xterm.js. (Resizable split: prefer a small CSS/handle implementation or an already-present primitive; do NOT add a split-pane lib without designer/dev sign-off — see Decisions D-3.) |
| Files to create   | `src/shared/ipc/fs.ts` (channels/types); `src/main/fsExplorer.ts` (watcher manager + read/list orchestration, Electron-free where possible) + `src/main/fsExplorer.test.ts`; `src/main/pathConfine.ts` (pure confinement) + `src/main/pathConfine.test.ts`; `src/main/fileKind.ts` (binary/text/image classification — NO size cap) + `src/main/fileKind.test.ts`; `src/main/localFileRef.ts` (PURE `cosmos-file://` URL codec + path validator, no Electron — mirrors `confluenceImageRef.ts`) + `src/main/localFileRef.test.ts`; `src/main/localFileProtocol.ts` (thin Electron wiring: `registerLocalFileScheme` pre-ready + `installLocalFileProtocol`/`handleLocalFile` post-ready — mirrors `confluenceImageProtocol.ts`); `src/renderer/fileExplorer/` — `tree.ts` (pure build/sort/merge) + `tree.test.ts`, `FileExplorer.tsx`, `FileTree.tsx`, `FileViewer.tsx` (hosts the Monaco editor for text + `<img src="cosmos-file://...">` for images), `useFileExplorer.ts`, `index.ts` |
| Files to modify   | `src/shared/ipc.ts` (re-export the new `fs.ts` barrel); `src/shared/ipc/index` wiring as the barrel pattern requires; `src/shared/validate.ts` (or a `fs.validate.ts` sibling) for boundary validators; `src/preload/index.ts` (`fsApi` + `CosmosApi.fs`); `src/main/index.ts` (register `fs:*` handlers, wire watcher lifecycle to `terminalSessionMap`/dispose/teardown; call `registerLocalFileScheme()` at module load BEFORE `app.whenReady`, and `installLocalFileProtocol(getRoot)` after ready alongside the confluence/slack image protocols); `src/renderer/TerminalPanel.tsx` (host the split + viewer per tab); `electron.vite.config.ts` (Monaco worker/bundler wiring in the renderer config — D-6); `package.json`/`package-lock.json` (add `monaco-editor`); `docs/ARCHITECTURE.md` (new §4.x Terminal File Explorer + update §4.1/§4.2; record Monaco as a renderer dependency + the `cosmos-file://` privileged scheme alongside the existing image proxies); `docs/PROJECT-STRUCTURE.md` (new files); `docs/DEVELOPMENT.md` (fs-confinement + watcher-lifecycle gotcha, Monaco worker-wiring gotcha, `cosmos-file://` privileged-scheme gotcha, preload-restart note); `TODO.md` |

---

## New IPC channels & types (one typed contract)

All under a new `FsChannel` const in `src/shared/ipc/fs.ts`, re-exported through `src/shared/ipc.ts`.
Every R→M request carries the `paneId` so main resolves the root itself (FR-022) — the renderer never
sends a root/base path.

| Channel (proposed) | Dir | Kind | Payload → Result |
|--------------------|-----|------|------------------|
| `fs:list`          | R→M | invoke | `{ paneId, relPath }` → `{ ok: true, entries: FsEntry[] } \| { ok: false, reason }` |
| `fs:read`          | R→M | invoke | `{ paneId, relPath }` → `FsReadResult` (text \| `image` marker \| not-previewable + reason) — IMAGE BYTES do NOT ride this channel; on an image the renderer requests the `cosmos-file://` URL (D-4/FR-028) |
| `fs:watchStart`    | R→M | send | `{ paneId }` — begin watching that pane's root |
| `fs:watchStop`     | R→M | send | `{ paneId }` — release that pane's watcher |
| `fs:changed`       | M→R | on   | `{ paneId }` (coarse "something under your root changed; re-list") — debounced in main (FR-018) |

**Image delivery is OUT-OF-BAND via a privileged scheme, not an IPC channel (D-4/FR-028):** the
renderer sets `<img src="cosmos-file://file/<paneId>/<base64url(relPath)>">`; a `protocol.handle`
handler resolves the root by `paneId`, confines + real-paths the joined target, and streams the file
(broken image on any out-of-root/forged/missing case). No bytes cross the typed IPC contract.

- `FsEntry`: `{ name, kind: 'file' | 'dir', isSymlink: boolean }` — NO absolute path leaks to the
  renderer; the renderer addresses everything by `relPath` from the root. (Decision D-2.)
- `FsReadResult` (discriminated): `{ ok: true, kind: 'text', text }` | `{ ok: true, kind: 'image' }`
  (a marker only — the renderer then loads the `cosmos-file://` URL; no bytes/dataUrl on this channel)
  | `{ ok: false, reason: 'binary' | 'denied' | 'not-found' | 'out-of-root' }`.
  No `too-large` reason — there is no file-content size cap (spec FR-012, OQ-3 resolved).
- `relPath` is ALWAYS root-relative; main joins it onto the looked-up root then confines (FR-019/020/021).
- New `FsApi` on `CosmosApi`: `list(paneId, relPath)`, `read(paneId, relPath)`, `watchStart(paneId)`,
  `watchStop(paneId)`, `onChanged(listener) => unsubscribe`. (Plus a renderer-side `cosmos-file://`
  URL builder helper — pure string assembly, no preload method.)

## Key decisions (resolve OQs before coding)

- **D-1 (OQ-1) RESOLVED — 3-pane layout = terminal LEFT | file viewer MIDDLE | file tree dock RIGHT.**
  Three resizable columns. The file tree dock (far right) is ALWAYS visible (VS-Code-like) — it is never
  replaced by the viewer. Clicking a file opens/retargets the MIDDLE viewer column (Monaco text / image),
  which shows a calm "Select a file" placeholder when nothing is selected; there is NO Back affordance
  (the tree never went away). The terminal (left) `xterm` instance is never unmounted (PTY + scrollback
  survive) and is never overlaid. Two dividers (terminal|viewer, viewer|tree); any drag changing the
  terminal width re-fits it. (This SUPERSEDES the earlier "two panes, the right pane toggles tree↔viewer
  / viewer replaces the tree" draft — the rework split the tree and viewer into separate columns.)
  **Welcome-view gate:** BEFORE a folder is opened the tab shows ONLY a single centered welcome view
  (the VS-Code-style [Open a folder] CTA) — no split, no dividers, no tree dock, no viewer. The 3-pane
  split renders ONLY once a folder is open (`isFolderOpen(phase)` — a PURE predicate in `panelTabs.ts`,
  node-tested). Reuses the #75 directory-picker IPC; no new channel. The xterm container stays mounted
  (hidden) behind the welcome view so the live PTY attaches to the same element on go-live.
- **D-2 (OQ-2 RESOLVED + FR-022) Watch via Node `fs.watch` (no chokidar) + confinement in main;
  renderer addresses by `relPath`.** Use Node's built-in `fs.watch(root, { recursive: true })` —
  ZERO new dependency — with a re-list-on-event strategy: on any event, debounce then emit one coarse
  `fs:changed` `{ paneId }`; the renderer re-lists expanded directories (does not trust per-event
  granularity). The renderer NEVER sends an absolute path and main NEVER returns one. **Known
  limitation:** recursive `fs.watch` is unsupported on Linux — v1 targets macOS/Windows; a Linux
  fallback (e.g. `chokidar`) is a deferred, non-blocking follow-up (not v1 scope).
- **D-3 Resizable split implementation.** Prefer a minimal pointer-drag handle + CSS flex-basis (no
  new dependency), reusing existing UI primitives. The designer step owns the visual treatment; the
  developer wires the resize + terminal re-fit (FitAddon) on width change. Do not add a split-pane
  library unless designer+dev agree it is necessary.
- **D-4 (OQ-3 + OQ-4 RESOLVED) NO file-content size cap; images via a privileged `cosmos-file://`
  streaming protocol (NOT base64).** No byte cap on text or image (local files). Images are delivered
  out-of-band through a dedicated privileged scheme `cosmos-file://`, mirroring the existing
  `cosmos-confluence-img://` / `cosmos-slack-img://` proxies (precedent: `confluenceImageProtocol.ts`
  + `confluenceImageRef.ts`). Rationale: with no size cap (OQ-3) a stream avoids shipping a huge
  base64 string over IPC. Mechanics: `registerSchemesAsPrivileged` (`standard`+`secure`+
  `supportFetchAPI`+`stream`) BEFORE app-ready; `protocol.handle` AFTER ready. The handler decodes
  the URL → `{ paneId, relPath }`, resolves the root by `paneId` (D-5), reuses the SAME `pathConfine`
  (real-path, reject `..`/absolute/symlink escape) as `fs:read`, and streams the local file with the
  right content-type. It carries NO token (purely local files), and NEVER throws — any
  forged/out-of-root/missing case returns a non-2xx broken-image Response (mirrors
  `brokenImageResponse`). Codec/validator split (FR-027): pure `src/main/localFileRef.ts` (URL
  encode/decode + path validation, node-testable, no Electron) + thin `src/main/localFileProtocol.ts`
  (the Electron register/handle wiring).
- **D-5 Root source = `terminalSessionMap.get(paneId).cwd`.** Main already owns this. A `paneId`
  with no live session (awaiting-directory, disposed, or exited) → confinement lookup fails → list/
  read return a denied/empty result and no watcher is created (FR-006/FR-016).
- **D-6 (BUILD CONSTRAINT) Text/code viewer = reused Monaco editor, NOT hand-rolled (FR-009).** Adopt
  `monaco-editor` (VS Code's editor component) configured strictly read-only for the text viewer;
  syntax highlighting comes for free. **Monaco requires explicit electron-vite/Vite renderer wiring:**
  its language services run in Web Workers, so the renderer build must provide the worker entry points
  (e.g. via `vite-plugin-monaco-editor`, or manual `self.MonacoEnvironment.getWorker` setup, or
  importing the ESM worker URLs). In Electron the worker URLs/`base`/CSP must resolve under the
  packaged app, not just the dev server. The developer/main session does the install + config wiring
  (the designer has no Bash). If `monaco-editor` cannot be wired cleanly into the electron-vite
  renderer, the fallback is an equivalent VS Code open-source editor component (e.g. CodeMirror 6) —
  but the default and expectation is Monaco; do NOT fall back to a hand-rolled viewer. Decide whether
  to use `@monaco-editor/react` (loader wrapper) or `monaco-editor` directly during interface/design.

---

## Implementation Checklist

> Update as work progresses. Add inline notes when a step deviates.

### Phase 0 — Design (BEFORE interface; gated on this plan's approval)

- [x] This feature adds a new UI surface → run the **`design` skill (designer)**: layout is
      **3 columns — terminal LEFT | file viewer MIDDLE | file tree dock RIGHT** (the dock always
      visible); tree rows (file/dir/expander/symlink affordance), the two resizable dividers, the
      middle viewer (Monaco read-only text editor chrome + image + "preview not available"/"file no
      longer available"/"Select a file" placeholder states), how the viewer relates to the tree (own
      column, never replaces it — D-1, NOT a terminal overlay), empty/disabled awaiting-directory state. Output: `.sdd/designs/terminal-file-explorer-v1.md`. Use existing
      Tailwind tokens + shadcn/ui; the developer/main session does any shadcn CLI / Monaco install +
      worker wiring.

### Phase 1 — Interface (types & contract)

- [x] Read spec; ALL OQs resolved — OQ-1 layout terminal-left/explorer-right + in-pane viewer;
      OQ-2 Node `fs.watch` (no chokidar); OQ-3 NO size cap; OQ-4 `cosmos-file://` image protocol (no
      base64). Confirm D-6 (Monaco).
- [x] Create `src/shared/ipc/fs.ts`: `FsChannel` consts, `FsEntry`, `FsListResult`, `FsReadResult`
      (image variant is a marker only — no bytes), payload types, `FsApi`. Re-export through
      `src/shared/ipc.ts`; add `fs: FsApi` to `CosmosApi`.
- [x] Add boundary validators (in `src/shared/validate.ts` or a `fs.validate.ts` sibling) for each
      inbound payload: `paneId` non-empty string; `relPath` string; reject non-objects.
- [x] Review types vs spec — no invented properties; no absolute path in any renderer-facing type.

### Phase 2 — Testing (write tests first for the pure logic)

- [x] `pathConfine.test.ts`: in-root paths accepted; `..` traversal refused; absolute path refused;
      symlink-target-outside-root refused (real-path); symlinked ancestor refused; root itself
      accepted; canonicalization of both root and target.
- [x] `fileKind.test.ts`: text vs binary (NUL/non-UTF-8) classification; image extension mapping.
      NO size-cap test — there is no file-content size cap (FR-012). Assert a large file is still
      classified/read (not refused for size).
- [x] `fsExplorer.test.ts`: list sort order (dirs first, alpha, case-insensitive); denied entry does
      not abort sibling listing; watcher start/stop lifecycle bookkeeping (created on watchStart,
      released on watchStop, no double-watch per paneId); debounce coalesces a burst into one event.
- [x] `tree.test.ts` (renderer pure): build/merge a re-list into existing expanded state without
      losing expansion; deterministic ordering matches main; open-file path invalidation on delete.
- [x] `localFileRef.test.ts` (pure `cosmos-file://` codec/validator, mirrors `confluenceImageRef.test.ts`):
      encode→decode round-trip of `{ paneId, relPath }`; forged/malformed URL → null; `..` traversal,
      absolute path, backslash, control char, protocol-relative `//host`, wrong scheme/authority all
      rejected; a valid in-tree relPath accepted. (The real-path/symlink check is exercised in the
      `pathConfine` tests since the protocol reuses `pathConfine`.)
- [x] Boundary-validator tests: malformed/missing `paneId`/`relPath` → warn + ignore (no throw).

### Phase 3 — Implementation

- [x] `src/main/pathConfine.ts`: pure `confine(root, relPath) -> { ok, abs } | { ok:false, reason }`
      using `path.resolve` + `fs.realpathSync` on root and target; containment check on the canonical
      paths (FR-019/020/021). No Electron import.
- [x] `src/main/fileKind.ts`: pure classification only (text vs binary vs image, FR-011) — NO size
      cap (FR-012). No Electron import.
- [x] `src/main/fsExplorer.ts`: a manager keyed by `paneId` — `list`, `read`, `startWatch`,
      `stopWatch`, `stopAll`. Resolves root via an injected `getRoot(paneId)` (so it stays unit-
      testable and Electron-free); uses `pathConfine`/`fileKind`; `fs.watch({recursive:true})` +
      debounce; emits via an injected `onChanged(paneId)` sink.
- [x] `src/main/localFileRef.ts` (PURE, no Electron — mirrors `confluenceImageRef.ts`): the
      `cosmos-file://` codec + validator. `COSMOS_FILE_SCHEME = 'cosmos-file'`, fixed authority
      `'file'`; `encodeLocalFileRef(paneId, relPath)` → `cosmos-file://file/<paneId>/<base64url(relPath)>`;
      `decodeLocalFileRef(url)` → `{ paneId, relPath } | null`, rejecting forged/malformed input,
      `..` traversal, absolute path, backslash, control char, protocol-relative `//host`, wrong
      scheme/authority. Pure; never throws. (Containment against the real root is done by `pathConfine`
      in the protocol handler, not here.)
- [x] `src/main/localFileProtocol.ts` (thin Electron wiring — mirrors `confluenceImageProtocol.ts`):
      `registerLocalFileScheme()` calls `protocol.registerSchemesAsPrivileged` (`standard`+`secure`+
      `supportFetchAPI`+`stream`) — called at module load BEFORE `app.whenReady`. `handleLocalFile(getRoot)`
      returns the `protocol.handle` handler: `decodeLocalFileRef(url)` → resolve root via `getRoot(paneId)`
      → `pathConfine(root, relPath)` (real-path, reject `..`/absolute/symlink escape) → stream the file
      (`net.fetch` of a `file://` URL or a Node read-stream Response) with a content-type from the
      extension; any forged/out-of-root/missing/denied case → non-2xx broken-image Response (mirror
      `brokenImageResponse`). No token. Never throws. `installLocalFileProtocol(getRoot)` calls
      `protocol.handle` AFTER ready.
- [x] `src/main/index.ts`: instantiate the manager with `getRoot = (id) => terminalSessionMap.get(id)?.cwd`
      and `onChanged = (id) => mainWindow?.webContents.send(FsChannel.Changed, { paneId: id })`.
      Register `fs:list`/`fs:read` (`ipcMain.handle`) and `fs:watchStart`/`fs:watchStop` (`ipcMain.on`),
      each validated at the boundary. Call `registerLocalFileScheme()` at module load (BEFORE app-ready,
      next to the confluence/slack image-scheme registrations) and `installLocalFileProtocol(getRoot)`
      after ready (alongside `installConfluenceImageProtocol`), sharing the SAME `getRoot`. Release a
      pane's watcher in the existing `pty:dispose` handler (alongside `terminalSessionMap.delete`) and
      call `stopAll()` on window/app teardown (FR-016).
- [x] `src/preload/index.ts`: add `fsApi` (`list`/`read` via `invoke`, `watchStart`/`watchStop` via
      `send`, `onChanged` via `on`+unsubscribe) and `fs: fsApi` on `CosmosApi`. **Note in plan/docs:
      new `window.cosmos.fs.*` methods require a FULL `npm run dev` restart (HMR won't expose them).**
- [x] `src/renderer/fileExplorer/tree.ts`: pure tree state (nodes by relPath, expanded set, sort,
      merge-on-relist). No React import.
- [x] `src/renderer/fileExplorer/useFileExplorer.ts`: per-pane hook — calls `fs.list` on expand,
      subscribes to `fs.onChanged` (filtered by `paneId`) to re-list, calls `fs.read` on file click,
      tracks the open file + viewer state, invalidates on delete (FR-017). Issues `watchStart` when a
      root exists and `watchStop` on unmount/cwd-change.
- [x] **Monaco wiring (D-6, developer/main session — has Bash):** `npm install monaco-editor`
      (+ optional `@monaco-editor/react`); wire the renderer build in `electron.vite.config.ts` so
      Monaco's Web Workers load under both dev server and packaged Electron (e.g.
      `vite-plugin-monaco-editor` or a manual `self.MonacoEnvironment.getWorker`/worker-URL setup);
      verify worker URLs + CSP resolve in the built app, not just dev. If clean wiring is infeasible,
      escalate to the D-6 fallback (equivalent OSS editor) — do NOT hand-roll a viewer.
- [x] `src/renderer/fileExplorer/FileViewer.tsx`: text → reused **Monaco** editor instance,
      `readOnly: true`, language inferred from extension, value = `text`; image → `<img>` whose `src`
      is the `cosmos-file://file/<paneId>/<base64url(relPath)>` URL (built by a small renderer helper
      mirroring `confluenceCatalog/contentImageSrc.ts`), at natural size (no cap); plus not-previewable
      / not-found states. Mount/dispose the Monaco model per opened file. Note: the renderer CSP must
      allow `cosmos-file:` in `img-src` (add it alongside the existing `cosmos-confluence-img:` /
      `cosmos-slack-img:` entries). `FileTree.tsx` + `FileExplorer.tsx`: presentational,
      design-system-styled.
- [x] `src/renderer/TerminalPanel.tsx`: lay each per-tab area out as 3 resizable columns —
      the existing `TerminalView` (LEFT, kept mounted/live), the `FileViewer` MIDDLE column, and the
      always-visible `FileTree` dock (RIGHT). One `useFileExplorer` hook (via `useExplorerPanes`) backs
      both the viewer + the dock so a dock click retargets the viewer (D-1) — not a terminal overlay,
      no tree↔viewer toggle. Two `ResizeDivider`s (terminal|viewer, viewer|tree); re-fit the terminal
      (FitAddon) on any drag changing its width (D-3). Keep all tabs mounted (existing invariant).
      Gate the whole split on `isFolderOpen(phase)`: BEFORE a folder is open, render ONLY the welcome
      view (the [Open a folder] CTA, full width) — no split/dividers/dock; the split renders once live.
      [3-pane rework: was `FileExplorer` as a single RIGHT pane toggling tree↔viewer.]
- [x] All tests pass; reused `pathConfine`/`fileKind`/`tree` — no duplicated logic.

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md`: add a Terminal File Explorer component section (new §4.x) covering the
      split (terminal LEFT / explorer RIGHT), the `fs:*` contract, main-owned path confinement
      (real-path, `..`/absolute/symlink refusal, root from `terminalSessionMap`), watcher lifecycle
      (Node `fs.watch`, macOS/Windows; Linux recursive a known limitation), the in-right-pane viewer
      with NO file size cap, the **`cosmos-file://` privileged streaming scheme for images (alongside
      the existing `cosmos-confluence-img://` / `cosmos-slack-img://` proxies; shares `pathConfine`,
      no token)**, and **Monaco adopted as a renderer dependency for the read-only code viewer (first
      heavyweight renderer dep; needs electron-vite worker wiring)**; cross-link from §4.1/§4.2.
      (Architect updates this — it is the load-bearing new security boundary AND the first significant
      renderer dependency decision.) **DEVELOPER FLAG (2026-06-20): NOT done — architect-owned. The
      §4.x section is still owed: split layout, `fs:*` contract, main-side `pathConfine` real-path
      confinement, `fs.watch` lifecycle (Linux-recursive limitation), no-size-cap viewer, the new
      `cosmos-file://` privileged image scheme, and Monaco as the first heavyweight renderer dep.**
- [x] `docs/PROJECT-STRUCTURE.md`: list the new files.
- [x] `docs/DEVELOPMENT.md`: add the fs-confinement gotcha (always confine on canonical real-paths;
      never trust a renderer root; release watchers on dispose/teardown), the **Monaco worker-wiring
      gotcha** (workers must resolve under packaged Electron, not just dev; like the MCP-server rollup
      input, missing config silently breaks the viewer), the **`cosmos-file://` privileged-scheme
      gotcha** (register pre-app-ready or it silently won't be privileged; reuse `pathConfine` in the
      handler; add `cosmos-file:` to the renderer `img-src` CSP; codec/validator `.ts` split mirrors
      the confluence-img precedent), and the preload-restart note.
- [x] `TODO.md`: check off / add follow-ups (Linux-recursive watch via chokidar; search;
      write operations — all explicitly deferred). Note: syntax highlighting is NOW in scope (free via
      Monaco); image delivery uses the `cosmos-file://` protocol (no base64-over-IPC follow-up needed).
- [x] Update this plan with any deviations; `memory_save` the confinement decision.

---

## Risks & Constraints

- **Security is the headline risk.** A confinement bug exposes arbitrary local files to the renderer/
  embedded sandbox. Real-path canonicalization of BOTH root and target before containment is
  mandatory; symlink escape is the subtle case. This is a NET-NEW attack surface (the renderer could
  previously not read arbitrary files). Confinement is unit-tested (Phase 2) and re-asserted at the
  boundary (FR-023).
- **`fs.watch` portability** (spec OQ-2, RESOLVED — Node `fs.watch`, no chokidar): recursive is
  unsupported on Linux; v1 targets macOS/Windows. Re-list-on-event (not trusting event detail) keeps
  behavior correct where recursive works. Linux fallback (chokidar) is a deferred follow-up.
- **`cosmos-file://` privileged scheme** (spec OQ-4/FR-028, RESOLVED): the scheme MUST be registered
  pre-app-ready (else silently not privileged) and the handler MUST reuse `pathConfine` and never
  throw. Mis-registration or a missing `img-src` CSP entry breaks images silently. Mitigated by
  mirroring the proven confluence-img precedent (codec/validator split + broken-image fallback).
- **Monaco bundler/worker wiring (D-6) is a real risk.** Monaco is the first heavyweight renderer
  dependency; its Web Workers must be wired into the electron-vite renderer build and resolve under
  the PACKAGED app (worker URLs, `base`, CSP), not just the dev server. Mis-wiring fails silently at
  runtime (blank viewer / worker 404), analogous to the "MCP server needs a rollup input" gotcha.
  Budget time for this; the D-6 fallback (equivalent OSS editor) exists but Monaco is the default —
  hand-rolling a viewer is explicitly off the table.
- **No NEW split-pane dependency** unless the designer+developer agree the resizable split needs one
  (D-3). (Monaco is the one sanctioned new dependency, D-6.)
- **No file-content size cap (D-4/OQ-3):** acceptable because images stream over the `cosmos-file://`
  protocol (no huge base64 over IPC) and local reads have no fetch/memory-overhead concern.
- **Preload restart** (FR-026): the new `window.cosmos.fs` methods need a full `npm run dev` restart.

## Deviations & Notes

- **2026-06-20**: Initial plan. OQ-1..OQ-4 carried recommended resolutions (overlay viewer; Node
  `fs.watch`; 2 MiB cap; base64 image data URL).
- **2026-06-20 (rev)**: User decisions locked in. **OQ-1 RESOLVED:** layout is terminal LEFT /
  explorer RIGHT (reverses the earlier explorer-left draft); the viewer renders in the right pane
  like a normal IDE, NOT as a terminal overlay. **OQ-3 RESOLVED:** NO file-content size cap (local
  files). **D-6 ADDED:** the text/code viewer reuses Monaco (do NOT hand-roll); Monaco needs
  electron-vite renderer/worker wiring (new plan task + risk). Syntax highlighting moved IN scope
  (free via Monaco). OQ-2 (`fs.watch` recursive) and OQ-4 (image delivery) remain open for
  confirmation.
- **2026-06-20 (rev 2)**: Final two OQs resolved by the user. **OQ-2 RESOLVED:** Node's built-in
  `fs.watch` (zero dependency, re-list-on-event), no chokidar; Linux recursive is a known limitation
  / deferred follow-up (D-2 updated). **OQ-4 RESOLVED:** images delivered via a dedicated privileged
  streaming scheme `cosmos-file://` (NOT base64 data URLs), mirroring the `cosmos-confluence-img://` /
  `cosmos-slack-img://` proxies — register pre-app-ready + `protocol.handle` post-ready, reuse
  `pathConfine` to confine to the tab's cwd subtree, no token, never throw (D-4 updated; new files
  `localFileRef.ts` pure codec/validator + `localFileProtocol.ts` Electron wiring; FR-028 added).
  **ALL open questions are now resolved — the plan is ready for the design step (Phase 0).**
- **2026-06-20 (impl, developer)**: Phases 1–3 implemented; `npm run typecheck` exit 0, `npm test`
  90 files / 1585 tests pass, `npm run build` succeeds (worker chunk `editor.worker-*.js` emitted).
  Deviations from the checklist's letter:
  - **D-6 Monaco wiring — no `electron.vite.config.ts` change needed.** Vite (electron-vite renderer)
    bundles a `?worker` import as a real worker chunk for BOTH dev and packaged builds, so
    `monacoSetup.ts` imports `monaco-editor/esm/vs/editor/editor.worker?worker` + sets
    `self.MonacoEnvironment.getWorker` directly — no `vite-plugin-monaco-editor`. Base editor worker
    ONLY (read-only highlighting uses main-thread monarch tokenizers; ts/json/css/html LANGUAGE
    workers are not needed). Used bare `monaco-editor` (NO `@monaco-editor/react`). KNOWN COST: the
    barrel pulls every language tokenizer + the ts/json/css/html modes into the bundle (~9MB main +
    ~15MB unused language workers). Acceptable for a desktop app; the slim `editor.api` subpath fights
    tsc's Bundler resolution (no `exports`-mapped types). Flagged in `monacoSetup.ts` ponytail comment
    + TODO follow-up; trim only if size becomes a real problem. Added `src/renderer/vite-env.d.ts`
    (`/// <reference types="vite/client" />`) so the `?worker` import typechecks under tsconfig.web.
  - **Divider** is a bespoke `role="separator"` composite (`ResizeDivider.tsx`) — pointer drag +
    Left/Right (Shift = coarse) keyboard, clamped in `TerminalPanel` to the §1.2 mins (terminal 320px /
    explorer 256px); re-fits the xterm via the existing `safeFit()`+`pty.resize` path (exposed through
    a `pushResizeRef`). No split-pane lib, no `components/ui/resizable.tsx` (one consumer; design D-3).
  - **Split ratio** is renderer-local (terminal flex-basis; default 60%), NOT persisted to the session
    snapshot (no FR asks; design §1.2). Resets to 60/40 on reopen.
  - Fixed 4 pre-existing typecheck breaks in main test files (unused `@ts-expect-error` directives now
    that `extensionOf`/`decodeLocalFileRef`/`confine` type their guard params `unknown`; unused `sep`
    import) — unrelated to the renderer work but blocking `typecheck:node`.
- **2026-06-20 (3-pane rework, developer)**: Reworked the just-shipped layout to a VS-Code-like THREE
  columns — terminal LEFT | file viewer MIDDLE | file tree dock RIGHT — per user request. The file tree
  is now a PERSISTENT right-side dock that is ALWAYS visible (it is no longer replaced by the viewer);
  clicking a file opens/retargets the middle viewer column. Renderer-layout only — NO change to the
  `fs:*` IPC contract or the `cosmos-file://` protocol. Changes:
  - Extracted the viewer-state transitions into a PURE `src/renderer/fileExplorer/viewerState.ts`
    (`selectFile`/`resolveRead`/`invalidateOpen`/`openRelPath`/`baseName`) so the new "open/retarget,
    no back-to-tree" contract is node-tested (`viewerState.test.ts`, 9 cases). `useFileExplorer.ts` now
    consumes it and DROPPED `closeViewer` (no tree↔viewer toggle anymore); `openFile` opens OR retargets.
  - `FileViewer.tsx`: removed the Back button + Esc/Backspace-to-tree handler; added the calm "Select a
    file" placeholder for the `null` (no-file) state. `FileExplorer.tsx` now exports a `useExplorerPanes`
    hook returning the ready-to-place `viewer` + `tree` column elements (ONE shared hook instance); the
    open file's row renders selected in the dock.
  - `TerminalPanel.tsx`: two `ResizeDivider`s with distinct aria-labels; `termWidth` + `treeWidth`
    controlled flex-bases, the viewer as `flex 1 1 0`. Clamps: terminal ≥320px, tree dock ≥256px, viewer
    ≥240px. Both dividers re-fit the xterm on drag (divider A changes the terminal width; divider B is
    re-fit too, cheap + idempotent). Default ratios ~50/25/25.
  - **No-file-selected choice:** the middle viewer column is ALWAYS reserved (never collapsed), showing
    the placeholder — simpler than a collapse/expand and reads as intentional dark chrome (`ponytail:`
    comment in `TerminalPanel.tsx`). `ResizeDivider` gained an optional `ariaLabel` prop.
  - `npm run typecheck` exit 0; all 33 `fileExplorer` tests pass (incl. the new `viewerState` suite).
    Pre-existing Slack-integration test failures in the working tree are unrelated to this rework.
- **2026-06-20 (welcome-view gate, developer)**: Added on top of the 3-pane rework: BEFORE a folder is
  opened, the tab renders ONLY a single centered VS-Code-style welcome view (the [Open a folder] CTA) —
  no split, no dividers, no tree dock, no viewer. The 3-pane split renders ONLY once a folder is open.
  - Added a PURE node-tested predicate `isFolderOpen(phase)` + the `TerminalPhase` type to
    `panelTabs.ts` (covered in `panelTabs.test.ts`); `TerminalView` gates the split chrome on it.
  - `TerminalPanel.tsx`: the terminal column is full-width while awaiting (the welcome view fills it),
    then a controlled flex-basis once live; the dividers + viewer + tree-dock are rendered ONLY when
    live (`live ? <>…</> : null`). The xterm container stays mounted (hidden) throughout so the
    mount-once effect's `containerRef` invariant holds. Reuses the existing #75 directory-picker IPC
    (`pty.pickDirectory` + `pty.start({ cwd })`) — no new channel.
  - `npm run typecheck` exit 0; `panelTabs` + `fileExplorer` suites green.
