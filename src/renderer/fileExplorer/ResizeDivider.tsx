/**
 * ResizeDivider — the bespoke 6px `role="separator"` drag handle between the terminal (left)
 * and the file explorer (right) inside one `TerminalView` (terminal-file-explorer-v1, FR-002,
 * design §1.3). Plain element + pointer/keyboard handlers — NOT `react-resizable-panels`, NOT a
 * `components/ui/resizable.tsx` (one consumer; D-3). The seam is the explorer's `border-l` at
 * rest; this transparent handle straddles it and shows a `--primary` accent on hover/drag.
 *
 * The divider reports the new terminal width (px) up to `TerminalPanel`, which clamps it to the
 * §1.2 mins and re-fits the xterm. Both pointer-drag and keyboard (Left/Right; Shift = coarse)
 * call the same `onResize(deltaPx)` so the parent owns the single clamp.
 */

import { useCallback, useRef, useState } from 'react'

/** Keyboard nudge step (px) and the Shift-coarse step (design §1.3). */
const STEP = 16
const COARSE_STEP = 64

export function ResizeDivider({
  onResize,
  disabled = false,
  ariaLabel = 'Resize columns'
}: {
  /** Apply a signed delta (px) to the column on the divider's LEFT. Negative = drag/arrow left,
   * positive = right. The parent owns the clamp + which column the delta drives. */
  onResize: (deltaPx: number) => void
  /** Awaiting-directory: a thin static, inert seam (no drag/keyboard, `tabIndex={-1}`). */
  disabled?: boolean
  /** A11y label naming the two columns this divider separates (e.g. "Resize terminal and viewer"). */
  ariaLabel?: string
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  // The last pointer X, so each pointermove applies only the incremental delta.
  const lastXRef = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled) {
        return
      }
      e.preventDefault()
      lastXRef.current = e.clientX
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [disabled]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging) {
        return
      }
      const delta = e.clientX - lastXRef.current
      lastXRef.current = e.clientX
      if (delta !== 0) {
        onResize(delta)
      }
    },
    [dragging, onResize]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (disabled) {
        return
      }
      const step = e.shiftKey ? COARSE_STEP : STEP
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onResize(-step)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onResize(step)
      }
    },
    [disabled, onResize]
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group/divider relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-brand-purple/50"
    >
      {/* A crisp centered accent line — transparent at rest, the cosmos BRAND purple on hover/drag
          (file-viewer-color-wrap-v1, #94: was the blue --primary; the divider now reads in the
          logo's pink→purple family, not stray blue). */}
      <span
        aria-hidden="true"
        className="w-px bg-transparent transition-colors group-hover/divider:w-0.5 group-hover/divider:bg-brand-purple/40 group-data-[dragging=true]/divider:w-0.5 group-data-[dragging=true]/divider:bg-brand-purple/70"
      />
    </div>
  )
}
