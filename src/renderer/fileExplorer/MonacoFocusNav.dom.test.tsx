/**
 * DOM test for the REAL Monaco focus → viewer-focus wiring (terminal-tab-nav-monaco-focus-v1).
 *
 * Why this test exists (and why the older TerminalTabNavRouting.dom.test.tsx was structurally
 * insufficient): Monaco creates its editor WITHOUT an `overflowWidgetsDomNode`, so it mounts its
 * hidden keyboard-input <textarea> on `document.body` — OUTSIDE the FileViewer wrapper div. When the
 * editor is focused, focus lands on that body-mounted textarea, so the DOM `focusin` event NEVER
 * bubbles to the FileViewer outer div where `onFocus` was attached. `handleFocus` therefore never
 * fired, `viewerFocused` stayed `false`, and `Cmd+Option+Arrow` mis-routed to the TERMINAL tabs.
 *
 * The old routing test fired `fireEvent.focus(plainDiv)` — a plain div whose focus DOES bubble — so
 * it could never reproduce this. The robust fix drives viewer-focus from Monaco's OWN
 * `onDidFocusEditorText`/`onDidBlurEditorText` instead of DOM focus bubbling. This test exercises
 * that real path: it renders the real `MonacoText` and asserts the editor's `onDidFocusEditorText`
 * drives the `onViewerFocusChange` callback `true` (and blur drives it `false`).
 *
 * If monaco-editor cannot construct under jsdom, see the skip note below — this class of bug is then
 * only catchable via test:e2e (open a file, press Cmd+Option+Arrow, assert the FILE tab moved).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import type { editor } from 'monaco-editor'

// Capture the editor instance Monaco hands back so the test can drive its focus events, and capture
// the focus/blur listeners MonacoText registers so we can fire them like the real editor would.
let focusCb: (() => void) | undefined
let blurCb: (() => void) | undefined

vi.mock('./monacoSetup', () => {
  const focusDisposable = { dispose: vi.fn() }
  const blurDisposable = { dispose: vi.fn() }
  const fakeEditor: Partial<editor.IStandaloneCodeEditor> = {
    onDidFocusEditorText: ((cb: () => void) => {
      focusCb = cb
      return focusDisposable
    }) as editor.IStandaloneCodeEditor['onDidFocusEditorText'],
    onDidBlurEditorText: ((cb: () => void) => {
      blurCb = cb
      return blurDisposable
    }) as editor.IStandaloneCodeEditor['onDidBlurEditorText'],
    getModel: () => null,
    dispose: vi.fn()
  }
  return {
    setupMonaco: () => ({
      editor: {
        create: () => fakeEditor,
        setModelLanguage: vi.fn()
      }
    })
  }
})

// MonacoText imports these helpers; their pure outputs don't matter here, only that they import.
vi.mock('./monacoTheme', () => ({
  buildViewerEditorOptions: () => ({}),
  COSMOS_MONACO_THEME: 'cosmos-dark'
}))

// FileTabStrip pulls in shadcn `@/components/ui/*` (an alias the jsdom vitest project does not
// resolve) and is irrelevant to the focus wiring under test — stub it to a trivial strip so the
// test isolates the REAL MonacoText → onViewerFocusChange path.
vi.mock('./FileTabStrip', () => ({
  FileTabStrip: () => <div data-testid="file-tab-strip" />
}))

// The document viewers eagerly import react-pdf / pdfjs / docx-preview which reference browser APIs
// (DOMMatrix etc.) jsdom lacks — they're only used for pdf/docx/sheet kinds, never the `text` path
// under test, so stub them to keep FileViewer importable under jsdom.
vi.mock('./PdfView', () => ({ PdfView: () => <div /> }))
vi.mock('./DocxView', () => ({ DocxView: () => <div /> }))
vi.mock('./SheetView', () => ({ SheetView: () => <div /> }))

import { FileViewer } from './FileViewer'
import type { FileTab } from './FileTabStrip'

const FILES: FileTab[] = [{ relPath: 'a.ts', name: 'a.ts' }]

beforeEach(() => {
  focusCb = undefined
  blurCb = undefined
  cleanup()
})

describe('Monaco focus drives viewer-focus (terminal-tab-nav-monaco-focus-v1)', () => {
  it('reports viewer focus from onDidFocusEditorText, NOT from DOM focus bubbling', () => {
    const onViewerFocusChange = vi.fn()
    render(
      <FileViewer
        paneId="p1"
        openFiles={FILES}
        activeRelPath="a.ts"
        viewer={{ kind: 'text', relPath: 'a.ts', name: 'a.ts', text: 'hello' }}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onRenderError={vi.fn()}
        onViewerFocusChange={onViewerFocusChange}
      />
    )

    // MonacoText must have wired the editor's own focus events (this is the body-mounted-textarea
    // path the DOM onFocus cannot see).
    expect(focusCb).toBeTypeOf('function')
    expect(blurCb).toBeTypeOf('function')

    // The editor gains focus → onDidFocusEditorText fires → viewer reports focused=true. WITHOUT the
    // fix this never happens (DOM focusin lands on the body textarea and never bubbles here).
    focusCb?.()
    expect(onViewerFocusChange).toHaveBeenLastCalledWith(true)

    // The editor loses focus → onDidBlurEditorText fires → viewer reports focused=false.
    blurCb?.()
    expect(onViewerFocusChange).toHaveBeenLastCalledWith(false)
  })
})
