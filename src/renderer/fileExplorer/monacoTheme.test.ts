import { describe, it, expect } from 'vitest'
import {
  buildCosmosMonacoTheme,
  buildViewerEditorOptions,
  COSMOS_MONACO_THEME
} from './monacoTheme'

/*
 * monacoTheme — PURE token → cosmos-dark Monaco theme (terminal-file-explorer-v1, design §4.2).
 * Node env, no Monaco/DOM. Mirrors terminalTheme.test.ts: a token reader maps to concrete
 * colors with a safe fallback for missing tokens.
 */

const reader = (map: Record<string, string>) => (name: string): string => map[name] ?? ''

describe('buildCosmosMonacoTheme', () => {
  it('maps the cosmos tokens onto the editor colors', () => {
    const theme = buildCosmosMonacoTheme(
      reader({
        '--card': '#1b1b1c',
        '--foreground': '#e0e0e0',
        '--muted-foreground': '#888',
        '--accent': '#2d2d30',
        '--border': '#333'
      })
    )
    expect(theme.base).toBe('vs-dark')
    expect(theme.colors['editor.background']).toBe('#1b1b1c')
    expect(theme.colors['editor.foreground']).toBe('#e0e0e0')
    expect(theme.colors['editorLineNumber.foreground']).toBe('#888')
    expect(theme.colors['editor.selectionBackground']).toBe('#2d2d30')
  })

  it('falls back to dark defaults for missing/blank tokens (no transparent void)', () => {
    const theme = buildCosmosMonacoTheme(reader({ '--card': '   ' }))
    expect(theme.colors['editor.background']).toBe('#1b1b1c')
    expect(theme.colors['editor.foreground']).toBe('#e0e0e0')
  })

  it('exposes a stable theme name', () => {
    expect(COSMOS_MONACO_THEME).toBe('cosmos-dark')
  })
})

describe('buildViewerEditorOptions (file-viewer-color-wrap-v1, #94 fix 2)', () => {
  it('enables soft word-wrap so long lines wrap instead of scrolling horizontally', () => {
    // The load-bearing #94 fix: wordWrap must be 'on'.
    expect(buildViewerEditorOptions('src/App.tsx').wordWrap).toBe('on')
  })

  it('keeps the read-only viewer settings (read-only, no minimap, line numbers on)', () => {
    const opts = buildViewerEditorOptions('a/b/c.ts')
    expect(opts.readOnly).toBe(true)
    expect(opts.domReadOnly).toBe(true)
    expect(opts.minimap.enabled).toBe(false)
    expect(opts.lineNumbers).toBe('on')
  })

  it('derives the Monaco language from the file extension', () => {
    expect(buildViewerEditorOptions('x.ts').language).toBe('typescript')
    expect(buildViewerEditorOptions('readme.md').language).toBe('markdown')
    // Unknown extension → the safe plaintext default (viewer still renders).
    expect(buildViewerEditorOptions('LICENSE').language).toBe('plaintext')
  })

  it('disables the worker-backed language features (folding, links, sticky-scroll outline) — monaco-worker-missing-method-v1', () => {
    // These three features delegate to a LANGUAGE worker (getFoldingRanges / findDocumentLinks /
    // findDocumentSymbols). Our read-only viewer serves the BASE editor worker for every label, so
    // leaving them at Monaco's DEFAULT-ON would fire provider calls the base worker can't answer →
    // "Missing requestHandler or method: …" spam when opening a json/css/html file. They MUST be off.
    const opts = buildViewerEditorOptions('config.json')
    expect(opts.folding).toBe(false)
    expect(opts.links).toBe(false)
    expect(opts.stickyScroll.enabled).toBe(false)
  })

  it('keeps syntax highlighting on — the language id is still resolved (main-thread monarch)', () => {
    // The fix must NOT regress highlighting: monarch tokenizers run on the main thread, so the
    // language stays set even though the worker-backed features above are disabled.
    expect(buildViewerEditorOptions('style.css').language).toBe('css')
    expect(buildViewerEditorOptions('page.html').language).toBe('html')
  })
})
