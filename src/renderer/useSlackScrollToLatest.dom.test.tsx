/**
 * DOM tests for useSlackScrollToLatest (jsdom environment, vitest.dom.config.ts).
 *
 * Covers the bug slack-history-scroll-to-latest-v1 defect-1 regression: the GENERATIVE
 * catalog MessageList uses kind='self' (the ref is the scroller itself). The hook must
 * scroll that element to the bottom on the FIRST non-empty render.
 *
 * RED BEFORE FIX: when the hook returned a plain `useRef` object ref and keyed its
 * useLayoutEffect on [itemCount, kind] only, the self-mode scroll-to-bottom did not run at
 * runtime (the node the ref must measure was not observed by the effect). The fix switches
 * the hook to a state-backed callback ref and adds the node to the effect deps — the SAME
 * fix applied to useSlackScrollPaginate. Do NOT remove/skip these tests; they are the guard.
 *
 * The pure decision (shouldScrollToLatest) is covered by slackScrollToLatest.test.ts (node).
 * These tests cover the DOM wiring node cannot reach.
 */

import { StrictMode } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSlackScrollToLatest } from './useSlackScrollToLatest'

afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * A minimal self-scrolling list that wires the hook the way the generative MessageList does:
 * attach the returned ref to the scroller div, render `itemCount` tall rows. The list is
 * empty (skeleton) until `itemCount > 0`, mirroring the real gating order.
 */
function SelfList({ itemCount }: { itemCount: number }): React.JSX.Element | null {
  const scrollRef = useSlackScrollToLatest<HTMLDivElement>(itemCount, 'self')
  if (itemCount === 0) {
    return null
  }
  return (
    <div ref={scrollRef} data-testid="scroller" style={{ height: '200px', overflowY: 'auto' }}>
      {Array.from({ length: itemCount }).map((_, i) => (
        <div key={i} style={{ height: '100px' }}>
          row {i}
        </div>
      ))}
    </div>
  )
}

/**
 * A self-list whose scroller node ATTACHES on a render where `itemCount` does NOT change
 * (a separate `ready` flag reveals the div). This isolates the fix: the layout effect must
 * re-run when the NODE attaches, not only when `itemCount` steps. A bare-`useRef` hook keyed
 * only on `[itemCount, kind]` never re-runs on this attach and leaves scrollTop at 0 (RED).
 */
function DelayedAttachList({
  itemCount,
  ready
}: {
  itemCount: number
  ready: boolean
}): React.JSX.Element | null {
  const scrollRef = useSlackScrollToLatest<HTMLDivElement>(itemCount, 'self')
  if (!ready) {
    return null
  }
  return (
    <div ref={scrollRef} data-testid="scroller" style={{ height: '200px', overflowY: 'auto' }}>
      {Array.from({ length: itemCount }).map((_, i) => (
        <div key={i} style={{ height: '100px' }}>
          row {i}
        </div>
      ))}
    </div>
  )
}

describe('useSlackScrollToLatest self-mode DOM wiring (defect 1)', () => {
  it('scrolls to the bottom when the scroller attaches on a render that does NOT change itemCount', () => {
    const SCROLL_HEIGHT = 1000
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(): number {
        return SCROLL_HEIGHT
      }
    })

    // itemCount is already 6 BEFORE the scroller node exists (ready=false → null). Revealing
    // the div (ready=true) attaches the node WITHOUT changing itemCount — the effect must still
    // fire off the node attach.
    let container: HTMLElement
    act(() => {
      const r = render(
        <StrictMode>
          <DelayedAttachList itemCount={6} ready={false} />
        </StrictMode>
      )
      container = r.container
      r.rerender(
        <StrictMode>
          <DelayedAttachList itemCount={6} ready={true} />
        </StrictMode>
      )
    })

    const scroller = container!.querySelector<HTMLElement>('[data-testid="scroller"]')
    expect(scroller).not.toBeNull()
    expect(scroller!.scrollTop).toBe(SCROLL_HEIGHT)
  })

  it('scrolls the self scroller to the bottom on the first non-empty render', () => {
    // jsdom does not lay out, so scrollHeight is 0 by default. Patch it so scrollTop assignment
    // is observable: a tall scrollHeight + a short clientHeight means scrollTop should land at
    // scrollHeight after the hook runs.
    const SCROLL_HEIGHT = 1000
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(): number {
        return SCROLL_HEIGHT
      },
    })

    // Wrap in StrictMode (the real app renders under <StrictMode>) so the double-invoked
    // mount/effect cycle is exercised — that is the runtime condition the object-ref latch
    // got wrong.
    let container: HTMLElement
    act(() => {
      const r = render(
        <StrictMode>
          <SelfList itemCount={0} />
        </StrictMode>
      )
      container = r.container
      // Data arrives asynchronously: 0 -> N inside the same mounted instance == initial load.
      r.rerender(
        <StrictMode>
          <SelfList itemCount={6} />
        </StrictMode>
      )
    })

    const scroller = container!.querySelector<HTMLElement>('[data-testid="scroller"]')
    expect(scroller).not.toBeNull()
    expect(scroller!.scrollTop).toBe(SCROLL_HEIGHT)
  })
})
