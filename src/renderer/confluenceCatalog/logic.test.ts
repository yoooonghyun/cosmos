import { describe, it, expect } from 'vitest'
import { countLabel, hasReadableBody } from './logic'

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
