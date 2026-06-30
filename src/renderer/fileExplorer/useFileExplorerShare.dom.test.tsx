/**
 * DOM tests (jsdom) — TERM-EXPLORER-SHARE-01 (cosmos-terminal-favorite-explorer-share-v1).
 *
 * Two suites at the HOOK layer (Monaco-free — `useFileExplorer` imports only the pure transitions +
 * the Monaco-free store/registry; only `FileViewer.tsx` imports Monaco), `window.cosmos.fs` mocked:
 *
 *  A. SINGLE-MOUNT REGRESSION (OQ-4/FR-011, SC-007 — the headline, mandatory with the lift): prove the
 *     open-files state lift to the shared store + the resolver-effect refactor did NOT regress the
 *     existing single-terminal explorer — go-live seed + ONE fs:read per restored path, the StrictMode
 *     `persist-open-files-restore-broken-v1` consume-once guard, the `onOpenFilesChange` report,
 *     open→resolve→ONE fs:read (no re-read jolt on re-click), adjacency-close, watch re-read +
 *     invalidate, teardown clear + model release.
 *  B. TWO-MOUNT CONTENT-SYNC (SC-002/SC-003/SC-004/SC-005): one OWNING + one MIRROR `useFileExplorer`
 *     for the SAME paneId under one provider — open/close/activate from either reflects in both; the
 *     SINGLE owner resolves with exactly ONE fs:read; the mirror drives NO fs:watch/fs:read; a gone
 *     source degrades the mirror.
 */
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, cleanup } from '@testing-library/react'
import type { FsReadResult } from '../../shared/ipc'
import { OpenFilesProvider } from './OpenFilesProvider'
import { useFileExplorer, type RestoredOpenFiles, type UseFileExplorer } from './useFileExplorer'
import { sharedMonacoModelRegistry } from './monacoModelRegistry'

// ---------------------------------------------------------------------------
// window.cosmos.fs mock
// ---------------------------------------------------------------------------

function makeCosmos(read?: (paneId: string, relPath: string) => FsReadResult): {
  fs: {
    list: ReturnType<typeof vi.fn>
    read: ReturnType<typeof vi.fn>
    readBytes: ReturnType<typeof vi.fn>
    watchStart: ReturnType<typeof vi.fn>
    watchStop: ReturnType<typeof vi.fn>
    onChanged: ReturnType<typeof vi.fn>
  }
  fireChanged: (paneId: string) => void
} {
  const listeners: Array<(p: { paneId: string }) => void> = []
  const fs = {
    list: vi.fn(async () => ({ ok: true, entries: [] })),
    read: vi.fn(async (paneId: string, relPath: string): Promise<FsReadResult> =>
      read ? read(paneId, relPath) : { ok: true, kind: 'text', text: `CONTENT:${relPath}` }
    ),
    readBytes: vi.fn(),
    watchStart: vi.fn(),
    watchStop: vi.fn(),
    onChanged: vi.fn((cb: (p: { paneId: string }) => void) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    })
  }
  return {
    fs,
    fireChanged: (paneId: string) => {
      for (const cb of [...listeners]) cb({ paneId })
    }
  }
}

let cosmos: ReturnType<typeof makeCosmos>

function installCosmos(read?: (paneId: string, relPath: string) => FsReadResult): void {
  cosmos = makeCosmos(read)
  Object.defineProperty(window, 'cosmos', { configurable: true, writable: true, value: { fs: cosmos.fs } })
}

/** Flush pending microtasks (the resolver's `fs:read` `.then`). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  installCosmos()
  vi.restoreAllMocks()
})
afterEach(() => cleanup())

// ===========================================================================
// A. SINGLE-MOUNT REGRESSION (OQ-4/SC-007)
// ===========================================================================

describe('single-mount explorer — no regression after the lift (TERM-EXPLORER-SHARE-01.A, SC-007)', () => {
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <OpenFilesProvider>{children}</OpenFilesProvider>
  )

  it('go-live seeds from restoredOpenFiles + fires ONE fs:read per restored path (resolver)', async () => {
    const restored: RestoredOpenFiles = { files: ['a.ts', 'b.ts'], activeRelPath: 'b.ts' }
    const { result } = renderHook(() => useFileExplorer('pane-1', true, restored), { wrapper })
    await flush()
    expect(result.current.openFiles.map((f) => f.relPath)).toEqual(['a.ts', 'b.ts'])
    expect(result.current.activeRelPath).toBe('b.ts')
    // exactly one read per restored path
    expect(cosmos.fs.read).toHaveBeenCalledTimes(2)
    expect(cosmos.fs.read).toHaveBeenCalledWith('pane-1', 'a.ts')
    expect(cosmos.fs.read).toHaveBeenCalledWith('pane-1', 'b.ts')
    // resolved content landed
    const active = result.current.viewer
    expect(active && active.kind === 'text' && active.text).toBe('CONTENT:b.ts')
    expect(cosmos.fs.watchStart).toHaveBeenCalledWith('pane-1')
  })

  it('StrictMode double-mount does NOT wipe the restored seed (persist-open-files-restore-broken-v1)', async () => {
    const restored: RestoredOpenFiles = { files: ['a.ts'], activeRelPath: 'a.ts' }
    const strictWrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <StrictMode>
        <OpenFilesProvider>{children}</OpenFilesProvider>
      </StrictMode>
    )
    const { result } = renderHook(() => useFileExplorer('pane-1', true, restored), { wrapper: strictWrapper })
    await flush()
    // The seed survives the body→cleanup→body double-invoke (consumed only on a real enabled true→false).
    expect(result.current.openFiles.map((f) => f.relPath)).toEqual(['a.ts'])
  })

  it('onOpenFilesChange reports the slice on every change', async () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useFileExplorer('pane-1', true, undefined, onChange), { wrapper })
    await flush()
    onChange.mockClear()
    act(() => result.current.openFile('src/x.ts'))
    await flush()
    expect(onChange).toHaveBeenCalledWith({ files: ['src/x.ts'], activeRelPath: 'src/x.ts' })
  })

  it('openFile → loading → ONE fs:read → resolved; a re-click focuses with NO re-read', async () => {
    const { result } = renderHook(() => useFileExplorer('pane-1', true), { wrapper })
    await flush()
    act(() => result.current.openFile('a.ts'))
    await flush()
    expect(cosmos.fs.read).toHaveBeenCalledTimes(1)
    const v = result.current.viewer
    expect(v && v.kind === 'text' && v.text).toBe('CONTENT:a.ts')
    // re-click the already-open file → focus only, NO second read
    act(() => result.current.openFile('a.ts'))
    await flush()
    expect(cosmos.fs.read).toHaveBeenCalledTimes(1)
  })

  it('closeFile re-picks the adjacency neighbour (right-else-left-else-null) identically', async () => {
    const { result } = renderHook(() => useFileExplorer('pane-1', true), { wrapper })
    await flush()
    for (const p of ['a.ts', 'b.ts', 'c.ts']) {
      act(() => result.current.openFile(p))
      await flush()
    }
    expect(result.current.activeRelPath).toBe('c.ts') // last opened active
    act(() => result.current.closeFile('c.ts')) // close active last → left neighbour
    await flush()
    expect(result.current.openFiles.map((f) => f.relPath)).toEqual(['a.ts', 'b.ts'])
    expect(result.current.activeRelPath).toBe('b.ts')
  })

  it('watch fs:changed re-reads every open file + invalidates a vanished one, siblings intact', async () => {
    // a.ts vanishes (not-found) on the change; b.ts gets new content.
    let aGone = false
    installCosmos((_paneId, relPath) => {
      if (relPath === 'a.ts' && aGone) return { ok: false, reason: 'not-found' }
      if (relPath === 'b.ts') return { ok: true, kind: 'text', text: aGone ? 'B-NEW' : 'B-OLD' }
      return { ok: true, kind: 'text', text: `CONTENT:${relPath}` }
    })
    const { result } = renderHook(() => useFileExplorer('pane-1', true), { wrapper })
    await flush()
    act(() => result.current.openFile('a.ts'))
    await flush()
    act(() => result.current.openFile('b.ts'))
    await flush()
    aGone = true
    act(() => cosmos.fireChanged('pane-1'))
    await flush()
    const files = result.current.openFiles
    const a = files.find((f) => f.relPath === 'a.ts')!
    const b = files.find((f) => f.relPath === 'b.ts')!
    expect(a.viewer.kind).toBe('not-found') // vanished file invalidated
    expect(b.viewer.kind === 'text' && b.viewer.text).toBe('B-NEW') // sibling re-read intact
  })

  it('teardown (enabled true→false) clears the shared store entry + releases its models', async () => {
    const releaseSpy = vi.spyOn(sharedMonacoModelRegistry, 'release')
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useFileExplorer('pane-1', enabled),
      { wrapper, initialProps: { enabled: true } }
    )
    await flush()
    act(() => result.current.openFile('a.ts'))
    await flush()
    expect(result.current.openFiles).toHaveLength(1)
    rerender({ enabled: false })
    await flush()
    expect(result.current.openFiles).toHaveLength(0) // shared store entry cleared
    expect(cosmos.fs.watchStop).toHaveBeenCalledWith('pane-1')
    expect(releaseSpy).toHaveBeenCalledWith('pane-1', 'a.ts')
  })
})

// ===========================================================================
// B. TWO-MOUNT CONTENT-SYNC (SC-002/SC-003/SC-004/SC-005)
// ===========================================================================

describe('two-mount explorer content-sync (TERM-EXPLORER-SHARE-01.B)', () => {
  let owner: UseFileExplorer
  let mirror: UseFileExplorer

  function Owner(): null {
    owner = useFileExplorer('pane-1', true)
    return null
  }
  function Mirror(): null {
    mirror = useFileExplorer('pane-1', true, undefined, undefined, { mirror: true })
    return null
  }

  it('opening a file in the MIRROR appears in the OWNER; the OWNER resolves it with ONE fs:read; both read it (SC-002/SC-003)', async () => {
    render(
      <OpenFilesProvider>
        <Owner />
        <Mirror />
      </OpenFilesProvider>
    )
    await flush()
    const readsBefore = cosmos.fs.read.mock.calls.filter((c) => c[1] === 'a.ts').length
    act(() => mirror.openFile('a.ts'))
    await flush()
    // appears in BOTH views
    expect(owner.openFiles.map((f) => f.relPath)).toEqual(['a.ts'])
    expect(mirror.openFiles.map((f) => f.relPath)).toEqual(['a.ts'])
    // resolved by the SINGLE owner — exactly ONE fs:read for a.ts (the mirror drove none)
    const readsAfter = cosmos.fs.read.mock.calls.filter((c) => c[1] === 'a.ts').length
    expect(readsAfter - readsBefore).toBe(1)
    // both show the resolved content (one shared store)
    expect(owner.viewer && owner.viewer.kind === 'text' && owner.viewer.text).toBe('CONTENT:a.ts')
    expect(mirror.viewer && mirror.viewer.kind === 'text' && mirror.viewer.text).toBe('CONTENT:a.ts')
  })

  it('setActiveFile / closeFile from either reflects in both; close re-picks the same active in both', async () => {
    render(
      <OpenFilesProvider>
        <Owner />
        <Mirror />
      </OpenFilesProvider>
    )
    await flush()
    for (const p of ['a.ts', 'b.ts']) {
      act(() => owner.openFile(p))
      await flush()
    }
    // mirror activates a.ts → owner reflects
    act(() => mirror.setActiveFile('a.ts'))
    await flush()
    expect(owner.activeRelPath).toBe('a.ts')
    expect(mirror.activeRelPath).toBe('a.ts')
    // owner closes a.ts → both lose it + re-pick the same neighbour
    act(() => owner.closeFile('a.ts'))
    await flush()
    expect(mirror.openFiles.map((f) => f.relPath)).toEqual(['b.ts'])
    expect(mirror.activeRelPath).toBe('b.ts')
    expect(owner.activeRelPath).toBe('b.ts')
  })

  it('the MIRROR drives NO fs:watch and NO fs:read resolution (FR-006/SC-004)', async () => {
    render(
      <OpenFilesProvider>
        <Mirror />
      </OpenFilesProvider>
    )
    await flush()
    // mirror-only: it lists its OWN tree but never watches; opening a file with NO owner mounted leaves
    // the file LOADING (the mirror does not resolve it — no fs:read from the mirror).
    act(() => mirror.openFile('a.ts'))
    await flush()
    expect(cosmos.fs.watchStart).not.toHaveBeenCalled()
    expect(cosmos.fs.read).not.toHaveBeenCalled()
    expect(mirror.viewer?.kind).toBe('loading') // unresolved — no owner to resolve it
  })

  it('a GONE source (owner unmounts) degrades the mirror to an empty entry without the mirror touching fs:* (SC-005)', async () => {
    function Harness({ showOwner }: { showOwner: boolean }): React.JSX.Element {
      return (
        <OpenFilesProvider>
          {showOwner ? <Owner /> : null}
          <Mirror />
        </OpenFilesProvider>
      )
    }
    const { rerender } = render(<Harness showOwner />)
    await flush()
    act(() => owner.openFile('a.ts'))
    await flush()
    expect(mirror.openFiles).toHaveLength(1)
    // close the source terminal tab → owner unmounts (its teardown clears the shared store)
    rerender(<Harness showOwner={false} />)
    await flush()
    expect(mirror.openFiles).toHaveLength(0) // mirror reads the now-absent entry → degrades
    expect(cosmos.fs.watchStart).toHaveBeenCalledTimes(1) // only the owner ever watched (before it left)
  })
})
