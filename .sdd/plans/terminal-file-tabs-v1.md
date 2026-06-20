# Plan: Terminal File Tabs — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/terminal-file-tabs-v1.md

---

## Grounding

> Same direct grounding as the spec (architect-owned). Key takeaways for the HOW:

- **codegraph_explore** (`viewerState … useFileExplorer FileViewer FileExplorer TerminalPanel`,
  `panelTabs … usePanelTabs PanelTabStrip`, `closeTab openTab setActiveTab TabsState adjacency`):
  - The middle viewer column today holds ONE file (`useFileExplorer` → `viewer: ViewerState`); `openFile`
    opens-or-RETARGETS it. The pure transitions live in `viewerState.ts` (`selectFile`/`resolveRead`/
    `invalidateOpen`/`openRelPath`/`baseName`), node-tested.
  - A PURE ordered-tab model already exists in `panelTabs.ts`: `TabsState<T>` + `openTab` (append +
    activate, REJECTS duplicate id) / `closeTab` (remove + `adjacentActiveId` neighbour, or `null` when
    empty) / `setActiveTab` / `updateTab`, all node-tested, adapted to React by `usePanelTabs<T>`. This
    is the precedent the open-FILES collection mirrors — the one delta is "open-an-already-open file
    FOCUSES it" (vs `openTab` rejecting the dup id).
  - `FileExplorer.tsx`'s `useExplorerPanes(paneId, live)` returns the ready `viewer` + `tree` elements;
    the tree's selection highlight is `selectedRelPath = viewer ? viewer.relPath : null` — the single
    integration point that must become "the ACTIVE tab's relPath".
  - `TerminalPanel.tsx` lays out the 3 columns + dividers and gates the split on `isFolderOpen(phase)`.
    The viewer column is `useExplorerPanes(...).viewer`. No layout change is needed beyond what the strip
    adds inside the viewer column.
- **Reads** of `useFileExplorer.ts` / `FileViewer.tsx` / `FileTree.tsx`: the per-file read path
  (`fs:read` → `resolveRead`), the watch re-read invalidation (`openRelRef` → `invalidateOpen`), and the
  Monaco mount that already swaps its model in place when `relPath`/`text` change — all reusable per-file.
- **memory_recall** (`terminal file explorer viewer single open file #84 split layout panel tabs`):
  empty; the #84 contract is in its artifacts. This feature's open-files/tab-strip/ephemeral decision is
  persisted via `memory_save` (mem_mqmgk8rr…).

## Summary

Turn the terminal panel's single-file middle viewer (shipped in `terminal-file-explorer-v1`) into a
VS Code-style multi-file editor with a **tab strip**. The change is **renderer-only state + UI** — no
`fs:*` IPC, `cosmos-file://` protocol, confinement, or watcher change (FR-011). Introduce a PURE,
node-tested **open-files collection** (`openFiles.ts`) mirroring the existing `panelTabs.ts`
`TabsState<T>` precedent: an ordered list of open files keyed by relPath + an active relPath, with
`openOrFocus` (the one new transition vs `openTab` — an already-open path is FOCUSED, not duplicated),
`close` (adjacency neighbour via the same `adjacentActiveId` rule, → empty on last close), and
`setActive`. `useFileExplorer` swaps its single `viewer: ViewerState` for this collection (each entry
still carries a `ViewerState` resolved by the existing `selectFile`/`resolveRead`/`invalidateOpen`,
tracked per file). The **active** entry's `ViewerState` drives the existing `FileViewer` body unchanged.
A **light bespoke tab strip** (label + close + active + horizontal overflow + roving-tabindex) renders
inside the middle viewer column above the body — NOT the heavyweight `PanelTabStrip` (no rename/`+`/
status). The tree's selection highlight follows the **active** tab. Open tabs are **per-`paneId` and
ephemeral** (not persisted). This is **UI-bearing**, so a **design step (`design` skill / designer)** is
required after this plan is approved and before interface/tests/implementation.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (React renderer only — no main/preload/IPC change) |
| Key dependencies  | NONE new. Reuses the existing Monaco viewer, `cosmos-file://` image scheme, `fs:*` IPC, shadcn/ui tokens, and the `panelTabs.ts` adjacency precedent. (No new shadcn primitive expected — confirm in design.) |
| Files to create   | `src/renderer/fileExplorer/openFiles.ts` (PURE open-files collection: types + `openOrFocus`/`closeFile`/`setActiveFile`/`updateOpenFile`/selectors) + `src/renderer/fileExplorer/openFiles.test.ts`; `src/renderer/fileExplorer/FileTabStrip.tsx` (the light tab strip component) |
| Files to modify   | `src/renderer/fileExplorer/useFileExplorer.ts` (hold the open-files collection instead of one `viewer`; expose `openFiles`, `activeRelPath`, `openFile` (=open-or-focus), `setActiveFile`, `closeFile`, and the active `viewer`); `src/renderer/fileExplorer/FileViewer.tsx` (render the strip above the body via `FileTabStrip`; body still renders the ACTIVE file's `ViewerState`); `src/renderer/fileExplorer/FileExplorer.tsx` (`useExplorerPanes` wires the new strip props through; tree `selectedRelPath` = ACTIVE tab's relPath); `src/renderer/fileExplorer/index.ts` (export the new module if it joins the barrel); `docs/ARCHITECTURE.md` (extend the Terminal File Explorer section — multi-file tabs, ephemeral per-`paneId`; ALSO settle the §4.x debt from #84 that is still owed — see Phase 4); `docs/PROJECT-STRUCTURE.md` (new files); `docs/DEVELOPMENT.md` (open-files-collection / ephemeral / strip-vs-PanelTabStrip note); `TODO.md` |

> `viewerState.ts` is REUSED as-is (per-file state mapping). `openFiles.ts` is a new collection layer ON
> TOP of it; it does not replace `viewerState.ts`. `TerminalPanel.tsx` needs no change unless the design
> asks for a layout tweak (the strip lives inside the viewer column, which `TerminalPanel` already places).

---

## Open-files collection — the new pure model (no IPC, no new types over the wire)

`src/renderer/fileExplorer/openFiles.ts`, mirroring `panelTabs.ts` (pure, node-tested, `warn`-on-misuse
safe-fallback). Suggested shape:

```
OpenFile        = { relPath: string; name: string; viewer: NonNullable<ViewerState> }
OpenFilesState  = { files: OpenFile[]; activeRelPath: string | null }

openOrFocus(state, relPath): OpenFilesState
  // already open → setActiveFile(state, relPath) (NO duplicate)
  // not open     → append { relPath, name: baseName(relPath), viewer: selectFile(relPath) } + activate
closeFile(state, relPath): OpenFilesState
  // remove relPath; if it was active, re-pick via the SAME adjacency rule as panelTabs.adjacentActiveId
  // (export/share it, or re-derive the identical neighbour pick); empty → activeRelPath = null
setActiveFile(state, relPath): OpenFilesState         // no-op if not open (warn)
updateOpenFile(state, relPath, viewer): OpenFilesState // patch one file's resolved ViewerState (read/invalidate)
activeViewer(state): ViewerState                       // the active file's viewer, or null (empty)
```

- The collection NEVER holds two entries for the same relPath (FR-002). `openOrFocus` is the load-bearing
  delta from `panelTabs.openTab` (which rejects a duplicate id; here a duplicate FOCUSES).
- Reuse the adjacency neighbour-pick from `panelTabs.ts` — either export `adjacentActiveId` for reuse or
  replicate its exact semantics under test (prefer reuse so the rule stays single-sourced).
- Per-file `viewer` is resolved by the EXISTING `viewerState.ts` functions (`selectFile` on open,
  `resolveRead` on the `fs:read` resolve, `invalidateOpen` on a watch-observed delete) — no new
  per-file read logic.

## Key decisions

- **D-1 — Collection layer over `viewerState.ts`, mirroring `panelTabs.ts`.** `openFiles.ts` is a new
  pure ordered-collection module; `viewerState.ts` is untouched and reused per file. The active entry's
  `ViewerState` feeds the existing `FileViewer` body unchanged (FR-008). This keeps the per-file
  read/render contract identical to #84 and confines the new logic to one node-tested module (FR-001).
- **D-2 — `openFile` becomes open-or-focus.** `useFileExplorer.openFile(relPath)` now calls
  `openOrFocus`; on a fresh open it kicks the existing `fs:read` and lands the result via
  `updateOpenFile(relPath, resolveRead(...))` (guarded against staleness as today). Re-clicking an open
  file just activates it (no re-open jolt). (FR-002/FR-003/FR-017.)
- **D-3 — Light bespoke tab strip, not `PanelTabStrip`.** File tabs need only label + close + active +
  overflow scroll + roving-tabindex (FR-012..FR-015). The full `PanelTabStrip` carries rename/`+`/status/
  kind-glyph machinery this feature does not want, and its band styling (`h-8 bg-popover`) is the
  PANEL tab band — the file strip sits INSIDE the viewer column and should read one notch quieter. So a
  new `FileTabStrip.tsx` reuses the SAME tokens, focus ring, truncation+tooltip, and ARIA roving-tabindex
  keyboard model (so it's the same product) without the unneeded chrome. Designer confirms the exact
  treatment (and may overrule toward reusing `PanelTabStrip` if it fits cleanly) — Phase 0.
- **D-4 — Per-file content tracking; tab switch reuses the resolved state.** Each `OpenFile` caches its
  resolved `ViewerState`, so switching tabs is instant and does not re-read (FR-009). The existing
  `fs:changed` watch re-read already re-reads the open file; under multi-file it re-reads the relevant
  open file(s) and lands via `updateOpenFile`, invalidating a deleted one (FR-010). (Re-reading only the
  ACTIVE file on change is an acceptable simplification; re-reading all open files is also fine — decide
  in implementation, both satisfy FR-010 as long as a viewed deleted file invalidates.)
- **D-5 — Ephemeral, per-`paneId`.** The collection lives in `useFileExplorer` (one instance per pane via
  `useExplorerPanes`), so it is already per-`paneId` and independent (FR-006). It is NOT added to the
  session snapshot (FR-007), matching the existing ephemeral split-ratio/viewer state. The go-live effect
  in `useFileExplorer` that resets `viewer`/tree on enable MUST reset the collection to empty too.
- **D-6 — Tree highlight follows the active tab.** `useExplorerPanes` passes `selectedRelPath =
  activeRelPath` (was `viewer ? viewer.relPath : null`) to `FileTree`. No `FileTree` change (it already
  renders the given `selectedRelPath` as selected). (FR-016.)

---

## Implementation Checklist

> Update as work progresses. Add inline notes when a step deviates.

### Phase 0 — Design (BEFORE interface; gated on this plan's approval)

- [x] This feature adds a new UI surface (a file-tab strip) → run the **`design` skill (designer)**.
      Scope: the tab strip inside the MIDDLE viewer column — band height/tone (one notch quieter than the
      `PanelTabStrip` panel band so it reads as in-column chrome), the active vs inactive tab treatment,
      the per-tab close affordance (hover/focus reveal like the existing strip's `X`), label truncation +
      tooltip, the overflow/horizontal-scroll behavior, the empty state (no strip → "Select a file"
      placeholder full-height), and how the strip relates to the existing viewer header (does the header
      stay, fold into the active tab, or get replaced by the strip?). Reuse existing Tailwind tokens +
      the `PanelTabStrip`/tree-row idioms; confirm D-3 (bespoke `FileTabStrip` vs reusing `PanelTabStrip`)
      and whether a same-basename path-suffix disambiguator is worth it. NO new token / shadcn primitive
      expected. Output: `.sdd/designs/terminal-file-tabs-v1.md`.

### Phase 1 — Interface (types)

- [x] Read the spec; confirm all OQs resolved (OQ-1..OQ-4 → architect defaults). Confirm D-3 with the
      design output.
- [x] Define `OpenFile` + `OpenFilesState` in `src/renderer/fileExplorer/openFiles.ts`; declare the
      `FileTabStrip` props (`tabs: { relPath, name }[]`, `activeRelPath`, `onActivate`, `onClose`,
      `ariaLabel`). No new IPC/shared types — `fs:*` and `cosmos-file://` are unchanged (FR-011).
      DEVIATION (minor): the strip takes `activeRelPath` (not an `active` flag per tab) — the strip
      derives `active` itself; `OpenFile` is structurally a superset of `FileTab`, so the hook's
      `openFiles` passes straight through with no mapping.
- [x] Review types vs spec — no invented properties; tabs keyed by relPath; reuse `ViewerState` from
      `viewerState.ts` (not redefined).

### Phase 2 — Testing (pure logic first)

- [x] `openFiles.test.ts` (22 tests, all green): `openOrFocus` appends + activates a new file;
      `openOrFocus` on an already-open path FOCUSES it and does NOT duplicate (count unchanged) +
      re-clicking the active file is a referentially-stable no-op + a re-focus preserves the resolved
      viewer; `setActiveFile` no-ops on an unknown path (warn) + on the already-active path; `closeFile`
      removes an inactive file leaving active unchanged; `closeFile` on the active file activates the
      adjacency neighbour (next, else previous when last); `closeFile` on the last file → empty +
      `activeRelPath = null`; `updateOpenFile` patches one file's `ViewerState` without touching siblings
      + keeps the relPath stable + discards a patch for a closed path; `activeViewer` returns the active
      file's viewer / null when empty + follows a switch with no cross-wire; per-paneId independence.
- [x] Confirm the adjacency neighbour-pick matches `panelTabs.adjacentActiveId` — a dedicated test
      asserts `closeFile(...).activeRelPath === adjacentActiveId(...)` for active + inactive cases
      (the rule is SHARED, not copied — `closeFile` calls the exported `adjacentActiveId`).

### Phase 3 — Implementation

- [x] `src/renderer/fileExplorer/openFiles.ts`: the pure collection per the model above; reuses
      `baseName`/`selectFile` from `viewerState.ts` and the SHARED `adjacentActiveId` from `panelTabs.ts`.
      No React/Electron import. (`resolveRead`/`invalidateOpen` are applied by the hook, fed into
      `updateOpenFile` — `openFiles.ts` stays a pure collection over `ViewerState`.)
- [x] `src/renderer/fileExplorer/useFileExplorer.ts`: replaced the single `viewer` state with an
      `OpenFilesState`. `openFile` → `openOrFocus` + (on a FRESH open only) `fs:read` → `updateOpenFile`;
      a re-click reuses the resolved viewer (no re-read). Added `setActiveFile`/`closeFile`. Exposes
      `openFiles` + `activeRelPath` + the active `viewer` (= `activeViewer(state)`). The go-live effect
      resets the collection to empty (D-5/FR-007). The `fs:changed` handler now re-reads EVERY open file
      (the ref tracks all open relPaths) and invalidates a vanished one via `updateOpenFile/invalidateOpen`
      (FR-010) — the staleness guard became "is this relPath still open?".
- [x] `src/renderer/fileExplorer/FileTabStrip.tsx`: the light strip — `role="tablist"` of `role="tab"`
      buttons (file glyph + truncated label + `Tooltip`, active `data-state`, per-tab ghost close `X`),
      horizontal overflow scroll + active-into-view, roving tabindex + Arrow/Home/End/Enter/Space/Delete/
      Backspace keymap mirroring `PanelTabStrip` VERBATIM (FR-013/14/15). `bg-card/60` band, 2px primary
      top-accent active. No rename, no `+`, no status/terminal glyphs, no trailing slot.
- [x] `src/renderer/fileExplorer/FileViewer.tsx`: renders `FileTabStrip` above the body when ≥1 file is
      open; the body renders the ACTIVE file's `ViewerState` (`ViewerBody` UNCHANGED). Zero files → no
      strip, the "Select a file" placeholder fills the column (FR-005/FR-012). The #84 single-file header
      was REMOVED (folded into the active tab) — the strip is the one `h-8` band.
- [x] `src/renderer/fileExplorer/FileExplorer.tsx`: `useExplorerPanes` passes open-files + active-file +
      handlers to `FileViewer`, and `selectedRelPath = activeRelPath` to `FileTree` (D-6).
- [x] All tests pass; reused `viewerState` + the SHARED `panelTabs.adjacentActiveId` — no duplicated
      logic. No `fs:*`/`cosmos-file://`/preload/main change (FR-011) — NO `npm run dev` preload restart.
      DEVIATION: `TerminalPanel.tsx` needed NO edit — the strip lives inside `FileViewer`, which
      `TerminalView` already places via `{viewer}` (the plan listed it conservatively as a touch point).

### Phase 4 — Docs

- [x] `docs/ARCHITECTURE.md`: added §4.13 Terminal File Explorer (settling the #84 debt + the #91 tabs).
      a multi-file editor (open-files collection, open-or-focus, adjacency close, ephemeral per-`paneId`,
      tree highlight follows the active tab); note it is renderer-only (no IPC/protocol change). **NOTE:
      the #84 plan left the §4.x Terminal File Explorer section UNWRITTEN (flagged in
      `terminal-file-explorer-v1.md` Phase 4 as architect-owed). This plan's doc step MUST settle that
      debt: author/refresh the §4.x section to cover BOTH #84's contract (split layout, `fs:*`,
      `pathConfine` real-path confinement, `fs.watch` lifecycle + Linux-recursive limitation, no-size-cap
      viewer, the `cosmos-file://` privileged image scheme, Monaco as the first heavyweight renderer dep)
      AND this feature's multi-file tabs. Cross-link §4.1/§4.2.**
- [x] `docs/PROJECT-STRUCTURE.md`: added `openFiles.ts` + `FileTabStrip` to the `fileExplorer/` entry.
- [x] `docs/DEVELOPMENT.md`: added a "Multi-file viewer tabs (terminal-file-tabs-v1)" subsection — the
      open-files collection mirrors `panelTabs.ts` (open-or-focus differs from `openTab`'s reject-dup);
      the strip is a bespoke `FileTabStrip`, not `PanelTabStrip`, and why; open tabs are ephemeral
      per-`paneId` (not in the snapshot); `TerminalPanel.tsx` needs no edit.
- [ ] `TODO.md`: check off / add deferred follow-ups (persist open tabs across sessions; drag-reorder;
      close-all/close-others; same-basename path disambiguator; rename-following).
- [ ] Update this plan with deviations; `memory_save` any new decision that emerged in implementation.

---

## Risks & Constraints

- **Scope discipline — renderer-only.** The headline constraint (FR-011) is that NOTHING in the `fs:*`
  IPC, `cosmos-file://` protocol, path confinement, or watcher contract changes. If a step seems to need
  a main/preload change, stop — the requirement is a pure renderer state + UI extension. (No preload
  restart, no IPC validation change.)
- **Single-sourced adjacency.** The close-active neighbour rule MUST stay identical to `panelTabs`
  (`adjacentActiveId`) — prefer exporting/reusing it over a divergent copy, so terminal tabs and file
  tabs behave the same.
- **Per-file content correctness.** Switching tabs must show the right file and never cross-wire
  another tab's content; the `fs:changed` re-read must invalidate a deleted OPEN file (active or not)
  without corrupting siblings (FR-009/FR-010). Covered by `openFiles` unit tests for `updateOpenFile`
  isolation.
- **Strip overflow + a11y.** A crowded strip must scroll (not wrap/shrink-to-nothing) with the active
  tab reachable, and stay keyboard-operable — mirror the proven `PanelTabStrip` roving-tabindex model
  rather than inventing a new keymap (FR-014/FR-015).
- **Ephemerality is intentional.** Open tabs reset on reopen / go-live (FR-007). Persisting them is an
  explicit deferred follow-up, not a v1 gap.
- **Doc debt.** The #84 `docs/ARCHITECTURE.md` §4.x section was never written; this plan folds settling
  that debt into Phase 4 so the architecture doc stops drifting (architect-owned).

## Deviations & Notes

- **2026-06-20**: Initial plan. OQ-1..OQ-4 carry architect defaults (open-files collection mirroring
  `panelTabs.ts`; light bespoke `FileTabStrip`; ephemeral per-`paneId`; per-file content tracking).
  Renderer-only — no `fs:*`/`cosmos-file://`/preload/main change. Ready for the design step (Phase 0).
- **2026-06-20 (developer, implemented)**: Phases 1-4 done. 22-test `openFiles.test.ts` + full
  fileExplorer suite green (55 tests); typecheck clean for all terminal/fileExplorer files.
  Deviations: (a) `TerminalPanel.tsx` NOT edited — the strip lives inside `FileViewer`, already placed
  by `TerminalView`. (b) `FileTabStrip` takes `activeRelPath` (derives `active` per tab) rather than an
  `active` flag per tab descriptor, so the hook's `OpenFile[]` passes straight to the strip with no
  mapping (`OpenFile` ⊇ `FileTab`). (c) `openFiles.ts` stays a pure collection over `ViewerState`;
  `resolveRead`/`invalidateOpen` are applied in the hook and fed via `updateOpenFile` (so the module
  has no `fs:read` coupling). (d) `fs:changed` re-reads EVERY open file (not just one) to satisfy
  FR-010 for inactive tabs. NOTE: UI behavior (strip render, overflow scroll, keyboard nav, Monaco
  swap) is NOT exercised by tests — only the pure collection + typecheck are verified; manual/in-app
  verification of the strip is still owed.
