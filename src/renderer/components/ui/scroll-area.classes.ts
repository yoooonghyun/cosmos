/**
 * Class strings for the shadcn/Radix ScrollArea, factored out of `scroll-area.tsx`
 * so the wrap-enabling override can be asserted in a node (no-jsdom) unit test —
 * the `.tsx` cannot be mounted to observe computed layout (vitest runs in node).
 *
 * Bug `slack-message-overflow-wrap-v1`: Radix `ScrollArea.Viewport` wraps its
 * children in an inner content `div` with INLINE `style={{ minWidth: "100%",
 * display: "table" }}` (see @radix-ui/react-scroll-area dist, the Viewport's
 * `onContentChange` child). A `display: table` box shrink-to-fits its content's
 * intrinsic width, so a long unbroken line of `whitespace-pre-wrap` text expands
 * the table past the panel width and overflows horizontally instead of wrapping —
 * even though the message `<p>` already carries `whitespace-pre-wrap break-words`
 * and its column is `min-w-0 flex-1`. The cap fails because the containing block
 * (the table) is wider than the panel.
 *
 * Fix: override that immediate content child via the `[&>div]` arbitrary variant.
 * `!block` defeats the inline `display: table` (switching it to a normal block box
 * that fills the available width and lets text wrap); `!min-w-full` preserves
 * Radix's `min-width: 100%` floor (short content still fills the viewport so the
 * scrollbar geometry is unchanged). `!` (important) is required because the Radix
 * `display: table` is an INLINE style — a plain utility class would lose to it.
 *
 * This is the single shared root-cause fix: every native Slack read surface
 * (channel list, channel history, thread replies, search results) renders inside
 * this ScrollArea, so fixing it here fixes all of them at once.
 */

/** Wrap-enabling override applied to the Radix viewport's inner content div. */
export const SCROLL_AREA_VIEWPORT_CONTENT_FIX = '[&>div]:!block [&>div]:!min-w-full'

/**
 * scrollbar-policy-unify-renderer-v1: reserve the SAME right-side inset the CSS
 * `scrollbar-hover-only` regions reserve via `scrollbar-gutter: stable` (the platform
 * classic-scrollbar width — 10px on the macOS/Chromium target), so a Radix ScrollArea and a
 * plain `overflow-auto scrollbar-hover-only` div inset their content IDENTICALLY (uniform
 * CONTENT WIDTH, not just a uniform bar). Radix hides the native bar and draws an overlay, so
 * it reserves nothing by default; `pr-2.5` (10px) supplies the matching inset and the overlay
 * thumb floats within it on hover. (`scrollbar-gutter` can't be used here — the native bar is
 * suppressed by Radix.) `pr-2` (8px) matches the CSS region's measured content-edge inset
 * (verified equal in the scroll-policy harness scene); this is a macOS Electron app.
 */
export const SCROLL_AREA_VIEWPORT_GUTTER = 'pr-2'

/** Full className for the `ScrollArea.Viewport` (base styling + the wrap fix + uniform gutter). */
export const SCROLL_AREA_VIEWPORT_CLASS =
  'size-full rounded-[inherit] transition-[color,box-shadow] outline-none ' +
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 ' +
  SCROLL_AREA_VIEWPORT_GUTTER +
  ' ' +
  SCROLL_AREA_VIEWPORT_CONTENT_FIX
