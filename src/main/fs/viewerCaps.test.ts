import { describe, it, expect } from 'vitest'
import { capForViewerKind, isTooLarge } from './viewerCaps'

/*
 * viewerCaps — PURE per-format size caps (file-viewer-multiformat-v1, FR-012, SC-006). Only the
 * parse-into-memory document kinds (pdf/docx/sheet) are capped; text/image/unsupported are not.
 */

describe('capForViewerKind', () => {
  it('returns the per-format cap for capped document kinds', () => {
    expect(capForViewerKind('pdf')).toBe(50 * 1024 * 1024)
    expect(capForViewerKind('docx')).toBe(25 * 1024 * 1024)
    expect(capForViewerKind('sheet')).toBe(15 * 1024 * 1024)
  })
  it('returns null (uncapped) for text / image / unsupported', () => {
    expect(capForViewerKind('text')).toBeNull()
    expect(capForViewerKind('image')).toBeNull()
    expect(capForViewerKind('unsupported')).toBeNull()
  })
})

describe('isTooLarge', () => {
  it('is true only when a capped kind exceeds its cap', () => {
    expect(isTooLarge('pdf', 50 * 1024 * 1024 + 1)).toBe(true)
    expect(isTooLarge('pdf', 50 * 1024 * 1024)).toBe(false) // exactly at cap = ok
    expect(isTooLarge('docx', 26 * 1024 * 1024)).toBe(true)
    expect(isTooLarge('sheet', 1024)).toBe(false)
  })
  it('never refuses an uncapped kind (text/image) for size', () => {
    expect(isTooLarge('text', 500 * 1024 * 1024)).toBe(false)
    expect(isTooLarge('image', 500 * 1024 * 1024)).toBe(false)
  })
  it('treats an unmeasurable size as NOT too large (read proceeds, fails benignly downstream)', () => {
    expect(isTooLarge('pdf', Number.NaN)).toBe(false)
    expect(isTooLarge('pdf', -1)).toBe(false)
    expect(isTooLarge('pdf', Infinity)).toBe(false)
  })
})
