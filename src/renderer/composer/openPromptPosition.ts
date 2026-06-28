/**
 * openPromptPosition — pure, node-testable geometry for the draggable Open-Prompt
 * button (draggable-open-prompt-button-v1). NO DOM, NO React: the `.ts`/`.test.ts`
 * split (the `promptComposerLogic.ts` precedent) so the clamp/convert/threshold
 * decisions are unit-tested in vitest's node env; only the pointer/DOM binding lives
 * in `PromptComposer.tsx`.
 *
 * Position representation (spec OQ-1): a NORMALIZED FRACTION `{ xFrac, yFrac }` in
 * `[0,1]` of the panel content area (origin top-left). Panel-size-independent — it
 * maps to any panel size without drifting off-screen and needs no corner bookkeeping
 * (FR-006). The fraction is the ANCHOR (the button's top-left corner expressed as a
 * fraction); converting to px subtracts the button's own size from the usable range so
 * the WHOLE button body stays inside (FR-005/FR-012).
 */

/**
 * The globally-shared Open-Prompt button position — a normalized fraction of the panel
 * content area. NON-SECRET structure: two numbers only (FR-010). Both in `[0,1]`.
 */
export interface OpenPromptPosition {
  /** Horizontal anchor as a fraction of the panel content width, origin left. */
  xFrac: number
  /** Vertical anchor as a fraction of the panel content height, origin top. */
  yFrac: number
}

/**
 * Default centered-bottom position (FR-011) ≈ the current `absolute bottom-3
 * left-1/2 -translate-x-1/2` anchor: horizontally centered, near the bottom. `0.96`
 * keeps the button just above the footer; the size-aware px clamp pulls it fully into
 * view on small panels.
 */
export const DEFAULT_OPEN_PROMPT_POSITION: OpenPromptPosition = { xFrac: 0.5, yFrac: 0.96 }

/**
 * Pointer travel (px) that separates a DRAG from a CLICK (FR-002). A press-release
 * whose total travel stays BELOW this opens the composer (click-to-open preserved);
 * travel AT/ABOVE it begins a drag and suppresses the open.
 */
export const DRAG_THRESHOLD_PX = 4

/** The button's rendered size in px (the `size-12` logo = 3rem = 48px). */
export const OPEN_PROMPT_BUTTON_SIZE_PX = 48

/** Clamp a single number into `[lo, hi]`; out-of-range inputs snap to the nearest bound. */
function clampNumber(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo
  }
  if (value < lo) {
    return lo
  }
  if (value > hi) {
    return hi
  }
  return value
}

/**
 * Clamp a fraction position into `[0,1]` on both axes (FR-005/FR-009). A non-finite
 * component falls back to 0. Used at the renderer boundary and as a guard before paint.
 */
export function clampFraction(position: OpenPromptPosition): OpenPromptPosition {
  return {
    xFrac: clampNumber(position.xFrac, 0, 1),
    yFrac: clampNumber(position.yFrac, 0, 1)
  }
}

/** A panel content box's pixel size (its `getBoundingClientRect` width/height). */
export interface PanelBox {
  width: number
  height: number
}

/** A pixel anchor (the button's top-left corner) inside the panel content box. */
export interface PixelPoint {
  x: number
  y: number
}

/**
 * Convert a normalized fraction to a PIXEL anchor (the button's top-left corner),
 * SIZE-AWARE so the whole button body stays inside the panel (FR-005/FR-012). The
 * usable range per axis is `[0, size - button]`; the fraction maps across that reduced
 * range and is then clamped, so even a `{1,1}` fraction lands the button fully visible.
 * A panel smaller than the button pins the anchor at 0 (best-effort visibility).
 */
export function fractionToPx(
  position: OpenPromptPosition,
  box: PanelBox,
  buttonSize: number = OPEN_PROMPT_BUTTON_SIZE_PX
): PixelPoint {
  const f = clampFraction(position)
  const maxX = Math.max(0, box.width - buttonSize)
  const maxY = Math.max(0, box.height - buttonSize)
  return {
    x: clampNumber(f.xFrac * maxX, 0, maxX),
    y: clampNumber(f.yFrac * maxY, 0, maxY)
  }
}

/**
 * Convert a PIXEL anchor (button top-left) back to a normalized fraction, the inverse
 * of {@link fractionToPx} over the same size-aware usable range. A degenerate panel
 * (≤ button size on an axis) yields `0` for that axis. The result is clamped to `[0,1]`.
 */
export function pxToFraction(
  point: PixelPoint,
  box: PanelBox,
  buttonSize: number = OPEN_PROMPT_BUTTON_SIZE_PX
): OpenPromptPosition {
  const maxX = Math.max(0, box.width - buttonSize)
  const maxY = Math.max(0, box.height - buttonSize)
  return clampFraction({
    xFrac: maxX > 0 ? point.x / maxX : 0,
    yFrac: maxY > 0 ? point.y / maxY : 0
  })
}

/** The card's measured rendered size in px (the expanded composer `<form>` box). */
export interface CardSize {
  width: number
  height: number
}

/**
 * open-prompt-open-at-position-v1 — compute the expanded composer card's clamped top-left
 * in panel-box-relative px (same frame as the logo's `logoPx`), given the button's anchor,
 * the button size, the card's REAL measured size, and the panel content box. Pure + DOM-free
 * (the `.ts`/`.test.ts` split) so the anchor+clamp is node-tested.
 *
 * FR-002 (OQ-2 = CENTERED-ON-BUTTON) — the card is CENTERED over the button on BOTH axes, so the
 * button sits at the card's CENTER (not its bottom edge); the card's center coincides with the
 * button's center pre-clamp:
 *   `cardLeftRaw = anchor.x + buttonSize/2 - card.width/2`   (card center x over button center x)
 *   `cardTopRaw  = anchor.y + buttonSize/2 - card.height/2`  (card center y over button center y)
 * The transform-origin in the view is `center` to match, so the launch/dismiss morph emanates
 * from the button's center.
 *
 * FR-003/FR-004 — clamp PER AXIS into the panel box: shift inward by exactly the overflow
 * when the centered anchor pushes the card past the right/bottom wall, pin to `0` when it
 * would cross the left/top wall.
 *
 * FR-005 — when the panel is SMALLER than the card on an axis (degenerate), `max(0, panel -
 * card) = 0`, so that axis pins to `0` (panel origin): the card's origin-side edge stays
 * visible and the overflow spills off the FAR (bottom/right) wall only — mirrors
 * {@link fractionToPx}'s pin-at-0 behavior on a panel ≤ the button size.
 *
 * FR-006 — non-finite inputs flow through {@link clampNumber} (non-finite → `lo` = 0), so the
 * helper never returns NaN/Infinity.
 */
export function clampCardWithinPanel(
  anchor: PixelPoint,
  buttonSize: number,
  card: CardSize,
  panel: PanelBox
): PixelPoint {
  // CENTERED-ON-BUTTON (OQ-2): the card's center coincides with the button's center on both axes.
  const cardLeftRaw = anchor.x + buttonSize / 2 - card.width / 2
  const cardTopRaw = anchor.y + buttonSize / 2 - card.height / 2
  const maxLeft = Math.max(0, panel.width - card.width)
  const maxTop = Math.max(0, panel.height - card.height)
  return {
    x: clampNumber(cardLeftRaw, 0, maxLeft),
    y: clampNumber(cardTopRaw, 0, maxTop)
  }
}

/**
 * open-prompt-opens-top-left-v1 / open-prompt-card-never-opens-v1 — the floating composer card's
 * placement decision, the SINGLE source of truth for the .tsx so the visibility gate, the centered
 * fallback, and the precise transform can never drift apart. It encodes TWO independent thresholds
 * (conflating them caused the two paired regressions):
 *
 *  - `show` (panel-measured) — whether the card may be SHOWN at all. Gated ONLY on the panel
 *    content box being measured (`width > 0`), which is RELIABLE (the panel measure effect + its
 *    ResizeObserver). The "card never opens" regression came from ALSO gating show on the CARD
 *    measurement: the card's `w-full` width derives from the panel-sized layer, so it measures
 *    `{0,0}` until the panel is sized and may never re-measure to non-zero — trapping `show` false
 *    forever. Show must NOT depend on the card measuring.
 *  - `anchored` (card-measured) — whether the PRECISE button-anchored `px` is usable, which needs
 *    the card's real box. Until the card measures (null / degenerate `{0,0}`), the caller centers
 *    the card over the panel via dimension-independent CSS, so a shown-but-not-yet-anchored card is
 *    CENTERED, never at the raw top-left anchor (the top-left regression).
 *
 * So: hidden until the panel is measured; once shown, centered-over-panel until the card measures,
 * then button-anchored. The card therefore ALWAYS opens (panel measure is reliable) and NEVER
 * flashes at top-left. `px` is meaningful ONLY when `anchored`. Pure.
 */
export interface CardPlacement {
  /** The card may be shown — the PANEL content box is measured. Below this: hidden-until-measured. */
  show: boolean
  /** The precise button-anchored `px` is usable — the CARD measured a real non-zero box. When
   *  `show && !anchored` the caller centers the card over the panel via CSS instead. */
  anchored: boolean
  /** Button-anchored, clamped top-left px — VALID ONLY when `anchored` (else `{0,0}`, do not paint). */
  px: PixelPoint
}

export function resolveCardPlacement(
  anchor: PixelPoint,
  buttonSize: number,
  cardSize: CardSize | null,
  panel: PanelBox
): CardPlacement {
  // Mirror the logo's `panelRect.width === 0` gate: a hidden / not-yet-laid-out panel measures a
  // 0-box. The card SHOWS as soon as the panel is measured — INDEPENDENT of the card's own (often
  // lagging / chicken-and-egg) measurement, so it can never be trapped permanently invisible.
  const show = panel.width > 0
  // The precise button-anchored px needs a REAL non-zero card box — a null OR degenerate `{0,0}`
  // `cardSize` is exactly what made the old default skip the `-cardW/2` centering offset and
  // collapse the clamped top-left onto the raw anchor. Until then the caller uses the CSS centered
  // fallback (which needs no card dims), so a shown card is centered, never top-left.
  const anchored = show && cardSize != null && cardSize.width > 0 && cardSize.height > 0
  return {
    show,
    anchored,
    px: anchored ? clampCardWithinPanel(anchor, buttonSize, cardSize, panel) : { x: 0, y: 0 }
  }
}

/**
 * open-prompt-open-at-position-v1 (mid-settle open fix) — resolve the button's LIVE pixel
 * anchor at an interaction (a re-grab OR a click-to-open), choosing between the animated
 * follow position and the resting position derived from the committed fraction.
 *
 * While the eased release-settle is in flight, the committed `position` fraction is STALE
 * (it commits only ONCE the spring settles), so `restingPx` points at where the button will
 * END UP — not where it visually IS this frame. The live animated `currentPx` is the truth.
 * So: when a settle is in flight (`settleInFlight`), seed from `currentPx`; otherwise seed
 * from the resting anchor. This is the SAME decision `onLogoPointerDown` already used to
 * re-grab mid-settle, extracted here so the click-to-open path reuses it (and it is
 * node-tested). Pure.
 */
export function resolveLiveAnchor(
  settleInFlight: boolean,
  currentPx: PixelPoint,
  restingPx: PixelPoint
): PixelPoint {
  return settleInFlight ? { ...currentPx } : { ...restingPx }
}

/**
 * open-prompt-open-at-position-v1 (mid-settle open fix) — select the anchor the EXPANDED card
 * opens at, with the correct PRECEDENCE for a click-to-open that may follow a settle-interrupting
 * pointerdown.
 *
 * THE PROBLEM this encodes: a click is pointerdown→pointerup→click. When the user clicks the logo
 * mid-glide, pointerdown cancels the settle rAF and pointerup clears the painted `dragPx`, so by
 * the time the click fires the `settleInFlight` heuristic (`rafId != null || dragPx != null`) is
 * already FALSE and `restingPx` may still be the OLD end-target (the commit hasn't re-rendered).
 * To survive that, pointerdown SYNCHRONOUSLY stashes the live grab point; this helper PREFERS it.
 *
 * Precedence: `stashed` (the gesture-captured live grab point, ref state immune to render timing)
 * wins; otherwise fall back to {@link resolveLiveAnchor} (animated `currentPx` while a settle is
 * still in flight, else the resting anchor for a true at-rest open). Returns a COPY. Pure.
 */
export function resolveOpenAnchor(
  stashed: PixelPoint | null,
  settleInFlight: boolean,
  currentPx: PixelPoint,
  restingPx: PixelPoint
): PixelPoint {
  return stashed ? { ...stashed } : resolveLiveAnchor(settleInFlight, currentPx, restingPx)
}

/**
 * Whether pointer travel from `start` to `current` has reached the drag threshold
 * (FR-002). Uses squared distance to avoid a sqrt. Below threshold ⇒ false (a click,
 * the composer opens); at/above ⇒ true (a drag, the open is suppressed).
 */
export function isDrag(
  start: PixelPoint,
  current: PixelPoint,
  threshold: number = DRAG_THRESHOLD_PX
): boolean {
  const dx = current.x - start.x
  const dy = current.y - start.y
  return dx * dx + dy * dy >= threshold * threshold
}

/**
 * Half-life (ms) of the drag-follow ease (draggable-open-prompt-button-v1 motion refinement):
 * the time for the gap between the animated button and the cursor target to halve. ~90ms reads
 * as a snappy-but-fluid follow — fast enough to feel responsive, slow enough that a quick cursor
 * jump accelerates the button into motion and it decelerates as it catches up. Used by the rAF
 * loop in PromptComposer as `expLerp(current, target, dt, FOLLOW_HALF_LIFE_MS)`.
 */
export const FOLLOW_HALF_LIFE_MS = 90

/**
 * Sub-pixel settle threshold (px). Once the animated value is within this of the target on both
 * axes the rAF loop treats the spring as SETTLED — it snaps to the target and stops the loop, so
 * the follow doesn't churn forever on an asymptote. {@link isSettled} encodes the decision.
 */
export const FOLLOW_SETTLE_EPSILON_PX = 0.1

/**
 * Framerate-INDEPENDENT exponential ease of a single scalar toward `target` over frame time `dt`
 * (ms), parameterised by a HALF-LIFE (ms) — the time for the remaining gap to halve. This is the
 * closed-form of exponential decay `current += (target-current) * (1 - 2^(-dt/halfLife))`, so it
 * COMPOSES exactly: stepping N small `dt`s equals one big `dt` of the same total (no Euler drift,
 * unlike a naive `current += (target-current)*k`). It MONOTONICALLY approaches the target and
 * never overshoots (the blend factor is in `[0,1)`), giving natural acceleration when the target
 * jumps and deceleration as the gap closes. Non-finite/≤0 inputs degrade safely:
 *   - `dt <= 0` or non-finite ⇒ no progress (returns `current`);
 *   - non-finite `current`/`target`/`halfLife` ⇒ snap to `target` (best-effort, never NaN);
 *   - `halfLife <= 0` ⇒ instant (snap to `target`), matching reduced-motion.
 */
export function expLerp(current: number, target: number, dt: number, halfLifeMs: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(halfLifeMs)) {
    return Number.isFinite(target) ? target : current
  }
  if (halfLifeMs <= 0) {
    return target
  }
  if (!Number.isFinite(dt) || dt <= 0) {
    return current
  }
  const blend = 1 - Math.pow(2, -dt / halfLifeMs)
  return current + (target - current) * blend
}

/**
 * Framerate-independent exponential ease of a 2-D pixel anchor toward `target` — {@link expLerp}
 * applied per axis. Used each rAF frame to advance the drag-follow `current` toward the clamped
 * cursor `target`.
 */
export function stepFollow(
  current: PixelPoint,
  target: PixelPoint,
  dt: number,
  halfLifeMs: number = FOLLOW_HALF_LIFE_MS
): PixelPoint {
  return {
    x: expLerp(current.x, target.x, dt, halfLifeMs),
    y: expLerp(current.y, target.y, dt, halfLifeMs)
  }
}

/**
 * Whether the animated follow has effectively reached its target (within
 * {@link FOLLOW_SETTLE_EPSILON_PX} on both axes). The rAF loop snaps to the target and stops once
 * this is true, so the asymptotic ease terminates cleanly (and, on release, commits the final
 * fraction exactly once).
 */
export function isSettled(
  current: PixelPoint,
  target: PixelPoint,
  epsilon: number = FOLLOW_SETTLE_EPSILON_PX
): boolean {
  return Math.abs(current.x - target.x) <= epsilon && Math.abs(current.y - target.y) <= epsilon
}
