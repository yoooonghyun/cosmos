import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OPEN_PROMPT_POSITION,
  DRAG_THRESHOLD_PX,
  OPEN_PROMPT_BUTTON_SIZE_PX,
  FOLLOW_HALF_LIFE_MS,
  clampFraction,
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
