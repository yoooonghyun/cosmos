/**
 * fileGlyph — PURE extension → (file-glyph kind, Monaco language id) mapping for the file
 * explorer (terminal-file-explorer-v1, design §2.2/§4.2). No React/DOM/Monaco import (the
 * `.ts`/`.test.ts` split) — the row component + the viewer pick a lucide icon by the returned
 * kind, and the viewer passes the language id to Monaco. A small, cohesive map per the design;
 * the DEFAULT (`'file'` glyph / `'plaintext'` language) is always an acceptable fallback.
 */

/** The glyph KIND a tree row / viewer header renders (mapped to a lucide icon by the view).
 * `'code'`→FileCode, `'image'`→FileImage, `'text'`→FileText, `'file'`→File (default). */
export type FileGlyphKind = 'code' | 'image' | 'text' | 'file'

/** Code-ish extensions → the `FileCode` glyph (design §2.2). */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'less', 'html', 'htm',
  'py', 'rs', 'go', 'sh', 'bash', 'zsh', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc',
  'cs', 'rb', 'php', 'swift', 'yml', 'yaml', 'toml', 'xml', 'sql', 'vue', 'svelte'
])

/** The supported image extensions — mirror `fileKind.isImageExtension` in main (design §2.2). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])

/** Documentation/plain-text extensions → the `FileText` glyph. */
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'rst', 'log'])

/**
 * The lower-cased extension of a file name (no dot), or `''` for a dotfile / no-extension
 * name. Mirrors main's `fileKind.extensionOf` so the renderer + main agree on classification.
 * Pure.
 */
export function extensionOf(name: string): string {
  if (typeof name !== 'string') {
    return ''
  }
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  // A leading dot (dotfile) or no dot → no extension.
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

/** Classify a file name into the glyph KIND the row/header renders. Pure. */
export function fileGlyphKind(name: string): FileGlyphKind {
  const ext = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return 'code'
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text'
  }
  return 'file'
}

/**
 * The Monaco language id for a file name's extension, or `'plaintext'` when unknown (the safe
 * default — the viewer still renders, just without syntax highlighting). A small map covering
 * the common languages; Monaco's own monarch tokenizer runs on the main thread for these, so
 * no language worker is required for read-only highlighting. Pure.
 */
export function monacoLanguageOf(name: string): string {
  const ext = extensionOf(name)
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext'
}

/** Extension → Monaco language id. Kept beside the glyph map so they evolve together. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown'
}
