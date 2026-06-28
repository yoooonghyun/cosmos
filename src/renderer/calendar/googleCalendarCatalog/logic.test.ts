import { describe, it, expect } from 'vitest'
import {
  buildMonthGrid,
  cellEventDisplay,
  colorTokenFor,
  dayCellAriaLabel,
  eventColorClasses,
  eventColorClassesByCalendar,
  eventColorName,
  eventDayKey,
  eventTimeLabel,
  eventTitle,
  isAllDay,
  monthFromWindow,
  seedHiddenCalendarIds,
  visibleEvents,
  hiddenCalendarsKey,
  tokenColorClasses,
  tokenColorName,
  type CalendarLegendData,
  type DayCellData,
  type EventChipData
} from './logic'

/* google-calendar-v1 — pure month-grid catalog logic (design §1.1/§1.2/§5/§6,
 * FR-016 timed/all-day + TZ, FR-017 empty/never-broken). */

const timed: EventChipData = {
  id: 'e1',
  summary: 'Standup',
  start: '2026-06-16T09:30:00-07:00',
  end: '2026-06-16T09:45:00-07:00',
  allDay: false,
  colorId: '7'
}

const allDay: EventChipData = {
  id: 'e2',
  summary: 'Holiday',
  start: '2026-06-17',
  end: '2026-06-18',
  allDay: true
}

// A fixed "today" so the grid is deterministic across machines/timezones.
const now = new Date(2026, 5, 16) // June 16 2026 (month is 0-based)
const window = { timeMin: '2026-06-01T00:00:00-07:00', timeMax: '2026-07-01T00:00:00-07:00' }

describe('eventColorName / eventColorClasses (design §5 — colorId → bounded --event-* token)', () => {
  it('maps the known GCal colorIds into the 6 cosmos hues', () => {
    expect(eventColorName('7')).toBe('blue') // Peacock
    expect(eventColorName('9')).toBe('blue') // Blueberry
    expect(eventColorName('2')).toBe('green') // Sage
    expect(eventColorName('10')).toBe('green') // Basil
    expect(eventColorName('1')).toBe('purple') // Lavender
    expect(eventColorName('4')).toBe('red') // Flamingo
    expect(eventColorName('5')).toBe('amber') // Banana
    expect(eventColorName('8')).toBe('gray') // Graphite
  })

  it('defaults an absent colorId to blue (the calendar default)', () => {
    expect(eventColorName(undefined)).toBe('blue')
    expect(eventColorName('')).toBe('blue')
    expect(eventColorName('   ')).toBe('blue')
  })

  it('degrades an unknown/odd colorId to gray (never throws, never a wrong hue)', () => {
    expect(eventColorName('99')).toBe('gray')
    expect(eventColorName('nope')).toBe('gray')
  })

  it('returns token class strings (no raw hex) for dot + all-day bar', () => {
    const blue = eventColorClasses('7')
    expect(blue.dot).toBe('bg-event-blue')
    expect(blue.bar).toContain('bg-event-blue/25')
    expect(blue.bar).toContain('border-event-blue')
    // a fallback colorId still yields a valid class pair (gray)
    expect(eventColorClasses('zzz').dot).toBe('bg-event-gray')
    // no raw hex anywhere
    expect(JSON.stringify(eventColorClasses('4'))).not.toMatch(/#/)
  })
})

describe('isAllDay (FR-016 — all-day vs timed)', () => {
  it('uses the explicit allDay flag when present', () => {
    expect(isAllDay(allDay)).toBe(true)
    expect(isAllDay(timed)).toBe(false)
  })

  it('falls back to a date-only start heuristic when the flag is absent', () => {
    expect(isAllDay({ start: '2026-06-17' })).toBe(true)
    expect(isAllDay({ start: '2026-06-16T09:30:00-07:00' })).toBe(false)
  })

  it('is false for an absent start (safe fallback)', () => {
    expect(isAllDay({})).toBe(false)
  })
})

describe('eventTimeLabel (FR-016 — timed chip prefix)', () => {
  it('formats a timed start as a short local time', () => {
    // Tied to the event instant; just assert it is a non-empty time-like string.
    expect(eventTimeLabel(timed)).toMatch(/\d/)
  })

  it('returns "" for an all-day event (the chip shows no time)', () => {
    expect(eventTimeLabel(allDay)).toBe('')
  })

  it('returns "" for an unparseable/absent start (never throws)', () => {
    expect(eventTimeLabel({ start: 'not-a-date', allDay: false })).toBe('')
    expect(eventTimeLabel({})).toBe('')
  })
})

describe('eventTitle (blank/absent summary degrades, never empty)', () => {
  it('returns the summary when present', () => {
    expect(eventTitle(timed)).toBe('Standup')
  })
  it('falls back to a placeholder for blank/absent summary', () => {
    expect(eventTitle({ summary: '' })).toBe('(no title)')
    expect(eventTitle({ summary: '   ' })).toBe('(no title)')
    expect(eventTitle({})).toBe('(no title)')
  })
})

describe('monthFromWindow (derive the grid month from timeMin)', () => {
  it('takes the month from a valid timeMin', () => {
    expect(monthFromWindow('2026-06-01T00:00:00-07:00', now)).toEqual({ year: 2026, month: 5 })
    expect(monthFromWindow('2026-12-15T00:00:00Z', now)).toEqual({ year: 2026, month: 11 })
  })

  it('falls back to now for an absent/unparseable timeMin (grid always renders)', () => {
    expect(monthFromWindow(undefined, now)).toEqual({ year: 2026, month: 5 })
    expect(monthFromWindow('garbage', now)).toEqual({ year: 2026, month: 5 })
  })
})

describe('eventDayKey (bucket key; all-day uses date verbatim, no TZ shift)', () => {
  it('uses the date-only start verbatim for an all-day event', () => {
    expect(eventDayKey(allDay)).toBe('2026-06-17')
  })
  it('uses the local date of a timed instant', () => {
    // The instant is 2026-06-16T09:30-07:00 — its local key depends on the runner TZ
    // but is always a YYYY-MM-DD; assert the shape + that it is around the 16th.
    expect(eventDayKey(timed)).toMatch(/^2026-06-1[567]$/)
  })
  it('returns "" for an unparseable/absent start (event drops out, no crash)', () => {
    expect(eventDayKey({ start: 'nope' })).toBe('')
    expect(eventDayKey({})).toBe('')
  })
})

describe('buildMonthGrid (design §1.1 — month grid + bucketing)', () => {
  it('composes a labeled grid of whole weeks with in/out-of-month flags', () => {
    const grid = buildMonthGrid([timed, allDay], window.timeMin, now)
    expect(grid.monthLabel).toBe('June 2026')
    expect(grid.weekdayLabels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    // A whole number of weeks (June 2026 = 5 weeks → 35 cells).
    expect(grid.cells.length % 7).toBe(0)
    expect(grid.cells.length).toBe(35)
    // June 1 2026 is a Monday → exactly 1 leading spillover day (May 31).
    expect(grid.cells[0].inMonth).toBe(false)
    expect(grid.cells[0].dateKey).toBe('2026-05-31')
    expect(grid.cells[1].inMonth).toBe(true)
    expect(grid.cells[1].dateKey).toBe('2026-06-01')
  })

  it('buckets the all-day event onto its day and marks today', () => {
    const grid = buildMonthGrid([allDay], window.timeMin, now)
    const cell17 = grid.cells.find((c) => c.dateKey === '2026-06-17')
    expect(cell17?.events).toHaveLength(1)
    expect(cell17?.events[0].id).toBe('e2')
    const cell16 = grid.cells.find((c) => c.dateKey === '2026-06-16')
    expect(cell16?.isToday).toBe(true)
    expect(grid.todayKey).toBe('2026-06-16')
  })

  it('renders a fully-populated EMPTY grid for zero events (FR-017 — never an error)', () => {
    const grid = buildMonthGrid([], window.timeMin, now)
    expect(grid.cells.length).toBe(35)
    expect(grid.cells.every((c) => c.events.length === 0)).toBe(true)
  })

  it('skips a malformed event (unparseable start) rather than throwing', () => {
    const grid = buildMonthGrid(
      [{ id: 'bad', start: 'not-a-date' }, allDay],
      window.timeMin,
      now
    )
    const placed = grid.cells.flatMap((c) => c.events)
    expect(placed.map((e) => e.id)).toEqual(['e2'])
  })

  it('supports a Monday week start (design OQ2)', () => {
    const grid = buildMonthGrid([], window.timeMin, now, 'monday')
    expect(grid.weekdayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    // June 1 2026 is Monday → it is the FIRST cell (no leading spillover).
    expect(grid.cells[0].dateKey).toBe('2026-06-01')
    expect(grid.cells[0].inMonth).toBe(true)
  })

  it('falls back to today\'s month for an absent timeMin (grid still renders)', () => {
    const grid = buildMonthGrid([], undefined, now)
    expect(grid.monthLabel).toBe('June 2026')
  })
})

describe('cellEventDisplay (design §1.1 — cap + overflow)', () => {
  const four = [timed, allDay, { ...timed, id: 'e3' }, { ...timed, id: 'e4' }]
  it('shows all when at or under the cap (no overflow)', () => {
    expect(cellEventDisplay([timed, allDay]).overflowCount).toBe(0)
    expect(cellEventDisplay([timed, allDay]).shown).toHaveLength(2)
  })
  it('caps at max and reports the +N overflow', () => {
    const d = cellEventDisplay(four, 3)
    expect(d.shown).toHaveLength(3)
    expect(d.overflowCount).toBe(1)
  })
  it('degrades a non-array to empty/zero (safe fallback)', () => {
    expect(cellEventDisplay(undefined as unknown as EventChipData[])).toEqual({
      shown: [],
      overflowCount: 0
    })
  })
})

/* shared-calendars-v1 — per-calendar color (token NAME → classes), legend hidden-set
 * seed (FR-010), and the hidden-calendar filter (FR-011). */

const calendars: CalendarLegendData[] = [
  { id: 'primary', summary: 'Me', colorToken: 'blue', primary: true, selected: true },
  { id: 'team@x', summary: 'Team', colorToken: 'teal', selected: true },
  { id: 'holidays@x', summary: 'Holidays', colorToken: 'olive', selected: false }
]

describe('tokenColorName / tokenColorClasses (shared-calendars-v1 — surface token → classes)', () => {
  it('narrows a known token name', () => {
    expect(tokenColorName('teal')).toBe('teal')
    expect(tokenColorName('olive')).toBe('olive')
    expect(tokenColorName('blue')).toBe('blue')
  })
  it('degrades an absent/odd token to gray (never a wrong hue)', () => {
    expect(tokenColorName(undefined)).toBe('gray')
    expect(tokenColorName('')).toBe('gray')
    expect(tokenColorName('chartreuse')).toBe('gray')
  })
  it('returns token class strings (no raw hex) for the new hues', () => {
    expect(tokenColorClasses('teal').dot).toBe('bg-event-teal')
    expect(tokenColorClasses('cyan').bar).toContain('border-event-cyan')
    expect(JSON.stringify(tokenColorClasses('magenta'))).not.toMatch(/#/)
    // an odd token still yields a valid (gray) pair
    expect(tokenColorClasses('nope').dot).toBe('bg-event-gray')
  })
})

describe('colorTokenFor / eventColorClassesByCalendar (FR-005/FR-007 — chip colored by owner)', () => {
  it('resolves an event to its owning calendar token', () => {
    expect(colorTokenFor({ id: 'a', calendarId: 'team@x' }, calendars)).toBe('teal')
    expect(colorTokenFor({ id: 'b', calendarId: 'holidays@x' }, calendars)).toBe('olive')
    expect(colorTokenFor({ id: 'c', calendarId: 'primary' }, calendars)).toBe('blue')
  })
  it('matches the legend swatch token (chip == swatch, no drift)', () => {
    const ev = { id: 'a', calendarId: 'team@x' }
    expect(eventColorClassesByCalendar(ev, calendars).dot).toBe(tokenColorClasses('teal').dot)
  })
  it('degrades to gray for no calendarId (single-primary path), unmatched id, or no calendars', () => {
    expect(colorTokenFor({ id: 'a' }, calendars)).toBe('gray')
    expect(colorTokenFor({ id: 'a', calendarId: 'ghost' }, calendars)).toBe('gray')
    expect(colorTokenFor({ id: 'a', calendarId: 'team@x' }, undefined)).toBe('gray')
    expect(eventColorClassesByCalendar({ id: 'a' }, undefined).dot).toBe('bg-event-gray')
  })
})

describe('seedHiddenCalendarIds (FR-010 — seed from Google selected===false)', () => {
  it('hides exactly the calendars whose selected is explicitly false', () => {
    const hidden = seedHiddenCalendarIds(calendars)
    expect(hidden.has('holidays@x')).toBe(true)
    expect(hidden.has('primary')).toBe(false)
    expect(hidden.has('team@x')).toBe(false)
    expect(hidden.size).toBe(1)
  })
  it('starts a calendar SHOWN when selected is absent/true', () => {
    const hidden = seedHiddenCalendarIds([
      { id: 'a' },
      { id: 'b', selected: true }
    ])
    expect(hidden.size).toBe(0)
  })
  it('degrades a non-array / id-less entry to an empty set (never throws)', () => {
    expect(seedHiddenCalendarIds(undefined).size).toBe(0)
    expect(seedHiddenCalendarIds([{ selected: false } as CalendarLegendData]).size).toBe(0)
  })
})

describe('visibleEvents (calendar-selection-persistence — the single visibility filter all three views apply)', () => {
  const a: EventChipData = { id: 'a1', start: '2026-06-16T09:00:00-07:00', calendarId: 'team@x' }
  const b: EventChipData = { id: 'b1', start: '2026-06-16T10:00:00-07:00', calendarId: 'holidays@x' }
  const noCal: EventChipData = { id: 'c1', start: '2026-06-16T11:00:00-07:00' } // single-primary path
  const events = [a, b, noCal]

  it('drops events owned by a HIDDEN calendar, keeps the rest', () => {
    const out = visibleEvents(events, new Set(['holidays@x']))
    expect(out.map((e) => e.id)).toEqual(['a1', 'c1'])
  })

  it('honors a MULTI-id hidden set (a deselected calendar disappears uniformly)', () => {
    const out = visibleEvents(events, new Set(['team@x', 'holidays@x']))
    // Only the calendar-less event survives; both tagged calendars are hidden.
    expect(out.map((e) => e.id)).toEqual(['c1'])
  })

  it('an EMPTY selection (no calendars hidden) is a pass-through — every event visible', () => {
    expect(visibleEvents(events, new Set()).map((e) => e.id)).toEqual(['a1', 'b1', 'c1'])
  })

  it('an ABSENT hidden set passes every event through (the single-primary / no-legend path)', () => {
    expect(visibleEvents(events, undefined).map((e) => e.id)).toEqual(['a1', 'b1', 'c1'])
  })

  it('an event with NO calendarId is always visible (it has no calendar to hide against)', () => {
    expect(visibleEvents([noCal], new Set(['anything'])).map((e) => e.id)).toEqual(['c1'])
  })

  it('degrades a non-array events input to [] (never throws)', () => {
    expect(visibleEvents(undefined, new Set(['team@x']))).toEqual([])
  })

  // calendar-week-day-views deselect REGRESSION: the WEEK/DAY schedule path runs the SAME
  // `visibleEvents` filter as the month grid (ScheduleView calls it before laying events into
  // DayColumns). Timed events carrying calendarId + start/end (the schedule shape) must drop
  // out exactly like the month all-day events do — so a deselected calendar disappears in
  // week/day too. This asserts the shared filter is field-correct for the schedule shape.
  it('drops timed (week/day schedule) events owned by a hidden calendar', () => {
    const timedTeam: EventChipData = {
      id: 'wt1',
      start: '2026-06-16T09:30:00-07:00',
      end: '2026-06-16T10:00:00-07:00',
      allDay: false,
      calendarId: 'team@x'
    }
    const timedHol: EventChipData = {
      id: 'wh1',
      start: '2026-06-16T11:00:00-07:00',
      end: '2026-06-16T12:00:00-07:00',
      allDay: false,
      calendarId: 'holidays@x'
    }
    const out = visibleEvents([timedTeam, timedHol], new Set(['holidays@x']))
    expect(out.map((e) => e.id)).toEqual(['wt1'])
  })
})

describe('hiddenCalendarsKey (calendar-selection-persistence — STABLE content key drives the per-view memo)', () => {
  // The regression: a `useMemo`/`React.memo` keyed on the hidden SET object identity could miss a
  // deselect in the week/day schedule. The catalog now keys its visibility memo on this CONTENT
  // string, so two DIFFERENT-content sets always produce different keys (forcing recompute), and
  // two SAME-content sets (regardless of object identity / insertion order) produce equal keys.
  it('changes when the set CONTENT changes (hide then show toggles the key)', () => {
    const shown = hiddenCalendarsKey(new Set())
    const hidOne = hiddenCalendarsKey(new Set(['holidays@x']))
    const hidTwo = hiddenCalendarsKey(new Set(['holidays@x', 'team@x']))
    expect(shown).not.toBe(hidOne)
    expect(hidOne).not.toBe(hidTwo)
  })

  it('is STABLE across object identity + insertion order (same content ⇒ same key)', () => {
    const a = hiddenCalendarsKey(new Set(['team@x', 'holidays@x']))
    const b = hiddenCalendarsKey(new Set(['holidays@x', 'team@x'])) // different identity + order
    expect(a).toBe(b)
  })

  it('empty / absent ⇒ the no-op empty key', () => {
    expect(hiddenCalendarsKey(new Set())).toBe('')
    expect(hiddenCalendarsKey(undefined)).toBe('')
  })
})

describe('buildMonthGrid hidden-calendar filter (FR-011 — legend toggle hides events)', () => {
  const teamEvent: EventChipData = { id: 't1', start: '2026-06-17', allDay: true, calendarId: 'team@x' }
  const holEvent: EventChipData = { id: 'h1', start: '2026-06-17', allDay: true, calendarId: 'holidays@x' }

  it('drops events owned by a hidden calendar', () => {
    const grid = buildMonthGrid(
      [teamEvent, holEvent],
      window.timeMin,
      now,
      'sunday',
      new Set(['holidays@x'])
    )
    const placed = grid.cells.flatMap((c) => c.events).map((e) => e.id)
    expect(placed).toEqual(['t1'])
  })
  it('keeps all events when the hidden set is empty/absent (no-op filter)', () => {
    const all = buildMonthGrid([teamEvent, holEvent], window.timeMin, now)
    expect(all.cells.flatMap((c) => c.events)).toHaveLength(2)
    const empty = buildMonthGrid([teamEvent, holEvent], window.timeMin, now, 'sunday', new Set())
    expect(empty.cells.flatMap((c) => c.events)).toHaveLength(2)
  })
  it('never filters an event with no calendarId (single-primary path unaffected)', () => {
    const primaryOnly: EventChipData = { id: 'p1', start: '2026-06-17', allDay: true }
    const grid = buildMonthGrid([primaryOnly], window.timeMin, now, 'sunday', new Set(['holidays@x']))
    expect(grid.cells.flatMap((c) => c.events)).toHaveLength(1)
  })
})

describe('dayCellAriaLabel (design §6 — full day for a screen reader)', () => {
  it('composes weekday, today, and the event list', () => {
    const cell: DayCellData = {
      dateKey: '2026-06-16',
      dateLabel: '16',
      inMonth: true,
      isToday: true,
      events: [timed, allDay]
    }
    const label = dayCellAriaLabel(cell)
    expect(label).toContain('Tuesday June 16')
    expect(label).toContain('today')
    expect(label).toContain('2 events')
    expect(label).toContain('Standup')
    expect(label).toContain('Holiday all day')
  })

  it('says "no events" for an empty day and marks an out-of-month day', () => {
    const cell: DayCellData = {
      dateKey: '2026-05-31',
      dateLabel: '31',
      inMonth: false,
      isToday: false,
      events: []
    }
    const label = dayCellAriaLabel(cell)
    expect(label).toContain('other month')
    expect(label).toContain('no events')
  })

  it('uses the singular noun for a single event', () => {
    const cell: DayCellData = {
      dateKey: '2026-06-17',
      dateLabel: '17',
      inMonth: true,
      isToday: false,
      events: [allDay]
    }
    expect(dayCellAriaLabel(cell)).toContain('1 event:')
  })
})
