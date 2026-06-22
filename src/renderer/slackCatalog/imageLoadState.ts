/**
 * imageLoadState — pure load-lifecycle reducer + reserved-box sizing for Slack message
 * attachment thumbnails (slack-image-skeleton-placeholder-v1, FR-009).
 *
 * Lives in a plain `.ts` beside `SlackMessageImage.tsx` so it is node-testable per the
 * catalog `.ts`/`.test.ts` split (DEVELOPMENT.md §598-602): vitest runs `*.test.ts` in node
 * (no jsdom), so any unit-testable logic must avoid React/DOM. NO React, NO DOM, NO fetch —
 * just data in / descriptor out. The token/secret boundary is irrelevant here: this module
 * never sees a `ref`, only the optional natural `w`/`h` dimensions.
 */

/**
 * The per-image load lifecycle. Starts `'loading'` (skeleton shown), advances to `'loaded'`
 * on the `<img>` `onLoad` (swap to the image) or `'error'` on `onError` (the `ImageOff`
 * "image unavailable" placeholder). Both `'loaded'` and `'error'` are terminal.
 */
export type ImageLoadStatus = 'loading' | 'loaded' | 'error'

/** The two events an `<img>` can report. */
export type ImageLoadEvent = 'load' | 'error'

/**
 * Pure load-state transition. From `'loading'`, a `'load'` event → `'loaded'` and an
 * `'error'` event → `'error'`. `'loaded'` and `'error'` are TERMINAL and idempotent: once
 * resolved the state never regresses to `'loading'` and never flips between loaded/error.
 *
 * Terminality matters because an image already in the browser cache can fire `onLoad`
 * synchronously on mount (spec edge case): the reducer resolving to `'loaded'` once and
 * staying there avoids a stuck skeleton or a double-swap flash.
 */
export function nextImageLoadStatus(
  current: ImageLoadStatus,
  event: ImageLoadEvent
): ImageLoadStatus {
  if (current !== 'loading') {
    // Terminal: ignore any further events.
    return current
  }
  return event === 'load' ? 'loaded' : 'error'
}

/** The optional natural dimensions carried on a `SlackImageRef`. */
export interface ImageDims {
  w?: number
  h?: number
}

/**
 * The reserved-box descriptor the component renders into a style/className. `aspectRatio`
 * is a CSS `aspect-ratio` value (`w / h`); `known` records whether it came from real DTO
 * dimensions (true) or the fixed fallback (false), purely for clarity/testing. The box is
 * ALWAYS clamped to the existing `max-h-40 max-w-[12rem]` thumbnail envelope by the
 * component's Tailwind classes — this helper only decides the aspect ratio, so the box is
 * stable across loading/loaded/error and there is zero layout shift.
 */
export interface ReservedImageBox {
  /** CSS `aspect-ratio` (e.g. `1.5` for a 3:2 landscape thumbnail). */
  aspectRatio: number
  /** Whether the ratio derived from valid DTO dims (true) or the fixed fallback (false). */
  known: boolean
}

/**
 * The fixed fallback aspect ratio used when `w`/`h` are absent or invalid (OQ-2 default):
 * a modest landscape box (3:2) within the `max-h-40 max-w-[12rem]` envelope. A stable
 * reserved box is the point — `object-cover` crops any real-image mismatch gracefully, so
 * the loaded image still lands in the same box with no jump.
 */
export const FALLBACK_ASPECT_RATIO = 3 / 2

/**
 * Pure box-sizing helper. Returns the reserved-box aspect ratio for a thumbnail:
 * - valid finite POSITIVE `w` AND `h` → that image's aspect ratio (`w / h`), `known: true`;
 * - any dim absent, zero, negative, NaN, or non-finite → the {@link FALLBACK_ASPECT_RATIO}
 *   fixed box (`known: false`).
 *
 * The component clamps the resulting box to the thumbnail bounds, so the skeleton, the
 * loaded image, and the error placeholder all occupy the identical box (no reflow).
 */
export function reservedImageBox({ w, h }: ImageDims): ReservedImageBox {
  if (isValidDim(w) && isValidDim(h)) {
    return { aspectRatio: w / h, known: true }
  }
  return { aspectRatio: FALLBACK_ASPECT_RATIO, known: false }
}

/** A dimension is usable only if it is a finite, strictly-positive number. */
function isValidDim(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}
