import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  attachmentIdOf,
  classifyImg,
  confluenceRelativePath,
  toAttachmentOpaqueSrc,
  toOpaqueSrc,
  encodeRelativePath,
  isEmoticonImgEl,
  COSMOS_CONFLUENCE_IMG_SCHEME,
  COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX
} from './contentImageSrc'

/*
 * confluence-content-images-v1 — pure classification + opaque-src rewrite for Confluence
 * content/attachment images. Node-env vitest; an `<img>` element is materialized from a jsdom
 * document so `classifyImg`/`isEmoticonImgEl` see a real Element. No DOM mutation here.
 */

const { window } = new JSDOM('')
const doc = window.document

/** Build an <img> element with the given attributes for classification. */
function img(attrs: Record<string, string>): Element {
  const el = doc.createElement('img')
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v)
  }
  return el
}

describe('confluenceRelativePath', () => {
  it('returns a relative /wiki/ path verbatim (path + query)', () => {
    expect(confluenceRelativePath('/wiki/download/attachments/123/x.png?version=2')).toBe(
      '/wiki/download/attachments/123/x.png?version=2'
    )
    expect(confluenceRelativePath('/wiki/s/-122/64...')).toBe('/wiki/s/-122/64...')
  })

  it('normalizes an absolute *.atlassian.net /wiki URL to its relative path', () => {
    expect(
      confluenceRelativePath('https://my-site.atlassian.net/wiki/download/attachments/9/a.png')
    ).toBe('/wiki/download/attachments/9/a.png')
    expect(
      confluenceRelativePath('https://my-site.atlassian.net/wiki/s/x/y.png?v=3')
    ).toBe('/wiki/s/x/y.png?v=3')
  })

  it('returns null for a relative path that is not under /wiki/', () => {
    expect(confluenceRelativePath('/download/attachments/1/x.png')).toBeNull()
    expect(confluenceRelativePath('/foo/bar.png')).toBeNull()
  })

  it('returns null for an absolute non-Confluence URL', () => {
    expect(confluenceRelativePath('https://example.com/x.png')).toBeNull()
    expect(confluenceRelativePath('https://evil.atlassian.net.attacker.com/wiki/x')).toBeNull()
  })

  it('returns null for protocol-relative, data:, empty, and non-string', () => {
    expect(confluenceRelativePath('//evil.example/wiki/x')).toBeNull()
    expect(confluenceRelativePath('data:image/png;base64,AAAA')).toBeNull()
    expect(confluenceRelativePath('')).toBeNull()
    expect(confluenceRelativePath('   ')).toBeNull()
    expect(confluenceRelativePath(undefined)).toBeNull()
    expect(confluenceRelativePath(null)).toBeNull()
    expect(confluenceRelativePath(42)).toBeNull()
  })
})

describe('classifyImg', () => {
  it('classifies an emoticon (data-emoji-id or class~=emoticon) as emoticon, not content', () => {
    expect(classifyImg(img({ 'data-emoji-id': '1f5d3', src: '/wiki/s/x/y' }))).toBe('emoticon')
    expect(classifyImg(img({ class: 'emoticon emoticon-smile', src: '/wiki/s/x/y' }))).toBe(
      'emoticon'
    )
  })

  it('classifies a relative /wiki content image as confluence-content', () => {
    expect(classifyImg(img({ src: '/wiki/download/attachments/123/pic.png' }))).toBe(
      'confluence-content'
    )
  })

  it('classifies an absolute *.atlassian.net /wiki image as confluence-content', () => {
    expect(
      classifyImg(img({ src: 'https://my-site.atlassian.net/wiki/download/attachments/9/a.png' }))
    ).toBe('confluence-content')
  })

  it('classifies an absolute non-Confluence URL as external (untouched)', () => {
    expect(classifyImg(img({ src: 'https://example.com/x.png' }))).toBe('external')
  })

  it('classifies a data: src as drop (not rewritten — already stripped upstream)', () => {
    expect(classifyImg(img({ src: 'data:image/svg+xml,<svg/>' }))).toBe('drop')
  })

  it('classifies a missing/empty src as drop', () => {
    expect(classifyImg(img({}))).toBe('drop')
    expect(classifyImg(img({ src: '' }))).toBe('drop')
    expect(classifyImg(img({ src: '   ' }))).toBe('drop')
  })

  it('returns drop for a non-img element', () => {
    expect(classifyImg(doc.createElement('div'))).toBe('drop')
  })
})

describe('isEmoticonImgEl', () => {
  it('matches data-emoji-id and class~=emoticon, not a plain content img', () => {
    expect(isEmoticonImgEl(img({ 'data-emoji-id': '1f5d3' }))).toBe(true)
    expect(isEmoticonImgEl(img({ class: 'emoticon' }))).toBe(true)
    expect(isEmoticonImgEl(img({ src: '/wiki/download/attachments/1/x.png' }))).toBe(false)
    expect(isEmoticonImgEl(doc.createElement('div'))).toBe(false)
  })
})

describe('attachmentIdOf (confluence-attachment-scope-v1)', () => {
  it('extracts the attachment id from an embedded attachment <img>', () => {
    // The real failing-page markup: a LEGACY download URL src + data-linked-resource-id.
    expect(
      attachmentIdOf(
        img({
          class: 'confluence-embedded-image',
          src: 'https://cosmos-works.atlassian.net/wiki/download/attachments/65822/recently_updated.svg?version=1&api=v2',
          'data-linked-resource-id': '65846',
          'data-linked-resource-type': 'attachment'
        })
      )
    ).toBe('65846')
  })

  it('accepts an attachment id when resource-type is absent (id alone suffices)', () => {
    expect(attachmentIdOf(img({ 'data-linked-resource-id': '777' }))).toBe('777')
  })

  it('returns null for a non-attachment linked resource', () => {
    expect(
      attachmentIdOf(img({ 'data-linked-resource-id': '5', 'data-linked-resource-type': 'page' }))
    ).toBeNull()
  })

  it('returns null for a missing / non-numeric id and non-img', () => {
    expect(attachmentIdOf(img({ src: '/wiki/download/attachments/1/x.png' }))).toBeNull()
    expect(attachmentIdOf(img({ 'data-linked-resource-id': 'abc' }))).toBeNull()
    expect(attachmentIdOf(img({ 'data-linked-resource-id': '' }))).toBeNull()
    expect(attachmentIdOf(doc.createElement('div'))).toBeNull()
  })
})

describe('toAttachmentOpaqueSrc (confluence-attachment-scope-v1 regression)', () => {
  it('encodes attachment:<id> — NOT the legacy /wiki/download/attachments path', () => {
    const out = toAttachmentOpaqueSrc('65846')
    const prefix = `${COSMOS_CONFLUENCE_IMG_SCHEME}://confluence/`
    expect(out.startsWith(prefix)).toBe(true)
    const seg = out.slice(prefix.length)
    expect(seg).toMatch(/^[A-Za-z0-9_-]+$/)
    // Decode the segment back and assert it carries the attachment id, not the legacy blob path.
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    expect(decoded).toBe(`${COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX}65846`)
    expect(decoded).not.toContain('/wiki/download/attachments/')
  })
})

describe('toOpaqueSrc / encodeRelativePath', () => {
  it('builds the opaque scheme URL with a base64url-encoded relative path', () => {
    const out = toOpaqueSrc('/wiki/download/attachments/123/x.png?version=2')
    expect(out.startsWith(`${COSMOS_CONFLUENCE_IMG_SCHEME}://confluence/`)).toBe(true)
    // base64url alphabet only, no padding.
    const seg = out.slice(`${COSMOS_CONFLUENCE_IMG_SCHEME}://confluence/`.length)
    expect(seg).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('round-trips a path through encode → base64url decode', () => {
    const path = '/wiki/s/-122/64/abc%20def/x.png?version=2'
    const encoded = encodeRelativePath(path)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = Buffer.from(b64, 'base64').toString('utf8')
    expect(decoded).toBe(path)
  })
})
