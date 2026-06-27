import { describe, it, expect } from 'vitest'
import { shouldScrollToLatest } from './slackScrollToLatest'

describe('shouldScrollToLatest', () => {
  it('scrolls on initial load: list becomes non-empty and has not scrolled yet', () => {
    // The first non-empty render of a freshly mounted (channel switch) list.
    expect(shouldScrollToLatest({ itemCount: 25, alreadyScrolled: false })).toBe(true)
  })

  it('does NOT scroll while the list is still empty (skeleton / pre-load)', () => {
    expect(shouldScrollToLatest({ itemCount: 0, alreadyScrolled: false })).toBe(false)
  })

  it('does NOT scroll again once the instance has already scrolled (prepend-older / refresh)', () => {
    // Top load-more grows the count on an already-scrolled instance -> preserve position.
    expect(shouldScrollToLatest({ itemCount: 50, alreadyScrolled: true })).toBe(false)
  })

  it('does NOT scroll when an already-scrolled list momentarily clears to empty (refresh)', () => {
    expect(shouldScrollToLatest({ itemCount: 0, alreadyScrolled: true })).toBe(false)
  })

  it('scrolls exactly once: true on the first non-empty render, false thereafter', () => {
    // Simulate the caller latching alreadyScrolled after the first true.
    let alreadyScrolled = false
    const first = shouldScrollToLatest({ itemCount: 10, alreadyScrolled })
    if (first) alreadyScrolled = true
    const second = shouldScrollToLatest({ itemCount: 30, alreadyScrolled }) // prepend-older grew it
    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})
