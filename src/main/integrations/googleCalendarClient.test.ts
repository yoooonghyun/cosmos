import { describe, it, expect } from 'vitest'
import {
  GoogleCalendarClient,
  mapGoogleCalendarError,
  toCalendar,
  toEvent,
  type FetchLike,
  type GoogleHttpResponse
} from './googleCalendarClient'

describe('mapGoogleCalendarError', () => {
  it('maps HTTP 429 to rate_limited and honors Retry-After', () => {
    const e = mapGoogleCalendarError(429, 30)
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAfterSeconds).toBe(30)
    expect(e.message).toMatch(/busy/i)
  })
  it('maps 401 / 403 to reconnect_needed', () => {
    expect(mapGoogleCalendarError(401).kind).toBe('reconnect_needed')
    expect(mapGoogleCalendarError(403).kind).toBe('reconnect_needed')
  })
  it('maps other HTTP errors to network (recoverable)', () => {
    expect(mapGoogleCalendarError(500).kind).toBe('network')
  })
})

describe('toEvent (all-day vs timed normalization)', () => {
  it('maps a timed event with dateTime + timeZone', () => {
    const e = toEvent({
      id: 'e1',
      summary: 'Standup',
      start: { dateTime: '2026-06-16T09:00:00-07:00', timeZone: 'America/Los_Angeles' },
      end: { dateTime: '2026-06-16T09:15:00-07:00' },
      location: 'Room 1'
    })
    expect(e).toEqual({
      id: 'e1',
      summary: 'Standup',
      start: '2026-06-16T09:00:00-07:00',
      end: '2026-06-16T09:15:00-07:00',
      allDay: false,
      timeZone: 'America/Los_Angeles',
      location: 'Room 1'
    })
  })

  it('maps an all-day event (date only) with allDay true and no timeZone', () => {
    const e = toEvent({ id: 'e2', summary: 'Holiday', start: { date: '2026-06-17' }, end: { date: '2026-06-18' } })
    expect(e?.allDay).toBe(true)
    expect(e?.start).toBe('2026-06-17')
    expect('timeZone' in (e as object)).toBe(false)
  })

  it('defaults a missing summary to "" (missing-optional must not error)', () => {
    const e = toEvent({ id: 'e3', start: { dateTime: '2026-06-16T09:00:00Z' }, end: { dateTime: '2026-06-16T10:00:00Z' } })
    expect(e?.summary).toBe('')
  })

  it('drops a malformed event missing id or start/end (returns undefined, no throw)', () => {
    expect(toEvent({ start: { dateTime: 'x' }, end: { dateTime: 'y' } })).toBeUndefined()
    expect(toEvent({ id: 'e4', start: {}, end: {} })).toBeUndefined()
    expect(toEvent(null)).toBeUndefined()
  })

  /* calendar-event-detail-v1 (FR-007/FR-008/FR-010/FR-011): the read mapping enriches the
   * event with the NON-SECRET detail fields without a new fetch, and never leaks a token. */
  it('maps description/attendees/htmlLink and a recurring marker (non-secret)', () => {
    const e = toEvent({
      id: 'e5',
      summary: 'Planning',
      start: { dateTime: '2026-06-20T09:00:00-07:00' },
      end: { dateTime: '2026-06-20T10:00:00-07:00' },
      description: 'Quarterly planning',
      htmlLink: 'https://calendar.google.com/event?eid=abc',
      recurringEventId: 'series-1',
      attendees: [
        { displayName: 'Ada', email: 'ada@x', self: true, responseStatus: 'accepted' },
        { email: 'bob@x', organizer: true }
      ]
    })
    expect(e?.description).toBe('Quarterly planning')
    expect(e?.htmlLink).toBe('https://calendar.google.com/event?eid=abc')
    expect(e?.recurring).toBe(true)
    expect(e?.attendees).toEqual([
      { displayName: 'Ada', email: 'ada@x', self: true, responseStatus: 'accepted' },
      { email: 'bob@x', organizer: true }
    ])
  })

  it('omits absent detail fields (missing-optional must not error or add keys)', () => {
    const e = toEvent({
      id: 'e6',
      summary: 'Quiet',
      start: { dateTime: '2026-06-20T09:00:00Z' },
      end: { dateTime: '2026-06-20T10:00:00Z' }
    }) as object
    expect('description' in e).toBe(false)
    expect('attendees' in e).toBe(false)
    expect('htmlLink' in e).toBe(false)
    expect('recurring' in e).toBe(false)
  })

  it('drops an attendee with no name AND no email, and an unknown responseStatus', () => {
    const e = toEvent({
      id: 'e7',
      start: { dateTime: '2026-06-20T09:00:00Z' },
      end: { dateTime: '2026-06-20T10:00:00Z' },
      attendees: [{ responseStatus: 'maybe' }, { email: 'c@x', responseStatus: 'weird' }]
    })
    expect(e?.attendees).toEqual([{ email: 'c@x' }])
  })

  it('does not read any token/secret field off the raw event', () => {
    const e = toEvent({
      id: 'e8',
      summary: 'Has noise',
      start: { dateTime: '2026-06-20T09:00:00Z' },
      end: { dateTime: '2026-06-20T10:00:00Z' },
      accessToken: 'SECRET',
      iCalUID: 'uid@x'
    }) as unknown as Record<string, unknown>
    expect('accessToken' in e).toBe(false)
    expect(JSON.stringify(e).toLowerCase()).not.toContain('secret')
  })
})

describe('toCalendar (shared-calendars-v1 — calendarList item → non-secret GoogleCalendar)', () => {
  it('maps id/summary/backgroundColor/primary/accessRole/selected', () => {
    const c = toCalendar({
      id: 'team@x',
      summary: 'Team',
      backgroundColor: '#16a765',
      primary: false,
      accessRole: 'reader',
      selected: true
    })
    expect(c).toEqual({
      id: 'team@x',
      summary: 'Team',
      backgroundColor: '#16a765',
      accessRole: 'reader',
      selected: true
    })
  })

  it('prefers summaryOverride over summary (the per-account rename)', () => {
    expect(toCalendar({ id: 'a', summary: 'Real', summaryOverride: 'My name' })?.summary).toBe('My name')
  })

  it('marks the primary calendar and omits absent optionals (missing-optional must not error)', () => {
    const c = toCalendar({ id: 'me@x', summary: 'Me', primary: true })
    expect(c?.primary).toBe(true)
    expect('backgroundColor' in (c as object)).toBe(false)
    expect('selected' in (c as object)).toBe(false)
  })

  it('drops a malformed item missing id (returns undefined, no throw)', () => {
    expect(toCalendar({ summary: 'No id' })).toBeUndefined()
    expect(toCalendar(null)).toBeUndefined()
    expect(toCalendar({ id: '' })).toBeUndefined()
  })
})

function res(body: unknown, status = 200, retryAfter?: string): GoogleHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    json: async () => body
  }
}

const auth = { token: 'at-test' }

describe('GoogleCalendarClient.getPrimaryCalendar', () => {
  it('reads identity (id/summary/timeZone) from the primary calendar', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ id: 'me@example.com', summary: 'Me', timeZone: 'America/Los_Angeles' })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.getPrimaryCalendar(auth)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toEqual({ id: 'me@example.com', summary: 'Me', timeZone: 'America/Los_Angeles' })
    }
    expect(capturedUrl).toBe('https://api.test/calendars/primary')
  })

  it('maps a 401 to reconnect_needed (no crash)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 401)
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.getPrimaryCalendar(auth)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.kind).toBe('reconnect_needed')
    }
  })
})

describe('GoogleCalendarClient.listCalendars (shared-calendars-v1, FR-001)', () => {
  it('GETs the calendarList path and maps items, dropping malformed ones', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({
        items: [
          { id: 'me@x', summary: 'Me', primary: true, backgroundColor: '#4986e7' },
          { id: 'team@x', summary: 'Team', selected: false },
          { summary: 'No id — dropped' }
        ]
      })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listCalendars(auth)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.map((c) => c.id)).toEqual(['me@x', 'team@x'])
      expect(r.data[0].primary).toBe(true)
      expect(r.data[1].selected).toBe(false)
    }
    expect(capturedUrl).toBe('https://api.test/users/me/calendarList')
  })

  it('maps a 403 to reconnect_needed (no crash)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 403)
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listCalendars(auth)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.kind).toBe('reconnect_needed')
    }
  })

  it('returns an empty list when items is absent (missing-optional must not error)', async () => {
    const fetchImpl: FetchLike = async () => res({})
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listCalendars(auth)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toEqual([])
    }
  })
})

describe('GoogleCalendarClient.listEvents', () => {
  it('maps events and exposes nextPageToken as the cursor', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({
        items: [
          { id: 'e1', summary: 'A', start: { dateTime: '2026-06-16T09:00:00Z' }, end: { dateTime: '2026-06-16T10:00:00Z' } }
        ],
        nextPageToken: 'PAGE2'
      })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listEvents(auth, '2026-06-15T00:00:00Z', '2026-06-22T00:00:00Z')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.items).toHaveLength(1)
      expect(r.data.items[0].id).toBe('e1')
      expect(r.data.nextCursor).toBe('PAGE2')
    }
    expect(capturedUrl).toContain('/calendars/primary/events?')
    expect(capturedUrl).toContain('singleEvents=true')
    expect(capturedUrl).toContain('orderBy=startTime')
    expect(capturedUrl).toContain('timeMin=2026-06-15')
  })

  it('reads a NON-primary calendar by URL-encoded id (shared-calendars-v1, FR-004)', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ items: [] })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    await client.listEvents(auth, 'a', 'b', undefined, 'team+room@group.calendar.google.com')
    expect(capturedUrl).toContain('/calendars/team%2Broom%40group.calendar.google.com/events?')
  })

  it('defaults to the primary calendar when no calendarId is given (back-compat)', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ items: [] })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    await client.listEvents(auth, 'a', 'b')
    expect(capturedUrl).toContain('/calendars/primary/events?')
  })

  it('passes the cursor as pageToken', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ items: [] })
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    await client.listEvents(auth, 'a', 'b', 'CURSOR')
    expect(capturedUrl).toContain('pageToken=CURSOR')
  })

  it('returns an empty page with no cursor when there are no items', async () => {
    const fetchImpl: FetchLike = async () => res({ items: [] })
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listEvents(auth, 'a', 'b')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.items).toEqual([])
      expect(r.data.nextCursor).toBeUndefined()
    }
  })

  it('surfaces a network error when fetch throws (no crash)', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('offline')
    }
    const client = new GoogleCalendarClient({ fetchImpl, apiBase: 'https://api.test' })
    const r = await client.listEvents(auth, 'a', 'b')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.kind).toBe('network')
    }
  })
})
