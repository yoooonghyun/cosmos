/**
 * Google Calendar — IPC payload + bridge-frame validators.
 * Spec: .sdd/specs/google-calendar-v1.md. Re-exported (unchanged) through the
 * `src/shared/validate.ts` barrel.
 *
 * Every inbound Google Calendar IPC payload + MCP bridge frame is validated here;
 * an invalid/malformed payload is warned and returned null/structured-error so the
 * handler IGNORES it — never crashes. Read-only (v1). Carries NO token.
 */

import type {
  GoogleCalendarListEventsParams,
  GoogleCalendarOpName
} from '../googleCalendar'
import type { GoogleCalendarRequestDefaultViewPayload } from './googleCalendar'
import { GoogleCalendarOp } from '../googleCalendar'
import {
  defaultWarn,
  isNonEmptyString,
  isObject,
  optionalCursorOk,
  type WarnFn
} from './common.validate'

/**
 * Validate a `googleCalendar:listEvents` params payload. Required: `timeMin` and
 * `timeMax` are non-empty strings (RFC-3339 instants composed by main's surface
 * builder; the renderer relays them on pagination). Optional: `cursor` string. A
 * non-object, a missing/empty bound, or a non-string `cursor` is warned and ignored.
 */
export function validateGoogleCalendarListEvents(
  raw: unknown,
  warn: WarnFn = defaultWarn
): GoogleCalendarListEventsParams | null {
  if (!isObject(raw)) {
    warn('[googleCalendar] ignoring googleCalendar:listEvents — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.timeMin)) {
    warn('[googleCalendar] ignoring googleCalendar:listEvents — required "timeMin" must be a non-empty string:', raw)
    return null
  }
  if (!isNonEmptyString(raw.timeMax)) {
    warn('[googleCalendar] ignoring googleCalendar:listEvents — required "timeMax" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[googleCalendar] ignoring googleCalendar:listEvents — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    timeMin: raw.timeMin,
    timeMax: raw.timeMax,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/** A finite integer within [min, max] inclusive. */
function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** The valid default-view granularities (calendar-week-day-views-v1, FR-012). */
const DEFAULT_VIEWS = new Set<string>(['month', 'week', 'day'])

/**
 * Validate a `googleCalendar:requestDefaultView` payload (calendar-month-year-nav-v1 FR-009
 * + calendar-week-day-views-v1 FR-012). The default view's target anchor + granularity are
 * all OPTIONAL — the panel sends `{}` for the current month (month view), `{ year, month }`
 * (1-based `month`) to navigate the month grid, and additively `{ view, year, month, day }`
 * for the week/day schedule.
 *
 * Fallback contract (deliberately returns a SAFE object, NOT `null`, for invalid input):
 *  - non-object → warn + `null` (the only drop case; the handler ignores the frame, as
 *    with every sibling validator);
 *  - neither `year` nor `month` present → the bare "current month" trigger (`{}` plus a
 *    valid `view` if one was supplied) — today's behavior;
 *  - a complete, in-range `{ year, month }` pair (`1970 ≤ year ≤ 9999`, `1 ≤ month ≤ 12`,
 *    both finite integers) → passthrough, optionally with a valid `day` (1..31) + `view`;
 *  - `view`: a valid `'month'|'week'|'day'` passes through; an absent/invalid view is
 *    dropped (⇒ the month default) WITHOUT failing the whole payload — additive + safe;
 *  - anything else (out-of-range/partial anchor, non-integer/NaN) → warn + the current-month
 *    fallback so the handler repaints rather than hanging on `loadingDefault` (FR-012).
 *
 * Carries NO token/secret (FR-018): the payload is structurally only
 * `{ year?, month?, day?, view? }`.
 */
export function validateGoogleCalendarRequestDefaultView(
  raw: unknown,
  warn: WarnFn = defaultWarn
): GoogleCalendarRequestDefaultViewPayload | null {
  if (!isObject(raw)) {
    warn(
      '[googleCalendar] ignoring googleCalendar:requestDefaultView — payload is not an object:',
      raw
    )
    return null
  }

  // The granularity is additive + safe: a valid view passes through; an absent/invalid view
  // is silently dropped to the month default (calendar-week-day-views-v1, FR-012 — invalid
  // view warn-and-ignore, never fail the frame). Only warn when a view was supplied but bad.
  let view: GoogleCalendarRequestDefaultViewPayload['view']
  if (raw.view !== undefined) {
    if (typeof raw.view === 'string' && DEFAULT_VIEWS.has(raw.view)) {
      view = raw.view as GoogleCalendarRequestDefaultViewPayload['view']
    } else {
      warn(
        '[googleCalendar] googleCalendar:requestDefaultView — invalid "view" (need month|week|day); falling back to month:',
        raw
      )
    }
  }
  const viewPart = view ? { view } : {}

  const hasYear = raw.year !== undefined
  const hasMonth = raw.month !== undefined
  // Neither present ⇒ the valid "current month" trigger (today's behavior); keep any view.
  if (!hasYear && !hasMonth) {
    return { ...viewPart }
  }
  // All-or-nothing + range: a complete, in-range pair passes through (plus an optional valid
  // day anchor + view); anything else (partial, out-of-range, NaN, non-integer) warns and
  // falls back to the current month.
  if (hasYear && hasMonth && isIntInRange(raw.year, 1970, 9999) && isIntInRange(raw.month, 1, 12)) {
    // The day anchor (calendar-week-day-views-v1) is optional; a present-but-invalid day is
    // dropped (the week/day window falls back to day 1) rather than failing the frame.
    const dayPart = isIntInRange(raw.day, 1, 31) ? { day: raw.day } : {}
    return { year: raw.year, month: raw.month, ...dayPart, ...viewPart }
  }
  warn(
    '[googleCalendar] ignoring googleCalendar:requestDefaultView target — invalid { year, month } (need both, year 1970..9999, month 1..12); falling back to the current month:',
    raw
  )
  return { ...viewPart }
}

/** A validated Google Calendar bridge call: a known `op` plus its raw params object. */
export interface ValidatedGoogleCalendarBridgeCall {
  callId: string
  op: GoogleCalendarOpName
  params: Record<string, unknown>
}

const GOOGLE_CAL_OPS = new Set<string>(Object.values(GoogleCalendarOp))

/**
 * Validate an inbound Google Calendar bridge frame from the MCP entry script. A
 * malformed/unknown frame is warned and ignored (null) so the bridge never crashes
 * and never mis-resolves another call.
 */
export function validateGoogleCalendarBridgeCall(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ValidatedGoogleCalendarBridgeCall | null {
  if (!isObject(raw)) {
    warn('[googleCalendar] ignoring bridge frame — not an object:', raw)
    return null
  }
  if (raw.kind !== 'google_cal_call') {
    warn('[googleCalendar] ignoring bridge frame — unknown "kind":', raw)
    return null
  }
  if (!isNonEmptyString(raw.callId)) {
    warn('[googleCalendar] ignoring bridge frame — "callId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.op !== 'string' || !GOOGLE_CAL_OPS.has(raw.op)) {
    warn('[googleCalendar] ignoring bridge frame — unknown "op":', raw)
    return null
  }
  if (!isObject(raw.params)) {
    warn('[googleCalendar] ignoring bridge frame — "params" must be an object:', raw)
    return null
  }
  return { callId: raw.callId, op: raw.op as GoogleCalendarOpName, params: raw.params }
}
