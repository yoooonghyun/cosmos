import { describe, it, expect, vi } from 'vitest'
import {
  validateGoogleCalendarBridgeCall,
  validateGoogleCalendarListEvents,
  validateGoogleCalendarRequestDefaultView
} from './validate'
import { GoogleCalendarOp } from './types/googleCalendar'

/**
 * Google Calendar boundary validators (google-calendar-v1, FR-015). Every Google IPC +
 * bridge payload is validated at the main-process boundary: a spec-compliant payload
 * passes through; a missing OPTIONAL field must NOT error; an invalid/missing REQUIRED
 * field warns + returns the safe `null` fallback (never crashes, never mis-routes).
 */
describe('validateGoogleCalendarListEvents (IPC params)', () => {
  const window = { timeMin: '2026-06-15T00:00:00Z', timeMax: '2026-06-22T00:00:00Z' }

  it('accepts a required window with no cursor (happy path; missing optional)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents(window, warn)).toEqual(window)
    expect(warn).not.toHaveBeenCalled()
  })

  it('threads an optional cursor through (optional present)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents({ ...window, cursor: 'CUR' }, warn)).toEqual({
      ...window,
      cursor: 'CUR'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns + null when required timeMin is missing (safe fallback)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents({ timeMax: window.timeMax }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null when required timeMax is missing (safe fallback)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents({ timeMin: window.timeMin }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null on an empty-string required bound', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents({ ...window, timeMin: '' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null on a non-string optional cursor (invalid optional)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents({ ...window, cursor: 5 }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'x', 7])('warns + null on a non-object payload %p', (raw) => {
    const warn = vi.fn()
    expect(validateGoogleCalendarListEvents(raw, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

/**
 * The default-view target-month validator (calendar-month-year-nav-v1, FR-009). The
 * target month is OPTIONAL: absent ⇒ the valid empty "current month" trigger; a complete
 * in-range 1-based `{ year, month }` passes through; anything invalid (out-of-range,
 * NaN/non-integer, partial pair) is WARNED and returns `{}` (NOT `null`) so the handler
 * falls back to the current month and the tab repaints rather than hanging. Only a
 * non-object is dropped (`null`).
 */
describe('validateGoogleCalendarRequestDefaultView (target-month IPC)', () => {
  it('accepts an absent target month → {} (the current-month trigger; missing optional)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({}, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes a complete in-range 1-based { year, month } through (happy path)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ year: 2026, month: 6 }, warn)).toEqual({
      year: 2026,
      month: 6
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts January (month 1) and December (month 12) as the 1-based bounds', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ year: 1970, month: 1 }, warn)).toEqual({
      year: 1970,
      month: 1
    })
    expect(validateGoogleCalendarRequestDefaultView({ year: 9999, month: 12 }, warn)).toEqual({
      year: 9999,
      month: 12
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([0, 13, -1, 6.5, NaN])(
    'warns + {} (current-month fallback) on an out-of-range/non-integer month %p',
    (month) => {
      const warn = vi.fn()
      expect(validateGoogleCalendarRequestDefaultView({ year: 2026, month }, warn)).toEqual({})
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([1969, 10000, 2026.5, NaN])(
    'warns + {} (current-month fallback) on an absurd/non-integer year %p',
    (year) => {
      const warn = vi.fn()
      expect(validateGoogleCalendarRequestDefaultView({ year, month: 6 }, warn)).toEqual({})
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it('warns + {} when only year is present (partial pair, all-or-nothing)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ year: 2026 }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + {} when only month is present (partial pair, all-or-nothing)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ month: 6 }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + {} on a non-number month (never throws)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ year: 2026, month: '6' }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'x', 7])('warns + null on a non-object payload %p (dropped)', (raw) => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView(raw, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  /* calendar-week-day-views-v1, FR-012 — the additive view + day anchor. */

  it('passes a valid week payload (view + 1-based { year, month, day }) through', () => {
    const warn = vi.fn()
    expect(
      validateGoogleCalendarRequestDefaultView(
        { view: 'week', year: 2026, month: 6, day: 18 },
        warn
      )
    ).toEqual({ view: 'week', year: 2026, month: 6, day: 18 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes a valid day payload through', () => {
    const warn = vi.fn()
    expect(
      validateGoogleCalendarRequestDefaultView({ view: 'day', year: 2026, month: 6, day: 1 }, warn)
    ).toEqual({ view: 'day', year: 2026, month: 6, day: 1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a bare { view } trigger (current month/week/day, no anchor)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarRequestDefaultView({ view: 'week' }, warn)).toEqual({
      view: 'week'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('an explicit view: month is preserved (no day needed)', () => {
    const warn = vi.fn()
    expect(
      validateGoogleCalendarRequestDefaultView({ view: 'month', year: 2026, month: 6 }, warn)
    ).toEqual({ view: 'month', year: 2026, month: 6 })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['year', 'agenda', '', 5, true])(
    'warns + drops an invalid view %p but keeps the month anchor (falls back to month)',
    (view) => {
      const warn = vi.fn()
      expect(
        validateGoogleCalendarRequestDefaultView({ view, year: 2026, month: 6 }, warn)
      ).toEqual({ year: 2026, month: 6 })
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it('drops an out-of-range/invalid day but keeps the valid anchor + view', () => {
    const warn = vi.fn()
    expect(
      validateGoogleCalendarRequestDefaultView(
        { view: 'week', year: 2026, month: 6, day: 0 },
        warn
      )
    ).toEqual({ view: 'week', year: 2026, month: 6 })
    expect(
      validateGoogleCalendarRequestDefaultView(
        { view: 'day', year: 2026, month: 6, day: 99 },
        warn
      )
    ).toEqual({ view: 'day', year: 2026, month: 6 })
    expect(warn).not.toHaveBeenCalled() // day is silently dropped, not warned
  })

  it('a week view with an invalid partial anchor warns + current-month fallback, keeping the view', () => {
    const warn = vi.fn()
    expect(
      validateGoogleCalendarRequestDefaultView({ view: 'week', year: 2026 }, warn)
    ).toEqual({ view: 'week' })
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('validateGoogleCalendarBridgeCall (bridge frame)', () => {
  const frame = {
    kind: 'google_cal_call',
    callId: 'c1',
    op: GoogleCalendarOp.ListEvents,
    params: { timeMin: 'a', timeMax: 'b' }
  }

  it('accepts a well-formed listEvents frame (happy path)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarBridgeCall(frame, warn)).toEqual({
      callId: 'c1',
      op: GoogleCalendarOp.ListEvents,
      params: { timeMin: 'a', timeMax: 'b' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns + null on a wrong frame kind (cannot mis-route)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarBridgeCall({ ...frame, kind: 'slack_call' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null on an unknown op (read-only — no write op exists)', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarBridgeCall({ ...frame, op: 'deleteEvent' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null on a missing callId (safe fallback)', () => {
    const warn = vi.fn()
    const { callId: _omit, ...noCallId } = frame
    expect(validateGoogleCalendarBridgeCall(noCallId, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null when params is not an object', () => {
    const warn = vi.fn()
    expect(validateGoogleCalendarBridgeCall({ ...frame, params: 'nope' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'x', 7])('warns + null on a non-object frame %p', (raw) => {
    const warn = vi.fn()
    expect(validateGoogleCalendarBridgeCall(raw, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})
