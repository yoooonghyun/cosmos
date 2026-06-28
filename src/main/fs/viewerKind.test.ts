import { describe, it, expect } from 'vitest'
import { resolveViewerKind, isDocumentExtension, type ViewerKind } from './viewerKind'

/*
 * viewerKind — PURE viewer-registry routing (file-viewer-multiformat-v1, FR-005/FR-011/FR-016).
 * Node env, no DOM. Covers SC-004: the extension→viewer decision is deterministic and single-
 * sourced. Happy path (each registered format), the image/text passthrough (FR-004), the
 * sniff fallback for extension-less files, and the unsupported fallback for binary / legacy /
 * unknown (FR-006/FR-016).
 */

describe('resolveViewerKind — registered document formats (FR-001/FR-002/FR-003)', () => {
  const cases: [string, ViewerKind][] = [
    ['report.pdf', 'pdf'],
    ['spec.docx', 'docx'],
    ['data.xlsx', 'sheet'],
    ['legacy.xls', 'sheet']
  ]
  for (const [name, kind] of cases) {
    it(`routes ${name} → ${kind} regardless of the sniff`, () => {
      // The document extension wins over the byte sniff (these parse-into-memory formats sniff
      // as binary, but must still route to their renderer, not the unsupported block).
      expect(resolveViewerKind(name, false)).toBe(kind)
      expect(resolveViewerKind(name, true)).toBe(kind)
    })
    it(`matches ${name} case-insensitively`, () => {
      expect(resolveViewerKind(name.toUpperCase(), false)).toBe(kind)
    })
  }
})

describe('resolveViewerKind — images keep the existing path (FR-004)', () => {
  it('routes every supported image extension to image regardless of sniff', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']) {
      expect(resolveViewerKind(`pic.${ext}`, false)).toBe('image')
      expect(resolveViewerKind(`pic.${ext.toUpperCase()}`, true)).toBe('image')
    }
  })
})

describe('resolveViewerKind — text vs unsupported via the sniff fallback (FR-005/FR-006)', () => {
  it('routes a non-registered extension that sniffs as text → text (Monaco)', () => {
    expect(resolveViewerKind('main.ts', true)).toBe('text')
    expect(resolveViewerKind('notes.md', true)).toBe('text') // CSV/MD stay text in v1 (FR-015)
    expect(resolveViewerKind('rows.csv', true)).toBe('text')
  })
  it('routes a non-registered extension that sniffs as binary → unsupported (FR-006)', () => {
    expect(resolveViewerKind('blob.bin', false)).toBe('unsupported')
    expect(resolveViewerKind('archive.zip', false)).toBe('unsupported')
  })
  it('routes an extension-less file by its sniff (text → text, binary → unsupported)', () => {
    expect(resolveViewerKind('Makefile', true)).toBe('text')
    expect(resolveViewerKind('Makefile', false)).toBe('unsupported')
  })
})

describe('resolveViewerKind — legacy/binary office formats fall through (FR-016)', () => {
  it('routes legacy .doc / .ppt / .pptx with no v1 renderer to unsupported', () => {
    // None are registered; the binary sniff sends them to the calm "No preview available" block.
    expect(resolveViewerKind('old.doc', false)).toBe('unsupported')
    expect(resolveViewerKind('deck.ppt', false)).toBe('unsupported')
    expect(resolveViewerKind('deck.pptx', false)).toBe('unsupported')
  })
})

describe('resolveViewerKind — safe fallback for invalid/missing input', () => {
  it('defaults sniffText to false (unknown extension-less → unsupported, not text)', () => {
    expect(resolveViewerKind('mystery')).toBe('unsupported')
  })
  it('treats a non-string name as unsupported (no extension, no sniff)', () => {
    expect(resolveViewerKind(undefined as unknown as string)).toBe('unsupported')
    expect(resolveViewerKind(null as unknown as string, true)).toBe('text') // no ext → sniff wins
  })
})

describe('isDocumentExtension', () => {
  it('is true only for the registered document extensions', () => {
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx', 'a.xls']) {
      expect(isDocumentExtension(name)).toBe(true)
    }
  })
  it('is false for images, text, and legacy/unknown formats', () => {
    for (const name of ['a.png', 'a.ts', 'a.md', 'a.doc', 'a.zip', 'Makefile']) {
      expect(isDocumentExtension(name)).toBe(false)
    }
  })
})
