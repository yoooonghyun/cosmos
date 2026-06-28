/**
 * SurfaceSpinner — the shared busy indicator shown on a generative panel's content
 * region (the `role="tabpanel"` body) while a submitted run is in flight, until that
 * run's Generative UI lands (composer-send-animation-v1 FR-005/FR-011, design §2).
 *
 * Since the composer expands-and-vanishes on submit and rests collapsed (it is no longer
 * on screen during the run, spec §99), the busy affordance lives where the result will
 * appear: the surface. Every panel renders ONE of these, gated by the pure
 * `surfaceSpinnerVisible(...)` predicate against its ACTIVE tab — so the gate, not this
 * component, owns the per-tab scoping (FR-008). This is purely presentational.
 *
 * a11y (FR-012): `role="status"` + `aria-live="polite"` + `aria-busy="true"`, with the
 * visible "Generating…" text as the accessible name. When the surface lands (or errors)
 * this unmounts and the surface / `role="alert"` error takes its place; the live region's
 * removal + the new content announce the transition. The "Generating…" label is
 * LOAD-BEARING, not decorative: under `prefers-reduced-motion` the sparkle is static, so
 * the label + `aria-busy` are what convey "busy" to sighted and AT users (design §2).
 */
import { CosmosSpinner } from './CosmosSpinner'

export function SurfaceSpinner(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-3 text-muted-foreground"
    >
      <CosmosSpinner className="size-10" />
      <span className="text-[13px] text-muted-foreground">Generating…</span>
    </div>
  )
}
