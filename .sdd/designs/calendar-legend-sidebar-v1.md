# Design: Calendar Legend — Left Sidebar Reposition — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: .sdd/specs/calendar-legend-sidebar-v1.md
**Plan**: .sdd/plans/calendar-legend-sidebar-v1.md
**Extends design**: .sdd/designs/shared-calendars-v1.md (legend behavior, `--event-*` palette,
`role="switch"` toggle — unchanged here; this design changes only WHERE the legend sits and
its orientation strip→column)

---

## Grounding

> Grounding performed directly this session with codegraph + agentmemory; the request's
> notes were verified against the on-disk source, not trusted blindly.

**codegraph_explore** (queries run → one-line takeaways):
- `EventList CalendarLegend CalendarToggle CalendarMonthGrid MonthEmptyNote googleCalendarCatalog components colorTokenFor tokenColorClasses` → CONFIRMED the legend is composed in the catalog ROOT `EventList` (`src/renderer/googleCalendarCatalog/components.tsx:341`), inside one outer `flex flex-col gap-2` (legend stacked over grid). `CalendarLegend` (231) is a `flex flex-wrap items-center gap-1.5` group of `CalendarToggle` PILL buttons (`role="switch"`, `aria-checked`, decorative `aria-hidden` swatch via `tokenColorClasses().dot`). `≤1` suppression returns `null` (242). `CalendarMonthGrid` (267) is `overflow-hidden rounded-lg border border-border` wrapping the 7-col grid, with `MonthEmptyNote` (182) rendered INSIDE its column. The hidden-set/seed/toggle wiring all live in `EventList` and are layout-agnostic — nothing in `logic.ts` needs touching.

**Read** (verbatim): `src/renderer/index.css` (full theme — confirmed `--card`, `--border`,
`--muted`, `--accent`, `--muted-foreground`, `--ring`, and the 12-hue `--event-*` palette all
exist; NO new token needed), `src/renderer/googleCalendarCatalog/components.tsx` (`EventList`,
`CalendarLegend`, `CalendarToggle`, `CalendarMonthGrid`, `MonthEmptyNote`),
`src/renderer/GoogleCalendarPanel.tsx` (panel shell — confirms the panel is ONE narrow `bg-card`
column among up to four side-by-side panels; legend is NOT in the panel, so editing the catalog
root satisfies FR-004 parity).

**memory_recall / memory_smart_search** (`cosmos design system tokens event color palette sidebar
scroll divider`; `shared-calendars legend catalog root parity color token`): no stored hits
returned this session; the cross-session decisions (legend in catalog root for parity,
renderer-only ephemeral hidden-set, `≤1` suppression, `--event-*` shared color mapping) are
re-confirmed directly from the code above and `.sdd/designs/shared-calendars-v1.md`.

---

## Token confirmation (no additions)

**No `src/renderer/index.css` token additions, and no `src/renderer/components/ui/` change.**
The reposition is expressible entirely in existing tokens + Tailwind utilities:

| Need | Existing token / utility | Why |
|------|--------------------------|-----|
| Swatch color | `--event-*` family via `tokenColorClasses().dot` | Reused as-is; the surface ships the resolved `colorToken` (FR-003). |
| Column divider | `border-border` (`--border` `#333`) | The same hairline already used by the grid wrapper + header rows — keeps the two columns reading as one card region. |
| Active/hover toggle wash | `hover:bg-accent/60` (existing on the pill) → row form keeps `hover:bg-accent/60`; selected row uses `bg-accent/40` | `--accent` `#2d2d30` is the established interactive wash. |
| Sidebar heading | `text-muted-foreground` | Matches the grid's weekday-header + empty-note muted treatment. |
| Focus ring | `outline-ring/50` (global base) + button default | Radix-free native `<button>` already gets the global focus ring; unchanged. |

This confirms the spec's expectation (Design step note): the `--event-*` palette from
`shared-calendars-v1` is reused as-is, NO new tokens.

---

## 1. Surfaces & layout

### 1.1 Where it lives

Single surface: the Google Calendar **default-view catalog root `EventList`**
(`src/renderer/googleCalendarCatalog/components.tsx`), rendered inside the A2UI host in
`GoogleCalendarPanel`'s active tab AND on any agent/MCP-rendered Google Calendar surface
carrying `calendars[]`. One implementation, both paths (FR-004).

### 1.2 The two-column row (replaces the stacked column)

`EventList`'s outer container changes from a vertical stack to a horizontal **flex ROW**:

```
EventList root  (was: flex flex-col gap-2)
└── flex flex-row gap-3 items-start                         ← the new row
    ├── [legend present?] LEGEND SIDEBAR  (left, BEFORE grid in DOM → tab order)
    │     aside.shrink-0  w-44  max-h-full  overflow-y-auto  pr-3  border-r border-border
    │       └── CalendarLegend  (now flex flex-col, vertical list)
    └── GRID COLUMN  (right, fills remaining width)
          div.min-w-0 flex-1  max-w-[34rem]
            └── CalendarMonthGrid  (unchanged internals; MonthEmptyNote stays here)
```

Recommended exact Tailwind for the row and the two columns:

- **Row:** `flex flex-row items-start gap-3`
  - `items-start` so the short sidebar does not stretch to the grid's full height (it hugs its
    content; the grid defines the row height).
  - `gap-3` (0.75rem) is the visual gutter; combined with the sidebar's `border-r` + `pr-3` it
    reads as a clean rail/divider without crowding.
- **Legend sidebar:** `aside` with
  `className="shrink-0 w-44 max-h-full overflow-y-auto pr-3 border-r border-border"`
  - `w-44` = **11rem / 176px** fixed width (the chosen max-width; see §2).
  - `shrink-0` so the grid, not the rail, absorbs width pressure (FR-007 legibility floor lives
    on the grid's `max-w`, not on a collapsing rail — per the resolved Open Question, NO
    narrow-width special handling).
  - `max-h-full overflow-y-auto` gives the rail its OWN vertical scroll (FR-002, §3).
  - `pr-3 border-r border-border` is the divider treatment (§4).
- **Grid column:** `div` with `className="min-w-0 flex-1 max-w-[34rem]"`
  - `flex-1` fills the width to the right of the rail (FR-001).
  - `min-w-0` lets the grid cell text/chips truncate instead of forcing the row wider than the
    panel (without it, flex children refuse to shrink below content width).
  - `max-w-[34rem]` = **544px** cap (the chosen grid max-width; see §2) so on a wide panel the
    7-col grid does not stretch to cartoonish day-cell widths; surplus width becomes trailing
    whitespace, not oversized cells.

The `legend && (...)` conditional is kept around the `<aside>` so the rail renders ONLY when
legend data is present; when `CalendarLegend` self-suppresses (`≤1`) it returns `null`, the
`<aside>` collapses to empty, and the grid `flex-1` fills the row (see §5.3 for the clean
single-column outcome).

> The grid column's INTERNAL markup (`CalendarMonthGrid`, weekday header, `DayCell`s,
> `MonthEmptyNote`) is byte-for-byte unchanged. Only the OUTER `EventList` container and
> `CalendarLegend`'s orientation change.

---

## 2. Max-widths chosen

| Element | Value | Rationale |
|---------|-------|-----------|
| **Legend sidebar** | `w-44` = **11rem / 176px** (fixed) | Holds a 1–2-word-truncated calendar name + swatch + the row chrome comfortably without dominating the narrow panel. Fixed (not auto) so the grid's left edge is stable regardless of the longest calendar name — names truncate (`truncate`) rather than widen the rail. Not user-resizable for v1 (resolved Open Question). |
| **Month grid** | `max-w-[34rem]` = **544px** | At 544px the 7 day-columns are ~70px each — comfortably legible for the weekday header + 1–2 stacked event chips, matching the proven single-column grid size. The grid grows to fill available width UP TO this cap, then stops, so a wide panel does not balloon cells. |

Together (176 + 12px gap + 544) the layout wants roughly **~732px** to show both columns at
their caps; below that the grid simply uses less than its 544px cap (down to its natural
`min-w-0` floor) while the rail stays fixed — no crush, no collapse, exactly the
no-special-narrow-handling behavior the user confirmed.

---

## 3. Independent-scroll affordance (FR-002, SC-002)

- The sidebar `<aside>` owns `max-h-full overflow-y-auto`. The grid column has NO overflow — it
  keeps its natural height and position. A long legend therefore scrolls WITHIN the rail; the
  grid never moves with it, and a long list never pushes the grid down or shrinks it (the
  motivating case).
- `max-h-full` bounds the rail to the available surface height (the A2UI host's scroll region),
  so the rail's own scrollbar appears only when the list exceeds that height.
- **Scroll affordance visual:** rely on the platform's native overlay scrollbar (cosmos is
  dark/macOS-style; `body { color-scheme: dark }` already gives a dark thin scrollbar). No
  custom scrollbar token is introduced. To signal "more below" without a custom gradient, the
  vertical list's last visible row is naturally clipped at the rail's bottom edge, which reads
  as scrollable. No sticky header is added for v1 (the list is short labels; a sticky group
  heading is out of scope).
- The grid column and the rail scroll INDEPENDENTLY by construction (only the rail has
  `overflow-y-auto`); scrolling one never moves the other (acceptance criterion in P1 scenario).

---

## 4. Divider / border treatment

- The divider is a single **right border on the sidebar**: `border-r border-border` plus `pr-3`
  inner padding and the row's `gap-3`. This uses the SAME `--border` hairline (`#333`) as the
  grid's own `rounded-lg border` and the weekday-header bottom border, so the rail and grid read
  as one coherent card region rather than two detached widgets.
- No filled background on the rail (no `bg-card`/`bg-muted` panel) — the rail sits on the same
  surface as the grid; only the hairline + gutter separate them. This keeps the change visually
  minimal and avoids a "panel-in-a-panel" look inside the already-narrow `bg-card` panel.
- The border is on the sidebar (not a standalone divider element) so when the rail is suppressed
  (`≤1`) there is no orphaned divider line beside a full-width grid (§5.3).

---

## 5. States

### 5.1 Populated — several calendars (the default multi-calendar view) · P1

- Rail on the LEFT: a vertical `flex flex-col` list of toggle rows; the grid fills to the right
  up to its 544px cap. Side by side, not stacked (SC-001).
- Each toggle row: swatch dot (its `--event-*` color) + calendar name; shown calendars at full
  opacity, hidden calendars dimmed (see §6). Toggling instantly filters the grid (unchanged
  wiring — FR-003, SC-003).

### 5.2 Populated — many calendars (taller than the surface) · P1

- The rail scrolls within itself (§3); the grid stays put at full height (SC-002). Caps at the
  existing `shared-calendars-v1` ≤25-calendar fetch limit; the rail scrolls cleanly across that
  range.

### 5.3 Few calendars (2–3) · P2

- The rail renders but is short — no scrollbar (content < `max-h-full`). The fixed `w-44` keeps
  it from looking broken or wasting excessive width (it does not stretch to the grid height
  because of `items-start`). It reads as a tidy, short rail.

### 5.4 ≤1 calendar — suppressed (FR-005, SC-004)

- `CalendarLegend` returns `null` (unchanged `entries.length <= 1` guard). The `<aside>`
  wrapper renders empty; because the rail has no `bg`/no min-content, and `flex-1` on the grid
  consumes the row, the grid renders **full-width exactly as today** — identical to the
  single-primary path. No empty rail, no orphaned divider.
  - Implementation note for the developer: keep the `border-r`/`pr-3` ON the `CalendarLegend`'s
    own outer element (the `<aside>`) ONLY when it renders content. Since `CalendarLegend`
    returns `null` for `≤1`, the cleanest structure is to put the rail chrome
    (`w-44 overflow-y-auto pr-3 border-r`) on the `<aside>` and render it only inside
    `{legend && entries>1}`. Simplest: keep the existing `{legend && <CalendarLegend …/>}`
    conditional, and have `CalendarLegend` render its OWN `<aside className="shrink-0 w-44
    max-h-full overflow-y-auto pr-3 border-r border-border" role="group" aria-label="Calendars">`
    wrapper, returning `null` (no aside at all) when `≤1`. That guarantees zero rail chrome when
    suppressed.

### 5.5 All calendars hidden / empty month (FR-008)

- The rail STAYS present (so the user can toggle calendars back on); every row shows its
  hidden/dimmed state. The grid region shows the existing calm `MonthEmptyNote`
  ("Nothing scheduled this month.") INSIDE the grid column — NOT in the rail. The note is
  unchanged (`flex items-center justify-center … text-muted-foreground` with the `CalendarDays`
  glyph).

### 5.6 Partial failure (a calendar's read failed) (FR-008)

- Failed calendars still appear as rail rows (they simply contribute no events); the grid shows
  the successful calendars' events; the existing quiet inline note behavior is unchanged. No
  error styling is added to the rail — a failed calendar is indistinguishable in the legend from
  one that just has no events this month (consistent with `shared-calendars-v1`).

### 5.7 Loading

- Unchanged: the panel's existing `MonthGridSkeleton` (`GoogleCalendarPanel.tsx`) covers the
  per-switch default-view read. The skeleton is a grid-only foreshadow and does NOT need a rail
  skeleton for v1 — the legend arrives with the populated surface, and adding a rail skeleton
  would imply a contract/timing the surface does not have. (If desired later, a 3–4-row
  `Skeleton` rail could mirror the grid skeleton; out of scope here.)

---

## 6. Vertical toggle-list visual (was horizontal wrap)

`CalendarLegend`'s inner container flips from `flex flex-wrap items-center gap-1.5` to a
**vertical list**: `flex flex-col gap-0.5`.

Each `CalendarToggle` changes from a rounded PILL to a **full-width list ROW** (it now lives in a
fixed-width rail, so a pill shape wastes the rail and truncates awkwardly). Recommended row:

```
button[role="switch"]  (semantics UNCHANGED — only container/shape change)
  className=cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left',
    'text-[11px] leading-tight text-foreground transition-colors',
    'hover:bg-accent/60',
    !hidden && 'bg-accent/40',          // shown = subtly seated row
    hidden && 'opacity-50'              // hidden = dimmed, as today
  )
  ├── span.size-2.shrink-0.rounded-full  + swatch.dot  (+ hidden && 'opacity-40')   aria-hidden
  └── span.truncate  (+ hidden && 'line-through')   {name}
```

Visual rationale:
- **Full-width row, left-aligned** (`w-full text-left`) reads as a scannable list (Google
  Calendar's "My calendars" rail), not a cloud of chips.
- **`rounded-md`** (not `rounded-full`) — a list row, hover wash fills the row width.
- **Selected affordance:** shown calendars get a faint `bg-accent/40` seat so the rail reads as
  a set of checked items; hidden ones drop the seat AND dim (`opacity-50` + `line-through` +
  dot `opacity-40`) exactly as today. This makes the shown/hidden split legible at a glance in a
  vertical list (in the old horizontal pills the only cue was opacity/strike; the seated-row cue
  is a small, in-system improvement using existing `--accent`).
- **Swatch unchanged:** still `size-2 rounded-full` with the `--event-*` `swatch.dot` class,
  still `aria-hidden` decorative (FR-009).
- `gap-0.5` between rows keeps the list dense (it can be long); `gap-2` inside the row separates
  swatch from name.

> The button's `type`, `role="switch"`, `aria-checked={!hidden}`, `aria-label`, and `onClick`
> are byte-for-byte unchanged — ONLY the className (shape: pill→row) changes. Semantics and
> behavior are identical (FR-003, FR-009).

Optional rail heading (recommended, low-risk): a small `text-[11px] font-medium
text-muted-foreground px-2 pb-1` "Calendars" label at the top of the `<aside>` mirrors the
grid's month `<h2>` weight and the weekday-header muted treatment, giving the rail a title that
matches the grid's. It is purely visual; the `aria-label="Calendars"` on the group already
names the region for AT, so the heading should be `aria-hidden` (or simply rely on the existing
`aria-label` and skip the visible heading if the developer prefers the leanest change). Either
is acceptable; the visible heading is preferred for parity with the grid's labeled month.

---

## 7. Interaction & accessibility (FR-009 — no regression)

- **Tab order:** the `<aside>` (legend, interactive `role="switch"` buttons) is FIRST in DOM
  order within the row, so the toggles come BEFORE the display-only grid in the tab order —
  satisfied naturally by placing the rail left/first (the grid has no focusable controls). No
  `tabindex` juggling needed.
- **Roles:** the rail keeps `role="group" aria-label="Calendars"` on the `<aside>`; each row
  stays a `role="switch"` button with `aria-checked={!hidden}` and the
  `"Show/Hide <name>"` `aria-label`. Swatch dot stays `aria-hidden` decorative.
- **Keyboard:** native `<button>` Enter/Space toggles each switch (unchanged). The rail is a
  normal scroll container — keyboard focus moving through the rows scrolls them into view via
  the browser's default focus scrolling; no scroll trap is introduced.
- **Focus ring:** the global `* { outline-ring/50 }` base + the button's focus-visible outline
  give a visible ring on `--ring` (`#4a4a4c`) against the row — adequate contrast on the dark
  surface. The seated `bg-accent/40` does not obscure the ring (ring is an outline, not a fill).
- **Contrast (dark palette):** row text `text-foreground` (`#e0e0e0`) on `--card`/`--accent`
  (`#1b1b1c`/`#2d2d30`) is well above 4.5:1. Hidden rows at `opacity-50` are intentionally
  de-emphasized (their meaning is also carried by `aria-checked=false` + `line-through`, not by
  contrast alone). The `--event-*` swatch is a 8px decorative dot — color is reinforcement only;
  the calendar NAME always carries the identity (consistent with the palette's "color is
  reinforcement only" rule).
- **Divider/scrollbar are non-interactive** and carry no semantics — purely visual (the rail's
  meaning is the labeled group + switches).

---

## 8. Components used

- **No shadcn `components/ui/` primitive is added or changed.** The legend is a custom catalog
  component (native `<button role="switch">`), consistent with `shared-calendars-v1` (it was
  never a shadcn `Switch` — it is a labeled color+name toggle). The reposition keeps that.
- Existing utilities only: `cn()` (`src/renderer/lib/utils.ts`), Tailwind flex/overflow/border
  classes, `--event-*` / `--border` / `--accent` / `--muted-foreground` / `--ring` tokens.
- `lucide-react` `CalendarDays` (already imported) for the unchanged `MonthEmptyNote`.

---

## 9. Developer hand-off summary (what changes in `components.tsx`)

> Code is the developer's to write; this is the buildable picture, not an edit.

1. **`EventList` return:** replace the outer `<div className="flex flex-col gap-2">` with
   `<div className="flex flex-row items-start gap-3">`; keep `{legend && <CalendarLegend …/>}`
   FIRST, then wrap `<CalendarMonthGrid …/>` in `<div className="min-w-0 flex-1 max-w-[34rem]">`.
   All props to `CalendarMonthGrid` (`events`, `timeMin`, `calendars`, `hiddenCalendarIds`) are
   unchanged.
2. **`CalendarLegend`:** render its own `<aside className="shrink-0 w-44 max-h-full
   overflow-y-auto pr-3 border-r border-border" role="group" aria-label="Calendars">` (was an
   inner `<div … role="group">`); keep the `entries.length <= 1 ⇒ return null` guard (so the
   `<aside>` is absent when suppressed); inside it, the list container becomes
   `flex flex-col gap-0.5`; optional `aria-hidden` "Calendars" heading at the top.
3. **`CalendarToggle`:** change ONLY the `className` from the pill form to the full-width row
   form in §6 (`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left …`, with the
   `!hidden && 'bg-accent/40'` seat). `type`/`role`/`aria-*`/`onClick`/swatch/name JSX unchanged.
4. **`CalendarMonthGrid`, `MonthEmptyNote`, `DayCell`, `logic.ts`, `logic.test.ts`:** untouched.

---

## 10. Open questions

None blocking. Two designer choices flagged for the developer to take as the default (either
option is in-system, both acceptable):

- The visible `"Calendars"` rail heading (§6) is RECOMMENDED for parity with the grid's labeled
  month, but the lean alternative (rely on the existing `aria-label` only, no visible heading)
  is acceptable if the developer prefers the minimal diff.
- The `bg-accent/40` "seated shown row" affordance (§6) is RECOMMENDED for at-a-glance
  shown/hidden legibility in a vertical list; if the developer wants the absolute-minimal
  change, the prior opacity/`line-through`-only cue (no seat) is also acceptable — but the seat
  is preferred and uses only existing `--accent`.
