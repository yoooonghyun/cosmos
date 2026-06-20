# Design: Calendar Week view + Day view — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/calendar-week-day-views-v1.md
**Plan**: .sdd/plans/calendar-week-day-views-v1.md
**Owner**: designer (Step 2.5 — UI-bearing, Phase 0 of the plan)
**Issue**: #89

---

## Grounding (tools I ran myself)

**codegraph_explore / codegraph_search**

- `codegraph_explore("GoogleCalendarPanel EventList CalendarMonthGrid DayCell EventChip calendarNav openDetail
  googleCalendarSurfaceBuilder eventColorClassesByCalendar CalendarDetailContext legend hiddenCalendarIds")` —
  confirmed the live render chain. `EventList` (components.tsx:564) is the surface ROOT: it lays out a flex row of
  `CalendarLegend` (left `<aside>` rail, self-suppressing at ≤1 calendar, `w-44 border-r`) + a `flex-1 min-h-0 min-w-0`
  column wrapping `CalendarMonthGrid`. It owns the renderer-only ephemeral `hidden` set (seeded from the legend's Google
  `selected` prefs via `seedHiddenCalendarIds`, re-seeded on a new `seedKey`) and the `openDetail` dispatch of
  `CALENDAR_OPEN_DETAIL_ACTION`. The nav cluster + selected-marker arrive via `useCalendarNav()` /
  `useCalendarDetailSelectedId()` context — never surface props.
- Same call surfaced `EventChip` (components.tsx:90): the interactive event chip is a native `<button>` with
  `aria-label="Open {title}"`, `aria-pressed={selected}`, `onClick={() => onOpenDetail(event)}`,
  `hover:brightness-110 active:brightness-95`, `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`,
  and `selected && 'ring-1 ring-ring/50 ring-inset'`. Color comes from `eventColorClassesByCalendar(event, calendars)`
  (shared view) or `eventColorClasses(event.colorId)` (single-primary), both returning `{ dot, bar }` token classes.
  This is the exact button contract the Week/Day `EventBlock` reuses.
- Read `src/renderer/GoogleCalendarPanel.tsx` (lines 204–623) — the panel owns: per-tab ephemeral `monthIntents`
  (`Map<tabId,{year,month}>`, NOT persisted, cleared on disconnect, survives the `A2UIProvider key={tab.id}` remount);
  `navValue` built ONLY when `isLiveDefaultView` (`isConnected && activeTab.surface != null && composed === false`); the
  transient `genUiEvent` dock state, reset on `[activeTabId, isConnected]`; `handleSurfaceAction` intercepting the
  open-detail action (returns true, never forwarded); and the right-docked `EventDetail` overlay (absolute,
  `inset-y-0 right-0 w-full max-w-[22rem] border-l bg-card shadow-lg`, over a `bg-black/40` scrim). `MonthGridSkeleton`
  (GoogleCalendarPanel.tsx:75) is the in-flight affordance the panel renders when `activeTab.loadingDefault`.
- Read `src/renderer/googleCalendarCatalog/logic.ts` — `isAllDay`, `eventTimeLabel`, `eventTitle`, `eventDayKey`,
  `buildMonthGrid` (Sunday week-start default), the `COLOR_CLASSES` table (token `{ dot, bar }` per hue, references ONLY
  `--event-*` tokens, no raw hex), and `seedHiddenCalendarIds`. The week/day layout helper (`scheduleLayout.ts`) is the
  time-axis sibling to `buildMonthGrid` and reuses these same color/all-day/title helpers verbatim.
- Read `src/renderer/components/ui/button.tsx` — `Button` ships `variant="ghost"`/`"secondary"`/`"outline"` and sizes
  `xs` (h-6), `sm` (h-8), `icon-xs` (size-6), `icon-sm` (size-8). Glob of `src/renderer/components/ui/*.tsx` — there is
  **no** `ToggleGroup`/`toggle.tsx` primitive in the set today (card, tabs, input, avatar, badge, alert, skeleton,
  tooltip, textarea, select, button, dialog, label, scroll-area only). This drives the view-switcher decision (§2).
- Read `src/renderer/index.css` — the `--event-*` token family (12 hues, dark-tuned, each with `-foreground`), plus
  `--primary` (#4a9eff today marker), `--border` (#333), `--muted`/`--muted-foreground`, `--accent`, `--card`,
  `--card-foreground`. No new color token is needed for this feature (see §3).

**memory_recall / memory_smart_search**

- `memory_recall("cosmos calendar month grid event detail dock per-calendar color legend hidden calendars design tokens
  event color")` → **0 results** (agentmemory empty for this area). The architecture facts are taken from the shipped
  designs `.sdd/designs/google-calendar-v1.md`, `shared-calendars-v1.md`, `calendar-month-year-nav-v1.md`,
  `calendar-event-detail-v1.md`, and `docs/ARCHITECTURE.md` §4i.

**Takeaway**: Week/Day is a **layout + (one) view-switcher** change on top of an already-complete data/color/detail
stack. The surface root already carries flat `events[]` (tagged `calendarId`), the `calendars[]` legend, and
`timeMin`/`timeMax`. The event block reuses `EventChip`'s exact interactive-button contract and the SAME
`eventColorClassesByCalendar` colors. The detail dock, legend rail, hidden-set, skeleton idiom, and nav-header slot are
all reused unchanged. The ONE genuinely new visual primitive is the time-grid itself (hour axis + day columns + placed
blocks); the ONE design-system question is how to render the Month/Week/Day switcher — resolved below WITHOUT adding a
new shadcn primitive.

---

## 0. Decisions at a glance (for the developer)

| # | Decision |
|---|----------|
| D1 | **No new shadcn primitive.** The Month/Week/Day switcher is a **segmented control built from the existing `Button`** — three `variant="ghost" size="sm"` buttons in a `rounded-md border border-border` group; the active segment gets a seated `bg-accent text-foreground` wash, inactive segments are `text-muted-foreground`. ARIA: a `role="group" aria-label="Calendar view"` wrapper with each button carrying `aria-pressed`. This matches the existing `CalendarToggle`/legend idiom (ghost button + seated `bg-accent` for the active item) and the `Today` button's `variant="ghost" size="sm"`. |
| D2 | The switcher lives in the SAME `flex items-center justify-between` header slot that `CalendarMonthNav` occupies today — it is the LEADING cluster (left), the nav chevrons + label become the CENTER, and `Today` stays at the RIGHT. Visible ONLY for the live default view (the catalog already gates this header on `useCalendarNav()` being non-null). Composed snapshots + not-connected keep the plain `<h2>` label with no switcher. |
| D3 | **No new color token.** Week/Day event blocks reuse the per-calendar `{ dot, bar }` token classes (`eventColorClassesByCalendar`) — a timed block is the all-day `bar` treatment scaled up to a full block (token at low alpha + a 2px left accent in the solid token). Today marker reuses `--primary`. Gridlines/axis reuse `--border` and `--muted-foreground`. The hidden-set, legend rail, and per-calendar color behave byte-for-byte as in Month. |
| D4 | The time grid is a NEW catalog component family (`WeekView`/`DayView` sharing `TimeAxis`, `DayColumn`, `AllDayRow`, `EventBlock`) rendered by `EventList` when its `view` is `'week'`/`'day'`. All placement/size/overlap math lives in the pure node-tested `scheduleLayout.ts` — the components are thin shells over it, exactly as `CalendarMonthGrid` is a shell over `buildMonthGrid`. |
| D5 | The event block is the SAME interactive `<button>` contract as `EventChip` (open-detail action, `aria-pressed` selected ring, hover brightness, inset focus ring). The detail dock (#85) is reused UNCHANGED. |
| D6 | The schedule body **vertically scrolls** inside the grid pane (a full 24h axis is taller than the panel). The day-column header row + the all-day row are **sticky** at the top of that scroll; the hour axis gutter is **sticky** at the left. Default scroll lands near the working day (≈ 7am) so the user does not open onto an empty pre-dawn axis. |
| D7 | Loading = a schedule-shaped skeleton (axis gutter + N day-column placeholders + a couple of ghost blocks), the Week/Day sibling of `MonthGridSkeleton`. Empty range = a calm axis with the all-day row and hour lines drawn but no blocks (NOT the `MonthEmptyNote` text banner — the empty axis itself reads "nothing scheduled"). Error/not-connected = identical to Month (the catalog `Notice` / the panel's native Connect CTA). |

---

## 1. Surfaces & layout

One surface is affected: the **Google Calendar panel content region** (the live default view inside
`A2UIProvider key={tab.id}` → `EventList`). The panel shell (PanelTabStrip, PanelRefreshButton, PromptComposer,
PanelFooter, the right-docked `EventDetail` overlay) is untouched.

### 1.1 The header row (shared by all three views)

`CalendarMonthGrid`'s header today is `flex items-center justify-between` with the nav cluster on the left and `Today`
on the right. For Week/Day the SAME header slot is generalized to three zones:

```
┌ header (shrink-0, flex items-center justify-between, h ≈ 32px) ─────────────────────────────┐
│ [ Month  Week  Day ]        ‹‹  ‹   June 16 – 22, 2026   ›  ››          [ Today ]            │
│  └ view switcher (D1) ┘     └──── range nav + label (generalized CalendarMonthNav) ────┘     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **View switcher** (leading): the segmented `Button` group (§2). Present only on the live default view.
- **Range nav + label** (center): the existing `CalendarMonthNav` cluster, generalized per granularity:
  - **Month** (unchanged): `‹‹ ‹  June 2026  › ››` — jump-year / step-month, label `June 2026`.
  - **Week**: a single `‹` / `›` pair (step one week) flanking a range label `June 16 – 22, 2026`. The double
    chevrons (`ChevronsLeft`/`ChevronsRight`) are HIDDEN in Week/Day (no year-jump in a 7-day/1-day context) — only the
    single `ChevronLeft`/`ChevronRight` show.
  - **Day**: the same single `‹` / `›` pair (step one day), label `Monday, June 16, 2026`.
- **Today** (trailing, unchanged): `variant="ghost" size="sm"`, `disabled` when already on the current week/day
  (Week/Day reuse the exact `canGoToday` → `disabled` no-op pattern; FR-009/FR-010).

The header stays `shrink-0`; the grid box below keeps its `flex-1 min-h-0` fill so the time grid stretches to the
footer exactly as the month grid does.

### 1.2 Week view body

Below the header, a bordered grid box (`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border`,
matching the month grid box) containing, top to bottom:

```
┌ grid box (rounded-lg border) ────────────────────────────────────────────────────────┐
│ ┌ sticky top: column header row ──────────────────────────────────────────────────┐  │
│ │ (gutter) │ Sun 15 │ Mon 16 │ Tue 17 │ Wed 18●│ Thu 19 │ Fri 20 │ Sat 21          │  │  ● = today col
│ ├ sticky: all-day row ─────────────────────────────────────────────────────────────┤  │
│ │ all-day  │ [Holiday bar]   │        │ [PTO ───────────── spanning bar ──────────] │  │
│ ├ scroll body (vertical) ──────────────────────────────────────────────────────────┤  │
│ │  7 AM ─┼────────┼────────┼────────┼────────┼────────┼────────┼────────            │  │
│ │        │        │[Standup│        │        │        │        │                    │  │
│ │  8 AM ─┼────────┼─block ]┼────────┼────────┼────────┼────────┼────────            │  │
│ │        │        │        │ [1:1 ] │        │        │        │                    │  │
│ │  9 AM ─┼────────┼────────┼────────┼────────┼────────┼────────┼────────            │  │
│ │   ⋮    (axis continues 0–23h; default scroll near 7 AM)                           │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Time-axis gutter** (left, sticky-left): a fixed-width column (`w-12`, ≈ 48px) of right-aligned hour labels
  (`7 AM`, `8 AM` …) in `text-[10px] tabular-nums text-muted-foreground`, each label sitting at the TOP edge of its
  hour row. Hour gridlines are `border-t border-border/60` spanning the day columns.
- **7 day columns**: equal width (`flex-1` each, or `grid-cols-7` with the gutter as a fixed leading track), separated
  by `border-l border-border`. Each column header is `Sun 15` style — weekday abbrev (`text-[11px]
  text-muted-foreground`) over the date number; **today's column header** gets the `--primary` filled chip on the date
  number (reusing the month grid's today treatment) and the column body gets a faint `bg-primary/5` wash so today reads
  at a glance.
- **All-day row** (sticky, below the column headers): a single row band (`bg-muted/30 border-b border-border`) holding
  all-day / full-span events as horizontal `bar`-treated chips per day column. A multi-day all-day event renders as ONE
  spanning bar across the covered columns (the minimal approach the spec allows). The row auto-grows to a small cap
  (≈ 2 stacked rows) then shows a `+N` overflow chip, mirroring the month cell's `+N more`.
- **Timed grid** (scroll body): each day column is a positioning context (`relative`); each timed event is an absolute
  `EventBlock` placed by `{ topPct, heightPct }` from `scheduleLayout.ts`, lane-split by `{ laneIndex, laneCount }`
  (§4 overlap). The current-time indicator is OUT of scope for v1 (not in the spec) — omit it.

### 1.3 Day view body

Identical to Week with **one** day column (`flex-1`, full width) plus the gutter. The column header shows the full
weekday + date (`Monday, June 16` — or just the date number echoing the range label, designer's choice; recommend the
short `Mon 16` chip for consistency with Week, since the full label already sits in the header). All-day row, hour axis,
sticky behavior, and `EventBlock` placement are the SAME as Week. Today's column gets the same `bg-primary/5` wash and
primary date chip when the day IS today.

### 1.4 Where it lives

Entirely inside the existing `EventList` root. `EventList` reads its `view` (additive surface prop, set by the surface
builder) and branches: `'month'` → `CalendarMonthGrid` (today's path, unchanged) · `'week'` → `WeekView` · `'day'` →
`DayView`. The legend rail (`CalendarLegend`), the `hidden` set, the `openDetail` dispatch, and the `useCalendarNav()` /
`useCalendarDetailSelectedId()` context all sit at the `EventList` level and feed BOTH layouts identically — so legend,
hidden-set, color, detail-open, and selected-marker behavior are shared verbatim.

---

## 2. Components used

### 2.1 The view switcher — `CalendarViewSwitcher` (new catalog-local component, NO new shadcn primitive)

A segmented control of three `Button`s. Rationale for not adding a `ToggleGroup` shadcn primitive: the set currently has
none, the need is a single 3-option exclusive toggle, and the codebase's established idiom for "active item in a set of
ghost buttons" is the legend's `CalendarToggle` (ghost + seated `bg-accent`). Adding a Radix ToggleGroup for one
control would be heavier than the system needs; if a SECOND segmented control ever appears, promote this to a real
`components/ui/toggle-group.tsx` and record it as the new standard.

```
role="group" aria-label="Calendar view"  ·  inline-flex rounded-md border border-border overflow-hidden
  ├ Button variant="ghost" size="sm"  rounded-none  aria-pressed={view==='month'}  → "Month"
  ├ Button variant="ghost" size="sm"  rounded-none border-l border-border  aria-pressed={view==='week'} → "Week"
  └ Button variant="ghost" size="sm"  rounded-none border-l border-border  aria-pressed={view==='day'}  → "Day"
```

- **Active segment**: `bg-accent text-foreground` (seated), matching `CalendarToggle`'s `!hidden && 'bg-accent/40'`
  shown-item wash — use full `bg-accent` here for a crisper selected read.
- **Inactive segment**: default ghost (`text-muted-foreground`, `hover:bg-accent/50 hover:text-accent-foreground`).
- **Sizing**: `size="sm"` (h-8) so the switcher height matches the `Today` button and the nav icon buttons in the same
  header row.
- **Keyboard/ARIA**: each segment is a real `<button>` (tab-stop, Enter/Space free). `aria-pressed` marks the active
  view. The group wrapper names the control. Arrow-key roving is NOT required (three plain buttons is acceptable and
  matches the legend rail's plain-button set); if desired later, that is the trigger to promote to a Radix ToggleGroup.

### 2.2 Reused, unchanged

| Component | Reuse |
|-----------|-------|
| `Button` (`@/components/ui/button`) | View switcher segments (ghost/sm), the generalized nav chevrons (`NavIconButton` → ghost/icon-sm), `Today` (ghost/sm). All existing variants/sizes. |
| `Tooltip` | Nav chevron hints (`Previous week`/`Next week`/`Previous day`/`Next day`), as `CalendarMonthNav` already does. |
| `Skeleton` (`@/components/ui/skeleton`) | The schedule loading skeleton (§5). |
| `Alert` via the catalog `Notice` | Recoverable read error — unchanged from Month. |
| `EventDetail` dock + `bg-black/40` scrim (panel chrome) | Reused UNCHANGED (#85). Week/Day `EventBlock` dispatches the SAME `CALENDAR_OPEN_DETAIL_ACTION`. |
| `CalendarLegend` rail + hidden-set | Reused UNCHANGED — sits beside the time grid exactly as beside the month grid. |
| `ScrollArea` | NOT required for the time grid (a plain `overflow-y-auto` with sticky header/axis is simpler and gives native sticky behavior); keep `ScrollArea` to the detail dock body where it is already used. |

### 2.3 New catalog components (thin shells over `scheduleLayout.ts`)

`CalendarViewSwitcher`, `WeekView`, `DayView`, `TimeAxis` (gutter + hour gridlines), `DayColumn` (header + timed
positioning context), `AllDayRow`, `EventBlock` (the interactive button). These are catalog-local React components in
`googleCalendarCatalog/components.tsx` (or a split `scheduleComponents.tsx` if the file grows too large — developer's
call per the plan), NOT additions to `components/ui/`. They may use any Tailwind class incl. the `--event-*` tokens, as
the existing calendar catalog components do.

---

## 3. Tokens used

**No token is added or changed.** Every surface need maps to an existing token:

| Need | Token / class |
|------|---------------|
| Event block fill + accent | `eventColorClassesByCalendar(event, calendars).bar` → `bg-event-{hue}/25 border-l-2 border-event-{hue}` (the all-day `bar` treatment, applied to the full timed block). Single-primary path: `eventColorClasses(event.colorId).bar`. |
| Event block / chip text | `text-card-foreground` (block title), `text-muted-foreground` (block time prefix) — same as `EventChip`. |
| Today column wash + date chip | `bg-primary/5` (column body wash), `bg-primary text-primary-foreground` filled circle on the date number (same as `DayCell` today). |
| Hour gridlines | `border-t border-border/60`. Day-column dividers `border-l border-border`. Grid box `border border-border rounded-lg`. |
| Hour-axis labels + weekday header | `text-muted-foreground` (`text-[10px]` axis, `text-[11px]` weekday). |
| All-day row band | `bg-muted/30 border-b border-border` (echoes the month grid's `bg-muted/40` weekday header + spillover `bg-muted/30`). |
| Selected event ring | `ring-1 ring-ring/50 ring-inset` + `aria-pressed` — verbatim from `EventChip`. |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` — verbatim from `EventChip`. |
| Hover affordance | `hover:brightness-110 active:brightness-95 transition` — verbatim from `EventChip`. |
| Switcher active segment | `bg-accent text-foreground`; inactive `text-muted-foreground hover:bg-accent/50`. |
| Skeleton | `Skeleton` (uses `bg-accent` animate-pulse internally). |

If implementation finds a timed block at `/25` alpha too faint to read its title at small heights, the fallback is to
bump to `/30`–`/35` for timed blocks ONLY (a magnitude tweak within the SAME token, not a new token) and record it as
the timed-block standard. Do NOT introduce a raw color.

---

## 4. Overlap layout (visual contract for `scheduleLayout.ts`)

The pure helper assigns each timed event in a day column a `{ topPct, heightPct, laneIndex, laneCount }`. The visual
rule the design fixes:

- **Concurrent group = equal-width lanes.** For a maximal set of mutually-overlapping events, split the column width
  equally: each block's `width = 100% / laneCount`, `left = laneIndex * (100% / laneCount)`. A non-overlapping event is
  its own group (`laneCount = 1`, full width).
- **Minimum legible height**: a very short / zero-duration event gets a floor (`min-h-[14px]` ≈ enough for the time +
  truncated title); blocks never collapse to an invisible sliver and never overflow the column.
- **Inner gap**: a 1px hairline gutter between adjacent lanes (`pr-px` / a `gap` on the lane wrapper) so neighboring
  blocks read as separate, not fused.
- **Cross-midnight / multi-day** timed events are clamped to each day column's visible bounds (top/bottom edges) — the
  block touches the grid edge to signal "continues" rather than being lost. Pure helper owns the clamp.
- **Dense day** (many overlaps): lanes may get visually thin but MUST stay within the column and never throw — the
  equal-split rule is deterministic and bounded (acceptable for v1 per the spec).

Block content at narrow lane widths: show the start time (`text-[10px] tabular-nums`) + a `truncate` title; at very
thin widths the title truncates to nothing and the block is still a valid tab-stop with its `aria-label="Open {title}"`
carrying the full name.

---

## 5. States (every view)

| State | Treatment |
|-------|-----------|
| **Loading** (`activeTab.loadingDefault`, a switch or range-nav read in flight) | A schedule-shaped skeleton — the Week/Day sibling of `MonthGridSkeleton`. The header (switcher + nav) renders normally; the grid box shows: a fixed gutter of `Skeleton` hour-label stubs, N column headers (`Skeleton` weekday + date), an all-day row band, and a handful of ghost `Skeleton` blocks at varied offsets/heights in a couple of columns. `aria-busy="true"` on the wrapper. Same `bg-accent` pulse as the month skeleton. |
| **Empty range** (connected, zero events) | The axis renders fully — gutter + hour gridlines + day-column headers + an EMPTY all-day row — with NO timed blocks. This calm empty axis IS the empty state (it reads "nothing scheduled"); do NOT stack the `MonthEmptyNote` text banner on top of it (that banner stays month-only). No error styling. |
| **Populated** | All-day events in the top row; timed events placed/sized/lane-split in the scroll body, colored per owning calendar, hidden calendars filtered out by the shared `hidden` set. |
| **Error** (recoverable rate_limited/network) | The catalog `Notice` (shadcn `Alert variant="destructive"` + `TriangleAlert`) as the re-pushed surface root — IDENTICAL to Month. The view switcher is not shown (the surface is a `Notice`, not an `EventList`). |
| **Not connected / reconnect_needed** | The panel's native Connect/Reconnect CTA (`CalendarDays` + copy + `GoogleConnectForm`). The view switcher is absent (it only renders inside the live-default-view `EventList`). Unchanged from Month. |
| **Disabled** | `Today` is `disabled` (ghost, `opacity-50` via the button's `disabled:opacity-50`) when already on the current week/day. The currently-active view segment reads `aria-pressed` (seated `bg-accent`); it is not `disabled` (clicking the active view is a harmless no-op the panel can short-circuit). Nav chevrons are always enabled (no range bound), as in Month. |

The send-spinner (`SurfaceSpinner`, a user compose in flight) and the per-tab error alert render exactly as today — they
are panel-level and view-agnostic.

---

## 6. Interaction & accessibility

- **Tab order** (live default view): legend rail toggles (if present) → view switcher (Month, Week, Day) → nav chevrons
  → `Today` → all-day chips (left-to-right by column) → timed `EventBlock`s (DOM order = column-then-top; recommend
  emitting blocks per column in start-time order so tabbing reads chronologically within a day). This continues the
  existing pattern where the legend precedes the grid in DOM/tab order.
- **View switcher keyboard**: each segment is a `<button>` — Tab to reach, Enter/Space to activate. `aria-pressed`
  announces the active view. The group `aria-label="Calendar view"`.
- **EventBlock keyboard**: identical to `EventChip` — Tab-stop, Enter/Space opens the detail dock,
  `aria-label="Open {title}"`, `aria-pressed` for the selected marker. Opening the dock moves focus into the dock
  header (the existing dock behavior); closing returns to the panel — unchanged.
- **Grid semantics**: the time grid is a positioned visual layout, NOT a data table. Use `role="grid"` on the grid box
  with day columns as `role="columnheader"` for the header cells (mirroring the month grid's `role="grid"`/`role="row"`/
  `role="columnheader"`), but do NOT force a full row/cell grid model onto the absolutely-positioned timed area — the
  per-event `EventBlock` buttons carry their own accessible names, which is what a screen-reader user needs. Each day
  COLUMN should carry an `aria-label` summarizing its day + event count (the Week/Day analog of `dayCellAriaLabel`),
  composed in `scheduleLayout.ts`, so a screen-reader user hears "Monday June 16, today, 3 events: Standup 9:30 AM, …"
  without traversing every positioned block.
- **Contrast** (dark `#1b1b1c` card): the `--event-*` dark tokens at `/25` carry a solid 2px left accent in the full
  token and `text-card-foreground` (#e0e0e0) titles — meeting AA on the tinted block. The `--primary` (#4a9eff) today
  chip on `--primary-foreground` (#0b1622) is high-contrast. Axis/header labels use `--muted-foreground` (#888) which
  is borderline for tiny text — keep hour/weekday labels at the existing `text-[10px]`/`text-[11px]` weights the month
  grid already uses (consistent, accepted in the shipped design); the load-bearing meaning (event titles, today, the
  range label) is all at `--foreground`/`--card-foreground` contrast.
- **Reduced motion**: the only motion is the dock slide (already `motion-reduce:transition-none`) and the skeleton
  pulse — no new motion is introduced.
- **Sticky scroll**: the column-header row + all-day row are sticky-top and the axis gutter sticky-left so navigating a
  long day keeps the day/time references on screen.

---

## 7. Hand-off notes for the developer

- Build `scheduleLayout.ts` as a pure node-tested helper FIRST (the plan's Phase 2): it owns `{ topPct, heightPct }`
  placement (derive from the day's ACTUAL local start/end boundaries for DST 23h/25h days, not a hardcoded 1440 min),
  the equal-width lane packing `{ laneIndex, laneCount }`, the cross-midnight/multi-day clamp, and the per-column
  aria-label composer. The components are thin shells over it, exactly as `CalendarMonthGrid` is over `buildMonthGrid`.
- Reuse `eventColorClassesByCalendar` / `eventColorClasses`, `isAllDay`, `eventTitle`, `eventTimeLabel`,
  `seedHiddenCalendarIds` verbatim — do NOT re-implement color/all-day/title/hidden logic in the schedule layer.
- `EventBlock` MUST be the same interactive-button contract as `EventChip` (open-detail dispatch, `aria-pressed`
  selected ring, hover brightness, inset focus ring). The dock (#85) is reused — do not touch `EventDetail`,
  `handleSurfaceAction`, or the panel-root overlay.
- Week-start = **Sunday**, matching `buildMonthGrid`'s default (confirmed; spec OQ resolved).
- The header generalization is additive: keep the Month nav (double + single chevrons, `June 2026` label) intact; Week/
  Day hide the double chevrons and swap in the range/day label + single-step chevrons. The switcher slot is new but
  lives in the same `flex items-center justify-between` header — no change to the grid-box `flex-1` fill chain.
- The view + week/day anchor join the existing per-tab ephemeral `monthIntents` pattern (renderer-only, not persisted,
  cleared on disconnect, survives remount). Default = Month / current month for a fresh `+` tab or app reload.

---

## 8. Open questions

None blocking. Resolved design decisions recorded above: (1) the switcher is a `Button`-based segmented control, NOT a
new shadcn `ToggleGroup` primitive (promote only if a second segmented control appears); (2) no new color token — timed
blocks reuse the per-calendar `bar` treatment, with a `/25`→`/30–35` alpha bump as the only sanctioned tweak if titles
read too faint; (3) empty range = the calm empty axis itself, no `MonthEmptyNote` banner; (4) the current-time
indicator line is out of scope for v1; (5) multi-day all-day events render as a single spanning bar across covered
columns.
