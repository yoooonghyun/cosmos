/**
 * calendarNavLogic — pure month/year navigation arithmetic for the Google Calendar
 * default-view nav cluster (calendar-month-year-nav-v1). No React, no IPC: just the
 * displayed-month INTENT primitives the panel drives and the catalog tests cover.
 *
 * The intent is a `{ year, month }` pair with a **0-based** `month` (JS-native, matching
 * `monthFromWindow`/`Date#getMonth`). The 0-based↔1-based conversion lives ONLY in
 * `toWirePayload` (the wire is 1-based, FR-008) so the convention never leaks elsewhere.
 */

import type {
  GoogleCalendarDefaultView,
  GoogleCalendarRequestDefaultViewPayload
} from '../shared/ipc'
import { monthFromWindow } from './googleCalendarCatalog/logic'

/** The renderer-side displayed-month intent. `month` is 0-based (0 = January). */
export interface CalendarMonthIntent {
  year: number
  /** 0-based month: 0 = January … 11 = December (JS-native). */
  month: number
}

/**
 * The renderer-side day anchor for the Week/Day views (calendar-week-day-views-v1). A full
 * `{ year, month, day }` (month 0-based, JS-native; day 1-based, JS-native `Date#getDate`).
 * Week view shows the Sunday-started week CONTAINING this day; Day view shows this exact day.
 */
export interface CalendarDayAnchor {
  year: number
  /** 0-based month: 0 = January … 11 = December (JS-native). */
  month: number
  /** 1-based day-of-month (1..31), JS-native `Date#getDate`. */
  day: number
}

/**
 * The active per-tab view selection (calendar-week-day-views-v1, FR-003). The chosen
 * granularity plus its anchor (a month for `'month'`, a day for `'week'`/`'day'`). Ephemeral
 * renderer-only state, mirroring the month-only `CalendarMonthIntent` it generalizes.
 */
export type CalendarViewIntent =
  | { view: 'month'; anchor: CalendarMonthIntent }
  | { view: 'week' | 'day'; anchor: CalendarDayAnchor }

/**
 * Step the intent by `delta` whole months, carrying across year boundaries (FR-002):
 * Dec (11) → next Jan (0, year+1); Jan (0) → prev Dec (11, year-1). Uses `Date` carry
 * arithmetic so any month delta normalizes correctly.
 */
export function stepMonth(intent: CalendarMonthIntent, delta: number): CalendarMonthIntent {
  const d = new Date(intent.year, intent.month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/**
 * Step the intent by `delta` whole years, PRESERVING the month number (FR-003). Only the
 * year changes; the month is unchanged (the `Date` carry is a no-op for a pure year shift).
 */
export function stepYear(intent: CalendarMonthIntent, delta: number): CalendarMonthIntent {
  return { year: intent.year + delta, month: intent.month }
}

/** The current month as an intent (FR-004) — the same month a fresh tab loads. */
export function currentMonth(now: Date): CalendarMonthIntent {
  return { year: now.getFullYear(), month: now.getMonth() }
}

/**
 * True when `intent` is already the current month (FR-005). The panel uses this to make
 * "Today" a no-op / disabled when there is nothing to navigate back to.
 */
export function isCurrentMonth(intent: CalendarMonthIntent, now: Date): boolean {
  return intent.year === now.getFullYear() && intent.month === now.getMonth()
}

/**
 * Convert a 0-based intent to the 1-based `{ year, month }` wire payload main expects
 * (FR-008). This is the SINGLE place the 0→1 conversion happens; main subtracts 1 again
 * when constructing the Date. e.g. January (month 0) → `{ month: 1 }`.
 */
export function toWirePayload(intent: CalendarMonthIntent): GoogleCalendarRequestDefaultViewPayload {
  return { year: intent.year, month: intent.month + 1 }
}

/**
 * Latest-wins stale-read gate (FR-014). A navigated read can resolve out of order; the
 * surface that landed carries its own month in `timeMin`. Accept a landed surface ONLY
 * when its `timeMin` month matches the active tab's current intent; a surface for an
 * OLDER (now-superseded) intent is rejected as stale so it never paints over a newer
 * navigation. Reuses `monthFromWindow` so the month derivation matches the grid exactly
 * (an absent/unparseable `timeMin` falls back to `now` ⇒ the current month).
 */
export function isSurfaceForIntent(
  timeMin: string | undefined,
  intent: CalendarMonthIntent,
  now: Date
): boolean {
  const surfaceMonth = monthFromWindow(timeMin, now)
  return surfaceMonth.year === intent.year && surfaceMonth.month === intent.month
}

/**
 * How the default-view loading state should paint, so a DATE CHANGE never blanks the legend +
 * range-nav header (calendar-date-change-keeps-chrome). The full-surface skeleton replaces the
 * WHOLE EventList — including the legend (CalendarLegend) and the date/nav header
 * (CalendarRangeNav), both rendered INSIDE the surface — so on every month/week/day step the
 * legend + header flash away and the panel feels slow.
 *
 *  - `'full'`   — INITIAL read with NO prior surface (first connect / fresh tab): show the
 *                 shape-matched skeleton fully; there is no chrome to preserve yet.
 *  - `'keep'`   — a date-change REFETCH while a surface already exists: keep the existing
 *                 surface mounted (its legend + range-nav header stay on screen, instant-feeling)
 *                 and let the new frame swap the grid in place — no skeleton flash.
 *  - `'none'`   — not loading a default view; render the surface normally.
 *
 * Pure/node-testable — the panel maps the result to the render branch.
 */
export type CalendarLoadingScope = 'full' | 'keep' | 'none'

export function calendarLoadingScope(
  loadingDefault: boolean | undefined,
  hasSurface: boolean
): CalendarLoadingScope {
  if (!loadingDefault) {
    return 'none'
  }
  // A surface already on screen ⇒ this is a date-change refetch: keep the chrome, no skeleton.
  return hasSurface ? 'keep' : 'full'
}

/**
 * Which GRID skeleton matches a view's real layout (calendar-date-change-keeps-chrome):
 *
 *  - `'month'` → `'month-grid'`: the 7-column month-cell skeleton (mirrors `CalendarMonthGrid`).
 *  - `'week'`  → `'schedule-7'`: a time-axis + 7 day-column schedule skeleton.
 *  - `'day'`   → `'schedule-1'`: a time-axis + a single day-column schedule skeleton.
 *
 * Used both for the INITIAL full skeleton and the date-change `'keep'` grid skeleton so each
 * view's loading shape always matches the grid it is replacing. Pure/node-testable; the panel +
 * catalog map the kind to the concrete skeleton component.
 */
export type CalendarSkeletonKind = 'month-grid' | 'schedule-7' | 'schedule-1'

export function skeletonForView(view: 'month' | 'week' | 'day'): CalendarSkeletonKind {
  switch (view) {
    case 'month':
      return 'month-grid'
    case 'week':
      return 'schedule-7'
    case 'day':
      return 'schedule-1'
  }
}

/* ------------------------------------------------------------------------- *
 * Week/Day anchor arithmetic (calendar-week-day-views-v1)
 * ------------------------------------------------------------------------- */

/** Today as a day anchor (FR-004/FR-005) — the day a fresh Week/Day view defaults to. */
export function currentDay(now: Date): CalendarDayAnchor {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
}

/**
 * Step a day anchor by `delta` WHOLE days, carrying across month/year boundaries
 * (calendar-week-day-views-v1, FR-010 day-nav). Uses `Date` carry so any day delta
 * normalizes. Day view steps ±1.
 */
export function stepDay(anchor: CalendarDayAnchor, delta: number): CalendarDayAnchor {
  const d = new Date(anchor.year, anchor.month, anchor.day + delta)
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
}

/**
 * Step a day anchor by `delta` whole WEEKS (±7 days), carrying across boundaries
 * (calendar-week-day-views-v1, FR-009 week-nav). The anchor stays the same weekday so the
 * visible Sunday-started week shifts by exactly one week.
 */
export function stepWeek(anchor: CalendarDayAnchor, delta: number): CalendarDayAnchor {
  return stepDay(anchor, delta * 7)
}

/** True when `anchor` is today (FR-010 no-op gate for Day view's "Today"). */
export function isCurrentDay(anchor: CalendarDayAnchor, now: Date): boolean {
  return (
    anchor.year === now.getFullYear() &&
    anchor.month === now.getMonth() &&
    anchor.day === now.getDate()
  )
}

/**
 * True when `anchor` falls in the SAME Sunday-started week as today (FR-009 no-op gate for
 * Week view's "Today"). Compares the two anchors' week-start (Sunday) local dates.
 */
export function isCurrentWeek(anchor: CalendarDayAnchor, now: Date): boolean {
  return sundayKey(anchor.year, anchor.month, anchor.day) === sundayKey(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const WEEKDAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]

/** The canonical month label, e.g. `June 2026` (calendar-month-year-nav-v1). */
export function monthLabel(intent: CalendarMonthIntent): string {
  return `${MONTH_NAMES[intent.month]} ${intent.year}`
}

/**
 * The Day-view label, e.g. `Thursday, June 18, 2026` (calendar-week-day-views-v1). The full
 * weekday + date so the single-day header reads unambiguously.
 */
export function dayLabel(anchor: CalendarDayAnchor): string {
  const d = new Date(anchor.year, anchor.month, anchor.day)
  return `${WEEKDAY_FULL[d.getDay()]}, ${MONTH_NAMES[anchor.month]} ${anchor.day}, ${anchor.year}`
}

/**
 * The Week-view label for the Sunday-started week CONTAINING the anchor, e.g.
 * `June 14 – 20, 2026` or, across a month/year boundary, `June 28 – July 4, 2026` /
 * `Dec 28, 2026 – Jan 3, 2027` (calendar-week-day-views-v1). Compact: the shared
 * month/year is shown once.
 */
export function weekRangeLabel(anchor: CalendarDayAnchor): string {
  const anchorDate = new Date(anchor.year, anchor.month, anchor.day)
  const start = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    anchorDate.getDate() - anchorDate.getDay()
  )
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`
  }
  if (sameYear) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`
  }
  return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
}

/** The local `YYYY-MM-DD` of the Sunday that starts the week containing the given day. */
function sundayKey(year: number, month: number, day: number): string {
  const d = new Date(year, month, day)
  const sunday = new Date(year, month, day - d.getDay())
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`
}

/**
 * Convert a {@link CalendarViewIntent} to the wire payload main expects
 * (calendar-week-day-views-v1, FR-012). Month is the existing `{ year, month }` (1-based)
 * with NO `view`/`day` so the back-compat month path is byte-for-byte unchanged. Week/Day
 * carry `view` + the 1-based `{ year, month, day }` anchor. This is the SINGLE place the
 * 0-based-month→1-based conversion happens for the view payloads.
 */
export function viewToWirePayload(
  intent: CalendarViewIntent
): GoogleCalendarRequestDefaultViewPayload {
  if (intent.view === 'month') {
    return toWirePayload(intent.anchor)
  }
  return {
    view: intent.view satisfies GoogleCalendarDefaultView,
    year: intent.anchor.year,
    month: intent.anchor.month + 1,
    day: intent.anchor.day
  }
}
