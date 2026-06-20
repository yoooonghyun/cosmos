# Design: Jira Tab-Switch Auto-Refresh — Data-Region Loading Skeleton — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: `.sdd/specs/jira-tab-switch-auto-refresh-v1.md`
**Plan**: `.sdd/plans/jira-tab-switch-auto-refresh-v1.md`
**Scope**: The loading skeleton shown over the Jira **data region** while a bound surface
auto-refreshes on tab re-activation. Data-region-only (chrome stays). No theme/component-system
edits in this pass (concurrent design-system work in flight).

---

## Grounding

> Tools I ran directly to ground this design (mandatory per designer protocol).

**codegraph_explore**
- `"JiraPanel DefaultViewSkeleton Skeleton primitive loadingDefault navLoading kanban issue list data region"`
  — got the verbatim `Skeleton` primitive (`components/ui/skeleton.tsx`: a single
  `animate-pulse rounded-md bg-accent` div) and the existing `DefaultViewSkeleton`
  (`JiraPanel.tsx:64-80`): a vertical stack of one label bar + 4 bordered card placeholders
  (`rounded-xl border border-border p-3`, each with a key chip, status pill, summary line, meta
  line), wrapped `aria-busy="true"`. Confirmed `IssueList` (`jiraCatalog/components.tsx:277-373`)
  renders a vertical `flex-col gap-2` of `TicketCard`s — `DefaultViewSkeleton` already mirrors the
  list card shape (`rounded-xl border ... p-3`, key/status/summary/meta).
- `"standardCatalog Column Row container ... kanban multi-region IssueList horizontal columns flex"`
  — confirmed the kanban is **agent-emitted** (`render_jira_ui`), structured as a horizontal `Row`
  of `Column`s, each `Column` holding a header + an `IssueList` region. Main-built single surfaces
  (default list / detail) are single-`Column` roots (`jiraSurfaceBuilder.ts:299/384/484`), so the
  board's multi-column shape exists only on the bound multi-region surface.

**Read**
- `JiraPanel.tsx:403-464` — the data-region gate is at `:431`
  (`activeTab?.loadingDefault || navLoading ? <DefaultViewSkeleton/> : <surface/>`), nested inside
  the content `<div className="min-h-0 flex-1 p-3" role="tabpanel">` (`:426`). The tab strip,
  JQL/search row, `PromptComposer`, and `PanelFooter` all render OUTSIDE/around this `<div>` — so a
  skeleton placed at `:431` already covers ONLY the data region. **Chrome stays visible by
  construction.**
- `.sdd/designs/jira-generative-adapter-v1.md:78,184-188` — house empty/focus/keyboard treatment
  for the issue-list surface (matched for consistency).

**memory_recall** — `"cosmos design system skeleton loading state Jira panel tokens"` → no stored
observations. Design-system preference (Tailwind v4 + shadcn, real component library) noted in
MEMORY index; no prior tab-switch-skeleton decision exists.

---

## Summary of decisions

1. **Data-region-only — confirmed.** The skeleton replaces ONLY the surface content inside the
   `role="tabpanel"` content `<div>` (`JiraPanel.tsx:426`). Panel chrome — the tab strip, the
   JQL/search row, the prompt composer, and the footer/connection bar — stays mounted and visible.
   This is already how the gate at `:431` works; this feature only widens the gate condition. NOT a
   whole-surface skeleton.
2. **Two skeleton variants, picked by the surface's shape:**
   - **Issue-list / single-region (and detail) surfaces** → reuse the EXISTING `DefaultViewSkeleton`
     **as-is**. Its 4 stacked card placeholders already mirror the `IssueList`'s vertical card stack.
   - **Kanban / multi-region (partitioned) board** → a NEW **`KanbanBoardSkeleton`** variant: a
     horizontal row of column placeholders, each column a header bar + a stack of card placeholders,
     so the loading state reads as a board, not a single list. Without this, a board would flash a
     single-column list skeleton then snap to multiple columns — a shape mismatch the user notices.
   - Both variants are built ENTIRELY from the existing `Skeleton` primitive + existing tokens. The
     kanban variant reuses `DefaultViewSkeleton`'s card placeholder as its per-card unit, so the two
     skeletons are visibly the same family.
3. **No new theme token, no new `components/ui/` primitive.** The `Skeleton` primitive + existing
   tokens (`border`, `accent`, `muted-foreground`, `card`, radius) fully express both variants. See
   "New tokens / primitives" — none required.

---

## Surfaces & layout

### Where the skeleton lives

cosmos Jira panel, the active tab's **content region** only:
`JiraPanel.tsx:426` `<div className="min-h-0 flex-1 p-3 text-card-foreground" role="tabpanel">` →
gate at `:431`. Everything else in `JiraPanel` (tab strip above, composer + `PanelFooter` below,
the JQL/search row) is OUTSIDE this `<div>` and is unaffected — it stays fully rendered and
interactive while the data region shows the skeleton.

### Which skeleton for which data view

| Bound surface re-activated | Skeleton shown over data region |
|----------------------------|---------------------------------|
| Issue list (single-region `descriptor`, e.g. default `assignee = currentUser()` read, JQL search results) | `DefaultViewSkeleton` (existing, unchanged) |
| Ticket detail (single-region `descriptor`) | `DefaultViewSkeleton` (existing) — acceptable: it reads as "content loading"; a detail-specific skeleton is out of scope (the detail surface is itself a Column of stacked cards, which the stacked placeholders approximate) |
| **Kanban board (multi-region `bindings`, `Row` of `Column`s)** | **`KanbanBoardSkeleton`** (NEW variant) |

The variant is chosen from whether the re-activating surface is **multi-region (bound `bindings`)**
vs **single-region (`descriptor`)** — the same bound-ness the plan's `autoRefreshValues` already
discriminates (`{ surfaceId, bindings }` for kanban vs `{ surfaceId, descriptor }` for list). The
panel passes that distinction to the gate so the right skeleton renders.

---

## Component spec

### Variant A — `DefaultViewSkeleton` (issue list / detail) — REUSED AS-IS

No change. For reference, current shape (`JiraPanel.tsx:64-80`):
- Outer `flex flex-col gap-2`, `aria-busy="true"`.
- One label bar: `Skeleton className="h-3 w-16"`.
- 4 card placeholders, each `flex flex-col gap-2 rounded-xl border border-border p-3`:
  - Header row (`flex items-center justify-between`): key chip `Skeleton h-4 w-14` + status pill
    `Skeleton h-4 w-16 rounded-full`.
  - Summary line: `Skeleton h-4 w-3/4`.
  - Meta line: `Skeleton h-4 w-24`.

### Variant B — `KanbanBoardSkeleton` (NEW, multi-region board)

A horizontal row of column skeletons matching the agent-emitted `Row`-of-`Column`s board. New
component (developer adds it beside `DefaultViewSkeleton` in `JiraPanel.tsx`, built from the existing
`Skeleton` primitive — NOT a `components/ui/` primitive).

**Structure / exact shapes:**

- **Board container**: `flex gap-3 overflow-x-auto`, `aria-busy="true"`.
  (Horizontal layout + horizontal overflow so it occupies the same axis as a real multi-column board
  that exceeds the panel width.)
- **Columns**: render **3** column placeholders (a board's typical To Do / In Progress / Done; a
  fixed count is correct for a loading placeholder — the real column count lands with the data).
  Each column: `flex w-64 shrink-0 flex-col gap-2`.
  - **Column header bar** (mirrors the per-column header in the emitted board): a row
    `flex items-center justify-between`:
    - column title: `Skeleton h-3.5 w-20`
    - count chip: `Skeleton h-4 w-6 rounded-full`
  - **Card placeholders**: **3** per column, each IDENTICAL to Variant A's card unit
    (`flex flex-col gap-2 rounded-xl border border-border p-3`, key chip + status pill + summary
    `w-3/4` + meta `w-24`). Reusing the same card unit keeps the two skeletons one family.

**Counts:** 3 columns × 3 cards. (Enough to read as a board without implying a specific real shape;
the floor is brief, so density just needs to convey "board loading.")

**ASCII reference (board variant):**

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ ▭▭▭     (▭)  │  │ ▭▭▭     (▭)  │  │ ▭▭▭     (▭)  │   ← column header: title + count chip
│ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │
│ │▭▭   (▭▭) │ │  │ │▭▭   (▭▭) │ │  │ │▭▭   (▭▭) │ │   ← card: key chip + status pill
│ │▭▭▭▭▭▭▭   │ │  │ │▭▭▭▭▭▭▭   │ │  │ │▭▭▭▭▭▭▭   │ │   ← summary line (w-3/4)
│ │▭▭▭▭      │ │  │ │▭▭▭▭      │ │  │ │▭▭▭▭      │ │   ← meta line (w-24)
│ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │
│   (×3 cards) │  │   (×3 cards) │  │   (×3 cards) │
└──────────────┘  └──────────────┘  └──────────────┘
        ↕ data region only; chrome (tabs/search/composer/footer) stays
```

### Tokens used (both variants — all existing)

| Token / class | Use |
|---------------|-----|
| `bg-accent` (via `Skeleton`) | the shimmer fill of every placeholder bar |
| `animate-pulse`, `rounded-md` (via `Skeleton`) | the pulse animation + bar radius |
| `border-border` | card placeholder + (implicit) column boundary |
| `rounded-xl` | card placeholder corner (matches real `TicketCard`/`Card`) |
| `rounded-full` | status-pill + count-chip placeholders |
| `text-card-foreground` (inherited from content `<div>`) | container context |

No raw hex, no new CSS variable. Every value resolves to an existing token.

### Animation

- The ONLY animation is the existing `Skeleton`'s `animate-pulse` (opacity pulse). No bespoke
  shimmer, no per-column stagger, no transition — consistent with `DefaultViewSkeleton` and every
  other cosmos skeleton. Uniformity over novelty.
- The skeleton is shown for at least the existing `navLoading` floor (350ms, `beginNavLoad`,
  `JiraPanel.tsx:194-200`) so a warm/instant re-fetch does not blank-flash (spec FR-010). No new
  timing model — design reuses the existing floor.

---

## States

The skeleton is itself the **loading** state of the data region during tab-switch auto-refresh.
For the data region across the auto-refresh lifecycle:

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (this feature)** | Bound tab re-activated, auto-refresh in flight (`autoRefreshing` set), within the `navLoading` floor | `KanbanBoardSkeleton` for a multi-region board, else `DefaultViewSkeleton`. Chrome stays. `aria-busy="true"` on the skeleton container. |
| **Populated** | Auto-refresh `updateDataModel` lands; `autoRefreshing` cleared | Skeleton replaced by the repainted surface (existing `IssueList` / board). No fade required — the floor already covers the swap. |
| **Empty (populated, zero items)** | Refresh returns `[]` | The EXISTING `IssueList` empty block (`components.tsx:302-313`): centered `SquareKanban size-7 text-muted-foreground` + "No issues found." `py-8`. Unchanged — the skeleton does not own the empty state. For a kanban, each empty column shows its own empty block (existing per-region behavior). |
| **Error** | Auto-refresh fails | The EXISTING failure presentation: the recoverable `Alert variant="destructive"` notice above kept rows (`components.tsx:295-300`), or the panel's surface-error banner (`JiraPanel.tsx:439-446`). The skeleton clears on the error/Notice land (it must NOT hang) and resolves to the existing error treatment. No new error visual. |
| **Disabled** | n/a | The skeleton is non-interactive by nature (no controls). Chrome controls (composer, refresh) remain enabled during loading — they are not gated by `autoRefreshing`. |

The non-bound (static) and empty/Connect tabs show **no skeleton** (spec FR-005/FR-006) — they
repaint verbatim or keep their existing Connect/empty presentation.

---

## Interaction & accessibility

- **Focus order:** unchanged. The skeleton has no focusable elements; focus stays in the live chrome
  (search input, composer, footer). When the surface repaints, focus order returns to the existing
  issue-list/board order (refresh → cards → pagination, per `jira-generative-adapter-v1.md:184`).
- **Keyboard:** no new key handling. Chrome controls remain operable while the data region loads.
- **ARIA:** each skeleton container carries `aria-busy="true"` (Variant A already does; Variant B
  MUST set it on the board container). This is sufficient — the placeholders themselves are decorative
  (`Skeleton` is an unlabeled `<div>`); no `role`/`aria-label` per bar. The content `<div>` keeps its
  `role="tabpanel"`.
- **Contrast:** `bg-accent` placeholders on the panel `card`/`background` are decorative, low-contrast
  by design (a loading affordance, not text) — the `animate-pulse` opacity cue conveys "loading"
  without relying on color contrast. No contrast concern against the dark palette; matches every other
  cosmos skeleton.
- **No layout shift target:** the kanban skeleton's fixed `w-64` columns + horizontal overflow keep
  the data region's scroll axis identical to the real board, so the swap from skeleton → board does
  not jump the chrome.

---

## New tokens / primitives

**None required.** Both variants are expressed entirely with the existing `Skeleton` primitive
(`components/ui/skeleton.tsx`) and existing theme tokens. Per the coordination constraint, this pass
does NOT edit `src/renderer/index.css` or `src/renderer/components/ui/`. `KanbanBoardSkeleton` is a
panel-level composition (lives beside `DefaultViewSkeleton` in `JiraPanel.tsx`, developer-built), not
a new design-system primitive.

---

## Hand-off to developer

- Reuse `DefaultViewSkeleton` unchanged for single-region (list/detail) auto-refresh.
- Add `KanbanBoardSkeleton` beside it in `JiraPanel.tsx` per the Variant B spec (existing `Skeleton`
  primitive only; reuse the Variant A card unit as the per-card placeholder so the two are one family).
- At the `:431` gate, when the auto-refresh skeleton is shown for a **multi-region** bound surface,
  render `KanbanBoardSkeleton`; otherwise `DefaultViewSkeleton`. The multi-region vs single-region
  distinction is the same bound-ness the plan's `autoRefreshValues` discriminates
  (`bindings` ⇒ board, `descriptor` ⇒ list) — surface that flag to the gate.
- Set `aria-busy="true"` on the `KanbanBoardSkeleton` container.
- The `navLoading` floor (existing) governs the minimum show time — no new timing.

## Open questions

None. The spec's deferred OQ (whole-surface vs data-region-only) is resolved here as
**data-region-only**, matching the plan's §6 resolution and the user's explicit decision.
