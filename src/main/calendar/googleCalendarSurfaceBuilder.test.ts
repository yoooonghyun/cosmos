import { describe, it, expect } from 'vitest'
import {
  buildDefaultViewSurface,
  buildNoticeSurface,
  buildSharedViewSurface,
  SURFACE_DEFAULT_VIEW,
  type GoogleCalendarSharedView
} from './googleCalendarSurfaceBuilder'
import type {
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleCalendarEventsPage
} from '../../shared/types/googleCalendar'

const timed: GoogleCalendarEvent = {
  id: 'e1',
  summary: 'Standup',
  start: '2026-06-16T09:00:00-07:00',
  end: '2026-06-16T09:15:00-07:00',
  allDay: false,
  timeZone: 'America/Los_Angeles',
  location: 'Room 1'
}

const allDay: GoogleCalendarEvent = {
  id: 'e2',
  summary: 'Holiday',
  start: '2026-06-17',
  end: '2026-06-18',
  allDay: true
}

const window = { timeMin: '2026-06-15T00:00:00Z', timeMax: '2026-06-22T00:00:00Z' }

describe('buildDefaultViewSurface', () => {
  it('composes an EventList carrying the events + the labeled window', () => {
    const page: GoogleCalendarEventsPage = { items: [timed, allDay] }
    const surface = buildDefaultViewSurface(page, window)
    expect(surface.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
    const root = surface.components[0] as Record<string, unknown>
    expect(root.component).toBe('EventList')
    expect(root.timeMin).toBe(window.timeMin)
    expect(root.timeMax).toBe(window.timeMax)
    const events = root.events as Array<Record<string, unknown>>
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('e1')
    expect(events[0].allDay).toBe(false)
    expect(events[0].location).toBe('Room 1')
    expect(events[1].allDay).toBe(true)
    // optional fields absent on the all-day event must not appear
    expect('timeZone' in events[1]).toBe(false)
    expect('location' in events[1]).toBe(false)
  })

  it('reports hasMore=true when the page has a next cursor', () => {
    const page: GoogleCalendarEventsPage = { items: [timed], nextCursor: 'tok' }
    const root = buildDefaultViewSurface(page, window).components[0] as Record<string, unknown>
    expect(root.hasMore).toBe(true)
  })

  it('reports hasMore=false and an empty events array for a 0-event page (no error)', () => {
    const page: GoogleCalendarEventsPage = { items: [] }
    const root = buildDefaultViewSurface(page, window).components[0] as Record<string, unknown>
    expect(root.hasMore).toBe(false)
    expect(root.events).toEqual([])
  })

  it('carries no token/secret field in the composed surface', () => {
    const page: GoogleCalendarEventsPage = { items: [timed] }
    const json = JSON.stringify(buildDefaultViewSurface(page, window))
    expect(json.toLowerCase()).not.toContain('token')
    expect(json.toLowerCase()).not.toContain('secret')
  })
})

/* shared-calendars-v1 — the SHARED/multi-calendar default view (FR-004/FR-008/FR-016):
 * one EventList root carrying the per-calendar legend (each entry with its RESOLVED
 * color token) + the merged events, each tagged with its owning calendarId. */

describe('buildSharedViewSurface', () => {
  const calendars: GoogleCalendar[] = [
    { id: 'me@x', summary: 'Me', primary: true, backgroundColor: '#4986e7', selected: true }, // Blueberry → blue
    { id: 'team@x', summary: 'Team', selected: true },
    { id: 'holidays@x', summary: 'Holidays', selected: false }
  ]
  const view: GoogleCalendarSharedView = {
    calendars,
    events: [
      { ...timed, calendarId: 'me@x' },
      { ...allDay, calendarId: 'holidays@x' }
    ]
  }

  it('emits an EventList carrying the legend (resolved tokens) + per-event calendarId', () => {
    const surface = buildSharedViewSurface(view, window)
    expect(surface.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
    const root = surface.components[0] as Record<string, unknown>
    expect(root.component).toBe('EventList')

    const legend = root.calendars as Array<Record<string, unknown>>
    expect(legend).toHaveLength(3)
    // the recognized GCal blue hex resolves to the cosmos blue token (FR-007)
    expect(legend[0]).toMatchObject({ id: 'me@x', summary: 'Me', colorToken: 'blue', primary: true })
    // a calendar with no backgroundColor still gets a bounded token (never raw hex / undefined)
    expect(typeof legend[1].colorToken).toBe('string')
    expect(legend[2]).toMatchObject({ id: 'holidays@x', selected: false })

    const events = root.events as Array<Record<string, unknown>>
    expect(events[0].calendarId).toBe('me@x')
    expect(events[1].calendarId).toBe('holidays@x')
    expect(root.hasMore).toBe(false)
  })

  it('the legend swatch token equals the chip token for the same calendar (no drift)', () => {
    const root = buildSharedViewSurface(view, window).components[0] as Record<string, unknown>
    const legend = root.calendars as Array<Record<string, unknown>>
    // resolved-once-in-the-builder: there is a single token per calendar id on the surface
    const myEntry = legend.find((c) => c.id === 'me@x')
    expect(myEntry?.colorToken).toBe('blue')
  })

  it('carries NO backgroundColor hex and NO token/secret in the composed surface', () => {
    const json = JSON.stringify(buildSharedViewSurface(view, window))
    expect(json).not.toContain('#4986e7')
    expect(json.toLowerCase()).not.toContain('secret')
    // "token" appears as the field name colorToken — assert no auth-token-like value leaked
    expect(json.toLowerCase()).not.toContain('accesstoken')
  })

  it('still renders for a single/primary-only calendars set (additive, backward-compatible)', () => {
    const single: GoogleCalendarSharedView = {
      calendars: [{ id: 'me@x', summary: 'Me', primary: true }],
      events: [{ ...timed, calendarId: 'me@x' }]
    }
    const root = buildSharedViewSurface(single, window).components[0] as Record<string, unknown>
    expect(root.component).toBe('EventList')
    expect((root.calendars as unknown[]).length).toBe(1)
  })
})

/* calendar-event-detail-v1 (FR-007/FR-008/FR-010/FR-011): eventRow carries the enriched
 * NON-SECRET detail fields when present and omits them (no undefined keys) when absent. */
describe('buildDefaultViewSurface — event-detail enrichment passthrough', () => {
  const detailed: GoogleCalendarEvent = {
    id: 'e9',
    summary: 'Planning',
    start: '2026-06-20T09:00:00-07:00',
    end: '2026-06-20T10:00:00-07:00',
    allDay: false,
    description: 'Quarterly planning',
    attendees: [{ displayName: 'Ada', email: 'ada@x', organizer: true }],
    htmlLink: 'https://calendar.google.com/event?eid=abc',
    recurring: true
  }

  it('carries description/attendees/htmlLink/recurring through to the EventList event', () => {
    const page: GoogleCalendarEventsPage = { items: [detailed] }
    const root = buildDefaultViewSurface(page, window).components[0] as Record<string, unknown>
    const event = (root.events as Array<Record<string, unknown>>)[0]
    expect(event.description).toBe('Quarterly planning')
    expect(event.htmlLink).toBe('https://calendar.google.com/event?eid=abc')
    expect(event.recurring).toBe(true)
    expect(event.attendees).toEqual([{ displayName: 'Ada', email: 'ada@x', organizer: true }])
  })

  it('omits the detail fields (no undefined keys) when the event lacks them', () => {
    const bare: GoogleCalendarEvent = {
      id: 'e10',
      summary: 'Quiet',
      start: '2026-06-20T09:00:00-07:00',
      end: '2026-06-20T10:00:00-07:00',
      allDay: false
    }
    const root = buildDefaultViewSurface({ items: [bare] }, window).components[0] as Record<
      string,
      unknown
    >
    const event = (root.events as Array<Record<string, unknown>>)[0]
    expect('description' in event).toBe(false)
    expect('attendees' in event).toBe(false)
    expect('htmlLink' in event).toBe(false)
    expect('recurring' in event).toBe(false)
  })
})

describe('buildNoticeSurface', () => {
  it('composes a single colored Notice at the default-view surfaceId', () => {
    const surface = buildNoticeSurface({ kind: 'error', message: 'Calendar is busy — retry.' })
    expect(surface.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
    const root = surface.components[0] as Record<string, unknown>
    expect(root.component).toBe('Notice')
    expect(root.noticeKind).toBe('error')
    expect(root.message).toBe('Calendar is busy — retry.')
  })
})
