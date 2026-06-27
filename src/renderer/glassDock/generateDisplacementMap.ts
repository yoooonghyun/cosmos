/*
 * glass-dock displacement-map canvas → data-URL wrapper (glass-dock-v2).
 *
 * The pure geometry/profile + per-pixel writer live in `displacementMap.ts` (node-testable).
 * This thin layer is the ONLY part that needs a DOM: it allocates an offscreen <canvas>, runs
 * the pure `writeDisplacementMap` into its ImageData, and returns a PNG data-URL the SVG
 * `<feImage href>` consumes. Gated off the pure module on purpose so the look stays unit-tested
 * and only the unavoidable canvas call is DOM-bound.
 *
 * The map MUST be sized to the dock element. feImage does not scale to the filter region — a
 * mis-sized map tiles or clips, which is part of why the old static filter looked broken. The
 * hook re-generates this on every (debounced) resize so the map always matches the element.
 */
import { writeDisplacementMap, type GlassDockGeometry } from './displacementMap'

/**
 * Build the displacement-map PNG data-URL for `geom`. Returns null when no canvas is available
 * (e.g. a non-DOM/SSR/test context) or the size is degenerate — callers fall back to a plain
 * blur, never crash.
 */
export function generateDisplacementMapDataUrl(geom: GlassDockGeometry): string | null {
  const w = Math.max(1, Math.round(geom.width))
  const h = Math.max(1, Math.round(geom.height))
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const img = ctx.createImageData(w, h)
  writeDisplacementMap(img.data, { ...geom, width: w, height: h })
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}
