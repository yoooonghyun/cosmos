/**
 * CosmosMark — the cosmos symbol (4-point star/sparkle) as an inline SVG, in the PASTEL
 * variant: a fixed pink→purple linear gradient, NO background
 * (`assets/logo/cosmos-symbol-pastel.svg`). Inlined rather than an `<img>` so it is
 * CSP-safe without a loader (`img-src 'self' data:` blocks remote URLs) and the gradient
 * id can be made per-instance.
 *
 * The gradient id comes from `useId()` — all four panels can be mounted at once, so a
 * shared static id would collide and `url(#id)` could resolve to a hidden panel's def,
 * leaving the visible mark transparent. The fixed `width/height` are dropped (the caller
 * sizes via `className`, e.g. `size-8`); the mark is `aria-hidden` because the owning
 * button carries the accessible name (FR-013).
 */
import { useId, type SVGProps } from 'react'

export function CosmosMark(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  const pastelId = useId()
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id={pastelId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-pink)" />
          <stop offset="1" stopColor="var(--brand-purple)" />
        </linearGradient>
      </defs>
      <g transform="translate(100,100) scale(1.42)" fill={`url(#${pastelId})`}>
        <path d="M 0.00 -60.00 Q 9.55 -47.99 9.18 -22.17 Q 27.18 -40.68 42.43 -42.43 Q 40.68 -27.18 22.17 -9.18 Q 47.99 -9.55 60.00 0.00 Q 47.99 9.55 22.17 9.18 Q 40.68 27.18 42.43 42.43 Q 27.18 40.68 9.18 22.17 Q 9.55 47.99 0.00 60.00 Q -9.55 47.99 -9.18 22.17 Q -27.18 40.68 -42.43 42.43 Q -40.68 27.18 -22.17 9.18 Q -47.99 9.55 -60.00 0.00 Q -47.99 -9.55 -22.17 -9.18 Q -40.68 -27.18 -42.43 -42.43 Q -27.18 -40.68 -9.18 -22.17 Q -9.55 -47.99 0.00 -60.00 Z" />
        <g transform="translate(55.2,-55.2)">
          <path d="M 0.0 -10.0 Q 1.4 -3.4 2.3 -2.3 Q 3.4 -1.4 10.0 0.0 Q 3.4 1.4 2.3 2.3 Q 1.4 3.4 0.0 10.0 Q -1.4 3.4 -2.3 2.3 Q -3.4 1.4 -10.0 0.0 Q -3.4 -1.4 -2.3 -2.3 Q -1.4 -3.4 0.0 -10.0 Z" />
        </g>
        <g transform="translate(-55.2,55.2)">
          <path d="M 0.0 -6.0 Q 0.8 -2.0 1.4 -1.4 Q 2.0 -0.8 6.0 0.0 Q 2.0 0.8 1.4 1.4 Q 0.8 2.0 0.0 6.0 Q -0.8 2.0 -1.4 1.4 Q -2.0 0.8 -6.0 0.0 Q -2.0 -0.8 -1.4 -1.4 Q -0.8 -2.0 0.0 -6.0 Z" />
        </g>
      </g>
    </svg>
  )
}
