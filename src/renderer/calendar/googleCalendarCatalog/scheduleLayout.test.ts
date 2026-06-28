import { describe, it, expect } from 'vitest'
import {
  allDayCoversDay,
  buildDayColumn,
  dayColumnAriaLabel,
  dayColumnHeader,
  dayColumnsForWindow,
  eventInstants,
  MIN_BLOCK_HEIGHT_PCT,
  placeInDay,
  type DayBounds
} from './scheduleLayout'
import type { EventChipData } from './logic'

/**
 * Pure time-axis layout (calendar-week-day-views-v1, design §4). Placement + size from the
 * day's ACTUAL local span (DST-safe), cross-midnight/multi-day clamp, equal-width overlap
 * lanes, all-day coverage, the day-column list from the surface window, and the column
 * aria-label. LOCAL Dates throughout so tests construct bounds/events with `new Date(...)`.
 */

/** A normal 24h local day: 2026-06-18 00:00 .. 2026-06-19 00:00. */
const DAY: DayBounds = {
  start: new Date(2026, 5, 18, 0, 0, 0),
  end: new Date(2026, 5, 19, 0, 0, 0)
}

/** A timed event helper (RFC-3339-ish local-instant strings via Date#toISOString of locals). */
function timed(startLocal: Date, endLocal: Date, extra: Partial<EventChipData> = {}): EventChipData {
  return {
    id: extra.id ?? `${startLocal.getTime()}`,
    summary: extra.summary ?? 'Event',
    start: startLocal.toISOString(),
    end: endLocal.toISOString(),
    allDay: false,
    ...extra
  }
}

describe('eventInstants', () => {
  it('parses a timed start + end into ms instants', () => {
    const ev = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 0))
    const got = eventInstants(ev)
    expect(got).not.toBeNull()
    expect(got!.startMs).toBe(new Date(2026, 5, 18, 9, 0).getTime())
    expect(got!.endMs).toBe(new Date(2026, 5, 18, 10, 0).getTime())
  })

  it('returns null for an unparseable / absent start (drops from the grid)', () => {
    expect(eventInstants({ start: 'not-a-date' })).toBeNull()
    expect(eventInstants({})).toBeNull()
  })

  it('degrades an absent end to a zero-length instant at the start', () => {
    const ev: EventChipData = { start: new Date(2026, 5, 18, 9, 0).toISOString() }
    const got = eventInstants(ev)
    expect(got!.endMs).toBe(got!.startMs)
  })

  it('clamps an end-before-start to zero length (never negative)', () => {
    const ev = timed(new Date(2026, 5, 18, 10, 0), new Date(2026, 5, 18, 9, 0))
    const got = eventInstants(ev)
    expect(got!.endMs).toBe(got!.startMs)
  })
})

describe('placeInDay — placement + size from the day span (FR-006)', () => {
  it('places a 9–10am event at 37.5% top, ~4.17% height on a 24h day', () => {
    const ev = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.topPct).toBeCloseTo((9 / 24) * 100, 5) // 37.5
    expect(p.heightPct).toBeCloseTo((1 / 24) * 100, 5) // ~4.1667
  })

  it('a midnight-to-midnight event fills the whole column (0..100)', () => {
    const ev = timed(new Date(2026, 5, 18, 0, 0), new Date(2026, 5, 19, 0, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.topPct).toBeCloseTo(0, 5)
    expect(p.heightPct).toBeCloseTo(100, 5)
  })

  it('a zero-duration event gets the min legible height, not 0', () => {
    const ev = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 9, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.heightPct).toBe(MIN_BLOCK_HEIGHT_PCT)
  })

  it('returns null for an event entirely outside the day', () => {
    const before = timed(new Date(2026, 5, 17, 9, 0), new Date(2026, 5, 17, 10, 0))
    const after = timed(new Date(2026, 5, 19, 9, 0), new Date(2026, 5, 19, 10, 0))
    expect(placeInDay(before, DAY)).toBeNull()
    expect(placeInDay(after, DAY)).toBeNull()
  })

  it('returns null for an unparseable start', () => {
    expect(placeInDay({ start: 'nope', end: 'nope' }, DAY)).toBeNull()
  })
})

describe('placeInDay — cross-midnight / multi-day clamp (FR-006 clamp)', () => {
  it('clamps an event starting before the day to the top edge', () => {
    // Starts 2026-06-17 22:00, ends 2026-06-18 02:00 → in THIS day: 00:00..02:00.
    const ev = timed(new Date(2026, 5, 17, 22, 0), new Date(2026, 5, 18, 2, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.topPct).toBeCloseTo(0, 5)
    expect(p.heightPct).toBeCloseTo((2 / 24) * 100, 5)
  })

  it('clamps an event ending after the day to the bottom edge', () => {
    // Starts 2026-06-18 22:00, ends 2026-06-19 02:00 → in THIS day: 22:00..24:00.
    const ev = timed(new Date(2026, 5, 18, 22, 0), new Date(2026, 5, 19, 2, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.topPct).toBeCloseTo((22 / 24) * 100, 5)
    expect(p.topPct + p.heightPct).toBeLessThanOrEqual(100 + 1e-6)
  })

  it('a multi-day event appears clamped to the FULL column on a fully-covered middle day', () => {
    // Spans 2026-06-17 12:00 .. 2026-06-20 12:00; on 06-18 it covers the whole day.
    const ev = timed(new Date(2026, 5, 17, 12, 0), new Date(2026, 5, 20, 12, 0))
    const p = placeInDay(ev, DAY)!
    expect(p.topPct).toBeCloseTo(0, 5)
    expect(p.heightPct).toBeCloseTo(100, 5)
  })
})

describe('placeInDay — DST long/short days derive offsets from the real span', () => {
  // We cannot assume the test host is in a DST zone, so assert the GENERAL invariant: the
  // placement uses (end - start) of the bounds, not a hardcoded 24h. Simulate a 25h day.
  it('a 25h day places a 1h event proportionally to 25h, not 24h', () => {
    const bounds: DayBounds = {
      start: new Date(2026, 10, 1, 0, 0, 0),
      end: new Date(2026, 10, 1, 0, 0, 0)
    }
    // Force a 25h span explicitly (fall-back style).
    bounds.end = new Date(bounds.start.getTime() + 25 * 60 * 60 * 1000)
    const ev = {
      start: new Date(bounds.start.getTime() + 1 * 60 * 60 * 1000).toISOString(),
      end: new Date(bounds.start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      allDay: false
    }
    const p = placeInDay(ev, bounds)!
    expect(p.topPct).toBeCloseTo((1 / 25) * 100, 5)
    expect(p.heightPct).toBeCloseTo((1 / 25) * 100, 5)
  })

  it('a 23h day places a 1h event proportionally to 23h', () => {
    const start = new Date(2026, 2, 8, 0, 0, 0)
    const bounds: DayBounds = { start, end: new Date(start.getTime() + 23 * 60 * 60 * 1000) }
    const ev = {
      start: new Date(start.getTime() + 1 * 60 * 60 * 1000).toISOString(),
      end: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      allDay: false
    }
    const p = placeInDay(ev, bounds)!
    expect(p.heightPct).toBeCloseTo((1 / 23) * 100, 5)
  })
})

describe('buildDayColumn — overlap lane packing (FR-008, design §4 equal split)', () => {
  it('disjoint events each get a full-width lane (laneCount 1)', () => {
    const a = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 0), { id: 'a' })
    const b = timed(new Date(2026, 5, 18, 11, 0), new Date(2026, 5, 18, 12, 0), { id: 'b' })
    const { timed: placed } = buildDayColumn([a, b], DAY)
    expect(placed).toHaveLength(2)
    for (const p of placed) {
      expect(p.laneCount).toBe(1)
      expect(p.laneIndex).toBe(0)
    }
  })

  it('two overlapping events split into 2 lanes (index 0 and 1)', () => {
    const a = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 11, 0), { id: 'a' })
    const b = timed(new Date(2026, 5, 18, 10, 0), new Date(2026, 5, 18, 12, 0), { id: 'b' })
    const { timed: placed } = buildDayColumn([a, b], DAY)
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]))
    expect(byId.a.laneCount).toBe(2)
    expect(byId.b.laneCount).toBe(2)
    expect(new Set([byId.a.laneIndex, byId.b.laneIndex])).toEqual(new Set([0, 1]))
  })

  it('a connected chain (A∩B, B∩C, A⊄C) shares one 2-lane cluster', () => {
    // A 9-10:30, B 10-11:30, C 11-12 → all connected; peak concurrency 2.
    const a = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 30), { id: 'a' })
    const b = timed(new Date(2026, 5, 18, 10, 0), new Date(2026, 5, 18, 11, 30), { id: 'b' })
    const c = timed(new Date(2026, 5, 18, 11, 0), new Date(2026, 5, 18, 12, 0), { id: 'c' })
    const { timed: placed } = buildDayColumn([a, b, c], DAY)
    for (const p of placed) {
      expect(p.laneCount).toBe(2)
    }
    // A reuses lane 0 after it ends → C can take lane 0 again.
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]))
    expect(byId.a.laneIndex).toBe(0)
    expect(byId.b.laneIndex).toBe(1)
    expect(byId.c.laneIndex).toBe(0)
  })

  it('a dense triple-overlap is bounded to 3 lanes and never throws', () => {
    const a = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 12, 0), { id: 'a' })
    const b = timed(new Date(2026, 5, 18, 9, 30), new Date(2026, 5, 18, 12, 0), { id: 'b' })
    const c = timed(new Date(2026, 5, 18, 10, 0), new Date(2026, 5, 18, 12, 0), { id: 'c' })
    const { timed: placed } = buildDayColumn([a, b, c], DAY)
    expect(placed).toHaveLength(3)
    expect(new Set(placed.map((p) => p.laneCount))).toEqual(new Set([3]))
    expect(new Set(placed.map((p) => p.laneIndex))).toEqual(new Set([0, 1, 2]))
  })

  it('drops an unparseable timed event but keeps the valid ones', () => {
    const good = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 0), { id: 'good' })
    const bad: EventChipData = { id: 'bad', start: 'garbage', allDay: false }
    const { timed: placed } = buildDayColumn([good, bad], DAY)
    expect(placed.map((p) => p.event.id)).toEqual(['good'])
  })
})

describe('buildDayColumn — all-day separation (FR-007)', () => {
  it('routes an all-day event to the all-day row, not the timed grid', () => {
    const allDay: EventChipData = { id: 'ad', summary: 'Holiday', start: '2026-06-18', allDay: true }
    const t = timed(new Date(2026, 5, 18, 9, 0), new Date(2026, 5, 18, 10, 0), { id: 't' })
    const layout = buildDayColumn([allDay, t], DAY)
    expect(layout.allDay.map((a) => a.event.id)).toEqual(['ad'])
    expect(layout.timed.map((p) => p.event.id)).toEqual(['t'])
  })
})

describe('allDayCoversDay — single + multi-day spanning bar (design §5)', () => {
  it('a single-day all-day event covers only its own day', () => {
    const ev: EventChipData = { start: '2026-06-18', allDay: true }
    expect(allDayCoversDay(ev, DAY)).toBe(true)
    const other: DayBounds = { start: new Date(2026, 5, 19), end: new Date(2026, 5, 20) }
    expect(allDayCoversDay(ev, other)).toBe(false)
  })

  it('a multi-day all-day event covers each day in [start, exclusive end)', () => {
    // 2026-06-17 .. 2026-06-20 (exclusive) covers 17,18,19 but NOT 20.
    const ev: EventChipData = { start: '2026-06-17', end: '2026-06-20', allDay: true }
    const day = (d: number): DayBounds => ({
      start: new Date(2026, 5, d),
      end: new Date(2026, 5, d + 1)
    })
    expect(allDayCoversDay(ev, day(17))).toBe(true)
    expect(allDayCoversDay(ev, day(18))).toBe(true)
    expect(allDayCoversDay(ev, day(19))).toBe(true)
    expect(allDayCoversDay(ev, day(20))).toBe(false)
  })

  it('an unparseable all-day start covers nothing (never throws)', () => {
    expect(allDayCoversDay({ start: 'nope', allDay: true }, DAY)).toBe(false)
  })
})

describe('dayColumnsForWindow — one DayBounds per local day in [timeMin, timeMax)', () => {
  it('a 7-day week window yields 7 columns', () => {
    const timeMin = new Date(2026, 5, 14).toISOString()
    const timeMax = new Date(2026, 5, 21).toISOString()
    const cols = dayColumnsForWindow(timeMin, timeMax)
    expect(cols).toHaveLength(7)
    expect(cols[0].start.getDate()).toBe(14)
    expect(cols[6].start.getDate()).toBe(20)
  })

  it('a 1-day window yields 1 column', () => {
    const timeMin = new Date(2026, 5, 18).toISOString()
    const timeMax = new Date(2026, 5, 19).toISOString()
    const cols = dayColumnsForWindow(timeMin, timeMax)
    expect(cols).toHaveLength(1)
    expect(cols[0].start.getDate()).toBe(18)
  })

  it('falls back to a single column around now for an absent timeMin', () => {
    const now = new Date(2026, 5, 18, 12, 0)
    const cols = dayColumnsForWindow(undefined, undefined, now)
    expect(cols).toHaveLength(1)
    expect(cols[0].start.getDate()).toBe(18)
  })

  it('caps a malformed wide window so it never explodes', () => {
    const timeMin = new Date(2026, 0, 1).toISOString()
    const timeMax = new Date(2027, 0, 1).toISOString()
    const cols = dayColumnsForWindow(timeMin, timeMax)
    expect(cols.length).toBeLessThanOrEqual(31)
  })
})

describe('dayColumnHeader / dayColumnAriaLabel (design §1.2 / §6)', () => {
  const now = new Date(2026, 5, 18, 9, 0)

  it('header gives short weekday + date + today flag', () => {
    const h = dayColumnHeader(DAY, now)
    expect(h.weekday).toBe('Thu') // 2026-06-18 is a Thursday
    expect(h.dateLabel).toBe('18')
    expect(h.isToday).toBe(true)
  })

  it('an empty column reads "no events"', () => {
    const layout = buildDayColumn([], DAY)
    expect(dayColumnAriaLabel(layout, DAY, now)).toBe('Thursday June 18, today, no events')
  })

  it('lists all-day + timed events with times', () => {
    const ad: EventChipData = { summary: 'Holiday', start: '2026-06-18', allDay: true }
    const t = timed(new Date(2026, 5, 18, 9, 30), new Date(2026, 5, 18, 10, 0), {
      summary: 'Standup'
    })
    const layout = buildDayColumn([ad, t], DAY)
    const label = dayColumnAriaLabel(layout, DAY, now)
    expect(label).toContain('Thursday June 18')
    expect(label).toContain('today')
    expect(label).toContain('2 events')
    expect(label).toContain('Holiday all day')
    expect(label).toContain('Standup')
  })

  it('omits "today" when the column is not today', () => {
    const other: DayBounds = { start: new Date(2026, 5, 19), end: new Date(2026, 5, 20) }
    const layout = buildDayColumn([], other)
    expect(dayColumnAriaLabel(layout, other, now)).toBe('Friday June 19, no events')
  })
})
