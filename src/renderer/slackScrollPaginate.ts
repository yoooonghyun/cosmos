/**
 * Decision logic for SCROLL-BASED older-history pagination in the native Slack history list
 * (slack-scroll-pagination-v1).
 *
 * The native history `MessageList` (`SlackPanel.tsx`) is newest-at-bottom and paginates to OLDER
 * messages via `run(cursor)`, which PREPENDS the older page above the current rows. v1 makes that
 * older-page load fire automatically when the user scrolls the viewport NEAR THE TOP
 * (infinite-scroll-up), keeping the manual "Load older messages" button as a fallback.
 *
 * This module holds ONLY the pure, node-testable parts (the `.ts`/`.test.ts` split, FR-010):
 *  - `shouldAutoLoadOlder` — "should I fire `run(cursor)` now?" given the scroll position, the
 *    near-top threshold, whether a load is already in flight, and whether an older page exists.
 *  - `anchorScrollTop` — the scroll-position-preservation math: after an older page PREPENDS rows
 *    above the view, the new `scrollTop` that keeps the message under the user's cursor visually
 *    in place (`prevScrollTop + (newScrollHeight − prevScrollHeight)`, FR-004).
 *
 * The DOM side (resolving the Radix viewport, attaching the scroll listener, measuring
 * `scrollTop`/`scrollHeight`, and applying the anchor in a `useLayoutEffect`) lives in
 * `useSlackScrollPaginate.ts` and is NOT node-testable (needs a real layout pass) — verified
 * visually, like the sibling `useSlackScrollToLatest`.
 */

/**
 * Distance from the top of the scroll viewport (in CSS px) within which a scroll counts as
 * "near top" and triggers the next older-page auto-load. Exported so tests pin it (FR-010) and a
 * later tuning is a single source of truth.
 */
export const NEAR_TOP_PX = 64

/** Inputs to the auto-load-older decision (computed per scroll event by the hook). */
export interface AutoLoadOlderInput {
  /** Current `scrollTop` of the viewport (0 = pinned to the very top; can be negative on overscroll). */
  scrollTop: number
  /** Near-top threshold in px — at or below this, the user is "near the top" (default `NEAR_TOP_PX`). */
  threshold: number
  /** Whether an older-page load is already in flight (`loadingMore`) — the authoritative guard (FR-002/008). */
  inFlight: boolean
  /** Whether an older page exists to load (`cursor != null`) — false once the cursor is exhausted (FR-003). */
  hasCursor: boolean
}

/**
 * Should the history list auto-load the next OLDER page on THIS scroll event?
 *
 * True ONLY when the viewport is at/within the near-top threshold (`scrollTop <= threshold`),
 * no older-page load is already in flight (`!inFlight`), and an older page exists
 * (`hasCursor`). A negative/overscroll `scrollTop` still qualifies (the user is past the top).
 * The in-flight guard is the authority against double-fires (FR-002/008); the hook adds a local
 * firing latch on top of this for the React state-commit lag.
 */
export function shouldAutoLoadOlder({
  scrollTop,
  threshold,
  inFlight,
  hasCursor
}: AutoLoadOlderInput): boolean {
  return scrollTop <= threshold && !inFlight && hasCursor
}

/**
 * Scroll position that keeps the user anchored after an older page PREPENDED rows above the view
 * (FR-004). The newly inserted rows grow `scrollHeight`; adding that growth to the previous
 * `scrollTop` keeps the message that was under the cursor at the same on-screen Y.
 *
 * `newScrollTop = prevScrollTop + (newScrollHeight − prevScrollHeight)`
 *
 * Pure + total: a non-growing (or shrinking) height delta yields `prevScrollTop` unchanged or
 * less, and the caller clamps to a real scroller, so this never throws.
 */
export function anchorScrollTop(
  prevScrollTop: number,
  prevScrollHeight: number,
  newScrollHeight: number
): number {
  return prevScrollTop + (newScrollHeight - prevScrollHeight)
}
