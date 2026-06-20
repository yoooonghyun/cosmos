import { describe, it, expect, vi } from 'vitest'
import {
  activeViewer,
  closeFile,
  EMPTY_OPEN_FILES,
  openOrFocus,
  seedOnGoLive,
  seedOpenFiles,
  setActiveFile,
  updateOpenFile,
  type OpenFilesState
} from './openFiles'
import { adjacentActiveId } from '../panelTabs'
import type { ViewerState } from './viewerState'

/*
 * terminal-file-tabs-v1 — the pure open-FILES collection (Phase 2). Node env, no DOM/React.
 * Covers SC-007: open new, open-existing-focuses-no-duplicate, close inactive, close active →
 * neighbour, close last → empty, updateOpenFile isolation, activeViewer.
 */

const empty = EMPTY_OPEN_FILES

/** A resolved `text` viewer for a relPath (a convenient non-loading state for update tests). */
const textViewer = (relPath: string, text = `// ${relPath}`): NonNullable<ViewerState> => ({
  kind: 'text',
  relPath,
  name: relPath.slice(relPath.lastIndexOf('/') + 1),
  text
})

/** Open three distinct files a/b/c (c active, last opened) via the real transition. */
function threeFiles(): OpenFilesState {
  return ['a.ts', 'src/b.ts', 'c.ts'].reduce<OpenFilesState>((s, p) => openOrFocus(s, p), empty)
}

describe('openOrFocus — open a new file (FR-002)', () => {
  it('appends a tab and makes it active, with a loading viewer + basename label', () => {
    const s1 = openOrFocus(empty, 'src/App.tsx')
    expect(s1.files.map((f) => f.relPath)).toEqual(['src/App.tsx'])
    expect(s1.activeRelPath).toBe('src/App.tsx')
    expect(s1.files[0].name).toBe('App.tsx')
    expect(s1.files[0].viewer).toEqual({ kind: 'loading', relPath: 'src/App.tsx', name: 'App.tsx' })

    const s2 = openOrFocus(s1, 'src/index.ts')
    expect(s2.files.map((f) => f.relPath)).toEqual(['src/App.tsx', 'src/index.ts'])
    // The newly-opened file becomes active; the first stays in the strip (not closed).
    expect(s2.activeRelPath).toBe('src/index.ts')
  })

  it('does not mutate the input state (purity)', () => {
    openOrFocus(empty, 'a.ts')
    expect(empty.files).toEqual([])
    expect(empty.activeRelPath).toBeNull()
  })

  it('warns and is a no-op for an empty/invalid relPath (safe fallback)', () => {
    const warn = vi.fn()
    expect(openOrFocus(empty, '', warn)).toBe(empty)
    // @ts-expect-error — exercising a non-string runtime misuse
    expect(openOrFocus(empty, null, warn)).toBe(empty)
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('openOrFocus — re-opening focuses, never duplicates (FR-002, SC-002)', () => {
  it('focuses an already-open INACTIVE file without adding a second tab', () => {
    const s = threeFiles() // a, b, c — c active
    expect(s.activeRelPath).toBe('c.ts')
    const focused = openOrFocus(s, 'a.ts')
    // No duplicate: the count is unchanged, order is unchanged.
    expect(focused.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts', 'c.ts'])
    // 'a.ts' is now active.
    expect(focused.activeRelPath).toBe('a.ts')
  })

  it('re-clicking the already-active file is a referentially-stable no-op', () => {
    const s = threeFiles()
    const again = openOrFocus(s, 'c.ts')
    expect(again).toBe(s) // no new state object — no re-open jolt
  })

  it('preserves the already-open file’s resolved viewer when re-focused (does not reset to loading)', () => {
    let s = openOrFocus(empty, 'a.ts')
    s = updateOpenFile(s, 'a.ts', textViewer('a.ts')) // resolve it
    s = openOrFocus(s, 'b.ts') // open + activate another
    const refocused = openOrFocus(s, 'a.ts') // re-focus a.ts
    expect(refocused.files.find((f) => f.relPath === 'a.ts')!.viewer.kind).toBe('text')
  })
})

describe('setActiveFile (FR-003)', () => {
  it('activates an existing file; no open/close', () => {
    const s = threeFiles()
    const next = setActiveFile(s, 'src/b.ts')
    expect(next.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts', 'c.ts'])
    expect(next.activeRelPath).toBe('src/b.ts')
  })

  it('warns and is a no-op for an unknown path (safe fallback)', () => {
    const warn = vi.fn()
    const s = threeFiles()
    expect(setActiveFile(s, 'nope.ts', warn)).toBe(s)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('is a referentially-stable no-op when the path is already active', () => {
    const s = threeFiles()
    expect(setActiveFile(s, 'c.ts')).toBe(s)
  })
})

describe('closeFile — adjacency & emptying (FR-004/FR-005)', () => {
  it('closing an INACTIVE file leaves the active file unchanged (SC-003)', () => {
    const s = setActiveFile(threeFiles(), 'src/b.ts') // a, b(active), c
    const next = closeFile(s, 'a.ts')
    expect(next.files.map((f) => f.relPath)).toEqual(['src/b.ts', 'c.ts'])
    expect(next.activeRelPath).toBe('src/b.ts')
  })

  it('closing the ACTIVE file activates the RIGHT neighbour (SC-003)', () => {
    const s = setActiveFile(threeFiles(), 'src/b.ts') // a, b(active), c
    const next = closeFile(s, 'src/b.ts')
    expect(next.files.map((f) => f.relPath)).toEqual(['a.ts', 'c.ts'])
    expect(next.activeRelPath).toBe('c.ts') // right neighbour
  })

  it('closing the ACTIVE LAST file activates the LEFT neighbour', () => {
    const s = threeFiles() // a, b, c(active)
    const next = closeFile(s, 'c.ts')
    expect(next.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts'])
    expect(next.activeRelPath).toBe('src/b.ts') // left neighbour (was rightmost)
  })

  it('closing the LAST remaining file empties the collection → activeRelPath null (FR-005)', () => {
    const one = openOrFocus(empty, 'only.ts')
    const next = closeFile(one, 'only.ts')
    expect(next.files).toEqual([])
    expect(next.activeRelPath).toBeNull()
  })

  it('warns and is a no-op closing a path not in the collection (safe fallback)', () => {
    const warn = vi.fn()
    const s = threeFiles()
    expect(closeFile(s, 'ghost.ts', warn)).toBe(s)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('uses the SAME adjacency rule as panelTabs.adjacentActiveId (single-sourced)', () => {
    const s = setActiveFile(threeFiles(), 'src/b.ts')
    const ids = s.files.map((f) => ({ id: f.relPath }))
    // The active-close pick equals the shared rule's pick verbatim.
    expect(closeFile(s, 'src/b.ts').activeRelPath).toBe(
      adjacentActiveId(ids, 'src/b.ts', 'src/b.ts')
    )
    // The inactive-close pick equals the shared rule's pick verbatim.
    expect(closeFile(s, 'a.ts').activeRelPath).toBe(adjacentActiveId(ids, 'a.ts', 'src/b.ts'))
  })
})

describe('updateOpenFile — per-file content tracking (FR-009)', () => {
  it('patches one file’s viewer without touching siblings or the active path', () => {
    const s = threeFiles() // a, b, c(active) — all loading
    const next = updateOpenFile(s, 'a.ts', textViewer('a.ts'))
    expect(next.files.find((f) => f.relPath === 'a.ts')!.viewer.kind).toBe('text')
    // Siblings untouched (still loading).
    expect(next.files.find((f) => f.relPath === 'src/b.ts')!.viewer.kind).toBe('loading')
    expect(next.files.find((f) => f.relPath === 'c.ts')!.viewer.kind).toBe('loading')
    // The active path is unchanged.
    expect(next.activeRelPath).toBe('c.ts')
  })

  it('keeps the relPath stable even if a patch viewer carried a different relPath', () => {
    const s = openOrFocus(empty, 'a.ts')
    const next = updateOpenFile(s, 'a.ts', { ...textViewer('a.ts'), relPath: 'tampered' })
    expect(next.files[0].relPath).toBe('a.ts')
  })

  it('warns and discards a patch for a path not in the collection (closed before its read landed)', () => {
    const warn = vi.fn()
    const s = threeFiles()
    expect(updateOpenFile(s, 'closed.ts', textViewer('closed.ts'), warn)).toBe(s)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('activeViewer (FR-008)', () => {
  it('returns the active file’s viewer', () => {
    let s = threeFiles() // c active, loading
    s = updateOpenFile(s, 'c.ts', textViewer('c.ts'))
    expect(activeViewer(s)).toEqual(textViewer('c.ts'))
  })

  it('returns null when the collection is empty (the placeholder)', () => {
    expect(activeViewer(empty)).toBeNull()
  })

  it('follows the active path after a switch (shows the right content, no cross-wire)', () => {
    let s = threeFiles()
    s = updateOpenFile(s, 'a.ts', textViewer('a.ts', 'AAA'))
    s = updateOpenFile(s, 'src/b.ts', textViewer('src/b.ts', 'BBB'))
    s = setActiveFile(s, 'a.ts')
    expect(activeViewer(s)).toMatchObject({ kind: 'text', text: 'AAA' })
    s = setActiveFile(s, 'src/b.ts')
    expect(activeViewer(s)).toMatchObject({ kind: 'text', text: 'BBB' })
  })
})

describe('seedOpenFiles — restore from a persisted slice (persist-workdir-open-files-v1, FR-004/FR-009/FR-012)', () => {
  it('seeds an ordered open-files collection (each a loading viewer) + the restored active path', () => {
    const s = seedOpenFiles({ files: ['a.ts', 'src/b.ts', 'c.ts'], activeRelPath: 'src/b.ts' })
    expect(s.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts', 'c.ts'])
    expect(s.files.map((f) => f.name)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    // every restored file starts loading; the caller resolves each via fs:read (FR-005).
    expect(s.files.every((f) => f.viewer.kind === 'loading')).toBe(true)
    expect(s.activeRelPath).toBe('src/b.ts')
  })

  it('falls back the active path to the first file when the restored active is absent (FR-009)', () => {
    const s = seedOpenFiles({ files: ['a.ts', 'b.ts'], activeRelPath: 'gone.ts' })
    expect(s.activeRelPath).toBe('a.ts')
  })

  it('drops non-string / empty / duplicate paths (FR-012)', () => {
    const s = seedOpenFiles({ files: ['a.ts', '', 'a.ts', 42, null, 'b.ts'] as never, activeRelPath: 'b.ts' })
    expect(s.files.map((f) => f.relPath)).toEqual(['a.ts', 'b.ts'])
    expect(s.activeRelPath).toBe('b.ts')
  })

  it('returns the empty collection for a slice with no surviving files (→ placeholder, FR-010)', () => {
    expect(seedOpenFiles({ files: [], activeRelPath: null })).toBe(EMPTY_OPEN_FILES)
    expect(seedOpenFiles({ files: [42, null, ''] as never, activeRelPath: 'x' })).toBe(EMPTY_OPEN_FILES)
  })

  it('returns the empty collection for a non-array / malformed slice (safe fallback)', () => {
    expect(seedOpenFiles({ files: 'nope' as never, activeRelPath: null })).toBe(EMPTY_OPEN_FILES)
    expect(seedOpenFiles(undefined as never)).toBe(EMPTY_OPEN_FILES)
  })

  it('nulls a non-string active path while keeping the files (falls back to first)', () => {
    const s = seedOpenFiles({ files: ['a.ts'], activeRelPath: 7 as never })
    expect(s.files.map((f) => f.relPath)).toEqual(['a.ts'])
    expect(s.activeRelPath).toBe('a.ts')
  })
})

describe('seedOnGoLive — StrictMode-safe go-live seeding (bug persist-open-files-restore-broken-v1)', () => {
  // Model the go-live seed exactly as useFileExplorer drives it: a ref holding the still-pending
  // restored slice + a `wasEnabled` flag. The restored slice is CONSUMED only on a genuine
  // enabled true→false transition — NEVER inside a go-live run. This mirror lets the broken vs
  // fixed behaviour be node-tested without React.
  function makeSeeder(restored: { files: string[]; activeRelPath: string | null } | undefined) {
    let pending = restored
    let wasEnabled = false
    return {
      /** A go-live (enabled=true) run: seed from the pending slice WITHOUT clearing it (FR-004). */
      goLive(): OpenFilesState {
        wasEnabled = true
        return seedOnGoLive(pending)
      },
      /** A disable (enabled=false) run: consume the slice ONLY on a real true→false transition. */
      disable(): void {
        if (wasEnabled) {
          pending = undefined
          wasEnabled = false
        }
      }
    }
  }

  it('a StrictMode double-mount (goLive → disable-between? NO → goLive) re-seeds the SAME slice, not EMPTY', () => {
    // React StrictMode runs effect body → cleanup → body synchronously WITHOUT toggling `enabled`,
    // so the cleanup does NOT count as a real disable. Both go-live runs must yield the restored
    // files — the OLD "clear the ref in the body" design seeded EMPTY on the second run (the bug).
    const seeder = makeSeeder({ files: ['a.ts', 'src/b.ts'], activeRelPath: 'src/b.ts' })
    const first = seeder.goLive()
    // (StrictMode cleanup runs here but `enabled` stays true → NOT a real disable → no consume.)
    const second = seeder.goLive()
    expect(first.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts'])
    expect(second.files.map((f) => f.relPath)).toEqual(['a.ts', 'src/b.ts'])
    expect(second.activeRelPath).toBe('src/b.ts')
  })

  it('a GENUINE re-root (goLive → disable → goLive) starts empty the second time (no stale paths)', () => {
    const seeder = makeSeeder({ files: ['a.ts'], activeRelPath: 'a.ts' })
    const first = seeder.goLive()
    seeder.disable() // real enabled true→false: the pane left the live phase, consume the slice.
    const afterReRoot = seeder.goLive()
    expect(first.files.map((f) => f.relPath)).toEqual(['a.ts'])
    expect(afterReRoot).toBe(EMPTY_OPEN_FILES)
  })

  it('seeds EMPTY when there is no restored slice (a pane with no persisted open files, FR-010)', () => {
    const seeder = makeSeeder(undefined)
    expect(seeder.goLive()).toBe(EMPTY_OPEN_FILES)
  })
})

describe('per-paneId independence is structural (FR-006)', () => {
  it('two independent collections never share state (each useFileExplorer owns one)', () => {
    // Two separate OpenFilesState values model two terminal tabs; operations on one do not
    // touch the other (purity — no shared mutable module state).
    const paneA = openOrFocus(empty, 'a.ts')
    const paneB = openOrFocus(empty, 'b.ts')
    expect(paneA.files.map((f) => f.relPath)).toEqual(['a.ts'])
    expect(paneB.files.map((f) => f.relPath)).toEqual(['b.ts'])
    const paneAClosed = closeFile(paneA, 'a.ts')
    expect(paneAClosed.files).toEqual([])
    // paneB is wholly unaffected.
    expect(paneB.files.map((f) => f.relPath)).toEqual(['b.ts'])
  })
})
