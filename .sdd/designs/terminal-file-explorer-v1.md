# Design: Terminal File Explorer — v1

**Status**: Draft (designer step / Phase 0)
**Created**: 2026-06-20
**Spec**: `.sdd/specs/terminal-file-explorer-v1.md`
**Plan**: `.sdd/plans/terminal-file-explorer-v1.md`
**Owns**: the visual contract for the per-tab terminal⇆explorer split, the file tree, the
resizable divider, and the in-right-pane read-only file viewer (Monaco text + `cosmos-file://`
image + not-previewable / not-found states). Single-mode DARK, cosmos VS Code palette, existing
tokens + shadcn primitives only.

---

## Grounding

> Tools I ran directly for this design pass (CLAUDE.md SDD rule — not handed in). Each pointer
> re-verified against the current tree.

**memory_recall**

- `cosmos design system tailwind shadcn terminal` → **empty** (no stored prior decision for a
  file explorer or a split layout). Closest standing preferences (MEMORY.md): cosmos UI = a real
  Tailwind + shadcn design system (use the primitives, not hand-rolled); dark-first VS Code
  palette; `feedback_design_system`. No conflict, nothing to reconcile. The split/viewer/divider
  decisions below are new standards — persisted via `memory_save` at the end.

**codegraph_explore**

- `TerminalPanel panel tab chrome PanelRefreshButton useGenerativePanelTabs` → `TerminalPanel.tsx`
  hosts a per-tab `TerminalView` stack keyed by `paneId`; ALL views stay mounted, only the active
  one is shown (`display: active ? 'flex' : 'none'`). The per-tab area is a plain flex **column**
  today: `<div className="flex min-h-0 flex-1 flex-col" role="tabpanel">` wraps the stack. The
  panel `<section className="flex h-full min-w-0 flex-col border-l border-border bg-card">` carries
  `PanelTabStrip` (top) + the stack + `PanelFooter` (bottom). The explorer + divider slot INTO each
  `TerminalView`'s `.terminal-panel` box, to the RIGHT of the xterm fill.
- The terminal pane surface is **`var(--card)` `#1b1b1c`** (`.terminal-panel { background: var(--card) }`,
  and the xterm theme is read from `--card` — bug `terminal-panel-tone-mismatch-v1`). So the
  explorer beside it sits on the SAME `bg-card` family — they read as one panel, divided.
- `PanelTabStrip` strip band = `h-8 bg-popover border-b border-border`; tabs use `border-r
  border-border`, active tab `bg-background` with a brand-gradient top accent; `focus-visible:ring-[3px]
  ring-ring/50` is the house focus ring. The roving-tabindex tablist pattern + `Tooltip` wrapping is
  the chrome precedent I match for tree-row focus and the divider.
- `PanelFooter` = `h-7 bg-popover border-t border-border text-[11px] text-muted-foreground`; left
  cluster names the surface, status glyph swaps in on in-flight/error. Unchanged by this feature.

**Component/primitive reads** (`src/renderer/components/ui/`): `Button` (variants
`default/cosmos/destructive/outline/secondary/ghost/link`; sizes `xs/sm/default/lg/icon*`),
`ScrollArea` (Radix viewport + `bg-border` thumb — the house scroller), `Skeleton`
(`animate-pulse rounded-md bg-accent`), `Alert` (`default`/`destructive`, used as the house
`Notice`), `Tooltip`, `components.json` (new-york, lucide, `cssVariables`). No **resizable/Drawer/Sheet**
primitive exists (the `resizable` grep hits are all in specs/plans/docs, never in `components/ui/`).

**Precedents reused verbatim**

- `terminal-open-directory-picker-v1` design → the awaiting-directory empty state (`FolderOpen size-7
  text-muted-foreground` + title + helper + `Button variant="cosmos" size="sm"`). The explorer's
  awaiting-disabled state mirrors it (§5.1).
- `slack-thread-sidepanel-and-image-viewer-v1` design → the **viewer header + Back/close affordance**,
  the **`onError` → `ImageOff` fallback**, the **`Notice`/`Alert` (destructive) + Retry** error
  posture, the `bg-popover` image surface, the `bg-black/N` on-image chrome convention. I follow it so
  the file viewer reads as the same product as the Slack image viewer.
- `confluenceCatalog/contentImageSrc.ts` → the `cosmos-…-img://` base64url-relative-path src builder
  pattern. The renderer's `cosmos-file://` URL builder (plan: `localFileRef`/a small renderer helper)
  mirrors it exactly; the `<img>` consumes that opaque src, no token, no bytes-over-IPC.

**Index.css tokens consulted** (single source of truth, dark `.dark` block): `--card #1b1b1c`,
`--background #1e1e1e`, `--popover #252526`, `--border #333`, `--foreground #e0e0e0`,
`--muted #252526`, `--muted-foreground #888`, `--primary #4a9eff`, `--accent #2d2d30`,
`--ring #4a4a4c`, `--destructive #f3b0b0`, brand `--brand-pink/--brand-purple/--brand-foreground`.

**Conclusion:** the whole surface is expressible in existing tokens + existing shadcn primitives.
**No new token. No new shadcn primitive.** The resizable divider is plain Tailwind + a pointer-drag
handle on existing surfaces (D-3 — a split-pane library is explicitly NOT added). Justification in §9.

---

## 1. Surfaces & layout

Everything lives INSIDE each `TerminalView`'s `.terminal-panel` box in `src/renderer/TerminalPanel.tsx`
(one per tab, all mounted, only active shown). The panel `<section>`, `PanelTabStrip`, and
`PanelFooter` are **untouched** — the split is internal to the tab body, so all five rail panels keep
identical outer chrome.

### 1.1 The three-pane layout (terminal LEFT, viewer MIDDLE, tree dock RIGHT) — D-1

> **3-pane rework.** The earlier two-pane split (terminal LEFT | explorer RIGHT, where the explorer
> pane *toggled* between tree and viewer) is replaced by a VS-Code-like **three-column** layout. The
> file **tree** is now a **persistent right-side dock that is ALWAYS visible** — clicking a file opens
> its viewer in a **separate MIDDLE column** rather than replacing the tree. There is no "back to tree"
> affordance (the tree never went away); selecting another row just retargets the middle viewer.
>
> **Welcome-view gate.** BEFORE a folder is opened the tab shows ONLY a single centered **welcome view**
> (the VS-Code-style [Open a folder] CTA — §5.1) — NO split, NO dividers, NO tree dock, NO viewer. The
> three-column split appears ONLY once a folder is open (`isFolderOpen(phase) === true`, the live
> phase). The xterm container stays mounted (hidden) behind the welcome view so the live PTY attaches
> to the same element once a folder is chosen.

Today `.terminal-panel` is a vertical column holding the xterm fill (+ the awaiting empty state / exit
banner). We turn the LIVE-phase body into a **horizontal flex row** of three columns separated by two
dividers: terminal | divider A | file viewer | divider B | file tree dock. The awaiting-phase empty
state (§5.1) and the exit banner are unchanged in placement (they belong to the terminal/left side).

```
TerminalView .terminal-panel   (display:flex; bg-card #1b1b1c — unchanged surface)
  LIVE phase →  flex-row:
  ┌──────────────────────┬───┬─────────────────────────┬───┬──────────────────┐
  │  Terminal (LEFT)     │ ‖ │  File viewer (MIDDLE)    │ ‖ │ File tree dock   │
  │  .terminal-panel     │ A │  FileViewer:            │ B │ (RIGHT)          │
  │   __xterm            │ d │   • selected file       │ d │ FileTree —       │
  │  xterm fill, kept    │ i │     (Monaco / image)    │ i │ ALWAYS visible,  │
  │  mounted (PTY +      │ v │   • "Select a file"     │ v │ never replaced   │
  │  scrollback survive) │ . │     placeholder if none │ . │ by the viewer    │
  └──────────────────────┴───┴─────────────────────────┴───┴──────────────────┘
     flex-basis (resize)  6px      flex: 1 1 0 (the rest)  6px   flex-basis (resize)
```

- **Wrapper**: the live-phase body is `<div className="flex min-h-0 flex-1">` (row), marked
  `@container/termtab` so the explorer can gate its own narrow behavior on the *tab's* width, not the
  window (same reasoning the Slack thread pane uses — a terminal tab is one resizable column inside a
  multi-panel workspace).
- **Terminal column (left)**: keeps `.terminal-panel__xterm` (`flex: 1 1 auto; min-height:0`), wrapped
  so its WIDTH is driven by divider A. `min-w-0` + a controlled `flex-basis`/width (the resize state).
  **It is never unmounted** (FR-013): opening/retargeting a file only touches the MIDDLE column. On a
  divider-A drag the developer re-fits the terminal (FitAddon) — same `safeFit()` + `pty.resize` path
  the window-resize observer already uses.
- **File viewer column (middle)**: `<div className="flex min-h-0 min-w-0 flex-col border-l border-border
  bg-card">`. Takes the remaining width (`flex: 1 1 0`). Shows the selected file (Monaco text / image)
  or — when no file is selected — a calm low-emphasis **"Select a file"** placeholder (§4). The
  viewer no longer replaces the tree, so it has **no header Back affordance**.
- **File tree dock column (right)**: `<div className="flex min-h-0 min-w-0 flex-col border-l border-border
  bg-card">` with a controlled `flex-basis`/width (the resize state). `border-l border-border` (`#333`)
  is the established panel divider line. The tree is **always visible** once live (lazy expand, seamless
  `fs.watch` refresh, roving-tabindex a11y — all unchanged §2); the open file's row renders selected.

### 1.2 Default split ratios & min widths

- **Default ratios: terminal ~50% / viewer ~25% / tree dock ~25%.** The terminal stays the primary
  surface; the viewer needs comfortable Monaco width when a file is open; the dock is a compact
  navigation rail. Implement as the terminal and dock controlled `flex-basis` (50% / 25%) with the
  middle viewer taking the rest (`flex: 1 1 0`) — NOT competing `flex-1`s.
- **Min widths (clamp the drags, FR-002):** terminal **min `20rem` (320px)**; tree dock **min `16rem`
  (256px)** (tree rows read without truncating to nothing); middle viewer **min `15rem` (240px)** so it
  never collapses to nothing. Each divider clamps so no column drops below its min; a divider stops, it
  never collapses a column to zero. (No "collapse/hide" affordance in v1 — out of scope.)
- **Persistence:** both column widths are renderer-local, per the panel's lifetime; not persisted to the
  session snapshot in v1 (no FR asks for it). A reopened app resets to the defaults.

### 1.3 The resize handle (divider) — D-3, NEW pattern (no library)

A **6px-wide vertical drag handle** sitting on the seam between the panes. Plain Tailwind + a
pointer-drag handler — **no `react-resizable-panels` / Sheet / split-pane dependency** (D-3, §9).

- **Element**: a `<div role="separator" aria-orientation="vertical">` placed between the two panes (or
  absolutely-positioned hit area straddling the `border-l`). It is `w-1.5` (6px) and full height,
  `cursor-col-resize`, `shrink-0`.
- **Rest**: visually it is just the `border-border` seam (the explorer's `border-l` provides the 1px
  line); the 6px handle is transparent over it so the seam stays a thin `#333` line at rest — calm, VS
  Code-like.
- **Hover / active (dragging)**: the handle shows a `bg-primary/70` (`#4a9eff` at 70%) 2px-ish highlight
  centered on the seam — `hover:bg-primary/40`, `data-[dragging=true]:bg-primary/70`. Use a centered
  pseudo/inner bar (`w-px` → `w-0.5`) so the highlight is a crisp accent line, not a fat block. This is
  the one accent the divider gets; it matches the brand/primary accent language used on the active tab.
- **Keyboard (a11y, FR-002):** as a focusable `role="separator"` (`tabIndex={0}`), Left/Right arrows
  nudge the split by a step (e.g. `16px`; Shift+Arrow = `64px`), clamped to the §1.2 mins.
  `aria-label="Resize terminal and file explorer"`, `aria-valuenow` optional (the ratio %). Focus ring:
  the house `focus-visible:ring-[3px] ring-ring/50` (inset/centered so it reads on the seam).
- **Reduced motion**: the highlight is a color change only (no transform animation), so nothing to gate;
  keep a short `transition-colors` which is fine under reduced motion.

> The divider is a **bespoke composite over plain elements** (like `PanelTabStrip` is over `Button`/
> `Tooltip`), NOT a new `components/ui/` primitive — there is exactly one consumer. If a second split
> surface ever appears, promote it to `components/ui/resizable.tsx` then; do not pre-build it now (§9).

---

## 2. The file tree (the RIGHT dock — always visible)

The tree dock is rooted at the tab's cwd (FR-003/FR-004) and is **always visible** once live (3-pane
rework — it is never replaced by the viewer). It is a **scrolling list of rows**; directories
disclose/collapse, files open/retarget the middle viewer. The open file's row renders selected.

### 2.1 Anatomy

```
FileTree (RIGHT dock)  flex min-h-0 min-w-0 flex-col bg-card
├─ (optional) tree header   h-7 px-2  text-[11px] text-muted-foreground  → the root dir name (truncate)
└─ ScrollArea  min-h-0 flex-1                 (the house scroller)
   └─ tree rows (role="tree" / role="treeitem")
      ▸ src            ← dir, collapsed (ChevronRight + Folder)
      ▾ components     ← dir, expanded  (ChevronDown + FolderOpen)
        · Button.tsx   ← file, indented one level (File / lang glyph)
        · card.tsx
      ▸ node_modules
      · package.json   ← file at root
```

- **Header (root label)**: a thin `h-7` row showing the **basename of the root** (the cwd) in
  `text-[11px] text-muted-foreground truncate px-2`, with a small `FolderOpen` glyph. Mirrors the
  `PanelFooter` band scale so the explorer has a quiet title without competing with the tab strip.
  (Optional but recommended — it orients the user to which directory they're in; if dropped, the tree
  starts at the top with no header.)

### 2.2 Row treatment

One row component (suggested `FileTreeRow`). Base row classes:

```
group/row flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-[13px]
text-foreground/90 select-none outline-none
hover:bg-accent
focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset
data-[selected=true]:bg-accent data-[selected=true]:text-foreground
```

- **Height `h-7` (28px)** — dense but comfortable; matches the footer/header band and reads as a tight
  IDE tree.
- **Indent**: each depth level adds left padding. Use an inline `style={{ paddingLeft: depth*12 + 8 }}`
  (a 12px step + an 8px base) rather than nested margins, so deep trees stay aligned and the hover/focus
  background still spans the full row width. (The disclosure chevron sits within that left padding so
  files and folders at the same depth align under each other.)
- **Disclosure (folders only)**: a leading **chevron** in a `size-4` slot.
  - Collapsed: `ChevronRight`; Expanded: `ChevronDown`. `text-muted-foreground`, `size-3.5`.
  - The whole row toggles the folder on click (VS Code behavior); the chevron is a visual affordance,
    not a separate hit target (keeps one tab stop per row).
  - **Files** get an empty `size-4` spacer in the chevron slot so their icon/name align under a folder's
    name (not under its chevron).
- **Icon (lucide)** in a `size-4` slot after the chevron:
  - Directory collapsed → `Folder`; expanded → `FolderOpen`. `text-muted-foreground` (folders are
    chrome, not the focus).
  - File → `File` by default. **Light, OPTIONAL extension hinting** (keeps it cohesive, not a full
    icon-theme): `FileCode` for code-ish extensions (`.ts/.tsx/.js/.jsx/.json/.css/.html/.py/.rs/.go/.sh`
    …), `FileImage` for the supported image types, `FileText` for `.md/.txt`. All `text-muted-foreground`
    `size-3.5`. Keep the mapping small and in a pure helper; if it grows, that's a system decision, not a
    per-row hack. Default file glyph (`File`) is always an acceptable fallback — do not block on the map.
  - **Symlink affordance** (`FsEntry.isSymlink`): overlay/append a tiny indicator so a symlink is
    distinguishable (Edge Case: broken/dangling symlink). Treatment: render the name in
    `italic text-muted-foreground` AND set the row `title`/`aria-description` to "symlink". (Avoid a
    second glyph crowding the `size-4` slot; italic + tooltip is enough and matches the "Untitled" italic
    convention already in the tab strip.) A symlink that fails to read/expand falls to the §2.3 error/
    unavailable affordance on that row, never a crash.
- **Name**: `<span className="min-w-0 truncate">{name}</span>` — single line, ellipsis on overflow.
  A `Tooltip` (house `Tooltip`, `side="right"` or `bottom`) shows the full name when truncated (match the
  tab-strip tooltip precedent).
- **Selected vs open**: `data-[selected=true]` = the row whose file is open in the viewer (or the
  keyboard-focused row). Selected uses `bg-accent` (`#2d2d30`) — one notch above hover, no border, no
  brand accent (the tree is utilitarian; brand accent is reserved for the active TAB and the divider).
- **Sort** (FR-005): directories first, then files, each alphabetical case-insensitive — enforced in the
  pure `tree.ts`; the row component just renders the given order.

### 2.3 Tree state matrix

| State | Treatment | FR / source |
|-------|-----------|-------------|
| **Loading** (root list, or a folder's first expand) | `Skeleton` rows: 6–8 stacked `Skeleton` bars at row height — `<Skeleton className="h-3.5 my-[7px] mx-2 w-[60%] …" />` with varied widths (`w-[40%]…w-[70%]`) and indent so it reads as a tree filling in, not a block. On a FOLDER expand, show 2–3 skeleton child rows indented under the expanded folder while its `fs:list` is outstanding. | FR-004; house `Skeleton` |
| **Populated** | Rows per §2.2, sorted. | FR-004/FR-005 |
| **Empty (empty directory)** | The root (or an expanded folder) with zero entries: a quiet inline line, NOT a big hero. Root-empty: a centered small block `flex flex-col items-center justify-center gap-2 py-8 text-center` with `FolderOpen size-6 text-muted-foreground` + `<p className="text-xs text-muted-foreground">This folder is empty.</p>`. Folder-empty (expanded dir with no children): a single muted child row `<p className="px-2 py-1 text-xs italic text-muted-foreground" style={indent}>Empty</p>`. | Edge Case "empty dir"; house empty pattern |
| **Error (root list failed / denied / root gone)** | The house `Notice` = `Alert variant="destructive"` (`border-destructive/40 bg-destructive/15`, `TriangleAlert` glyph, `text-destructive`) inline at the top of the pane: "Couldn’t read this folder." + reason when known (denied / unavailable). Followed by a **Retry** `Button variant="outline" size="sm"` that re-lists. The TERMINAL pane is unaffected. For a per-FOLDER list failure, show the `Notice` (compact) as that folder's child slot instead of children, with Retry — siblings still list (a denied entry never aborts the sibling listing, FR per Edge Case "permission denied"). | FR per Edge Cases; reuse `Notice`/`Alert` |
| **Disabled / awaiting-directory** | See §5.1 — the explorer pane shows the disabled placeholder; NO tree, no list/watch. | FR-006 |
| **Watch-driven refresh** | SEAMLESS — see §6. Re-list merges into existing expanded state; expanded folders stay expanded, scroll position holds, NO skeleton flash, NO collapse. | FR-014/§6 |

`aria-busy` is set on the tree region while the root list is loading (matches the list panes elsewhere).

---

## 3. Scroll & density

- The tree scrolls vertically inside the house **`ScrollArea`** (`min-h-0 flex-1`), so the explorer
  header (if present) stays pinned and only the rows scroll — same scroller, thumb (`bg-border`), and
  overscroll behavior as every other panel list.
- Horizontal: long names **truncate** with a tooltip (§2.2) rather than horizontal-scrolling the tree
  (a horizontal scrollbar on a file tree is noisy). The Monaco viewer (§4) owns its own horizontal
  scroll for code.
- The explorer is independent of the terminal's scrollback — they scroll separately.

---

## 4. The read-only file viewer (the MIDDLE column) — D-1 / FR-008/FR-013

**Decision (3-pane rework): the viewer is its OWN MIDDLE column** — it does NOT replace the tree. The
tree dock (RIGHT) is always visible; clicking a file row OPENS or RETARGETS the middle viewer. Rationale:
this is the normal-IDE "you clicked a file, now you're reading it" model (FR-008) while keeping the file
list always in view (VS Code's editor + explorer side-by-side). Because the tree never goes away, the
viewer has **no Back affordance** — selecting another row simply retargets the column. When NO file is
selected the middle column shows a calm **"Select a file"** placeholder (it is always reserved, never
collapsed — see the TerminalPanel `ponytail:` note). The **terminal (left) stays mounted and live the
whole time** (FR-013) — opening/retargeting a file only touches the middle column.

```
FileViewer (MIDDLE column)   flex min-h-0 min-w-0 flex-col bg-card
├─ Viewer header   h-8 flex items-center gap-1.5 border-b border-border px-2.5   (only when a file is open)
│   ├─ file glyph    (FileCode / FileImage / File — same map as the tree row)  size-3.5 muted
│   └─ <span> name   truncate text-[13px] font-medium text-foreground   flex-1   (title=full relPath)
├─ Body   min-h-0 flex-1   →  text (Monaco) | image | not-previewable | not-found  (states §4.3)
└─ (no file) "Select a file to preview it here."  centered MousePointerClick + muted text (placeholder)
```

### 4.1 Viewer header (FR-008)

- **No Back affordance (3-pane rework).** The tree dock (RIGHT) is always visible, so there is nothing
  to "go back to" — the header is just the glyph + name. The open file's row is rendered **selected** in
  the dock (`selectedRelPath`), so the user keeps their place; clicking another row retargets the viewer.
- **File name** = the basename, `text-[13px] font-medium text-foreground truncate`, with the full
  root-relative path as the `title` (and, if there's width, a dim `text-[11px] text-muted-foreground`
  path segment after it). Never show an absolute path — the renderer only ever holds `relPath` (plan D-2).
- The header band (`h-8 bg-card border-b border-border`) is one notch quieter than the tab strip
  (`bg-popover`) so the viewer reads as content within the explorer, not a second tab bar.

### 4.2 Calm presentation of huge files/images (FR-010/FR-012 — no size cap)

There is **no size cap**; the design's job is to make a large file/image feel calm, not chaotic.

- **Text (Monaco)**: Monaco virtualizes its viewport, so a huge file does not blow up the DOM. Configure
  read-only Monaco (§4.3) with `wordWrap: 'off'` (real horizontal scroll for code), `minimap.enabled:
  false` initially (the pane is narrow; a minimap would crowd it — keep it off for v1; can revisit),
  line numbers ON, `readOnly: true`, `domReadOnly: true`, `scrollBeyondLastLine: false`. The Monaco
  theme is configured to the cosmos palette (background `--card #1b1b1c`, foreground `--foreground`,
  gutter/line-number `--muted-foreground`, selection on `--accent`) so it matches the xterm-on-`--card`
  surface beside it — they read as one product, NOT a default-white or default-`vs-dark` Monaco. (See §8
  developer handoff: build a small `cosmos-dark` Monaco theme from the CSS vars, the same way
  `terminalTheme.ts` reads tokens for xterm.)
- **Image**: `<img>` whose `src` is the `cosmos-file://` opaque URL (§7), centered in a scrolling box:
  the image displays at **natural size** (no cap), but the viewer body is `overflow-auto` so a very large
  image scrolls within the pane rather than forcing the layout wide — calm by default. Provide a small
  **Fit / 100% toggle** (optional, recommended): default **Fit** = `max-w-full max-h-full object-contain`
  centered on the `bg-popover`-family backdrop (letterboxing reads as intentional dark chrome, per the
  Slack viewer); **100%** = natural size in the `overflow-auto` box for pixel inspection. The toggle is a
  `Button variant="ghost" size="xs"` in the header right ("Fit" ⇄ "100%"). If the toggle is dropped for
  v1, default to **Fit** (the calmer choice). Background for the image area: `bg-popover` (`#252526`) so
  any transparency/letterbox is dark chrome, not white.
- Either way, **no spinner thrash**: the dark surface IS the resting state while Monaco mounts / the
  image streams (mirrors the Slack viewer's "no spinner over a dark surface" reasoning). A brief Monaco
  mount shows the empty dark editor surface, not a flash.

### 4.3 Viewer state matrix

| State | Treatment | FR |
|-------|-----------|----|
| **Loading** (`fs:read` outstanding / Monaco mounting / image streaming) | The header (Back + name) is already shown the instant a file is clicked (so the click feels immediate). Body: the dark `bg-card` (text) / `bg-popover` (image) surface as the resting state — NO spinner over the dark surface. If `fs:read` is perceptibly slow, a single centered `Loader2 size-4 animate-spin text-muted-foreground` MAY appear after a short delay; default is the calm dark surface (YAGNI — refs are local). `aria-busy` on the body while reading. | FR-008 |
| **Text (loaded)** | Read-only Monaco (cosmos-dark theme), language inferred from extension, value = `text`, line numbers, horizontal scroll, whitespace preserved (§4.2). | FR-009 |
| **Image (loaded)** | `<img src="cosmos-file://…">` at natural size, Fit/100% per §4.2, on `bg-popover`. | FR-010 |
| **Not previewable (binary / unsupported)** | NEVER raw bytes. A centered calm block: `flex flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground` with a `FileQuestion` (or `FileX2`) glyph `size-8`, `<p className="text-sm">Preview not available</p>`, and a `<p className="text-xs">` reason line ("This file is binary." / "Can’t preview this file type."). The header (name + Back) stays so the user can go back. | FR-011 |
| **Denied (OS permission)** | Same calm block, glyph `Lock` (or `ShieldAlert`) `size-8 text-muted-foreground`, `Preview not available` + reason "You don’t have permission to read this file." NOT the destructive red `Notice` — a denied read is an expected, benign outcome, not an app error (keep red for true failures). | FR-011 |
| **File no longer available** (deleted while open — observed via watch or re-read) | The viewer SWAPS to a calm block: `FileX2` `size-8 text-muted-foreground`, `<p className="text-sm">This file is no longer available</p>`, `<p className="text-xs">It may have been moved or deleted.</p>`. NO stale content, NO crash. The tree dock (always visible) reflects the deletion via the watch re-list (§6); the user can just click another row. | FR-017 |
| **Image broken / failed stream** (`onError` on the `<img>`) | Mirror the Slack viewer fallback: swap the image for `flex flex-col items-center justify-center gap-2 p-10 text-muted-foreground` + `ImageOff size-8` + `<p className="text-sm">Image unavailable</p>`. Stays in the viewer; pick another file from the dock. (This is the `cosmos-file://` broken-image case from FR-028.) | FR-010/FR-011 |
| **No file selected** | The middle column's calm placeholder: centered `MousePointerClick size-6 text-muted-foreground/70` + `<p className="text-xs">Select a file to preview it here.</p>`. The viewer column is always reserved (never collapsed). | — |

All "preview not available / not found" blocks share ONE inner layout (glyph + title + reason) so they
read as the same calm state, only the glyph/copy differ — consistent, never alarming.

---

## 5. Awaiting-directory & lifecycle states

### 5.1 Awaiting-directory explorer (FR-006)

When the tab is in its `phase === 'awaiting'` state (no chosen cwd), the WHOLE tab is the single
centered **welcome view** — the VS-Code-style [Open a folder] CTA, full width. There is NO split, NO
divider, and NO tree-dock/viewer placeholder column while awaiting: the split chrome (dividers + viewer +
tree dock) is not rendered at all, and no `fs:list`/`fs:watch` is issued. The xterm container stays
mounted but hidden behind the welcome view (so the live PTY attaches to the same element on go-live).

- Welcome view treatment: `flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6
  text-center select-none` with `FolderOpen` (lucide) `size-7 text-muted-foreground`, a `text-sm
  font-medium` "Open a folder to start" line + a `text-xs text-muted-foreground` subtitle, and the
  `Button variant="cosmos" size="sm"` [Open a folder] CTA (reuses the #75 directory-picker flow; spinner
  "Opening…" while the dialog is open). On a chosen folder the tab flips to `live` and the 3-pane split
  renders; on cancel it stays on the welcome view (no error).
- When the folder is later cleared (only if such a path exists), the tab returns to this welcome view.
  v1 has no explicit "close folder" action, so this is just the INITIAL no-folder state.
- **Transition to live**: when the directory is picked and the session spawns (`phase → 'live'`), the
  explorer populates (root `fs:list` + `fs:watchStart`) and the placeholder is replaced by the tree
  (loading → populated). Instant swap, consistent with the left pane going xterm-live.

### 5.2 Exit / restart

The terminal exit banner (`.terminal-panel__exit`) and Restart are unchanged and belong to the LEFT
pane. The explorer stays rooted at the same cwd across a restart (same `paneId`/cwd); if the root has
become inaccessible, the tree shows the §2.3 error/"directory unavailable" state — the terminal pane is
unaffected (Edge Case "root deleted").

---

## 6. Watch-driven refresh — SEAMLESS (FR-014)

The single most important "feel" requirement: live updates must be **invisible** — no flash, no
collapse, no scroll jump.

- On a debounced `fs:changed { paneId }`, the renderer **re-lists the currently expanded directories**
  and **merges** the result into existing tree state via the pure `tree.ts` merge (plan): expanded
  folders STAY expanded, unchanged rows keep identity, scroll position holds, the selected/open row stays
  selected.
- **No skeleton on a re-list.** Skeletons appear only on the FIRST list of a directory (initial root /
  first expand), never on a watch-driven re-list — otherwise the tree would flicker on every file save.
  A re-list updates rows in place: new files fade in at their sorted position, deleted rows are removed,
  renames swap the name. (Optional: a very subtle `transition-opacity`/`transition-colors` on
  added/removed rows; keep it under ~120ms and gate nothing heavy — the default of an instant in-place
  update is acceptable and is the calmest baseline.)
- If the **open file** is deleted (observed via watch), the viewer flips to the §4.3 "file no longer
  available" state; the always-visible tree dock reflects the deletion via the same re-list.
- The footer/tab chrome does NOT flash a spinner on a watch re-list (a re-list is not a tab "run").

---

## 7. Image delivery via `cosmos-file://` (FR-010/FR-028) — visual contract only

The image `<img src>` is the opaque `cosmos-file://file/<paneId>/<base64url(relPath)>` URL, built by a
small renderer helper that **mirrors `confluenceCatalog/contentImageSrc.ts`** (base64url-encode the
root-relative path under a fixed authority; no host, no token, no bytes). The renderer/DOM only ever
holds the opaque scheme. The visual consequences the design relies on:

- A forged/out-of-root/missing ref resolves to a **broken image** (non-2xx) → the §4.3 "Image broken"
  `onError` fallback (`ImageOff`). The design never assumes the stream succeeds.
- The renderer **CSP `img-src`** must include `cosmos-file:` alongside the existing
  `cosmos-confluence-img:` / `cosmos-slack-img:` entries, or images silently won't load (developer wiring,
  §8). This is a build/CSP concern, flagged here because it directly governs whether the image state
  renders.

No token, no secret, no absolute path crosses into the renderer for images (consistent with the app-wide
rule and the confluence/slack image precedents).

---

## 8. Interaction & accessibility

**Focus order across the tab** (when a live tab is active):
`PanelTabStrip` (the tab buttons) → **terminal (xterm)** → **divider** (`role="separator"`, Tab-reachable)
→ **explorer** (tree, OR viewer when a file is open) → `PanelFooter`. The terminal keeps its existing
auto-focus-on-activate behavior; tabbing past it reaches the divider, then the explorer.

**Tree (a11y):**
- Container `role="tree"`, rows `role="treeitem"` with `aria-expanded` on folders, `aria-level` =
  depth, `aria-selected` on the open/focused row. Use a **roving tabindex** over rows (active row
  `tabIndex={0}`, others `-1`) — the same pattern `PanelTabStrip` uses, so the tree is keyboard-navigable
  consistently with the rest of the app.
- **Keyboard**: Up/Down move row focus; Right expands a collapsed folder (or moves into the first child if
  already expanded); Left collapses an expanded folder (or moves to the parent); Enter/Space activates —
  toggles a folder, opens a file in the viewer; Home/End jump to first/last. This is the standard ARIA
  tree-view keymap. Type-ahead (jump to a row by typing its name prefix) is OPTIONAL/nice-to-have, not
  required for v1.
- Focus ring: `focus-visible:ring-2 ring-ring/60 ring-inset` on the row (house ring, inset so it reads
  within the dense row). Selected `bg-accent` is distinct from the focus ring so focus and selection are
  both legible.

**Divider (a11y):** `role="separator"`, `aria-orientation="vertical"`,
`aria-label="Resize terminal and file explorer"`, Tab-focusable, Left/Right arrows resize (§1.3),
house focus ring. Pointer drag and keyboard both clamp to the §1.2 mins.

**Viewer (a11y):**
- No Back affordance (3-pane rework) — the tree dock is always reachable on the RIGHT; navigation
  between files is by activating tree rows (the standard ARIA tree keymap, §8). Monaco is
  `readOnly`/`domReadOnly` so it is never an editable target but is still scrollable/selectable for
  reading (its own a11y is Monaco-provided). The not-previewable / not-found blocks are static text —
  fully keyboard reachable; the user returns to navigation via the tree dock.
- Decorative glyphs (`Folder`, `File*`, `ChevronRight/Down`, viewer state glyphs) carry
  `aria-hidden="true"`; semantics ride the row/region roles and the visible/aria-labelled text.

**Contrast** (against the dark palette):
- `text-foreground/90` rows on `bg-card #1b1b1c` and `bg-accent #2d2d30` (hover/selected) — passes AA;
  the `/90` keeps the dense tree slightly calmer than full-strength foreground without dropping to muted.
- `text-muted-foreground #888` glyphs/chevrons/path are intentionally low-emphasis chrome (same token used
  in every panel's quiet chrome). If `#888` reads too dim specifically on `bg-card` for the tree at
  density, that is a system-level muted-token concern — flag to the token owners, do NOT one-off a lighter
  value here (same posture as the directory-picker design §7).
- `--primary #4a9eff` divider highlight + `--destructive #f3b0b0` `Notice` text/`--ring #4a4a4c` ring all
  read on the `#1b1b1c`/`#252526` family.

**Reduced motion:** the only motion is `Skeleton`'s `animate-pulse` (existing, already the house
loading shimmer), the optional row add/remove `transition-colors`, and Monaco's own minor animations.
The divider highlight is a color change (fine under reduced motion). Nothing new needs explicit
`motion-reduce:` gating beyond what the primitives already do; if the optional row transition is added,
gate it `motion-reduce:transition-none`.

---

## 9. Tokens & components

**New tokens added: NONE.** Every surface maps to existing tokens: `bg-card` (panel + tree + text
viewer), `bg-popover` (image viewer backdrop + the explorer-header band scale family), `border-border`
(divider seam, header/footer borders), `text-foreground` / `text-foreground/90` (names), `text-muted-
foreground` (glyphs, chevrons, path, empty/disabled copy), `bg-accent` (row hover/selected),
`ring-ring` (focus rings), `--primary` (divider drag highlight — the one accent, matching the active-tab
accent language), `--destructive` via the `Notice`/`Alert` (true errors), `brand-*` via the `Button
variant="cosmos"` reused from the existing awaiting CTA. The Monaco editor theme is **mapped onto these
same CSS vars** (developer builds a `cosmos-dark` Monaco theme reading the tokens), so Monaco does not
introduce off-palette color — it consumes the tokens like `terminalTheme.ts` does for xterm. No raw hex
is introduced by this surface.

**New shadcn primitive added: NONE.**
- The **resizable divider** is a bespoke composite over plain elements (a `role="separator"` div +
  pointer/keyboard handlers), NOT a new `components/ui/resizable.tsx` and NOT a `react-resizable-panels`
  dependency (D-3). Justification: there is exactly one consumer; the need is met by ~30 lines of Tailwind
  + a drag handler reusing existing tokens. Pre-building a primitive (or pulling a lib) for one consumer
  adds system surface and a dependency for no reuse — promote it to a primitive ONLY if/when a second
  split surface appears (record then). This holds the "tokens-first, components-second, one-offs never"
  line: it is not a styled one-off, it is a small reusable-in-principle composite gated on real reuse.
- The tree, rows, viewer header, and state blocks are all plain Tailwind over existing primitives
  (`Button`, `ScrollArea`, `Skeleton`, `Alert`/`Notice`, `Tooltip`).

**Components reused:** `Button` (`outline sm` Retry; `cosmos sm` the awaiting CTA on the left; `ghost xs`
Fit/100%), `ScrollArea` (tree scroller), `Skeleton` (tree + first-list loading), `Alert`/`Notice`
(`destructive` for true read errors + Retry), `Tooltip` (truncated name / divider label). lucide icons:
`ChevronRight`, `ChevronDown`, `Folder`, `FolderOpen`, `FolderTree`, `File`, `FileCode`, `FileImage`,
`FileText`, `FileQuestion`/`FileX2`, `Lock`, `ImageOff`, `MousePointerClick` (viewer placeholder),
`TriangleAlert` (via `Notice`), `Loader2` (optional). (No `ChevronLeft` — the Back affordance is removed
in the 3-pane rework.)

---

## 10. Developer handoff (designer has no Bash)

The visual contract above is buildable, but THESE require the developer/main session (installs, build
wiring, CSP — outside the designer's tokens/components ownership):

1. **Install + wire Monaco (the heavyweight dep).** `npm install monaco-editor` (± `@monaco-editor/react`).
   Wire its **Web Workers** into the electron-vite renderer build so they resolve under BOTH the dev
   server and the PACKAGED app (worker URLs / `base` / CSP) — mis-wiring fails silently (blank viewer /
   worker 404), like the "MCP server needs a rollup input" gotcha. **This is the developer's build
   concern, not the design's.** The design only requires that the editor is **read-only** and themed to
   the cosmos tokens (build a small `cosmos-dark` Monaco theme from the CSS vars — background `--card`,
   foreground `--foreground`, gutter `--muted-foreground`, selection `--accent` — mirroring how
   `terminalTheme.ts` reads tokens for xterm, so Monaco matches the panel). If Monaco cannot be wired
   cleanly, the D-6 fallback is an equivalent OSS editor (CodeMirror 6) — still themed to the same tokens;
   do NOT hand-roll a text renderer.
2. **CSP `img-src`**: add `cosmos-file:` to the renderer CSP alongside `cosmos-confluence-img:` /
   `cosmos-slack-img:`, or the image state (§4.3/§7) silently won't load.
3. **The `cosmos-file://` URL builder** is a small pure renderer helper mirroring
   `confluenceCatalog/contentImageSrc.ts` (base64url relPath under a fixed authority). The design just
   consumes its output as the `<img src>` — no token, no bytes.
4. **Terminal re-fit on divider drag**: re-run the existing `safeFit()` + `pty.resize` on the terminal
   pane when its width changes (the FitAddon path already exists for window resize). Behavioral, owned by
   the developer; the design only specifies the divider + min widths.
5. **No new shadcn install, no `index.css` edit, no new token.** `components/ui/` and `index.css` are
   untouched by this feature (confirmed in §9). If, in on-device review, a genuinely new need surfaces
   (e.g. a `--scrim`-class need, or muted-token contrast on `bg-card`), flag it back to me to extend the
   system rather than one-offing it on this surface.

---

## 11. Design-decision → FR / spec trace

| Decision | FR / spec |
|----------|-----------|
| Horizontal split, terminal LEFT / explorer RIGHT, inside each `TerminalView`; outer panel chrome untouched | FR-001, D-1 |
| Resizable 6px `role="separator"` divider; pointer + keyboard; clamps to mins; terminal re-fits on drag | FR-002, D-3 |
| Default 60/40, terminal min `20rem` / explorer min `16rem` | FR-001/FR-002 |
| Explorer rooted at the tab's cwd; per-tab; tree of entries; lazy expand; dirs-first alpha sort | FR-003/FR-004/FR-005 |
| Tree rows: chevron disclosure, lucide folder/file glyphs, symlink = italic+tooltip, truncate+tooltip, hover/focus/selected via `accent`/`ring` | FR-004/FR-005 |
| Awaiting-directory → disabled explorer placeholder, no tree, no list/watch; populates on go-live | FR-006 |
| Read-only everywhere (tree + viewer); no write affordances | FR-007 |
| Click a file → viewer opens/retargets in the MIDDLE column; tree dock stays visible; no Back; terminal stays live | FR-008/FR-013, D-1 |
| Text via read-only **Monaco**, cosmos-dark theme, line numbers, h-scroll, no size cap | FR-009/FR-012 |
| Image via `cosmos-file://` opaque src, natural size / Fit toggle, no size cap, `onError`→`ImageOff` | FR-010/FR-012/FR-028 |
| "Preview not available" (binary/unsupported/denied) — calm block, never raw bytes | FR-011 |
| Viewer is the middle column (never a terminal overlay); terminal mounted/live throughout | FR-013 |
| Watch-driven re-list is SEAMLESS — merge into expanded state, no skeleton flash/collapse/scroll-jump | FR-014/FR-018 |
| Open file deleted → "file no longer available" calm state, no stale content | FR-017 |
| Tree `role="tree"`/`treeitem`, roving tabindex, ARIA tree keymap; two dividers `role="separator"`; focus order terminal→dividerA→viewer→dividerB→tree | FR-001/FR-002 (a11y) |
| Visual parity: cosmos dark palette, `bg-card` shared with terminal, shadcn primitives, no new token/primitive | (uniformity) |

---

## 12. Open questions for the user

None block implementation — every default above is buildable as-is. Soft confirmations only:

1. **Default split ratios** = **~50% terminal / ~25% viewer / ~25% tree dock** (terminal is the primary
   surface; the middle viewer + the dock split the rest). Confirm, or prefer other ratios?
2. **3-pane (resolved):** the tree is a PERSISTENT right-side dock; the viewer is its OWN middle column
   (it never replaces the tree, so there is no Back affordance). This supersedes the earlier
   "viewer replaces the tree in the right pane" decision.
3. **Image Fit/100% toggle** — include the toggle (default **Fit**) or ship Fit-only for v1? Default:
   include the toggle; harmless either way.
4. **Light extension-based file glyphs** (`FileCode`/`FileImage`/`FileText` for a small set) vs. a single
   `File` glyph for everything. Default = the small map (more legible, still cohesive); fall back to a
   single glyph if the map feels like creep.

All four have stated defaults; none gate the build.
