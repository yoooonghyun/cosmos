import { describe, it, expect } from 'vitest'
import {
  boundRows,
  countLabel,
  hasReadableBody,
  showEmptyState,
  showErrorNotice
} from './logic'

/* Slack + Confluence generative-UI v1 — pure Confluence catalog display helpers. */

describe('countLabel (list count line — pluralization)', () => {
  it('uses the singular for exactly one', () => {
    expect(countLabel(1, 'result', 'results')).toBe('1 result')
  })

  it('uses the plural for zero and many', () => {
    expect(countLabel(0, 'result', 'results')).toBe('0 results')
    expect(countLabel(5, 'result', 'results')).toBe('5 results')
  })
})

describe('hasReadableBody (PageDetail empty-body fallback — design §3.3)', () => {
  it('is true for a non-empty body (happy path)', () => {
    expect(hasReadableBody('Some page content')).toBe(true)
  })

  it('is false for a blank/whitespace-only body (shows "no readable body")', () => {
    expect(hasReadableBody('')).toBe(false)
    expect(hasReadableBody('   \n\t ')).toBe(false)
  })

  it('is false for an absent body (missing optional, safe fallback, never throws)', () => {
    expect(hasReadableBody(undefined)).toBe(false)
  })
})

/* confluence-generative-adapter-v1 — bound-list display gating (FR-004/FR-007, design §3.1). */

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
    expect(showErrorNotice('Reconnect Confluence.')).toBe(true)
  })

  it('is false for an absent / blank message (missing optional, no notice)', () => {
    expect(showErrorNotice(undefined)).toBe(false)
    expect(showErrorNotice('')).toBe(false)
    expect(showErrorNotice('   ')).toBe(false)
  })
})

describe('showEmptyState (empty vs error-supersedes — design §3.1)', () => {
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
