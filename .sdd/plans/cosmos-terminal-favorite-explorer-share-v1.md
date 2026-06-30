# Plan: Share the File Explorer in a Terminal Favorite (model-share) — v1

**Status**: Draft
**Created**: 2026-06-30
**Last updated**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-terminal-favorite-explorer-share-v1.md`

---

## Grounding

> Direct investigation for this plan (the LLM-wiki `wiki_*` tools are NOT in this session's toolset —
> grounding is codegraph + in-repo source, flagged so the gap is visible).

**codegraph_explore queries run (one-line takeaways):**

- `useExplorerPanes useFileExplorer FileViewer Monaco ITextModel open files active file cosmos-file URI viewer state`
  → `useFileExplorer(paneId, enabled, restoredOpenFiles?, onOpenFilesChange?)` holds the open-files collection as **per-mount `useState<OpenFilesState>`**, plus the tree, root-error and watch lifecycle; `useExplorerPanes` wraps it and returns the ready `viewer`/`tree` elements + `openFileCount`/`closeActiveFile`/`navFileTab`. The viewer is **read-only**.
- `MonacoText editor.create createModel ITextModel getModel setModel onDidFocusEditorText`
  → `MonacoText` creates ONE `monaco.editor.create(container, { value: text, readOnly… })` per viewer column and does `model.setValue(text)` + `setModelLanguage` in place on file-switch — i.e. ONE model per column reused by `setValue`, NOT a model per file. This is the exact spot the model registry replaces.
- `openFiles.ts OpenFilesState openOrFocus setActiveFile closeFile updateOpenFile activeViewer adjacentActiveId`
  → the pure, node-tested collection module: `openOrFocus`/`setActiveFile`/`closeFile` (re-picks active via shared `adjacentActiveId`)/`updateOpenFile` (patch one file's resolved `ViewerState`)/`seedOnGoLive`/`activeViewer`. **All transitions are pure and reused verbatim** — the lift only changes WHERE the `OpenFilesState` lives.
- `PanelTabsProvider usePublishPanelTabs useAllPanelTabs LivePanelTab registry version`
  → the App-root cross-panel registry = `registryRef` (a ref) + a `version` counter; `publish` swaps the ref + bumps version; consumers `useMemo(() => registryRef.current, [version])`. **This is the exact provider shape to model the new shared open-files store on.** Confirms the base feature is LANDED/landing: `LivePanelTab.serialize?: () => string` already exists, and `src/renderer/cosmos/TerminalFavoriteSurface.tsx` (+ `.dom.test.tsx`) is already a caller of `useAllPanelTabs`.

**Conclusion:** This is **wholly renderer** — NO main/IPC/preload/schema change. The only shared
boundary already in place (`SessionSnapshot.favorites = {panelId,tabId,label}`) is untouched. The work
is: a new App-root **shared open-files store**, a new **Monaco model registry**, a `mirror` gate on the
explorer hooks, and re-enabling the explorer split in `TerminalView` mirror mode.

---

## Summary

Make a terminal favorite mirror the FULL Terminal view (terminal pane + file-explorer split) by
**sharing the data instance and rendering two views** — exactly as Monaco is designed. Two pieces of
state are lifted out of the per-mount `useFileExplorer` into App-root shared stores both the source
explorer and the favorite explorer read: (1) the **open-files selection** (ordered files + active
relPath + each file's resolved `ViewerState`) into a paneId-keyed `OpenFilesProvider` (modeled on
`PanelTabsProvider`); (2) each open TEXT file's **Monaco `ITextModel`** into a `monacoModelRegistry`
keyed by a `cosmos-file://<paneId>/<relPath>` URI, ref-counted so closing one view never disposes a
model the other still renders. `MonacoText` switches from "one editor, `setValue` per file" to "one
shared model per file, `setModel` per view" — so content + language stay identical and live across
both views while cursor/scroll stay per-view (Monaco view state lives on the editor, not the model).
The **source explorer remains the single fs owner** (`fs:read` resolution + `fs:watch`); the favorite
is non-owning and renders off the shared stores. In `TerminalView` `mirror` mode we **re-enable the
explorer split** the base feature forced inert (relaxing base-FR-017). **v1 is READ-ONLY content-sync
(OQ-1)** — no editing, no `fs:write`, no new write path anywhere; the shared model exists purely so
both read-only views show one buffer. Files/cwd/`fs:*` are already shared.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron renderer only) |
| Key dependencies | Existing: `monaco-editor` (`createModel`/`getModel`/`Uri`/`setModel`), the `PanelTabsProvider`/`ActiveComposerProvider` provider idiom, the pure `openFiles.ts`/`viewerState.ts` transitions, the base `TerminalView` `mirror` prop + `TerminalFavoriteSurface`. **No new deps.** |
| New runtime contracts | **None.** No IPC channel, no preload method, no session schema change. The favorite record stays `{panelId:'terminal',tabId,label}`. |
| Files to create | `src/renderer/fileExplorer/OpenFilesProvider.tsx` (+`.dom.test.tsx`), `src/renderer/fileExplorer/monacoModelRegistry.ts` (+`.test.ts`), plus the regression/two-mount tests in Phase 2 |
| Files to modify | `src/renderer/fileExplorer/useFileExplorer.ts`, `src/renderer/fileExplorer/FileExplorer.tsx`, `src/renderer/fileExplorer/FileViewer.tsx`, `src/renderer/terminal/TerminalPanel.tsx`, `src/renderer/cosmos/TerminalFavoriteSurface.tsx`, `src/renderer/App.tsx` (wrap the provider) |
| Design step | **NOT needed** — reuses the existing 3-pane chrome, the existing Monaco theme, and the existing favorite GONE/WAITING idiom. No new visual surface. |
| Read-only scope (OQ-1) | The editor stays `readOnly`/`domReadOnly`. No edit affordance, no save, no `fs:write` is introduced. Noted again at every relevant step. |

---

## Phase 0 — Sequencing gate (HARD — do not start Phase 1 until cleared)

- [ ] **Confirm `cosmos-terminal-favorite-multiplex-v1` (the base) has merged.** This feature
      re-enables the explorer split the base makes inert and extends the same `TerminalView` `mirror`
      prop, `TerminalFavoriteSurface`, `LivePanelTab.serialize`, and the explorer hooks. codegraph shows
      `TerminalFavoriteSurface.tsx` + `LivePanelTab.serialize` already present (base landed/landing) — but
      **rebase on the settled base-feature code before Phase 1** so the `mirror`-gating diff applies to the
      final base. A concurrent terminal-favorite developer + a Confluence-mirror architect are running;
      this plan touches `useFileExplorer`/`FileViewer`/`TerminalPanel`/`TerminalFavoriteSurface` — confirm
      no in-flight overlap on those four before starting.

## Phase 1 — Interface (types + the two shared-store contracts, no behavior yet)

- [ ] **`OpenFilesProvider` contract** (`src/renderer/fileExplorer/OpenFilesProvider.tsx`). Model it on
      `PanelTabsProvider`: a `registryRef: Map<paneId, PaneOpenFilesEntry>` + a `version` counter. Shape:
      `interface PaneOpenFilesEntry { openFiles: OpenFilesState; live: boolean }` (`live` = the pane is
      folder-open, set by the owning hook — the mirror reads it to choose the explorer vs. a calm
      "no folder open" placeholder). Expose:
      - `useSharedOpenFiles(paneId): { entry: PaneOpenFilesEntry; apply: (fn: (s: OpenFilesState) => OpenFilesState) => void; setLive: (live: boolean) => void; clear: () => void }`.
      - `apply` runs a pure `openFiles.ts` transition against `registryRef[paneId].openFiles` and bumps
        `version`; `clear` removes the pane entry (owning teardown). All renderer-only, NO IPC, never
        persisted (FR-009).
- [ ] **`monacoModelRegistry` contract** (`src/renderer/fileExplorer/monacoModelRegistry.ts`). Keyed by a
      `cosmos-file://<paneId>/<relPath>` URI (OQ-2). Expose (with an **injectable model factory** so the
      refcount/dispose logic is node-unit-testable without Monaco, which crashes jsdom):
      - `modelUri(paneId, relPath): string` — the canonical key (`monaco.Uri.from({ scheme:'cosmos-file', authority: paneId, path: '/'+relPath }).toString()`).
      - `acquire(paneId, relPath, text, language): ITextModel` — `getModel(uri) ?? createModel(text, language, uri)`, then `++attachCount[uri]`, clear any `released` flag. Called by a `MonacoText` on mount / model-switch-in.
      - `syncText(model, text): void` — `if (model.getValue() !== text) model.setValue(text)` (a watch re-read pushed new text into the shared store; keep the one model in step — read-only, no edit path).
      - `detach(paneId, relPath): void` — `--attachCount[uri]`; then `maybeDispose`.
      - `release(paneId, relPath): void` — set `released[uri]` (the file left the shared open-files store); then `maybeDispose`.
      - `maybeDispose(uri)`: dispose + delete the model ONLY when `attachCount[uri] === 0 && released[uri]` (OQ-3 — closing one view detaches without disposing while the file is still open or the other view still attached).
- [ ] **Thread `mirror` into the explorer hooks.** Add an options arg to `useExplorerPanes` /
      `useFileExplorer` (e.g. a trailing `{ mirror?: boolean }`), default `false`. (Phase 3 wires the
      conditionals.) `mirror` is the non-owning flag: no `fs:watch`, no `fs:read` resolution, no go-live
      seed, no `onOpenFilesChange` report.
- [ ] **`TerminalView` mirror already carries the explorer columns** (base added `mirror`); Phase 3 flips
      its mirror branch from terminal-only back to the 3-pane split.
- [ ] Review types vs spec — no invented properties. New fields: `PaneOpenFilesEntry.{openFiles,live}`,
      the registry's attach/release maps, and the `mirror` option — each traces to FR-002/FR-003/FR-006/FR-001.

## Phase 2 — Testing (write first where the logic is pure / branchy)

> **OQ-4 is the headline:** the single-mount no-regression suite is mandatory and lands with (ideally
> before) the lift. Monaco crashes jsdom, so test the **hook/store/registry layers directly** (they do
> NOT import Monaco — only `FileViewer.tsx` does); mock `window.cosmos.fs`.

**node-unit (`.test.ts`, vitest node env):**
- [ ] `openFiles.test.ts` — keep GREEN unchanged (the pure transitions are reused verbatim; a passing
      run proves the lift changed only storage, not logic).
- [ ] `monacoModelRegistry.test.ts` (NEW, injected fake model factory): same uri → same model instance
      (no duplicate create); `acquire`/`detach` move the refcount; `maybeDispose` disposes ONLY when
      (`released` AND refcount 0); `detach` with the file still open (not released) does NOT dispose;
      `release` with a view still attached does NOT dispose; re-`acquire` after `release` clears the
      released flag (re-open); a different `relPath` (rename/move) yields a DIFFERENT model (OQ-2, no
      migration). `syncText` only calls `setValue` when the value differs.

**jsdom (`.dom.test.tsx`):**
- [ ] `OpenFilesProvider.dom.test.tsx` (NEW): `apply` mutates the right pane entry + bumps version;
      two consumers of the SAME paneId both re-read after an `apply` from either; `clear` removes the
      entry; `setLive` flips `live`; pane entries are independent across paneIds.
- [ ] **Single-mount regression** (NEW — the OQ-4 suite, exercising `useFileExplorer` under one
      `OpenFilesProvider`, Monaco-free):
      - go-live seeds from `restoredOpenFiles` and fires one `fs:read` per restored path (resolver);
      - **StrictMode double-mount does NOT wipe the restored seed** (the `persist-open-files-restore-
        broken-v1` guard — body→cleanup→body re-seeds the SAME slice; the slice is consumed ONLY on a real
        `enabled` true→false);
      - `onOpenFilesChange` reports the slice on every change (and only from the owning hook);
      - `openFile` → `openOrFocus` (loading) → resolver fires ONE `fs:read` → `updateOpenFile`; a re-click
        focuses with NO re-read jolt;
      - `closeFile` re-picks the adjacency neighbour (right-else-left-else-null) identically;
      - watch `fs:changed` re-reads every open file + `invalidateOpen` for a vanished one, siblings intact;
      - teardown (`enabled` true→false / unmount) `clear`s the pane entry and `release`s its models.
- [ ] **Two-mount content-sync** (NEW — the crux, SC-002/SC-003/SC-004, Monaco-free at the hook layer):
      one owning `useFileExplorer` + one `mirror` `useFileExplorer` for the SAME paneId under one
      provider —
      - opening a file in the MIRROR appears in the OWNER's `openFiles`; the OWNER (single fs owner)
        resolves it with exactly ONE `fs:read`; both read the resolved viewer (SC-002);
      - `setActiveFile`/`closeFile` from either reflects in both; close re-picks the same active in both;
      - the mirror drives NO `fs:watch`/`fs:read` resolution (assert `window.cosmos.fs.watchStart`/`read`
        are never called from the mirror) (FR-006/SC-004);
      - source GONE (owner unmounts / `clear`) → the mirror reads an absent/empty entry and degrades
        (SC-005) without itself touching `fs:*`.
- [ ] **Model-registry attach/detach across two views** (can stay node-level via the injected factory,
      or a thin jsdom test mocking Monaco): two `acquire`s for one uri (two views active on the same
      file) → refcount 2, one model; one view detaches → refcount 1, NOT disposed (SC-004 dispose-danger);
      file closed in store (`release`) while one view still attached → NOT disposed; last detach after
      release → disposed.
- [ ] **`MonacoText` model-swap** (jsdom with Monaco mocked, mirroring the existing FileViewer test
      isolation): mounting `MonacoText` for a file `acquire`s its model and `setModel`s it; switching the
      active file `detach`es the old + `acquire`s the new; unmount `detach`es. (If Monaco mocking is
      brittle here, assert via the registry calls rather than real Monaco.)

**node-integration:** NOT required — no main/PTY/fs contract change (the fan-out is renderer-side over
the existing per-paneId `fs:*`). Note this so no one adds a redundant main integration test.

## Phase 3 — Implementation

### 3a. `OpenFilesProvider` — the lifted, paneId-keyed shared open-files store (FR-002)

- [ ] Create `src/renderer/fileExplorer/OpenFilesProvider.tsx` per the Phase-1 contract, copying the
      `PanelTabsProvider` ref+version idiom (a publish/apply bumps `version`; `useSharedOpenFiles(paneId)`
      reads `registryRef.current.get(paneId)` memoized on `version`). Renderer-only; NO IPC; never
      persisted (FR-009).
- [ ] Wrap the App shell with `<OpenFilesProvider>` alongside `PanelTabsProvider`/`ActiveComposerProvider`
      in `src/renderer/App.tsx`, high enough to cover BOTH the Terminal panel (source) and Home (the
      favorite) — both are `forceMount`ed (§3), so both `useFileExplorer` instances stay mounted and share
      the store.

### 3b. Lift `useFileExplorer`'s open-files collection onto the shared store + add the `mirror` gate (FR-002/FR-006/FR-011)

> **OQ-4 discipline:** keep every transition, the go-live seed, the StrictMode `wasEnabledRef`/
> `restoredOpenFilesRef` consume-once guard, the `onOpenFilesChange` report, and the watch reconcile
> **logically identical** — change ONLY the storage backend (was `useState<OpenFilesState>`) to the
> shared store, and gate the fs-owning effects on `!mirror`.

- [ ] **Storage swap.** Replace `const [openFiles, setOpenFiles] = useState(EMPTY_OPEN_FILES)` with
      `const { entry, apply, setLive, clear } = useSharedOpenFiles(paneId)` and read `entry.openFiles`.
      Every `setOpenFiles((s) => T(s))` becomes `apply((s) => T(s))` — the pure `openFiles.ts` transitions
      are unchanged. (Single-mount: identical behavior, one writer/one reader.)
- [ ] **Owning-only fs effects (gate on `!mirror`).** The go-live seed (incl. the restored-slice
      consume-once guard), the `fs:watchStart`/`watchStop` lifecycle, the `fs:changed` re-read, and the
      `onOpenFilesChange` report run ONLY when `!mirror`. Set `setLive(enabled)` on go-live/teardown
      (owning only) so the mirror can gate its explorer. On owning teardown, `clear()` the pane entry and
      `release()` each open file's model.
- [ ] **Resolver effect (replaces inline read in `openFile`; owning only).** Add ONE effect that
      reconciles the shared store to fs: for each open file whose `viewer.kind === 'loading'` and not
      already in-flight (tracked by a ref `Set`), fire `fs:read` → `apply(updateOpenFile(resolveRead(...)))`.
      `openFile` becomes "dispatch `openOrFocus` (→ loading)"; the resolver does the read. This is the ONE
      meaningful owning-path change (needed so a MIRROR-initiated open is resolved by the single owner,
      FR-006) — covered by the single-mount + two-mount tests. A re-click on an already-resolved file
      stays focused (not re-set to loading) → no re-read (preserves the no-jolt behavior).
- [ ] **Mirror path.** When `mirror`: drive NONE of the above fs effects. Render the viewer/tree from the
      shared `entry.openFiles`; user `openFile`/`setActiveFile`/`closeFile` go through `apply` (shared) so
      the owner resolves/persists. The mirror keeps its OWN tree state + drives its OWN `fs:list` on expand
      (idempotent, confined reads — FR-005); it does NOT `fs:watch` (FR-006), so the mirror tree refreshes
      on manual expand/collapse rather than live on `fs:changed` — an accepted minor limitation for a
      secondary mirror (the open FILE content still live-updates via the owner's watch → shared store →
      both views). The mirror reads `entry.live` to choose the explorer vs. a calm read-only "no folder
      open in this terminal" placeholder (NO `[Open a folder]` CTA — folder-open is source-owned).

### 3c. `MonacoText` → shared model registry (FR-003/FR-004/FR-007, READ-ONLY per OQ-1)

- [ ] In `src/renderer/fileExplorer/FileViewer.tsx`, change `MonacoText` to take `paneId` (it already has
      `relPath`, `text`). On mount, create the editor with **no initial model**, keep `readOnly`+`domReadOnly`
      (UNCHANGED — OQ-1), then `acquire(paneId, relPath, text, monacoLanguageOf(relPath))` and
      `editor.setModel(model)`. Replace the in-place `model.setValue(text)` file-switch effect with: on
      `relPath` change `detach` the old + `acquire`+`setModel` the new; on `text` change (watch re-read)
      `syncText(model, text)`. On unmount `detach(paneId, relPath)` then `editor.dispose()` (NEVER dispose
      the shared model directly — the registry owns model disposal via refcount, FR-007).
- [ ] **Per-view view state is free** (FR-004/OQ-5): two editors attached to one model keep independent
      cursor/scroll/selection (view state lives on the editor). Per-view, per-file view-state persistence
      across active-file switches is NOT implemented (OQ-5 — reset-on-reactivate, the current single-mount
      behavior, is accepted).
- [ ] **Model `release` on close.** When the owning hook's `closeFile` removes a path from the shared
      store (3b), call `release(paneId, relPath)` so the registry can dispose once no view is attached
      (FR-007). (Wire `release` from the `closeFile`/`invalidate`/`clear` sites, owning-side.)

### 3d. Re-enable the explorer split in `TerminalView` mirror mode (FR-001/FR-012 — relax base-FR-017)

- [ ] In `src/renderer/terminal/TerminalPanel.tsx`, the base made `mirror` render the terminal column
      only and forced `useExplorerPanes(paneId, mirror ? false : live, …)` inert. Change it so a `mirror`
      view renders the **full 3-pane split** (terminal | viewer | tree) exactly like the owning view, by
      calling `useExplorerPanes(paneId, live, /*no restored*/ undefined, /*no report*/ undefined,
      onViewerFocusChange, { mirror: true })`. All base terminal-pane guarantees stay: the mirror still
      does NOT own `pty:start/dispose/restart`, still seeds its xterm from the source serializer, still
      obeys the resize guard (FR-012).
- [ ] Keep the column layout / resize-divider code shared between the owning and mirror render (the
      explorer columns are identical; only fs-ownership differs, handled in the hook). The mirror passes
      no-op `registerSerializer` (terminal-pane serializer is a source concern; unchanged from base).

### 3e. `TerminalFavoriteSurface` renders the full mirror (FR-001/FR-008)

- [ ] In `src/renderer/cosmos/TerminalFavoriteSurface.tsx`, the POPULATED branch already mounts
      `<TerminalView … mirror … />`; with 3d that now includes the explorer split — so the favorite shows
      the same open files + tree as the source. NO change to the GONE/WAITING gating (still keyed off
      `findLiveTab` + `serialize` presence): a GONE source degrades the WHOLE mirror (terminal AND
      explorer) together (FR-008), and the mirror's hook, reading an absent shared-store entry, drives no
      `fs:*` against a dead pane.

### 3f. Read-only guardrails (OQ-1 — assert the scope cut holds)

- [ ] Confirm NO `fs:write` channel, no writable-Monaco option, and no save/dirty affordance is added
      anywhere in this change. The shared model is read-only content-sync only. Add a one-line comment at
      `acquire`/`MonacoText` recording that the model is shared for read-only multi-view today and is the
      seam a FUTURE editability feature would build on (not this one).

## Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` (architect, after implementation):
      - **§4.13** — a pane's open-files SELECTION + each open text file's `ITextModel` are lifted into
        App-root shared stores (`OpenFilesProvider` + `monacoModelRegistry`), so a pane may now have MORE
        THAN ONE explorer VIEW (source + a Home favorite) rendering the SAME open files + SAME models,
        with per-view cursor/scroll/tree-expansion. The source explorer remains the single owner of
        `fs:read` resolution + `fs:watch`; the favorite is non-owning. The viewer STAYS read-only (the
        model-share is read-only content-sync; editability is a separate future feature).
      - **§4.14** — a terminal favorite now mirrors the FULL Terminal view (terminal pane via the base
        multiplex+seed, PLUS the file-explorer split via the shared open-files store + Monaco model
        registry). xterm has no model/view split (hence multiplex+seed); the Monaco viewer DOES (one
        `ITextModel`, many editor views) — "share the buffer, render each", applied to the file viewer.
- [ ] Reconcile `TODO.md`; record any deviations below.

---

## Reuse surface (what is reused verbatim vs. minimally touched vs. new)

| Reused AS-IS | Minimally touched | New |
|---|---|---|
| `openFiles.ts` transitions (`openOrFocus`/`setActiveFile`/`closeFile`/`updateOpenFile`/`seedOnGoLive`/`activeViewer`), `viewerState.ts` (`resolveRead`/`invalidateOpen`/`selectFile`), `adjacentActiveId`, the 3-pane layout + resize dividers, the base `TerminalView` `mirror` terminal-pane guarantees, `TerminalFavoriteSurface` GONE/WAITING gating | `useFileExplorer` (storage swap to shared store + `mirror` gate + resolver effect), `useExplorerPanes` (`mirror` option), `MonacoText` (model registry instead of `setValue`), `TerminalView` mirror branch (terminal-only → 3-pane), `App.tsx` (wrap provider) | `OpenFilesProvider` (+ `useSharedOpenFiles`), `monacoModelRegistry`, the regression + two-mount + registry tests |

## Risks / edge cases carried from the spec

- **Single-mount regression (OQ-4, the top risk).** The lift refactors the bug-sensitive go-live seed /
  StrictMode guard / resolver. Mitigation: the lift is a storage-backend swap with logic held identical;
  the resolver is the one real change; the mandatory single-mount suite (Phase 2) proves parity BEFORE
  the two-mount path is trusted.
- **Dispose-danger (FR-007/OQ-3).** A favorite tab-switch detaches the mirror's editor; the model must
  survive while the source still renders it. The registry's (`released` AND refcount 0) latch is the
  guard; covered by the registry tests.
- **Mirror tree staleness without watch (FR-006).** Accepted: the mirror tree re-lists on manual
  expand/collapse (idempotent `fs:list`), not live on `fs:changed`; open FILE content still live-updates
  via the owner's watch → shared store → both views. Documented limitation, not a defect.
- **Read-only (OQ-1).** No `fs:write`/edit path anywhere; the shared model is read-only content-sync.
  Guarded explicitly in 3f.

---

## Open confirmations before dev

1. **Shared-store provider vs. external store.** Plan models `OpenFilesProvider` on the existing
   `PanelTabsProvider` ref+version idiom (codebase-consistent). Confirm that over a `useSyncExternalStore`
   variant (both work; the ref+version matches the two sibling registries).
2. **Resolver-effect refactor of `openFile`.** Moving `fs:read` out of inline-`openFile` into a single
   owning reconcile effect is the one meaningful owning-path change (needed for cross-mount opens under a
   single fs owner). Confirm acceptable given the mandatory regression suite, or prefer keeping inline
   reads for owner-initiated opens + a narrower reconcile only for mirror-initiated loading entries.
3. **Mirror tree: independent `fs:list` (no watch) vs. fully shared tree.** Plan keeps tree expansion
   per-view with the mirror driving its own idempotent `fs:list` (no `fs:watch`), accepting a tree that
   refreshes on manual expand rather than live. Confirm, or require lifting the tree LISTING too (more
   work; expansion still per-view).

## Deviations & Notes

- **2026-06-30**: Plan authored against the approved spec + resolved OQs (v1 = READ-ONLY content-sync).
  No code written — STOP after plan per the SDD cycle.
