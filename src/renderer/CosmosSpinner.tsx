/**
 * CosmosSpinner — the cosmos sparkle as an animated loading spinner, inlined as a React
 * component (sibling of `CosmosMark`). Source artwork: `assets/images/cosmos-spinner.svg`
 * (a slowly-orbiting 4-point star with two pulsing sub-sparkles), reborn here for the
 * surface send-spinner (composer-send-animation-v1, design §1).
 *
 * Inlined rather than an `<img>` for the SAME reasons as `CosmosMark`:
 *   - CSP-safe without a loader (`img-src 'self' data:` blocks the bundled asset path).
 *   - The gradient id is per-instance via `useId()`. Up to four panels can be mounted at
 *     once, each rendering its own content region; a shared static id (`"ps"` in the SVG)
 *     would collide and `url(#ps)` could resolve to a hidden panel's def, painting the
 *     visible spinner transparent. `useId()` eliminates that.
 *   - The gradient stops route through the theme tokens (`var(--brand-pink)` →
 *     `var(--brand-purple)`); an `<img>` SVG can't read the host document's CSS vars.
 *
 * The three `@keyframes` + the `cosmos-spinner-orbit` / `cosmos-spinner-sparkA` /
 * `cosmos-spinner-sparkB` classes live in `src/renderer/index.css` (NOT an inline
 * `<style>`, which would inject global, leak-prone class names once per mounted instance
 * and could not be gated with `prefers-reduced-motion`). Those CSS rules are gated behind
 * `@media (prefers-reduced-motion: no-preference)`, so under reduced motion the sparkle
 * renders static at its authored base transform/opacity — still legible (the owning
 * `SurfaceSpinner` carries the "Generating…" label + `aria-busy` as the busy signal).
 *
 * `aria-hidden` because the owning `SurfaceSpinner`'s `role="status"` carries the
 * accessible name; the caller sizes via `className` (e.g. `size-10`).
 */
import { useId, type SVGProps } from 'react'

export function CosmosSpinner(props: SVGProps<SVGSVGElement>): React.JSX.Element {
  const gradientId = useId()
  return (
    <svg
      viewBox="-80 -80 160 160"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-pink)" />
          <stop offset="1" stopColor="var(--brand-purple)" />
        </linearGradient>
      </defs>
      <g className="cosmos-spinner-orbit" fill={`url(#${gradientId})`}>
        <path d="M 0.00 -60.00 Q 9.55 -47.99 9.18 -22.17 Q 27.18 -40.68 42.43 -42.43 Q 40.68 -27.18 22.17 -9.18 Q 47.99 -9.55 60.00 0.00 Q 47.99 9.55 22.17 9.18 Q 40.68 27.18 42.43 42.43 Q 27.18 40.68 9.18 22.17 Q 9.55 47.99 0.00 60.00 Q -9.55 47.99 -9.18 22.17 Q -27.18 40.68 -42.43 42.43 Q -40.68 27.18 -22.17 9.18 Q -47.99 9.55 -60.00 0.00 Q -47.99 -9.55 -22.17 -9.18 Q -40.68 -27.18 -42.43 -42.43 Q -27.18 -40.68 -9.18 -22.17 Q -9.55 -47.99 0.00 -60.00 Z" />
      </g>
      <g transform="translate(58,-58)">
        <g className="cosmos-spinner-sparkA" fill={`url(#${gradientId})`}>
          <path d="M 0.0 -11.0 Q 1.5 -3.7 2.5 -2.5 Q 3.7 -1.5 11.0 0.0 Q 3.7 1.5 2.5 2.5 Q 1.5 3.7 0.0 11.0 Q -1.5 3.7 -2.5 2.5 Q -3.7 1.5 -11.0 0.0 Q -3.7 -1.5 -2.5 -2.5 Q -1.5 -3.7 0.0 -11.0 Z" />
        </g>
      </g>
      <g transform="translate(-58,58)">
        <g className="cosmos-spinner-sparkB" fill={`url(#${gradientId})`}>
          <path d="M 0.0 -8.0 Q 1.1 -2.7 1.8 -1.8 Q 2.7 -1.1 8.0 0.0 Q 2.7 1.1 1.8 1.8 Q 1.1 2.7 0.0 8.0 Q -1.1 2.7 -1.8 1.8 Q -2.7 1.1 -8.0 0.0 Q -2.7 -1.1 -1.8 -1.8 Q -1.1 -2.7 0.0 -8.0 Z" />
        </g>
      </g>
    </svg>
  )
}
