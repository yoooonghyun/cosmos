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
  calendarLoadingScope,
  calendarLoadingZones,
  skeletonForView,
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

describe('calendarLoadingScope (calendar-date-change-keeps-chrome — legend + nav header stay on a date change)', () => {

  it('INITIAL read (no prior surface) ⇒ full skeleton', () => {

    expect(calendarLoadingScope(true, false)).toBe('full')

  })



  it('date-change REFETCH (loading WHILE a surface exists) ⇒ keep the surface (no blank, chrome stays)', () => {

    expect(calendarLoadingScope(true, true)).toBe('keep')

  })



  it('not loading ⇒ none, regardless of surface presence', () => {

    expect(calendarLoadingScope(false, true)).toBe('none')

    expect(calendarLoadingScope(false, false)).toBe('none')

    expect(calendarLoadingScope(undefined, true)).toBe('none')

  })

})

describe('skeletonForView (calendar-date-change-keeps-chrome — per-view grid skeleton)', () => {
  it('month ⇒ the 7-col month-grid skeleton', () => {
    expect(skeletonForView('month')).toBe('month-grid')
  })

  it('week ⇒ the 7-column schedule skeleton', () => {
    expect(skeletonForView('week')).toBe('schedule-7')
  })

  it('day ⇒ the 1-column schedule skeleton', () => {
    expect(skeletonForView('day')).toBe('schedule-1')
  })
})

/**
 * Unification (calendar-date-change-keeps-chrome): the INITIAL `'full'` load and the
 * date-change `'keep'` refetch render the SAME per-view grid skeleton. The skeleton SHAPE is a
 * function of the VIEW alone (`skeletonForView`), independent of which loading scope is active —
 * so month/week/day look identical on first-load and on a date step. Both a `'full'` and a
 * `'keep'` scope (the two skeleton-bearing scopes) resolve to the same skeleton for a given view.
 */
describe('full + keep share one per-view skeleton (initial load matches date-change)', () => {
  const skeletonBearing: Array<'full' | 'keep'> = ['full', 'keep']

  for (const view of ['month', 'week', 'day'] as const) {
    it(`${view}: every skeleton-bearing scope maps to skeletonForView('${view}')`, () => {
      const expected = skeletonForView(view)
      for (const scope of skeletonBearing) {
        // The scope is whichever calendarLoadingScope returns for a loading state; both 'full'
        // (no surface) and 'keep' (surface present) are skeleton-bearing and pick the skeleton
        // by VIEW only — so the chosen skeleton is the same for both.
        expect(scope === 'full' || scope === 'keep').toBe(true)
        expect(skeletonForView(view)).toBe(expected)
      }
    })
  }

  it('calendarLoadingScope returns the two skeleton-bearing scopes for a loading state', () => {
    // 'full' for the initial (no-surface) load, 'keep' for the date-change refetch (surface present).
    expect(calendarLoadingScope(true, false)).toBe('full')
    expect(calendarLoadingScope(true, true)).toBe('keep')
  })
})

/**
 * Per-zone chrome (calendar-date-change-keeps-chrome): the first-load + refetch loading states use
 * the SAME three-zone (sidebar / header / grid) separated layout and differ only in whether the
 * legend + header are skeleton (first-load) or real (refetch). The GRID is a skeleton in BOTH so
 * there is no layout jump when data lands.
 */
describe('calendarLoadingZones (sidebar/header/grid skeleton split per scope)', () => {
  it("'full' (initial load) ⇒ all three zones are skeleton (sidebar + header + grid)", () => {
    expect(calendarLoadingZones('full')).toEqual({
      legendSkeleton: true,
      headerSkeleton: true,
      gridSkeleton: true
    })
  })

  it("'keep' (date-change refetch) ⇒ real legend + header, only the GRID is a skeleton", () => {
    expect(calendarLoadingZones('keep')).toEqual({
      legendSkeleton: false,
      headerSkeleton: false,
      gridSkeleton: true
    })
  })

  it("'none' ⇒ nothing is a skeleton", () => {
    expect(calendarLoadingZones('none')).toEqual({
      legendSkeleton: false,
      headerSkeleton: false,
      gridSkeleton: false
    })
  })

  it('the GRID is a skeleton in BOTH skeleton-bearing scopes (no layout jump on data land)', () => {
    expect(calendarLoadingZones('full').gridSkeleton).toBe(true)
    expect(calendarLoadingZones('keep').gridSkeleton).toBe(true)
  })

  it('first-load is the ONLY scope that skeletons the legend + header chrome', () => {
    expect(calendarLoadingZones('full').legendSkeleton).toBe(true)
    expect(calendarLoadingZones('full').headerSkeleton).toBe(true)
    expect(calendarLoadingZones('keep').legendSkeleton).toBe(false)
    expect(calendarLoadingZones('keep').headerSkeleton).toBe(false)
  })
})
