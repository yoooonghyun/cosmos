import { describe, it, expect } from 'vitest'
import {
  boundRows,
  countLabel,
  CONFLUENCE_OPEN_DETAIL_ACTION,
  hasReadableBody,
  isOpenDetailEmittable,
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

/* confluence-page-detail-nav-v1 — click-to-open page detail (FR-001/FR-002/FR-003). */

describe('CONFLUENCE_OPEN_DETAIL_ACTION (renderer-local nav signal, FR-003)', () => {
  it('is a NON-confluence.* name so onAction intercepts it renderer-locally (never forwarded)', () => {
    // The ConfluencePanel onAction seam handles it + returns true; a confluence.*-prefixed
    // name would forward to main/the agent. Guard it stays renderer-local.
    expect(CONFLUENCE_OPEN_DETAIL_ACTION).toBe('confluenceNav.openDetail')
    expect(CONFLUENCE_OPEN_DETAIL_ACTION.startsWith('confluence.')).toBe(false)
  })
})

describe('isOpenDetailEmittable (id-gated clickable row, FR-001/FR-002)', () => {
  it('is true for a non-empty page id (the row is clickable)', () => {
    expect(isOpenDetailEmittable('P1')).toBe(true)
  })

  it('is false for an absent id (missing optional → inert row, no action, no throw)', () => {
    expect(isOpenDetailEmittable(undefined)).toBe(false)
  })

  it('is false for an empty/whitespace id (inert row)', () => {
    expect(isOpenDetailEmittable('')).toBe(false)
    expect(isOpenDetailEmittable('   ')).toBe(false)
    expect(isOpenDetailEmittable('\t\n')).toBe(false)
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
