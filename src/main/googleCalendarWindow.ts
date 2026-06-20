/**
 * googleCalendarWindow — pure, node-testable window math for the Google Calendar default
 * view (calendar-month-year-nav-v1 + calendar-week-day-views-v1). Extracted from
 * `src/main/index.ts` (which imports Electron, so its inline math was not test-reachable)
 * into a plain `.ts` so the month / week / day window construction is unit-tested under the
 * node-only vitest config.
 *
 * NO Electron, NO IPC, NO secrets. Inputs are the validated non-secret default-view anchor
 * (`{ year, month, day }`, 1-based on the wire) + the granularity; the output is a pair of
 * RFC-3339 instants (`{ timeMin, timeMax }`) the events read fans out over.
 *
 * The wire is 1-based (`month` 1 = January … 12 = December; `day` 1..31). This module owns
 * the SINGLE 1→0 conversion when constructing the `Date`s (`new Date(year, month - 1, …)`),
 * symmetric with the current-anchor path's 0-based `now.getMonth()`/`now.getDate()`. Built
 * with LOCAL `new Date(...)` so there is NO UTC shift on the period boundary and DST-long
 * (23h/25h) days derive their bounds from the actual local midnight-to-midnight span rather
 * than a hardcoded 24h offset.
 */

import type { GoogleCalendarDefaultView } from '../shared/ipc'

/** A resolved RFC-3339 read window (the events fan-out's `timeMin`/`timeMax`). */
export interface GoogleCalendarWindow {
  /** Inclusive lower bound (RFC-3339). */
  timeMin: string
  /** Exclusive upper bound (RFC-3339). */
  timeMax: string
}

/**
 * The optional default-view anchor (1-based wire). `year`+`month` are the month anchor
 * (calendar-month-year-nav-v1); `day` (calendar-week-day-views-v1) is the day-of-month the
 * week/day window anchors on. Absent fields fall back to "now" components inside the
 * builder. `view` selects the granularity; absent ⇒ `'month'`.
 */
export interface GoogleCalendarDefaultViewAnchor {
  /** 4-digit year. Absent ⇒ now's year. */
  year?: number
  /** 1-based month (1 = January … 12 = December). Absent ⇒ now's month. */
  month?: number
  /** 1-based day-of-month (1..31). Absent ⇒ day 1 (month/week anchor needs no day). */
  day?: number
  /** Granularity; absent ⇒ `'month'`. */
  view?: GoogleCalendarDefaultView
}

/**
 * Build the default-view window for the requested granularity, anchored on the supplied
 * `{ year, month, day }` (1-based) or, when absent, on `now`. Week-start follows the month
 * grid's convention (SUNDAY, calendar-week-day-views-v1 — week-start OQ resolved).
 *
 *  - `'month'` (default / absent / unknown view): the whole anchored month — `[first instant
 *    of the month, first instant of the next month)`. Exactly the original behavior; an
 *    absent anchor ⇒ the current month, byte-for-byte as before.
 *  - `'week'`: the 7-day span of the Sunday-started week CONTAINING the anchor day —
 *    `[Sunday 00:00 local, the next Sunday 00:00 local)`.
 *  - `'day'`: the single anchor day — `[that day 00:00 local, the next day 00:00 local)`.
 *
 * Pure + deterministic given `now`; LOCAL Dates avoid a UTC boundary shift.
 */
export function googleCalendarDefaultWindow(
  anchor?: GoogleCalendarDefaultViewAnchor,
  now: Date = new Date()
): GoogleCalendarWindow {
  const view: GoogleCalendarDefaultView = anchor?.view ?? 'month'
  const year = anchor?.year ?? now.getFullYear()
  // Wire is 1-based; JS Date is 0-based — subtract 1 here and ONLY here.
  const month0 = anchor?.month !== undefined ? anchor.month - 1 : now.getMonth()

  if (view === 'month') {
    return {
      timeMin: new Date(year, month0, 1).toISOString(),
      timeMax: new Date(year, month0 + 1, 1).toISOString()
    }
  }

  // Week/Day anchor on a concrete day-of-month. Absent ⇒ day 1 (so a bare `{ view: 'week' }`
  // anchors on the month's first week); the day-1 default is harmless for month, which never
  // reaches here. Date carry normalizes an out-of-range day (e.g. day 31 in a 30-day month).
  const day = anchor?.day ?? 1
  const anchorDay = new Date(year, month0, day)

  if (view === 'day') {
    return {
      timeMin: new Date(year, month0, day).toISOString(),
      timeMax: new Date(year, month0, day + 1).toISOString()
    }
  }

  // view === 'week': back up to Sunday (getDay() 0 = Sunday), span 7 whole days. Using the
  // normalized anchorDay's components keeps the carry correct across month/year boundaries.
  const dow = anchorDay.getDay() // 0 = Sunday
  const weekStart = new Date(
    anchorDay.getFullYear(),
    anchorDay.getMonth(),
    anchorDay.getDate() - dow
  )
  return {
    timeMin: weekStart.toISOString(),
    timeMax: new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + 7
    ).toISOString()
  }
}
