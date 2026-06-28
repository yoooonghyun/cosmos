import { describe, it, expect, vi } from 'vitest'
import { createFsExplorer, type ExplorerFs, type FsWatcher } from './fsExplorer'

/*
 * fsExplorer — the MAIN-side manager (terminal-file-explorer-v1, FR-004/008/014/016/019,
 * SC-003/004/006/008). Electron-free + disk-free: a fake `ExplorerFs` models the disk and a
 * fake `getRoot`/`onChanged` model the wiring, so list-sort, confinement passthrough, the
 * read classification, and the watcher lifecycle/debounce are exercised deterministically.
 */

const ROOT = '/home/user/project'
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/** A fake ExplorerFs. `dirs` maps an abs dir → its entries; `files` maps an abs file →
 * bytes; `denied`/`missing` force error sentinels; `realpath` is identity for known paths. */
function fakeFs(opts?: {
  dirs?: Record<string, { name: string; isDir: boolean; isSymlink: boolean }[]>
  files?: Record<string, Uint8Array>
  denied?: string[]
  missing?: string[]
  /** Override the stat size for an abs file (file-viewer-multiformat-v1 FR-012). Defaults to
   * the `files` entry's byte length, else `null` (unknown). */
  sizes?: Record<string, number>
}): ExplorerFs {
  const dirs = opts?.dirs ?? {}
  const files = opts?.files ?? {}
  const denied = new Set(opts?.denied ?? [])
  const missing = new Set(opts?.missing ?? [])
  const sizes = opts?.sizes ?? {}
  return {
    realpath: (p) => (missing.has(p) ? null : p),
    readDir(absDir) {
      if (denied.has(absDir)) {
        return { error: 'denied' }
      }
      const entries = dirs[absDir]
      return entries ? entries : { error: 'not-found' }
    },
    readFileBytes(absFile) {
      if (denied.has(absFile)) {
        return { error: 'denied' }
      }
      const bytes = files[absFile]
      return bytes ? bytes : { error: 'not-found' }
    },
    statSize(absFile) {
      if (absFile in sizes) {
        return sizes[absFile]
      }
      const bytes = files[absFile]
      return bytes ? bytes.byteLength : null
    },
    watch(_absRoot, _onEvent): FsWatcher | null {
      return { close: () => {} }
    }
  }
}

describe('list — sort order (FR-005)', () => {
  it('lists dirs first, then files, each alpha case-insensitive', () => {
    const fs = fakeFs({
      dirs: {
        [ROOT]: [
          { name: 'banana.txt', isDir: false, isSymlink: false },
          { name: 'Zebra', isDir: true, isSymlink: false },
          { name: 'apple.ts', isDir: false, isSymlink: false },
          { name: 'alpha', isDir: true, isSymlink: false }
        ]
      }
    })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    const res = ex.list('p', '')
    expect(res).toEqual({
      ok: true,
      entries: [
        { name: 'alpha', kind: 'dir', isSymlink: false },
        { name: 'Zebra', kind: 'dir', isSymlink: false },
        { name: 'apple.ts', kind: 'file', isSymlink: false },
        { name: 'banana.txt', kind: 'file', isSymlink: false }
      ]
    })
  })

  it('refuses an out-of-root list and never reads it (FR-019)', () => {
    const readDir = vi.fn(() => ({ error: 'not-found' as const }))
    const fs: ExplorerFs = { ...fakeFs(), readDir }
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.list('p', '../../etc')).toEqual({ ok: false, reason: 'out-of-root' })
    expect(readDir).not.toHaveBeenCalled()
  })

  it('returns out-of-root when the pane has no live root (FR-006)', () => {
    const ex = createFsExplorer({ getRoot: () => undefined, onChanged: () => {}, fs: fakeFs() })
    expect(ex.list('p', '')).toEqual({ ok: false, reason: 'out-of-root' })
  })

  it('surfaces a denied directory without aborting (FR-011 sibling-safety posture)', () => {
    const fs = fakeFs({ denied: [`${ROOT}/secret`], dirs: { [ROOT]: [] } })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.list('p', 'secret')).toEqual({ ok: false, reason: 'denied' })
    // A sibling list still works.
    expect(ex.list('p', '')).toEqual({ ok: true, entries: [] })
  })
})

describe('read — classification (FR-009/010/011)', () => {
  it('reads a text file as text', () => {
    const fs = fakeFs({ files: { [`${ROOT}/a.ts`]: enc('const x = 1\n') } })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'a.ts')).toEqual({ ok: true, kind: 'text', text: 'const x = 1\n' })
  })
  it('returns only an image MARKER (no bytes ride IPC, FR-010/FR-028)', () => {
    const fs = fakeFs({ files: { [`${ROOT}/logo.png`]: new Uint8Array([0, 1, 2]) } })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'logo.png')).toEqual({ ok: true, kind: 'image' })
  })
  it('returns binary for a non-text, non-image file (FR-011)', () => {
    const fs = fakeFs({ files: { [`${ROOT}/a.bin`]: new Uint8Array([0x00, 0xff]) } })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'a.bin')).toEqual({ ok: false, reason: 'binary' })
  })
  it('returns not-found for a missing file and out-of-root for an escape', () => {
    const fs = fakeFs({ missing: [`${ROOT}/gone.txt`] })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'gone.txt')).toEqual({ ok: false, reason: 'not-found' })
    expect(ex.read('p', '/etc/passwd')).toEqual({ ok: false, reason: 'out-of-root' })
  })
})

describe('read — document markers + size cap (file-viewer-multiformat-v1, FR-005/007/012)', () => {
  it('returns a DOCUMENT marker (pdf/docx/sheet) by extension WITHOUT reading the bytes', () => {
    // The renderer fetches the bytes from `cosmos-file://` (FR-007); the read must NOT call
    // readFileBytes for a document — it routes by name + caps by statSize only.
    const readFileBytes = vi.fn(() => ({ error: 'not-found' as const }))
    const fs: ExplorerFs = {
      ...fakeFs({ sizes: { [`${ROOT}/a.pdf`]: 1024, [`${ROOT}/b.docx`]: 1024, [`${ROOT}/c.xlsx`]: 1024 } }),
      readFileBytes
    }
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'a.pdf')).toEqual({ ok: true, kind: 'pdf' })
    expect(ex.read('p', 'b.docx')).toEqual({ ok: true, kind: 'docx' })
    expect(ex.read('p', 'c.xlsx')).toEqual({ ok: true, kind: 'sheet' })
    expect(readFileBytes).not.toHaveBeenCalled()
  })
  it('returns too-large for a document over its per-format cap (FR-012)', () => {
    const fs = fakeFs({ sizes: { [`${ROOT}/huge.pdf`]: 51 * 1024 * 1024 } })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'huge.pdf')).toEqual({ ok: false, reason: 'too-large' })
  })
  it('returns not-found when a document cannot be stat-ed (vanished/denied)', () => {
    // No `files` and no `sizes` entry → statSize returns null → benign not-found, no crash.
    const fs = fakeFs()
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'ghost.pdf')).toEqual({ ok: false, reason: 'not-found' })
  })
  it('routes a legacy/unknown binary (.doc/.zip) to the binary fallback, not a marker', () => {
    const fs = fakeFs({
      files: {
        [`${ROOT}/old.doc`]: new Uint8Array([0x00, 0xd0, 0xcf]),
        [`${ROOT}/pkg.zip`]: new Uint8Array([0x50, 0x4b, 0x00])
      }
    })
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    expect(ex.read('p', 'old.doc')).toEqual({ ok: false, reason: 'binary' })
    expect(ex.read('p', 'pkg.zip')).toEqual({ ok: false, reason: 'binary' })
  })
})

describe('watch lifecycle (FR-016, SC-006)', () => {
  it('creates a watcher on startWatch and releases it on stopWatch', () => {
    const close = vi.fn()
    const watch = vi.fn(() => ({ close }))
    const fs: ExplorerFs = { ...fakeFs(), watch }
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    ex.startWatch('p')
    expect(ex.watchedPanes()).toEqual(['p'])
    expect(watch).toHaveBeenCalledTimes(1)
    ex.stopWatch('p')
    expect(ex.watchedPanes()).toEqual([])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not double-watch the same pane+root', () => {
    const watch = vi.fn(() => ({ close: () => {} }))
    const fs: ExplorerFs = { ...fakeFs(), watch }
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged: () => {}, fs })
    ex.startWatch('p')
    ex.startWatch('p')
    expect(watch).toHaveBeenCalledTimes(1)
  })

  it('creates no watcher for a pane with no live root (FR-006)', () => {
    const watch = vi.fn(() => ({ close: () => {} }))
    const fs: ExplorerFs = { ...fakeFs(), watch }
    const ex = createFsExplorer({ getRoot: () => undefined, onChanged: () => {}, fs })
    ex.startWatch('p')
    expect(ex.watchedPanes()).toEqual([])
    expect(watch).not.toHaveBeenCalled()
  })

  it('re-watches when the pane cwd changes', () => {
    const close = vi.fn()
    const watch = vi.fn(() => ({ close }))
    const fs: ExplorerFs = { ...fakeFs(), watch }
    let root = ROOT
    const ex = createFsExplorer({ getRoot: () => root, onChanged: () => {}, fs })
    ex.startWatch('p')
    root = '/home/user/other'
    ex.startWatch('p')
    expect(close).toHaveBeenCalledTimes(1) // old watcher released
    expect(watch).toHaveBeenCalledTimes(2)
    expect(ex.watchedPanes()).toEqual(['p'])
  })

  it('stopAll releases every watcher (window teardown, SC-006)', () => {
    const close = vi.fn()
    const fs: ExplorerFs = { ...fakeFs(), watch: () => ({ close }) }
    const roots: Record<string, string> = { a: '/r/a', b: '/r/b' }
    const ex = createFsExplorer({ getRoot: (id) => roots[id], onChanged: () => {}, fs })
    ex.startWatch('a')
    ex.startWatch('b')
    expect(ex.watchedPanes().sort()).toEqual(['a', 'b'])
    ex.stopAll()
    expect(ex.watchedPanes()).toEqual([])
    expect(close).toHaveBeenCalledTimes(2)
  })
})

describe('watch debounce (FR-018)', () => {
  it('coalesces a burst of events into ONE onChanged', () => {
    vi.useFakeTimers()
    const onChanged = vi.fn()
    let fire: () => void = () => {}
    const fs: ExplorerFs = {
      ...fakeFs(),
      watch: (_root, onEvent) => {
        fire = onEvent
        return { close: () => {} }
      }
    }
    const ex = createFsExplorer({ getRoot: () => ROOT, onChanged, fs, debounceMs: 50 })
    ex.startWatch('p')
    fire()
    fire()
    fire()
    expect(onChanged).not.toHaveBeenCalled() // still within the debounce window
    vi.advanceTimersByTime(50)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('p')
    vi.useRealTimers()
  })
})
