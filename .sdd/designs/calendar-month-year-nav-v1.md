# Design: Calendar Month/Year Navigation — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: .sdd/specs/calendar-month-year-nav-v1.md
**Plan**: .sdd/plans/calendar-month-year-nav-v1.md
**Owner**: designer (Step 2.5)

---

## Grounding (tools I ran myself)

**codegraph_explore / codegraph_search**

- `codegraph_explore("CalendarMonthGrid EventList GoogleCalendarPanel googleCalendarCatalog components")` —
  confirmed the live default-view render chain: `EventList` (components.tsx:368) lays out a flex row of
  `CalendarLegend` (left `<aside>` rail, self-suppressing at ≤1 calendar) + a `flex-1` grid column; the column wraps
  `CalendarMonthGrid` in `<div className="flex min-h-0 min-w-0 flex-1 flex-col">`. `CalendarMonthGrid`
  (components.tsx:290) is `flex h-full min-h-0 flex-col gap-2` containing **(a)** the in-grid label header
  `<div class="flex items-center justify-between"><h2 class="text-sm font-medium text-foreground">{grid.monthLabel}</h2></div>`,
  **(b)** the optional `MonthEmptyNote`, then **(c)** the bordered grid box that is `flex min-h-0 flex-1 … auto-rows-fr`
  — the fill chain is `EventList(h-full) → column(flex-1) → CalendarMonthGrid(h-full flex-col) → grid box(flex-1 auto-rows-fr)`.
  Anything inserted into the label header row is `shrink-0` (fixed height) and does NOT break the grid's `flex-1` fill.
- `codegraph_explore("CalendarMonthGrid buildMonthGrid monthLabel MONTH_NAMES MonthGridSkeleton DayCell EventChip MonthEmptyNote Notice")` —
  `buildMonthGrid` (logic.ts:370) returns `monthLabel: ` + "`${MONTH_NAMES[month]} ${year}`" (English, e.g. `June 2026`,
  logic.ts:430), derived from `monthFromWindow(timeMin, now)`. `MonthGridSkeleton` (GoogleCalendarPanel.tsx:52) is the
  in-flight affordance the panel already renders when `activeTab.loadingDefault` is true; `MonthEmptyNote`
  (components.tsx:182) is the empty-month note ("Nothing scheduled this month."); `Notice` (the catalog's recoverable
  error block) wraps shadcn `Alert variant="destructive"`.
- Read `src/renderer/components/ui/button.tsx` — the `Button` primitive already ships `variant="ghost"` and the icon
  sizes `icon-xs` (size-6), `icon-sm` (size-8), plus text sizes `xs` (h-6)/`sm` (h-8). No new variant/size needed for
  this cluster.
- Read `src/renderer/PanelRefreshButton.tsx` — the existing trailing chrome control: `Button variant="ghost"
  size="icon-sm"` + lucide `RotateCw`/`Loader2` + `Tooltip`, with `aria-label="Refresh"`, `disabled` when no
  refreshable surface, `aria-busy` (not `disabled`) while spinning, `rounded-none border-l border-border` so it reads
  as one segmented chrome unit with the `+`. This is the exact precedent the nav cluster's icon buttons follow.
- Read `src/renderer/components/ui/tooltip.tsx` — Radix-backed `Tooltip`/`TooltipTrigger`/`TooltipContent`, already
  used by `PanelRefreshButton`; reusable verbatim for the nav icon-button hints.
- Grep `년|월|오늘` across `src/renderer` — **zero matches**. There is NO Korean text anywhere in the renderer today:
  every existing calendar label is English (`June 2026`, "Calendars", "Nothing scheduled this month.", "Refresh",
  "Connect Google Calendar to see your schedule in cosmos."). This is the load-bearing input to the label decision (§4).

**memory_recall / memory_smart_search**

- `memory_recall("calendar design system shadcn tokens panel month grid")` → one hit:
  `mem_mqfcm4mp_078cc56fad61` (`.sdd/designs/google-calendar-v1.md`). Takeaways: the calendar default view is a MONTH
  grid of narrow deterministic main-composed read-only surfaces; the panel reuses the standard shell
  (PanelTabStrip + PanelRefreshButton + content A2UIProvider + PromptComposer + PanelFooter); event colors go through
  the `--event-*` token family (never raw hex); today = `--primary` filled circle; "No new shadcn primitive needed"
  was the v1 stance and holds here too.
- (No stored decision about month/year navigation or a Korean label exists; the codegraph + Grep grounding above is
  authoritative.)

---

## 0. Decisions at a glance (for the developer)

| # | Decision |
|---|----------|
| D1 | The nav cluster **replaces** the existing in-grid `<h2>{grid.monthLabel}</h2>` header row inside `CalendarMonthGrid`. It lives in that same `flex items-center justify-between` slot (header above the grid box) — NOT in `PanelTabStrip`'s trailing chrome. The grid box's `flex-1 auto-rows-fr` fill is untouched. |
| D2 | **Label = English `MONTH_NAMES[month] year` (e.g. `June 2026`), the existing format, kept as the single canonical label.** The spec's Korean `YYYY년 M월` is NOT adopted (see §4 rationale — the entire app is English; a lone Korean string would break product uniformity). The "오늘" control becomes **"Today"**. This is a designer override of the spec's literal label text; flagged for architect/requester sign-off in §8. |
| D3 | Controls = five `Button` instances reusing existing variants only: four `variant="ghost" size="icon-sm"` icon buttons (prev-year, prev-month, next-month, next-year) flanking the label, plus one `variant="ghost" size="sm"` text button ("Today") at the row's right edge. lucide `ChevronLeft`/`ChevronRight`/`ChevronsLeft`/`ChevronsRight`. NO new token, variant, or primitive. |
| D4 | The cluster renders **only** for the live default view (`composed: false`, connected). Composed snapshots keep the plain `<h2>` label with no controls; not-connected/reconnect routes to the Connect CTA unchanged. |
| D5 | Loading reuses `MonthGridSkeleton` (the whole content region swaps to it while `loadingDefault`), so the cluster is simply absent during an in-flight read — no separate per-button spinner. The "Today" button uses `disabled` when already on the current month. |

No new theme token, no new `components/ui/` primitive, no new shadcn install. Developer wiring summary in §8.

---

## 1. Surface & layout — the nav control cluster

### 1.1 Where it lives

The cluster occupies the **existing label header row inside `CalendarMonthGrid`** — the
`<div className="flex items-center justify-between">` at components.tsx:312 that today holds only the `<h2>`. It is
the first child of `CalendarMonthGrid`'s `flex h-full min-h-0 flex-col gap-2`, sitting ABOVE the bordered grid box.
This is deliberate:

- The header row is already `shrink-0` (natural height, no `flex-1`), so adding controls into it changes its content
  but not the fill chain. The grid box below keeps `flex min-h-0 flex-1 … auto-rows-fr` and continues to fill all
  remaining width and height. **The fill chain is not broken.**
- The label and its navigation belong to the grid that derives from `timeMin` — keeping them co-located with the grid
  (not up in the tab-strip chrome) means the month being shown and the controls that change it read as one unit, and
  the cluster is naturally absent on composed surfaces and the skeleton (which replace the whole grid).
- The legend rail (`<aside>`) is a SIBLING of the grid column, so it is unaffected; the cluster sits inside the grid
  column only, above the grid, exactly spanning the grid's width.

### 1.2 Cluster structure (left-to-right within the header row)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⟪  ⟨   June 2026    ⟩  ⟫                                      [ Today ]  │
│  ◂◂  ◂   (label)     ▸   ▸▸                                               │
└─────────────────────────────────────────────────────────────────────────┘
   prev  prev          next next                                  reset
   year  month         mo.  year
```

The row stays `flex items-center justify-between`:

- **Left group** (`flex items-center gap-1`): `[prev-year] [prev-month] [label] [next-month] [next-year]`.
  - `prev-year` — `Button variant="ghost" size="icon-sm"`, lucide `ChevronsLeft`.
  - `prev-month` — `Button variant="ghost" size="icon-sm"`, lucide `ChevronLeft`.
  - **label** — the month/year text, occupying the existing `<h2>` semantics (see §1.3). Given a comfortable inline
    min-width so single-digit-day month changes don't shift the arrows (`min-w-[7.5rem] text-center`).
  - `next-month` — `Button variant="ghost" size="icon-sm"`, lucide `ChevronRight`.
  - `next-year` — `Button variant="ghost" size="icon-sm"`, lucide `ChevronsRight`.
- **Right group**: `[Today]` — `Button variant="ghost" size="sm"`, the text "Today". `justify-between` pushes it to
  the right edge of the grid width, visually distinct from the stepping cluster (it is a jump-to-now, not a step).

Sizing rationale: `size="icon-sm"` (size-8 / 32px) matches the `PanelRefreshButton` in the tab strip, so the calendar
chrome reads as one product. `variant="ghost"` keeps the controls quiet against the `bg-card` panel — they tint to
`accent` on hover (the established ghost treatment), never competing with the event chips for attention. The icon
chevrons inherit the ghost button's `[&_svg]:size-4`; the double-chevrons (`ChevronsLeft`/`ChevronsRight`) read
unmistakably as "jump a year" vs the single "step a month".

### 1.3 The label

The label keeps the existing `<h2 className="text-sm font-medium text-foreground">` element and styling (so the grid's
`role="grid"` `aria-label` and the visible heading stay in sync — see §4). It is wrapped to a centered fixed-ish width
between the month arrows: `<h2 className="min-w-[7.5rem] text-center text-sm font-medium text-foreground tabular-nums">`.
`tabular-nums` keeps the year digits from jittering. The text content is `grid.monthLabel` (today's English
`June 2026`) — unchanged source, see §4.

### 1.4 Tokens used (no new tokens)

| Token / utility | Where |
|-----------------|-------|
| `--foreground` (`text-foreground`) | the month/year label text |
| `--accent` / `--accent-foreground` (via `variant="ghost"` hover) | icon + Today button hover/active |
| `--muted-foreground` | (inherited only if we choose to mute idle chevrons — see §1.5; default is the button's own color) |
| `--ring` (`focus-visible:ring-ring/50`, from `buttonVariants`) | keyboard focus ring on every control |
| `--border` | unchanged grid/header context |
| `--primary` | unchanged (today's day-cell circle) |

All consumed via existing Tailwind/shadcn tokens — **no raw hex, no new variable.**

### 1.5 Icon color note

The chevrons render in the ghost button's default foreground. To match the deliberately-quiet
`PanelRefreshButton` (whose glyph is `text-muted-foreground`), the four chevron buttons SHOULD render their lucide
icon with `className="text-muted-foreground"` on the icon (the button's hover still lifts the whole control to
`accent`). The "Today" text button stays default foreground for legibility as a text control. This keeps the stepping
arrows as quiet chrome and the label + Today as the readable focal content. (Developer: apply `text-muted-foreground`
to the four chevron `<svg>` icons, matching PanelRefreshButton.tsx:92-95.)

---

## 2. States

The cluster is part of `CalendarMonthGrid`, which only renders when the panel content region is in its surface branch.
The panel-level states (loading / not-connected) gate WHETHER the grid (and thus the cluster) renders at all; the
in-grid states (empty / populated / error) describe the grid the cluster sits above.

### 2.1 Loading (re-fetching a month) — reuse `MonthGridSkeleton`

When a navigation action fires, the panel sets the active tab `loadingDefault: true` (via
`requestDefaultInActiveTab`), exactly as the first default read does. The content region then renders
`MonthGridSkeleton` (GoogleCalendarPanel.tsx:348) INSTEAD OF the `A2UIProvider`/grid — so during an in-flight
navigated read **the whole grid, including the cluster, is replaced by the skeleton.** No new loading widget, no
per-button spinner. (FR-013.)

- Visual: the existing 7×5 `Skeleton` grid with the `h-4 w-28` title-skeleton bar at top — which already stands in for
  the label row, so it reads as "the month header + grid are reloading".
- The cluster does NOT need its own disabled-while-loading treatment because it is unmounted during the skeleton.
  Rapid clicks are handled by the latest-wins gate in logic (plan Decision 3), not by disabling buttons.
- **Refinement (optional, developer's call):** if a future iteration keeps the cluster mounted during a refetch
  (so the arrows don't flicker out), the cluster MUST then set `aria-busy` on its buttons and guard clicks — but the
  v1 design is the simple skeleton-swap above, matching today's behavior.

### 2.2 Empty (month with no events)

Unchanged: `CalendarMonthGrid` computes `isEmpty` and renders `MonthEmptyNote` ("Nothing scheduled this month.")
between the header row and the grid box. The nav cluster renders normally above it — a user navigates freely through
empty months. The cluster's presence makes the empty state feel intentional ("this month is empty, step to another")
rather than broken.

### 2.3 Populated

The default: the cluster sits above a fully-bucketed grid. The label shows the displayed month; all controls enabled
except "Today" when already current (§2.6). The today-circle (`--primary`) only appears when the displayed month
contains today.

### 2.4 Error (fetch failed)

A failed navigated-month read surfaces through the panel's EXISTING recoverable affordances (FR-015), unchanged by
this design:

- The panel's `activeTab.error` block (the `role="alert"` destructive-bordered `<p>` "Could not render this surface:
  …" at GoogleCalendarPanel.tsx:355) renders in the content region, and/or the catalog `Notice` (destructive `Alert`)
  if main pushes one.
- **Cluster behavior on error:** because the error is rendered in the panel content region and the prior grid may be
  cleared, the cluster may not be visible during the error. The REQUIREMENT (FR-015) is that the controls stay usable
  and the displayed-month INTENT is preserved so a retry/refresh re-reads the same month. Design implication: the
  panel must keep the per-tab intent (plan Decision 3) across an error so that, once the user steps again or refreshes,
  it re-issues the correct month. The error block itself is unchanged chrome — no new error UI for the cluster.
- If the design/interface step keeps the grid mounted under a non-fatal `Notice` (preferred when feasible), the
  cluster stays visible above it and the user can immediately step to another month — the cleanest recovery. Either
  way no bespoke error styling is introduced.

### 2.5 Disabled

- **"Today" (reset) button**: `disabled` (native `disabled` attr → `buttonVariants` `disabled:opacity-50
  disabled:pointer-events-none`) when the displayed month already equals the current month (FR-005). This is the
  visible no-op signal — the only routinely-disabled control in the cluster.
- **All four chevron buttons**: ALWAYS ENABLED. There is **no min/max year bound** in the spec — the spec explicitly
  leaves the navigable range unbounded ("Out of scope: … arbitrary date pickers"; the validator's sane band
  `1970 ≤ year ≤ 9999` is a defensive guard, not a UX boundary). So there is NO boundary-disabled state on the
  arrows; a user can step in either direction indefinitely. (The validator's `1970..9999` band is far outside any
  realistic navigation and is not surfaced as a disabled affordance — if a user somehow reached it, an out-of-range
  request simply falls back to the current month per FR-009, which is recovery, not a disabled control.)
- **Not-connected / reconnect_needed**: the cluster does not render at all (the content region shows the Connect CTA);
  navigation is therefore inoperable in that state (FR-016).

### 2.6 Disabled-Today visual

`disabled` ghost text button at 50% opacity (the `buttonVariants` default). It stays in the DOM (does not vanish) so
the row layout is stable and the control's location is predictable — a user who has not navigated still sees a (greyed)
"Today" anchor. No tooltip on the disabled state (matching PanelRefreshButton's "no actionable hint on a disabled
control" rule).

---

## 3. Interaction & accessibility

### 3.1 ARIA labels (the icon buttons)

The four chevron buttons are icon-only and MUST carry `aria-label` (the icons are `aria-hidden`), mirroring
`PanelRefreshButton`'s `aria-label="Refresh"`:

| Control | `aria-label` | Tooltip text (TooltipContent) |
|---------|--------------|-------------------------------|
| prev-year (`ChevronsLeft`) | `Previous year` | `Previous year` |
| prev-month (`ChevronLeft`) | `Previous month` | `Previous month` |
| next-month (`ChevronRight`) | `Next month` | `Next month` |
| next-year (`ChevronsRight`) | `Next year` | `Next year` |
| Today (text) | (text is its own accessible name) | (no tooltip needed; visible text) |

Each chevron button wraps in `Tooltip`/`TooltipTrigger asChild`/`TooltipContent side="bottom"` exactly as
`PanelRefreshButton` does, so the hover hint matches existing chrome. The label `<h2>` is decorative-redundant with the
grid's `aria-label` (see §4) and needs no role change.

### 3.2 Focus & keyboard order

DOM order = visual order = tab order: `prev-year → prev-month → next-month → next-year → Today → (into the grid)`.
This sits before the grid box in DOM (FR-009 / the established "controls precede the display grid" pattern from the
legend rail). Every control is a native `<button>` (via shadcn `Button`), so Enter/Space activate it and the
`focus-visible:ring-ring/50` ring (from `buttonVariants`) is visible against the dark `bg-card` — the standard cosmos
focus treatment, no new focus style.

The disabled "Today" button (when current month) drops out of the tab order via native `disabled` — correct: a no-op
control should not be a tab stop.

### 3.3 Contrast (dark palette)

- Ghost chevron icons at `text-muted-foreground` against `bg-card`: this is the SAME pairing as `PanelRefreshButton`'s
  glyph and the weekday-header labels (`text-muted-foreground`), already shipped — adequate for a non-text glyph icon
  and visually consistent. On hover the whole control lifts to `accent`/`accent-foreground` (clearly higher contrast).
- Label `text-foreground` on `bg-card`: the established high-contrast heading pairing (unchanged from today's `<h2>`).
- "Today" text button `text-foreground` (default) → readable; disabled at 50% opacity is intentionally de-emphasized
  (it is a no-op).
- Focus ring `ring-ring/50` is the app-wide focus token — verified visible on dark via every other shadcn button in
  the app.

### 3.4 No keyboard shortcuts

Per spec ("keyboard-shortcut bindings for navigation … MAY be considered in a later version, not required here"), this
design adds NO global shortcut for month/year stepping. Navigation is pointer/keyboard-on-the-controls only. The
panel's existing tab shortcuts (`useTabShortcuts`) are unaffected.

---

## 4. Label decision (resolving the spec ↔ existing-grid discrepancy)

**The plan flagged: spec FR-001 wants Korean `YYYY년 M월`; the existing in-grid label is English `MONTH_NAMES[month]
year` (`June 2026`).** As the design owner of product visual uniformity, I am resolving this to a **single canonical
label**, and the canonical label is **English `MONTH_NAMES[month] year` — the existing format — kept unchanged**, with
the "오늘" control rendered as **"Today"**.

**Rationale (this is a uniformity call, which is exactly the designer's mandate):**

1. **The entire cosmos app is English.** Grep for `년|월|오늘` across the whole renderer returns ZERO matches. Every
   user-facing string today — the calendar's own "Nothing scheduled this month.", the legend's "Calendars", the
   Connect CTA "Connect Google Calendar to see your schedule in cosmos.", "Refresh", every panel, every tab — is
   English. Introducing a lone Korean `YYYY년 M월` label (and a "오늘" button) into one corner of one panel would make
   that surface read as a DIFFERENT product from the rest of cosmos. That is precisely the incoherence this role
   exists to prevent ("look like one coherent, uniform product no matter which agent or session built a given
   surface").
2. **A single canonical label, in ONE place.** The label is the `monthLabel` field of `buildMonthGrid` (logic.ts:430),
   consumed by both the new cluster header and the grid's `aria-label` (components.tsx:319). Keeping the existing
   English format means the cluster header and the grid `aria-label` automatically agree (no divergence, no second
   format to maintain) — satisfying "consistent across the nav header and grid" with the least surface area. The
   cluster simply renders `grid.monthLabel`; no new label-formatting code, no `i18n` machinery introduced for one
   string.
3. **No localization system exists to anchor a Korean string to.** Adopting `YYYY년 M월` would be the first and only
   localized string in the codebase, with no surrounding i18n framework — an orphan that the next agent building a
   neighboring surface has no precedent to follow, guaranteeing drift. Consistency over novelty.

**Canonical format (single source of truth):** `MONTH_NAMES[month] + ' ' + year` → e.g. `June 2026`, produced by
`buildMonthGrid` and read by BOTH the cluster header `<h2>` and the grid `role="grid" aria-label`. The cluster does
not introduce a second formatter.

**"오늘" → "Today".** The reset control's text is "Today" (English), consistent with the rest of the app and with the
day-cell "today" indicator concept.

**This is a designer override of the spec's literal label text, not of its behavior.** Every behavioral requirement
(FR-001's CONTROLS — prev-year/prev-month/label/next-month/next-year/today; the stepping/jump/reset semantics) is
honored; only the label's LANGUAGE/format is normalized to the app's single language. Because FR-001 names the Korean
string explicitly, I have flagged this for architect/requester sign-off in §8 rather than silently diverging. **If the
requester insists on Korean** despite the uniformity cost, the fallback is in §8 (and it must then be applied app-wide
to stay coherent, which is a larger, separate decision — out of scope here).

---

## 5. Components used (all existing — nothing new to install)

| Component | Variant / size | Source | Role |
|-----------|----------------|--------|------|
| `Button` | `variant="ghost" size="icon-sm"` ×4 | `components/ui/button.tsx` | prev-year, prev-month, next-month, next-year |
| `Button` | `variant="ghost" size="sm"` | `components/ui/button.tsx` | "Today" reset |
| `Tooltip` / `TooltipTrigger` / `TooltipContent` | `side="bottom"` | `components/ui/tooltip.tsx` | hover hints on the 4 chevron buttons |
| lucide `ChevronsLeft` / `ChevronLeft` / `ChevronRight` / `ChevronsRight` | `text-muted-foreground` size-4 | `lucide-react` (already a dep) | the step/jump glyphs |
| `MonthGridSkeleton` | — | `GoogleCalendarPanel.tsx` (existing) | the in-flight loading affordance (reused) |
| `MonthEmptyNote` | — | `googleCalendarCatalog/components.tsx` (existing) | empty-month note (reused) |
| `Notice` / `activeTab.error` block | destructive `Alert` / `role="alert"` | existing | recoverable error (reused) |

**No new `components/ui/` primitive. No new shadcn add. No new theme token.** Every lucide chevron used is already in
the `lucide-react` package the project depends on (no install — but see §8 note: developer should confirm the import,
since adding a never-before-imported lucide icon is a code import, not a package install).

---

## 6. Component location (for the developer / interface step)

Per the plan's open visual question (cluster location): **render the cluster inside `CalendarMonthGrid`**, replacing
the existing `<div className="flex items-center justify-between"><h2>…</h2></div>` header row (components.tsx:312-314)
with the cluster row described in §1.2. The cluster is a small presentational sub-component — recommended:
`CalendarMonthNav` co-located in `googleCalendarCatalog/components.tsx` (it is a calendar-catalog display concern, like
`CalendarLegend`), receiving:

- `monthLabel: string` (from `grid.monthLabel`),
- `canGoToday: boolean` (false ⇒ disable the Today button; the panel/grid computes this via
  `isCurrentMonth(intent, now)` from `calendarNavLogic.ts`),
- `onPrevMonth` / `onNextMonth` / `onPrevYear` / `onNextYear` / `onToday` handlers,
- `show: boolean` — whether to render the cluster at all (false ⇒ render only the plain `<h2>`; the panel passes
  `show = composed === false && connected`, per D4 / FR-017).

The handlers and the per-tab intent live in `GoogleCalendarPanel` (plan Decision 3); `CalendarMonthGrid` threads
`show` + handlers + `canGoToday` down from the panel via `EventList` props (new optional props on `EventListNode`,
which the surface builder does NOT set — they are panel-injected, not surface-injected). **Interface-step concern:**
how the panel passes these handlers into the catalog `EventList` (props vs. context) is an implementation detail the
plan/developer settles; the design requirement is only that the cluster appears in the grid header for the live default
view and nowhere else.

If threading handlers through the A2UI catalog proves awkward (the catalog component is surface-driven, not
panel-prop-driven), the acceptable alternative is a **panel-level cluster rendered directly in `GoogleCalendarPanel`'s
content region, just above the `A2UIProvider`** (so it sits above the grid in the same column). In that case the
in-grid `<h2>` is hidden for the live default view to avoid a duplicate label, and the panel-level cluster owns the
canonical `monthLabel` (derived from the active tab's intent via the same `MONTH_NAMES[month] year` format). Either
seam satisfies the design; the in-`CalendarMonthGrid` placement is preferred for keeping label+controls+grid as one
visual unit.

---

## 7. What this design explicitly does NOT change

- The grid fill chain (`auto-rows-fr`, `flex-1`, full width/height) — untouched (§1.1).
- The legend left-sidebar rail — untouched (sibling of the grid column).
- Event chip / day-cell / today-circle rendering — untouched.
- The loading skeleton, empty note, and error/Notice affordances — reused as-is.
- The panel shell (tab strip, `PanelRefreshButton`, composer, footer) — untouched. The `PanelRefreshButton` stays in
  the trailing chrome; the plan's "refresh re-reads the displayed month" wiring is a LOGIC change in the panel
  (re-issue `requestDefaultView(intent)`), not a new visual control — this design adds no second refresh affordance.

---

## 8. Open questions / hand-offs for the developer & architect

1. **Label language override (needs requester/architect sign-off).** FR-001's spec text literally names Korean
   `YYYY년 M월` + "오늘". This design overrides that to the app's existing English `June 2026` + "Today" for product
   uniformity (§4 — the entire app is English; a lone Korean surface breaks coherence). **Action:** architect/requester
   to confirm. **Fallback if Korean is truly required:** add a single `monthLabelKo(year, month0)` formatter in
   `googleCalendarCatalog/logic.ts` returning `` `${year}년 ${month0 + 1}월` `` and use it for BOTH the cluster header
   AND the grid `aria-label` (so they still agree — one formatter, one canonical format), and rename "Today" → "오늘".
   Note this would be the codebase's first localized string; to stay coherent it should then be applied app-wide
   (separate, larger decision — out of scope for this feature). The DESIGN (cluster layout, controls, states, a11y)
   is identical either way; only the formatter + button text differ.

2. **lucide icon import (developer, not an install).** The four chevrons (`ChevronsLeft`, `ChevronLeft`,
   `ChevronRight`, `ChevronsRight`) come from `lucide-react`, already a dependency — confirm they import cleanly
   (lucide ships these names). No `npm install`, no shadcn CLI run, no `components.json` change.

3. **Cluster threading seam (developer/interface).** Whether the cluster is hosted inside the catalog
   `CalendarMonthGrid`/`EventList` (preferred) or as a panel-level row in `GoogleCalendarPanel` (acceptable fallback)
   is an interface-step decision (§6); both produce the identical visual result. The designer requirement is: cluster
   visible only on the live default view, in the grid header position, above the grid box, not breaking the fill chain.

**No new theme token, no new `components/ui/` primitive, no shadcn install, no `components.json` change is required by
this design.** Everything is expressed in the existing `Button`/`Tooltip` primitives and existing tokens.
