/**
 * DOM test (jsdom) — OPEN-FILES-PROVIDER-01 (cosmos-terminal-favorite-explorer-share-v1, FR-002).
 *
 * The lifted, paneId-keyed shared open-files store: `apply` runs a pure `openFiles.ts` transition
 * against the right pane + bumps the read version; TWO consumers of the SAME paneId both re-read
 * after an `apply` from either (the crux of the share); `setLive` flips the owning-liveness flag;
 * `clear` removes the entry; pane entries are INDEPENDENT across paneIds; a no-op transition does not
 * churn consumers. Monaco-free (the store imports only the pure transitions).
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import { OpenFilesProvider, useSharedOpenFiles, type SharedOpenFiles } from './OpenFilesProvider'
import { openOrFocus, setActiveFile } from './openFiles'

/** Capture one consumer's handle + count its renders so re-read / no-churn is assertable. */
function makeConsumer(): { node: (paneId: string) => React.JSX.Element; handle: () => SharedOpenFiles; renders: () => number } {
  let latest: SharedOpenFiles | null = null
  let renderCount = 0
  function Consumer({ paneId }: { paneId: string }): null {
    latest = useSharedOpenFiles(paneId)
    renderCount += 1
    return null
  }
  return {
    node: (paneId: string) => <Consumer paneId={paneId} />,
    handle: () => {
      if (!latest) throw new Error('consumer not mounted')
      return latest
    },
    renders: () => renderCount
  }
}

describe('OpenFilesProvider (OPEN-FILES-PROVIDER-01, FR-002)', () => {
  it('apply mutates the right pane entry + two consumers of the same paneId both re-read', () => {
    const a = makeConsumer()
    const b = makeConsumer()
    render(
      <OpenFilesProvider>
        {a.node('pane-1')}
        {b.node('pane-1')}
      </OpenFilesProvider>
    )
    expect(a.handle().entry.openFiles.files).toHaveLength(0)

    // Apply from consumer A's handle — consumer B (same paneId) must see it too.
    act(() => a.handle().apply((s) => openOrFocus(s, 'src/App.tsx')))
    expect(a.handle().entry.openFiles.files.map((f) => f.relPath)).toEqual(['src/App.tsx'])
    expect(b.handle().entry.openFiles.files.map((f) => f.relPath)).toEqual(['src/App.tsx'])
    expect(b.handle().entry.openFiles.activeRelPath).toBe('src/App.tsx')

    // Apply from B — A sees it (bidirectional shared write).
    act(() => b.handle().apply((s) => openOrFocus(s, 'src/b.ts')))
    expect(a.handle().entry.openFiles.files.map((f) => f.relPath)).toEqual(['src/App.tsx', 'src/b.ts'])
  })

  it('pane entries are INDEPENDENT across paneIds', () => {
    const one = makeConsumer()
    const two = makeConsumer()
    render(
      <OpenFilesProvider>
        {one.node('pane-1')}
        {two.node('pane-2')}
      </OpenFilesProvider>
    )
    act(() => one.handle().apply((s) => openOrFocus(s, 'a.ts')))
    expect(one.handle().entry.openFiles.files).toHaveLength(1)
    expect(two.handle().entry.openFiles.files).toHaveLength(0) // pane-2 untouched
  })

  it('setLive flips the owning-liveness flag; clear removes the entry', () => {
    const c = makeConsumer()
    render(<OpenFilesProvider>{c.node('pane-1')}</OpenFilesProvider>)
    expect(c.handle().entry.live).toBe(false)
    act(() => c.handle().setLive(true))
    expect(c.handle().entry.live).toBe(true)

    act(() => c.handle().apply((s) => openOrFocus(s, 'a.ts')))
    expect(c.handle().entry.openFiles.files).toHaveLength(1)
    act(() => c.handle().clear())
    expect(c.handle().entry.openFiles.files).toHaveLength(0) // back to the EMPTY default entry
    expect(c.handle().entry.live).toBe(false)
  })

  it('a no-op transition (focus the already-active file) does not churn consumers', () => {
    const c = makeConsumer()
    render(<OpenFilesProvider>{c.node('pane-1')}</OpenFilesProvider>)
    act(() => c.handle().apply((s) => openOrFocus(s, 'a.ts')))
    const before = c.renders()
    // setActiveFile to the already-active file returns the SAME reference → provider must not bump.
    act(() => c.handle().apply((s) => setActiveFile(s, 'a.ts')))
    expect(c.renders()).toBe(before)
    expect(c.handle().entry.openFiles.activeRelPath).toBe('a.ts')
  })
})
