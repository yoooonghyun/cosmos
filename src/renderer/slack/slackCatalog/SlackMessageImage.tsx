/**
 * SlackMessageImage — a single Slack message ATTACHMENT thumbnail with a loading skeleton
 * (slack-image-skeleton-placeholder-v1, FR-001..FR-007/FR-011).
 *
 * Slack attachment bytes are fetched in main (with the token) only AFTER the `<img>` mounts,
 * via the opaque `cosmos-slack-img://` ref — so the thumbnail is blank until that fetch lands
 * and then pops in. This wrapper reserves the image's eventual box up front and shows a
 * `Skeleton` (the SAME shadcn primitive as `MessageSkeleton`) until the image's `onLoad`
 * fires, then swaps in the loaded image. On `onError` it shows the `ImageOff` "image
 * unavailable" placeholder reused from `SlackImageViewer` — never a perpetual skeleton or a
 * broken-image glyph. The reserved box (from `reservedImageBox`) exists across all three
 * states, so there is zero layout shift.
 *
 * Secret boundary UNCHANGED: this component only ever touches the opaque `img.ref` (handed
 * straight to `<img src>`) and the optional natural `w`/`h` — no token, no `files.slack.com`
 * URL ever enters renderer state, a prop, or a DOM attribute. The pure lifecycle reducer +
 * box-sizing live in `imageLoadState.ts` (node-tested); this file is the React shell only.
 *
 * Used INSIDE the existing `<button>` overlay in `SlackMessageRow.MessageImages` so the
 * button's focus ring, hover overlay, and `Maximize2` zoom affordance are preserved; each
 * attachment renders its own `SlackMessageImage`, so siblings track independent load state.
 */

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { nextImageLoadStatus, reservedImageBox, type ImageLoadStatus } from './imageLoadState'
import type { SlackImageRef } from '../../../shared/types/slack'

/**
 * One attachment thumbnail. `img` is the opaque ref (+ optional alt/dims). `className`
 * carries the existing thumbnail bounds (`max-h-40 max-w-[12rem] object-cover`) so the
 * loaded `<img>` and the skeleton/error box share identical sizing.
 */
export function SlackMessageImage({
  img,
  className
}: {
  img: SlackImageRef
  className?: string
}): React.JSX.Element {
  const [status, setStatus] = useState<ImageLoadStatus>('loading')
  const box = reservedImageBox({ w: img.w, h: img.h })
  const alt = img.alt ?? 'image'

  // ONE reserved outer box owns the dimensions (aspect-ratio + 12rem width, capped by the
  // thumbnail bounds). Skeleton, loaded <img>, and error placeholder ALL fill that SAME box —
  // the <img> is ALWAYS absolute-inset-0 + object-cover (never in-flow with its own intrinsic
  // size), so the box is identical across loading→loaded→error and the swap causes ZERO layout
  // shift (FR-003/SC-002), including for portrait/narrow images.
  const boxClass = cn('relative block overflow-hidden max-h-40 max-w-[12rem]', className)
  const boxStyle = { aspectRatio: box.aspectRatio, width: '12rem' } as const

  if (status === 'error') {
    // Reuse SlackImageViewer's ImageOff "image unavailable" treatment at thumbnail scale,
    // in the SAME reserved box so the failed download does not shift layout.
    return (
      <span
        className={cn(boxClass, 'flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground')}
        style={boxStyle}
        role="img"
        aria-label={alt === 'image' ? 'Image unavailable' : `${alt} (unavailable)`}
      >
        <ImageOff className="size-5" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span className={boxClass} style={boxStyle}>
      {status === 'loading' && (
        <Skeleton
          className="absolute inset-0 size-full"
          aria-busy="true"
          aria-label={`Loading ${alt}`}
        />
      )}
      <img
        src={img.ref}
        alt={alt}
        onLoad={() => setStatus((s) => nextImageLoadStatus(s, 'load'))}
        onError={() => setStatus((s) => nextImageLoadStatus(s, 'error'))}
        className={cn(
          // Always fills the reserved box (absolute inset-0, object-cover); only the opacity
          // changes on load, so the box never resizes when the image lands.
          'absolute inset-0 size-full object-cover transition-opacity duration-200',
          status === 'loaded' ? 'opacity-100' : 'opacity-0'
        )}
      />
    </span>
  )
}
