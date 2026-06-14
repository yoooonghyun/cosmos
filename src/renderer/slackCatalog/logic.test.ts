import { describe, it, expect } from 'vitest'
import {
  authorName,
  boundRows,
  countLabel,
  formatTs,
  initials,
  showEmptyState,
  showErrorNotice
} from './logic'

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

/* slack-generative-adapter-v1 — bound-list display gating (FR-004/FR-007, design §3). */

describe('boundRows (safe array coercion)', () => {
  it('returns the array as-is when present (happy path)', () => {
    expect(boundRows([1, 2])).toEqual([1, 2])
  })

  it('returns [] for an undefined / non-array bound value (safe fallback, never throws)', () => {
    expect(boundRows<number>(undefined)).toEqual([])
    expect(boundRows(null as unknown as number[])).toEqual([])
  })
})

describe('showErrorNotice (recoverable error gate — FR-007)', () => {
  it('is true for a non-empty error message', () => {
    expect(showErrorNotice('Reconnect Slack.')).toBe(true)
  })

  it('is false for an absent / blank message (missing optional, no notice)', () => {
    expect(showErrorNotice(undefined)).toBe(false)
    expect(showErrorNotice('')).toBe(false)
    expect(showErrorNotice('   ')).toBe(false)
  })
})

describe('showEmptyState (empty vs error-supersedes — design §3)', () => {
  it('is true for an empty list with no error', () => {
    expect(showEmptyState(0, undefined)).toBe(true)
  })

  it('is false when rows exist', () => {
    expect(showEmptyState(3, undefined)).toBe(false)
  })

  it('is false for an empty list WITH an error (the error notice supersedes the empty state)', () => {
    expect(showEmptyState(0, 'Reconnect.')).toBe(false)
  })
})
