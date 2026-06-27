import { describe, it, expect } from 'vitest'
import {
  baseName,
  invalidateOpen,
  openRelPath,
  renderError,
  resolveRead,
  selectFile,
  type ViewerState
} from './viewerState'
import type { FsReadResult } from '../../shared/ipc'

/*
 * viewerState — PURE middle-viewer state (terminal-file-explorer-v1, 3-pane rework). No React/DOM
 * (node env). Proves the NEW contract: clicking a file OPENS or RETARGETS the middle viewer column
 * while the tree dock stays visible — there is NO "back to tree" / tree↔viewer toggle. `null` is the
 * calm "no file selected" placeholder, NOT "the tree is showing".
 */

describe('baseName', () => {
  it('returns the basename of a nested path and the name itself at root', () => {
    expect(baseName('a/b/c.ts')).toBe('c.ts')
    expect(baseName('readme.md')).toBe('readme.md')
    expect(baseName('')).toBe('')
  })
})

describe('selectFile', () => {
  it('opens a loading viewer for the clicked file', () => {
    expect(selectFile('src/app.ts')).toEqual({
      kind: 'loading',
      relPath: 'src/app.ts',
      name: 'app.ts'
    })
  })

  it('RETARGETS to another file (open→open is one transition, never via a null/tree state)', () => {
    // The new contract: a second click while a file is open swaps the target directly. There is no
    // intermediate "back to tree" (null) hop — selectFile is total over both first-open and retarget.
    const first = selectFile('a.ts')
    const second = selectFile('b.ts')
    expect(first.relPath).toBe('a.ts')
    expect(second).toEqual({ kind: 'loading', relPath: 'b.ts', name: 'b.ts' })
    // Retargeting never yields the placeholder — the viewer is always pointed at a file after a click.
    expect(second).not.toBeNull()
  })
})

describe('openRelPath', () => {
  it('is null for the placeholder and the relPath for any open viewer', () => {
    expect(openRelPath(null)).toBeNull()
    expect(openRelPath({ kind: 'loading', relPath: 'x.ts', name: 'x.ts' })).toBe('x.ts')
    expect(openRelPath({ kind: 'text', relPath: 'y/z.ts', name: 'z.ts', text: 'hi' })).toBe('y/z.ts')
  })
})

describe('resolveRead', () => {
  it('maps a successful text read to the text state', () => {
    const res: FsReadResult = { ok: true, kind: 'text', text: 'console.log(1)' }
    expect(resolveRead('src/a.ts', res)).toEqual({
      kind: 'text',
      relPath: 'src/a.ts',
      name: 'a.ts',
      text: 'console.log(1)'
    })
  })

  it('maps a successful image read to the image marker state (no bytes)', () => {
    const res: FsReadResult = { ok: true, kind: 'image' }
    expect(resolveRead('pics/logo.png', res)).toEqual({
      kind: 'image',
      relPath: 'pics/logo.png',
      name: 'logo.png'
    })
  })

  it('maps the document markers (pdf / docx / sheet) to their marker states (no bytes)', () => {
    // file-viewer-multiformat-v1 FR-001/002/003: a document read returns a MARKER; the renderer
    // fetches the bytes from `cosmos-file://` (FR-007). No `text`/bytes field on these states.
    expect(resolveRead('report.pdf', { ok: true, kind: 'pdf' })).toEqual({
      kind: 'pdf',
      relPath: 'report.pdf',
      name: 'report.pdf'
    })
    expect(resolveRead('a/spec.docx', { ok: true, kind: 'docx' })).toEqual({
      kind: 'docx',
      relPath: 'a/spec.docx',
      name: 'spec.docx'
    })
    expect(resolveRead('data.xlsx', { ok: true, kind: 'sheet' })).toEqual({
      kind: 'sheet',
      relPath: 'data.xlsx',
      name: 'data.xlsx'
    })
  })

  it('maps benign failures to their calm blocks (binary→unsupported / denied / too-large)', () => {
    // FR-006: a sniffed-binary / no-viewer file → the calm "No preview available" (unsupported).
    expect(resolveRead('a.bin', { ok: false, reason: 'binary' })).toEqual({
      kind: 'unsupported',
      relPath: 'a.bin',
      name: 'a.bin'
    })
    expect(resolveRead('secret', { ok: false, reason: 'denied' })).toEqual({
      kind: 'denied',
      relPath: 'secret',
      name: 'secret'
    })
    // FR-012: a document over its per-format cap → the calm "File too large to preview" block.
    expect(resolveRead('huge.pdf', { ok: false, reason: 'too-large' })).toEqual({
      kind: 'too-large',
      relPath: 'huge.pdf',
      name: 'huge.pdf'
    })
  })

  it('maps not-found and out-of-root to the calm not-found block (FR-017)', () => {
    expect(resolveRead('gone.ts', { ok: false, reason: 'not-found' }).kind).toBe('not-found')
    expect(resolveRead('../escape', { ok: false, reason: 'out-of-root' }).kind).toBe('not-found')
  })
})

describe('renderError', () => {
  it('builds the calm "Couldn\'t open this file" block for a corrupt document (FR-008)', () => {
    expect(renderError('a/corrupt.pdf')).toEqual({
      kind: 'render-error',
      relPath: 'a/corrupt.pdf',
      name: 'corrupt.pdf'
    })
  })
})

describe('invalidateOpen', () => {
  it('flips a vanished open file to the calm not-found block without going back to the tree', () => {
    // A watch re-read that 404s retargets the SAME middle column to not-found — it does not clear the
    // viewer to null (the old "close viewer → show tree" behavior). The tree dock stays visible.
    const invalidated = invalidateOpen('a/b.ts')
    expect(invalidated).toEqual({ kind: 'not-found', relPath: 'a/b.ts', name: 'b.ts' })
    expect(invalidated as ViewerState).not.toBeNull()
  })
})
