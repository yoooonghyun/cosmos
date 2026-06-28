import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OPEN_PROMPT_POSITION,
  DRAG_THRESHOLD_PX,
  OPEN_PROMPT_BUTTON_SIZE_PX,
  FOLLOW_HALF_LIFE_MS,
  clampFraction,
  clampCardWithinPanel,
  resolveLiveAnchor,
  resolveOpenAnchor,
  fractionToPx,
  pxToFraction,
  isDrag,
  expLerp,
  stepFollow,
  isSettled,
  type OpenPromptPosition
} from './openPromptPosition'

/*
 * draggable-open-prompt-button-v1 — pure geometry (Steps 4/5). Node env, no DOM.
 * Tests the `.ts` ONLY, per CLAUDE.md / promptComposerLogic.test.ts precedent (SC-005).
 */

const BOX = { width: 1000, height: 800 }
const BTN = OPEN_PROMPT_BUTTON_SIZE_PX // 48

describe('clampFraction — out-of-range and malformed inputs (FR-005/FR-009)', () => {
  it('passes an in-range position through unchanged', () => {
    const p: OpenPromptPosition = { xFrac: 0.25, yFrac: 0.75 }
    expect(clampFraction(p)).toEqual({ xFrac: 0.25, yFrac: 0.75 })
  })

  it('clamps over-range components down to 1 and under-range up to 0', () => {
    expect(clampFraction({ xFrac: 5, yFrac: -2 })).toEqual({ xFrac: 1, yFrac: 0 })
  })

  it('coerces a non-finite component to 0 (never NaN/Infinity)', () => {
    expect(clampFraction({ xFrac: Number.NaN, yFrac: Number.POSITIVE_INFINITY })).toEqual({
      xFrac: 0,
      yFrac: 0
    })
  })
})

describe('fractionToPx — size-aware anchor keeps the whole button inside (FR-005/FR-012)', () => {
  it('maps the default centered-bottom fraction near bottom-center, fully in-bounds', () => {
    const px = fractionToPx(DEFAULT_OPEN_PROMPT_POSITION, BOX)
    // x ≈ 0.5 * (1000-48) = 476 ; y ≈ 0.96 * (800-48) = 721.92
    expect(px.x).toBeCloseTo(476)
    expect(px.y).toBeCloseTo(721.92)
    // the whole 48px button still fits: anchor + size ≤ panel size
    expect(px.x + BTN).toBeLessThanOrEqual(BOX.width)
    expect(px.y + BTN).toBeLessThanOrEqual(BOX.height)
  })

  it('a {1,1} fraction lands the button flush against the far edge, never past it', () => {
    const px = fractionToPx({ xFrac: 1, yFrac: 1 }, BOX)
    expect(px.x).toBe(BOX.width - BTN) // 952
    expect(px.y).toBe(BOX.height - BTN) // 752
  })

  it('a {0,0} fraction pins the anchor at the top-left origin', () => {
    expect(fractionToPx({ xFrac: 0, yFrac: 0 }, BOX)).toEqual({ x: 0, y: 0 })
  })

  it('a panel smaller than the button pins the anchor at 0 (best-effort visibility)', () => {
    expect(fractionToPx({ xFrac: 0.5, yFrac: 0.5 }, { width: 30, height: 20 })).toEqual({
      x: 0,
      y: 0
    })
  })
})

describe('pxToFraction — inverse of fractionToPx over the same usable range', () => {
  it('round-trips an in-range fraction through px↔fraction (SC-005)', () => {
    const p: OpenPromptPosition = { xFrac: 0.3, yFrac: 0.6 }
    const round = pxToFraction(fractionToPx(p, BOX), BOX)
    expect(round.xFrac).toBeCloseTo(0.3)
    expect(round.yFrac).toBeCloseTo(0.6)
  })

  it('clamps an out-of-bounds release point back into [0,1] (drag released outside panel)', () => {
    const f = pxToFraction({ x: 99999, y: -50 }, BOX)
    expect(f).toEqual({ xFrac: 1, yFrac: 0 })
  })

  it('a degenerate panel (≤ button size) yields 0 for that axis (no divide-by-zero)', () => {
    // width 40 ≤ 48 ⇒ x axis collapses to 0; the y axis (height 800) maps normally.
    const f = pxToFraction({ x: 10, y: 376 }, { width: 40, height: 800 })
    expect(f.xFrac).toBe(0)
    expect(f.yFrac).toBeCloseTo(376 / (800 - OPEN_PROMPT_BUTTON_SIZE_PX))
  })
})

describe('clampCardWithinPanel — card CENTERED on the button (both axes), clamp into panel (FR-002–006, OQ-2)', () => {
  // A card comfortably smaller than the 1000x800 BOX so the mid-panel case has room.
  const CARD = { width: 400, height: 300 }
  // Centered-on-button offsets: card center coincides with the button center on each axis.
  //   HOFF = anchor.x + BTN/2 - card.width/2  = anchor.x + 24 - 200 = anchor.x - 176
  //   VOFF = anchor.y + BTN/2 - card.height/2 = anchor.y + 24 - 150 = anchor.y - 126
  const HOFF = BTN / 2 - CARD.width / 2 // -176
  const VOFF = BTN / 2 - CARD.height / 2 // -126

  it('mid-panel with room on all sides → centered on the button, no clamp shift', () => {
    const anchor = { x: 300, y: 500 } // logo top-left
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    // the card's CENTER coincides with the button's CENTER on BOTH axes (pre-clamp, no shift):
    expect(px).toEqual({ x: 300 + HOFF, y: 500 + VOFF }) // { x: 124, y: 374 }
    expect(px.x + CARD.width / 2).toBeCloseTo(anchor.x + BTN / 2) // card center x == button center x
    expect(px.y + CARD.height / 2).toBeCloseTo(anchor.y + BTN / 2) // card center y == button center y
  })

  it('top-left corner → both axes pin to origin 0 (centering would go negative)', () => {
    // centered raw left = 10 - 176 = -166 → 0; raw top = 10 - 126 = -116 → 0.
    const px = clampCardWithinPanel({ x: 10, y: 10 }, BTN, CARD, BOX)
    expect(px).toEqual({ x: 0, y: 0 })
  })

  it('top-right corner → x shifts left so the right edge is inside; y pins to 0', () => {
    // logo docked top-right (anchor.x = 952); centered raw left = 952-176 = 776 > maxLeft 600.
    const anchor = { x: BOX.width - BTN, y: 10 }
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    expect(px.x).toBe(BOX.width - CARD.width) // 600 → right edge flush at panel.width
    expect(px.x + CARD.width).toBe(BOX.width)
    expect(px.y).toBe(0) // centered raw top -116 pinned to ceiling
  })

  it('bottom-left corner → x pins to 0; y shifts up so the bottom edge is inside the floor', () => {
    // logo at bottom-left (anchor.y = 752); raw left -176 → 0; raw top = 752-126 = 626 > maxTop 500.
    const anchor = { x: 0, y: BOX.height - BTN }
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    expect(px.x).toBe(0)
    expect(px.y).toBe(BOX.height - CARD.height) // 500 → bottom edge flush at panel.height
    expect(px.y + CARD.height).toBe(BOX.height)
  })

  it('bottom-right corner → both axes clamped inward; whole box inside both far walls', () => {
    const anchor = { x: BOX.width - BTN, y: BOX.height - BTN } // { 952, 752 }
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    // x shifts left off the right wall (raw 776 → 600); y shifts up off the floor (raw 626 → 500).
    expect(px.x).toBe(BOX.width - CARD.width) // 600
    expect(px.y).toBe(BOX.height - CARD.height) // 500
    expect(px.x + CARD.width).toBeLessThanOrEqual(BOX.width)
    expect(px.y + CARD.height).toBeLessThanOrEqual(BOX.height)
  })

  it('right mid-edge → x shifts left so the right edge is flush; y centered (no shift)', () => {
    const anchor = { x: BOX.width - BTN, y: 500 } // far right, mid-height
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    expect(px.x).toBe(BOX.width - CARD.width) // 600 → flush
    expect(px.y).toBe(500 + VOFF) // 374, centered on the button vertically, no shift
  })

  it('left mid-edge → x pins to 0 (centered raw is negative), y centered (no shift)', () => {
    const px = clampCardWithinPanel({ x: 0, y: 500 }, BTN, CARD, BOX)
    expect(px).toEqual({ x: 0, y: 374 })
  })

  it('center-panel logo well inside → card stays centered on it, no clamp on either axis', () => {
    const anchor = { x: 480, y: 400 }
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    expect(px).toEqual({ x: 480 + HOFF, y: 400 + VOFF }) // { x: 304, y: 274 }
    expect(px.x).toBeGreaterThan(0)
    expect(px.y).toBeGreaterThan(0)
    expect(px.x + CARD.width).toBeLessThan(BOX.width)
    expect(px.y + CARD.height).toBeLessThan(BOX.height)
    // the button center sits at the card's center on both axes:
    expect(px.x + CARD.width / 2).toBeCloseTo(anchor.x + BTN / 2)
    expect(px.y + CARD.height / 2).toBeCloseTo(anchor.y + BTN / 2)
  })

  it('top mid-edge → centered horizontally; clamps down so its top stays inside the ceiling', () => {
    const anchor = { x: 300, y: 0 } // logo at the very top
    const px = clampCardWithinPanel(anchor, BTN, CARD, BOX)
    expect(px.y).toBe(0) // centered raw top -126 pinned to ceiling
    expect(px.x).toBe(300 + HOFF) // 124 — centered, in-bounds horizontally
  })

  it('short panel (centering pushes the box past the floor) → y clamps so the box bottom is inside', () => {
    const shortPanel = { width: 1000, height: 320 }
    // maxTop = 320 - 300 = 20; centered raw top = 300 + 24 - 150 = 174 > 20 → clamps DOWN to 20.
    const px = clampCardWithinPanel({ x: 100, y: 300 }, BTN, { width: 400, height: 300 }, shortPanel)
    expect(px.y).toBe(20)
    expect(px.y + 300).toBeLessThanOrEqual(shortPanel.height) // box bottom at/inside the floor
  })

  it('panel SMALLER than the card on both axes (degenerate) → pin to origin 0 (FR-005)', () => {
    const tinyPanel = { width: 200, height: 150 }
    const bigCard = { width: 400, height: 300 }
    const px = clampCardWithinPanel({ x: 120, y: 100 }, BTN, bigCard, tinyPanel)
    // max(0, 200-400)=0 and max(0, 150-300)=0 ⇒ both pin to origin; overflow off far walls.
    expect(px).toEqual({ x: 0, y: 0 })
  })

  it('non-finite anchor / card size → finite clamped result, never throws (FR-006)', () => {
    const px = clampCardWithinPanel(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      BTN,
      { width: Number.NaN, height: 300 },
      BOX
    )
    expect(Number.isFinite(px.x)).toBe(true)
    expect(Number.isFinite(px.y)).toBe(true)
    // NaN anchor.x → clampNumber lo = 0; card.width NaN → maxLeft = max(0, 1000-NaN)=NaN→…
    expect(px.x).toBe(0)
    expect(px.y).toBe(0) // +Infinity top, clamped to lo 0
  })
})

describe('resolveLiveAnchor — live vs resting anchor seeding (mid-settle open + re-grab fix)', () => {
  const current = { x: 137, y: 264 } // where the button visually IS mid-glide
  const resting = { x: 480, y: 720 } // where the committed fraction says it will END UP

  it('mid-settle (settleInFlight) → seeds from the LIVE animated currentPx, not resting', () => {
    expect(resolveLiveAnchor(true, current, resting)).toEqual(current)
  })

  it('at rest (no settle) → seeds from the resting anchor', () => {
    expect(resolveLiveAnchor(false, current, resting)).toEqual(resting)
  })

  it('returns a COPY (defensive) — mutating the result never mutates the source point', () => {
    const out = resolveLiveAnchor(true, current, resting)
    out.x = 9999
    expect(current.x).toBe(137) // source untouched
  })
})

describe('resolveOpenAnchor — card open-anchor precedence across the click event sequence', () => {
  const stashed = { x: 137, y: 264 } // the live grab point captured in pointerdown (mid-glide)
  const current = { x: 150, y: 270 } // the rAF-painted current px
  const resting = { x: 480, y: 720 } // the STALE end-target (committed fraction not yet updated)

  it('click-to-open mid-settle: pointerdown stashed the live grab point → opens THERE, not resting', () => {
    // After pointerdown cancels the rAF and pointerup clears dragPx, settleInFlight is FALSE and
    // restingPx is still the stale end-target — but the stashed grab point wins (the reported bug).
    expect(resolveOpenAnchor(stashed, false, current, resting)).toEqual(stashed)
  })

  it('stash wins even if a settle somehow still reads in-flight (stash is the authoritative live pt)', () => {
    expect(resolveOpenAnchor(stashed, true, current, resting)).toEqual(stashed)
  })

  it('no stash + settle in flight → the live animated currentPx (mid-glide open without pointerdown interrupt)', () => {
    expect(resolveOpenAnchor(null, true, current, resting)).toEqual(current)
  })

  it('no stash + at rest → the resting anchor (a plain at-rest click, no regression)', () => {
    expect(resolveOpenAnchor(null, false, current, resting)).toEqual(resting)
  })

  it('returns a COPY of the stashed point — mutating the result never mutates the source', () => {
    const out = resolveOpenAnchor(stashed, false, current, resting)
    out.y = -1
    expect(stashed.y).toBe(264)
  })
})

describe('isDrag — drag/click threshold (FR-002)', () => {
  const start = { x: 100, y: 100 }

  it('returns false for zero travel (a pure click)', () => {
    expect(isDrag(start, { x: 100, y: 100 })).toBe(false)
  })

  it('returns false just below the threshold (still a click → composer opens)', () => {
    expect(isDrag(start, { x: 100 + (DRAG_THRESHOLD_PX - 1), y: 100 })).toBe(false)
  })

  it('returns true at exactly the threshold (a drag → suppress open)', () => {
    expect(isDrag(start, { x: 100 + DRAG_THRESHOLD_PX, y: 100 })).toBe(true)
  })

  it('returns true past the threshold on the diagonal', () => {
    expect(isDrag(start, { x: 110, y: 110 })).toBe(true)
  })
})

describe('expLerp — framerate-independent eased follow (drag motion refinement)', () => {
  const HL = FOLLOW_HALF_LIFE_MS

  it('moves toward the target without overshooting (monotonic approach)', () => {
    const next = expLerp(0, 100, 16, HL)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(100) // never overshoots past the target
  })

  it('crosses exactly halfway after one half-life of elapsed time', () => {
    // After dt === halfLife the remaining gap halves: 0 → 50 toward target 100.
    expect(expLerp(0, 100, HL, HL)).toBeCloseTo(50, 6)
  })

  it('is framerate-independent: one big dt equals many small dts to the same total', () => {
    const target = 480
    const dtBig = 64
    // One 64ms step…
    const big = expLerp(0, target, dtBig, HL)
    // …vs four 16ms steps re-easing toward the SAME (stationary) target.
    let small = 0
    for (let i = 0; i < 4; i++) {
      small = expLerp(small, target, 16, HL)
    }
    expect(small).toBeCloseTo(big, 6)
  })

  it('converges to the target after enough total time (settles, not stalls)', () => {
    let v = 0
    for (let i = 0; i < 200; i++) {
      v = expLerp(v, 300, 16, HL)
    }
    expect(v).toBeCloseTo(300, 3)
  })

  it('halfLife <= 0 snaps instantly to target (reduced-motion / instant path)', () => {
    expect(expLerp(10, 250, 16, 0)).toBe(250)
    expect(expLerp(10, 250, 16, -5)).toBe(250)
  })

  it('dt <= 0 makes no progress (no time elapsed)', () => {
    expect(expLerp(40, 200, 0, HL)).toBe(40)
    expect(expLerp(40, 200, -16, HL)).toBe(40)
  })

  it('never produces NaN/Infinity from malformed inputs', () => {
    expect(expLerp(Number.NaN, 100, 16, HL)).toBe(100) // snap to finite target
    expect(Number.isFinite(expLerp(0, 100, Number.POSITIVE_INFINITY, HL))).toBe(true)
    expect(Number.isFinite(expLerp(0, 100, 16, Number.NaN))).toBe(true)
  })
})

describe('stepFollow / isSettled — 2-D eased follow + termination', () => {
  it('eases both axes toward the target each frame, framerate-independently', () => {
    const target = { x: 400, y: 300 }
    const big = stepFollow({ x: 0, y: 0 }, target, 64, FOLLOW_HALF_LIFE_MS)
    let small = { x: 0, y: 0 }
    for (let i = 0; i < 4; i++) {
      small = stepFollow(small, target, 16, FOLLOW_HALF_LIFE_MS)
    }
    expect(small.x).toBeCloseTo(big.x, 6)
    expect(small.y).toBeCloseTo(big.y, 6)
  })

  it('reports settled only once within the sub-pixel epsilon on BOTH axes', () => {
    expect(isSettled({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true)
    expect(isSettled({ x: 100.05, y: 99.95 }, { x: 100, y: 100 })).toBe(true)
    expect(isSettled({ x: 100, y: 95 }, { x: 100, y: 100 })).toBe(false) // y still off
    expect(isSettled({ x: 90, y: 100 }, { x: 100, y: 100 })).toBe(false) // x still off
  })
})

describe('DEFAULT_OPEN_PROMPT_POSITION — non-secret two-number default (FR-011/FR-010)', () => {
  it('is two finite numbers in [0,1] at center-bottom', () => {
    expect(Object.keys(DEFAULT_OPEN_PROMPT_POSITION).sort()).toEqual(['xFrac', 'yFrac'])
    expect(DEFAULT_OPEN_PROMPT_POSITION.xFrac).toBe(0.5)
    expect(DEFAULT_OPEN_PROMPT_POSITION.yFrac).toBeGreaterThan(0.9)
  })
})
