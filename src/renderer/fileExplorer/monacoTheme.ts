/**
 * monacoTheme — PURE mapping from cosmos design tokens to a Monaco `IStandaloneThemeData`
 * (terminal-file-explorer-v1, design §4.2/§9). Mirrors `terminalTheme.ts`: Monaco wants
 * concrete color STRINGS (it cannot consume a CSS variable), so the viewer reads the computed
 * token values once and passes them here. Keeping the mapping pure (token reader → theme data)
 * makes it unit-testable in the vitest node env with NO Monaco/DOM import (the `.ts`/`.test.ts`
 * split) — the impure `editor.defineTheme` call lives in the viewer component.
 *
 * The editor surface must sit on the SAME `--card` tone as the xterm beside it (so the split
 * reads as one product), with the gutter/line-numbers in `--muted-foreground` and the selection
 * on `--accent`. An empty/missing token degrades to the dark-theme default so a malformed
 * stylesheet never yields an off-palette editor.
 */

import { monacoLanguageOf } from './fileGlyph'

/** A token reader: given a CSS custom-property name, return its value (possibly empty). */
export type TokenReader = (name: string) => string

/** The cosmos-dark Monaco theme name registered via `editor.defineTheme`. */
export const COSMOS_MONACO_THEME = 'cosmos-dark'

/** The minimal shape of Monaco's `IStandaloneThemeData` this module produces. Declared
 * locally so the pure module imports nothing from `monaco-editor` (keeps it node-testable). */
export interface MonacoThemeData {
  base: 'vs-dark'
  inherit: true
  rules: never[]
  colors: Record<string, string>
}

/** Dark-theme defaults (`.dark` tokens) — the safe fallback when a token is missing. */
const FALLBACK = {
  card: '#1b1b1c',
  foreground: '#e0e0e0',
  mutedForeground: '#888888',
  accent: '#2d2d30',
  border: '#333333'
} as const

/** Trim a token value, falling back to `dflt` when empty/whitespace-only. */
function tok(read: TokenReader, name: string, dflt: string): string {
  const v = (read(name) || '').trim()
  return v || dflt
}

/**
 * Build the `cosmos-dark` Monaco theme data from the cosmos surface tokens. `--card` →
 * editor background (matches the xterm-on-`--card` surface), `--foreground` → text,
 * `--muted-foreground` → line numbers / gutter, `--accent` → selection, `--border` → the
 * indent guide. Inherits from `vs-dark` so any color not set here keeps a sane dark default.
 * Pure.
 */
export function buildCosmosMonacoTheme(read: TokenReader): MonacoThemeData {
  const card = tok(read, '--card', FALLBACK.card)
  const foreground = tok(read, '--foreground', FALLBACK.foreground)
  const mutedForeground = tok(read, '--muted-foreground', FALLBACK.mutedForeground)
  const accent = tok(read, '--accent', FALLBACK.accent)
  const border = tok(read, '--border', FALLBACK.border)
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': card,
      'editor.foreground': foreground,
      'editorLineNumber.foreground': mutedForeground,
      'editorLineNumber.activeForeground': foreground,
      'editor.selectionBackground': accent,
      'editor.inactiveSelectionBackground': accent,
      'editorIndentGuide.background1': border,
      'editorGutter.background': card,
      'editorWidget.background': card,
      'editor.lineHighlightBackground': card
    }
  }
}

/**
 * The read-only viewer's Monaco editor construction options (file-viewer-color-wrap-v1, #94).
 * Pulled out of the `FileViewer` component so the load-bearing settings — notably
 * `wordWrap: 'on'` (soft word-wrap, so long lines wrap to the viewport instead of forcing a
 * horizontal scrollbar, #94 fix 2) — are PURE and node-testable (no Monaco/DOM import). The
 * component spreads this over `{ value, theme }` and calls `monaco.editor.create`. The fields
 * mirror Monaco's `IStandaloneEditorConstructionOptions` but are typed locally so the module
 * stays import-free (the `.ts`/`.test.ts` split).
 */
export interface ViewerEditorOptions {
  language: string
  readOnly: true
  domReadOnly: true
  /** 'on' = soft word-wrap to the viewport width (#94). */
  wordWrap: 'on' | 'off'
  minimap: { enabled: boolean }
  lineNumbers: 'on' | 'off'
  scrollBeyondLastLine: boolean
  automaticLayout: boolean
  renderWhitespace: 'none'
  fontFamily: string
  fontSize: number
  /**
   * monaco-worker-missing-method-v1: the three editor features that delegate their compute to a
   * LANGUAGE worker (json/css/html) via `getWorker(_, label)`. Our `MonacoEnvironment.getWorker`
   * returns the BASE editor worker for EVERY label (read-only viewer, one small worker — no
   * ts/json/css/html language workers), and the base worker does NOT implement `getFoldingRanges`
   * / `findDocumentLinks` / `findDocumentSymbols`. So when the full `monaco-editor` barrel's
   * json/css/html modes register their folding / link / document-symbol providers and these
   * DEFAULT-ON features fire them on a matching model, the provider calls the base worker for a
   * method it lacks → "Missing requestHandler or method: …" console spam. A read-only viewer needs
   * none of code-folding, link detection, or the sticky-scroll outline, so we turn them OFF at the
   * source (never asking the worker) rather than shipping the heavier language workers. Syntax
   * highlighting is UNAFFECTED — monarch tokenizers run on the main thread, not the worker.
   */
  folding: boolean
  links: boolean
  stickyScroll: { enabled: boolean }
}

/** Build the viewer's editor options for a file at `relPath`. Pure. */
export function buildViewerEditorOptions(relPath: string): ViewerEditorOptions {
  return {
    language: monacoLanguageOf(relPath),
    readOnly: true,
    domReadOnly: true,
    // #94 fix 2: soft word-wrap — long lines wrap instead of scrolling horizontally.
    wordWrap: 'on',
    minimap: { enabled: false },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderWhitespace: 'none',
    fontFamily: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
    fontSize: 13,
    // monaco-worker-missing-method-v1: disable the worker-backed language features (see interface).
    folding: false,
    links: false,
    stickyScroll: { enabled: false }
  }
}
