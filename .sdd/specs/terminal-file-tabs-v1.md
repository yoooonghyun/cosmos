# Spec: Terminal File Tabs — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: — (extends `terminal-file-explorer-v1`)
**Related plan**: .sdd/plans/terminal-file-tabs-v1.md

---

## Grounding

> Direct grounding I (architect) ran for this spec. Mandatory per CLAUDE.md SDD rule — not handed in.

**codegraph_explore**
- `viewerState selectFile resolveRead openRelPath baseName useFileExplorer FileViewer FileExplorer
  TerminalPanel` → the middle viewer column today holds a SINGLE open file: `useFileExplorer` keeps one
  `viewer: ViewerState` (`null | loading | text | image | binary | denied | not-found`); `openFile`
  OPENS-or-RETARGETS it (a second click replaces the showing file). `viewerState.ts` is the pure,
  node-tested transition module (`selectFile`/`resolveRead`/`invalidateOpen`/`openRelPath`/`baseName`).
  `FileExplorer.tsx`'s `useExplorerPanes(paneId, live)` returns the ready `viewer` + `tree` column
  elements; the tree's `selectedRelPath = viewer ? viewer.relPath : null` (the highlight follows the
  one open file).
- `panelTabs isFolderOpen TerminalPhase usePanelTabs PanelTabStrip PanelTab` → there is ALREADY a pure,
  node-tested `panelTabs.ts` modelling an ordered tab collection over a generic `TabsState<T>`:
  `openTab` (append + activate, rejects a duplicate id), `closeTab` (remove + re-pick active by
  `adjacentActiveId` adjacency), `setActiveTab`, `updateTab`. `usePanelTabs<T>` adapts it to React. The
  heavyweight `PanelTabStrip` (rename/`+`/status glyphs/roving-tabindex) is the chrome precedent. The
  Terminal panel already uses `usePanelTabs` for its TERMINAL tabs; `isFolderOpen(phase)` gates the
  3-pane split vs the welcome view.
- `closeTab openTab setActiveTab TabsState TabLike adjacency pickActiveAfterClose` → `closeTab` removes
  the closed tab and sets `activeTabId` to `adjacentActiveId(...)` (a neighbour) or `null` when the
  collection empties — the exact close-fallback model this feature needs.

**Reads (verbatim source already in-context, not re-Read)**
- `src/renderer/fileExplorer/useFileExplorer.ts` → the hook owning tree state, lazy `fs:list`,
  per-file `fs:read`, the `fs.watch` re-list, and the open-file invalidation (`openRelRef` /
  `invalidateOpen`) when the watched open file vanishes (FR-017 of #84).
- `src/renderer/fileExplorer/FileViewer.tsx` → renders the single file (header glyph+name, Monaco text /
  `cosmos-file://` image / calm state blocks / "Select a file" placeholder). No tab strip today.
- `src/renderer/fileExplorer/FileExplorer.tsx`, `FileTree.tsx` → `useExplorerPanes`; tree row selection
  via `selectedRelPath`; roving-tabindex ARIA tree keymap.
- `.sdd/{specs,plans,designs}/terminal-file-explorer-v1.md` → the shipped #84 contract: 3-pane layout
  (terminal LEFT | viewer MIDDLE | tree dock RIGHT), `fs:*` IPC, `cosmos-file://` image scheme, no
  size cap, watch-driven seamless re-list, welcome-view gate (`isFolderOpen`).

**memory_recall / memory_smart_search**
- `terminal file explorer viewer single open file #84 split layout panel tabs` → empty (the #84
  decisions live in its artifacts, grounded above). I persisted this feature's open-files/tab-strip
  decision via `memory_save` (mem_mqmgk8rr…).

---

## Overview

Extend the terminal panel's middle file-viewer column (shipped as a single-file viewer in
`terminal-file-explorer-v1`) into a **VS Code-style multi-file editor**: a **row of file tabs** sits
above the viewer, one tab per opened file. Clicking a file in the tree **opens it as a new tab** (or
**focuses the existing tab** if it is already open); tabs can be **closed individually**; the active
tab's content fills the viewer. This is a renderer-only state/UI extension — it adds no new filesystem
capability and changes no IPC contract; it only lets several already-readable files be open at once.

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### Open several files at once · P1

**As a** developer reading code beside the terminal
**I want to** open multiple files and keep them open as tabs
**So that** I can move between the files I'm working with without losing my place

**Acceptance criteria:**
- Given a live terminal tab with its 3-pane split, when I click a file in the tree, then it opens in
  the viewer AND a tab for it appears in a tab strip above the viewer, and that tab becomes active.
- Given one file already open, when I click a DIFFERENT file in the tree, then a second tab is added,
  it becomes the active tab, and the viewer shows the newly opened file — the first file's tab stays in
  the strip (it is not closed).
- Given several files open, when I click an inactive tab, then that tab becomes active and the viewer
  shows its file; no other tab is opened or closed.

### Re-opening an already-open file focuses it (no duplicates) · P1

**As a** developer who clicks the same file again
**I want to** be taken to its existing tab instead of opening a duplicate
**So that** the tab strip mirrors the set of distinct open files, like an IDE

**Acceptance criteria:**
- Given a file already open in a tab, when I click that same file in the tree again, then its existing
  tab is focused (made active) and the viewer shows it — NO second tab for the same file is created.
- Given a file already open but NOT active, when I click it in the tree, then its existing tab becomes
  active (the tab strip never holds two tabs for the same file).

### Close tabs individually · P1

**As a** developer done with a file
**I want to** close its tab without affecting the others
**So that** I can keep the strip focused on what I'm actually reading

**Acceptance criteria:**
- Given several files open, when I close an INACTIVE tab, then that tab is removed and the active tab
  (and the viewer) are unchanged.
- Given several files open, when I close the ACTIVE tab, then it is removed and an adjacent tab becomes
  active (a neighbour — the tab to the right, or the left if it was the last); the viewer shows that
  neighbour's file.
- Given exactly one file open, when I close its tab, then the strip becomes empty and the viewer returns
  to the calm "Select a file" placeholder (the same empty state as before any file is opened).
- Given any tab, when I activate its close affordance by keyboard (the focused tab + Delete/Backspace,
  or its close control by Enter/Space), then it closes the same as a click.

### The tree highlight follows the active tab · P1

**As a** developer switching between open files
**I want to** the tree to highlight whichever file is currently active
**So that** I always see where the file I'm reading lives in the project

**Acceptance criteria:**
- Given multiple tabs open, when I switch the active tab, then the tree row for the active tab's file is
  the one rendered selected (and any previously-highlighted row is no longer selected).
- Given no tabs open (empty strip / "Select a file"), when I view the tree, then no row is rendered as
  the open-file selection (the keyboard-focus highlight is unaffected).

### Live updates keep tabs honest · P1

**As a** developer whose open files may change on disk
**I want to** an open file that is deleted to show "no longer available" in its tab's content
**So that** I never read stale content and the strip reflects reality

**Acceptance criteria:**
- Given a file open in a tab is deleted on disk, when the change is observed (watch re-read), then THAT
  tab's content swaps to the "file no longer available" state — its tab stays in the strip so the user
  can close it; other tabs are unaffected.
- Given several files open, when files are created/deleted/renamed under the root, then the tree updates
  automatically (unchanged from #84) and the open tabs are not disturbed except for a deleted open file
  per the rule above.

### Tabs are per-terminal-tab and ephemeral · P1

**As a** developer with multiple terminal tabs
**I want to** each terminal tab to own its own independent set of open file tabs
**So that** browsing files in one terminal does not leak into another

**Acceptance criteria:**
- Given two terminal tabs, when I open files in one, then the other terminal tab's file-tab strip is
  unaffected (each terminal tab has its own open-files collection).
- Given a terminal tab with open file tabs, when the app is closed and reopened, then the file-tab strip
  starts empty (open-file tabs are not persisted across sessions) — consistent with the split ratios and
  viewer state, which are also ephemeral in #84.
- Given a terminal tab whose cwd is cleared / that returns to the welcome view, when it later goes live
  again, then its file-tab strip starts empty.

### A crowded strip stays usable · P2

**As a** developer with many files open
**I want to** the tab strip to stay navigable when it overflows
**So that** I can still reach and close every open tab

**Acceptance criteria:**
- Given more tabs than fit the viewer width, when the strip overflows, then it scrolls horizontally (the
  active tab is kept reachable) rather than shrinking tabs to illegibility or wrapping to a second row.
- Given a long file name, when its tab is rendered, then the label truncates with an ellipsis and a
  tooltip reveals the full name (matching the tree-row truncation idiom).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Open-files collection & transitions

| ID     | Requirement |
|--------|-------------|
| FR-001 | The middle viewer column MUST own an ORDERED collection of open files (each identified by its root-relative path) plus an active file, replacing the single-open-file model. The collection's open/focus/close transitions MUST live in a PURE, node-testable `.ts` module (extending or beside `viewerState.ts`), with no React/DOM/Electron imports, per the `.ts`/`.test.ts` split convention. |
| FR-002 | Clicking a file in the tree MUST open it: if no tab exists for that path, append a new tab for it and make it active; if a tab already exists for that path, MUST focus (activate) the existing tab and MUST NOT create a duplicate. (The collection never holds two entries for the same path.) |
| FR-003 | Activating an existing tab (click or keyboard) MUST make it the active file and show its content in the viewer, without opening or closing any tab. |
| FR-004 | Closing a tab MUST remove only that file from the collection. Closing an INACTIVE tab MUST leave the active file unchanged. Closing the ACTIVE tab MUST make an adjacent tab active (a neighbour: the next tab, or the previous when the closed tab was last), reusing the established adjacency rule (`adjacentActiveId`). |
| FR-005 | Closing the LAST remaining tab MUST empty the collection and return the viewer to the calm "Select a file" placeholder (the same empty state used before any file is opened). |
| FR-006 | The open-files collection MUST be PER terminal tab (`paneId`) and independent: opening/closing files in one terminal tab MUST NOT affect another's collection. |
| FR-007 | The open-files collection MUST be EPHEMERAL: it MUST NOT be persisted to the session snapshot, and it MUST reset to empty when the tab (re-)enters its live phase or the app restarts — consistent with the existing ephemeral split-ratio/viewer state from `terminal-file-explorer-v1`. |

### Viewer content & per-file state

| ID     | Requirement |
|--------|-------------|
| FR-008 | The viewer MUST render the ACTIVE tab's content using the existing per-file states (loading / text via read-only Monaco / image via `cosmos-file://` / binary / denied / not-found), reusing the `resolveRead`/`selectFile` mapping — this feature MUST NOT change how a single file is read or rendered. |
| FR-009 | Each open file's read result (text/image/calm state) MUST be tracked per file so that switching tabs shows the right content. The feature SHOULD avoid a redundant re-read on every tab switch (an already-resolved tab's content MAY be reused; a re-read on switch is acceptable but MUST NOT lose or cross-wire another tab's content). |
| FR-010 | If an OPEN file is deleted on disk (observed via the existing watch re-read), THAT file's tab content MUST swap to the "file no longer available" state (`invalidateOpen`); the tab MUST remain in the strip (the user closes it explicitly), and other tabs MUST be unaffected. |
| FR-011 | No new filesystem capability is introduced: this feature MUST NOT add, change, or remove any `fs:*` IPC channel, the `cosmos-file://` protocol, path confinement, or the watcher contract from `terminal-file-explorer-v1`. It is a renderer-only state + UI extension over already-readable files. |

### Tab strip UI

| ID     | Requirement |
|--------|-------------|
| FR-012 | A tab strip MUST be rendered inside the MIDDLE viewer column (above the viewer body) whenever ≥1 file is open. Each tab MUST show the file's name and an individual close affordance, and the active tab MUST be visually distinct. When zero files are open the strip MUST be absent (the viewer shows the "Select a file" placeholder, full height). |
| FR-013 | The tab strip MUST use the established design-system tokens and tab idiom (the same focus-ring, active treatment, truncation+tooltip, and roving-tabindex keyboard model as the existing panel tab strip / tree rows) so it reads as the same product. It MAY be a lighter bespoke strip rather than the full `PanelTabStrip` (no rename, no `+`, no per-tab status glyphs are required); the plan/design MUST state which and why. |
| FR-014 | When the open tabs exceed the column width, the strip MUST overflow gracefully — horizontal scroll keeping the active tab reachable — rather than wrapping to multiple rows or shrinking tabs to illegibility. Long names MUST truncate with an ellipsis + a tooltip with the full name. |
| FR-015 | The tab strip MUST be keyboard-accessible: the active tab MUST be reachable by Tab; arrow keys MUST move tab focus; Enter/Space MUST activate the focused tab; a close affordance MUST be operable by keyboard (e.g. Delete/Backspace on the focused tab, or Enter/Space on its close control), consistent with the existing strip's ARIA model. |

### Tree integration

| ID     | Requirement |
|--------|-------------|
| FR-016 | The tree's open-file selection highlight MUST follow the ACTIVE tab's file: the row for the active file is rendered selected; when no file is open, no row carries the open-file selection. (The tree's independent keyboard-focus/roving highlight is unaffected.) |
| FR-017 | Opening a file from the tree MUST behave per FR-002 (open-or-focus). The tree row activation path (click / Enter / Space) MUST drive this single transition — there MUST NOT be a separate "open" vs "focus" affordance in the tree. |

## Edge Cases & Constraints

- **Re-click the active file**: clicking the already-active file is a no-op (it stays active; no
  duplicate, no re-open jolt). A re-read MAY occur but the content must not change identity.
- **Close the active tab when it is the only one**: empties the strip → "Select a file" placeholder
  (FR-005), not a crash and not an auto-reopen.
- **Open file deleted while it is the ACTIVE tab**: its content swaps to "file no longer available"
  (FR-010); the tab stays active until the user switches or closes it.
- **Open file deleted while it is an INACTIVE tab**: that tab's content is invalidated lazily/on
  switch (or eagerly via the existing per-open-file re-read on `fs:changed`); it MUST NOT corrupt the
  active tab's content.
- **A file renamed on disk while open**: out of scope to "follow" the rename — the open tab is treated
  as the old path (it invalidates to "no longer available" like a delete); the new name appears as a
  fresh tree entry the user can open. (No rename-tracking in v1.)
- **Many tabs**: the strip scrolls horizontally (FR-014); there is NO per-tab cap and NO "close all /
  close others" affordance in v1 (out of scope).
- **Distinct files with the same basename** (e.g. two `index.ts` in different folders): both may be
  open; tabs are keyed by full relPath, so they are distinct tabs. The label is the basename; the
  tooltip/`title` carries the full relPath to disambiguate. (A VS-Code-style path-suffix disambiguator
  on the label is OPTIONAL / nice-to-have, not required for v1.)
- **Out of scope (v1)**: drag-to-reorder tabs; pinned tabs; a "preview/single-click ghost tab" mode
  (every open is a real persistent tab); split editor groups; persisting open tabs across sessions;
  "close all"/"close others"; rename-following; dirty/unsaved indicators (the viewer is read-only);
  any change to `fs:*`, `cosmos-file://`, confinement, or the watcher.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking three distinct files opens three tabs; the active tab shows the last-clicked file; all three tabs remain in the strip and each shows its own file when activated. |
| SC-002 | Clicking an already-open file focuses its existing tab — the strip never gains a duplicate; the tab count is unchanged. |
| SC-003 | Closing an inactive tab leaves the active file unchanged; closing the active tab activates a neighbour; closing the last tab returns the viewer to "Select a file". |
| SC-004 | Switching tabs re-highlights the tree row for the now-active file; no row is highlighted when the strip is empty. |
| SC-005 | Deleting an open file on disk swaps only that tab's content to "no longer available", leaves the tab in the strip, and does not disturb the other tabs. |
| SC-006 | Two terminal tabs maintain independent file-tab strips; reopening the app starts every file-tab strip empty. |
| SC-007 | The open/focus/close/adjacency transitions are covered by `.ts` unit tests (open new, open-existing-focuses-no-duplicate, close inactive, close active → neighbour, close last → empty, per-`paneId` independence) with no React/Electron imports. |
| SC-008 | An overflowing strip scrolls horizontally with the active tab reachable; long labels truncate with a tooltip; the strip is fully keyboard-operable (focus, activate, close). |

---

## Open Questions

- [x] **OQ-1 — Open-file collection model. RESOLVED (architect default).** An ordered list of open
      files keyed by relPath + an active relPath, modelled in a PURE module mirroring the existing
      `panelTabs.ts` `TabsState<T>` precedent (`openOrFocus` / `close` (adjacency) / `setActive`).
      "Open an already-open file" FOCUSES it (differs from `panelTabs.openTab`, which rejects a
      duplicate id — here we activate instead). Node-tested per the `.ts`/`.test.ts` split.
- [x] **OQ-2 — Tab strip component. RESOLVED (architect default, designer to confirm visuals).** A
      LIGHTER bespoke strip inside the middle viewer column, NOT the full `PanelTabStrip` — file tabs
      need only label + close + active + overflow scroll + roving-tabindex; they do NOT need rename,
      a `+` button, per-tab status glyphs, or kind-by-glyph. It reuses the same tokens, focus ring,
      truncation+tooltip, and keyboard idiom so it reads as the same product. (Designer owns the exact
      visual treatment; if the designer finds `PanelTabStrip` reusable as-is, that is acceptable.)
- [x] **OQ-3 — Persistence of open tabs. RESOLVED (architect default).** Open-file tabs are PER
      terminal tab and EPHEMERAL — NOT persisted to the session snapshot — matching the existing
      ephemeral split-ratio and viewer state from `terminal-file-explorer-v1`. (Persisting open tabs
      across sessions is an explicit out-of-scope follow-up.)
- [x] **OQ-4 — Per-tab content tracking. RESOLVED (architect default).** Each open file's resolved
      viewer state is tracked per file (so a tab switch shows the right content without cross-wiring).
      Whether a tab switch re-reads or reuses a cached resolution is an implementation choice (FR-009)
      — either is acceptable as long as content is never lost or crossed between tabs.

> **All open questions resolved** with stated architect defaults; none block the design step. The
> designer step (Phase 0 in the plan) confirms the tab-strip visual treatment before implementation.
