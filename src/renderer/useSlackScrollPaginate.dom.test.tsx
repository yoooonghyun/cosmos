/**
 * DOM tests for useSlackScrollPaginate (jsdom environment, vitest.dom.config.ts).
 *
 * These verify the HOOK's DOM wiring — specifically:
 *   1. The scroll listener must be on the INNER [data-slot="scroll-area-viewport"]
 *      element, not on the root div.  If it were on the root, scrolling the
 *      viewport would never fire onLoadOlder (the root itself does not scroll).
 *   2. onLoadOlder fires when the viewport is scrolled near the top.
 *   3. onLoadOlder does NOT fire when the viewport is scrolled far from the top.
 *
 * The pure decision logic (shouldAutoLoadOlder, anchorScrollTop) is already
 * covered by slackScrollPaginate.test.ts (node env).  These tests cover the
 * DOM wiring that node cannot reach.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSlackScrollPaginate } from './useSlackScrollPaginate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the two-level DOM structure that the hook expects:
 *   <div root>                          ← caller attaches callback ref here
 *     <div data-slot="scroll-area-viewport">  ← the real scroller
 *     </div>
 *   </div>
 *
 * Returns both nodes so tests can manipulate the viewport directly.
 */
function makeScrollArea(): { root: HTMLDivElement; viewport: HTMLDivElement } {
  const root = document.createElement('div')
  const viewport = document.createElement('div')
  viewport.setAttribute('data-slot', 'scroll-area-viewport')

  // Give the viewport something to scroll so scrollTop assignments persist.
  viewport.style.overflow = 'auto'
  viewport.style.height = '200px'
  const inner = document.createElement('div')
  inner.style.height = '1000px'
  viewport.appendChild(inner)

  root.appendChild(viewport)
  document.body.appendChild(root)
  return { root, viewport }
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------
// Test 1 — listener is wired to the VIEWPORT, not the root
// ---------------------------------------------------------------------------

describe('useSlackScrollPaginate DOM wiring', () => {
  // BUG EXPOSED (intentional RED): the hook's scroll-listener useLayoutEffect depends on
  // [enabled, resolveViewport] and reads rootRef.current at effect time.  In React 18,
  // callback refs fire AFTER layout effects, so rootRef.current is still null when the
  // effect runs — the scroll listener is never attached and onLoadOlder never fires.
  // Fix: the effect must also depend on a state/ref that is set when the callback ref
  // fires (e.g. store the node in useState and add it to the deps array).
  // Do NOT remove or skip this test; its failure is the regression guard for that fix.
  it('fires onLoadOlder when the VIEWPORT (inner element) is scrolled near the top', async () => {
    const { root, viewport } = makeScrollArea()
    const onLoadOlder = vi.fn()

    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: true,
        enabled: true,
        onLoadOlder,
      })
    )

    // Attach the callback ref to the root (as the real component does).
    act(() => {
      result.current(root)
    })

    // Scroll the viewport to a position near the top (within NEAR_TOP_PX=64).
    act(() => {
      viewport.scrollTop = 10
      viewport.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Test 2 — scroll on ROOT (not viewport) must NOT fire — catches the wrong-element bug
  // ---------------------------------------------------------------------------

  it('does NOT fire onLoadOlder when ONLY the root element fires a scroll event (wrong element)', async () => {
    const { root } = makeScrollArea()
    const onLoadOlder = vi.fn()

    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: true,
        enabled: true,
        onLoadOlder,
      })
    )

    act(() => {
      result.current(root)
    })

    // Fire scroll on the ROOT, not on the viewport.
    act(() => {
      root.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    // If the hook incorrectly attaches to root, this would be 1.
    // If correctly attached to viewport only, it stays 0.
    expect(onLoadOlder).toHaveBeenCalledTimes(0)
  })

  // ---------------------------------------------------------------------------
  // Test 3 — no fire when scrolled far from the top
  // ---------------------------------------------------------------------------

  it('does NOT fire onLoadOlder when viewport is scrolled far from the top', async () => {
    const { root, viewport } = makeScrollArea()
    const onLoadOlder = vi.fn()

    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: true,
        enabled: true,
        onLoadOlder,
      })
    )

    act(() => {
      result.current(root)
    })

    // scrollTop well above NEAR_TOP_PX (64).
    act(() => {
      viewport.scrollTop = 400
      viewport.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onLoadOlder).toHaveBeenCalledTimes(0)
  })

  // ---------------------------------------------------------------------------
  // Test 4 — disabled hook never fires even when scrolled near the top
  // ---------------------------------------------------------------------------

  it('does NOT fire onLoadOlder when enabled=false (thread-dock variant)', async () => {
    const { root, viewport } = makeScrollArea()
    const onLoadOlder = vi.fn()

    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: true,
        enabled: false, // thread-dock opts out
        onLoadOlder,
      })
    )

    act(() => {
      result.current(root)
    })

    act(() => {
      viewport.scrollTop = 10
      viewport.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onLoadOlder).toHaveBeenCalledTimes(0)
  })

  // ---------------------------------------------------------------------------
  // Test 5 — kind='self' (generative MessageList): the ATTACHED div is the scroller
  // (bug slack-generative-scroll-pagination-v1). The generative catalog list has no Radix
  // viewport descendant — its SLACK_LIST_SCROLL_CLASS div scrolls itself — so the hook must
  // resolve the root node directly and fire onLoadOlder on a near-top scroll of THAT div.
  // RED BEFORE FIX: the hook hard-coded kind='radix-viewport' and querySelector'd a
  // [data-slot="scroll-area-viewport"] that does not exist on a self-scroller → null → no
  // listener → onLoadOlder never fires (defect 2 not applied to the generative list).
  // ---------------------------------------------------------------------------

  it("fires onLoadOlder on near-top scroll when kind='self' (generative list, the div IS the scroller)", () => {
    // A bare self-scrolling div (no Radix viewport child) — the generative MessageList shape.
    const selfScroller = document.createElement('div')
    selfScroller.style.overflow = 'auto'
    selfScroller.style.height = '200px'
    const inner = document.createElement('div')
    inner.style.height = '1000px'
    selfScroller.appendChild(inner)
    document.body.appendChild(selfScroller)

    const onLoadOlder = vi.fn()
    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: true,
        enabled: true,
        kind: 'self',
        onLoadOlder,
      })
    )

    act(() => {
      result.current(selfScroller)
    })

    act(() => {
      selfScroller.scrollTop = 10 // within NEAR_TOP_PX=64
      selfScroller.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it("does NOT fire onLoadOlder when kind='self' and hasCursor=false (no next page)", () => {
    const selfScroller = document.createElement('div')
    selfScroller.style.overflow = 'auto'
    selfScroller.style.height = '200px'
    document.body.appendChild(selfScroller)

    const onLoadOlder = vi.fn()
    const { result } = renderHook(() =>
      useSlackScrollPaginate({
        itemCount: 5,
        inFlight: false,
        hasCursor: false, // exhausted — no older page
        enabled: true,
        kind: 'self',
        onLoadOlder,
      })
    )

    act(() => {
      result.current(selfScroller)
    })
    act(() => {
      selfScroller.scrollTop = 10
      selfScroller.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(onLoadOlder).toHaveBeenCalledTimes(0)
  })
})
