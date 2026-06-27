/**
 * React hook that adds SCROLL-BASED older-history pagination to the native Slack history list
 * (slack-scroll-pagination-v1). It (a) attaches a passive `scroll` listener to the Radix viewport
 * and fires the existing `onLoadOlder` (= `run(cursor)`) once when the user scrolls NEAR THE TOP,
 * and (b) on each older-page PREPEND, restores the user's scroll position by anchoring on the
 * `scrollHeight` delta inside a `useLayoutEffect` so the view does not jump (FR-001/002/004).
 *
 * The pure decisions live in `slackScrollPaginate.ts` (node-tested): `shouldAutoLoadOlder` (the
 * trigger) and `anchorScrollTop` (the delta math). This hook owns the DOM side — resolving the
 * scroller, reading `scrollTop`/`scrollHeight`, and applying the anchor — which is NOT
 * node-testable (needs a real layout pass) and is verified visually, like `useSlackScrollToLatest`.
 *
 * COEXISTENCE with `useSlackScrollToLatest` (mutual exclusion — read both before touching either):
 * both hooks run a `useLayoutEffect` keyed on `itemCount` on the SAME Radix ScrollArea root and
 * resolve the same `[data-slot="scroll-area-viewport"]` scroller. They are mutually exclusive by
 * construction:
 *  - The very first non-empty render (0 → N, the initial load / channel-switch remount) is owned
 *    by `useSlackScrollToLatest`'s bottom-jump; THIS hook's anchor SKIPS it (it only runs once an
 *    instance has already seen a non-empty render, i.e. a later N → M PREPEND).
 *  - A later N → M prepend is owned by THIS hook's anchor; the sibling's one-shot latch
 *    (`alreadyScrolled`) is already set, so it no-ops.
 * Because the two effects never both act on the same `itemCount` change, the order React runs them
 * in is irrelevant.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { SlackScrollKind } from './useSlackScrollToLatest'
import { NEAR_TOP_PX, shouldAutoLoadOlder, anchorScrollTop } from './slackScrollPaginate'

export interface SlackScrollPaginateInput {
  /** Number of rows currently rendered — drives the prepend-anchor decision (mirrors the sibling hook). */
  itemCount: number
  /** Whether an older-page load is in flight (`loadingMore`) — the authoritative double-fire guard. */
  inFlight: boolean
  /** Whether an older page exists to load (`cursor != null`). False ⇒ no auto-load fires. */
  hasCursor: boolean
  /**
   * Whether scroll-up pagination is active for this list. Only the self-scrolling, `olderAbove`
   * history variant opts in; the thread-dock (`scroll=false`) and any newer-direction list pass
   * `false` and get no listener and no anchoring (FR-012).
   */
  enabled: boolean
  /** Fires the next older-page load — wired to `() => void run(cursor)` by the caller. */
  onLoadOlder: () => void
}

/**
 * @returns a ref to attach to the Radix `ScrollArea` Root (the SAME root the sibling
 *   `useSlackScrollToLatest('radix-viewport')` ref is on — merge them with a callback ref).
 */
export function useSlackScrollPaginate<T extends HTMLElement = HTMLDivElement>({
  itemCount,
  inFlight,
  hasCursor,
  enabled,
  onLoadOlder
}: SlackScrollPaginateInput): (node: T | null) => void {
  // Root node held in STATE (not a ref) so the scroll-listener effect re-runs once the callback
  // ref attaches the node. In React 18 callback refs fire AFTER layout effects, so a ref read at
  // first-effect time would still be null and the listener would never attach (the pagination bug).
  const [rootNode, setRootNode] = useState<T | null>(null)
  // Local latch set the instant we call `onLoadOlder`, BEFORE React commits `loadingMore=true`.
  // Without it a burst of scroll events in the same frame could re-enter (the `inFlight` prop
  // still reads false until the re-render). Cleared when `itemCount` changes (the page landed) or
  // when `inFlight` goes false (a failed load — allow retry). The `inFlight` prop is still the
  // authority per FR-008; this only covers the React state-commit lag.
  const firingRef = useRef(false)
  // Last committed scroll geometry of the viewport — captured at the end of every layout effect so
  // the next prepend's anchor delta is correct.
  const prevScrollTopRef = useRef(0)
  const prevScrollHeightRef = useRef(0)
  // Whether this instance has already seen a non-empty render. The first non-empty render is the
  // initial load (owned by the sibling bottom-jump); only AFTER it does a grow count as a prepend.
  const sawNonEmptyRef = useRef(false)
  // Latest values for the listener (which is attached once) to read without re-binding per render.
  const inFlightRef = useRef(inFlight)
  const hasCursorRef = useRef(hasCursor)
  const onLoadOlderRef = useRef(onLoadOlder)
  inFlightRef.current = inFlight
  hasCursorRef.current = hasCursor
  onLoadOlderRef.current = onLoadOlder

  // Clear the firing latch once a load resolves (item count grew = page landed, or inFlight cleared
  // = success/failure settled) so a later near-top scroll can fire again.
  if (!inFlight) {
    firingRef.current = false
  }

  const resolveViewport = useCallback((root: T | null): HTMLElement | null => {
    if (!root) {
      return null
    }
    // The native history list is a Radix ScrollArea; the real scroller is the viewport descendant
    // (the same element `useSlackScrollToLatest('radix-viewport')` finds).
    const kind: SlackScrollKind = 'radix-viewport'
    return kind === 'radix-viewport'
      ? root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
      : root
  }, [])

  // Attach the passive scroll listener once the viewport is resolvable. Re-attaches when `enabled`
  // flips so a disabled list (thread dock) never listens.
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    const scroller = resolveViewport(rootNode)
    if (!scroller) {
      return
    }
    const onScroll = (): void => {
      if (firingRef.current) {
        return
      }
      const fire = shouldAutoLoadOlder({
        scrollTop: scroller.scrollTop,
        threshold: NEAR_TOP_PX,
        inFlight: inFlightRef.current,
        hasCursor: hasCursorRef.current
      })
      if (!fire) {
        return
      }
      // Capture geometry BEFORE the prepend so the layout effect can anchor on the delta.
      prevScrollTopRef.current = scroller.scrollTop
      prevScrollHeightRef.current = scroller.scrollHeight
      firingRef.current = true
      onLoadOlderRef.current()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [enabled, resolveViewport, rootNode])

  // Anchor on prepend: when item count GROWS after this instance's initial (non-empty) render,
  // restore scrollTop to keep the user's messages in place. Skips the first non-empty render
  // (the sibling bottom-jump owns it) — mutual exclusion documented in the file header.
  useLayoutEffect(() => {
    const scroller = resolveViewport(rootNode)
    if (!scroller) {
      return
    }
    if (!sawNonEmptyRef.current) {
      // First non-empty render = initial load (sibling bottom-jump). Record geometry, no anchor.
      if (itemCount > 0) {
        sawNonEmptyRef.current = true
        prevScrollTopRef.current = scroller.scrollTop
        prevScrollHeightRef.current = scroller.scrollHeight
      }
      return
    }
    // A later grow = an older-page prepend. Anchor on the scrollHeight delta captured at fire time.
    scroller.scrollTop = anchorScrollTop(
      prevScrollTopRef.current,
      prevScrollHeightRef.current,
      scroller.scrollHeight
    )
    // Refresh the baseline for the next prepend.
    prevScrollTopRef.current = scroller.scrollTop
    prevScrollHeightRef.current = scroller.scrollHeight
  }, [itemCount, resolveViewport, rootNode])

  // Callback ref so the caller can MERGE this with the sibling `useSlackScrollToLatest` ref on the
  // one ScrollArea Root. Writes to STATE (not a ref) so the effects above re-run on attach.
  return useCallback((node: T | null): void => {
    setRootNode(node)
  }, [])
}
