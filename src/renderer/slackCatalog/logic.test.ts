import { describe, it, expect } from 'vitest'
import { authorName, countLabel, formatTs, initials } from './logic'

/* Slack + Confluence generative-UI v1 — pure Slack catalog display helpers (FR-004). */

describe('authorName (raw-id fallback — design §2)', () => {
  it('returns userName when present (happy path)', () => {
    expect(authorName('U123', 'Alice')).toBe('Alice')
  })

  it('falls back to userId when userName is absent (missing optional)', () => {
    expect(authorName('U123')).toBe('U123')
    expect(authorName('U123', undefined)).toBe('U123')
  })

  it('falls back to userId when userName is empty/whitespace (safe fallback)', () => {
    expect(authorName('U123', '')).toBe('U123')
    expect(authorName('U123', '   ')).toBe('U123')
  })
})

describe('initials (avatar fallback — no remote images)', () => {
  it('uses first+last initials for a multi-word name', () => {
    expect(initials('Alice Bob')).toBe('AB')
  })

  it('uses the first two chars for a single-word name', () => {
    expect(initials('alice')).toBe('AL')
  })

  it('strips a leading @ or # before deriving initials', () => {
    expect(initials('@alice')).toBe('AL')
    expect(initials('#general')).toBe('GE')
  })

  it('returns "?" for an empty/whitespace name (never throws, safe fallback)', () => {
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('formatTs (Slack epoch ts — design §2.3)', () => {
  it('formats a numeric epoch ts to a short local string', () => {
    // We only assert it produced a non-empty string (locale-dependent exact value).
    expect(formatTs('1700000000.000100')).not.toBe('')
  })

  it('returns "" for a non-numeric / absent ts (safe fallback, row shows no time)', () => {
    expect(formatTs('')).toBe('')
    expect(formatTs('not-a-number')).toBe('')
  })
})

describe('countLabel (list count line — pluralization)', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'channel', 'channels')).toBe('1 channel')
    expect(countLabel(1, 'result', 'results')).toBe('1 result')
  })

  it('uses the plural for zero and many', () => {
    expect(countLabel(0, 'channel', 'channels')).toBe('0 channels')
    expect(countLabel(3, 'result', 'results')).toBe('3 results')
  })
})
