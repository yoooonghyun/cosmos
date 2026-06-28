/**
 * googleCalendarCatalog/eventDetailLogic — pure, DOM-free derivations for the Google
 * Calendar event-detail dock (calendar-event-detail-v1). Split out of the native
 * `EventDetail` component (a `.tsx`) so every display DECISION — the time/range
 * formatting (timed vs all-day, multi-day, Google's exclusive all-day end correction),
 * the recurring-instance label, the attendee-list normalization, the "(no title)" /
 * "No description" / omit-if-absent rules — is unit-testable under the node-only vitest
 * config. The component is a thin shell over these functions.
 *
 * NO React, NO DOM, NO secrets. Inputs are the non-secret event prop shape the surface
 * already carries onto each `EventList` event (`EventChipData`); outputs are plain
 * strings / booleans / normalized value objects. Pure beyond `Intl` (locale formatting).
 *
 * Spec trace: FR-004 (title degrade), FR-005 (timed/all-day, multi-day, locale),
 * FR-006/007/008 (omit-if-absent + "No description"), FR-010 (external link),
 * FR-011 (recurring instance). Edge case: all-day exclusive end → inclusive human range.
 *
 * The `CALENDAR_OPEN_DETAIL_ACTION` constant lives here (mirroring
 * `CONFLUENCE_OPEN_DETAIL_ACTION` in `confluenceCatalog/logic.ts`): a renderer-local nav
 * signal the `GoogleCalendarPanel` `onAction` seam intercepts and handles locally —
 * deliberately NOT a `googleCalendar.*` name, so it is never forwarded to main/agent.
 */

import { eventTitle, isAllDay, type EventAttendeeData, type EventChipData } from './logic'

/* ------------------------------------------------------------------------- *
 * Renderer-local open-detail nav action (FR-001)
 * ------------------------------------------------------------------------- */

/**
 * The renderer-local nav action a clicked `EventChip` emits to open its event's detail in
 * the right-side dock (FR-001/FR-002). Deliberately NOT a `googleCalendar.*`-prefixed name
 * — it is a navigation signal the `GoogleCalendarPanel` `onAction` seam intercepts and
 * handles renderer-locally (returns `true`), NEVER forwarded to main or the agent. Mirrors
 * `CONFLUENCE_OPEN_DETAIL_ACTION` / the Jira `jiraNav.openDetail` seam.
 */
export const CALENDAR_OPEN_DETAIL_ACTION = 'calendarNav.openDetail'

/**
 * Whether a chip's `id` is a real event id worth emitting an open-detail action for. True
 * only for a non-empty, non-whitespace string; a chip with no/empty id stays INERT (no
 * button, no action). Total — never throws.
 */
export function isOpenDetailEmittable(id: string | undefined): boolean {
  return typeof id === 'string' && id.trim() !== ''
}

/* ------------------------------------------------------------------------- *
 * Title (FR-004) — re-exported so the dock + chip share one degrade rule
 * ------------------------------------------------------------------------- */

/** The displayed detail title — a blank/absent summary degrades to `(no title)` (FR-004). */
export function detailTitle(event: EventChipData): string {
  return eventTitle(event)
}

/* ------------------------------------------------------------------------- *
 * Time / date range (FR-005) + all-day exclusive-end correction (edge case)
 * ------------------------------------------------------------------------- */

/** The kind of `when` label the dock renders, so the component can branch without re-deriving. */
export type EventWhenKind =
  | 'timed-same-day'
  | 'timed-multi-day'
  | 'all-day-single'
  | 'all-day-multi-day'
  | 'unknown'

/**
 * The fully-derived "When" value for the detail dock (FR-005). `allDay` flags whether the
 * dock shows the "All day" pill (and suppresses clock times). `primary` is the single-line
 * label for same-day / single-day cases; `startLabel`/`endLabel` are the two-line labels for
 * multi-day cases. An unparseable/absent time degrades to `kind: 'unknown'` with a best-effort
 * `primary` (the raw start) rather than throwing (FR-016).
 */
export interface EventWhen {
  kind: EventWhenKind
  allDay: boolean
  /** Single-line label (same-day timed / single all-day / unknown fallback). */
  primary: string
  /** Multi-day start label (e.g. `Starts Sat, Jun 20, 2026 · 9:30 AM`). */
  startLabel?: string
  /** Multi-day end label (e.g. `Ends Sun, Jun 21, 2026 · 10:00 AM`). */
  endLabel?: string
}

/** A weekday + date, e.g. `Sat, Jun 20, 2026`, in the viewer's locale. */
function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

/** A short clock time, e.g. `9:30 AM`, in the viewer's locale. */
function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Parse a date-only `YYYY-MM-DD` to a LOCAL Date (no UTC shift). Returns null when invalid. */
function parseDateOnly(value: string | undefined): Date | null {
  if (typeof value !== 'string') {
    return null
  }
  const head = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    return null
  }
  const [y, m, d] = head.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Parse an RFC-3339 instant to a Date. Returns null when absent/invalid. */
function parseInstant(value: string | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Derive the detail dock's "When" value (FR-005). Handles four cases plus a safe unknown:
 *
 *  - Timed same-day  → `Sat, Jun 20, 2026 · 9:30 – 10:00 AM` (one line).
 *  - Timed multi-day → two lines: `Starts …` / `Ends …` with date+time each.
 *  - All-day single  → `Sat, Jun 20, 2026` + the all-day pill (no clock).
 *  - All-day range   → inclusive `Sat, Jun 20 – Mon, Jun 22, 2026`, correcting Google's
 *    EXCLUSIVE end date (subtract one day) so a 3-day event shows its real last day.
 *
 * Total: an unparseable/absent start degrades to `kind:'unknown'` with the raw start as
 * `primary` (never throws). Pure beyond `Intl`.
 */
export function eventWhen(event: EventChipData): EventWhen {
  const allDay = isAllDay(event)
  if (allDay) {
    const start = parseDateOnly(event.start)
    if (!start) {
      return { kind: 'unknown', allDay: true, primary: typeof event.start === 'string' ? event.start : '' }
    }
    // Google's all-day `end` is the EXCLUSIVE next day. The inclusive last day is end - 1.
    const endExclusive = parseDateOnly(event.end)
    const lastDay = endExclusive ? new Date(endExclusive.getTime() - 86_400_000) : null
    // Single-day when there is no end, or the inclusive last day equals the start day.
    if (!lastDay || lastDay.getTime() <= start.getTime()) {
      return { kind: 'all-day-single', allDay: true, primary: formatDate(start) }
    }
    return {
      kind: 'all-day-multi-day',
      allDay: true,
      primary: `${formatDate(start)} – ${formatDate(lastDay)}`
    }
  }

  const start = parseInstant(event.start)
  if (!start) {
    return { kind: 'unknown', allDay: false, primary: typeof event.start === 'string' ? event.start : '' }
  }
  const end = parseInstant(event.end)
  if (!end) {
    // Timed with no/invalid end: show just the start date+time.
    return { kind: 'timed-same-day', allDay: false, primary: `${formatDate(start)} · ${formatTime(start)}` }
  }
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  if (sameDay) {
    return {
      kind: 'timed-same-day',
      allDay: false,
      primary: `${formatDate(start)} · ${formatTime(start)} – ${formatTime(end)}`
    }
  }
  return {
    kind: 'timed-multi-day',
    allDay: false,
    primary: `${formatDate(start)} · ${formatTime(start)} – ${formatDate(end)} · ${formatTime(end)}`,
    startLabel: `Starts ${formatDate(start)} · ${formatTime(start)}`,
    endLabel: `Ends ${formatDate(end)} · ${formatTime(end)}`
  }
}

/* ------------------------------------------------------------------------- *
 * Location (FR-006) / Description (FR-007) — omit-if-absent decisions
 * ------------------------------------------------------------------------- */

/** Whether the location row should render (FR-006): true only for a non-blank string. */
export function hasLocation(event: EventChipData): boolean {
  return typeof event.location === 'string' && event.location.trim() !== ''
}

/**
 * The description text to show, or null to omit the value (FR-007). A blank/absent
 * description returns null so the dock shows the calm "No description" placeholder. Plain
 * text only — the value is returned verbatim (no HTML interpretation).
 */
export function descriptionText(event: EventChipData): string | null {
  return typeof event.description === 'string' && event.description.trim() !== ''
    ? event.description
    : null
}

/** The calm placeholder shown when a description is absent (FR-007). */
export const NO_DESCRIPTION_LABEL = 'No description'

/* ------------------------------------------------------------------------- *
 * Attendees (FR-008) — normalize into displayable rows, omit when absent
 * ------------------------------------------------------------------------- */

/** A normalized attendee row for the dock: a display label + optional markers. */
export interface AttendeeDisplay {
  /** The best display label: name, else email, else `(unknown)`. */
  label: string
  self?: boolean
  organizer?: boolean
  responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

/**
 * Normalize an event's attendees into displayable rows (FR-008). Prefers a display name,
 * falls back to the email, then `(unknown)` for a nameless/emailless entry — so a partial
 * attendee still renders rather than throwing. A non-array / absent list yields `[]` (the
 * dock omits the whole attendees section). Pure.
 */
export function attendeeList(event: EventChipData): AttendeeDisplay[] {
  const raw: EventAttendeeData[] = Array.isArray(event.attendees) ? event.attendees : []
  return raw.map((a) => {
    const name = typeof a.displayName === 'string' && a.displayName.trim() !== '' ? a.displayName.trim() : ''
    const email = typeof a.email === 'string' && a.email.trim() !== '' ? a.email.trim() : ''
    const label = name || email || '(unknown)'
    return {
      label,
      ...(a.self === true ? { self: true } : {}),
      ...(a.organizer === true ? { organizer: true } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {})
    }
  })
}

/** Whether the attendees section should render (FR-008): true only for ≥1 attendee. */
export function hasAttendees(event: EventChipData): boolean {
  return attendeeList(event).length > 0
}

/* ------------------------------------------------------------------------- *
 * External link (FR-010) — open in Google Calendar, omit when absent
 * ------------------------------------------------------------------------- */

/**
 * The non-secret "open in Google Calendar" URL, or null to omit the link (FR-010). Returns
 * the `htmlLink` only when it is a non-blank `http(s)` URL — a guard against a non-URL /
 * non-public value reaching an anchor. Never constructs a guessed URL. Pure.
 */
export function openInGoogleUrl(event: EventChipData): string | null {
  const url = typeof event.htmlLink === 'string' ? event.htmlLink.trim() : ''
  return /^https?:\/\//i.test(url) ? url : null
}

/* ------------------------------------------------------------------------- *
 * Recurring instance (FR-011)
 * ------------------------------------------------------------------------- */

/** Whether to show the "part of a series" marker (FR-011): true only when explicitly recurring. */
export function isRecurringInstance(event: EventChipData): boolean {
  return event.recurring === true
}

/** The recurring-series indicator label (FR-011). */
export const RECURRING_LABEL = 'Part of a series'
