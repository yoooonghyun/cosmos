# Design Spec: Home Favorites (Pin / Unpin tabs) — v1

**Status**: Ready for interface (Step 3)
**Created**: 2026-06-30
**Spec**: `.sdd/specs/cosmos-home-favorite-tabs-v1.md`
**Plan**: `.sdd/plans/cosmos-home-favorite-tabs-v1.md`
**Owner**: designer

---

## Grounding (queries actually run this session)

- `codegraph_explore "PanelTabTree PanelTabStrip CosmosPanel cosmosTabs ActiveTabSurface"` →
  `PanelTabStrip` already supports a per-tab `closeable` flag (the Cosmos default tab passes
  `false`), a leading-glyph slot (terminal `SquareTerminal`, in-flight spinner, error glyph), and a
  roving-tabindex tablist. A favorite tab is just another `PanelTab` with a leading icon + close `X`.
- `codegraph_explore "PanelTabTree CosmosPanel cosmosTabs ActiveTabSurface SURFACE_ICON InlineSurface CosmosTimelineEntry"`
  → `CosmosPanel` renders `<PanelTabStrip>` over a `flex-row` split (timeline `flex-1` LEFT, `PanelTabTree`
  `aside` RIGHT). `PanelTabTree` rows are `GroupHeaderRow` / `TabRow` under `role="tree"` with a manual
  keymap; the empty/zero-tab idioms already exist. `CosmosTimelineEntry.InlineSurface` mounts a surface via
  `<A2UIProvider><ActiveTabSurface catalogId="standard" …></A2UIProvider>` — the exact host I reuse for a favorite.
- `codegraph_explore "ActiveTabSurface TabSurface SURFACE_ICON RAIL_LABEL CrossPanelId panelTabChipFor"`
  → `ActiveTabSurface({surface, catalogId, panelName, onAction})` is the shared A2UI host; it
  re-paints on `surface` change, subscribes to `onDataModel` by `surfaceId` (so a second mounted
  instance of the same surface is a LIVE mirror), fires `adapter.refresh` when `surface.restored`,
  and round-trips actions through `UiBridge` (which warn-ignores a duplicate resolve). This is what
  makes the inline favorite a true live mirror with no new contract.
- `Grep radix package.json` + `node_modules/radix-ui/dist/index.d.ts` → the project depends on the
  **unified `radix-ui` package** (`^1.6.0`), which **already re-exports `ContextMenu`**
  (`export { reactContextMenu as ContextMenu }`, line 15-16). **NO `npm install` is needed** (see
  Build flag below) — the spec/plan's "maybe install `@radix-ui/react-context-menu`" is moot.
- Read `docs/DESIGN.md` (owned) — §2 surface→token map, §5 registry (esp. D-1 popover-default,
  D-9 scrollbar, D-10 SURFACE_ICON, D-13 dialog classes, D-15/D-16 panel-tab tree, §15 chat canon),
  §10 radius, §11 elevation, §12 motion, §13 z-index, §14 primitive canon.
- Read `components/ui/select.tsx` + `components/ui/dialog.tsx` — the two reference menu/overlay
  primitives. `dialog.tsx` is the foundation-aligned canon (`z-overlay`/`shadow-overlay`/`duration-fast`
  named utilities); I built ContextMenu on those names, not the older `z-50` literals.

> agentmemory/`wiki_*` MCP tools were **not present** in this session's toolset; prior-decision
> grounding came from `docs/DESIGN.md` + the in-repo specs/designs (the canon the wiki was seeded
> from). Flagged so the gap is visible.

---

## 0. Build flag for the developer (no Bash here)

**No package install is required.** Author against `import { ContextMenu as ContextMenuPrimitive } from "radix-ui"`
(identical to `select.tsx` / `dialog.tsx` / `tabs.tsx`). The unified `radix-ui` dependency already
bundles `@radix-ui/react-context-menu`. I have **authored** `src/renderer/components/ui/context-menu.tsx`
in this step (designer owns `components/ui/`); the developer only consumes it. If a future `shadcn`
CLI run is desired for parity, it must keep the unified-`radix-ui` import, not split to a per-package
import.

---

## 1. Surfaces & layout (where each piece lives)

The Home (Cosmos) panel `<section class="bg-card">` is unchanged in skeleton:

```
┌ PanelTabStrip (h-8, bg-popover, border-b) ───────────────────────────────┐
│  [✦ Cosmos]  [⟨glyph⟩ Source label ✕] [⟨glyph⟩ … ✕] …  (favorites appended) │
├──────────────────────────────────────────┬──────────────────────────────┤
│  CONTENT COLUMN (flex-1, min-h-0)         │ ResizeDivider │ PanelTabTree   │
│   default tab → conversation timeline     │               │  (aside,       │
│   favorite tab → <FavoriteSurface> inline │               │   role=tree)   │
├──────────────────────────────────────────┴──────────────────────────────┤
│  (App-level docked Open-Prompt composer band — unchanged, D-3)            │
└──────────────────────────────────────────────────────────────────────────┘
```

Three surfaces gain treatment:

1. **The right-click Pin/Unpin menu** — a new `ContextMenu` primitive, mounted on (a) each tree
   `TabRow` and (b) each favorite strip tab.
2. **The favorite strip tab** — a `PanelTab` with a leading panel glyph + source label + close `X`,
   appended after the default tab.
3. **The inline favorite content** — `FavoriteSurface` filling the content column (the same column
   that holds the timeline), with waiting / live / gone-source states. The **tree stays visible**
   on every tab (plan D4); only the LEFT content column swaps.

---

## 2. The right-click Pin/Unpin menu (ContextMenu primitive)

### 2.1 Primitive (authored: `components/ui/context-menu.tsx`)

Full shadcn/Radix ContextMenu set (`ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`,
`ContextMenuItem`, `…CheckboxItem/RadioItem/Label/Separator/Shortcut/Sub*`), styled on the
foundation chrome surface — the SAME look as the `Select` menu so the app's menus read as one family:

| Part | Tokens / treatment | Rationale |
|---|---|---|
| `ContextMenuContent` | portalled; `bg-popover text-popover-foreground` (§2 chrome), `border` (`border-border`), `rounded-md` (§10, matches Select content), `shadow-overlay` (§11), `z-overlay` (§13), `p-1`, `duration-fast` + shadcn `data-[state]` fade/zoom (§12), `scrollbar-hover-only` (D-9) | Identical surface to every other cosmos menu/dialog; D-1's "menus live on `bg-popover`" applied. No `z-50`/`shadow-md` literals — uses the named utilities `dialog.tsx` established. |
| `ContextMenuItem` | `rounded-sm` (§10), `text-sm` (= `text-body`, §8), `px-2 py-1.5` (§9 grid), `gap-2`; rest `text-popover-foreground`; **hover/focus `bg-accent` + `text-accent-foreground`** (D-15 row-hover affordance, same as Select item); `data-[disabled]:pointer-events-none data-[disabled]:opacity-50`; optional leading `size-4` glyph in `text-muted-foreground` | The canonical menu-item affordance. A `variant="destructive"` is available (item text `text-destructive`, focus `bg-destructive/10`) but **Pin/Unpin do NOT use it** — pin/unpin is a benign toggle, not a destructive action (close `X` == unpin is likewise non-destructive; no confirm, reversible). |
| `ContextMenuLabel` | `px-2 py-1.5 text-xs text-muted-foreground` (= `text-caption`) | For the disabled-terminal hint sub-label if rendered as a label; see 2.3. |
| `ContextMenuSeparator` | `-mx-1 my-1 h-px bg-border` | Standard hairline. |

Motion is Radix-gated (overlay enter/exit recipe, §12); no bespoke animation.

### 2.2 Tree-row menu (FR-001/002/003)

Each `PanelTabTree` `TabRow` becomes a `ContextMenuTrigger asChild` wrapping the existing focusable
row `<div role="treeitem">` (the row stays the roving-tabindex element — D-15 keymap untouched).

- **State-reflective single item:**
  - source tab **not** pinned → one item **"Pin"** with a leading `Pin` lucide glyph.
  - source tab **already** pinned → one item **"Unpin"** with a leading `PinOff` lucide glyph.
  - Derived from `isPinned(tabsState, { panelId, tabId })` (plan D2) — never a fixed label (FR-002).
- **Terminal rows (FR-040):** the item renders **disabled** (`disabled` prop → `data-[disabled]`
  dim + non-interactive) with the label **"Pin"** plus a quiet reason. The reason is discoverable
  two ways: the disabled item's own `title`/`aria` ("Terminal tabs can't be pinned"), and — since a
  disabled item can't show a tooltip reliably — a trailing `ContextMenuLabel` line "Terminal tabs
  can't be pinned" under it is acceptable. Recommended: **disabled item + `aria-disabled` + a
  `ContextMenuLabel` hint**. (Group headers get no menu — only leaf tab rows are pinnable.)
- **Keyboard (FR-003):** Radix ContextMenu opens on the platform context-menu key / **Shift+F10**
  when the trigger row is focused — for free, no bespoke handler. Arrow keys move between items,
  Enter activates, Esc closes and returns focus to the row. The tree's own ↑/↓/→/← roving keymap is
  preserved because the trigger is the existing row.

### 2.3 Favorite strip-tab menu (FR-004)

Each favorite tab in the strip is also a `ContextMenuTrigger` wrapping the tab `<button role="tab">`.

- Single item **"Unpin"** (leading `PinOff`). Activating it === clicking the tab's close `X` ===
  `closeCosmosTab` (unpin). The default "Cosmos" tab is **NOT** a trigger (it has no menu — it can
  never be pinned/unpinned, FR-011).
- Keyboard: same Shift+F10 path; the strip's existing roving-tabindex + Delete/Backspace-closes
  behavior is unchanged (Delete already unpins via `onClose`).

---

## 3. The favorite strip tab visual (FR-014)

Reuses `PanelTabStrip`'s existing `PanelTab` shape — **additive only**:

- **Leading glyph:** the source panel's `SURFACE_ICON[source.panelId]` (D-10, the ONE rail/footer
  glyph source) at `size-3.5`, in the inactive `text-muted-foreground` →
  `group-data-[state=active]/tab:text-foreground` treatment the terminal glyph already uses. This
  reuses the strip's existing leading-icon slot — the favorite occupies the SAME slot the terminal
  glyph / in-flight spinner uses, so glyph alignment and gap (`gap-1.5`) are unchanged.
- **Label:** the source tab's label (`toFavoriteStripTab`, plan), truncating with the strip's
  existing `max-w-[16rem]` + `truncate`. `text-body-sm` (the strip's `text-[13px]`).
- **Close `X` = Unpin:** the favorite passes `closeable: true` (the default — favorites are
  closeable); `onClose(favoriteId)` runs unpin. The `X` is the same nested ghost `icon-xs` button,
  hidden until hover/active/focus.
- **Tooltip:** the strip's existing `Tooltip` shows the full source label (and MAY append the panel
  name, e.g. "Sprint board — Jira", for provenance; non-secret labels only, FR-023).

**Distinction from the default "Cosmos" tab — minimal, by glyph not by chrome.** The favorite is NOT
given a different background, border, or accent: it is a normal strip tab and shares the exact
active/inactive/hover treatment (§15-adjacent tab canon: active = `bg-background` + brand-gradient
top accent; inactive = transparent + `hover:bg-accent`). The ONLY visual differences, both already
intrinsic to the data, are:

1. the **leading glyph** — the default tab shows the Cosmos sparkle (`SURFACE_ICON.cosmos`), a
   favorite shows its source panel's glyph (Jira/Slack/Confluence/Calendar mark). The glyph IS the
   "this is a shortcut to elsewhere" signal.
2. the **close `X`** — present on a favorite, absent on the default (FR-011, the existing
   `closeable:false` path).

This deliberate restraint keeps the strip uniform (D-15/§14: don't invent per-surface tab chrome).
Order: **default first, favorites appended in pin order** (`appendFavorite` appends after the
default; FR-010).

> Strip change required of the developer: today `CosmosPanel` builds `stripTabs` with no leading
> icon for generative tabs. `PanelTabStrip` must gain a minimal additive `icon?: LucideIcon` (or a
> `kind: 'favorite'` discriminator carrying the glyph) on `PanelTab`, rendered in the existing
> leading slot, AND an optional per-tab context-menu wrapper. The four generative panels + terminal
> omit it → unchanged. This is flagged in the plan (Phase 3, `PanelTabStrip.tsx`).

---

## 4. Inline-render layout + states (FR-020/021/024/031)

When `activeTab.kind === 'favorite'`, the LEFT content column renders `<FavoriteSurface source={…} />`
**in place of** the timeline scroll region (the tree `aside` and the divider stay). The composer
band below is unchanged (D-3, behaves normally — plan D4).

### 4.1 Container

`FavoriteSurface` fills the content column with the SAME geometry the timeline uses so switching
tabs causes no layout jump:

```
class="min-h-0 min-w-0 flex-1 overflow-auto p-3 text-card-foreground"  (D-9: real overflow → scrollbar-hover-only)
role="tabpanel"
```

The favorite surface is mounted exactly like the timeline's `InlineSurface`, but under the **source
panel's** catalog (plan D3, `favoriteCatalogHosts`):

```tsx
<A2UIProvider catalog={host.catalog} key={source.tabId}>
  <ActiveTabSurface
    surface={liveSurface}
    catalogId={host.catalogId}
    panelName={`Favorite:${host.panelName}`}
    onAction={favoriteOnAction(host)}
  />
</A2UIProvider>
```

Because it shares the source surface's `requestId` + `surfaceId`, it is a **live mirror** (receives
the same `updateDataModel` pushes; bound/deterministic controls round-trip) — no new state styling
needed for "populated"; the surface paints itself via the A2UI catalog exactly as in its home panel.

### 4.2 The four states (a surface is undesigned until all are specified — §4)

| State | When | Visual treatment |
|---|---|---|
| **Populated (live)** | source found, `surface` present | the source's live A2UI surface, rendered by the catalog. No cosmos chrome around it — it fills `p-3`. Identical to how it looks in its home panel. |
| **Loading / refreshing** | bound favorite firing its mount `adapter.refresh`; or source surface re-composing | the catalog's own in-surface bound-loading affordance (the data-model `loading` flag) handles it, exactly as in the source panel. cosmos adds NO extra spinner over a live mirror (D-8: the centered `SurfaceSpinner` is for a panel COMPOSING a surface; a mirror is not composing). |
| **Waiting (no surface yet)** | source tab found but `surface == null` (untitled / in-flight source) | a **calm centered placeholder** (4.3 "waiting" variant): muted `Loader2`-free static line "Waiting for this tab's view…" — flips to the live surface the instant one is published. Gate any motion per §12; default to a static line. |
| **Gone source (empty)** | `findLiveTab` returns null (source tab/panel closed or absent on relaunch) | the **gone-source empty state** (4.3) — calm, never an error red, with an Unpin affordance. The favorite is NOT auto-dropped (FR-031). |
| **Error** | the surface itself throws | the existing `ActiveTabSurface` `SurfaceErrorBoundary` (`border-destructive/40 bg-destructive/15 text-destructive` row) — reused as-is, per-body, never white-screening Home. |

### 4.3 Empty-state treatment (gone source + waiting)

Both reuse the established centered empty-block idiom already in `PanelTabTree` (the
"No open tabs in other panels" block: `flex flex-col items-center justify-center gap-2 py-8
text-center`, a `size-6 text-muted-foreground` glyph, a `text-caption text-muted-foreground` line).
On-system, calm, foundation-tokened — NOT an Alert, NOT destructive.

**Gone source:**

```
[ centered ]
  ⟨SURFACE_ICON[source.panelId]⟩  (size-6, text-muted-foreground)
  This tab is no longer open                 (text-body, text-foreground)
  The source view was closed. Its shortcut    (text-caption, text-muted-foreground, max-w-xs)
  stays here until you unpin it.
  [ Unpin ]   ← Button variant="secondary" size="sm"   (the in-body inline control size, D-13)
```

- The leading glyph is the source panel's `SURFACE_ICON` (so the user recognizes WHICH shortcut went
  stale) — D-10. Falls back to a generic `PanelsTopLeft` glyph if the panel id is unknown.
- The **Unpin** button is `Button variant="secondary" size="sm"` — an in-body inline control, not a
  dialog footer, so `sm` is correct (D-13). It calls the same unpin path as the strip `X`. (Could
  also be `variant="ghost"`; secondary gives it a touch more presence as the only action in an empty
  column. Either is on-system; pick `secondary`.)
- Tone: `text-foreground` headline + `text-muted-foreground` body — calm, no `destructive`. A gone
  source is an expected lifecycle, not an error.

**Waiting (source present, surface null):**

```
[ centered ]
  ⟨SURFACE_ICON[source.panelId]⟩  (size-6, text-muted-foreground)
  Waiting for this tab's view…               (text-caption, text-muted-foreground)
```

No Unpin here (the source is alive, just not yet composed); it flips to the live surface on the next
publish. Static text carries the meaning; if a spinner is added it must be §12 reduced-motion-gated.

### 4.4 Default tab (FR-021)

`activeTab.kind === 'default'` renders today's timeline exactly (the §15 chat canon, untouched). The
favorite feature adds zero changes to the conversation timeline.

---

## 5. Interaction & accessibility

- **Focus order:** strip (roving tablist, default → favorites) → content column → divider → tree
  (roving `role="tree"`). Unchanged from today; a favorite tab is just another `role="tab"`.
- **Right-click menu keyboard:** Shift+F10 / context-menu key on a focused tree row OR a focused
  favorite strip tab opens the menu (Radix-native). Arrow + Enter operate it; Esc returns focus to
  the trigger. The tree's and strip's own keymaps are intact (the menu only adds the open gesture).
- **Close == Unpin parity:** the favorite's `X` (`aria-label="Close {label}"`), Delete/Backspace on
  the focused favorite, and the context-menu "Unpin" are three equivalent unpin paths (FR-004).
  Closing the **active** favorite returns focus + activation to the default tab (FR-012, via
  `closeCosmosTab`).
- **Contrast (dark palette):** menu items `text-popover-foreground` (#e0e0e0) on `bg-popover`
  (#252526) ≈ 9:1; disabled item `opacity-50` ≈ 4.5:1 (still legible, AA-large); the gone-source
  headline `text-foreground` on `bg-card` ≈ 9:1, body `text-muted-foreground` (#888) on `bg-card` ≈
  3.7:1 (AA-large, matches every other panel's meta text). Favorite glyph inherits the strip tab's
  tested tones.
- **ARIA:** the favorite surface column keeps `role="tabpanel"`. The gone/waiting blocks are plain
  text (no `role="alert"` — they are not errors). The disabled terminal menu item is
  `aria-disabled` with the reason in `aria-label`/an adjacent label. The leading glyphs are
  `aria-hidden` (the label carries meaning), matching the strip + tree conventions.
- **Motion:** all menu + empty-state motion via the §12 overlay recipe / static fallbacks, Radix- or
  `prefers-reduced-motion`-gated.

---

## 6. Tokens & components used (nothing new in `index.css`)

**Tokens (all existing):** `bg-popover` / `text-popover-foreground` / `bg-accent` /
`text-accent-foreground` / `bg-card` / `text-card-foreground` / `text-foreground` /
`text-muted-foreground` / `border-border` / `bg-background` (active tab) / `--destructive` family
(error boundary only). Radius `rounded-md` (menu) / `rounded-sm` (items) §10. Elevation
`shadow-overlay` §11. Motion `duration-fast` §12. Stacking `z-overlay` §13. Type `text-sm` /
`text-xs` / `text-caption` / `text-body-sm` §8. Spacing on the 4px grid §9. **No new token; no raw
hex; no arbitrary value.**

**Components:**

- **NEW primitive (authored this step):** `ContextMenu` (+ its parts) — `components/ui/context-menu.tsx`.
- **Reused:** `PanelTabStrip` (favorite tab via additive `icon`/context-menu slot), `ActiveTabSurface`
  + `A2UIProvider` (inline live mirror), `SURFACE_ICON` (D-10, favorite glyph + empty-state glyph),
  `Button` (`secondary`/`ghost` `sm` for the gone-source Unpin; the strip's `ghost icon-xs` close),
  `Tooltip` (strip), `ScrollArea`/`scrollbar-hover-only` (D-9, content overflow), the
  `SurfaceErrorBoundary` (error state), the `PanelTabTree` empty-block idiom (gone/waiting states).

---

## 7. DESIGN.md updates (made this step)

- **§14 primitive canon** — added a **ContextMenu** row (the 17th primitive).
- **§5 registry** — added **D-19** (ContextMenu primitive + the favorite-tab / inline-live-mirror
  treatment), cross-referencing the tab-strip canon, D-10 (SURFACE_ICON), D-13 (the gone-source
  Unpin is an in-body `sm` control, not a footer), D-15/D-16 (panel-tab tree), and §15.

---

## 8. Open questions

None blocking. Two notes for the developer, already resolved in the plan:

- The `PanelTab` additive `icon?`/`kind:'favorite'` + per-tab context-menu slot is a small
  `PanelTabStrip` change (Phase 3) — keep it additive so the four generative panels + terminal are
  untouched.
- The disabled-terminal hint placement (item `aria` vs an adjacent `ContextMenuLabel`) is a minor
  call; the design recommends **disabled item + `ContextMenuLabel` hint** for discoverability
  (SC-005), but a `title`-only hint is acceptable if simpler.

## 9. Corrections (user feedback, 2026-06-30) — favorite = full-width source mirror incl. Open Prompt

A favorite is "literally a shortcut showing the SOURCE tab AS-IS." Two refinements to §1/§4:

1. **The cross-panel tab TREE renders ONLY on the default "Cosmos" tab.** The timeline|tree split (§1)
   applies only to the default tab. A FAVORITE tab is a **single FULL-WIDTH pane** — `FavoriteSurface`
   fills the whole content area, with **no tree, no `ResizeDivider`** (the favorite branch renders
   `FavoriteSurface` as the row's only `flex-1` child).
2. **A favorite shows the source view "as-is", INCLUDING the source panel's own floating Open Prompt.**
   The docked Cosmos conversation composer (§1, D-3) is **hidden** while a favorite tab is active (Home
   publishes a null `'cosmos'` composer config → the App-level `SharedComposer` renders nothing). In
   its place the favorite overlays the **SOURCE panel's already-published composer** (read by key via
   `useActiveComposerConfig(source.panelId)`) as a **floating** `PromptComposer` (`mode="floating"`,
   the same draggable Open-Prompt logo the source panel shows), positioned over the full-width favorite
   pane (a `pointer-events-none absolute inset-0` overlay inside the now-`relative` split row). Its
   submit routes to the **SOURCE target** via the source panel's own `onSubmit` — so a favorite
   Open-Prompt run lands in the source tab the favorite mirrors. No new design token; reuses the
   `PromptComposer` floating mode + the existing global Open-Prompt position.
