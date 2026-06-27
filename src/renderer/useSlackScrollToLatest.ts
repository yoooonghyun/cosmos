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
 *
 * NODE-OBSERVED-VIA-STATE (bug slack-generative-scroll-to-latest-v1, parallels the
 * `useSlackScrollPaginate` fix): the scroll target is held in STATE, not a bare `useRef`.
 * The returned value still presents a `RefObject`-shaped `{ current }` API (so the native
 * `SlackPanel` caller's `scrollRef.current = node` merge keeps working byte-for-byte), but
 * assigning `current` ALSO commits the node to state, so the `useLayoutEffect` re-runs the
 * moment the node attaches. With a plain ref, the effect's deps (`itemCount, kind`) might
 * not change on the render that mounts the conditionally-rendered scroller (e.g. the
 * generative list reveals its `kind='self'` div in a render where the bound `itemCount`
 * step does not re-key the effect the way the node attach demands), so the bottom-jump
 * silently never fired. Driving the effect off the attached node closes that gap.
 */

import { useLayoutEffect, useMemo, useState } from 'react'
import { shouldScrollToLatest } from './slackScrollToLatest'

export type SlackScrollKind = 'self' | 'radix-viewport'

/**
 * A `RefObject`-compatible handle whose `current` setter also commits the node to React
 * state so the scroll effect re-runs on attach. Both `ref={handle}` (React assigns
 * `current`) and a manual merge (`handle.current = node`, as `SlackPanel` does) drive it.
 */
export interface ScrollToLatestRef<T extends HTMLElement> {
  current: T | null
}

/**
 * @param itemCount number of rows currently rendered (drives the initial-load decision).
 * @param kind      whether the ref element is itself the scroller or a Radix ScrollArea root.
 * @returns a ref to attach to the list's scroll container (or Radix ScrollArea Root).
 */
export function useSlackScrollToLatest<T extends HTMLElement = HTMLDivElement>(
  itemCount: number,
  kind: SlackScrollKind = 'self'
): ScrollToLatestRef<T> {
  // The scroll target lives in STATE so the layout effect re-runs when the node attaches
  // (callback/object refs both attach during commit, but the effect must be RE-KEYED on the
  // node to act on the attach — a bare ref leaves the effect deps unchanged). See file header.
  const [node, setNode] = useState<T | null>(null)
  // Latches once this instance has performed its initial-load scroll. State (not a ref) so a
  // remount resets it; within a mount it persists across re-renders. Kept in a closure ref via
  // a mutable holder so the setter does not force a re-render purely to flip the latch.
  const latch = useMemo<{ scrolled: boolean }>(() => ({ scrolled: false }), [])

  // A RefObject-shaped handle: `current` getter returns the node; the setter commits it to
  // state (idempotent — no-op when unchanged) so React's `ref={handle}` and a manual
  // `handle.current = node` merge both re-key the effect below.
  const handle = useMemo<ScrollToLatestRef<T>>(() => {
    let value: T | null = null
    return {
      get current(): T | null {
        return value
      },
      set current(next: T | null) {
        if (value === next) {
          return
        }
        value = next
        setNode(next)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!shouldScrollToLatest({ itemCount, alreadyScrolled: latch.scrolled })) {
      return
    }
    if (!node) {
      return
    }
    const scroller =
      kind === 'radix-viewport'
        ? node.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
        : node
    if (!scroller) {
      return
    }
    // Jump to the bottom = the newest message (newest-at-bottom lists).
    scroller.scrollTop = scroller.scrollHeight
    latch.scrolled = true
  }, [itemCount, kind, node, latch])

  return handle
}
