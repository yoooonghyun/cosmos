/*
 * glass-dock displacement-map geometry tests (glass-dock-v2).
 *
 * Covers the LOOK-bearing core: the neutral interior (crisp centre), the bezel-only refraction
 * (rim bends inward), the smooth profile (no banding/noise — monotone ease), per-edge exposure
 * (a flush right drawer refracts only its LEFT rim), and the channel encoding. The canvas/data-URL
 * wrapper needs a DOM and is exercised at runtime, not here.
 */
import { describe, it, expect } from 'vitest'
import {
  NEUTRAL,
  refractionProfile,
  bezelVectorAt,
  displacementAt,
  encodeChannel,
  writeDisplacementMap,
  type GlassDockGeometry,
  type ExposedEdges
} from './displacementMap'

const LEFT_ONLY: ExposedEdges = { left: true, right: false, top: false, bottom: false }
const ALL: ExposedEdges = { left: true, right: true, top: true, bottom: true }

function geom(over: Partial<GlassDockGeometry> = {}): GlassDockGeometry {
  return { width: 200, height: 400, radius: 0, bezel: 22, edges: LEFT_ONLY, ...over }
}

describe('refractionProfile', () => {
  it('is max (1) at the rim and 0 at the inner bezel edge', () => {
    expect(refractionProfile(0)).toBe(1)
    expect(refractionProfile(1)).toBe(0)
  })

  it('clamps out-of-range inputs', () => {
    expect(refractionProfile(-0.5)).toBe(1)
    expect(refractionProfile(2)).toBe(0)
  })

  it('decreases monotonically from rim to interior (smooth, no noise bumps)', () => {
    let prev = Infinity
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = refractionProfile(t)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
  })

  it('eases (smoothstep) — symmetric, flat near both ends, 0.5 at the midpoint', () => {
    // smoothstep(1-t) is point-symmetric about t=0.5 → value 0.5 there.
    expect(refractionProfile(0.5)).toBeCloseTo(0.5)
    // Near the rim (small t) it stays HIGH (strongest refraction): t=0.25 → 0.84375 > linear 0.75.
    expect(refractionProfile(0.25)).toBeGreaterThan(0.75)
    // Near the interior (large t) it stays LOW: t=0.75 → 0.15625 < linear 0.25.
    expect(refractionProfile(0.75)).toBeLessThan(0.25)
    // Symmetry: f(t) + f(1-t) == 1.
    expect(refractionProfile(0.25) + refractionProfile(0.75)).toBeCloseTo(1)
  })
})

describe('bezelVectorAt — neutral interior', () => {
  it('returns null deep in the interior (zero displacement => crisp centre)', () => {
    expect(bezelVectorAt(100, 200, geom())).toBeNull()
  })

  it('returns null just past the bezel band from the exposed edge', () => {
    expect(bezelVectorAt(22, 200, geom())).toBeNull() // depth == bezel → inner edge, neutral
    expect(bezelVectorAt(50, 200, geom())).toBeNull()
  })
})

describe('bezelVectorAt — exposed-edge gating', () => {
  it('refracts INSIDE the left bezel for a left-only (right-drawer) dock', () => {
    const v = bezelVectorAt(2, 200, geom())
    expect(v).not.toBeNull()
    // Inward normal of the left edge points +x.
    expect(v!.nx).toBeCloseTo(1)
    expect(v!.ny).toBeCloseTo(0)
  })

  it('does NOT refract the right/top/bottom edges of a left-only dock', () => {
    const g = geom()
    expect(bezelVectorAt(g.width - 2, 200, g)).toBeNull() // right
    expect(bezelVectorAt(100, 2, g)).toBeNull() // top
    expect(bezelVectorAt(100, g.height - 2, g)).toBeNull() // bottom
  })

  it('refracts all four edges when all are exposed', () => {
    const g = geom({ edges: ALL })
    expect(bezelVectorAt(2, 200, g)).not.toBeNull() // left
    expect(bezelVectorAt(g.width - 2, 200, g)).not.toBeNull() // right
    expect(bezelVectorAt(100, 2, g)).not.toBeNull() // top
    expect(bezelVectorAt(100, g.height - 2, g)).not.toBeNull() // bottom
  })

  it('depth grows from 0 at the edge inward', () => {
    const g = geom()
    expect(bezelVectorAt(0, 200, g)!.depth).toBe(0)
    expect(bezelVectorAt(5, 200, g)!.depth).toBe(5)
  })
})

describe('bezelVectorAt — rounded corners (both edges exposed)', () => {
  it('uses a radial inward normal inside a rounded corner', () => {
    // 40px radius; top-left corner arc centre at (40,40). A pixel near the rim along the
    // diagonal should have an inward normal pointing toward the centre (both +x and +y).
    const g = geom({ radius: 40, edges: ALL })
    const v = bezelVectorAt(15, 15, g)
    expect(v).not.toBeNull()
    expect(v!.nx).toBeGreaterThan(0)
    expect(v!.ny).toBeGreaterThan(0)
    // Unit length.
    expect(Math.hypot(v!.nx, v!.ny)).toBeCloseTo(1)
  })

  it('returns null in the clipped-off corner nub (outside the arc)', () => {
    const g = geom({ radius: 40, edges: ALL })
    // (1,1) is in the square nub outside the quarter-circle of radius 40 centred at (40,40):
    // dist = hypot(39,39) ≈ 55 > 40 → outside the rounded rect.
    expect(bezelVectorAt(1, 1, g)).toBeNull()
  })
})

describe('bezelVectorAt — Open Prompt rounded surfaces (all edges, bezel ≳ radius)', () => {
  // The Open Prompt card (≈ rounded-lg) refracts on ALL FOUR rounded edges with a NARROW bezel
  // and a small radius. Here bezel (10) ≳ radius (8): inside a corner arc the max depth is r=8 <
  // bezel=10, so the WHOLE corner refracts and never reaches the past-bezel neutral cutoff — the
  // rim must sweep the full rounded corner without a dead spot, while a neutral interior remains.
  const cardGeom = (): GlassDockGeometry =>
    geom({ width: 320, height: 120, radius: 8, bezel: 10, edges: ALL })

  it('keeps a neutral (crisp) interior away from every rim', () => {
    expect(bezelVectorAt(160, 60, cardGeom())).toBeNull()
  })

  it('refracts all four straight edges inward', () => {
    const g = cardGeom()
    expect(bezelVectorAt(1, 60, g)!.nx).toBeCloseTo(1) // left → +x
    expect(bezelVectorAt(g.width - 2, 60, g)!.nx).toBeCloseTo(-1) // right → -x
    expect(bezelVectorAt(160, 1, g)!.ny).toBeCloseTo(1) // top → +y
    expect(bezelVectorAt(160, g.height - 2, g)!.ny).toBeCloseTo(-1) // bottom → -y
  })

  it('refracts radially through a rounded corner even when bezel exceeds radius', () => {
    const g = cardGeom()
    // Just inside the top-left arc (centre (8,8)): inward normal points toward centre (+x,+y),
    // unit length, and it is NOT culled by the past-bezel cutoff (depth ≤ r=8 < bezel=10).
    const v = bezelVectorAt(3, 3, g)
    expect(v).not.toBeNull()
    expect(v!.nx).toBeGreaterThan(0)
    expect(v!.ny).toBeGreaterThan(0)
    expect(Math.hypot(v!.nx, v!.ny)).toBeCloseTo(1)
  })

  it('handles a tiny round pebble (logo): radius = half size, neutral centre survives', () => {
    // The collapsed logo path the card-config would produce for a 48px circle (radius 24): every
    // pixel is "corner", but the deep centre (depth = r = 24 > bezel) stays neutral so the glyph
    // sits on a crisp centre, and the rim still refracts.
    const pebble = geom({ width: 48, height: 48, radius: 24, bezel: 10, edges: ALL })
    expect(bezelVectorAt(24, 24, pebble)).toBeNull() // crisp centre
    const rim = bezelVectorAt(24, 1, pebble) // near the top rim
    expect(rim).not.toBeNull()
    expect(rim!.ny).toBeGreaterThan(0) // bends inward (+y, toward centre)
  })
})

describe('displacementAt', () => {
  it('is exactly zero in the interior', () => {
    expect(displacementAt(100, 200, geom())).toEqual({ dx: 0, dy: 0 })
  })

  it('points inward (+x) and is strongest at the very rim for a left drawer', () => {
    const atRim = displacementAt(0, 200, geom())
    const midBezel = displacementAt(11, 200, geom())
    expect(atRim.dx).toBeGreaterThan(0)
    expect(atRim.dx).toBeGreaterThan(midBezel.dx) // stronger at the rim than mid-bezel
    expect(atRim.dy).toBeCloseTo(0)
  })
})

describe('encodeChannel', () => {
  it('maps zero displacement to the neutral midpoint', () => {
    expect(encodeChannel(0)).toBe(NEUTRAL)
  })

  it('maps +1 / -1 to the channel extremes and clamps beyond', () => {
    expect(encodeChannel(1)).toBe(255)
    expect(encodeChannel(-1)).toBe(NEUTRAL - 127)
    expect(encodeChannel(5)).toBe(255)
    expect(encodeChannel(-5)).toBe(0)
  })
})

describe('writeDisplacementMap', () => {
  it('fills the whole buffer with neutral interior + opaque alpha, B=0', () => {
    const g = geom({ width: 60, height: 80 })
    const buf = new Uint8ClampedArray(g.width * g.height * 4)
    writeDisplacementMap(buf, g)

    // A deep-interior pixel is neutral (128,128,0,255) — the crisp centre.
    const cx = 30
    const cy = 40
    const i = (cy * g.width + cx) * 4
    expect(buf[i]).toBe(NEUTRAL)
    expect(buf[i + 1]).toBe(NEUTRAL)
    expect(buf[i + 2]).toBe(0)
    expect(buf[i + 3]).toBe(255)

    // Every pixel: B=0, A=255 (encoding invariant).
    for (let p = 0; p < buf.length; p += 4) {
      expect(buf[p + 2]).toBe(0)
      expect(buf[p + 3]).toBe(255)
    }
  })

  it('writes a non-neutral R at the left rim (the refraction is present)', () => {
    const g = geom({ width: 60, height: 80 })
    const buf = new Uint8ClampedArray(g.width * g.height * 4)
    writeDisplacementMap(buf, g)
    const rimIdx = (40 * g.width + 0) * 4
    expect(buf[rimIdx]).toBeGreaterThan(NEUTRAL) // +x displacement at the left rim
    expect(buf[rimIdx + 1]).toBe(NEUTRAL) // no y displacement on a vertical edge
  })
})
