import { describe, it, expect } from 'vitest'
import { extensionOf, fileGlyphKind, monacoLanguageOf } from './fileGlyph'

/*
 * fileGlyph — PURE extension classification for the file explorer (terminal-file-explorer-v1,
 * design §2.2/§4.2). Node env, no React/Monaco. Proves the glyph kind + Monaco language id +
 * the dotfile/no-ext edge cases (mirroring main's fileKind.extensionOf).
 */

describe('extensionOf', () => {
  it('returns the lower-cased extension', () => {
    expect(extensionOf('Index.TS')).toBe('ts')
    expect(extensionOf('a/b/Photo.PNG')).toBe('png')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })
  it('returns "" for a dotfile or no-extension name', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('Makefile')).toBe('')
    expect(extensionOf('README')).toBe('')
  })
})

describe('fileGlyphKind', () => {
  it('maps code, image, and text families', () => {
    expect(fileGlyphKind('main.ts')).toBe('code')
    expect(fileGlyphKind('styles.css')).toBe('code')
    expect(fileGlyphKind('logo.svg')).toBe('image')
    expect(fileGlyphKind('photo.JPG')).toBe('image')
    expect(fileGlyphKind('notes.md')).toBe('text')
    expect(fileGlyphKind('changelog.txt')).toBe('text')
  })
  it('falls back to "file" for unknown / no extension', () => {
    expect(fileGlyphKind('data.bin')).toBe('file')
    expect(fileGlyphKind('Makefile')).toBe('file')
    expect(fileGlyphKind('.env')).toBe('file')
  })
})

describe('monacoLanguageOf', () => {
  it('maps common extensions to a Monaco language id', () => {
    expect(monacoLanguageOf('a.ts')).toBe('typescript')
    expect(monacoLanguageOf('a.tsx')).toBe('typescript')
    expect(monacoLanguageOf('a.py')).toBe('python')
    expect(monacoLanguageOf('a.rs')).toBe('rust')
    expect(monacoLanguageOf('a.json')).toBe('json')
    expect(monacoLanguageOf('a.yaml')).toBe('yaml')
  })
  it('falls back to plaintext for an unknown / no extension', () => {
    expect(monacoLanguageOf('a.bin')).toBe('plaintext')
    expect(monacoLanguageOf('Makefile')).toBe('plaintext')
  })
})
