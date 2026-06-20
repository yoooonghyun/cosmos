/**
 * SlackImageViewer — the in-app attachment image viewer / lightbox
 * (slack-thread-sidepanel-and-image-viewer-v1, FR-008/FR-009/FR-011/FR-012).
 *
 * Reuses the existing shadcn `Dialog` (design §4). Opened from a clicked thumbnail in the
 * shared `SlackMessageRow.MessageImages`, it shows the LARGER image via the SAME opaque
 * `cosmos-slack-img://` ref as the thumbnail — no Slack token, secret, or
 * `files.slack.com` URL ever enters the renderer/DOM (FR-009). State is row-local (owned
 * by `SlackMessageRow`) so BOTH the native and generative surfaces get the viewer with
 * zero panel wiring.
 *
 * Sizing overrides the Dialog's `sm:max-w-lg` default to `max-w-[min(90vw,72rem)]` and
 * fits the image with `object-contain max-h-[80vh]` so a large image is bounded to the
 * in-app viewport (never an OS-fullscreen takeover — design §4.1). A failed fetch swaps to
 * an `ImageOff` fallback that stays dismissable (FR-012). Esc / backdrop / the built-in X
 * all close, with focus returning to the triggering thumbnail (Radix built-in, FR-011).
 *
 * Design trace: §4.1 sizing, §4.2 close, §4.3 sr-only title, §4.4 state matrix.
 */

import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import type { SlackImageRef } from '../../shared/slack'

/**
 * The image viewer. `img` is the clicked thumbnail's opaque ref (+ optional alt); `null`
 * means closed. `onOpenChange(false)` is called on any dismiss (Esc / backdrop / X) so the
 * owner clears its open state. The viewer only ever opens from a real thumbnail, so when
 * `img` is set there is always a `ref`.
 */
export function SlackImageViewer({
  img,
  onOpenChange
}: {
  img: SlackImageRef | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  // Track a failed fetch so we can swap to the fallback panel (FR-012). Reset whenever a
  // new image opens so a prior broken image never sticks to the next viewer open.
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [img?.ref])

  const alt = img?.alt ?? 'image'
  return (
    <Dialog open={img !== null} onOpenChange={onOpenChange}>
      <DialogContent className="w-fit max-w-[min(90vw,72rem)] gap-0 overflow-hidden border-border bg-popover p-0">
        {/* Accessible name only — no visible caption (design §4.3). */}
        <DialogTitle className="sr-only">{img?.alt ?? 'Image'}</DialogTitle>
        {img !== null && !failed ? (
          <img
            src={img.ref}
            alt={alt}
            onError={() => setFailed(true)}
            className="mx-auto block h-auto max-h-[80vh] w-auto max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-muted-foreground">
            <ImageOff className="size-8" aria-hidden="true" />
            <p className="text-sm">{img?.alt ?? 'Image unavailable'}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
