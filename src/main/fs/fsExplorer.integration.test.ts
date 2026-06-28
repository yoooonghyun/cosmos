/**
 * Integration tests for the fs IPC read handlers (fs:list + fs:read) via createFsExplorer
 * wired against a REAL temp dir on disk (real ExplorerFs backed by node:fs).
 *
 * This is the integration layer missing from the pure-unit fsExplorer.test.ts: instead of a
 * fake ExplorerFs, we plug in a real one that calls realpathSync/readdirSync/readFileSync so
 * the confinement guard runs against actual on-disk paths + symlinks.
 *
 * Covers:
 *   - fs:list happy path: in-root directory → sorted entries, no absolute paths
 *   - fs:list confinement: out-of-root (traversal) → refused
 *   - fs:list no live root: pane unknown → out-of-root
 *   - fs:read text file: returns {ok:true, kind:'text', text}
 *   - fs:read image file: returns {ok:true, kind:'image'} marker (no bytes on IPC)
 *   - fs:read pdf marker: returns {ok:true, kind:'pdf'} (bytes never ride IPC)
 *   - fs:read missing file: not-found
 *   - fs:read out-of-root: refused
 *   - fs:read symlink escape: refused (not-2xx equivalent: ok:false)
 *   - Malformed FsPathPayload (missing paneId): out-of-root (no live root)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFsExplorer, type ExplorerFs, type FsWatcher } from './fsExplorer'
import type { FsPathPayload } from '../../shared/ipc'

let tmpRoot: string
let outsideDir: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'cosmos-fs-integ-'))
  outsideDir = mkdtempSync(join(tmpdir(), 'cosmos-fs-outside-'))

  // In-root fixtures
  writeFileSync(join(tmpRoot, 'readme.txt'), 'hello readme')
  writeFileSync(join(tmpRoot, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))
  writeFileSync(join(tmpRoot, 'report.pdf'), Buffer.from('%PDF-1.4'))
  writeFileSync(join(tmpRoot, 'data.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
  // Document fixtures for fs.readBytes (their bytes ride IPC, not the cosmos-file scheme).
  writeFileSync(join(tmpRoot, 'doc.docx'), Buffer.from('docx-fixture-bytes'))
  writeFileSync(join(tmpRoot, 'sheet.xlsx'), Buffer.from('xlsx-fixture-bytes'))
  mkdirSync(join(tmpRoot, 'subdir'))
  writeFileSync(join(tmpRoot, 'subdir', 'child.txt'), 'child content')

  // Symlink pointing outside the root
  writeFileSync(join(outsideDir, 'secret.txt'), 'secret data')
  symlinkSync(join(outsideDir, 'secret.txt'), join(tmpRoot, 'escape.txt'))
})

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* ignore */ }
  try { rmSync(outsideDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

const PANE_ID = 'pane-integ-001'

/** Real ExplorerFs backed by node:fs — matches what index.ts wires in production. */
function makeRealFs(): ExplorerFs {
  return {
    realpath(p: string): string | null {
      try { return realpathSync(p) } catch { return null }
    },
    readDir(absDir: string) {
      try {
        const entries = readdirSync(absDir, { withFileTypes: true })
        return entries.map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
          isSymlink: e.isSymbolicLink()
        }))
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        return { error: code === 'ENOENT' ? 'not-found' : 'denied' }
      }
    },
    readFileBytes(absFile: string) {
      try {
        // Copy out of Node's shared read pool — a re-wrapped VIEW (buf.buffer/byteOffset)
        // aliases bytes a later read in the same tick can overwrite. Production returns the
        // Buffer directly and Electron IPC structured-clones it (a copy) immediately; the
        // copy here gives the in-process test the same safe, standalone bytes.
        return Uint8Array.from(readFileSync(absFile))
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code
        return { error: code === 'ENOENT' ? 'not-found' : 'denied' }
      }
    },
    statSize(absFile: string): number | null {
      try { return statSync(absFile).size } catch { return null }
    },
    watch(_absRoot: string, _onEvent: () => void): FsWatcher | null {
      // Watch not exercised in these integration tests
      return { close: () => {} }
    }
  }
}

function makeExplorer(rootOverride?: string) {
  const roots = new Map<string, string>()
  if (rootOverride !== undefined) {
    roots.set(PANE_ID, rootOverride)
  }
  const changed: string[] = []
  const explorer = createFsExplorer({
    getRoot: (paneId) => roots.get(paneId),
    onChanged: (paneId) => changed.push(paneId),
    fs: makeRealFs()
  })
  return { explorer, changed }
}

// ---------------------------------------------------------------------------
// fs:list integration tests
// ---------------------------------------------------------------------------

describe('fs:list integration — happy path', () => {
  it('lists the root directory and returns sorted entries with no absolute paths', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.list(PANE_ID, '')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Entries should exist and carry only names (no absolute paths)
    expect(result.entries.length).toBeGreaterThan(0)
    for (const entry of result.entries) {
      expect(entry.name).not.toContain('/')
      expect(entry.name).not.toContain(tmpRoot)
    }
    // Dirs come before files
    const kinds = result.entries.map((e) => e.kind)
    const firstFile = kinds.indexOf('file')
    const lastDir = kinds.lastIndexOf('dir')
    if (firstFile !== -1 && lastDir !== -1) {
      expect(lastDir).toBeLessThan(firstFile)
    }
  })

  it('lists a subdirectory', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.list(PANE_ID, 'subdir')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.some((e) => e.name === 'child.txt')).toBe(true)
  })
})

describe('fs:list integration — confinement', () => {
  it('refuses traversal out of root via ".." in relPath', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.list(PANE_ID, '../')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('refuses an absolute relPath (escape attempt)', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.list(PANE_ID, '/etc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })
})

describe('fs:list integration — no live root', () => {
  it('returns out-of-root when pane has no registered root', () => {
    const { explorer } = makeExplorer(undefined) // no root for PANE_ID
    const result = explorer.list(PANE_ID, '')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('returns out-of-root when payload paneId is unknown', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const payload: FsPathPayload = { paneId: 'unknown-pane-xyz', relPath: '' }
    const result = explorer.list(payload.paneId, payload.relPath)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })
})

// ---------------------------------------------------------------------------
// fs:read integration tests
// ---------------------------------------------------------------------------

describe('fs:read integration — text file', () => {
  it('returns {ok:true, kind:"text", text} for a .txt file', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'readme.txt')
    expect(result).toEqual({ ok: true, kind: 'text', text: 'hello readme' })
  })

  it('returns {ok:true, kind:"text"} for a .txt in a subdirectory', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'subdir/child.txt')
    expect(result).toEqual({ ok: true, kind: 'text', text: 'child content' })
  })
})

describe('fs:read integration — image marker (no bytes on IPC)', () => {
  it('returns {ok:true, kind:"image"} marker for a .png file — bytes never ride IPC', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'photo.png')
    expect(result).toEqual({ ok: true, kind: 'image' })
    // Critically: no `text` or byte property present
    expect('text' in result).toBe(false)
  })
})

describe('fs:read integration — document marker (no bytes on IPC)', () => {
  it('returns {ok:true, kind:"pdf"} marker for a .pdf file', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'report.pdf')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('pdf')
    expect('text' in result).toBe(false)
  })
})

describe('fs:read integration — binary (not previewable)', () => {
  it('returns {ok:false, reason:"binary"} for a binary file with no registered viewer', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'data.bin')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('binary')
  })
})

describe('fs:read integration — missing file', () => {
  it('returns not-found for a file that does not exist in root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, 'nonexistent.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not-found')
  })
})

describe('fs:read integration — confinement', () => {
  it('refuses ".." traversal out of root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.read(PANE_ID, '../outside.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('refuses a symlink inside root that points outside the root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    // escape.txt is a symlink pointing to outsideDir/secret.txt
    const result = explorer.read(PANE_ID, 'escape.txt')
    // confine real-paths the symlink target to outsideDir which is outside tmpRoot
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('returns out-of-root for unknown pane (no live root)', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const payload: FsPathPayload = { paneId: 'ghost-pane', relPath: 'readme.txt' }
    const result = explorer.read(payload.paneId, payload.relPath)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })
})

describe('fs:read integration — malformed FsPathPayload boundary', () => {
  it('returns out-of-root when paneId is empty string (no live root)', () => {
    const { explorer } = makeExplorer(tmpRoot)
    // Simulate a malformed IPC payload that slips past the validator with empty paneId
    const result = explorer.read('', 'readme.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })
})

// ---------------------------------------------------------------------------
// fs:readBytes integration tests (file-viewer-multiformat-v1 FR-007/FR-012)
//
// This is the byte-consuming path that the pdf/docx/sheet renderers depend on. It REPLACES the
// blocked `cosmos-file://` fetch: the bytes now ride this validated, root-confined, size-capped
// IPC. The integration layer (real ExplorerFs over a temp dir) proves the confinement + cap run
// against actual on-disk paths/symlinks — a node-unit test against a fake fs is NOT sufficient.
// ---------------------------------------------------------------------------

/** A real fs whose `statSize` reports a forged size for one named file (to exercise the per-format
 * cap without writing a 50 MB fixture). Everything else delegates to the real `node:fs`. */
function makeOversizeFs(oversizeFile: string, fakeSize: number): ExplorerFs {
  const real = makeRealFs()
  return {
    ...real,
    statSize(absFile: string): number | null {
      if (absFile.endsWith(oversizeFile)) {
        return fakeSize
      }
      return real.statSize(absFile)
    }
  }
}

describe('fs:readBytes integration — returns bytes for in-root documents', () => {
  it('returns {ok:true, bytes} with the real file bytes for an in-root pdf', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, 'report.pdf')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(result.bytes)).toBe('%PDF-1.4')
  })

  it('returns bytes for an in-root docx', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, 'doc.docx')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.bytes)).toBe('docx-fixture-bytes')
  })

  it('returns bytes for an in-root xlsx', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, 'sheet.xlsx')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.bytes)).toBe('xlsx-fixture-bytes')
  })
})

describe('fs:readBytes integration — confinement (refuses out-of-root/forged/missing)', () => {
  it('refuses ".." traversal out of root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, '../report.pdf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('refuses an absolute relPath (escape attempt)', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, '/etc/passwd')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('refuses a symlink inside root that points outside the root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    // escape.txt symlinks to outsideDir/secret.txt — confine real-paths it and refuses.
    const result = explorer.readBytes(PANE_ID, 'escape.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('returns out-of-root for an unknown pane (no live root)', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const payload: FsPathPayload = { paneId: 'ghost-pane', relPath: 'report.pdf' }
    const result = explorer.readBytes(payload.paneId, payload.relPath)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('out-of-root')
  })

  it('returns not-found for a document that does not exist in root', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const result = explorer.readBytes(PANE_ID, 'missing.pdf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not-found')
  })
})

describe('fs:readBytes integration — enforces the per-format size cap (FR-012)', () => {
  it('refuses a pdf over its 50 MB cap with too-large (bytes never read)', () => {
    const roots = new Map<string, string>()
    roots.set(PANE_ID, tmpRoot)
    const explorer = createFsExplorer({
      getRoot: (paneId) => roots.get(paneId),
      onChanged: () => {},
      // report.pdf as 51 MB — over the 50 MB pdf cap.
      fs: makeOversizeFs('report.pdf', 51 * 1024 * 1024)
    })
    const result = explorer.readBytes(PANE_ID, 'report.pdf')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-large')
  })
})

describe('fs:readBytes integration — no absolute path leaks', () => {
  it('never returns an absolute path in the result on success or failure', () => {
    const { explorer } = makeExplorer(tmpRoot)
    const ok = explorer.readBytes(PANE_ID, 'report.pdf')
    expect(JSON.stringify(ok)).not.toContain(tmpRoot)
    const fail = explorer.readBytes(PANE_ID, '../report.pdf')
    expect(JSON.stringify(fail)).not.toContain(tmpRoot)
  })
})
