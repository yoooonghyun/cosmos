# Spec: Share the File Explorer in a Terminal Favorite (model-share) — v1

**Status**: Approved (Open Questions resolved 2026-06-30 — see Resolutions)
**Created**: 2026-06-30
**Supersedes**: — (EXTENDS `cosmos-terminal-favorite-multiplex-v1`; relaxes its FR-017 "terminal pane only")
**Related plan**: `.sdd/plans/cosmos-terminal-favorite-explorer-share-v1.md`

---

## Scope decision (READ FIRST) — v1 is READ-ONLY content-sync

The file viewer is **read-only today** (`readOnly`/`domReadOnly`, no `fs:write` path). v1 ships the
**model-share as read-only content-sync**: both views show the SAME open files and the SAME file
content live (re-read from fs through the source's existing `fs:read`/`fs:changed`), with the
open-files SELECTION shared — but **NO editing and NO save**. **Editability** (writable Monaco + a
confined `fs:write` channel + dirty/save UX) is a **SEPARATE future feature, explicitly OUT of scope
here.** FR-013's edit-sync/`fs:write` framing is therefore DROPPED (see FR-013 below); Scenario 7 is
CUT. The "sync" in v1 = shared content (one `ITextModel` per file) + the shared open-files store.

## Resolutions (Open Questions answered, 2026-06-30)

- **OQ-1 → READ-ONLY content-sync** (the scope decision above). No editing, no `fs:write` in v1.
- **OQ-2 → model registry keyed by `(paneId, relPath)`** via a `cosmos-file://<paneId>/<relPath>`
  Monaco model URI (`getModel(uri) ?? createModel(...)`); rename = close+open, NO model migration.
- **OQ-3 → dispose a model ONLY when (closed in the shared store AND zero attached editor views)** —
  ref-counted; a favorite tab-switch detaches without disposing a model the source still uses.
- **OQ-4 → lifting open-files to the paneId-keyed store is ACCEPTED**, but the plan MUST carry
  single-mount regression tests for the bug-sensitive area (StrictMode `persist-open-files-restore-
  broken-v1` guard, restore/persist, adjacency-close) — prove no regression.
- **OQ-5 → per-view Monaco view-state persistence across active-file switches is NOT required**;
  reset-on-reactivate (current single-mount behavior) is acceptable.
- **OQ-6 → no save/`fs:write` double-fire concern** (no write path in v1); shared models are strictly
  better than doubled — no perf gate.

---

## Grounding

> Direct investigation run for THIS spec. The LLM-wiki tools (`wiki_query`/`wiki_ingest`) and the
> deprecated `memory_*` tools were **not present in this session's toolset**, so prior-decision
> grounding came from reading the committed specs/plans/architecture in-repo (the material the wiki
> was seeded from) plus codegraph. Flagged so the gap is visible.

**codegraph_explore queries run (one-line takeaways):**

- `useExplorerPanes useFileExplorer FileViewer Monaco ITextModel open files active file cosmos-file URI viewer state`
  → `useExplorerPanes(paneId, live, restoredOpenFiles, onOpenFilesChange, onViewerFocusChange)` is the per-tab explorer driver; it calls ONE `useFileExplorer(paneId, live, …)` that holds the open-files collection as **per-mount React state** (`openFiles: OpenFilesState`) plus the tree, root-error and watch lifecycle. Both the MIDDLE viewer column and RIGHT tree dock are backed by that one hook instance. **The open-files SELECTION (ordered files + active relPath + each file's resolved `ViewerState`) is local to the mount** — two mounts of the same paneId would diverge. This is the state FR-002 lifts.
- `MonacoText editor.create createModel ITextModel getModel setModel onDidFocusEditorText fs:read fs:write save`
  → `MonacoText` (in `FileViewer.tsx`) creates **ONE** `monaco.editor.create(container, { value: text, … readOnly })` per viewer column on mount and, on active-file change, does `model.setValue(text)` + `setModelLanguage` **in place** — i.e. today there is exactly ONE model per viewer column, reused by `setValue`, NOT a model per file. The editor is **read-only** (`readOnly` + `domReadOnly`, confirmed in `FileViewer.tsx` header + §4.13). There is **no `fs:write` / save path** anywhere in the file viewer — `write` in main is `ptyManager`'s PTY-stdin write, not a file write. Content arrives via `fs:read`; images via the `cosmos-file://` opaque scheme.
- `useFileExplorer` go-live seed / restore / persist
  → open-files is seeded ONCE on go-live from `restoredOpenFiles` (persist-workdir-open-files-v1) and reported on every change via `onOpenFilesChange` to the debounced session save; the go-live effect is **StrictMode-double-mount-sensitive** (a known prior bug `persist-open-files-restore-broken-v1` — the restored ref is consumed only on a real `enabled` true→false). Any lift of this state MUST preserve that restore/persist contract and the StrictMode guard.

**Base feature read (the thing this builds on):**

- `.sdd/specs/cosmos-terminal-favorite-multiplex-v1.md` + its plan → the base mirrors the **terminal pane only**: `TerminalView` gains a `mirror` (non-owning) prop that (a) never owns `pty:start/dispose/restart`, (b) seeds its xterm from the source pane's live scrollback serializer, and (c) **forces the §4.13 explorer split inert** (`useExplorerPanes(paneId, mirror ? false : live, …)` + renders the terminal column only) — explicitly deferring explorer-share to a follow-up (this spec). Base FR-017 = "mirror scope is terminal pane ONLY"; this spec RELAXES that.

**Architecture cross-refs read:** §3 (Home is a multi-tab container; all panels stay `forceMount`ed when hidden — source explorer and favorite explorer can both be MOUNTED, only one on-screen), §4.13 (terminal 3-pane split; ONE `useFileExplorer` per pane; ephemeral per-pane open-files; read-only Monaco; `fs:*` confined by paneId+relPath; `cosmos-file://`), §4.14 (cross-panel `LivePanelTab` ref-pass seam; Home favorites; `findLiveTab`).

---

## Overview

A pinned **terminal favorite** today mirrors only the terminal pane (the base feature deliberately
makes the §4.13 file-explorer split inert in `mirror` mode). This feature makes a terminal favorite
mirror the **FULL Terminal view** — terminal pane **and** the file-explorer split (viewer + tree +
open files) — so Home shows the same files the source is browsing, live, with independent
cursor/scroll. The mechanism is the same one Monaco itself uses: **share the data instance, render
two views.** A per-file Monaco `ITextModel` (text + language + undo) backs BOTH the source viewer
and the favorite viewer, and the open-files selection is lifted to a paneId-keyed shared store both
explorers read and write. Files/cwd/`fs:*` are already shared (same disk, same root). xterm has no
model/view split, which is why the terminal pane keeps the base multiplex+seed; the model-share
applies ONLY to the Monaco file viewer.

---

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice.

### See the source's open files in the terminal favorite · P1

**As a** Home user with a terminal favorite pinned
**I want to** open the favorite and see the same files the source terminal has open
**So that** Home is a true full mirror of the Terminal view, not just the shell

**Acceptance criteria:**

- Given the source terminal has files open in its explorer split (an active file + others as tabs), when I open the favorite, then the favorite shows the SAME file-explorer split — same open-file tabs, same active file, same tree rooted at the same cwd — beside the mirrored terminal pane.
- Given the source has no files open (empty strip), when I open the favorite, then the favorite's viewer shows the same calm "Select a file" placeholder and the tree dock rooted at the shared cwd.
- Given the source is not yet live (`[Open a folder]` awaiting phase), when I open the favorite, then the favorite shows the same WAITING state as the base feature (no explorer until the source goes live).

### Open / activate / close a file from either view, reflected in both · P1

**As a** Home user viewing a terminal favorite
**I want to** click a file in the favorite's tree (or close a tab) and have it reflect in the source too
**So that** the two views stay one shared selection, not two diverging copies

**Acceptance criteria:**

- Given I click a file row in the favorite's tree, when it opens, then the SAME file becomes the active open-file tab in BOTH the favorite and the source view (one shared open-files store), reading the file's content once.
- Given I close an open-file tab in either view, when it closes, then it closes in BOTH views and the active file re-picks the same adjacency neighbour in both (the existing close rule, single-sourced).
- Given I switch the active file in one view, when it changes, then the other view's active file changes to match.

### Independent cursor and scroll per view · P1

**As a** Home user reading the same file in both the source and the favorite
**I want** each view to keep its own cursor and scroll position
**So that** scrolling one doesn't yank the other (only the content is shared, not the viewport)

**Acceptance criteria:**

- Given the same file is the active file in both the source viewer and the favorite viewer, when I scroll or move the cursor in one, then the other view's scroll/cursor/selection is unaffected.
- Given I expand a directory in one view's tree, when it expands, then the other view's tree expansion is unaffected (tree expansion is per-view navigational state, like scroll).
- Given the file's text is identical in both views (one shared model), when I read it, then both show the same content and the same syntax language.

### The source content changes on disk · P1

**As a** Home user viewing a file in both views while it changes on disk
**I want** the change to appear in both views at once
**So that** the live mirror stays accurate without each view re-reading independently

**Acceptance criteria:**

- Given the active file changes on disk (an `fs:changed` for the pane), when the source re-reads it, then the new content appears in BOTH views (the shared model is updated once), each keeping its own cursor/scroll.
- Given an open file is deleted on disk, when the source detects it, then BOTH views flip THAT tab to the calm "no longer available" state without disturbing sibling tabs.

### The source terminal goes away · P1

**As a** Home user whose pinned terminal's source tab was closed
**I want** the favorite's explorer to degrade calmly along with its terminal pane
**So that** nothing crashes and I'm never left driving a dead explorer

**Acceptance criteria:**

- Given I close the source terminal tab, when I open the favorite, then it shows the same calm "this tab is no longer open" + Unpin state as the base feature (the whole mirror — terminal AND explorer — degrades together); no explorer is shown against a dead pane.
- Given the source tab is closed, then closing/unpinning the favorite NEVER triggers an `fs:watchStop`/`fs:*` teardown that would disturb a still-open source explorer — the favorite never owns the pane's file-system lifecycle.

### Terminal favorites with open files survive relaunch · P1

**As a** user who pinned a terminal favorite while browsing files
**I want** the favorite back after relaunch showing the restored open files
**So that** my workspace is stable end to end

**Acceptance criteria:**

- Given I pinned a terminal favorite and the source pane had files open, when I relaunch, then the source pane restores its open files (existing persist-workdir-open-files-v1 path) and the favorite re-binds to the same shared store and shows them.
- Given the persisted favorite carries only `{panelId:'terminal',tabId,label}` (no open-file paths, no content, no cwd), when it relaunches, then no file path or content is read from the favorite record — the open files come solely from the source pane's own restored slice.

### ~~Editing a shared file reflects in both views~~ · CUT from v1 (read-only scope)

> CUT by OQ-1 resolution. v1 is read-only content-sync — there is no editing and no `fs:write` path.
> Editability (writable Monaco + a confined `fs:write` channel + dirty/save UX) is a SEPARATE future
> feature. The shared `ITextModel` still makes both views show identical content live; it simply is
> never mutated by a user in v1.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. Traces reference
> `cosmos-terminal-favorite-multiplex-v1` (prefixed base-FR-), §4.13/§4.14, and this spec's scenarios.

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | In `mirror` mode, the favorite's `TerminalView` MUST **re-enable the §4.13 file-explorer split** (terminal pane + viewer + tree dock) that the base feature forces inert (base-FR-017). The favorite MUST render the same three-column layout the source Terminal view renders, rooted at the shared cwd of `source.paneId`. This RELAXES base-FR-017 ("terminal pane only"). | base-FR-017 relaxation; §4.13 |
| FR-002 | The **open-files SELECTION state** (the ordered open files + active relPath + each file's resolved `ViewerState`) for a pane MUST be lifted out of the per-mount `useFileExplorer` into a **paneId-keyed shared store** (a renderer-only provider/registry, the same family as `PanelTabsProvider`/`ActiveComposerProvider`) that BOTH the source explorer and the favorite explorer read and write — so both show identical open tabs + identical active file, live. | open-files lift; Scenario 2 |
| FR-003 | Each open TEXT file MUST be backed by a single shared Monaco **`ITextModel`** (the buffer: text + language + undo), held in a **shared model registry keyed by file identity** (`paneId` + root-relative path, equivalently a `cosmos-file://<paneId>/<relPath>` model URI). The source viewer and the favorite viewer MUST each attach an editor VIEW (`setModel`) to the SAME model — so content + language stay identical and live across both. This replaces today's "one editor, `setValue` per file" with "one model per open file, `setModel` per view". | model-share; Scenario 3/6 |
| FR-004 | Monaco **view state** (cursor, scroll, selection, folding) MUST remain **per editor view** — sharing the model MUST NOT share the viewport. Scrolling/cursoring in one view MUST NOT move the other. Tree **expansion** state MAY likewise stay per-view (navigational, like scroll). | Scenario 3 (independent cursor/scroll) |
| FR-005 | Both views MUST render the file **TREE rooted at the shared cwd** of `source.paneId`. The tree lists the same files (same disk, same root). Tree-list reads (`fs:list` on lazy expand) are confined, idempotent reads — whether they may be driven from both views or only the owning view is a plan-level detail (see FR-006); either way both views display the tree. | Scenario 1; §4.13 |
| FR-006 | The favorite explorer MUST be **NON-OWNING** of the pane's file-system lifecycle: it MUST NOT drive `fs:watchStart`/`fs:watchStop`, and content resolution (`fs:read` → `ViewerState`, filling the shared model) MUST be driven by the **single owning source explorer**, written into the shared store/registry both views read. The favorite MUST NOT independently re-read or re-watch (no double `fs:read`/`fs:watch`). (Mirrors the base feature's non-owning terminal-pane principle.) | base non-owning rule; Scenario 4/5 |
| FR-007 | The shared model registry MUST **ref-count** view attachments. A model MUST be created lazily on first open of a file and disposed ONLY when the file is **closed in the shared open-files store AND no editor view remains attached** — closing/unmounting ONE view (e.g. switching away from the favorite tab) MUST NOT dispose a model the OTHER view is still using. The favorite view's unmount-on-tab-switch MUST detach its editor view (decrement) WITHOUT disposing a still-open file's model. | dispose-danger; Scenario 2/3 |
| FR-008 | A terminal favorite's whole mirror — terminal pane AND explorer — MUST degrade together to the base feature's calm GONE / WAITING states keyed off `findLiveTab(registry, 'terminal', source.tabId)`. When the source is GONE, the favorite MUST show no explorer (no `fs:*` against a dead pane) and MUST NOT trigger any `fs:watch`/store teardown that would disturb a still-open source. | base GONE/WAITING idiom; Scenario 5 |
| FR-009 | The shared open-files store and the shared model registry MUST be **renderer-only references** — NEVER crossing IPC, an A2UI surface, or the persisted session beyond the EXISTING per-pane ephemeral/persist seams. File contents are local fs already surfaced via `fs:read`/`cosmos-file://` (non-secret, no token); the favorite record stays `{panelId:'terminal',tabId,label}` only. No new secret surface is introduced. | CLAUDE.md secrets rule; §4.14 seam |
| FR-010 | On relaunch, the favorite's explorer MUST re-bind to the source pane's open files via the **existing** persist-workdir-open-files-v1 restore path (the source pane seeds the shared store from its `restoredOpenFiles`); the favorite reads that shared store. The favorite record MUST carry NO open-file paths/content. | Scenario 6; persist-workdir-open-files-v1 |
| FR-011 | Lifting the open-files state (FR-002) and adopting the per-file model registry (FR-003) MUST NOT **regress the existing single-mount terminal explorer**: the restore/persist contract (`restoredOpenFiles` seed, `onOpenFilesChange` report), the StrictMode double-mount guard (`persist-open-files-restore-broken-v1`), the open-or-focus / adjacency-close / tab-nav behaviour, and the tree-highlight-follows-active rule MUST all behave identically when only one mount exists. | §4.13; no-regression |
| FR-012 | This feature MUST **compose with the base `mirror` prop**: it extends — not replaces — `cosmos-terminal-favorite-multiplex-v1`. In `mirror` mode the favorite now renders the explorer split (against the shared store + model registry) instead of the base's terminal-only column; all base non-owning guarantees for the terminal PANE (no `pty:start/dispose/restart`, scrollback seed, resize guard) remain unchanged. | base composition |
| FR-013 | v1 is **READ-ONLY content-sync** (OQ-1). The shared editor MUST stay `readOnly`/`domReadOnly`; there MUST be NO editing affordance and NO `fs:write` path introduced by this feature. The model-share delivers identical content + language + a single `fs:changed` re-read across both views; user editing/saving is explicitly DEFERRED to a separate future feature. | OQ-1 scope cut; §4.13 read-only |

## Edge Cases & Constraints

- **Read-only by decision (OQ-1).** The Monaco viewer is `readOnly`/`domReadOnly` with no `fs:write` path, and v1 KEEPS it that way. The model-share's benefit in v1 is **content-sync** (identical text/language, a single `fs:changed` re-read updates both) + **independent per-view view state**; no user edit/save occurs. Editability is a separate future feature, not this one.
- **"A file open only in the favorite" can't happen by design.** Because the open-files store is a single shared paneId store both views write (FR-002), opening a file in the favorite opens it in the source too. There is no "favorite-only" open set. (If a future variant makes the favorite a read-only follower, this changes — flagged in Open Questions.)
- **Same file open in both, then one view closes it.** Closing is a store mutation (FR-002): the file leaves the shared store, so it closes in BOTH views; its model is disposed once no view is attached AND it is no longer in the store (FR-007). One view closing it does not strand the other on a disposed model — the close is shared, so both detach together.
- **A model disposed while the other view still uses it (the dispose-danger).** Forbidden by FR-007's ref-count: a model is disposed only at (store-closed AND zero attached views). A favorite tab-switch detaches the favorite's editor (decrement) but, while the file stays open, the source's editor keeps the model alive. This mirrors the base feature's "favorite must not own the PTY lifecycle" — here, "must not dispose a shared model the source still renders".
- **Double `fs:read`/`fs:watch`.** Two explorers naively each driving `fs:read`/`fs:watchStart` would double disk I/O and watcher load. FR-006 makes the source the single fs owner/resolver; the favorite renders off the shared store. (Whether idempotent tree `fs:list` on expand may also be driven from the favorite is a plan detail — FR-005.)
- **Save conflicts / double-write.** N/A in v1 — there is no write path (OQ-1/OQ-6). Recorded only so a future editability feature knows two views on one model would each be able to issue a save and must route to a single save owner.
- **StrictMode go-live seed.** The existing open-files go-live seed has a known StrictMode double-mount bug guard; lifting the state MUST carry that guard forward (FR-011) — a regression here silently wipes restored files on relaunch.
- **Non-text viewers (image/pdf/docx/sheet).** These have no Monaco model — they render off `cosmos-file://` / `fs:read` directly. Two mounts of the same file naturally show identical content; only scroll/zoom diverge (desired, per FR-004). The model registry (FR-003/FR-007) is specifically for the `text` (Monaco) kind; non-text kinds need no shared model, just the shared OPEN-FILES store (FR-002) so the same file is the active tab in both.
- **Out of scope (v1):** editability / writable Monaco / any `fs:write` (OQ-1 — a separate future feature); sharing tree expansion state across views (it stays per-view, like scroll); making the favorite a read-only follower (the store is read+write shared by design); a second independent open-files set in the favorite; persisting open files into the favorite record (they come from the source pane's own slice); per-view per-file Monaco view-state persistence across active-file switches (OQ-5).

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | Opening a terminal favorite shows the SAME file-explorer split as the source — same open-file tabs, same active file, same tree at the same cwd — beside the mirrored terminal pane. |
| SC-002 | Opening/activating/closing a file in EITHER view reflects in BOTH (one shared open-files store), with a single `fs:read` per opened file. |
| SC-003 | The same file open in both views shows identical content + language (one `ITextModel`) while cursor/scroll/selection stay independent per view; an `fs:changed` updates both at once via one re-read. |
| SC-004 | Closing one view (favorite tab-switch / unpin) NEVER disposes a model the other view still uses, and NEVER drives an `fs:watch`/store teardown that disturbs a still-open source explorer (ref-counted dispose; non-owning fs). |
| SC-005 | A gone source degrades the whole favorite mirror (terminal + explorer) to the calm "no longer open" + Unpin state; no explorer renders against a dead pane. |
| SC-006 | After relaunch, the favorite shows the source pane's restored open files via the existing persist path; the persisted favorite record carries only `{panelId:'terminal',tabId,label}` — no open-file path, content, or cwd. |
| SC-007 | The single-mount terminal explorer behaves identically before and after the open-files lift + model-registry adoption (restore/persist, StrictMode guard, open-or-focus/close/nav, tree highlight) — no regression. |

---

## Open Questions — ALL RESOLVED 2026-06-30 (see Resolutions at top)

- [x] **OQ-1 (scope-defining) — editable or read-only?** → **READ-ONLY content-sync**. No editing, no
  `fs:write` in v1; editability is a separate future feature. (FR-013 rewritten, Scenario 7 cut.)
- [x] **OQ-2 — model registry keying.** → key `(paneId, relPath)` via `cosmos-file://<paneId>/<relPath>`
  model URI (`getModel(uri) ?? createModel(...)`); rename = close+open, no model migration.
- [x] **OQ-3 — dispose / ref-count.** → dispose ONLY when (closed in shared store AND zero attached
  editor views); a favorite tab-switch detaches without disposing.
- [x] **OQ-4 — single-mount regression risk.** → ACCEPTED; the plan MUST carry single-mount regression
  tests (StrictMode guard, restore/persist, adjacency-close) proving parity.
- [x] **OQ-5 — per-view Monaco view-state persistence across active-file switches.** → NOT required;
  reset-on-reactivate (current single-mount behavior) is acceptable.
- [x] **OQ-6 — save double-fire / perf of N models.** → moot (no write path in v1); shared models are
  strictly better than doubled — no perf gate.

---

## Notes for the architecture doc (do NOT edit yet)

- **§4.13 (terminal file explorer):** record that a pane's open-files SELECTION (ordered files +
  active relPath + resolved `ViewerState`) is lifted from per-mount `useFileExplorer` state into a
  **paneId-keyed shared store** (renderer-only provider), and that each open TEXT file is backed by a
  single shared Monaco `ITextModel` in a **shared model registry keyed by file identity** — so a
  pane may now have MORE THAN ONE explorer VIEW (source + a Home favorite) rendering the SAME open
  files + SAME models, with per-view cursor/scroll/tree-expansion. The source explorer remains the
  single owner of `fs:read`/`fs:watch` and the model-fill; the favorite is non-owning. The viewer
  stays read-only unless/until editability is separately specced.
- **§4.14 (Home favorites):** the base feature's "terminal favorite mirrors the terminal pane only"
  becomes: a terminal favorite mirrors the FULL Terminal view — terminal pane (xterm multiplex +
  scrollback seed, unchanged) PLUS the file-explorer split via the shared open-files store + shared
  Monaco model registry. xterm has no model/view split (hence multiplex+seed for the terminal); the
  Monaco viewer DOES (one `ITextModel`, many editor views) — the clean "share the buffer, render
  each" applied to the file viewer.

## Sequencing note (HARD — record in the plan)

This feature **BUILDS ON `cosmos-terminal-favorite-multiplex-v1`** and MUST land AFTER that base
feature merges. It re-enables the explorer split the base makes inert and extends the same
`TerminalView` `mirror` prop, the same `FavoriteSurface`/`TerminalFavoriteSurface` terminal branch,
and the explorer hooks (`useExplorerPanes`/`useFileExplorer`). Implementation MUST rebase on the
settled base-feature code before starting. Open Questions are RESOLVED (see Resolutions at top); the
plan `.sdd/plans/cosmos-terminal-favorite-explorer-share-v1.md` is written against those resolutions.
