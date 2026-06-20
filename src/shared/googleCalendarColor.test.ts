import { describe, it, expect } from 'vitest'
import {
  CALENDAR_COLOR_FALLBACK,
  CALENDAR_COLOR_TOKENS,
  calendarColorToken,
  stableStringHash
} from './googleCalendarColor'
import type { GoogleCalendar } from './googleCalendar'

/* shared-calendars-v1 — the pure, deterministic calendar → cosmos color-TOKEN mapping
 * (FR-006/FR-007). Palette-hex lookup → stable id-hash → gray fallback; the SAME calendar
 * always resolves to the SAME token; the result is always a bounded token (never raw hex). */

const cal = (over: Partial<GoogleCalendar>): GoogleCalendar => ({
  id: over.id ?? 'c@x',
  summary: over.summary ?? 'C',
  ...over
})

describe('stableStringHash (deterministic FNV-1a; non-negative 32-bit)', () => {
  it('is stable for the same input', () => {
    expect(stableStringHash('team@x')).toBe(stableStringHash('team@x'))
  })
  it('returns a non-negative integer', () => {
    const h = stableStringHash('anything')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
  })
  it('differs across distinct inputs (no trivial collision)', () => {
    expect(stableStringHash('a@x')).not.toBe(stableStringHash('b@x'))
  })
})

describe('calendarColorToken (FR-007 — deterministic, bounded, never raw hex)', () => {
  it('maps a recognized GCal palette hex to the nearest cosmos token', () => {
    expect(calendarColorToken(cal({ id: 'a', backgroundColor: '#4986e7' }))).toBe('blue') // Blueberry
    expect(calendarColorToken(cal({ id: 'b', backgroundColor: '#16a765' }))).toBe('green') // Basil
    expect(calendarColorToken(cal({ id: 'c', backgroundColor: '#f83a22' }))).toBe('red') // Tomato
  })

  it('normalizes hex case + missing-hash before lookup', () => {
    expect(calendarColorToken(cal({ id: 'a', backgroundColor: '#4986E7' }))).toBe('blue')
    expect(calendarColorToken(cal({ id: 'a', backgroundColor: '4986e7' }))).toBe('blue')
  })

  it('is DETERMINISTIC: same calendar id always yields the same token', () => {
    const c = cal({ id: 'team@x' })
    expect(calendarColorToken(c)).toBe(calendarColorToken(c))
  })

  it('id-hashes an unknown/absent hex across the NON-GRAY palette (never the fallback hue)', () => {
    const token = calendarColorToken(cal({ id: 'novel-calendar@x' }))
    expect(CALENDAR_COLOR_TOKENS).toContain(token)
    expect(token).not.toBe(CALENDAR_COLOR_FALLBACK)
  })

  it('always returns a bounded token (never a raw hex), even for garbage input', () => {
    const token = calendarColorToken(cal({ id: 'x', backgroundColor: 'not-a-hex' }))
    expect([...CALENDAR_COLOR_TOKENS, CALENDAR_COLOR_FALLBACK]).toContain(token)
    expect(token).not.toMatch(/#/)
  })

  it('falls back to gray for an absent/empty-id calendar (safe fallback, never throws)', () => {
    expect(calendarColorToken(undefined)).toBe(CALENDAR_COLOR_FALLBACK)
    expect(calendarColorToken({ id: '', summary: '' })).toBe(CALENDAR_COLOR_FALLBACK)
  })
})
