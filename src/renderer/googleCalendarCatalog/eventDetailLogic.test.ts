import { describe, it, expect } from 'vitest'
import {
  CALENDAR_OPEN_DETAIL_ACTION,
  attendeeList,
  descriptionText,
  detailTitle,
  eventWhen,
  hasAttendees,
  hasLocation,
  isOpenDetailEmittable,
  isRecurringInstance,
  NO_DESCRIPTION_LABEL,
  openInGoogleUrl
} from './eventDetailLogic'
import type { EventChipData } from './logic'

/* The nav action is a renderer-local signal — must NOT be a googleCalendar.* name so the
 * panel's onAction seam handles it locally and never forwards it to main/agent. */
describe('CALENDAR_OPEN_DETAIL_ACTION (renderer-local nav signal, FR-001)', () => {
  it('is the stable calendarNav.openDetail name, never a googleCalendar.* action', () => {
    expect(CALENDAR_OPEN_DETAIL_ACTION).toBe('calendarNav.openDetail')
    expect(CALENDAR_OPEN_DETAIL_ACTION.startsWith('googleCalendar.')).toBe(false)
  })
})

describe('isOpenDetailEmittable', () => {
  it('true only for a non-blank string id', () => {
    expect(isOpenDetailEmittable('e1')).toBe(true)
    expect(isOpenDetailEmittable('')).toBe(false)
    expect(isOpenDetailEmittable('   ')).toBe(false)
    expect(isOpenDetailEmittable(undefined)).toBe(false)
  })
})

describe('detailTitle (FR-004)', () => {
  it('returns the summary when present', () => {
    expect(detailTitle({ summary: 'Standup' })).toBe('Standup')
  })
  it('degrades a blank/absent title to "(no title)"', () => {
    expect(detailTitle({ summary: '' })).toBe('(no title)')
    expect(detailTitle({ summary: '   ' })).toBe('(no title)')
    expect(detailTitle({})).toBe('(no title)')
  })
})

describe('eventWhen (FR-005)', () => {
  it('timed same-day → one line with a start–end clock range, no all-day pill', () => {
    const w = eventWhen({
      summary: 'Standup',
      start: '2026-06-20T09:30:00-07:00',
      end: '2026-06-20T10:00:00-07:00',
      allDay: false
    })
    expect(w.kind).toBe('timed-same-day')
    expect(w.allDay).toBe(false)
    // The clock range is present (locale-formatted); both endpoints appear.
    expect(w.primary).toMatch(/–/)
    expect(w.startLabel).toBeUndefined()
  })

  it('timed multi-day → two labels (Starts / Ends), each with a date + time', () => {
    const w = eventWhen({
      summary: 'Conference',
      start: '2026-06-20T09:30:00-07:00',
      end: '2026-06-21T10:00:00-07:00',
      allDay: false
    })
    expect(w.kind).toBe('timed-multi-day')
    expect(w.startLabel).toMatch(/^Starts /)
    expect(w.endLabel).toMatch(/^Ends /)
  })

  it('all-day single → the date + all-day flag, no clock time', () => {
    const w = eventWhen({ summary: 'Holiday', start: '2026-06-20', end: '2026-06-21', allDay: true })
    expect(w.kind).toBe('all-day-single')
    expect(w.allDay).toBe(true)
    // No clock time (no AM/PM, no ":") in an all-day label.
    expect(w.primary).not.toMatch(/\d:\d\d/)
  })

  it('all-day multi-day → INCLUSIVE range correcting Google exclusive end', () => {
    // Google end is the EXCLUSIVE day after the last day. Jun 20..22 inclusive ⇒ end=Jun 23.
    const w = eventWhen({ summary: 'Trip', start: '2026-06-20', end: '2026-06-23', allDay: true })
    expect(w.kind).toBe('all-day-multi-day')
    expect(w.allDay).toBe(true)
    // The inclusive last day is the 22nd (end-1), NOT the 23rd (the exclusive end).
    expect(w.primary).toMatch(/22/)
    expect(w.primary).not.toMatch(/23/)
    expect(w.primary).toMatch(/20/)
  })

  it('all-day where end is the very next day → treated as a SINGLE day (not a range)', () => {
    const w = eventWhen({ summary: 'Day off', start: '2026-06-20', end: '2026-06-21', allDay: true })
    expect(w.kind).toBe('all-day-single')
    expect(w.primary).toMatch(/20/)
  })

  it('unparseable start → kind "unknown", best-effort primary, never throws', () => {
    const w = eventWhen({ summary: 'Broken', start: 'not-a-date', end: 'also-bad', allDay: false })
    expect(w.kind).toBe('unknown')
    expect(w.primary).toBe('not-a-date')
  })

  it('timed with absent end → single-day label with just the start', () => {
    const w = eventWhen({ summary: 'Open-ended', start: '2026-06-20T09:30:00-07:00', allDay: false })
    expect(w.kind).toBe('timed-same-day')
    expect(typeof w.primary).toBe('string')
  })
})

describe('hasLocation (FR-006)', () => {
  it('true only for a non-blank location', () => {
    expect(hasLocation({ summary: 'x', location: 'Room 1' })).toBe(true)
    expect(hasLocation({ summary: 'x', location: '' })).toBe(false)
    expect(hasLocation({ summary: 'x', location: '   ' })).toBe(false)
    expect(hasLocation({ summary: 'x' })).toBe(false)
  })
})

describe('descriptionText (FR-007)', () => {
  it('returns the description when present', () => {
    expect(descriptionText({ summary: 'x', description: 'Agenda here' })).toBe('Agenda here')
  })
  it('returns null (→ "No description" fallback) when absent/blank', () => {
    expect(descriptionText({ summary: 'x' })).toBeNull()
    expect(descriptionText({ summary: 'x', description: '' })).toBeNull()
    expect(descriptionText({ summary: 'x', description: '  ' })).toBeNull()
    expect(NO_DESCRIPTION_LABEL).toBe('No description')
  })
})

describe('attendeeList / hasAttendees (FR-008)', () => {
  it('normalizes name → email → (unknown), carrying optional markers', () => {
    const event: EventChipData = {
      summary: 'Sync',
      attendees: [
        { displayName: 'Ada Lovelace', email: 'ada@x', self: true, responseStatus: 'accepted' },
        { email: 'bob@x', organizer: true },
        {}
      ]
    }
    const list = attendeeList(event)
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ label: 'Ada Lovelace', self: true, responseStatus: 'accepted' })
    expect(list[1]).toMatchObject({ label: 'bob@x', organizer: true })
    expect(list[2].label).toBe('(unknown)')
    // No undefined marker keys leak onto a bare attendee.
    expect('self' in list[2]).toBe(false)
    expect('organizer' in list[2]).toBe(false)
  })

  it('hasAttendees omits the section when absent / empty / non-array', () => {
    expect(hasAttendees({ summary: 'x' })).toBe(false)
    expect(hasAttendees({ summary: 'x', attendees: [] })).toBe(false)
    expect(hasAttendees({ summary: 'x', attendees: { not: 'array' } as never })).toBe(false)
    expect(hasAttendees({ summary: 'x', attendees: [{ email: 'a@x' }] })).toBe(true)
  })
})

describe('openInGoogleUrl (FR-010)', () => {
  it('returns an http(s) htmlLink', () => {
    expect(openInGoogleUrl({ summary: 'x', htmlLink: 'https://calendar.google.com/event?eid=abc' })).toBe(
      'https://calendar.google.com/event?eid=abc'
    )
  })
  it('omits (null) when absent, blank, or a non-http(s) value', () => {
    expect(openInGoogleUrl({ summary: 'x' })).toBeNull()
    expect(openInGoogleUrl({ summary: 'x', htmlLink: '' })).toBeNull()
    expect(openInGoogleUrl({ summary: 'x', htmlLink: 'javascript:alert(1)' })).toBeNull()
    expect(openInGoogleUrl({ summary: 'x', htmlLink: 'ftp://x/y' })).toBeNull()
  })
})

describe('isRecurringInstance (FR-011)', () => {
  it('true only when explicitly recurring', () => {
    expect(isRecurringInstance({ summary: 'x', recurring: true })).toBe(true)
    expect(isRecurringInstance({ summary: 'x', recurring: false })).toBe(false)
    expect(isRecurringInstance({ summary: 'x' })).toBe(false)
  })
})
