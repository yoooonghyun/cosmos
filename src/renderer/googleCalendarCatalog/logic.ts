/**
 * googleCalendarCatalog/logic — pure, framework-free helpers for the Google Calendar
 * custom A2UI catalog (google-calendar-v1, design §3/§5). Extracted into a plain `.ts`
 * module so the month-grid decision logic (colorId→event-token mapping, the month-cell
 * bucketing, the day-cell aria-label composition, the timed/all-day display split) is
 * unit-testable under the node-only vitest config — the React components
 * (`components.tsx`) are thin shells over these functions.
 *
 * NO React, NO DOM, NO secrets. Inputs are the non-secret event prop shapes the Track-A
 * surface builder emits onto the `EventList` node (mirroring `src/shared/googleCalendar.ts`
 * `GoogleCalendarEvent`); outputs are Tailwind class strings / buckets / labels / booleans.
 *
 * Spec trace: .sdd/specs/google-calendar-v1.md FR-016 (timed vs all-day, time zones),
 * FR-017 (empty state). Design trace: .sdd/designs/google-calendar-v1.md §1.1 (month
 * grid bucketing), §1.2 (EventChip timed/all-day), §5 (colorId→--event-* tokens),
 * §6 (DayCell aria-label).
 */

/**
 * The minimal event shape the month grid consumes — the static props the surface
 * builder spreads onto each `EventList` `events[]` entry (a subset of
 * {@link GoogleCalendarEvent}). Every field is non-secret content/metadata. All optional
 * beyond `id`/`start` so a malformed/partial node degrades rather than throwing.
 */
export interface EventChipData {
  id?: string
  summary?: string
  /** RFC-3339 instant (timed) or `YYYY-MM-DD` (all-day). */
  start?: string
  /** RFC-3339 instant (timed) or `YYYY-MM-DD` exclusive end (all-day). */
  end?: string
  allDay?: boolean
  timeZone?: string
  location?: string
  /** GCal colorId (1–11) when supplied; absent ⇒ the calendar default. */
  colorId?: string
  /**
   * The owning calendar's id (shared-calendars-v1, FR-005). Present in the shared/
   * multi-calendar view; the chip is colored by this calendar's token and a hidden-set
   * built from the legend filters it. Absent on the single-primary path (FR-014).
   */
  calendarId?: string
  /**
   * Plain-text event description (calendar-event-detail-v1, FR-007). Rides the chip's props
   * so the detail dock renders without a fetch. Absent ⇒ the dock shows "No description".
   */
  description?: string
  /**
   * The event's attendees (calendar-event-detail-v1, FR-008). Non-secret display fields
   * only; absent for a solo event. Mirrors the shared `GoogleCalendarAttendee` shape but kept
   * structurally minimal here so the catalog stays framework-/import-free.
   */
  attendees?: EventAttendeeData[]
  /**
   * The event's public "open in Google Calendar" URL (calendar-event-detail-v1, FR-010).
   * Non-secret; absent ⇒ the detail omits the link.
   */
  htmlLink?: string
  /** True when this is a recurring-series instance (calendar-event-detail-v1, FR-011). */
  recurring?: boolean
}

/**
 * The minimal non-secret attendee shape carried on an `EventChipData` (calendar-event-detail-v1,
 * FR-008). All fields optional so a partial entry degrades. Mirrors the shared
 * `GoogleCalendarAttendee` without importing it (the catalog logic stays import-free).
 */
export interface EventAttendeeData {
  displayName?: string
  email?: string
  self?: boolean
  organizer?: boolean
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

/**
 * One per-calendar LEGEND entry as carried on the `EventList` root (shared-calendars-v1,
 * FR-008). The surface builder ships the RESOLVED `colorToken` so the catalog never
 * re-derives a color. All fields optional beyond `id` so a malformed node degrades.
 */
export interface CalendarLegendData {
  id?: string
  summary?: string
  /** The resolved cosmos `--event-*` token name; absent/odd ⇒ the gray fallback. */
  colorToken?: string
  /** Google's `selected` preference; seeds the initial hidden-set (FR-010). */
  selected?: boolean
  primary?: boolean
}

/* ------------------------------------------------------------------------- *
 * §5 — event color: GCal colorId → bounded cosmos --event-* token family
 * ------------------------------------------------------------------------- */

/**
 * The cosmos event-color token names. The six base hues the 11 GCal colorIds collapse into
 * (google-calendar-v1 design §5) PLUS the six shared-calendars-v1 additions (design §2.2)
 * the per-calendar color mapping spreads many calendars across. `gray` is the unknown/
 * absent fallback so a missing/odd token never throws and never shows a wrong hue (color is
 * reinforcement; the title/name carries the meaning). Mirrors the shared
 * `GoogleCalendarColorToken` union so the surface-resolved token always maps to a class.
 */
export type EventColorName =
  | 'blue'
  | 'green'
  | 'purple'
  | 'red'
  | 'amber'
  | 'gray'
  | 'teal'
  | 'cyan'
  | 'indigo'
  | 'magenta'
  | 'pink'
  | 'olive'

/** The Tailwind class strings for one event color (design §1.2 dot + all-day bar). */
export interface EventColorClasses {
  /** Timed-event leading dot: a solid token swatch. */
  dot: string
  /** All-day bar: the token at low alpha + a left accent border + legible text. */
  bar: string
}

/**
 * GCal colorId (1–11, the named palette) → cosmos event-color name (design §5):
 *   1 Lavender→purple · 2 Sage→green · 3 Grape→purple · 4 Flamingo→red ·
 *   5 Banana→amber · 6 Tangerine→amber · 7 Peacock→blue · 8 Graphite→gray ·
 *   9 Blueberry→blue · 10 Basil→green · 11 Tomato→red. Any other/absent ⇒ blue
 *   (the calendar default), except an explicitly-unknown id which the resolver maps to gray.
 */
const COLOR_ID_TO_NAME: Record<string, EventColorName> = {
  '1': 'purple',
  '2': 'green',
  '3': 'purple',
  '4': 'red',
  '5': 'amber',
  '6': 'amber',
  '7': 'blue',
  '8': 'gray',
  '9': 'blue',
  '10': 'green',
  '11': 'red'
}

/** The token class strings per color name. References ONLY `--event-*` tokens (no raw hex). */
const COLOR_CLASSES: Record<EventColorName, EventColorClasses> = {
  blue: { dot: 'bg-event-blue', bar: 'bg-event-blue/25 border-l-2 border-event-blue' },
  green: { dot: 'bg-event-green', bar: 'bg-event-green/25 border-l-2 border-event-green' },
  purple: { dot: 'bg-event-purple', bar: 'bg-event-purple/25 border-l-2 border-event-purple' },
  red: { dot: 'bg-event-red', bar: 'bg-event-red/25 border-l-2 border-event-red' },
  amber: { dot: 'bg-event-amber', bar: 'bg-event-amber/25 border-l-2 border-event-amber' },
  gray: { dot: 'bg-event-gray', bar: 'bg-event-gray/25 border-l-2 border-event-gray' },
  // shared-calendars-v1 (design §2.2) — six new hues for per-calendar color.
  teal: { dot: 'bg-event-teal', bar: 'bg-event-teal/25 border-l-2 border-event-teal' },
  cyan: { dot: 'bg-event-cyan', bar: 'bg-event-cyan/25 border-l-2 border-event-cyan' },
  indigo: { dot: 'bg-event-indigo', bar: 'bg-event-indigo/25 border-l-2 border-event-indigo' },
  magenta: { dot: 'bg-event-magenta', bar: 'bg-event-magenta/25 border-l-2 border-event-magenta' },
  pink: { dot: 'bg-event-pink', bar: 'bg-event-pink/25 border-l-2 border-event-pink' },
  olive: { dot: 'bg-event-olive', bar: 'bg-event-olive/25 border-l-2 border-event-olive' }
}

/** The set of valid token names, for narrowing a surface-provided string to a known token. */
const COLOR_NAME_SET = new Set<string>(Object.keys(COLOR_CLASSES))

/**
 * Resolve a GCal colorId to its cosmos event-color name (design §5). An absent id
 * defaults to `blue` (the calendar default); a non-mapped/odd id degrades to `gray`
 * (never throws, never a wrong hue).
 */
export function eventColorName(colorId?: string): EventColorName {
  if (colorId === undefined || colorId === null || `${colorId}`.trim().length === 0) {
    return 'blue'
  }
  return COLOR_ID_TO_NAME[`${colorId}`.trim()] ?? 'gray'
}

/**
 * The dot + bar token class strings for an event's colorId (design §5). The single
 * mapping table so the surface builder and the catalog never drift and no raw hex
 * reaches a component. Pure/node-testable.
 */
export function eventColorClasses(colorId?: string): EventColorClasses {
  return COLOR_CLASSES[eventColorName(colorId)]
}

/* ------------------------------------------------------------------------- *
 * shared-calendars-v1 §2.2 — per-calendar color: token NAME → classes
 * ------------------------------------------------------------------------- */

/**
 * Narrow a surface-provided token NAME string to a known {@link EventColorName}, or the
 * gray fallback (shared-calendars-v1, FR-007). The surface builder RESOLVES the token once
 * per calendar (`src/shared/googleCalendarColor.ts`) and ships it on each legend entry, so
 * the catalog only narrows it here — never re-derives a hue. An absent/odd token ⇒ gray.
 * Pure/node-testable.
 */
export function tokenColorName(token?: string): EventColorName {
  if (typeof token === 'string' && COLOR_NAME_SET.has(token)) {
    return token as EventColorName
  }
  return 'gray'
}

/** The dot + bar class strings for a resolved token NAME (shared-calendars-v1). Pure. */
export function tokenColorClasses(token?: string): EventColorClasses {
  return COLOR_CLASSES[tokenColorName(token)]
}

/**
 * Resolve an event's chip token from its owning calendar (shared-calendars-v1, FR-005/
 * FR-007). Looks the event's `calendarId` up in the legend `calendars[]` (whose entries
 * carry the surface-RESOLVED `colorToken`) and returns that token NAME. An event with no
 * `calendarId` (single-primary path, FR-014), an unmatched id, or an entry with no token
 * degrades to `gray`. Pure/node-testable.
 */
export function colorTokenFor(
  event: EventChipData,
  calendars: CalendarLegendData[] | undefined
): EventColorName {
  if (typeof event.calendarId !== 'string' || !Array.isArray(calendars)) {
    return 'gray'
  }
  const owner = calendars.find((c) => c && c.id === event.calendarId)
  return tokenColorName(owner?.colorToken)
}

/**
 * The dot + bar classes for an event colored by its OWNING calendar (shared-calendars-v1).
 * The per-calendar analog of {@link eventColorClasses}: the EventChip uses this in the
 * shared/multi-calendar view (where `calendars[]` is present) so the chip matches the
 * legend swatch. Pure.
 */
export function eventColorClassesByCalendar(
  event: EventChipData,
  calendars: CalendarLegendData[] | undefined
): EventColorClasses {
  return COLOR_CLASSES[colorTokenFor(event, calendars)]
}

/* ------------------------------------------------------------------------- *
 * shared-calendars-v1 §3 — legend hidden-set seed + filtering
 * ------------------------------------------------------------------------- */

/**
 * The initial set of HIDDEN calendar ids (shared-calendars-v1, FR-010): a calendar whose
 * Google `selected` preference is explicitly `false` starts hidden, so the panel mirrors
 * the user's own Google show/hide choices on first paint. A calendar with `selected`
 * absent/true starts shown. The set is renderer-only + ephemeral (no session persistence).
 * Pure/node-testable — a non-array yields an empty set.
 */
export function seedHiddenCalendarIds(calendars: CalendarLegendData[] | undefined): Set<string> {
  const hidden = new Set<string>()
  for (const c of Array.isArray(calendars) ? calendars : []) {
    if (c && typeof c.id === 'string' && c.selected === false) {
      hidden.add(c.id)
    }
  }
  return hidden
}

/* ------------------------------------------------------------------------- *
 * Timed vs all-day + label formatting (FR-016)
 * ------------------------------------------------------------------------- */

/**
 * Whether an event is all-day. Prefers the explicit `allDay` flag (the builder sets it
 * from Google's `date` vs `dateTime`); falls back to a date-only `start` heuristic
 * (`YYYY-MM-DD`, no `T`) when the flag is absent (a partial node). Pure.
 */
export function isAllDay(event: EventChipData): boolean {
  if (typeof event.allDay === 'boolean') {
    return event.allDay
  }
  return typeof event.start === 'string' && !event.start.includes('T')
}

/**
 * A short, locale-aware start time for a TIMED event's chip prefix (e.g. `9:30`), or
 * '' for an all-day event / an unparseable start (the chip then shows only the title).
 * Best-effort: an invalid date yields '' rather than throwing. Pure beyond `Intl`.
 */
export function eventTimeLabel(event: EventChipData): string {
  if (isAllDay(event) || typeof event.start !== 'string') {
    return ''
  }
  const date = new Date(event.start)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** The displayed title — a blank/absent summary degrades to `(no title)` (never empty). */
export function eventTitle(event: EventChipData): string {
  return event.summary && event.summary.trim().length > 0 ? event.summary : '(no title)'
}

/* ------------------------------------------------------------------------- *
 * §1.1 — month grid: derive the month window + bucket events into day cells
 * ------------------------------------------------------------------------- */

/** A single day cell of the month grid (design §1.1). */
export interface DayCellData {
  /** ISO `YYYY-MM-DD` key (local). */
  dateKey: string
  /** Day-of-month number as a string, e.g. `16`. */
  dateLabel: string
  /** True for a day in the grid's target month; false for leading/trailing spillover. */
  inMonth: boolean
  /** True for today (matches `todayKey`). */
  isToday: boolean
  /** The events that fall on this day, in input order. */
  events: EventChipData[]
}

/** The composed month grid: weekday header labels + the 28–42 day cells. */
export interface MonthGrid {
  /** The month label, e.g. `June 2026`. */
  monthLabel: string
  /** 7 weekday header labels, ordered per `weekStart`. */
  weekdayLabels: string[]
  /** The day cells (a whole number of weeks: 28/35/42), row-major from `weekStart`. */
  cells: DayCellData[]
  /** ISO `YYYY-MM-DD` of today (local), for the today indicator + aria. */
  todayKey: string
}

const WEEKDAY_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

/** Pad a 1–2 digit number to a 2-char string (for ISO date keys). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** The local ISO `YYYY-MM-DD` key for a Date (no time, no UTC shift). */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * Derive the target month (year + 0-based month) from the surface's `timeMin` window.
 * The builder composes the default view over a window starting at the period's first
 * instant, so its month is the grid's month. An unparseable/absent `timeMin` falls
 * back to the supplied `now` (today's month) so the grid always renders (FR-017). Pure.
 */
export function monthFromWindow(
  timeMin: string | undefined,
  now: Date
): { year: number; month: number } {
  if (typeof timeMin === 'string') {
    const d = new Date(timeMin)
    if (!Number.isNaN(d.getTime())) {
      return { year: d.getFullYear(), month: d.getMonth() }
    }
  }
  return { year: now.getFullYear(), month: now.getMonth() }
}

/**
 * The local day key an event belongs to. A timed event uses its `start` instant's
 * local date; an all-day event uses its date-only `start` verbatim (no TZ shift —
 * `new Date('2026-06-17')` would shift to UTC midnight). An unparseable start yields
 * '' (the event drops out of the grid rather than crashing). Pure.
 */
export function eventDayKey(event: EventChipData): string {
  if (typeof event.start !== 'string' || event.start.trim().length === 0) {
    return ''
  }
  if (isAllDay(event)) {
    // Date-only form `YYYY-MM-DD`: take the leading 10 chars verbatim (no TZ shift). An
    // unparseable date-only-ish start (no `T`, but not a real `YYYY-MM-DD`) drops out as ''
    // rather than bucketing onto a garbage key.
    const head = event.start.slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : ''
  }
  const d = new Date(event.start)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return localDateKey(d)
}

/**
 * Compose the month grid (design §1.1): the weekday header + a whole number of weeks of
 * day cells covering the target month (leading/trailing spillover days fill the first/last
 * weeks), each cell carrying the events bucketed onto its local day. `weekStart` defaults
 * to Sunday (GCal US default, design OQ2). Deterministic + pure (takes `now` for today).
 *
 * Malformed events (unparseable start) are skipped, not thrown (FR-017 — never a broken
 * panel). An empty `events` array yields a fully-populated empty grid (the empty state).
 *
 * shared-calendars-v1 (FR-010/FR-011): when `hiddenCalendarIds` is supplied, an event whose
 * `calendarId` is in that set is filtered OUT of the grid (the legend toggle hides a
 * calendar's events). The single-primary path passes neither arg (no-op filter).
 */
export function buildMonthGrid(
  events: EventChipData[],
  timeMin: string | undefined,
  now: Date,
  weekStart: 'sunday' | 'monday' = 'sunday',
  hiddenCalendarIds?: Set<string>
): MonthGrid {
  const { year, month } = monthFromWindow(timeMin, now)
  const todayKey = localDateKey(now)
  const hidden = hiddenCalendarIds instanceof Set ? hiddenCalendarIds : undefined

  // Bucket events by local day key once (design §1.1 — bucketing is pure here).
  const byDay = new Map<string, EventChipData[]>()
  for (const ev of Array.isArray(events) ? events : []) {
    // shared-calendars-v1 (FR-011): drop events owned by a hidden calendar.
    if (hidden && typeof ev.calendarId === 'string' && hidden.has(ev.calendarId)) {
      continue
    }
    const key = eventDayKey(ev)
    if (key.length === 0) {
      continue
    }
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.push(ev)
    } else {
      byDay.set(key, [ev])
    }
  }

  const firstOfMonth = new Date(year, month, 1)
  // The grid's first cell: back up to the week start (Sunday=0 / Monday=1).
  const startDow = weekStart === 'monday' ? (firstOfMonth.getDay() + 6) % 7 : firstOfMonth.getDay()
  const gridStart = new Date(year, month, 1 - startDow)

  // Number of cells: whole weeks covering the month (last-of-month + trailing pad).
  const lastOfMonth = new Date(year, month + 1, 0)
  const endDow =
    weekStart === 'monday' ? (lastOfMonth.getDay() + 6) % 7 : lastOfMonth.getDay()
  const totalCells = startDow + lastOfMonth.getDate() + (6 - endDow)

  const cells: DayCellData[] = []
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    const dateKey = localDateKey(d)
    cells.push({
      dateKey,
      dateLabel: `${d.getDate()}`,
      inMonth: d.getMonth() === month,
      isToday: dateKey === todayKey,
      events: byDay.get(dateKey) ?? []
    })
  }

  const weekdayLabels =
    weekStart === 'monday'
      ? [...WEEKDAY_SUNDAY.slice(1), WEEKDAY_SUNDAY[0]]
      : WEEKDAY_SUNDAY

  return {
    monthLabel: `${MONTH_NAMES[month]} ${year}`,
    weekdayLabels,
    cells,
    todayKey
  }
}

/* ------------------------------------------------------------------------- *
 * §1.1 — per-cell event capping + overflow
 * ------------------------------------------------------------------------- */

/** The capped chips to render in a cell + the hidden overflow count (design §1.1). */
export interface CellEventDisplay {
  /** The first `max` events to render as chips. */
  shown: EventChipData[]
  /** How many events are hidden (the `+N more` indication); 0 when all are shown. */
  overflowCount: number
}

/**
 * Cap a cell's events to `max` (default 3, design §1.1) and report the overflow count
 * for the `+N more` indication. A non-array degrades to empty/zero. Pure.
 */
export function cellEventDisplay(events: EventChipData[], max = 3): CellEventDisplay {
  const list = Array.isArray(events) ? events : []
  if (list.length <= max) {
    return { shown: list, overflowCount: 0 }
  }
  return { shown: list.slice(0, max), overflowCount: list.length - max }
}

/* ------------------------------------------------------------------------- *
 * §6 — DayCell aria-label (the cell's full day for a screen reader)
 * ------------------------------------------------------------------------- */

const FULL_WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]

/**
 * Compose a DayCell's `aria-label` (design §6) so a screen-reader user hears the whole
 * day without the truncated visual chips, e.g.
 *   `Monday June 16, today, 2 events: Standup 9:30 AM, Lunch all day`.
 * Out-of-month spillover days say `(other month)`; an empty day says `no events`.
 * Best-effort: an unparseable dateKey still yields a usable label. Pure beyond `Intl`.
 */
export function dayCellAriaLabel(cell: DayCellData): string {
  // Derive a readable date prefix from the ISO key (local; avoid a UTC shift).
  let datePrefix = cell.dateLabel
  const parts = cell.dateKey.split('-')
  if (parts.length === 3) {
    const y = Number(parts[0])
    const m = Number(parts[1])
    const day = Number(parts[2])
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) {
      const d = new Date(y, m - 1, day)
      if (!Number.isNaN(d.getTime())) {
        datePrefix = `${FULL_WEEKDAYS[d.getDay()]} ${MONTH_NAMES[m - 1]} ${day}`
      }
    }
  }

  const segments: string[] = [datePrefix]
  if (cell.isToday) {
    segments.push('today')
  }
  if (!cell.inMonth) {
    segments.push('other month')
  }

  const events = Array.isArray(cell.events) ? cell.events : []
  if (events.length === 0) {
    segments.push('no events')
    return segments.join(', ')
  }

  const noun = events.length === 1 ? 'event' : 'events'
  const list = events
    .map((ev) => {
      const time = isAllDay(ev) ? 'all day' : eventTimeLabel(ev)
      return time ? `${eventTitle(ev)} ${time}` : eventTitle(ev)
    })
    .join(', ')
  segments.push(`${events.length} ${noun}: ${list}`)
  return segments.join(', ')
}
