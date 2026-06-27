/**
 * React layout-effect hook that scrolls a Slack message list to the LATEST (bottom)
 * message on its INITIAL load / channel switch, while leaving a top load-more
 * (prepend-older) untouched (bug slack-history-scroll-to-latest-v1).
 *
 * The pure decision lives in `slackScrollToLatest.ts` (node-tested). This hook owns the
 * DOM side — finding the scrollable element and setting `scrollTop = scrollHeight` — which
 * is NOT node-testable (needs a real layout pass) and is verified visually.
 *
 * Two scroll-container shapes are supported:
 *  - `'self'`  — the ref is attached directly to the scrolling element (the generative
 *    catalog `MessageList`, a plain `overflow-y-auto` div).
 *  - `'radix-viewport'` — the ref is attached to a Radix `ScrollArea` Root; the actual
 *    scroller is the descendant `[data-slot="scroll-area-viewport"]` (the native
 *    `SlackPanel` history list, which wraps rows in shadcn `ScrollArea`).
 *
 * The hook scrolls exactly ONCE per mounted instance (the first non-empty render). A
 * channel switch / confirmed send REMOUNTS the list (its React `key` changes), which
 * resets the latch so the next load scrolls again. `useLayoutEffect` runs after rows are
 * in the DOM but before paint, so there is no visible flash of the top-anchored list.
 */

import { useLayoutEffect, useRef } from 'react'
import { shouldScrollToLatest } from './slackScrollToLatest'

export type SlackScrollKind = 'self' | 'radix-viewport'

/**
 * @param itemCount number of rows currently rendered (drives the initial-load decision).
 * @param kind      whether the ref element is itself the scroller or a Radix ScrollArea root.
 * @returns a ref to attach to the list's scroll container (or Radix ScrollArea Root).
 */
export function useSlackScrollToLatest<T extends HTMLElement = HTMLDivElement>(
  itemCount: number,
  kind: SlackScrollKind = 'self'
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  // Latches once this instance has performed its initial-load scroll. Resets on remount
  // (channel switch / send) because the whole hook state is recreated with the new instance.
  const alreadyScrolledRef = useRef(false)

  useLayoutEffect(() => {
    if (!shouldScrollToLatest({ itemCount, alreadyScrolled: alreadyScrolledRef.current })) {
      return
    }
    const root = ref.current
    if (!root) {
      return
    }
    const scroller =
      kind === 'radix-viewport'
        ? root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
        : root
    if (!scroller) {
      return
    }
    // Jump to the bottom = the newest message (newest-at-bottom lists).
    scroller.scrollTop = scroller.scrollHeight
    alreadyScrolledRef.current = true
  }, [itemCount, kind])

  return ref
}
