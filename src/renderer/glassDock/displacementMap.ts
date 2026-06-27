/*
 * glass-dock liquid-glass displacement map (glass-dock-v2).
 *
 * The OLD glass material refracted the backdrop with a static `feTurbulence` ->
 * `feDisplacementMap` (defined in index.html as `#glass-dock-distortion`). Random
 * fractal noise displaces the ENTIRE backdrop, so the frosted content reads broken /
 * discontinuous ("끊어짐"), wavy ("꼬불꼬불"), and banded — no turbulence tuning fixes
 * that because noise is, by construction, everywhere.
 *
 * The REAL Apple "liquid glass" technique (refs: github.com/archisvaze/liquid-glass,
 * kube.io/blog/liquid-glass-css-svg) instead builds a SMOOTH displacement map whose
 * INTERIOR is NEUTRAL (RGB 128,128 = zero displacement, so the centre reads crisp) and
 * whose refraction is CONCENTRATED IN THE BEZEL — a band along the exposed edges. The
 * glass bends light only at its rim, like a real lens; the interior stays clear. No
 * random noise => no breakup / banding / waviness.
 *
 * This module is the PURE, node-testable geometry: the rounded-rect signed distance, the
 * refraction profile (a smooth ease — NOT noise), and the per-pixel RGBA writer that fills
 * a flat byte buffer. The canvas / data-URL wrapper that needs a DOM lives in
 * `generateDisplacementMap.ts`; everything load-bearing for the LOOK is unit-tested here.
 *
 * Channel encoding (matches the feDisplacementMap consumer):
 *   R = x-displacement, centred at 128 (128 = none, >128 = +x, <128 = -x)
 *   G = y-displacement, centred at 128
 *   B = 0, A = 255 (unused by feDisplacementMap with xChannelSelector=R yChannelSelector=G)
 * The displacement points INWARD from each exposed edge so the bezel bends the backdrop
 * toward the glass centre, the way a convex lens rim does.
 */

/** Neutral (zero-displacement) channel midpoint. */
export const NEUTRAL = 128

/** Which edges of the dock rect are "exposed" interior rims that meet the backdrop and so
 *  should refract. A flush right-edge drawer exposes only its LEFT (and, if not flush to the
 *  panel chrome, top/bottom) edge; its RIGHT edge sits against the window and never refracts.
 *  Refraction on a non-exposed edge would draw a bright box outline that is not a real rim. */
export interface ExposedEdges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

export interface GlassDockGeometry {
  /** Device-pixel width of the dock element. */
  width: number
  /** Device-pixel height of the dock element. */
  height: number
  /** Corner radius in px (0 for a flush, square-cornered drawer). */
  radius: number
  /** Bezel band width in px — how far in from each exposed edge the refraction reaches. */
  bezel: number
  /** Which edges refract. */
  edges: ExposedEdges
}

/**
 * Smooth refraction profile. `t` = normalised depth into the bezel from the OUTER edge:
 *   t = 0 at the very edge (max displacement), t = 1 at the inner bezel boundary (zero).
 * Returns the displacement MAGNITUDE in [0,1]. The curve is a smoothstep-based ease so the
 * ramp is C1-continuous at BOTH ends — it eases out of the crisp interior (no hard seam where
 * the bezel meets the neutral centre) and eases into the rim. This is what makes the glass
 * read smooth and continuous instead of the banded/wavy noise look.
 *
 * Profile shape: strongest right at the rim, decaying to zero at the inner edge. We use
 * `(1 - t)` shaped by smoothstep so the falloff is gentle — like the thickening curve of a
 * real lens bezel, where the surface normal turns fastest near the rim.
 */
export function refractionProfile(t: number): number {
  if (t <= 0) return 1
  if (t >= 1) return 0
  // smoothstep(0,1, 1-t): eased ramp, max at the rim (t→0), 0 at the inner edge (t→1).
  const u = 1 - t
  return u * u * (3 - 2 * u)
}

/**
 * Signed inward distance from the nearest EXPOSED edge for a pixel, honouring the corner
 * radius. Returns the distance INTO the rect from whichever exposed edge (or rounded corner
 * between two exposed edges) is nearest, plus the unit inward direction at that point.
 *
 * For a straight exposed edge the inward direction is the edge normal (e.g. left edge → +x).
 * For a rounded corner where BOTH adjoining edges are exposed, the direction is radial from
 * the corner's arc centre, so the refraction sweeps smoothly around the curve (a true rounded
 * rim) instead of two straight bands crossing. A corner where only ONE side is exposed degrades
 * to that side's straight edge.
 *
 * Returns null when the pixel is outside any exposed bezel band (=> neutral interior).
 */
export function bezelVectorAt(
  x: number,
  y: number,
  geom: GlassDockGeometry
): { depth: number; nx: number; ny: number } | null {
  const { width: w, height: h, radius, bezel, edges } = geom
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(w, h) / 2)))

  // Distance from each edge (0 at the edge, growing inward).
  const distLeft = x
  const distRight = w - 1 - x
  const distTop = y
  const distBottom = h - 1 - y

  // --- Rounded corners (only when BOTH adjoining edges are exposed). Inside the r×r corner
  //     box the rim is the arc; refraction is radial from the arc centre. ---
  const inLeft = edges.left && distLeft < r
  const inRight = edges.right && distRight < r
  const inTop = edges.top && distTop < r
  const inBottom = edges.bottom && distBottom < r

  const corners: Array<{
    on: boolean
    cx: number
    cy: number
  }> = [
    { on: inLeft && inTop, cx: r, cy: r },
    { on: inRight && inTop, cx: w - 1 - r, cy: r },
    { on: inLeft && inBottom, cx: r, cy: h - 1 - r },
    { on: inRight && inBottom, cx: w - 1 - r, cy: h - 1 - r }
  ]
  for (const c of corners) {
    if (!c.on) continue
    const vx = x - c.cx
    const vy = y - c.cy
    const dist = Math.hypot(vx, vy)
    // Inside the arc disk only; depth measured inward from the arc (the rim) toward the centre.
    if (dist > r) {
      // Outside the rounded corner entirely (the clipped-off square nub) — no refraction.
      return null
    }
    const depth = r - dist // 0 at the rim, r at the arc centre.
    if (depth >= bezel) return null // past the bezel band → neutral interior.
    if (dist === 0) return { depth, nx: 0, ny: 0 }
    // Inward normal points from the rim toward the centre = toward the arc centre = -v̂.
    return { depth, nx: -vx / dist, ny: -vy / dist }
  }

  // --- Straight edges: nearest exposed edge wins; inward normal is that edge's normal. ---
  let best: { depth: number; nx: number; ny: number } | null = null
  const consider = (depth: number, nx: number, ny: number): void => {
    if (depth < 0 || depth >= bezel) return
    if (best === null || depth < best.depth) best = { depth, nx, ny }
  }
  if (edges.left) consider(distLeft, 1, 0)
  if (edges.right) consider(distRight, -1, 0)
  if (edges.top) consider(distTop, 0, 1)
  if (edges.bottom) consider(distBottom, 0, -1)
  return best
}

/**
 * Per-pixel displacement for the map, in [-1,1] per axis (before the 127 scale + 128 bias).
 * Positive dx pushes the sampled backdrop in +x, etc. The magnitude follows
 * `refractionProfile`, the direction is the bezel's inward normal — so the rim bends the
 * backdrop inward and the interior is exactly zero.
 */
export function displacementAt(
  x: number,
  y: number,
  geom: GlassDockGeometry
): { dx: number; dy: number } {
  const v = bezelVectorAt(x, y, geom)
  if (v === null) return { dx: 0, dy: 0 }
  const t = v.depth / geom.bezel // 0 at rim, 1 at inner bezel edge.
  const mag = refractionProfile(t)
  return { dx: v.nx * mag, dy: v.ny * mag }
}

/**
 * Encode a [-1,1] displacement to a 0..255 channel byte centred on NEUTRAL (128). Clamped so
 * an out-of-range magnitude can never wrap. Pure + node-testable.
 */
export function encodeChannel(value: number): number {
  const v = NEUTRAL + value * 127
  if (v <= 0) return 0
  if (v >= 255) return 255
  return (v + 0.5) | 0
}

/**
 * Fill a flat RGBA byte buffer (ImageData.data layout) with the displacement map for `geom`.
 * Pure: takes the buffer, no canvas/DOM — this is the unit-tested core that decides the LOOK.
 * `buf` MUST be length `geom.width * geom.height * 4`.
 */
export function writeDisplacementMap(
  buf: Uint8ClampedArray | Uint8Array,
  geom: GlassDockGeometry
): void {
  const { width: w, height: h } = geom
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { dx, dy } = displacementAt(x, y, geom)
      const i = (y * w + x) * 4
      buf[i] = encodeChannel(dx)
      buf[i + 1] = encodeChannel(dy)
      buf[i + 2] = 0
      buf[i + 3] = 255
    }
  }
}
