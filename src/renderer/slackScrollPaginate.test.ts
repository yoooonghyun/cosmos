import { describe, it, expect } from 'vitest'
import { NEAR_TOP_PX, shouldAutoLoadOlder, anchorScrollTop } from './slackScrollPaginate'

describe('NEAR_TOP_PX', () => {
  it('is pinned (regression guard so a later tuning is intentional)', () => {
    expect(NEAR_TOP_PX).toBe(64)
  })
})

describe('shouldAutoLoadOlder', () => {
  const base = { scrollTop: 0, threshold: NEAR_TOP_PX, inFlight: false, hasCursor: true }

  it('loads when near top, has a cursor, and nothing is in flight (the happy path)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: 10 })).toBe(true)
  })

  it('does NOT load when scrolled below the threshold (away from the top)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: NEAR_TOP_PX + 1 })).toBe(false)
  })

  it('does NOT load while an older-page load is already in flight (FR-002/008)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: 0, inFlight: true })).toBe(false)
  })

  it('does NOT load when the cursor is exhausted — no older page exists (FR-003)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: 0, hasCursor: false })).toBe(false)
  })

  it('loads at the exact boundary (scrollTop === threshold)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: NEAR_TOP_PX })).toBe(true)
  })

  it('loads on a negative / overscroll scrollTop (user is past the top)', () => {
    expect(shouldAutoLoadOlder({ ...base, scrollTop: -20 })).toBe(true)
  })

  it('requires ALL conditions: near-top alone is not enough when in flight + no cursor', () => {
    expect(
      shouldAutoLoadOlder({ scrollTop: 0, threshold: NEAR_TOP_PX, inFlight: true, hasCursor: false })
    ).toBe(false)
  })
})

describe('anchorScrollTop', () => {
  it('shifts scrollTop down by the prepended height delta so the view stays put (FR-004)', () => {
    // Was at 200; a prepend grew the scrollHeight by 800 (1000 -> 1800).
    expect(anchorScrollTop(200, 1000, 1800)).toBe(1000)
  })

  it('is a no-op when the height did not change (no prepend grew the list)', () => {
    expect(anchorScrollTop(350, 1200, 1200)).toBe(350)
  })

  it('handles a prepend from the very top (scrollTop 0)', () => {
    expect(anchorScrollTop(0, 500, 1300)).toBe(800)
  })

  it('never throws on a shrinking delta (returns the math, caller clamps to the scroller)', () => {
    expect(anchorScrollTop(400, 1500, 1000)).toBe(-100)
  })
})
