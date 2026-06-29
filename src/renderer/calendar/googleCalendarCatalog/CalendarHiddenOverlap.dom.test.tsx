/**
 * Regression (calendar-hidden-overlapping-event-remains-v1): in the week/day schedule, hiding
 * a calendar in the legend must remove EVERY one of its events — including ones laid out in an
 * OVERLAP lane-split (whether they overlap each other or an event on a still-visible calendar).
 *
 * Renders the REAL EventList → ScheduleView → DayColumn → EventBlock render path (the layer the
 * report blamed) and drives the REAL legend toggle. The pure logic.test / scheduleLayout.test
 * cover the filter + lane math in isolation; these rows guard the END-TO-END render so a future
 * change to the filter wiring, the lane keys, or the visibility memo can't silently regress
 * "hiding leaves overlapping events on the grid".
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EventList } from './components'
import type { EventChipData, CalendarLegendData } from './logic'

// EventList only needs `useDispatchAction` from the SDK; the open-detail dispatch is irrelevant
// to the visibility filter under test, so stub it (avoids standing up the full ActionProvider).
vi.mock('@a2ui-sdk/react/0.9', () => ({
  useDispatchAction: () => () => {}
}))

const DAY = '2026-06-17'

function ev(id: string, summary: string, calendarId: string, from: string, to: string): EventChipData {
  return { id, summary, start: `${DAY}T${from}:00-07:00`, end: `${DAY}T${to}:00-07:00`, allDay: false, calendarId }
}

const legend: CalendarLegendData[] = [
  { id: 'cal-a', summary: 'Calendar A', colorToken: 'event-blue' },
  { id: 'cal-b', summary: 'Calendar B', colorToken: 'event-teal' }
]

function renderSchedule(events: EventChipData[], view: 'week' | 'day'): void {
  const timeMax = view === 'day' ? '2026-06-18T00:00:00-07:00' : '2026-06-21T00:00:00-07:00'
  render(
    <EventList
      surfaceId="s"
      componentId="c"
      events={events}
      calendars={legend}
      view={view}
      timeMin={`${DAY}T00:00:00-07:00`}
      timeMax={timeMax}
    />
  )
}

describe('hiding a calendar removes its OVERLAPPING week/day events', () => {
  it('drops two cal-a events that overlap EACH OTHER (same-calendar lane split)', () => {
    renderSchedule(
      [ev('a1', 'A One', 'cal-a', '09:00', '10:00'), ev('a2', 'A Two', 'cal-a', '09:30', '10:30'), ev('b1', 'B One', 'cal-b', '13:00', '14:00')],
      'week'
    )
    expect(screen.getByRole('button', { name: 'Open A One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open A Two' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Hide Calendar A' }))

    expect(screen.queryByRole('button', { name: 'Open A One' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open A Two' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open B One' })).toBeInTheDocument()
  })

  it('drops a cal-a event that overlaps a still-VISIBLE cal-b event (cross-calendar lane split)', () => {
    renderSchedule(
      [ev('a1', 'A One', 'cal-a', '09:00', '10:00'), ev('x1', 'X One', 'cal-b', '09:30', '10:30')],
      'day'
    )
    expect(screen.getByRole('button', { name: 'Open A One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open X One' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Hide Calendar A' }))

    expect(screen.queryByRole('button', { name: 'Open A One' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open X One' })).toBeInTheDocument()
  })

  it('drops the cal-a copy of a SHARED meeting carrying the same event id as the cal-b copy (dup React key)', () => {
    // Google reuses one event id across attendee copies, so a meeting on two subscribed calendars
    // yields two identical-id, identical-time (perfectly overlapping) blocks — a duplicate React key.
    renderSchedule(
      [ev('m1', 'Meeting A-copy', 'cal-a', '09:00', '10:00'), ev('m1', 'Meeting B-copy', 'cal-b', '09:00', '10:00')],
      'week'
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Hide Calendar A' }))
    const remaining = screen.queryAllByRole('button', { name: /Open Meeting/ }).map((b) => b.getAttribute('aria-label'))
    expect(remaining).toEqual(['Open Meeting B-copy'])
  })
})
