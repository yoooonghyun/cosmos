/**
 * DOM test (jsdom) — TERM-EXPLORER-SHARE-01.C (cosmos-terminal-favorite-explorer-share-v1, FR-003/
 * FR-007). MonacoText now attaches a SHARED `ITextModel` from the model registry (`acquire` →
 * `editor.setModel`) instead of `create({ value })` + in-place `setValue`. This asserts the wiring via
 * the REGISTRY calls (Monaco is mocked — it crashes jsdom): mounting a text file `acquire`s its model
 * + `setModel`s it; switching the active file `detach`es the old + `acquire`s the new; a same-file text
 * change `syncText`s the shared buffer; unmount `detach`es. The editor stays read-only (OQ-1) — never
 * disposes the shared model directly (the registry owns disposal via refcount, FR-007).
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { ViewerState } from './viewerState'
import type { FileTab } from './FileTabStrip'

// Spy registry — assert MonacoText's acquire/detach/syncText against it (Monaco-free). `vi.hoisted` so
// the spies exist before the (hoisted) `vi.mock` factories below reference them.
const { acquire, detach, syncText, release, setModel } = vi.hoisted(() => ({
  acquire: vi.fn((_paneId: string, _relPath: string, _text: string, _lang: string) => ({
    getValue: () => '',
    setValue: vi.fn(),
    dispose: vi.fn()
  })),
  detach: vi.fn(),
  syncText: vi.fn(),
  release: vi.fn(),
  setModel: vi.fn()
}))
vi.mock('./monacoModelRegistry', () => ({
  installMonacoModelFactory: vi.fn(),
  sharedMonacoModelRegistry: { acquire, detach, syncText, release, modelUri: (p: string, r: string) => `${p}/${r}` }
}))
vi.mock('./monacoSetup', () => ({
  setupMonaco: () => ({
    editor: {
      create: () => ({
        onDidFocusEditorText: () => ({ dispose: vi.fn() }),
        onDidBlurEditorText: () => ({ dispose: vi.fn() }),
        getModel: () => ({ getValue: () => '', setValue: vi.fn(), dispose: vi.fn() }),
        setModel,
        dispose: vi.fn()
      }),
      getModel: () => null,
      createModel: () => ({ getValue: () => '', setValue: vi.fn(), dispose: vi.fn() })
    },
    Uri: { parse: (s: string) => s }
  })
}))
vi.mock('./monacoTheme', () => ({
  buildViewerEditorOptions: () => ({ readOnly: true, domReadOnly: true }),
  COSMOS_MONACO_THEME: 'cosmos-dark'
}))
vi.mock('./FileTabStrip', () => ({ FileTabStrip: () => <div data-testid="strip" /> }))
vi.mock('./PdfView', () => ({ PdfView: () => <div /> }))
vi.mock('./DocxView', () => ({ DocxView: () => <div /> }))
vi.mock('./SheetView', () => ({ SheetView: () => <div /> }))

import { FileViewer } from './FileViewer'

const tab = (relPath: string): FileTab => ({ relPath, name: relPath })
const textViewer = (relPath: string, text: string): ViewerState => ({ kind: 'text', relPath, name: relPath, text })

beforeEach(() => {
  acquire.mockClear()
  detach.mockClear()
  syncText.mockClear()
  setModel.mockClear()
  cleanup()
})

function renderViewer(relPath: string, text: string) {
  return render(
    <FileViewer
      paneId="p1"
      openFiles={[tab(relPath)]}
      activeRelPath={relPath}
      viewer={textViewer(relPath, text)}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onRenderError={vi.fn()}
    />
  )
}

describe('MonacoText shared-model registry wiring (TERM-EXPLORER-SHARE-01.C, FR-003/FR-007)', () => {
  it('mounting a text file acquires its shared model + setModels it', () => {
    renderViewer('a.ts', 'AAA')
    expect(acquire).toHaveBeenCalledWith('p1', 'a.ts', 'AAA', expect.any(String))
    expect(setModel).toHaveBeenCalledTimes(1)
  })

  it('switching the active file detaches the old + acquires the new', () => {
    const { rerender } = renderViewer('a.ts', 'AAA')
    acquire.mockClear()
    detach.mockClear()
    rerender(
      <FileViewer
        paneId="p1"
        openFiles={[tab('b.ts')]}
        activeRelPath="b.ts"
        viewer={textViewer('b.ts', 'BBB')}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onRenderError={vi.fn()}
      />
    )
    expect(detach).toHaveBeenCalledWith('p1', 'a.ts')
    expect(acquire).toHaveBeenCalledWith('p1', 'b.ts', 'BBB', expect.any(String))
  })

  it('a same-file text change (watch re-read) syncs the shared buffer', () => {
    const { rerender } = renderViewer('a.ts', 'AAA')
    syncText.mockClear()
    rerender(
      <FileViewer
        paneId="p1"
        openFiles={[tab('a.ts')]}
        activeRelPath="a.ts"
        viewer={textViewer('a.ts', 'A-NEW')}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onRenderError={vi.fn()}
      />
    )
    expect(syncText).toHaveBeenCalledWith(expect.anything(), 'A-NEW')
  })

  it('unmount detaches the shared model (never disposes it directly — FR-007)', () => {
    const { unmount } = renderViewer('a.ts', 'AAA')
    detach.mockClear()
    unmount()
    expect(detach).toHaveBeenCalledWith('p1', 'a.ts')
  })
})
