# Bug: Open Prompt card never opens on floating (non-cosmos) panels — REGRESSION

ID: `open-prompt-card-never-opens-v1`
Skill: bugfix
Status: Fixed (developer) — pending review
Reported: 2026-06-28

## Resolution (developer)

Root cause CONFIRMED at `src/renderer/composer/openPromptPosition.ts` `resolveCardPlacement` +
`src/renderer/composer/PromptComposer.tsx` (the card wrapper render). The top-left fix used ONE
`ready` flag to drive BOTH visibility AND position, and `ready` required the CARD to be measured
to a real non-zero box (`cardSize.width>0 && cardSize.height>0`). On the real floating open the
card's `w-full` width derives from the `fixed` slot sized to `panelRect`, so the form measures
`{0,0}` until the panel is sized, and re-measurement depended on a ResizeObserver that may never
converge ⇒ `ready` stayed false forever ⇒ the card was permanently `invisible` ("대화창이 안 뜸").

Fix — SPLIT the one flag into two independent thresholds (`resolveCardPlacement` now returns
`{ show, anchored, px }`):
- `show = panel.width > 0` — the card may be shown as soon as the PANEL is measured (reliable),
  INDEPENDENT of the card's own (lagging / chicken-and-egg) measurement, so it can never be trapped
  invisible.
- `anchored = show && cardSize.width>0 && cardSize.height>0` — the precise button-anchored `px` is
  usable only once the CARD measures. While `show && !anchored` the card is centered over the panel
  via dimension-independent CSS (`left-1/2 top-1/2 -translate-1/2`), so it OPENS centered, never at
  the top-left anchor — preserving open-prompt-opens-top-left-v1.
- `PromptComposer.tsx` card-measure `useLayoutEffect` now also depends on `panelRect.width/height`,
  so the panel-sized form re-measures to `anchored` without relying on the ResizeObserver firing.

Tests:
- `src/renderer/composer/openPromptPosition.test.ts` — `resolveCardPlacement` rows rewritten for the
  show/anchored thresholds incl. the explicit "panel measured but card not ⇒ show=true, anchored=
  false" row (RED on the old `ready`-only gate).
- `src/renderer/composer/PromptComposerFloatingOpenPosition.dom.test.tsx` — STRENGTHENED to drive the
  REAL open→measure transition: the new middle case mocks ONLY the panel box and leaves the card's
  `offsetWidth` at 0 (real jsdom), asserting the card STILL OPENS (not `invisible`) and centered.
  Confirmed RED on the over-gated wiring, GREEN after. (The previous version mocked BOTH the panel and
  the card box, which only proved "given a measured card it shows" — the gap that let this through.)

Verified: `npm run typecheck` clean, `npm test` 2629 passing, `npm run test:dom` 44 passing.
TEST-SCENARIOS.md CMP-OPENPOS-01 updated.

## Symptom (user)

On the OTHER (non-cosmos / floating) panels, clicking the Open Prompt button no longer opens the
composer card ("대화창이 안 뜸") — the card never appears.

## Suspected root cause (regression)

Introduced by `open-prompt-opens-top-left-v1`. The new `resolveCardPlacement`
(`src/renderer/composer/openPromptPosition.ts:192-208`) gates visibility on:
`ready = panel.width > 0 && cardSize != null && cardSize.width > 0 && cardSize.height > 0`.
The floating card is kept hidden until `ready`. If, on the floating open path, `cardSize` never
measures to a real non-zero box (measurement effect/ResizeObserver doesn't fire, or measures `{0,0}`
because the form is `invisible`/not laid out at the moment of measure), `ready` stays false FOREVER
⇒ the card is permanently invisible ⇒ "doesn't open". The fix's belt-and-suspenders (hidden+centered
until ready) is correct for the top-left bug, but the `ready` condition appears to be unreachable on
the real floating open flow.

## Why the existing test didn't catch it

`PromptComposerFloatingOpenPosition.dom.test.tsx` MOCKS `getBoundingClientRect` + `offsetWidth/Height`
to inject the MEASURED state, so it tests "given a measured card, it shows" — it never exercises the
real open → measure → become-ready transition. So it's green while the real flow never reaches
`ready`. (The exact "jsdom green, runtime broken" gap.) The regression test must drive the REAL
open + the REAL measurement wiring (or a faithful stand-in), not inject the measured result.

## To do (developer — same one who wrote resolveCardPlacement)

1. Reproduce the floating open flow and find why `ready` never flips (does the measurement effect run
   when the card mounts on open? does `invisible` block layout measurement? does cardSize stay null/
   {0,0}?). Confirm `file:line`.
2. Fix so the floating card RELIABLY becomes visible on open (measures → ready), while PRESERVING the
   top-left fix (must still never paint at the anchor before measured). Likely: ensure the card
   mounts + measures on open (visibility:hidden allows measurement; display:none/unmounted does not),
   or relax the `ready` gate so a transient {0,0} doesn't permanently trap it.
3. Strengthen the regression test to exercise the REAL open→measure→visible transition (not a
   pre-injected measured state), so BOTH this "never opens" bug AND the original top-left bug are
   guarded. Update `docs/TEST-SCENARIOS.md` (CMP-OPENPOS-01).

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green; exercise opening on a floating panel in
`npm run dev` (after restart) — card appears, centered, not top-left.
