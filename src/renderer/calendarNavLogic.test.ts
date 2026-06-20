import { describe, it, expect } from 'vitest'
import {
  stepMonth,
  stepYear,
  currentMonth,
  isCurrentMonth,
  toWirePayload,
  isSurfaceForIntent,
  currentDay,
  stepDay,
  stepWeek,
  isCurrentDay,
  isCurrentWeek,
  viewToWirePayload,
  monthLabel,
  dayLabel,
  weekRangeLabel,
  type CalendarMonthIntent,
  type CalendarDayAnchor
} from './calendarNavLogic'

/**
 * Pure month/year navigation arithmetic (calendar-month-year-nav-v1). `month` is 0-based
 * internally (0 = January … 11 = December); the only 0→1 conversion is `toWirePayload`.
 */
describe('stepMonth (FR-002 — ±1 month with year carry)', () => {
  it('steps forward within a year', () => {
    expect(stepMonth({ year: 2026, month: 5 }, 1)).toEqual({ year: 2026, month: 6 }) // Jun → Jul
  })

  it('steps backward within a year', () => {
    expect(stepMonth({ year: 2026, month: 5 }, -1)).toEqual({ year: 2026, month: 4 }) // Jun → May
  })

  it('crosses Dec → next Jan (increments year)', () => {
    expect(stepMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
  })

  it('crosses Jan → prev Dec (decrements year)', () => {
    expect(stepMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('stepYear (FR-003 — ±1 year, same month)', () => {
  it('jumps forward a year, preserving the month number', () => {
    expect(stepYear({ year: 2026, month: 5 }, 1)).toEqual({ year: 2027, month: 5 })
  })

  it('jumps backward a year, preserving the month number', () => {
    expect(stepYear({ year: 2026, month: 5 }, -1)).toEqual({ year: 2025, month: 5 })
  })

  it('preserves January (month 0) across a year jump', () => {
    expect(stepYear({ year: 2026, month: 0 }, 1)).toEqual({ year: 2027, month: 0 })
  })
})

describe('currentMonth / isCurrentMonth (FR-004 / FR-005 no-op gate)', () => {
  const now = new Date(2026, 5, 18) // 2026-06-18 (June, month 5)

  it('currentMonth returns the now month as a 0-based intent', () => {
    expect(currentMonth(now)).toEqual({ year: 2026, month: 5 })
  })

  it('isCurrentMonth is true for the current month', () => {
    expect(isCurrentMonth({ year: 2026, month: 5 }, now)).toBe(true)
  })

  it('isCurrentMonth is false for a different month', () => {
    expect(isCurrentMonth({ year: 2026, month: 6 }, now)).toBe(false)
  })

  it('isCurrentMonth is false for the same month in a different year', () => {
    expect(isCurrentMonth({ year: 2025, month: 5 }, now)).toBe(false)
  })
})

describe('toWirePayload (FR-008 — 0-based intent → 1-based wire)', () => {
  it('converts January (month 0) to wire month 1', () => {
    expect(toWirePayload({ year: 2026, month: 0 })).toEqual({ year: 2026, month: 1 })
  })

  it('converts December (month 11) to wire month 12', () => {
    expect(toWirePayload({ year: 2026, month: 11 })).toEqual({ year: 2026, month: 12 })
  })

  it('converts June (month 5) to wire month 6', () => {
    expect(toWirePayload({ year: 2026, month: 5 })).toEqual({ year: 2026, month: 6 })
  })
})

describe('isSurfaceForIntent (FR-014 — latest-wins stale-read gate)', () => {
  const now = new Date(2026, 5, 18)

  it('accepts a surface whose timeMin month matches the intent', () => {
    const intent: CalendarMonthIntent = { year: 2026, month: 6 } // July
    // first instant of July 2026 (local)
    const timeMin = new Date(2026, 6, 1).toISOString()
    expect(isSurfaceForIntent(timeMin, intent, now)).toBe(true)
  })

  it('rejects a surface for an OLDER month (stale read) against a newer intent', () => {
    const intent: CalendarMonthIntent = { year: 2026, month: 7 } // August (latest)
    const staleTimeMin = new Date(2026, 6, 1).toISOString() // July surface lands late
    expect(isSurfaceForIntent(staleTimeMin, intent, now)).toBe(false)
  })

  it('rejects a surface for the same month in a different year', () => {
    const intent: CalendarMonthIntent = { year: 2027, month: 5 }
    const timeMin = new Date(2026, 5, 1).toISOString()
    expect(isSurfaceForIntent(timeMin, intent, now)).toBe(false)
  })

  it('treats an absent timeMin as the current month (monthFromWindow fallback)', () => {
    // monthFromWindow falls back to `now` (June, month 5) for an absent timeMin.
    expect(isSurfaceForIntent(undefined, { year: 2026, month: 5 }, now)).toBe(true)
    expect(isSurfaceForIntent(undefined, { year: 2026, month: 6 }, now)).toBe(false)
  })
})

/**
 * Week/Day anchor arithmetic (calendar-week-day-views-v1). `month` is 0-based internally;
 * `day` is 1-based (JS `Date#getDate`). The 0→1 month conversion is only in
 * `viewToWirePayload`. 2026-06-18 is a Thursday; its Sunday-started week is 06-14..06-20.
 */
describe('currentDay (FR-005 day default)', () => {
  it('returns now as a 0-based-month day anchor', () => {
    const now = new Date(2026, 5, 18) // 2026-06-18
    expect(currentDay(now)).toEqual({ year: 2026, month: 5, day: 18 })
  })
})

describe('stepDay (FR-010 — ±1 day with month/year carry)', () => {
  it('steps forward within a month', () => {
    expect(stepDay({ year: 2026, month: 5, day: 18 }, 1)).toEqual({ year: 2026, month: 5, day: 19 })
  })

  it('crosses a month end (June 30 → July 1)', () => {
    expect(stepDay({ year: 2026, month: 5, day: 30 }, 1)).toEqual({ year: 2026, month: 6, day: 1 })
  })

  it('crosses a year start (Jan 1 → prev Dec 31)', () => {
    expect(stepDay({ year: 2026, month: 0, day: 1 }, -1)).toEqual({ year: 2025, month: 11, day: 31 })
  })
})

describe('stepWeek (FR-009 — ±7 days, same weekday)', () => {
  it('steps forward exactly one week', () => {
    expect(stepWeek({ year: 2026, month: 5, day: 18 }, 1)).toEqual({ year: 2026, month: 5, day: 25 })
  })

  it('steps backward across a month boundary', () => {
    expect(stepWeek({ year: 2026, month: 5, day: 4 }, -1)).toEqual({ year: 2026, month: 4, day: 28 })
  })
})

describe('isCurrentDay / isCurrentWeek (no-op gates for "Today")', () => {
  const now = new Date(2026, 5, 18) // Thursday 2026-06-18

  it('isCurrentDay true only for today', () => {
    expect(isCurrentDay({ year: 2026, month: 5, day: 18 }, now)).toBe(true)
    expect(isCurrentDay({ year: 2026, month: 5, day: 19 }, now)).toBe(false)
  })

  it('isCurrentWeek true for ANY day in today’s Sunday week', () => {
    // Week 06-14 (Sun) .. 06-20 (Sat).
    expect(isCurrentWeek({ year: 2026, month: 5, day: 14 }, now)).toBe(true)
    expect(isCurrentWeek({ year: 2026, month: 5, day: 18 }, now)).toBe(true)
    expect(isCurrentWeek({ year: 2026, month: 5, day: 20 }, now)).toBe(true)
  })

  it('isCurrentWeek false for the adjacent weeks', () => {
    expect(isCurrentWeek({ year: 2026, month: 5, day: 13 }, now)).toBe(false) // prev Sat
    expect(isCurrentWeek({ year: 2026, month: 5, day: 21 }, now)).toBe(false) // next Sun
  })
})

describe('viewToWirePayload (FR-012 — view + 1-based anchor)', () => {
  it('month carries NO view/day (back-compat byte-for-byte)', () => {
    const intent = { view: 'month' as const, anchor: { year: 2026, month: 5 } }
    expect(viewToWirePayload(intent)).toEqual({ year: 2026, month: 6 })
  })

  it('week carries view + 1-based { year, month, day }', () => {
    const anchor: CalendarDayAnchor = { year: 2026, month: 5, day: 18 }
    expect(viewToWirePayload({ view: 'week', anchor })).toEqual({
      view: 'week',
      year: 2026,
      month: 6,
      day: 18
    })
  })

  it('day carries view: day + the 1-based anchor', () => {
    const anchor: CalendarDayAnchor = { year: 2026, month: 0, day: 1 }
    expect(viewToWirePayload({ view: 'day', anchor })).toEqual({
      view: 'day',
      year: 2026,
      month: 1,
      day: 1
    })
  })
})

describe('range labels (calendar-week-day-views-v1 header)', () => {
  it('monthLabel reads "June 2026"', () => {
    expect(monthLabel({ year: 2026, month: 5 })).toBe('June 2026')
  })

  it('dayLabel reads the full weekday + date', () => {
    // 2026-06-18 is a Thursday.
    expect(dayLabel({ year: 2026, month: 5, day: 18 })).toBe('Thursday, June 18, 2026')
  })

  it('weekRangeLabel compacts a same-month week', () => {
    // Week containing 2026-06-18 = 06-14 (Sun) .. 06-20 (Sat).
    expect(weekRangeLabel({ year: 2026, month: 5, day: 18 })).toBe('June 14 – 20, 2026')
  })

  it('weekRangeLabel spans a month boundary', () => {
    // Week containing 2026-07-01 = 06-28 (Sun) .. 07-04 (Sat).
    expect(weekRangeLabel({ year: 2026, month: 6, day: 1 })).toBe('June 28 – July 4, 2026')
  })

  it('weekRangeLabel spans a year boundary', () => {
    // Week containing 2026-12-31 = 12-27 (Sun) .. 2027-01-02 (Sat).
    expect(weekRangeLabel({ year: 2026, month: 11, day: 31 })).toBe(
      'December 27, 2026 – January 2, 2027'
    )
  })
})
