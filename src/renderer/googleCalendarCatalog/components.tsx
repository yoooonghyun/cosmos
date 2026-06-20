/**
 * googleCalendarCatalog/components — the Google Calendar custom A2UI catalog components
 * (google-calendar-v1, design §1/§2). Plain cosmos React components rendered by the
 * Google Calendar panel's `<A2UIProvider catalog={googleCalendarCatalog}>`, so they may
 * use ANY Tailwind class — including the `--event-*` token family (design §5) the month
 * grid colors event chips with.
 *
 * The surface vocabulary is deliberately small (v1 is READ-ONLY, no input component):
 *   - `EventList` (the ROOT the builder emits, design — `googleCalendarSurfaceBuilder`):
 *      a FLAT `events[]` + the `timeMin`/`timeMax` window + `hasMore`. It renders the
 *      design's MONTH GRID by bucketing the flat events onto day cells via `logic.ts`.
 *   - `EventRow` (advertised in the agent vocabulary): a single event as a standalone
 *      chip, so an agent can compose an ad-hoc list outside the grid.
 *   - `Notice` (the recoverable-error block the builder emits, mirrors Jira §9.5).
 *   - `Column`/`Row` passthroughs (registered in `index.ts`) for agent grouping.
 *
 * Decision logic lives in `./logic.ts` (node-testable); these are thin shells.
 *
 * Design trace: §1.1 CalendarMonthGrid/DayCell, §1.2 EventChip timed/all-day,
 * §2/§2.1 states + MonthGridSkeleton, §5 colorId→--event-* tokens, §6 aria.
 */

import { useEffect, useMemo, useState } from 'react'
import { useDispatchAction } from '@a2ui-sdk/react/0.9'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  MapPin,
  Repeat,
  TriangleAlert,
  X
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useCalendarNav,
  useCalendarDetailSelectedId,
  type CalendarNavValue,
  type CalendarViewKind
} from './navContext'
import {
  CALENDAR_OPEN_DETAIL_ACTION,
  isOpenDetailEmittable,
  detailTitle,
  eventWhen,
  hasLocation,
  descriptionText,
  NO_DESCRIPTION_LABEL,
  attendeeList,
  hasAttendees,
  openInGoogleUrl,
  isRecurringInstance,
  RECURRING_LABEL,
  type AttendeeDisplay
} from './eventDetailLogic'
import {
  buildMonthGrid,
  cellEventDisplay,
  dayCellAriaLabel,
  eventColorClasses,
  eventColorClassesByCalendar,
  eventTimeLabel,
  eventTitle,
  isAllDay,
  seedHiddenCalendarIds,
  tokenColorClasses,
  type CalendarLegendData,
  type DayCellData,
  type EventChipData
} from './logic'
import {
  buildDayColumn,
  dayColumnAriaLabel,
  dayColumnHeader,
  dayColumnsForWindow,
  type DayBounds,
  type PlacedEvent
} from './scheduleLayout'

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
}

/* ------------------------------------------------------------------------- *
 * EventChip (display) — one event in a day cell (design §1.2)
 *
 * Timed: a colored leading dot + a short local time + the title.
 * All-day: a tinted bar (the token at low alpha + a left accent border) + the title.
 * A blank/absent summary degrades to `(no title)`; an unparseable time is dropped — the
 * chip never renders empty and never throws (FR-016/FR-017). `logic.ts` owns the splits.
 * ------------------------------------------------------------------------- */

function EventChip({
  event,
  calendars,
  onOpenDetail,
  selected
}: {
  event: EventChipData
  /**
   * The legend (shared-calendars-v1). When present AND the event carries a `calendarId`,
   * the chip is colored by its OWNING calendar's token (so the chip matches the legend
   * swatch). Absent (single-primary path) ⇒ the chip falls back to its GCal colorId.
   */
  calendars?: CalendarLegendData[]
  /**
   * calendar-event-detail-v1 (FR-001): open this event's detail dock. When provided AND
   * the event has a usable id, the chip renders as an interactive `<button>`; absent (or
   * an idless chip) it stays a plain inert `<div>` (e.g. the standalone `EventRow`).
   */
  onOpenDetail?: (event: EventChipData) => void
  /** True when this chip's event is the one the open detail dock is showing (FR-003 retarget). */
  selected?: boolean
}): React.JSX.Element {
  const colors =
    calendars && typeof event.calendarId === 'string'
      ? eventColorClassesByCalendar(event, calendars)
      : eventColorClasses(event.colorId)
  const title = eventTitle(event)
  const interactive = !!onOpenDetail && isOpenDetailEmittable(event.id)

  // §1.2 all-day: tinted bar; timed: leading dot + time + title. The inner body is the
  // SAME markup whether inert or interactive — only the wrapping element changes.
  const body = isAllDay(event) ? (
    <span className={cn('truncate rounded-sm px-1 py-0.5 text-[11px] leading-tight text-card-foreground', colors.bar)}>
      {title}
    </span>
  ) : (
    <span className="flex items-center gap-1 truncate rounded-sm bg-accent/60 px-1 py-0.5 text-[11px] leading-tight text-card-foreground">
      <span className={cn('size-1.5 shrink-0 rounded-full', colors.dot)} aria-hidden />
      {(() => {
        const time = eventTimeLabel(event)
        return time ? <span className="shrink-0 tabular-nums text-muted-foreground">{time}</span> : null
      })()}
      <span className="truncate">{title}</span>
    </span>
  )

  if (!interactive) {
    // Inert chip (standalone EventRow, or an idless grid chip): a plain block, no tab stop.
    return (
      <div className="block w-full" title={title}>
        {body}
      </div>
    )
  }
  // calendar-event-detail-v1 §4: an interactive chip. Native <button> gives Enter/Space +
  // a tab stop for free; the inset focus ring stays inside the cell's overflow-hidden; a
  // gentle hover lift + an optional selected ring marking the dock's current event.
  return (
    <button
      type="button"
      aria-label={`Open ${title}`}
      aria-pressed={selected ?? false}
      title={title}
      onClick={() => onOpenDetail?.(event)}
      className={cn(
        'block w-full cursor-pointer text-left transition hover:brightness-110 active:brightness-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        selected && 'ring-1 ring-ring/50 ring-inset'
      )}
    >
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------------- *
 * EventRow (display) — a standalone event chip for ad-hoc agent lists (design §3)
 *
 * The agent-advertised single-event component (outside the grid). A thin wrapper around
 * EventChip so the standalone + in-grid chip render identically.
 * ------------------------------------------------------------------------- */

export interface EventRowNode extends SdkProps {
  id?: string
  summary?: string
  start?: string
  end?: string
  allDay?: boolean
  timeZone?: string
  location?: string
  colorId?: string
}

export function EventRow(node: EventRowNode): React.JSX.Element {
  return <EventChip event={node} />
}

/* ------------------------------------------------------------------------- *
 * DayCell (internal) — one day of the month grid (design §1.1)
 *
 * The date number (today in a filled chip), then up to N=3 EventChips, then a
 * `+{n} more` overflow indication. Spillover (out-of-month) days are muted. The whole
 * cell carries an `aria-label` composed in `logic.ts` so a screen reader hears the full
 * day without the truncated visual chips.
 * ------------------------------------------------------------------------- */

function DayCell({
  cell,
  calendars,
  onOpenDetail,
  selectedId
}: {
  cell: DayCellData
  calendars?: CalendarLegendData[]
  /** calendar-event-detail-v1 (FR-001): open this event's detail dock (forwarded to each chip). */
  onOpenDetail?: (event: EventChipData) => void
  /** The id of the event the dock is currently showing, so its chip reads selected (FR-003). */
  selectedId?: string
}): React.JSX.Element {
  const { shown, overflowCount } = cellEventDisplay(cell.events)
  return (
    <div
      className={cn(
        'flex min-h-[64px] flex-col gap-0.5 overflow-hidden p-1',
        // §1.1 spillover days are muted (out of the target month).
        !cell.inMonth && 'bg-muted/30 text-muted-foreground/60'
      )}
      role="gridcell"
      aria-label={dayCellAriaLabel(cell)}
    >
      <div className="flex justify-end">
        <span
          className={cn(
            'flex size-5 items-center justify-center text-[11px] tabular-nums',
            // §1.1 today: a filled primary chip on the day number.
            cell.isToday && 'rounded-full bg-primary font-medium text-primary-foreground'
          )}
        >
          {cell.dateLabel}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {shown.map((event, i) => (
          <EventChip
            key={event.id ?? i}
            event={event}
            calendars={calendars}
            {...(onOpenDetail ? { onOpenDetail } : {})}
            selected={!!selectedId && event.id === selectedId}
          />
        ))}
        {overflowCount > 0 && (
          <span className="px-1 text-[10px] text-muted-foreground">+{overflowCount} more</span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * MonthEmptyNote (display) — the calm zero-event note (design §2, FR-017)
 *
 * The grid is ALWAYS rendered (even for zero events); this calm note sits above it so
 * an empty month reads as "nothing scheduled", never as a broken/error panel.
 * ------------------------------------------------------------------------- */

function MonthEmptyNote(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
      <CalendarDays className="size-4" />
      Nothing scheduled this month.
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * CalendarLegend (display + toggle) — the per-calendar legend (shared-calendars-v1 §3)
 *
 * One toggle chip per accessible calendar: a color swatch (the RESOLVED token from the
 * surface — never re-derived here) + the name. Clicking a chip shows/hides that
 * calendar's events (FR-009/FR-011); a hidden calendar reads muted + struck. The
 * shown/hidden state is the renderer-only ephemeral `hidden` set owned by EventList.
 * Suppressed for a trivial (≤1) legend so the single-primary view is unchanged (FR-014).
 * ------------------------------------------------------------------------- */

function CalendarToggle({
  calendar,
  hidden,
  onToggle
}: {
  calendar: CalendarLegendData
  hidden: boolean
  onToggle: (id: string) => void
}): React.JSX.Element {
  const swatch = tokenColorClasses(calendar.colorToken)
  const id = calendar.id ?? ''
  const name = calendar.summary && calendar.summary.trim().length > 0 ? calendar.summary : id
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!hidden}
      aria-label={`${hidden ? 'Show' : 'Hide'} ${name}`}
      onClick={() => onToggle(id)}
      className={cn(
        // shared-calendars-v1 → calendar-legend-sidebar-v1 §6: the legend is now a vertical
        // rail, so each toggle is a full-width, left-aligned LIST ROW (was a rounded pill).
        // Semantics (type/role/aria-*/onClick) are byte-for-byte unchanged — only the shape.
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] leading-tight text-foreground transition-colors hover:bg-accent/60',
        // Shown calendars get a faint seated wash so the rail reads as a set of checked items.
        !hidden && 'bg-accent/40',
        // Hidden calendars stay dimmed, exactly as in the prior strip.
        hidden && 'opacity-50'
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', swatch.dot, hidden && 'opacity-40')} aria-hidden />
      <span className={cn('truncate', hidden && 'line-through')}>{name}</span>
    </button>
  )
}

function CalendarLegend({
  calendars,
  hidden,
  onToggle
}: {
  calendars: CalendarLegendData[]
  hidden: Set<string>
  onToggle: (id: string) => void
}): React.JSX.Element | null {
  // Suppress a trivial legend (single/primary-only) — the single-calendar view is unchanged.
  // Returning `null` means the `<aside>` rail is ABSENT entirely (no empty rail chrome), so
  // the grid `flex-1` fills the row full-width exactly as today (calendar-legend-sidebar-v1 §5.4).
  const entries = calendars.filter((c) => typeof c.id === 'string' && c.id.length > 0)
  if (entries.length <= 1) {
    return null
  }
  // calendar-legend-sidebar-v1 §1.2/§9: the legend is now a LEFT SIDEBAR rail with its own
  // fixed width + independent vertical scroll + right hairline divider. It carries the rail
  // chrome itself, so when suppressed (above) there is zero orphaned rail/divider.
  return (
    <aside
      className="shrink-0 w-44 max-h-full overflow-y-auto pr-3 border-r border-border"
      role="group"
      aria-label="Calendars"
    >
      {/* Visible rail title (calendar-legend-sidebar-v1 §6, §10 default) — parity with the
          grid's labeled month. The group `aria-label` already names the region for AT, so the
          visible heading is decorative. */}
      <div aria-hidden className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
        Calendars
      </div>
      <div className="flex flex-col gap-0.5">
        {entries.map((cal) => (
          <CalendarToggle
            key={cal.id}
            calendar={cal}
            hidden={hidden.has(cal.id as string)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------------- *
 * NavIconButton — a single ghost icon chevron for the nav cluster
 * (calendar-month-year-nav-v1 → calendar-week-day-views-v1).
 * ------------------------------------------------------------------------- */

function NavIconButton({
  ariaLabel,
  tooltip,
  onClick,
  children
}: {
  ariaLabel: string
  tooltip: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/* ------------------------------------------------------------------------- *
 * CalendarViewSwitcher — the Month/Week/Day segmented control (design D1/§2.1).
 *
 * A segmented control built from the EXISTING `Button` (NO new shadcn primitive): three
 * `variant="ghost" size="sm"` buttons in a `rounded-md border` group, the active segment
 * seated `bg-accent`, each carrying `aria-pressed`. Present ONLY for the live default view.
 * ------------------------------------------------------------------------- */

const VIEW_SEGMENTS: { key: CalendarViewKind; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' }
]

function CalendarViewSwitcher({
  view,
  onSelectView
}: {
  view: CalendarViewKind
  onSelectView: (view: CalendarViewKind) => void
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Calendar view"
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
    >
      {VIEW_SEGMENTS.map((seg, i) => {
        const active = seg.key === view
        return (
          <Button
            key={seg.key}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => onSelectView(seg.key)}
            className={cn(
              'rounded-none',
              i > 0 && 'border-l border-border',
              active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
            )}
          >
            {seg.label}
          </Button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * CalendarRangeNav — the generalized nav cluster (design §1.1).
 *
 * Month: double + single chevrons (jump-year / step-month) around the month label.
 * Week/Day: a single ‹ / › pair (step one week/day) around the range/day label — the
 * double chevrons are hidden (no year-jump in a 7-day/1-day context). `Today` resets to the
 * current range and is `disabled` when already current (FR-009/FR-010).
 * ------------------------------------------------------------------------- */

function CalendarRangeNav({ nav }: { nav: CalendarNavValue }): React.JSX.Element {
  const glyph = 'text-muted-foreground'
  const isMonth = nav.view === 'month'
  const prevTip = isMonth ? 'Previous month' : nav.view === 'week' ? 'Previous week' : 'Previous day'
  const nextTip = isMonth ? 'Next month' : nav.view === 'week' ? 'Next week' : 'Next day'
  return (
    <div className="flex items-center justify-between gap-2">
      <CalendarViewSwitcher view={nav.view} onSelectView={nav.onSelectView} />
      <div className="flex items-center gap-1">
        {isMonth && nav.onPrevYear && (
          <NavIconButton ariaLabel="Previous year" tooltip="Previous year" onClick={nav.onPrevYear}>
            <ChevronsLeft className={glyph} aria-hidden="true" />
          </NavIconButton>
        )}
        <NavIconButton ariaLabel={prevTip} tooltip={prevTip} onClick={nav.onPrev}>
          <ChevronLeft className={glyph} aria-hidden="true" />
        </NavIconButton>
        <h2 className="min-w-[10rem] text-center text-sm font-medium text-foreground tabular-nums">
          {nav.rangeLabel}
        </h2>
        <NavIconButton ariaLabel={nextTip} tooltip={nextTip} onClick={nav.onNext}>
          <ChevronRight className={glyph} aria-hidden="true" />
        </NavIconButton>
        {isMonth && nav.onNextYear && (
          <NavIconButton ariaLabel="Next year" tooltip="Next year" onClick={nav.onNextYear}>
            <ChevronsRight className={glyph} aria-hidden="true" />
          </NavIconButton>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!nav.canGoToday}
        onClick={nav.onToday}
      >
        Today
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * CalendarMonthGrid (display) — the 7-column month grid (design §1.1)
 *
 * The month label, the weekday header row, then a whole number of weeks of DayCells.
 * Always a whole, never-broken grid (FR-017). The composition (cells, labels, today,
 * bucketing) is done in `logic.ts buildMonthGrid` — this is a thin shell over it.
 *
 * calendar-month-year-nav-v1: when `nav` is supplied (the live default view), the plain
 * `<h2>` header row is REPLACED by the `CalendarMonthNav` cluster in the SAME shrink-0
 * slot above the bordered grid box — the grid fill chain below is untouched.
 * ------------------------------------------------------------------------- */

function CalendarMonthGrid({
  events,
  timeMin,
  calendars,
  hiddenCalendarIds,
  nav,
  onOpenDetail,
  selectedId
}: {
  events: EventChipData[]
  timeMin?: string
  /** The legend (shared-calendars-v1) — colors chips by owning calendar when present. */
  calendars?: CalendarLegendData[]
  /** The hidden-set — events owned by these calendars are filtered out (FR-011). */
  hiddenCalendarIds?: Set<string>
  /** The nav cluster wiring (live default view only); absent ⇒ a plain label header. */
  nav?: CalendarNavValue
  /** calendar-event-detail-v1 (FR-001): open an event's detail dock (forwarded to each cell). */
  onOpenDetail?: (event: EventChipData) => void
  /** The id of the event the dock is currently showing (FR-003 retarget marker). */
  selectedId?: string
}): React.JSX.Element {
  // Derive the grid once per (events, window, hidden-set). `now` is read at render so the
  // today indicator is correct; memoizing on the inputs keeps the bucketing off the hot path.
  const grid = useMemo(
    () => buildMonthGrid(events, timeMin, new Date(), 'sunday', hiddenCalendarIds),
    [events, timeMin, hiddenCalendarIds]
  )
  const isEmpty = grid.cells.every((c) => c.events.length === 0)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {nav ? (
        <CalendarRangeNav nav={nav} />
      ) : (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">{grid.monthLabel}</h2>
        </div>
      )}
      {isEmpty && <MonthEmptyNote />}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border"
        role="grid"
        aria-label={grid.monthLabel}
      >
        {/* Weekday header row. */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40" role="row">
          {grid.weekdayLabels.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="px-1 py-1 text-center text-[11px] font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>
        {/* Day cells: a whole number of weeks, divided into a 7-col grid. */}
        <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 [&>*]:border-b [&>*]:border-r [&>*]:border-border">
          {grid.cells.map((cell) => (
            <DayCell
              key={cell.dateKey}
              cell={cell}
              calendars={calendars}
              {...(onOpenDetail ? { onOpenDetail } : {})}
              {...(selectedId ? { selectedId } : {})}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Schedule view (Week/Day) — the time-axis layout (calendar-week-day-views-v1 §1.2/§4)
 *
 * The time-of-day sibling of `CalendarMonthGrid`: an hour gutter on the left + one
 * positioned-block column per day. All math lives in `scheduleLayout.ts` (node-tested);
 * these are thin shells exactly as the month grid is over `buildMonthGrid`. The flat
 * `events[]` + window + legend + hidden-set are the SAME inputs the grid takes — only the
 * layout differs (FR-001). EventBlock is the SAME interactive `<button>` contract as
 * `EventChip` (open-detail dispatch, aria-pressed, hover brightness, inset focus ring).
 * ------------------------------------------------------------------------- */

/** The 24 hour rows the gutter + column gridlines align to (00:00 … 23:00). */
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** Format an hour (0..23) as a short local label, e.g. `9 AM`, `12 PM`, `11 PM`. */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}

/** The left hour gutter: a fixed-width column of right-aligned hour labels (design §4). */
function TimeAxis(): React.JSX.Element {
  return (
    <div className="w-12 shrink-0" aria-hidden="true">
      {HOURS.map((h) => (
        <div
          key={h}
          className="relative h-[var(--cal-hour-h)] pr-1 text-right text-[10px] leading-none text-muted-foreground"
        >
          {/* Nudge the label up so it sits AT the gridline, not below it. */}
          <span className="absolute right-1 -top-1">{h === 0 ? '' : hourLabel(h)}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * EventBlock — one positioned timed event in a day column (design §4).
 *
 * The SAME interactive `<button>` contract as `EventChip`: when `onOpenDetail` is supplied
 * and the event has a usable id it dispatches `calendarNav.openDetail` (via the parent's
 * handler), reads `aria-pressed={selected}`, lifts on hover, and shows an inset focus ring.
 * Absolutely positioned by `topPct`/`heightPct`; laned by `laneIndex`/`laneCount` for an
 * equal-width overlap split (FR-008). Colored by owning calendar (legend) or GCal colorId.
 * ------------------------------------------------------------------------- */

function EventBlock({
  placed,
  calendars,
  onOpenDetail,
  selected
}: {
  placed: PlacedEvent
  calendars?: CalendarLegendData[]
  onOpenDetail?: (event: EventChipData) => void
  selected?: boolean
}): React.JSX.Element {
  const event = placed.event
  const colors =
    calendars && typeof event.calendarId === 'string'
      ? eventColorClassesByCalendar(event, calendars)
      : eventColorClasses(event.colorId)
  const title = eventTitle(event)
  const time = eventTimeLabel(event)
  const interactive = !!onOpenDetail && isOpenDetailEmittable(event.id)

  // Lane geometry: equal-width split across the concurrent overlap group (FR-008). A 1px
  // gutter between lanes keeps adjacent blocks visually distinct.
  const widthPct = 100 / placed.laneCount
  const style: React.CSSProperties = {
    top: `${placed.topPct}%`,
    height: `${placed.heightPct}%`,
    left: `calc(${placed.laneIndex * widthPct}% + 1px)`,
    width: `calc(${widthPct}% - 2px)`
  }

  // §4: the colored body — a left accent bar (the bar token) + the title + a faint time.
  const body = (
    <span
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-sm px-1 py-0.5 text-[11px] leading-tight text-card-foreground',
        colors.bar
      )}
    >
      <span className="truncate font-medium">{title}</span>
      {time && placed.heightPct > 3 && (
        <span className="truncate tabular-nums text-muted-foreground">{time}</span>
      )}
    </span>
  )

  if (!interactive) {
    return (
      <div className="absolute" style={style} title={title}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      aria-label={`Open ${title}`}
      aria-pressed={selected ?? false}
      title={title}
      onClick={() => onOpenDetail?.(event)}
      style={style}
      className={cn(
        'absolute cursor-pointer text-left transition hover:brightness-110 active:brightness-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        selected && 'ring-1 ring-ring/50 ring-inset'
      )}
    >
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------------- *
 * DayColumn — one day's all-day row + positioned timed grid (design §1.2/§4).
 * ------------------------------------------------------------------------- */

function DayColumn({
  bounds,
  events,
  calendars,
  onOpenDetail,
  selectedId,
  showHeader
}: {
  bounds: DayBounds
  events: EventChipData[]
  calendars?: CalendarLegendData[]
  onOpenDetail?: (event: EventChipData) => void
  selectedId?: string
  /** Week view shows a per-column header; Day view hides it (the range label says the day). */
  showHeader: boolean
}): React.JSX.Element {
  const layout = useMemo(() => buildDayColumn(events, bounds), [events, bounds])
  const header = dayColumnHeader(bounds)
  const ariaLabel = dayColumnAriaLabel(layout, bounds)
  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-border" role="gridcell" aria-label={ariaLabel}>
      {showHeader && (
        <div
          className={cn(
            'flex shrink-0 items-baseline justify-center gap-1 border-b border-border py-1 text-[11px]',
            header.isToday ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          <span>{header.weekday}</span>
          <span
            className={cn(
              'tabular-nums',
              header.isToday &&
                'flex size-5 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground'
            )}
          >
            {header.dateLabel}
          </span>
        </div>
      )}
      {/* All-day row: full-width tinted bars, in input order (FR-007). Omitted when empty. */}
      {layout.allDay.length > 0 && (
        <div className="flex shrink-0 flex-col gap-0.5 border-b border-border p-0.5">
          {layout.allDay.map((item, i) => (
            <EventChip
              key={item.event.id ?? i}
              event={item.event}
              {...(calendars ? { calendars } : {})}
              {...(onOpenDetail ? { onOpenDetail } : {})}
              selected={!!selectedId && item.event.id === selectedId}
            />
          ))}
        </div>
      )}
      {/* Timed grid: 24 hour rows (the gridlines) with absolutely-positioned blocks over them. */}
      <div className="relative min-h-0 flex-1">
        {HOURS.map((h) => (
          <div
            key={h}
            className="h-[var(--cal-hour-h)] border-b border-border/40"
            aria-hidden="true"
          />
        ))}
        <div className="absolute inset-0">
          {layout.timed.map((placed, i) => (
            <EventBlock
              key={placed.event.id ?? i}
              placed={placed}
              {...(calendars ? { calendars } : {})}
              {...(onOpenDetail ? { onOpenDetail } : {})}
              selected={!!selectedId && placed.event.id === selectedId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * ScheduleView — the Week (7 columns) / Day (1 column) schedule (design §1.2).
 *
 * Header = the `CalendarRangeNav` cluster (live default view only); body = the hour gutter
 * + the day columns. The columns scroll together vertically. The empty range is a calm axis
 * (no banner) — every day column renders even with zero events (FR-017).
 * ------------------------------------------------------------------------- */

function ScheduleView({
  events,
  timeMin,
  timeMax,
  calendars,
  hiddenCalendarIds,
  nav,
  onOpenDetail,
  selectedId
}: {
  events: EventChipData[]
  timeMin?: string
  timeMax?: string
  calendars?: CalendarLegendData[]
  hiddenCalendarIds?: Set<string>
  nav?: CalendarNavValue
  onOpenDetail?: (event: EventChipData) => void
  selectedId?: string
}): React.JSX.Element {
  // Drop events owned by a hidden calendar BEFORE layout (parity with buildMonthGrid FR-011).
  const visible = useMemo(() => {
    const hidden = hiddenCalendarIds instanceof Set ? hiddenCalendarIds : undefined
    const list = Array.isArray(events) ? events : []
    return hidden
      ? list.filter((ev) => !(typeof ev.calendarId === 'string' && hidden.has(ev.calendarId)))
      : list
  }, [events, hiddenCalendarIds])

  const columns = useMemo(() => dayColumnsForWindow(timeMin, timeMax), [timeMin, timeMax])
  const isDay = columns.length <= 1

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" style={{ ['--cal-hour-h' as string]: '2.5rem' }}>
      {nav && <CalendarRangeNav nav={nav} />}
      <div
        className="flex min-h-0 flex-1 overflow-auto rounded-lg border border-border"
        role="grid"
        aria-label={nav?.rangeLabel ?? 'Schedule'}
      >
        <TimeAxis />
        <div className="flex min-w-0 flex-1" role="row">
          {columns.map((bounds, i) => (
            <DayColumn
              key={i}
              bounds={bounds}
              events={visible}
              {...(calendars ? { calendars } : {})}
              {...(onOpenDetail ? { onOpenDetail } : {})}
              {...(selectedId ? { selectedId } : {})}
              showHeader={!isDay}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * EventList (display, ROOT) — the default-view surface root (design §1.1)
 *
 * The Track-A surface builder emits this as the root with a FLAT `events[]` + the
 * `timeMin`/`timeMax` window + `hasMore`. It renders the design's MONTH GRID by
 * bucketing the flat events onto day cells via `logic.ts` (the grid's month is derived
 * from `timeMin`). A non-array `events` degrades to an empty grid (FR-017).
 * ------------------------------------------------------------------------- */

export interface EventListNode extends SdkProps {
  events?: EventChipData[]
  /** RFC-3339 inclusive lower bound — the grid's month (or schedule window) is derived from this. */
  timeMin?: string
  /** RFC-3339 exclusive upper bound — the schedule's day columns span [timeMin, timeMax). */
  timeMax?: string
  hasMore?: boolean
  /**
   * The per-calendar legend (shared-calendars-v1, FR-008). Present in the shared/
   * multi-calendar view; absent on the single-primary path. Each entry carries its
   * surface-RESOLVED `colorToken` so the legend swatch + the event chips agree.
   */
  calendars?: CalendarLegendData[]
  /**
   * The layout granularity (calendar-week-day-views-v1, FR-001). `'month'` (default/absent)
   * → the month grid; `'week'`/`'day'` → the time-of-day schedule. Set by the surface
   * builder from the requested view. The SAME flat `events[]` + legend + window feed all three.
   */
  view?: 'month' | 'week' | 'day'
}

export function EventList({
  events,
  timeMin,
  timeMax,
  view,
  calendars,
  surfaceId,
  componentId
}: EventListNode): React.JSX.Element {
  const items = Array.isArray(events) ? events : []
  const legend = Array.isArray(calendars) ? calendars : undefined
  const isSchedule = view === 'week' || view === 'day'

  // calendar-event-detail-v1 (FR-001/FR-002): a clicked chip emits the renderer-local
  // open-detail nav action carrying the WHOLE event. The panel's `onAction` seam intercepts
  // it (returns true) and opens the right-side dock — never forwarded to main/agent. The
  // dock's current event id (FR-003 selected marker) flows in via CalendarDetailContext.
  const dispatch = useDispatchAction()
  const selectedId = useCalendarDetailSelectedId()
  const openDetail = (event: EventChipData): void => {
    if (!isOpenDetailEmittable(event.id)) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: CALENDAR_OPEN_DETAIL_ACTION,
      // The whole event rides as the action context. It is renderer-LOCAL (the panel's
      // onAction seam intercepts it and never forwards it to main/agent), and the SDK's
      // resolveContext passes a non-`{path}`/non-FunctionCall literal through untouched — so
      // the structured object reaches the handler intact. The `context` type only admits flat
      // DynamicValue, hence the cast (the value never crosses IPC, never serialized).
      context: { event } as unknown as Record<string, never>
    })
  }

  // calendar-month-year-nav-v1 → calendar-week-day-views-v1: the panel injects the view +
  // range navigation ONLY for the live default view (`composed: false`, connected). Non-null
  // ⇒ render the nav cluster (view switcher + range nav) in the header; null (composed
  // snapshot / disconnected) ⇒ the plain `<h2>` label, no controls (FR-016/FR-017).
  const nav = useCalendarNav()

  // shared-calendars-v1 (FR-010): the renderer-only, EPHEMERAL hidden-set. Seeded from the
  // legend's Google `selected` preference; NOT persisted (no session-schema bump). A new
  // legend identity (a fresh surface) re-seeds it. Keying the seed on the joined ids keeps
  // a re-render with the same calendars from resetting a user's in-session toggles.
  const seedKey = legend ? legend.map((c) => c.id ?? '').join('|') : ''
  const [hidden, setHidden] = useState<Set<string>>(() => seedHiddenCalendarIds(legend))
  useEffect(() => {
    setHidden(seedHiddenCalendarIds(legend))
    // Re-seed only when the SET of calendars changes (seedKey), not on every events tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey])

  const toggle = (id: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // calendar-legend-sidebar-v1 §1.2: the legend moves from a top STRIP to a LEFT SIDEBAR row.
  // The legend rail (its own `<aside>`, self-suppressing at ≤1) sits FIRST so it precedes the
  // display-only grid in DOM/tab order (FR-009); the grid column fills ALL remaining width
  // (`flex-1`, no max cap). `items-start` keeps a short rail from stretching to the grid's full height.
  return (
    <div className="flex h-full flex-row items-stretch gap-3">
      {legend && (
        <CalendarLegend calendars={legend} hidden={hidden} onToggle={toggle} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isSchedule ? (
          <ScheduleView
            events={items}
            timeMin={timeMin}
            timeMax={timeMax}
            calendars={legend}
            hiddenCalendarIds={legend ? hidden : undefined}
            onOpenDetail={openDetail}
            {...(selectedId ? { selectedId } : {})}
            {...(nav ? { nav } : {})}
          />
        ) : (
          <CalendarMonthGrid
            events={items}
            timeMin={timeMin}
            calendars={legend}
            hiddenCalendarIds={legend ? hidden : undefined}
            onOpenDetail={openDetail}
            {...(selectedId ? { selectedId } : {})}
            {...(nav ? { nav } : {})}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Notice (display) — the recoverable-error block (design §2, mirrors Jira §9.5)
 *
 * Rendered as the root of a re-pushed surface for a recoverable, non-reconnect read
 * failure. `noticeKind` selects the glyph + tint; `message` is the non-secret copy.
 * success reuses the neutral Alert + Check (no new success token).
 * ------------------------------------------------------------------------- */

export interface NoticeNode extends SdkProps {
  noticeKind?: 'success' | 'error'
  message?: string
}

export function Notice({ noticeKind, message }: NoticeNode): React.JSX.Element {
  const isError = noticeKind === 'error'
  const Glyph = isError ? TriangleAlert : Check
  return (
    <Alert variant={isError ? 'destructive' : 'default'} className={isError ? '' : 'border-status-done/40'}>
      <Glyph className={isError ? undefined : 'text-status-done-foreground'} />
      <AlertDescription className={isError ? 'text-destructive' : 'text-card-foreground'}>
        {message ?? ''}
      </AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------------- *
 * EventDetail (panel chrome, NOT a catalog node) — the right-side event detail dock
 * (calendar-event-detail-v1, design §1.3/§2). Mounted by `GoogleCalendarPanel` in the
 * `@container/calbody` two-pane beside the grid, NOT registered in the catalog. Renders
 * ENTIRELY from the clicked chip's already-in-hand props — NO fetch, NO `events.get`
 * (design §3 "Loading: None"). Pure display over `eventDetailLogic` derivations.
 *
 * The OWNING calendar's color swatch + name reuse the legend the surface already carries
 * (the same `eventColorClassesByCalendar` the chip makes), so the swatch matches the chip
 * dot + legend exactly — no new color token, no re-derive.
 * ------------------------------------------------------------------------- */

/** A two-tier field row: a tiny uppercase muted label over its value (design §2). */
function DetailRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

/** The colored response-status dot (design §2.5) — reinforcement only; the label carries meaning. */
function attendeeDotClass(status: AttendeeDisplay['responseStatus']): string {
  if (status === 'accepted') {
    return 'bg-event-green'
  }
  if (status === 'declined') {
    return 'bg-event-red'
  }
  return 'bg-muted-foreground'
}

export function EventDetail({
  event,
  calendars,
  onClose
}: {
  event: EventChipData
  /** The legend (shared view) so the Calendar row swatch + name match the chip; absent on primary-only. */
  calendars?: CalendarLegendData[]
  onClose: () => void
}): React.JSX.Element {
  const title = detailTitle(event)
  const when = eventWhen(event)
  const description = descriptionText(event)
  const attendees = hasAttendees(event) ? attendeeList(event) : []
  const link = openInGoogleUrl(event)
  const recurring = isRecurringInstance(event)

  // §2.6: the owning calendar's resolved swatch + display name, from the legend the surface
  // already carries. Falls back to the GCal colorId swatch (single-primary path / no legend).
  const owning =
    calendars && typeof event.calendarId === 'string'
      ? calendars.find((c) => c.id === event.calendarId)
      : undefined
  const calColors =
    calendars && typeof event.calendarId === 'string'
      ? eventColorClassesByCalendar(event, calendars)
      : eventColorClasses(event.colorId)
  const calName =
    owning && owning.summary && owning.summary.trim() !== ''
      ? owning.summary
      : (event.calendarId ?? '')

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* Header (sticky, non-scrolling) — icon + the title (design §1.3). The title IS the
          external "open in Google Calendar" affordance: when a non-secret http(s) `htmlLink`
          is present it renders as an <a target=_blank> (routed to shell.openExternal by the
          window's setWindowOpenHandler — NOT a new IPC channel) with a trailing ExternalLink
          icon; absent, it degrades to plain text with no icon and no link (never a broken
          link). FR-004 "(no title)" still applies in both cases. */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            title={`${title} — open in Google Calendar`}
            className="group flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card rounded-sm"
          >
            <span className="truncate">{title}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ) : (
          <span className="flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close event detail"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Body — scrolls within the dock, never the panel (design §1.3). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-3 py-2.5">
          {/* §2.1 Title (body lead, wraps fully) + the recurring badge inline. */}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold leading-snug text-card-foreground">{title}</h3>
            {recurring && (
              <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Repeat className="size-3" aria-hidden="true" />
                {RECURRING_LABEL}
              </span>
            )}
          </div>

          {/* §2.2 When — derived label; all-day pill suppresses the clock. */}
          <DetailRow label="When">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {when.kind === 'timed-multi-day' ? (
                  <span className="flex flex-col text-sm tabular-nums text-card-foreground">
                    <span>{when.startLabel}</span>
                    <span>{when.endLabel}</span>
                  </span>
                ) : (
                  <span className="text-sm tabular-nums text-card-foreground">{when.primary}</span>
                )}
                {when.allDay && (
                  <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    All day
                  </span>
                )}
              </div>
            </div>
          </DetailRow>

          {/* §2.3 Where — omitted entirely when absent (never a blank row). */}
          {hasLocation(event) && (
            <DetailRow label="Where">
              <span className="flex items-start gap-1.5 text-sm text-card-foreground break-words">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {event.location}
              </span>
            </DetailRow>
          )}

          {/* §2.4 Description — plain text (no HTML); calm placeholder when absent. */}
          <DetailRow label="Description">
            {description ? (
              <p className="text-sm leading-relaxed text-card-foreground whitespace-pre-wrap break-words">
                {description}
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground">{NO_DESCRIPTION_LABEL}</p>
            )}
          </DetailRow>

          {/* §2.5 Attendees — omitted entirely when absent; long lists scroll in the dock. */}
          {attendees.length > 0 && (
            <DetailRow label={`Attendees (${attendees.length})`}>
              <div className="flex flex-col gap-1">
                {attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-card-foreground">
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', attendeeDotClass(a.responseStatus))}
                      aria-hidden="true"
                    />
                    <span className="truncate">{a.label}</span>
                    {a.organizer && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">Organizer</span>
                    )}
                    {a.self && !a.organizer && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">You</span>
                    )}
                  </div>
                ))}
              </div>
            </DetailRow>
          )}

          {/* §2.6 Owning calendar — swatch (resolved token, matches chip) + name. */}
          {(calName || event.calendarId) && (
            <DetailRow label="Calendar">
              <span className="flex items-center gap-2 text-sm text-card-foreground">
                <span className={cn('size-2.5 shrink-0 rounded-full', calColors.dot)} aria-hidden="true" />
                <span className="truncate">{calName}</span>
              </span>
            </DetailRow>
          )}

          {/* §2.8 External link moved to the header: the event TITLE itself is the
              "open in Google Calendar" link (with a trailing ExternalLink icon) when a
              non-secret http(s) htmlLink is present; no separate body link row remains. */}
        </div>
      </ScrollArea>
    </div>
  )
}
