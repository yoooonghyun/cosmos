import { describe, it, expect } from 'vitest'
import {
  nextImageLoadStatus,
  reservedImageBox,
  FALLBACK_ASPECT_RATIO,
  type ImageLoadStatus
} from './imageLoadState'

describe('nextImageLoadStatus (slack-image-skeleton-placeholder-v1, FR-009)', () => {
  it('advances loading → loaded on a load event', () => {
    expect(nextImageLoadStatus('loading', 'load')).toBe('loaded')
  })

  it('advances loading → error on an error event', () => {
    expect(nextImageLoadStatus('loading', 'error')).toBe('error')
  })

  it('treats loaded as terminal/idempotent (a cached image may re-fire onLoad)', () => {
    expect(nextImageLoadStatus('loaded', 'load')).toBe('loaded')
    // Never regresses or flips to error once loaded.
    expect(nextImageLoadStatus('loaded', 'error')).toBe('loaded')
  })

  it('treats error as terminal/idempotent', () => {
    expect(nextImageLoadStatus('error', 'error')).toBe('error')
    expect(nextImageLoadStatus('error', 'load')).toBe('error')
  })

  it('never produces a status outside the three legal values', () => {
    const all: ImageLoadStatus[] = ['loading', 'loaded', 'error']
    for (const s of all) {
      for (const e of ['load', 'error'] as const) {
        expect(all).toContain(nextImageLoadStatus(s, e))
      }
    }
  })
})

describe('reservedImageBox (slack-image-skeleton-placeholder-v1, FR-004/FR-005)', () => {
  it('uses the real aspect ratio for known landscape dims', () => {
    expect(reservedImageBox({ w: 300, h: 200 })).toEqual({ aspectRatio: 1.5, known: true })
  })

  it('uses the real aspect ratio for known portrait dims', () => {
    expect(reservedImageBox({ w: 200, h: 400 })).toEqual({ aspectRatio: 0.5, known: true })
  })

  it('falls back to the fixed box when dims are absent', () => {
    expect(reservedImageBox({})).toEqual({ aspectRatio: FALLBACK_ASPECT_RATIO, known: false })
    expect(reservedImageBox({ w: 300 })).toEqual({
      aspectRatio: FALLBACK_ASPECT_RATIO,
      known: false
    })
    expect(reservedImageBox({ h: 200 })).toEqual({
      aspectRatio: FALLBACK_ASPECT_RATIO,
      known: false
    })
  })

  it('falls back to the fixed box for invalid dims (zero, negative, NaN, infinite)', () => {
    const fallback = { aspectRatio: FALLBACK_ASPECT_RATIO, known: false }
    expect(reservedImageBox({ w: 0, h: 200 })).toEqual(fallback)
    expect(reservedImageBox({ w: 300, h: 0 })).toEqual(fallback)
    expect(reservedImageBox({ w: -300, h: 200 })).toEqual(fallback)
    expect(reservedImageBox({ w: 300, h: -200 })).toEqual(fallback)
    expect(reservedImageBox({ w: NaN, h: 200 })).toEqual(fallback)
    expect(reservedImageBox({ w: 300, h: NaN })).toEqual(fallback)
    expect(reservedImageBox({ w: Infinity, h: 200 })).toEqual(fallback)
  })
})
