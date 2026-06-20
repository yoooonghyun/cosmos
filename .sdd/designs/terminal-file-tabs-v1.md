# Design: Terminal File Tabs — v1

**Status**: Draft (designer step / Phase 0)
**Created**: 2026-06-20
**Board**: #91
**Spec**: `.sdd/specs/terminal-file-tabs-v1.md`
**Plan**: `.sdd/plans/terminal-file-tabs-v1.md`
**Extends design**: `.sdd/designs/terminal-file-explorer-v1.md` (#84 — the 3-pane split, the
middle viewer column, the tree dock, the file-glyph map, the calm state blocks)
**Owns**: the visual contract for the NEW **file-tab strip** that sits above the middle
viewer column (label + per-tab close + active/inactive/hover + overflow scroll +
roving-tabindex), how the strip reconciles with the existing single-file viewer header, and
the per-tab states (zero / one / many / active-content / failed-read). Single-mode DARK,
cosmos VS Code palette, existing tokens + existing primitives only. **No new token, no new
shadcn primitive.**

---

## Grounding

> Tools I (designer) ran directly this pass (CLAUDE.md SDD rule — not handed in). Each pointer
> re-verified against the current on-disk tree.

**memory_recall / memory_smart_search**
- `terminal file tabs strip PanelTabStrip design system tab close affordance roving tabindex`
  → **empty** (no stored prior decision specific to a file-tab strip). Standing MEMORY.md
  preferences still hold: cosmos UI = a real Tailwind + shadcn design system (use the
  primitives, not hand-rolled — `feedback_design_system`); dark-first VS Code palette;
  #84 file-explorer direction (terminal LEFT / viewer MIDDLE / tree dock RIGHT, no
  hand-rolled viewer). No conflict. New strip standard persisted via `memory_save` at the end.

**codegraph_explore**
- `PanelTabStrip PanelTab usePanelTabs panelTabs adjacentActiveId FileViewer FileExplorer
  useExplorerPanes FileTree FileTreeRow viewerState selectFile baseName` → the middle column
  today holds ONE `viewer: ViewerState` resolved by `viewerState.ts`
  (`selectFile`/`resolveRead`/`invalidateOpen`/`baseName`, node-tested, no React). The
  tree's `selectedRelPath = viewer ? viewer.relPath : null`. `adjacentActiveId` (in
  `panelTabs.ts`) is the exact close-fallback model (right neighbour → else left → else null).
- `PanelTabStrip PanelTab component render tab close button X focus ring roving tabindex tablist
  bg-popover active bg-background brand-gradient` → returned the FULL `PanelTabStrip.tsx`
  source. The heavyweight strip carries rename (inline `<input>`, F2, double-click, the
  `editingTabId`/`draft`/refocus machinery), a pinned `+` "New tab", per-tab `status` glyphs
  (`Loader2`/`CircleAlert`), a terminal `SquareTerminal` glyph, `untitled` italic, and a
  `trailing` refresh-control slot. NONE of those are wanted by file tabs (read-only,
  click-to-open-from-tree, no new-tab button, no run lifecycle).

**Reads / verbatim source already in-context**
- `src/renderer/PanelTabStrip.tsx` (canonical, header lines 1–92 + body 93–433) → the EXACT
  classes I match for parity (band `h-8 shrink-0 bg-popover border-b border-border`; scroll
  region `overflow-x-auto overflow-y-hidden`; tab base `border-r border-border px-2.5
  text-[13px] focus-visible:ring-[3px] focus-visible:ring-ring/50`; inactive `bg-transparent
  text-muted-foreground hover:bg-accent hover:text-foreground`; active `bg-background
  font-medium text-foreground` + a `::before` `h-0.5 bg-primary` top accent; the close `X` =
  `Button asChild variant="ghost" size="icon-xs"`, `opacity-0` → reveal on
  `group-hover/tab`/active/focus; roving tabindex; ARIA `role="tablist"`/`role="tab"`;
  keymap Arrow/Home/End move focus, Enter/Space activate, Delete/Backspace close).
- `src/renderer/fileExplorer/FileViewer.tsx` → the existing single-file header is
  `h-8 shrink-0 ... border-b border-border px-2.5` with a `size-3.5` muted file glyph + the
  `text-[13px] font-medium text-foreground truncate` name (`title={relPath}`). The body is
  `ViewerBody` (loading/text-Monaco/image/binary/denied/not-found) + the `null` "Select a
  file" placeholder. This header is the surface the tab strip RECONCILES with (§4).
- `src/renderer/fileExplorer/FileTree.tsx` → the tree-row truncation+`Tooltip` idiom
  (`min-w-0 truncate` + `Tooltip`/`TooltipContent side="right"`) + the `data-[selected=true]:
  bg-accent` highlight that already follows the given `selectedRelPath`. The active tab will
  drive that highlight (FR-016, plan D-6).
- `src/renderer/fileExplorer/viewerState.ts` → `baseName`, `selectFile`, `resolveRead`,
  `invalidateOpen`, the `ViewerState` union (`loading|text|image|binary|denied|not-found|null`).
- `src/renderer/components/ui/button.tsx` → `size="icon-xs"` = `size-6 ...:size-3`; svg sized
  to `size-3.5` by the consumer (the strip already does `[&_svg]:size-3.5`).

**Tokens consulted** (`src/renderer/index.css`, `.dark` block — single source of truth):
`--card #1b1b1c`, `--background #1e1e1e`, `--popover #252526`, `--border #333`,
`--foreground #e0e0e0`, `--muted-foreground #888`, `--accent #2d2d30`, `--primary #4a9eff`,
`--ring #4a4a4c`, `--destructive #f3b0b0`.

**Conclusion**: the whole surface is expressible in existing tokens + the existing
`PanelTabStrip` visual idiom, reused at one notch quieter. **No new token. No new shadcn
primitive.** The strip is a LIGHT bespoke `FileTabStrip` (D-3 confirmed below, §9).

---

## 0. The one decision the plan asks me to settle — D-3: bespoke `FileTabStrip`, NOT `PanelTabStrip`

**Confirmed: build a light bespoke `FileTabStrip.tsx`; do NOT reuse `PanelTabStrip`.** It
reuses `PanelTabStrip`'s exact TOKENS, focus ring, truncation+tooltip, and roving-tabindex
keymap (so it reads as the same product) without that component's unneeded chrome.

**Why not reuse `PanelTabStrip` as-is:**
1. **It is a different chrome tier.** `PanelTabStrip` is the PANEL tab band — it sits at the
   top of the whole `<section>` panel, `bg-popover #252526`, and its active tab pulls up to
   `bg-background #1e1e1e`. The file-tab strip lives INSIDE the middle viewer column, on the
   `bg-card #1b1b1c` content surface, one nesting level deeper. If it used the identical
   `bg-popover` band it would read as a SECOND panel tab bar competing with the real one
   directly above it (the panel tab band → terminal/viewer/tree). It must read **one notch
   quieter** — in-column chrome, not panel chrome (plan D-3). See §3 for the exact tones.
2. **It carries machinery file tabs must NOT have.** `PanelTabStrip` hard-wires: a pinned
   `+` "New tab" button (file tabs are opened ONLY from the tree — FR-017, there must be no
   separate "new" affordance); inline rename (`editingTabId`/`draft`/F2/double-click — file
   tabs are never renamed); per-tab `status` glyphs (`Loader2`/`CircleAlert` for run
   lifecycle — a read-only viewer has no "run"); the `untitled` italic state; the terminal
   `SquareTerminal` glyph; and a `trailing` refresh-control slot. Threading "render none of
   this" through `PanelTabStrip` means new optional props and conditionals on a component
   already dense with rename logic — MORE surface and MORE risk than a ~70-line strip that
   does exactly four things (label · close · active · overflow) with the same tokens.
3. **The shared, load-bearing parts are TINY and already proven.** What MUST stay identical —
   the focus ring (`focus-visible:ring-[3px] ring-ring/50`), the close-`X` reveal pattern
   (`Button variant="ghost" size="icon-xs"`, `opacity-0` → `group-hover/tab`/active/focus),
   the truncation+`Tooltip`, and the roving-tabindex keymap — are a handful of class strings
   and a ~20-line `onKeyDown`. Replicating those verbatim (copy the keymap, copy the ring/X
   classes) keeps both strips behaving the same WITHOUT importing the rename/`+`/status weight.
   This is the same call #84 made for the resize divider: a bespoke composite over plain
   elements gated on real reuse, not a premature shared primitive.

**Net:** `FileTabStrip` is a new `src/renderer/fileExplorer/FileTabStrip.tsx`. It is NOT a
`components/ui/` primitive (one consumer; promote only if a third tab surface ever appears).
The `panelTabs.ts` `adjacentActiveId` adjacency rule IS shared (export + reuse it for the
close-fallback — single-sourced, per the plan's "Single-sourced adjacency" risk).

---

## 1. Surfaces & layout — where the strip sits

Everything new lives INSIDE the **middle viewer column** of the #84 3-pane layout
(`src/renderer/fileExplorer/FileViewer.tsx`). The outer panel chrome (`PanelTabStrip` panel
band on top, `PanelFooter` on the bottom), the terminal column, the two resize dividers, and
the tree dock are **untouched** — the strip is internal to the middle column.

```
TerminalView .terminal-panel   (bg-card #1b1b1c — unchanged)
  ┌────────────────────┬───┬───────────────────────────────────┬───┬──────────────────┐
  │  Terminal (LEFT)   │ ‖ │  File viewer column (MIDDLE)       │ ‖ │ File tree dock   │
  │                    │ A │  ┌──────────────────────────────┐  │ B │ (RIGHT)          │
  │                    │   │  │ FileTabStrip  ◄── NEW (§2/§3) │  │   │  active file's   │
  │                    │   │  │  [ App.tsx ×][ index.ts ×]…   │  │   │  row = selected  │
  │                    │   │  ├──────────────────────────────┤  │   │  (FR-016)        │
  │                    │   │  │ ViewerBody (active tab's      │  │   │                  │
  │                    │   │  │  ViewerState — unchanged §84) │  │   │                  │
  │                    │   │  └──────────────────────────────┘  │   │                  │
  └────────────────────┴───┴───────────────────────────────────┴───┴──────────────────┘
```

- The middle column stays `<div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card …">`
  (unchanged outer box from #84). Its children, **when ≥1 file is open**, become:
  `FileTabStrip` (fixed-height, `shrink-0`) THEN the `ViewerBody` (the `min-h-0 flex-1`
  remainder). The strip replaces the #84 single-file header (§4 — the header FOLDS INTO the
  active tab).
- **When zero files are open** the strip is absent and the column is the calm "Select a file"
  placeholder filling the full column height (unchanged #84 empty state, FR-005/FR-012).
- The strip is full-column-width and aligns flush to the column's `border-l` seam on the left
  and the divider B seam on the right — it spans exactly the viewer column, never the terminal
  or the dock. Its bottom `border-b border-border` is the seam between the strip and the body,
  echoing the #84 viewer-header border so the column keeps a consistent internal rhythm.

---

## 2. The file-tab strip — anatomy

`src/renderer/fileExplorer/FileTabStrip.tsx`. A `role="tablist"` band of file tabs; each tab
= a leading file glyph + truncated filename + a hover/active/focus-revealed close `X`. NO
`+`, no rename, no status glyph, no terminal glyph (§0).

```
FileTabStrip   role="tablist"   h-8 shrink-0 flex items-stretch border-b border-border bg-card/60
└─ scroll region   flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden
   ├─ Tab (inactive)   [glyph] App.tsx        [×]
   ├─ Tab (ACTIVE)     [glyph] index.ts       [×]      ← bg-card, primary top-accent, bold
   ├─ Tab (inactive)   [glyph] card.tsx       [×]
   └─ … (scrolls horizontally when they overflow §3.4)
```

### 2.1 Tab descriptor & props (visual contract; types settled in Phase 1)

```
FileTabStripProps {
  tabs: { relPath: string; name: string; active: boolean }[]   // ordered; name = baseName
  activeRelPath: string | null
  onActivate: (relPath: string) => void   // click / Enter / Space
  onClose: (relPath: string) => void      // X click / Delete/Backspace / Enter-Space on X
  ariaLabel: string                        // e.g. "Open files"
}
```

- Tabs are **keyed by `relPath`** (the collection never holds two for the same path —
  FR-002). The **label is `name` (the basename)**; the **`title` / tooltip is the full
  `relPath`** (disambiguates two `index.ts` in different folders — Edge Case in the spec; a
  VS-Code path-suffix on the label is OPTIONAL and OUT for v1, §0/§7).

### 2.2 Per-tab anatomy (a single tab cell)

```
button  role="tab"  aria-selected={active}
  ├─ file glyph   (FileCode / FileImage / FileText / File — the §84 fileGlyph map)  size-3.5 muted
  ├─ <span> name  min-w-0 truncate            (the basename)
  └─ close X      Button ghost icon-xs  ·  opacity-0 → reveal on hover/active/focus
  wrapped in <Tooltip> → <TooltipContent side="bottom">{relPath}</TooltipContent>
```

- **File glyph**: reuse `fileGlyphKind(name)` + the existing glyph map already imported by
  `FileViewer`/`FileTree` (`FileCode`/`FileImage`/`FileText`/`File`), `size-3.5
  text-muted-foreground`, `aria-hidden`. So a tab's glyph matches its tree row + the old
  viewer header — one product. (A failed-read tab keeps its file glyph; the FAILURE shows in
  the body, not on the tab — §5.5. Rationale there.)
- **Name**: `<span className="min-w-0 truncate">{name}</span>`. Active tab adds
  `font-medium` (matching `PanelTabStrip`'s active label weight + the #84 header weight).
- **Close `X`**: `Button asChild variant="ghost" size="icon-xs" aria-label={`Close ${name}`}`,
  `[&_svg]:size-3.5`, `opacity-0 transition-opacity group-hover/tab:opacity-100
  group-data-[state=active]/tab:opacity-100 focus-visible:opacity-100` — VERBATIM the
  `PanelTabStrip` close-reveal idiom. `asChild` renders a `<span role="button">` so we never
  nest `<button>`s (same as `PanelTabStrip`); `stopPropagation` on its click/Enter/Space so
  closing never also activates the tab.

---

## 3. Tab states & exact treatment (active / inactive / hover / focus)

The tab cell mirrors `PanelTabStrip`'s class structure but on the QUIETER `bg-card` family
(§0 — in-column chrome, not panel chrome). The single deliberate difference from the panel
strip: the band rests on `bg-card` (the column surface) rather than `bg-popover`, and the
active tab rests on the same `bg-card` lifted only by the primary top-accent + a subtle
inactive dimming — so the file strip never looks like a second panel tab bar.

### 3.1 The strip band (container)

```
role="tablist"
h-8 shrink-0 flex items-stretch border-b border-border bg-card/60 select-none
```

- `h-8` (32px) — IDENTICAL height to `PanelTabStrip` and the #84 viewer header, so the
  column's top band keeps the same rhythm whether one file or many are open (no layout jump).
- `bg-card/60` — a hair lighter than the body's `bg-card` so the strip reads as a distinct
  band WITHOUT jumping to `bg-popover` (which is the panel-tab tier). It is one notch quieter
  than `PanelTabStrip`'s `bg-popover` band — the explicit "in-column chrome" tone from D-3.
  (If `bg-card/60` is imperceptible against `bg-card` on device, fall back to a flat
  `border-b border-border` separation with `bg-card` and no tint — the border alone already
  delineates it; do NOT introduce a new token for a band tone.)
- `border-b border-border` (`#333`) — the seam between strip and body, echoing the #84 header.

### 3.2 Tab cell — base + inactive + active (the class contract)

```
// base (every tab)
group/tab relative flex h-full min-w-0 max-w-[14rem] cursor-pointer items-center gap-1.5
  border-r border-border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors
  focus-visible:ring-[3px] focus-visible:ring-ring/50

// inactive
bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground

// active  (data-[state=active])
data-[state=active]:border-r-transparent
data-[state=active]:bg-card
data-[state=active]:font-medium
data-[state=active]:text-foreground
data-[state=active]:before:absolute data-[state=active]:before:inset-x-0
  data-[state=active]:before:top-0 data-[state=active]:before:h-0.5
  data-[state=active]:before:bg-primary
```

- **Inactive** = quiet: `bg-transparent` over the `bg-card/60` band, `text-muted-foreground`
  (the glyph + label both read as chrome), so the inactive tabs recede. IDENTICAL idiom to
  `PanelTabStrip` inactive.
- **Hover (inactive)** = `hover:bg-accent` (`#2d2d30`) + `hover:text-foreground` — exactly the
  tree-row + panel-tab hover, so hovering a file tab feels the same as hovering its tree row.
- **Active** = `bg-card` (drops the band's `/60` tint to the full content surface, the same
  "active tab pulls toward the body surface" move `PanelTabStrip` makes from `bg-popover` →
  `bg-background`) + `font-medium` + full `text-foreground` + a **2px `--primary #4a9eff` top
  accent** (`::before`, `h-0.5 bg-primary`). The primary top-accent is the one brand cue,
  matching the active-panel-tab accent language AND the #84 divider's primary highlight — so
  "active" reads consistently across the panel tab, the file tab, and the divider.
- **Focus ring** = `focus-visible:ring-[3px] focus-visible:ring-ring/50` — the house ring,
  VERBATIM from `PanelTabStrip`. It reads on `bg-card`/`bg-accent` (the #84 contrast notes
  hold). Roving tabindex (§6) means only the active tab is in the Tab order.
- **`max-w-[14rem]`** caps a very long single tab so one file can't eat the whole strip; the
  name truncates inside that cap (the tooltip carries the full path).

### 3.3 Close `X` per-tab

Per §2.2 — `opacity-0`, revealed on `group-hover/tab` / active / focus, `variant="ghost"
size="icon-xs"`. On hover its own `hover:bg-accent`/foreground (the `ghost` Button hover) gives
the X a faint target without a box at rest. This is the SAME reveal the panel strip uses, so a
crowded read-only strip stays calm (no row of always-on X's) yet every tab is closable.

### 3.4 Overflow — many tabs (FR-014)

- The tabs live in an inner scroll region: `flex min-w-0 flex-1 items-stretch overflow-x-auto
  overflow-y-hidden` — VERBATIM the `PanelTabStrip` scroll region. When tabs exceed the column
  width the strip **scrolls horizontally**; tabs never wrap to a second row and never shrink
  below their `px-2.5` + truncated label.
- Because file tabs have **no pinned `+`/trailing cluster** (§0), the ENTIRE strip is the
  scroll region (simpler than `PanelTabStrip`, which pins `+`/refresh outside the scroller).
- **Active-tab reachability**: when the active tab changes (via tree click or keyboard), the
  active tab's `<button>` is scrolled into view (`scrollIntoView({ block: 'nearest', inline:
  'nearest' })` on activate) so opening a file off-screen always brings its tab into view —
  the same "active stays reachable" guarantee the spec requires (FR-014/SC-008).
- The horizontal scrollbar uses the platform/native thin scrollbar on the `overflow-x-auto`
  region, consistent with `PanelTabStrip`'s scroll region (it does not wrap in `ScrollArea`).
- **Reduced motion**: gate the `scrollIntoView` to instant (`behavior: 'auto'`, the default)
  / `motion-reduce` — no smooth-scroll animation needed; the calmest baseline is an instant
  jump into view.

---

## 4. Reconciling the strip with the #84 single-file viewer header

The #84 middle column had a `h-8 border-b border-border px-2.5` header showing the open file's
glyph + name. With a tab strip, that information now lives **on the active tab**. So:

**Decision: the strip REPLACES the single-file header — the header FOLDS INTO the active
tab.** When ≥1 file is open, the column renders `FileTabStrip` (which already shows the active
file's glyph + name, bolded, with the full-path tooltip) THEN the `ViewerBody`. The standalone
`#84` header is NOT rendered alongside the strip — that would be two stacked `h-8` bands
showing the same filename twice. This keeps the column to ONE top band (`h-8`), preserves the
exact vertical rhythm, and means the active tab IS the header.

- The active tab's `title`/tooltip carries the full `relPath` — the same disambiguation the
  #84 header gave via its `title={relPath}`. No information is lost.
- The `ViewerBody` (loading/text-Monaco/image/binary/denied/not-found) is rendered UNCHANGED
  for the active tab's `ViewerState` (FR-008) — the strip is purely additive above it.
- The "Select a file" placeholder (zero tabs) is the #84 empty state, full column height, no
  strip (§5.1).

> Developer note: in `FileViewer.tsx`, the existing single-file `<div className="flex h-8 …
> border-b …">` header block is REMOVED when the strip is present; the strip provides the band.
> The placeholder branch (`viewer === null` → "Select a file") is preserved for the zero-tab
> case (now keyed off "zero open tabs").

---

## 5. The full state matrix

| State | Strip | Body | FR |
|-------|-------|------|----|
| **5.1 Zero tabs** (none opened yet / last tab closed) | **No strip rendered.** | The #84 calm "Select a file to preview it here." placeholder (`MousePointerClick size-6 text-muted-foreground/70` + `text-xs`), full column height. | FR-005/FR-012 |
| **5.2 One tab** | Strip with a single tab, rendered ACTIVE (primary top-accent, `bg-card`, bold, `font-medium`), its close `X` revealed (active tabs show the X). | The active tab's `ViewerState` via `ViewerBody` (§84). | FR-012 |
| **5.3 Many tabs** | All tabs in order; exactly one active (§3.2); inactive tabs quiet (`text-muted-foreground`, X hidden until hover). Overflow → horizontal scroll, active scrolled into view (§3.4). | The ACTIVE tab's `ViewerState`. Switching the active tab swaps the body to that tab's cached `ViewerState` instantly (FR-009 — no re-read jolt). | FR-012/FR-014 |
| **5.4 Active-tab content** | The active tab carries the primary top-accent; the tree row for `activeRelPath` is rendered `data-[selected=true]` (FR-016). | The active file's resolved content (Monaco text / image / calm block). | FR-008/FR-016 |
| **5.5 A tab whose file failed to read** (binary / denied / not-found-on-open / deleted-while-open) | The tab STAYS in the strip, label + glyph UNCHANGED — its tab cell looks normal (the failure is NOT advertised on the tab). The user closes it from the strip when done. | When this tab is active, the body shows the matching #84 calm block: `FileQuestion` "Preview not available" (binary) / `Lock` (denied) / `FileX2` "This file is no longer available" (deleted-while-open, FR-010) / `ImageOff` (broken image). Other tabs' content is unaffected. | FR-008/FR-010 |

**5.5 rationale — why no error glyph on a failed-read tab.** `PanelTabStrip` shows a
`CircleAlert`/destructive tint on a tab whose RUN failed because that is an actionable app
error. A file that is binary/denied/deleted is a BENIGN, expected outcome of a read-only
viewer (the #84 design is emphatic: these are calm blocks, never the red `Notice`). Putting a
red glyph on the tab would alarm where #84 deliberately stays calm, and would inconsistently
treat "you opened a binary" as an error. So: the tab cell stays neutral; the body's calm block
IS the (non-alarming) signal; the user closes the tab when done. The ONE exception the spec
calls out — a **deleted-while-open file** — is handled by the body swapping to "This file is
no longer available" (FR-010); the tab remains so the user can close it. (If, on device, it
turns out users want a subtle "stale" hint on a deleted tab's label, the calm move would be
`italic text-muted-foreground` on the label — the same convention symlinks use in the tree —
NOT a red glyph. Out of scope for v1; flag if it comes up.)

---

## 6. Interaction & accessibility

**Roving-tabindex tablist** — VERBATIM the `PanelTabStrip` model (so file tabs and panel tabs
navigate identically):
- Container `role="tablist"` + `aria-label` (e.g. "Open files"). Each tab is a `<button>`
  `role="tab"` with `aria-selected={active}`. The body is conceptually the tab's panel; since
  the `ViewerBody` is a single shared region that swaps content, mark it `role="tabpanel"` (or
  leave it as the existing viewer region) — the active tab `aria-controls` it if the developer
  wires an id; not strictly required since there is exactly one body region.
- **Roving tabindex**: the active tab is `tabIndex={0}`, all others `tabIndex={-1}` (one Tab
  stop for the whole strip).
- **Keymap** (manual activation, mirroring `PanelTabStrip`'s `handleTabKeyDown`):
  - `ArrowRight` / `ArrowLeft` → move FOCUS to the next/previous tab (clamped at ends), does
    NOT yet activate (manual activation — focus then Enter/Space, consistent with the panel
    strip).
  - `Home` / `End` → focus first / last tab.
  - `Enter` / `Space` → activate the focused tab (`onActivate`) → body swaps + tree highlight
    follows.
  - `Delete` / `Backspace` → close the focused tab (`onClose`) → adjacency neighbour becomes
    active via the shared `adjacentActiveId` (the focus lands on the new active tab).
  - On the close `X` (when focus is on it): `Enter` / `Space` closes (with `stopPropagation`).
- **Close adjacency**: closing the active tab activates the right neighbour, else the left,
  else empties to the placeholder — the SAME `adjacentActiveId` rule as terminal tabs
  (single-sourced, FR-004). Closing an INACTIVE tab leaves the active tab untouched.

**Focus order across the live tab** (extends the #84 order):
`PanelTabStrip` (panel tabs) → terminal (xterm) → divider A → **FileTabStrip (active file
tab)** → viewer body (Monaco is `readOnly`/`domReadOnly`, scrollable/selectable for reading)
→ divider B → tree dock → `PanelFooter`. The strip is one Tab stop (roving tabindex); arrow
keys move within it.

**Tree ↔ active-tab link (FR-016/FR-017):** activating a tree row calls the same open-or-focus
path (`onActivate`/`openFile`) — there is NO separate "open" vs "focus" affordance in the tree
(FR-017). The tree's `selectedRelPath` becomes `activeRelPath`, so the tree row for the active
tab renders `data-[selected=true]:bg-accent` (FR-016). When the strip empties, `activeRelPath`
is `null`, so no row carries the open-file selection (the tree's own roving keyboard-focus
highlight is independent and unaffected).

**Decorative glyphs** (`FileCode`/`File…`, the `X`) carry `aria-hidden="true"`; the accessible
name rides the tab's label text and the close `Button`'s `aria-label={`Close ${name}`}`. The
truncated label always has a full-`relPath` `Tooltip` (matching the tree-row + panel-tab
tooltip precedent).

**Contrast** (against the dark palette — same as #84): `text-muted-foreground #888` inactive
labels/glyphs on `bg-card/60` read as quiet chrome; `text-foreground #e0e0e0` active label on
`bg-card #1b1b1c` passes AA; `--primary #4a9eff` top-accent + `--ring #4a4a4c` focus ring read
on the `bg-card`/`bg-accent` family. If `#888` reads too dim at this density on `bg-card`, that
is a SYSTEM muted-token concern — flag to the token owners, do NOT one-off a lighter value here
(same posture as #84 §8).

**Reduced motion**: the only motion is the close-`X` `transition-opacity` reveal and the
optional active-into-view scroll. Keep the reveal (a short opacity fade is fine under reduced
motion); make the active-into-view scroll instant / `motion-reduce`-safe (§3.4). Nothing else
animates.

**Dirty / modified indicator: explicitly OUT OF SCOPE.** The viewer is READ-ONLY (no editing,
no save), so there is no dirty state to show. File tabs therefore carry NO dot/asterisk/unsaved
glyph — the close `X` occupies the trailing slot at all times (revealed on hover/active/focus).
This is a deliberate divergence from a full IDE editor's dirty-dot; do not add one in v1.

---

## 7. Same-basename disambiguation (the spec's optional ask)

Two distinct files with the same basename (e.g. `src/index.ts` and `test/index.ts`) both open
as DISTINCT tabs (keyed by `relPath`). For v1:
- **Label = the basename** (`index.ts`) — matches the tree row + the #84 viewer header.
- **Disambiguation = the `title`/`Tooltip` = the full `relPath`** (`src/index.ts` vs
  `test/index.ts`) — hovering either tab reveals which is which.
- A VS-Code-style **inline path-suffix on the label** (e.g. `index.ts · src` dimmed) is
  **OPTIONAL / OUT for v1** (the spec marks it nice-to-have). Recommendation: ship
  tooltip-only; it keeps the tab compact and the strip calm. If, on device, same-basename
  collisions feel confusing, the calm follow-up is a dimmed `text-[11px] text-muted-foreground`
  parent-dir suffix shown ONLY when two open tabs share a basename — a pure label decision, no
  new token. Tracked as a deferred follow-up (plan Phase 4 TODO), not a v1 requirement.

---

## 8. Tokens & components

**New tokens added: NONE.** Every part maps to existing tokens:
- `bg-card` / `bg-card/60` — the column body + the strip band (quieter than the panel
  `bg-popover` band), and the active tab surface.
- `bg-accent #2d2d30` — tab hover (and the ghost-X hover), matching tree-row + panel-tab hover.
- `border-border #333` — the strip's bottom seam + the per-tab `border-r`.
- `text-foreground` / `text-foreground/`(implicit) — active label; `text-muted-foreground
  #888` — inactive labels, glyphs, the close `X` (via `ghost`).
- `--primary #4a9eff` — the active-tab 2px top-accent (the one brand cue; matches the active
  panel-tab accent + the #84 divider highlight).
- `--ring #4a4a4c` via `ring-ring/50` — the focus ring (verbatim from `PanelTabStrip`).
No raw hex introduced by this surface.

**New shadcn primitive added: NONE.**
- `FileTabStrip` is a **bespoke composite over plain elements** (a `role="tablist"` div +
  `role="tab"` `<button>`s + the existing `Button`/`Tooltip` primitives), NOT a new
  `components/ui/` file and NOT the `Tabs` Radix primitive (Radix `Tabs` mounts/unmounts panel
  content and owns its own roving model; the viewer body is a single swapping region and we
  want to mirror the proven `PanelTabStrip` keymap — so plain `role=tab` elements, same as
  `PanelTabStrip`). Justification: one consumer; the load-bearing parts are a few class
  strings + a ~20-line keymap reused verbatim. Promote to a shared primitive only if a third
  tab surface appears.

**Components reused:** `Button` (`variant="ghost" size="icon-xs"` for the close `X`),
`Tooltip` / `TooltipTrigger` / `TooltipContent` (full-path tooltip). lucide icons: the
existing file-glyph map (`FileCode`/`FileImage`/`FileText`/`File` via `fileGlyphKind`) +
`X` (close). No `Plus`, no `Loader2`/`CircleAlert`, no `SquareTerminal` (the panel-strip-only
chrome — §0).

**`components/ui/` and `index.css` are UNTOUCHED by this feature** (confirmed §0/§8). If an
on-device review surfaces a genuinely new need (e.g. the `bg-card/60` band tone reads
identically to `bg-card`, or muted-token contrast on `bg-card` at strip density), flag it back
to ME to extend the system — do NOT one-off it on this surface.

---

## 9. Design-decision → FR / spec trace

| Decision | FR / spec |
|----------|-----------|
| Light bespoke `FileTabStrip` (NOT `PanelTabStrip`); shares tokens/focus-ring/X-reveal/roving keymap; drops `+`/rename/status/terminal-glyph/trailing; one notch quieter (`bg-card` band, not `bg-popover`) | FR-013, OQ-2, plan D-3 |
| Strip sits above `ViewerBody` inside the MIDDLE column, full-column width, `h-8`, `border-b border-border`; aligns with the #84 3-pane layout; outer chrome untouched | FR-012, §84 layout |
| Strip REPLACES the #84 single-file header — the header folds into the active tab (one `h-8` band; full path on the tab tooltip) | FR-008/FR-012, §4 |
| Active tab: `bg-card` + `font-medium` + `text-foreground` + 2px `--primary` top-accent; inactive: `bg-transparent text-muted-foreground`; hover `bg-accent` + `text-foreground`; focus `ring-[3px] ring-ring/50` | FR-012/FR-013 |
| Per-tab close `X` (`ghost icon-xs`, `opacity-0` → reveal on hover/active/focus, `stopPropagation`); label = basename, truncate + full-`relPath` Tooltip | FR-012/FR-014 |
| Overflow → horizontal scroll (`overflow-x-auto`), no wrap/shrink, active scrolled into view; whole strip scrolls (no pinned `+`) | FR-014 |
| Zero tabs → no strip, #84 "Select a file" placeholder full height; one/many/active-content states per §5 | FR-005/FR-012 |
| Failed-read tab stays neutral in the strip (no red glyph — benign, calm); body shows the #84 calm block (binary/denied/not-found/broken-image); deleted-while-open → "no longer available" body, tab stays to close | FR-008/FR-010, §5.5 |
| Roving-tabindex tablist; Arrow/Home/End move focus, Enter/Space activate, Delete/Backspace close; close adjacency via shared `adjacentActiveId`; focus order …dividerA → strip → body → dividerB → tree | FR-015, plan D-3 |
| Tree highlight follows the active tab (`selectedRelPath = activeRelPath`); tree open = open-or-focus, no separate open/focus affordance | FR-016/FR-017, plan D-6 |
| Same-basename: label=basename, tooltip=full relPath disambiguates; inline path-suffix OPTIONAL/OUT v1 | spec Edge Case, §7 |
| Dirty/modified indicator: OUT OF SCOPE (read-only viewer) — no dot/asterisk; close X owns the trailing slot | spec (read-only), §6 |
| No new token, no new shadcn primitive; reuse `Button`/`Tooltip`/file-glyph map | (uniformity), §8 |

---

## 10. Developer handoff (designer has no Bash)

The visual contract above is fully buildable with the existing system; nothing here needs an
install, a new shadcn primitive, an `index.css` edit, or a preload/IPC change (the feature is
renderer-only — plan FR-011). Specific handoff notes:

1. **Share the adjacency rule, don't copy it.** Export/reuse `adjacentActiveId` from
   `src/renderer/panelTabs.ts` for `openFiles.closeFile`'s active-fallback — single-sourced so
   file tabs and terminal tabs close identically (plan "Single-sourced adjacency" risk).
2. **Reuse the file-glyph map** (`fileGlyphKind` + `FileCode`/`FileImage`/`FileText`/`File`)
   from the existing `fileGlyph` module — the tab glyph MUST match the file's tree row + the
   old viewer header. Do not introduce a second glyph map.
3. **Replicate `PanelTabStrip`'s keymap + close-X reveal classes verbatim** (don't import the
   whole component): the `focus-visible:ring-[3px] ring-ring/50` ring, the
   `opacity-0 → group-hover/tab/active/focus` X reveal, and the
   Arrow/Home/End/Enter/Space/Delete/Backspace `handleTabKeyDown` shape. This is the parity the
   design depends on (§0/§3/§6).
4. **Remove the #84 single-file header from `FileViewer` when the strip is present** (§4) —
   render `FileTabStrip` then `ViewerBody`; keep the `viewer === null` "Select a file"
   placeholder for the zero-tab case (now keyed off "zero open tabs"). Do NOT stack a header
   AND the strip.
5. **Scroll the active tab into view on activate** (`scrollIntoView({ block: 'nearest',
   inline: 'nearest', behavior: 'auto' })`) so opening an off-screen file brings its tab into
   view (FR-014). Instant (motion-reduce-safe) — no smooth animation.
6. **No new token / no `index.css` edit / no new shadcn install** (confirmed §8). If the
   `bg-card/60` band tone is imperceptible on device, fall back to a plain `bg-card` +
   `border-b border-border` band (the border alone delineates it) — and flag it to me rather
   than inventing a band token.

---

## 11. Open questions for the user

None block implementation — every default above is buildable as-is with the existing system.
Soft confirmations only:

1. **Strip band tone** = `bg-card/60` (a hair lighter than the body so the band reads as
   distinct in-column chrome, one notch quieter than the `bg-popover` panel tab band). If this
   is imperceptible on device, the fallback is a flat `bg-card` band delineated by its
   `border-b border-border` only. Confirm, or prefer the flat-border-only band from the start?
2. **Failed-read tab stays neutral** (no red glyph — the body's calm block is the signal,
   §5.5), consistent with #84's "denied/binary/not-found are calm, never red". Confirm, or do
   you want a subtle (NON-red) stale hint on a deleted-while-open tab's label
   (`italic text-muted-foreground`, like the tree's symlink convention)? Default: neutral tab.
3. **Same-basename disambiguation** = tooltip-only for v1 (label is the basename; full relPath
   on hover). The VS-Code inline path-suffix is deferred. Confirm, or want the path-suffix in
   v1?

All three have stated defaults; none gate the build.
