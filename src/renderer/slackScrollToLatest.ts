/**
 * Decision logic for "scroll the Slack message list to the LATEST (bottom) message"
 * (bug slack-history-scroll-to-latest-v1).
 *
 * Slack message lists render newest-at-bottom (ascending `ts`; see `orderBoundMessages`
 * + `MessageList`), so a freshly-rendered scroll container sits at the TOP = OLDEST. On
 * INITIAL history load and on CHANNEL SWITCH the view must jump to the BOTTOM so the user
 * lands on the newest message. The fiddly part: loading OLDER history via the TOP
 * load-more PREPENDS rows ABOVE the thread — that must NOT scroll-to-bottom (it would
 * yank the user away from the older messages they just fetched).
 *
 * This module holds ONLY the pure "should I auto-scroll to bottom now?" decision so it is
 * node-testable (vitest, `.ts`/`.test.ts` split — no `.tsx`/DOM import). The actual DOM
 * `scrollTop = scrollHeight` call lives in the React layout-effect hook in
 * `useSlackScrollToLatest.ts` and is NOT node-testable (needs a real layout pass).
 *
 * How initial/channel-switch is distinguished from a prepend-older append:
 *
 *  - The NATIVE history list (`SlackPanel.tsx` `MessageList`) is REMOUNTED on channel
 *    switch and on a confirmed send (its React `key` is `${channelId}-${reloadKey}`), so
 *    each fresh load is a brand-new component instance whose `items` go `0 -> N`. The
 *    FIRST transition to a non-empty list inside one mounted instance == the initial load.
 *    A subsequent top load-more keeps the SAME instance and only GROWS the count further.
 *  - So: auto-scroll exactly ONCE per mount — the first time the list becomes non-empty.
 *    Every later count change (prepend-older, or a refresh that re-sorts in place) is NOT
 *    an initial load and is left alone, preserving the user's scroll position.
 *  - A newly SENT message reloads via the remount (new `key`) — a new mount, so it takes
 *    the same initial-load path and lands at the bottom naturally.
 */

/** Inputs to the auto-scroll decision (computed once per render, ref-tracked by caller). */
export interface ScrollToLatestInput {
  /** Current number of rows rendered in the list. */
  itemCount: number
  /** Whether this mounted instance has ALREADY performed its one initial-load scroll. */
  alreadyScrolled: boolean
}

/**
 * Should the list scroll itself to the bottom (latest) on THIS render?
 *
 * True only for the INITIAL load of a mounted instance: the list has become non-empty
 * (`itemCount > 0`) and we have not yet scrolled (`alreadyScrolled === false`). A
 * channel switch / send remounts the component, resetting `alreadyScrolled`, so the next
 * non-empty render scrolls again. A top load-more (prepend-older) grows the count on an
 * instance that has `alreadyScrolled === true`, so it returns false — the user's position
 * is preserved.
 */
export function shouldScrollToLatest({ itemCount, alreadyScrolled }: ScrollToLatestInput): boolean {
  return itemCount > 0 && !alreadyScrolled
}
