import { describe, it, expect } from 'vitest'
import { googleCalendarDefaultWindow } from './googleCalendarWindow'

/**
 * Pure default-view window math (calendar-month-year-nav-v1 + calendar-week-day-views-v1).
 * The window is the single lever that decides what is fetched; these assert month / week /
 * day windows for a fixed anchor + the absent-anchor (current) fallback. LOCAL Dates, so
 * the assertions construct their expectations with the same local `new Date(...)`.
 */

// A fixed "now" so the absent-anchor path is deterministic: 2026-06-18 (Thursday, June).
const NOW = new Date(2026, 5, 18, 9, 30)

describe('googleCalendarDefaultWindow — month view (default / back-compat)', () => {
  it('absent anchor ⇒ the CURRENT month (the original trigger, byte-for-byte)', () => {
    expect(googleCalendarDefaultWindow(undefined, NOW)).toEqual({
      timeMin: new Date(2026, 5, 1).toISOString(),
      timeMax: new Date(2026, 6, 1).toISOString()
    })
  })

  it('explicit { year, month } (1-based) ⇒ that whole month', () => {
    // month: 6 (1-based) = June (month0 = 5).
    expect(googleCalendarDefaultWindow({ year: 2026, month: 6, view: 'month' }, NOW)).toEqual({
      timeMin: new Date(2026, 5, 1).toISOString(),
      timeMax: new Date(2026, 6, 1).toISOString()
    })
  })

  it('an absent view defaults to month (additive — old payloads unchanged)', () => {
    expect(googleCalendarDefaultWindow({ year: 2026, month: 1 }, NOW)).toEqual({
      timeMin: new Date(2026, 0, 1).toISOString(),
      timeMax: new Date(2026, 1, 1).toISOString()
    })
  })

  it('December (month 12) windows into the next January (year carry)', () => {
    expect(googleCalendarDefaultWindow({ year: 2026, month: 12, view: 'month' }, NOW)).toEqual({
      timeMin: new Date(2026, 11, 1).toISOString(),
      timeMax: new Date(2027, 0, 1).toISOString()
    })
  })
})

describe('googleCalendarDefaultWindow — day view', () => {
  it('a single anchor day ⇒ [that day 00:00, the next day 00:00)', () => {
    // 2026-06-18 (Thursday).
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 6, day: 18, view: 'day' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 18).toISOString(),
      timeMax: new Date(2026, 5, 19).toISOString()
    })
  })

  it('the last day of a month windows into the first of the next month', () => {
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 6, day: 30, view: 'day' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 30).toISOString(),
      timeMax: new Date(2026, 6, 1).toISOString()
    })
  })

  it('an absent day defaults to day 1 of the anchored month', () => {
    expect(googleCalendarDefaultWindow({ year: 2026, month: 6, view: 'day' }, NOW)).toEqual({
      timeMin: new Date(2026, 5, 1).toISOString(),
      timeMax: new Date(2026, 5, 2).toISOString()
    })
  })
})

describe('googleCalendarDefaultWindow — week view (Sunday-started, 7 days)', () => {
  it('a mid-week anchor ⇒ the Sunday..next-Sunday 7-day span containing it', () => {
    // 2026-06-18 is a Thursday; its week starts Sunday 2026-06-14 and ends 2026-06-21.
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 6, day: 18, view: 'week' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 14).toISOString(),
      timeMax: new Date(2026, 5, 21).toISOString()
    })
  })

  it('a Sunday anchor ⇒ that Sunday is the week start', () => {
    // 2026-06-14 is itself a Sunday.
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 6, day: 14, view: 'week' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 14).toISOString(),
      timeMax: new Date(2026, 5, 21).toISOString()
    })
  })

  it('a Saturday anchor stays in the same (earlier-Sunday) week', () => {
    // 2026-06-20 is a Saturday; week start is still 2026-06-14.
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 6, day: 20, view: 'week' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 14).toISOString(),
      timeMax: new Date(2026, 5, 21).toISOString()
    })
  })

  it('a week spanning a month boundary carries correctly', () => {
    // 2026-07-01 (Wednesday); its week starts Sunday 2026-06-28.
    expect(
      googleCalendarDefaultWindow({ year: 2026, month: 7, day: 1, view: 'week' }, NOW)
    ).toEqual({
      timeMin: new Date(2026, 5, 28).toISOString(),
      timeMax: new Date(2026, 6, 5).toISOString()
    })
  })

  it('the week window is exactly 7 local days wide', () => {
    const w = googleCalendarDefaultWindow({ year: 2026, month: 6, day: 18, view: 'week' }, NOW)
    const span = new Date(w.timeMax).getTime() - new Date(w.timeMin).getTime()
    // 7 days; tolerate a DST hour shift by asserting within a 7d ± 1h band.
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(span - sevenDays)).toBeLessThanOrEqual(60 * 60 * 1000)
  })
})
