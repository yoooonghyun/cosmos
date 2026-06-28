# Design Spec: Cosmos Panel-Tab List — v1

**Status**: Draft
**Created**: 2026-06-29
**Owner**: designer
**Spec**: `.sdd/specs/cosmos-panel-tab-list-v1.md`
**Plan**: `.sdd/plans/cosmos-panel-tab-list-v1.md`
**DESIGN.md rules added this cycle**: **D-15** (cross-surface tree), **D-16** (panel+tab chip kind)

---

## Grounding (run directly by the designer for this spec)

**`docs/DESIGN.md` read first** (I own it): §2 surface→token map, §3 brand/active-affordance,
§8 typography ramp, §9 spacing, §10 radius, §13 z-index, §14 primitive canon, §15 chat-surface
canon, and the full §5 registry — esp. **D-4** (active = `--brand-accent`, never blue), **D-6**
(named scales only, no arbitraries), **D-7** (thin ~1.5px focus ring), **D-9** (canonical
scrollbar = `ScrollArea` / `scrollbar-hover-only`), **D-10** (`SURFACE_ICON` = the ONE rail/footer
glyph source), **D-11** (read-only captured-context = single breadcrumb pill), **D-14** (chat
surface tokens). Takeaway: this feature is fully expressible in existing tokens + the FileTree /
ContextChip / PromptContextChip idioms — **no new token, no new primitive, no shadcn install.**

**`codegraph_explore` queries (one-line takeaways):**

- `ContextChip ContextChipData viewContextCapture contextChipIcons PromptContextChip SURFACE_ICON
  RAIL_LABEL` — the composer `ContextChip` (`app/ContextChip.tsx`) renders an *item-oriented*
  `ContextChipData` (`primary.kind: jira|slack-channel|confluence|calendar`) via `PRIMARY_ICON`/
  `PRIMARY_NOUN`; the read-only timeline `PromptContextChip` (`cosmos/PromptContextChip.tsx`)
  ALREADY renders the panel+tab breadcrumb I need — `SURFACE_ICON[panel.id]` + label, muted
  `ChevronRight`, lucide `AppWindow` for the tab, on `Badge variant="secondary"` (D-11). The
  panel+tab chip is that idiom + the composer chip's removable `×`.
- `FileTree ResizeDivider TerminalPanel split treeWidth roving tabindex keymap` — `FileTree`
  (`fileExplorer/FileTree.tsx`) is the `role="tree"` roving-tabindex pattern to reuse (h-7 rows,
  `rounded-sm`, `hover:bg-accent`, `data-[selected]`, ScrollArea, the dir/file = group/leaf
  structure, the exact ARrow/Home/End/Enter/Space keymap, the "Empty" inline line). `ResizeDivider`
  (`fileExplorer/ResizeDivider.tsx`) is the 6px `role="separator"` w-1.5 handle (`onResize(deltaPx)`,
  Arrow ±16 / Shift ±64, parent owns the clamp). `TerminalPanel` clamps with `TERM_MIN/TREE_MIN/
  VIEWER_MIN` and `flex: 0 0 ${px}` columns, **renderer-local / not persisted** (TerminalPanel.tsx:139).
- `ComposerConfig usePublishComposer activeComposer contextChip PromptComposer ContextChip` — the
  Cosmos panel publishes its `ComposerConfig` via `usePublishComposer('cosmos', …)`; the docked
  `PromptComposer` already accepts `contextChip?: ContextChipData` + a `ContextDismiss` (`'all'`
  clears) on `onSubmit`. So a tree selection feeds the SAME `contextChip` prop the composer already
  renders — only the chip *kind* is new.
- `CosmosPanel.tsx` (read) — current body is `PanelTabStrip` + one `flex-1 overflow-auto p-3`
  timeline div inside `<section bg-card>`; the docked composer band is App-level, **below** this
  section (SharedComposer). The split replaces that single timeline div; the section + docked band
  are untouched.

**Token utilities confirmed in `index.css`:** `bg-/text-/ring-/before:bg-brand-accent`
(`--brand-accent #d8b4fe`, lines 92–94/548), `--ring #d8b4fe` (504), `text-body-sm/-caption/-nano`
(§8), `bg-accent/-muted`, `border-border`, `max-w-chat-bubble`. **Nothing new required.**

---

## 0. Scope of this design

Three surfaces, all built from existing primitives:

1. **The split** — timeline LEFT, `PanelTabTree` RIGHT, `ResizeDivider` between, inside the Cosmos
   `<section>`; the docked composer band below is unchanged.
2. **The `PanelTabTree`** — a `FileTree`-idiom `role="tree"`: per-panel group headers, tab rows,
   active-source / context-selected / hover / focus states, empty states.
3. **The panel+tab context chip** — a new `ContextChipData` *kind* the docked composer renders as a
   `[PanelGlyph] Panel › [AppWindow] Tab ×` breadcrumb (the D-11 idiom + a removable `×`).

It also codifies **D-15** and **D-16** in `docs/DESIGN.md` (done this cycle, see §6).

---

## 1. Split layout

### 1.1 Structure

Replace the single timeline `<div>` in `CosmosPanel` with a horizontal flex ROW that is the
section's `flex-1` body. The `PanelTabStrip` stays above it; the App-level docked composer band
stays below the `<section>` (untouched — **D-3**: it keeps its `bg-card`, no seam).

```
<section class="flex h-full flex-col border-l border-border bg-card">   ← unchanged
  <PanelTabStrip … />                                                   ← unchanged
  <div class="flex min-h-0 flex-1 flex-row">                            ← NEW split row
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">   timeline (LEFT, existing overflow-auto)
      …timeline ScrollArea/overflow region (unchanged content)…
    </div>
    <ResizeDivider onResize={handleTreeResize}
                   ariaLabel="Resize timeline and panel tabs" />
    <aside class="flex min-h-0 flex-col border-l border-border"
           style={treeWidth ? {flex:`0 0 ${treeWidth}px`} : {flex:'0 0 30%'}}>
      <PanelTabTree … />                                                ← RIGHT
    </aside>
  </div>
  // docked composer band (App-level, below this section) — UNCHANGED
</section>
```

The timeline column keeps its own scroll region; the tree column scrolls independently
(`PanelTabTree` wraps its rows in `ScrollArea`, **D-9**). Both columns are `min-h-0` so they scroll
rather than push the section. The seam is the tree column's `border-l border-border`; the
`ResizeDivider` straddles it (its accent line shows on hover/drag).

### 1.2 Divider, default ratio, mins (mirror the Terminal split — FR-002/FR-004)

| Property | Value | Rationale |
|---|---|---|
| Divider | **REUSE `ResizeDivider`** (`fileExplorer/ResizeDivider.tsx`) | FR-002 — no new resize primitive. `w-1.5`, `role="separator"`, Arrow ±16 / Shift ±64, `z-raised`(10). |
| Divider drives | the **TREE (right) width** | Mirror Terminal "Divider B" (viewer\|tree): a POSITIVE (rightward) drag SHRINKS the tree → subtract the delta in `handleTreeResize`. Timeline = `flex:1 1 0` takes the remainder. |
| Default ratio | tree `flex: 0 0 30%` (state `null`), timeline `flex: 1 1 0` | Timeline (the conversation) is primary; the tree is a survey dock, like the Terminal file-tree dock (~25–30%). |
| `TIMELINE_MIN` | **360px** | The chat bubble is `max-w-chat-bubble` (85%); below ~360 the timeline reads cramped. |
| `TREE_MIN` | **240px** | Group header (panel glyph + "Google Calendar") + indented tab labels need ~15rem (matches Terminal `TREE_MIN`=256-ish; tree rows here are simpler so 240). |
| Persistence | **session-only, NOT persisted** (renderer-local `useState`, like Terminal `treeWidth`) | OQ-1 default — terminal parity. No snapshot field, no `SESSION_SCHEMA_VERSION` change. |

`handleTreeResize(deltaPx)`: read the row's `clientWidth`, clamp the next tree width to
`[TREE_MIN, total − TIMELINE_MIN]`, `setTreeWidth(next)`. No xterm re-fit needed (no terminal in
this split) — simpler than the Terminal handler.

---

## 2. `PanelTabTree` — the right-column tree

A new presentational component `src/renderer/cosmos/PanelTabTree.tsx`, built as a **FileTree-idiom
`role="tree"`** (FR-003: same roving-tabindex keymap, same visual language). It is fed the ordered
groups from `toPanelTabGroups(...)` (the plan's pure module) + the `selectedContext` + an
`onActivate(panelId, tab)` callback.

### 2.1 Tree skeleton & a11y (reuse FileTree's keymap verbatim — FR-003)

- Container: `<ScrollArea className="min-h-0 flex-1">` › `<div role="tree" aria-label="Open panel
  tabs" onKeyDown={…}>` (D-9, FileTree pattern).
- **Two levels** (mirrors FileTree dir/leaf):
  - **Group header** = `role="treeitem" aria-level={1} aria-expanded={expanded}`; owns a
    `role="group"` child container of its tab rows.
  - **Tab row** = `role="treeitem" aria-level={2} aria-selected={contextSelected}`.
- **Roving tabindex** over the *visible* rows (headers + the tab rows of expanded groups): exactly
  one row `tabIndex={0}`, the rest `-1`; arrow nav pulls DOM focus to the active row (the FileTree
  `useEffect(focus)` idiom).
- **Keymap — identical to `FileTree.onKeyDown` (do NOT diverge, FR-003):** ↑/↓ move focus across
  visible rows; **Home/End** jump; **→** on a collapsed group expands, on an expanded group descends
  to its first tab; **←** on an expanded group collapses, on a tab row ascends to its group header;
  **Enter / Space** on a group header toggles expand, on a tab row **activates** (= select as
  context, §3). Group expand/collapse state is renderer-local, default **expanded** (survey-first);
  not persisted (out of scope per spec).

### 2.2 Group header row

| Aspect | Token / value |
|---|---|
| Row box | `flex h-7 w-full items-center gap-1.5 rounded-sm pr-2`, `paddingLeft: 8` |
| Type | `text-body-sm` (§8, 13px) `font-medium` `text-foreground` |
| Disclosure chevron | `ChevronDown`/`ChevronRight` `size-3.5 text-muted-foreground` (FileTree glyphs) |
| **Panel glyph** | **`SURFACE_ICON[panelId]`** `size-3.5 shrink-0 text-muted-foreground` — **D-10, the ONE icon source** (same mark the rail + footer + timeline chip use; `currentColor`, inherits muted) |
| Label | `RAIL_LABEL[panelId]` ("Slack" / "Jira" / "Confluence" / "Google Calendar" / "Terminal"), `truncate` |
| Hover | `hover:bg-accent` |
| Focus (roving) | `focus-visible:ring-[1.5px] focus-visible:ring-ring focus-visible:ring-inset` (**D-7** thin ring; FileTree still ships `ring-2` — new surface uses the canonical thin ring) |
| Count | **omitted in v1** (calm; the rows speak for themselves) |

No count badge, no per-panel color — quiet, of-a-piece with the file tree.

### 2.3 Tab row

| Aspect | Token / value |
|---|---|
| Row box | `group/row flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm pr-2`, `paddingLeft: 1*12 + 8 = 20` (level-2 indent, FileTree math) |
| Type | `text-body-sm` (§8) `text-foreground/90` |
| **Leading slot** (size-4, where FileTree puts the file spacer) | **active-source dot** when this is the panel's `activeTabId`: `<span class="size-1.5 rounded-full bg-brand-accent">` (**D-4** — active = `--brand-accent`, never blue); empty otherwise (names stay aligned) |
| **Tab glyph** | lucide **`AppWindow`** `size-3.5 shrink-0 text-muted-foreground` — the SAME "a tab" glyph the timeline `PromptContextChip` uses for its tab dimension (D-11 of-a-piece) |
| Label | the tab's current display label, `min-w-0 truncate`; wrapped in `Tooltip`(side="right") exposing the full label (FileTree idiom) |
| Hover | `hover:bg-accent` |
| Focus (roving) | thin `ring-[1.5px] ring-ring ring-inset` (**D-7**) |

### 2.4 The three row states (this tree has ONE more than FileTree — keep them distinct)

FileTree conflates focus + open-file into one `data-selected`. This tree needs **three** visually
separable states so "the row I'm arrowing over" ≠ "the tab chosen as context":

1. **Hover** — transient `bg-accent`. (pointer affordance only)
2. **Roving focus** — thin inset `--ring` ring (D-7). (keyboard position; no fill so it reads as
   "where focus is," not "what's chosen")
3. **Context-selected** (persistent — the tab currently attached to the next prompt):
   `data-context-selected` → `bg-accent` fill **+ a 2px `--brand-accent` inset left bar**
   (`before:absolute before:left-0 before:inset-y-1 before:w-0.5 before:rounded-full
   before:bg-brand-accent`) **+** label `text-foreground font-medium` **+** `aria-selected={true}`.
   The brand-accent left bar is the rail's own active-indicator idiom (**D-4**), so "this tab is the
   context" reads as the same active-affordance language as the rail/active-tab pill — and is
   unmistakably different from a mere hover or focus.

Only one row is context-selected at a time (re-selecting replaces it, FR-016). When the selection is
dismissed/cleared, no row is context-selected.

### 2.5 Empty & resilience states (every state — §4 of DESIGN.md)

| State | Treatment |
|---|---|
| **Loading** | **N/A** — the tree reads a synchronous in-renderer registry (no fetch). Before any panel has published, it degrades to the calm empty state below; no spinner, no skeleton. |
| **Empty group** (a panel published, zero tabs — FR-020) | a single quiet line under the group header at the tab indent: `"No open tabs"`, `text-caption` (§8, 12px) `text-muted-foreground italic`, `paddingLeft: 2*12+8 = 32` — the FileTree "Empty" line idiom. Never a phantom row, never a silently dropped group. |
| **All-empty / no groups** (no in-scope panel available — FR-021) | a single calm centered block (FileTree empty-root idiom): `flex flex-col items-center justify-center gap-2 py-8 text-center` › lucide `PanelsTopLeft` (or `LayoutList`) `size-6 text-muted-foreground` + `<p class="text-caption text-muted-foreground">No open tabs in other panels</p>`. |
| **Populated** | the ordered groups (§2.2/§2.3). Fixed panel order from `toPanelTabGroups` order arg; a panel that has not published (disabled/unmounted, FR-006) is simply absent. |
| **Malformed entry** (FR-022) | skipped upstream in the pure `toPanelTabGroups` (warn-and-skip); visually it is just absent — never crashes the tree. |

### 2.6 Tokens used (all existing — D-6, no arbitraries)

`text-body-sm` · `text-caption` (§8); `bg-card` (column, §2) · `bg-accent` (hover/selected) ·
`text-foreground` / `text-foreground/90` · `text-muted-foreground`; `border-border` (column seam) ;
`bg-brand-accent` / `before:bg-brand-accent` (active dot + selected bar, **D-4**) ; `ring-ring`
`ring-[1.5px]` (focus, **D-7**) ; `rounded-sm` / `rounded-full` (§10) ; `h-7` / `gap-1.5` / `pr-2` /
indent `*12+8` (§9 4px grid + FileTree idiom) ; `ScrollArea` (**D-9**) ; `z-raised` on the divider
(§13). **No new token. No raw hex / `text-[Npx]` / `z-50`.**

---

## 3. The panel+tab context chip (`ContextChipData` kind extension)

### 3.1 The problem (confirmed against source)

`ContextChipData` is item-oriented and **cannot express a plain panel+tab selection**:

```ts
// app/viewContextCapture.ts — CURRENT
interface ContextChipData {
  primary: { kind: 'jira'|'slack-channel'|'confluence'|'calendar'; label: string; fullLabel?: string }
  secondary?: { kind: 'slack-thread'; label: string }
}
```

Its glyph/noun come from `PRIMARY_ICON`/`PRIMARY_NOUN` keyed by those four item kinds. A tree
selection has **no dock item** — it has a panel (whose glyph is `SURFACE_ICON[panelId]`, not a fixed
`PRIMARY_ICON`) and a tab. So a new chip *kind* is required.

### 3.2 The shape — a discriminated union on `kind` (D-16)

Promote `ContextChipData` to a discriminated union; the existing item chip becomes `kind: 'item'`,
the new tree selection is `kind: 'panel-tab'`:

```ts
// app/viewContextCapture.ts — EXTENDED (developer wires; this is the design contract)
export type ContextChipData = ItemContextChip | PanelTabContextChip

export interface ItemContextChip {           // the EXISTING chip, now tagged
  kind: 'item'
  primary: { kind: 'jira'|'slack-channel'|'confluence'|'calendar'; label: string; fullLabel?: string }
  secondary?: { kind: 'slack-thread'; label: string }
}

export interface PanelTabContextChip {       // NEW — a panel+tab tree selection
  kind: 'panel-tab'
  /** Panel glyph resolves via SURFACE_ICON[panel.id] (D-10), NOT PRIMARY_ICON. */
  panel: { id: PromptPanelId; label: string }   // PromptPanelId gains 'terminal' (plan T1)
  /** The selected tab; label is the truncatable display label. */
  tab: { id: string; label: string }
}
```

- `contextChipFor(...)` returns the `kind: 'item'` variant (add the tag; its 4 branches unchanged).
- A new pure builder (plan: `cosmos/cosmosSelectedContext.ts`) maps a `PromptContext` panel+tab
  selection → the `kind: 'panel-tab'` variant.
- **Non-secret invariant (FR-011):** only `panel.id` / `panel.label` / `tab.id` / `tab.label` —
  display/identity labels already on screen. No token, path, dock secret.

Why a union, not a 5th `primary.kind`: a 5th item kind would force a `PRIMARY_ICON`/`PRIMARY_NOUN`
entry, but a panel+tab's glyph is **per-panel** (`SURFACE_ICON`), not a single fixed icon — and it
has no dock item to head the `↳` primary badge. The union keeps the item chip exactly as-is and
makes the panel+tab chip render the *breadcrumb* idiom instead (next).

### 3.3 Chip rendering — the D-11 breadcrumb + the composer's removable `×`

The docked composer renders `contextChip` via `app/ContextChip.tsx`, which branches on
`data.kind`:

- **`kind: 'item'`** → today's rendering, unchanged (`↳` + `PRIMARY_ICON` + label + `×`; optional
  Slack thread second badge).
- **`kind: 'panel-tab'`** → a single `Badge variant="secondary"` breadcrumb — **the same idiom the
  read-only timeline `PromptContextChip` already ships (D-11)**, plus the composer chip's removable
  `×`:

```
[ <SURFACE_ICON[panel.id]>  Slack  ›  <AppWindow>  #general  (×) ]
```

| Element | Token / value | Source rule |
|---|---|---|
| Pill | `Badge variant="secondary"` (`bg-secondary`/`text-secondary-foreground`), `min-w-0 max-w-[18rem]` (composer chip width) | §15 secondary family; same as the item chip |
| `role` / a11y | `role="note"` `aria-label={\`Prompt context: ${panel.label} panel, ${tab.label} tab\`}` | matches `PromptContextChip.ariaLabelFor` |
| Panel glyph | **`SURFACE_ICON[panel.id]`** `shrink-0 text-muted-foreground` | **D-10** (one icon source) |
| Panel label | `<span class="shrink-0">{panel.label}</span>` | |
| Separator | lucide `ChevronRight` `shrink-0 text-muted-foreground` | D-11 breadcrumb join |
| Tab glyph | lucide **`AppWindow`** `shrink-0 text-muted-foreground` | D-11 tab dimension |
| Tab label | `TruncLabel` (truncate + Tooltip), `text-secondary-foreground` | §15 (label never dimmed below contrast) |
| **`×` dismiss** | `Button variant="ghost" size="icon-xs"` trailing `X`, `aria-label={\`Remove ${tab.label} from this prompt\`}`, `disabled={running}`, `-mr-1 ml-0.5 rounded-full hover:bg-accent` | composer `ContextChip` `×` idiom; fires `onSubmit`'s `contextDismiss:'all'` path → clears the selection (FR-016) |
| **No `↳`** | — | the `↳` decorates a *dock item* only; a panel+tab has none (consistent with `PromptContextChip`, which only `↳`'s the dock segment) |

This makes the **composer** chip and the **timeline** `PromptContextChip` render the identical
panel›tab breadcrumb (one with a `×`, one read-only) — exactly the D-11 "two chips never fork" intent.

### 3.4 Feeding the chip + one-shot lifecycle (composer wiring — visual contract)

- The Cosmos `ComposerConfig` derives `contextChip` from `selectedContext`: when a panel+tab is
  selected → the `kind: 'panel-tab'` chip (§3.2 builder); else `undefined` (no chip — the Cosmos
  panel has no dock-item chip of its own).
- The composer already drops a dismissed chip via `onSubmit(utterance, {contextDismiss:'all'})`;
  `CosmosPanel` maps `'all'` → `setSelectedContext(null)`.
- **One-shot (OQ-2 resolved):** on submit, after `buildAgentSubmitWithMarker(utterance,
  'generated-ui', ctx)` + `recordSubmitContext(ctx)` + the live seed, the selection clears
  (`setSelectedContext(null)`), so the chip disappears for the next compose — matching the existing
  per-compose, non-sticky view-context chip.
- **Reconcile (FR-017):** a closed selected tab clears the chip (no stale breadcrumb); a renamed
  selected tab relabels the chip's tab segment. Both via the plan's pure
  `reconcileSelectedContext`.

---

## 4. States summary (every surface, every state)

| Surface | loading | empty | populated | error | disabled |
|---|---|---|---|---|---|
| **Split** | n/a (synchronous layout) | timeline empty → existing "Describe a UI…" copy; tree → §2.5 empty | both columns render; divider draggable | timeline read-error → existing alert; tree malformed entry → skipped (FR-022) | n/a (always-visible, only resizable) |
| **PanelTabTree** | n/a (sync read) | empty group → "No open tabs"; no groups → calm centered block (§2.5) | grouped rows (§2.2/2.3) | malformed entry skipped, never crashes | a not-available panel is absent (FR-006), not a greyed group |
| **Panel+tab chip** | n/a | no selection → no chip (`undefined`) | `kind:'panel-tab'` breadcrumb (§3.3) | closed selected tab → chip cleared (FR-017) | `×` `disabled` while `running` (composer idiom) |

---

## 5. Interaction & accessibility

- **Focus order**: `PanelTabStrip` → timeline scroll region → `ResizeDivider` (`role="separator"`,
  tabbable, Arrow/Shift resize) → `PanelTabTree` (`role="tree"`, single roving `tabIndex={0}` row) →
  the docked composer below. The tree is ONE tab stop; rows are arrow-navigated (roving tabindex).
- **Keyboard (tree)**: the FileTree keymap verbatim (§2.1) — ↑/↓/Home/End move, →/← expand/collapse/
  descend/ascend, Enter/Space activate. Activating a tab row = select-as-context (no navigation,
  FR-012).
- **Keyboard (divider)**: ResizeDivider's Arrow ±16 / Shift ±64 (FR-002).
- **ARIA**: tree `aria-label="Open panel tabs"`; group `aria-expanded`; tab row `aria-selected`
  reflects context-selection; divider `aria-label="Resize timeline and panel tabs"`; the chip
  `role="note"` + full panel/tab `aria-label` (§3.3).
- **Contrast (dark palette)**: tab labels `text-foreground/90` and group headers `text-foreground`
  sit on `bg-card`/`bg-accent` — all ≥ AA (same as FileTree). The active dot + selected left bar use
  `--brand-accent #d8b4fe` (the sanctioned active accent, D-4) — decoration that reinforces a state
  the `aria-selected` / active-tab semantics already carry, never the sole signal.
- **Motion**: hover/selected are color-only transitions; no new keyframes. (No reduced-motion gate
  needed beyond Tailwind's color transition.)

---

## 6. DESIGN.md criteria added this cycle (I own the file — done)

Two enforceable registry rules added to `docs/DESIGN.md` §5. No new token / no `index.css` change
(every value reuses an existing token), so the doc↔stylesheet sync invariant holds.

- **D-15 — cross-surface read-only tree REUSES the FileTree pattern.** A renderer tree that surveys
  another surface's items (the Cosmos panel-tab list) MUST reuse `FileTree`'s `role="tree"`
  roving-tabindex pattern + visual language: `ScrollArea`(D-9), `h-7` `rounded-sm` rows,
  `text-body-sm`, the verbatim Arrow/Home/End/Enter/Space keymap, group header = `SURFACE_ICON`
  glyph (D-10) + `RAIL_LABEL`, leaf row = a single consistent lucide glyph + label + Tooltip; the
  THREE row states stay visually distinct — hover `bg-accent`, roving focus thin `--ring` (D-7),
  persistent selection = leading `--brand-accent` inset bar + `bg-accent` + `font-medium` +
  `aria-selected` (D-4); a "live but inactive" item marker (the source panel's active tab) = a
  leading `--brand-accent` dot; empty group = quiet "No open tabs" line; no groups = one calm
  centered block; malformed entry skipped. NEVER a divergent keymap or bespoke tree.
- **D-16 — the context chip data is a discriminated union; a panel+tab selection renders the D-11
  breadcrumb.** `ContextChipData = { kind:'item' … } | { kind:'panel-tab'; panel; tab }`. The
  `panel-tab` chip renders the SAME `[SURFACE_ICON panel] Panel › [AppWindow] Tab` breadcrumb as the
  read-only timeline `PromptContextChip` (D-11) on `Badge variant="secondary"`, muted `ChevronRight`
  separator — panel glyph from `SURFACE_ICON` (D-10, NOT `PRIMARY_ICON`), tab glyph lucide
  `AppWindow`, NO `↳` (that decorates a dock item only). The COMPOSER variant keeps the removable
  `×` (`ghost` `icon-xs`, `contextDismiss:'all'`); the timeline variant is read-only. Non-secret
  labels only (FR-011). The two chips never fork.

---

## 7. Build wiring / hand-offs (designer has no Bash)

- **No shadcn install, no new dependency, no new token, no `index.css` edit.** Everything composes
  from existing primitives (`FileTree` idiom, `ResizeDivider`, `Badge`, `Tooltip`, `Button`,
  `ScrollArea`, `SURFACE_ICON`, lucide `AppWindow`/`ChevronRight`/`PanelsTopLeft`) + named tokens.
- Developer builds (Steps 3–5): `cosmos/PanelTabTree.tsx`, the `ContextChipData` union extension in
  `app/viewContextCapture.ts`, the `kind: 'panel-tab'` branch in `app/ContextChip.tsx`, the
  `cosmos/cosmosSelectedContext.ts` chip builder, and the `CosmosPanel` split + selection wiring —
  per the plan's file list. This spec is the visual contract for all of them.

## 8. Open questions

- **None blocking.** OQ-1 (split persistence) and OQ-2 (selection lifetime) are resolved to the
  terminal-parity / one-shot defaults in the plan and reflected here. OQ-3 (dock dimension
  cross-panel) is explicitly out of v1 scope; the panel+tab chip (D-16) is intentionally
  dock-free — when OQ-3 lands, a dock segment is added by reusing the existing `DockSegment` of
  `PromptContextChip`, no new chip kind. T1 (`PromptPanelId += 'terminal'`) is assumed so a Terminal
  tab is selectable; the `panel-tab` chip's `SURFACE_ICON['terminal']` already exists (D-10), so the
  chip renders a Terminal selection with no further design work.
```
