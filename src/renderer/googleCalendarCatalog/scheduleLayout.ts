/**
 * scheduleLayout — pure, framework-free time-axis layout for the Google Calendar Week/Day
 * schedule views (calendar-week-day-views-v1, design §4). The time-axis sibling to
 * `buildMonthGrid`: given a day's local boundaries and a set of events, it produces the
 * per-column placed blocks (`{ topPct, heightPct, laneIndex, laneCount }`), the all-day
 * items, and the column aria-label — so the React `WeekView`/`DayView`/`EventBlock`
 * components are thin shells over it exactly as `CalendarMonthGrid` is over `buildMonthGrid`.
 *
 * NO React, NO DOM, NO secrets. Reuses the catalog's `isAllDay`/`eventTitle`/`eventTimeLabel`
 * + the `EventChipData` shape verbatim (it does NOT re-implement the all-day/title/time
 * logic). All percentages are relative to the day's ACTUAL local midnight-to-midnight span,
 * so a DST 23h/25h day places + sizes correctly (FR-006, the DST edge case) and a
 * cross-midnight event is clamped to each day column's visible bounds (FR-006 clamp).
 *
 * Spec trace: FR-006 (placement/size), FR-007 (all-day row), FR-008 (overlap lanes),
 * design §4 (equal-width lanes, min height, cross-midnight clamp), §6 (column aria-label).
 */

import {
  eventTimeLabel,
  eventTitle,
  isAllDay,
  type EventChipData
} from './logic'

/** The local day a schedule column renders. `start`/`end` are the column's local bounds. */
export interface DayBounds {
  /** Inclusive local start instant of the day (its 00:00). */
  start: Date
  /** Exclusive local end instant of the day (the next day's 00:00). */
  end: Date
}

/**
 * A timed event placed in a day column (design §4). Percentages are vertical offsets within
 * the column (`topPct`) + the block's height (`heightPct`), both 0..100 and clamped to the
 * day. `laneIndex`/`laneCount` split the column width across a concurrent overlap group:
 * `width = 100 / laneCount`, `left = laneIndex * (100 / laneCount)`.
 */
export interface PlacedEvent {
  event: EventChipData
  /** Vertical offset from the top of the day column, 0..100 (%). */
  topPct: number
  /** Block height as a % of the day column, > 0 and clamped so top + height ≤ 100. */
  heightPct: number
  /** This block's lane within its concurrent overlap group (0-based). */
  laneIndex: number
  /** The number of lanes the concurrent group is split into (≥ 1). */
  laneCount: number
}

/** An all-day / full-span event surfaced in the column's top all-day row (design §1.2). */
export interface AllDayItem {
  event: EventChipData
}

/** The composed layout for ONE day column: its all-day items + placed timed blocks. */
export interface DayColumnLayout {
  allDay: AllDayItem[]
  timed: PlacedEvent[]
}

/** The minimum block height (%) so a zero/near-zero-duration block stays legible (design §4). */
export const MIN_BLOCK_HEIGHT_PCT = 1.5

/* ------------------------------------------------------------------------- *
 * Time parsing + placement (FR-006)
 * ------------------------------------------------------------------------- */

/**
 * Parse a TIMED event's start/end into millisecond instants. Returns `null` when the start
 * is absent/unparseable (the event drops out of the timed grid — design §4 / mirrors the
 * chip degrade). An absent/unparseable/`≤ start` end degrades to a zero-length instant at
 * the start (the caller floors it to {@link MIN_BLOCK_HEIGHT_PCT}); it never throws.
 */
export function eventInstants(
  event: EventChipData
): { startMs: number; endMs: number } | null {
  if (typeof event.start !== 'string') {
    return null
  }
  const start = new Date(event.start)
  if (Number.isNaN(start.getTime())) {
    return null
  }
  const startMs = start.getTime()
  let endMs = startMs
  if (typeof event.end === 'string') {
    const end = new Date(event.end)
    if (!Number.isNaN(end.getTime())) {
      endMs = end.getTime()
    }
  }
  // A zero/negative duration degrades to a min-height block at the start (design §4).
  if (endMs < startMs) {
    endMs = startMs
  }
  return { startMs, endMs }
}

/**
 * Place a single timed event within a day column (design §4), clamped to the day's local
 * bounds so a cross-midnight / multi-day event touches the column edge rather than being
 * lost (FR-006 clamp). Returns `null` when the event does NOT overlap the day at all (so the
 * caller drops it from this column) or its start is unparseable. Percentages derive from the
 * day's ACTUAL span (`end - start` ms), so a DST 23h/25h day is correct (no hardcoded 1440).
 */
export function placeInDay(
  event: EventChipData,
  bounds: DayBounds
): { topPct: number; heightPct: number } | null {
  const instants = eventInstants(event)
  if (!instants) {
    return null
  }
  const dayStart = bounds.start.getTime()
  const dayEnd = bounds.end.getTime()
  const dayMs = dayEnd - dayStart
  if (!(dayMs > 0)) {
    return null
  }
  const { startMs, endMs } = instants
  // No overlap with this day at all (entirely before/after) ⇒ not in this column. A
  // zero-length event exactly AT the day end is excluded; one at the day start is included.
  if (endMs < dayStart || startMs >= dayEnd) {
    return null
  }
  const clampedStart = Math.max(startMs, dayStart)
  const clampedEnd = Math.min(endMs, dayEnd)
  const topPct = ((clampedStart - dayStart) / dayMs) * 100
  let heightPct = ((clampedEnd - clampedStart) / dayMs) * 100
  if (heightPct < MIN_BLOCK_HEIGHT_PCT) {
    heightPct = MIN_BLOCK_HEIGHT_PCT
  }
  // Never overflow the column: cap the bottom edge at 100%.
  if (topPct + heightPct > 100) {
    heightPct = Math.max(MIN_BLOCK_HEIGHT_PCT, 100 - topPct)
  }
  return { topPct, heightPct }
}

/* ------------------------------------------------------------------------- *
 * Overlap lane packing (FR-008, design §4 — equal-width split)
 * ------------------------------------------------------------------------- */

/** An internal placed block (pre-lane-assignment) carrying its clamped ms span for packing. */
interface Spanned {
  event: EventChipData
  topPct: number
  heightPct: number
  startMs: number
  endMs: number
}

/**
 * Assign lanes to a day's timed blocks (design §4 equal-width split). Blocks are grouped into
 * maximal CONNECTED overlap clusters (A overlaps B, B overlaps C ⇒ all share a width split);
 * within a cluster each block gets the first free lane and the cluster's `laneCount` is the
 * peak concurrency. A non-overlapping block is its own group (`laneCount = 1`, full width).
 * Deterministic + bounded — input order within equal starts is preserved.
 */
function assignLanes(spans: Spanned[]): PlacedEvent[] {
  if (spans.length === 0) {
    return []
  }
  // Sort by start, then by end, so the sweep assigns lanes left-to-right deterministically.
  const sorted = [...spans].sort((a, b) =>
    a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs
  )

  const placed: PlacedEvent[] = []
  let cluster: { span: Spanned; lane: number }[] = []
  let clusterMaxEnd = -Infinity

  const flush = (): void => {
    if (cluster.length === 0) {
      return
    }
    const laneCount = cluster.reduce((max, c) => Math.max(max, c.lane + 1), 0)
    for (const c of cluster) {
      placed.push({
        event: c.span.event,
        topPct: c.span.topPct,
        heightPct: c.span.heightPct,
        laneIndex: c.lane,
        laneCount
      })
    }
    cluster = []
    clusterMaxEnd = -Infinity
  }

  for (const span of sorted) {
    // A new block that starts at/after every active block's end starts a fresh cluster.
    if (cluster.length > 0 && span.startMs >= clusterMaxEnd) {
      flush()
    }
    // First free lane among the blocks still active at this block's start.
    const taken = new Set<number>()
    for (const c of cluster) {
      if (c.span.endMs > span.startMs) {
        taken.add(c.lane)
      }
    }
    let lane = 0
    while (taken.has(lane)) {
      lane++
    }
    cluster.push({ span, lane })
    clusterMaxEnd = Math.max(clusterMaxEnd, span.endMs)
  }
  flush()
  return placed
}

/* ------------------------------------------------------------------------- *
 * The day-column composition (the WeekView/DayView shell consumes this)
 * ------------------------------------------------------------------------- */

/**
 * Compose ONE day column's layout from the events that touch it (design §4 / §1.2):
 *  - ALL-DAY events (per {@link isAllDay}) → the top all-day row, in input order (FR-007).
 *  - TIMED events placed + clamped to the day (FR-006) then lane-packed (FR-008). An event
 *    that does not overlap the day, or whose start is unparseable, is dropped from the grid
 *    (never thrown). A cross-midnight event appears in EACH overlapped day, clamped.
 *
 * `events` is the FULL (hidden-filtered) set the column might contain; the caller passes the
 * same flat list per column and this function selects the ones that fall on / overlap it.
 * Pure + deterministic.
 */
export function buildDayColumn(events: EventChipData[], bounds: DayBounds): DayColumnLayout {
  const list = Array.isArray(events) ? events : []
  const allDay: AllDayItem[] = []
  const spans: Spanned[] = []
  const dayStart = bounds.start.getTime()
  const dayEnd = bounds.end.getTime()

  for (const ev of list) {
    if (isAllDay(ev)) {
      if (allDayCoversDay(ev, bounds)) {
        allDay.push({ event: ev })
      }
      continue
    }
    const instants = eventInstants(ev)
    if (!instants) {
      continue
    }
    const placement = placeInDay(ev, bounds)
    if (!placement) {
      continue
    }
    spans.push({
      event: ev,
      topPct: placement.topPct,
      heightPct: placement.heightPct,
      startMs: Math.max(instants.startMs, dayStart),
      endMs: Math.min(instants.endMs, dayEnd)
    })
  }

  return { allDay, timed: assignLanes(spans) }
}

/**
 * Whether an ALL-DAY event covers the given day column. An all-day event's `start` is a
 * date-only `YYYY-MM-DD` and its `end` is the EXCLUSIVE date-only end (Google's convention).
 * A single-day all-day event has `start === thatDay` and no/`start+1` end. A multi-day
 * all-day event covers `[start, end)` so it surfaces in every covered column (design §5 /
 * the multi-day-all-day case — a spanning bar). An absent/unparseable start ⇒ not covered.
 */
export function allDayCoversDay(event: EventChipData, bounds: DayBounds): boolean {
  if (typeof event.start !== 'string') {
    return false
  }
  const startKey = event.start.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey)) {
    return false
  }
  const dayKey = localDateKey(bounds.start)
  // Exclusive end (date-only). Absent ⇒ a single-day event (covers only its start day).
  const endKey =
    typeof event.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.end.slice(0, 10))
      ? event.end.slice(0, 10)
      : nextDateKey(startKey)
  // Covered when startKey ≤ dayKey < endKey (ISO date strings compare lexicographically).
  return startKey <= dayKey && dayKey < endKey
}

/* ------------------------------------------------------------------------- *
 * Week/Day day-list helpers (the column set the views render)
 * ------------------------------------------------------------------------- */

/**
 * Derive the list of day columns from the surface window (`timeMin`/`timeMax`) — one
 * {@link DayBounds} per LOCAL day in `[timeMin, timeMax)`. A week window yields 7 columns; a
 * day window yields 1. Bounds are LOCAL midnight-to-midnight (so a DST day's span is its true
 * 23h/25h). An absent/unparseable `timeMin` falls back to `now`'s day (a single safe column).
 * Capped at 31 columns so a malformed wide window never explodes. Pure.
 */
export function dayColumnsForWindow(
  timeMin: string | undefined,
  timeMax: string | undefined,
  now: Date = new Date()
): DayBounds[] {
  const startSource =
    typeof timeMin === 'string' && !Number.isNaN(new Date(timeMin).getTime())
      ? new Date(timeMin)
      : now
  // Normalize to LOCAL midnight of the start day.
  let cursor = new Date(startSource.getFullYear(), startSource.getMonth(), startSource.getDate())

  const endSource =
    typeof timeMax === 'string' && !Number.isNaN(new Date(timeMax).getTime())
      ? new Date(timeMax)
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)

  const columns: DayBounds[] = []
  for (let i = 0; i < 31; i++) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    columns.push({ start: cursor, end: next })
    if (next.getTime() >= endSource.getTime()) {
      break
    }
    cursor = next
  }
  // Always at least one column (a malformed/empty window still renders a calm axis).
  if (columns.length === 0) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    columns.push({ start: cursor, end: next })
  }
  return columns
}

/* ------------------------------------------------------------------------- *
 * Column header + aria-label (design §6 — the Week/Day analog of dayCellAriaLabel)
 * ------------------------------------------------------------------------- */

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/** A day column's short header bits (design §1.2): `Mon` weekday + `16` date + today flag. */
export interface DayColumnHeader {
  /** Short weekday abbreviation, e.g. `Mon`. */
  weekday: string
  /** Day-of-month number as a string, e.g. `16`. */
  dateLabel: string
  /** True when this column is today (matches `now`'s local day). */
  isToday: boolean
}

/** Compose a day column's short header (weekday + date + today marker). Pure. */
export function dayColumnHeader(bounds: DayBounds, now: Date = new Date()): DayColumnHeader {
  const d = bounds.start
  return {
    weekday: WEEKDAY_SHORT[d.getDay()],
    dateLabel: `${d.getDate()}`,
    isToday: localDateKey(d) === localDateKey(now)
  }
}

/**
 * Compose a day COLUMN's `aria-label` (design §6) — the Week/Day analog of
 * `dayCellAriaLabel`, so a screen-reader user hears the whole day + its events without
 * traversing every positioned block, e.g.
 *   `Monday June 16, today, 3 events: Standup 9:30 AM, Lunch 12:00 PM, Sync 3:00 PM`.
 * Combines all-day + timed items (all-day rendered as `… all day`). An empty day says
 * `no events`. Best-effort; never throws. Pure beyond `Intl` (via `eventTimeLabel`).
 */
export function dayColumnAriaLabel(
  layout: DayColumnLayout,
  bounds: DayBounds,
  now: Date = new Date()
): string {
  const d = bounds.start
  const datePrefix = `${WEEKDAY_FULL[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`
  const segments: string[] = [datePrefix]
  if (localDateKey(d) === localDateKey(now)) {
    segments.push('today')
  }

  const all = [...layout.allDay.map((a) => a.event), ...layout.timed.map((t) => t.event)]
  if (all.length === 0) {
    segments.push('no events')
    return segments.join(', ')
  }

  const noun = all.length === 1 ? 'event' : 'events'
  const list = all
    .map((ev) => {
      const time = isAllDay(ev) ? 'all day' : eventTimeLabel(ev)
      return time ? `${eventTitle(ev)} ${time}` : eventTitle(ev)
    })
    .join(', ')
  segments.push(`${all.length} ${noun}: ${list}`)
  return segments.join(', ')
}

/* ------------------------------------------------------------------------- *
 * Local date helpers (no UTC shift) — duplicated minimal copies so this module
 * stays import-light beside `logic.ts` (mirrors logic.ts' own private copies).
 * ------------------------------------------------------------------------- */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** The next date key after a `YYYY-MM-DD` string (local, carries across month/year). */
function nextDateKey(key: string): string {
  const [y, m, day] = key.split('-').map(Number)
  const next = new Date(y, m - 1, day + 1)
  return localDateKey(next)
}
