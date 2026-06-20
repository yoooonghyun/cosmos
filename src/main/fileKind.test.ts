import { describe, it, expect } from 'vitest'
import { classifyFile, extensionOf, isImageExtension, looksLikeText } from './fileKind'

/*
 * fileKind — PURE previewability classification (terminal-file-explorer-v1, FR-009/010/011/
 * 012, SC-002/SC-008). NO size-cap test — there is no file-content size cap (FR-012); a
 * large file is still classified/read, never refused for size.
 */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('extensionOf', () => {
  it('returns the lower-cased extension of a file name', () => {
    expect(extensionOf('Index.TS')).toBe('ts')
    expect(extensionOf('photo.PNG')).toBe('png')
    expect(extensionOf('a/b/c.tar.gz')).toBe('gz')
  })
  it('returns "" for a dotfile or a no-extension name', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('.env')).toBe('')
    expect(extensionOf('Makefile')).toBe('')
  })
  it('returns "" for non-strings', () => {
    expect(extensionOf(undefined)).toBe('')
  })
})

describe('isImageExtension', () => {
  it('matches every supported image type (case-insensitive)', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']) {
      expect(isImageExtension(`pic.${ext}`)).toBe(true)
      expect(isImageExtension(`pic.${ext.toUpperCase()}`)).toBe(true)
    }
  })
  it('rejects non-image extensions', () => {
    expect(isImageExtension('a.txt')).toBe(false)
    expect(isImageExtension('a.tiff')).toBe(false) // not in the supported set
    expect(isImageExtension('Makefile')).toBe(false)
  })
})

describe('looksLikeText', () => {
  it('treats UTF-8 text (incl. unicode) as text', () => {
    expect(looksLikeText(enc('hello world\n'))).toBe(true)
    expect(looksLikeText(enc('日本語 — café ✓'))).toBe(true)
  })
  it('treats an empty buffer as text', () => {
    expect(looksLikeText(new Uint8Array())).toBe(true)
  })
  it('treats a NUL byte as binary', () => {
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false)
  })
  it('treats invalid UTF-8 as binary', () => {
    // Lone continuation byte 0x80 / truncated sequence 0xff is not valid UTF-8.
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x00]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0x80]))).toBe(false)
  })
})

describe('classifyFile', () => {
  it('classifies a supported image by EXTENSION regardless of bytes', () => {
    // Even with binary-looking bytes, an image extension is `image` (streamed, not sniffed).
    expect(classifyFile('logo.png', new Uint8Array([0x00, 0x01, 0x02]))).toBe('image')
    expect(classifyFile('icon.svg', enc('<svg/>'))).toBe('image')
  })
  it('classifies UTF-8 text as text', () => {
    expect(classifyFile('main.ts', enc('export const x = 1\n'))).toBe('text')
    expect(classifyFile('README', enc('# title'))).toBe('text')
  })
  it('classifies binary non-image as binary (preview not available)', () => {
    expect(classifyFile('a.bin', new Uint8Array([0x00, 0xff, 0x10]))).toBe('binary')
  })
  it('does NOT refuse a large text file for size (no size cap, FR-012)', () => {
    const big = enc('x'.repeat(5_000_000)) // ~5 MB of text
    expect(classifyFile('big.log', big)).toBe('text')
  })
})
