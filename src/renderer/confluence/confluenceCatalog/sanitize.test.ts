import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { sanitizeConfluenceHtml, emojiIdToGlyph, decodeUnicodeEscapes } from './sanitize'

/*
 * confluence-detail-rich-render-v1 — the XSS gate for Confluence page-detail HTML
 * (FR-008/SC-003). Pure-`.ts` test: DOMPurify needs a DOM `window`, so under the node-env
 * vitest config we pass a jsdom window — the SAME helper the renderer calls with the global
 * `window`. Asserts hostile markup is stripped and benign rich tags survive.
 */

const { window } = new JSDOM('')
const win = window as unknown as Parameters<typeof sanitizeConfluenceHtml>[1]

const sanitize = (html: unknown): string => sanitizeConfluenceHtml(html, win)

describe('sanitizeConfluenceHtml — strips hostile markup (FR-008/SC-003)', () => {
  it('removes <script> entirely (no XSS execution)', () => {
    const out = sanitize('<p>ok</p><script>alert(1)</script>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('ok')
  })

  it('removes <iframe>', () => {
    const out = sanitize('<p>ok</p><iframe src="https://evil.example"></iframe>')
    expect(out).not.toMatch(/<iframe/i)
    expect(out).toContain('ok')
  })

  it('strips inline on*= event handlers', () => {
    const out = sanitize('<p onclick="steal()">click</p>')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out).not.toContain('steal()')
    expect(out).toContain('click')
  })

  it('strips javascript: URLs from links', () => {
    // eslint-disable-next-line no-script-url
    const out = sanitize('<a href="javascript:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('drops <img> with a javascript: src (no XSS via emoji image)', () => {
    // eslint-disable-next-line no-script-url
    const out = sanitize('<img src="javascript:alert(1)" alt="x">')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).not.toContain('alert(1)')
  })

  it('strips onerror= off an allowed <img> (no XSS via emoji image)', () => {
    const out = sanitize('<img src="https://example.com/e.png" onerror="steal()">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).not.toContain('steal()')
  })

  it('blocks data: image src (data: stays a non-http(s) scheme)', () => {
    const out = sanitize('<img src="data:image/svg+xml,<svg onload=alert(1)>">')
    expect(out.toLowerCase()).not.toContain('data:')
    expect(out.toLowerCase()).not.toContain('alert(1)')
  })
})

describe('sanitizeConfluenceHtml — keeps benign rich tags (FR-007)', () => {
  it('preserves headings h1-h4', () => {
    const out = sanitize('<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>')
    expect(out).toMatch(/<h1[^>]*>A<\/h1>/)
    expect(out).toMatch(/<h2[^>]*>B<\/h2>/)
    expect(out).toMatch(/<h3[^>]*>C<\/h3>/)
    expect(out).toMatch(/<h4[^>]*>D<\/h4>/)
  })

  it('preserves lists (ul/ol/li)', () => {
    const out = sanitize('<ul><li>one</li></ul><ol><li>two</li></ol>')
    expect(out).toMatch(/<ul[^>]*><li[^>]*>one<\/li><\/ul>/)
    expect(out).toMatch(/<ol[^>]*><li[^>]*>two<\/li><\/ol>/)
  })

  it('preserves tables', () => {
    const out = sanitize('<table><tbody><tr><td>cell</td></tr></tbody></table>')
    expect(out).toMatch(/<table/i)
    expect(out).toMatch(/<td[^>]*>cell<\/td>/)
  })

  it('preserves a[href] for safe http(s) links', () => {
    const out = sanitize('<a href="https://example.com">link</a>')
    expect(out).toMatch(/<a[^>]*href="https:\/\/example\.com"[^>]*>link<\/a>/)
  })

  it('preserves code/pre blocks', () => {
    const out = sanitize('<pre><code>const x = 1</code></pre>')
    expect(out).toMatch(/<pre[^>]*><code[^>]*>const x = 1<\/code><\/pre>/)
  })

  it('preserves blockquote, emphasis, and hr', () => {
    const out = sanitize('<blockquote>q</blockquote><strong>s</strong><em>e</em><hr>')
    expect(out).toMatch(/<blockquote[^>]*>q<\/blockquote>/)
    expect(out).toMatch(/<strong[^>]*>s<\/strong>/)
    expect(out).toMatch(/<em[^>]*>e<\/em>/)
    expect(out).toMatch(/<hr/)
  })
})

describe('emojiIdToGlyph — decode hex codepoint id to a Unicode glyph (re-open)', () => {
  it('decodes a single codepoint id', () => {
    expect(emojiIdToGlyph('1f5d3')).toBe('\u{1F5D3}') // 🗓 spiral calendar
    expect(emojiIdToGlyph('1f600')).toBe('\u{1F600}') // 😀
  })

  it('decodes a compound/flag id (hyphen-separated codepoints)', () => {
    expect(emojiIdToGlyph('1f1fa-1f1f8')).toBe('\u{1F1FA}\u{1F1F8}') // 🇺🇸
  })

  it('is case-insensitive on hex digits', () => {
    expect(emojiIdToGlyph('1F5D3')).toBe('\u{1F5D3}')
  })

  it('returns null for a non-hex / garbage id', () => {
    expect(emojiIdToGlyph('zzz')).toBeNull()
    expect(emojiIdToGlyph('blue-star')).toBeNull()
    expect(emojiIdToGlyph('')).toBeNull()
    expect(emojiIdToGlyph('  ')).toBeNull()
    expect(emojiIdToGlyph(undefined)).toBeNull()
    expect(emojiIdToGlyph(null)).toBeNull()
  })

  it('returns null for out-of-range / surrogate codepoints', () => {
    expect(emojiIdToGlyph('110000')).toBeNull() // > 0x10FFFF
    expect(emojiIdToGlyph('d800')).toBeNull() // lone surrogate
  })
})

describe('decodeUnicodeEscapes — literal \\uXXXX escape text → real chars (re-open)', () => {
  it('decodes a surrogate-pair escape into its astral glyph', () => {
    expect(decodeUnicodeEscapes('\\uD83D\\uDC65')).toBe('\u{1F465}') // 👥
    expect(decodeUnicodeEscapes('\\uD83E\\uDD45 Goals')).toBe('\u{1F945} Goals') // 🥅
  })

  it('decodes a BMP escape', () => {
    expect(decodeUnicodeEscapes('\\u00e9')).toBe('é')
  })

  it('is case-insensitive and leaves surrounding text intact', () => {
    expect(decodeUnicodeEscapes('a\\uD83D\\uDC65b')).toBe('a\u{1F465}b')
  })

  it('returns non-escape text verbatim', () => {
    expect(decodeUnicodeEscapes('plain text')).toBe('plain text')
    expect(decodeUnicodeEscapes('')).toBe('')
    expect(decodeUnicodeEscapes(undefined)).toBe('')
    expect(decodeUnicodeEscapes(null)).toBe('')
  })

  it('does not touch malformed (non-4-hex) escapes', () => {
    expect(decodeUnicodeEscapes('\\uZZZZ')).toBe('\\uZZZZ')
    expect(decodeUnicodeEscapes('\\u12')).toBe('\\u12')
  })
})

describe('sanitizeConfluenceHtml — emoji & task checkboxes (confluence-detail-emoji-checkbox-stripped-v1)', () => {
  it('decodes literal \\uXXXX emoji text in element content to a real glyph (re-open)', () => {
    // Confluence emits SOME emoji not as <img> but as literal escape text in a heading.
    const out = sanitize('<h2>\\uD83D\\uDC65 Participants</h2>')
    expect(out).toContain('\u{1F465} Participants') // 👥 Participants
    expect(out).not.toContain('\\uD83D') // no literal escaped-string text survives
  })


  it('converts an emoticon <img data-emoji-id> to its Unicode glyph (no broken image)', () => {
    const out = sanitize(
      '<p><img class="emoticon emoticon-calendar_spiral" data-emoji-id="1f5d3" ' +
        'data-emoji-shortname=":calendar_spiral:" data-emoji-fallback="\\uD83D\\uDDD3" ' +
        'src="/wiki/s/-1224781331/64/abc.png"></p>'
    )
    expect(out).toContain('\u{1F5D3}') // 🗓 real glyph
    expect(out).not.toMatch(/<img/i) // emoticon image removed
    expect(out).not.toContain('/wiki/s/') // no relative authed src leaks through
    expect(out).not.toContain('\\uD83D') // no literal escaped-string text
  })

  it('converts a compound/flag emoticon <img> to its multi-codepoint glyph', () => {
    const out = sanitize(
      '<img class="emoticon" data-emoji-id="1f1fa-1f1f8" data-emoji-shortname=":flag_us:" ' +
        'src="/wiki/s/flag.png">'
    )
    expect(out).toContain('\u{1F1FA}\u{1F1F8}') // 🇺🇸
    expect(out).not.toMatch(/<img/i)
  })

  it('degrades an undecodable emoticon <img> to its shortname/alt (never a broken image)', () => {
    // Legacy Atlassian-only emoticon: no data-emoji-id, no Unicode equivalent.
    const out = sanitize(
      '<img class="emoticon emoticon-blue-star" alt="(blue star)" src="/wiki/s/blue-star.png">'
    )
    expect(out).not.toMatch(/<img/i)
    expect(out).not.toContain('/wiki/s/')
    expect(out).toContain('(blue star)')
  })

  it('degrades to shortname when only data-emoji-shortname is present (no id, no alt)', () => {
    const out = sanitize(
      '<img class="emoticon" data-emoji-shortname=":calendar_spiral:" src="/wiki/s/x.png">'
    )
    expect(out).not.toMatch(/<img/i)
    expect(out).toContain(':calendar_spiral:')
  })

  it('keeps a task-list checkbox <input type="checkbox" checked> with its checked state', () => {
    const out = sanitize(
      '<ul class="inline-task-list"><li><input type="checkbox" checked> task</li></ul>'
    )
    expect(out).toMatch(/<input[^>]*>/i)
    expect(out).toMatch(/type="checkbox"/)
    expect(out).toMatch(/checked/)
    expect(out).toContain('task')
  })

  it('forces task checkboxes inert (disabled — display-only, not toggleable)', () => {
    // Source markup with NO disabled attr: the hook must add it (read-only viewer).
    const out = sanitize('<input type="checkbox" checked>')
    expect(out).toMatch(/disabled/)
  })
})

describe('sanitizeConfluenceHtml — content/attachment images (confluence-content-images-v1)', () => {
  it('rewrites a relative /wiki content <img src> to the opaque proxy scheme (not dropped)', () => {
    const out = sanitize(
      '<p><img src="/wiki/download/attachments/123/picture.png" alt="pic"></p>'
    )
    // The content image survives as an <img> ...
    expect(out).toMatch(/<img/i)
    // ... with its src rewritten to the opaque main-process scheme (no token, no host) ...
    expect(out).toMatch(/src="cosmos-confluence-img:\/\/confluence\/[A-Za-z0-9_-]+"/)
    // ... and the original relative authed path no longer leaks into the DOM.
    expect(out).not.toContain('/wiki/download/attachments/123/picture.png')
  })

  it('rewrites an embedded ATTACHMENT <img> to an attachment-id ref, NOT the legacy blob path (confluence-attachment-scope-v1)', () => {
    // The real failing-page markup: a LEGACY /wiki/download/attachments URL (which 401s under
    // granular scopes) carrying data-linked-resource-id (the attachment id).
    const out = sanitize(
      '<p><img class="confluence-embedded-image"' +
        ' src="https://cosmos-works.atlassian.net/wiki/download/attachments/65822/recently_updated.svg?version=1&amp;api=v2"' +
        ' data-linked-resource-id="65846" data-linked-resource-type="attachment"></p>'
    )
    // Survives as an <img> with the opaque proxy scheme ...
    expect(out).toMatch(/<img/i)
    const m = out.match(/src="cosmos-confluence-img:\/\/confluence\/([A-Za-z0-9_-]+)"/)
    expect(m).not.toBeNull()
    // ... whose encoded ref carries the ATTACHMENT ID (attachment:65846), not the legacy path.
    const decoded = Buffer.from(
      m![1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8')
    expect(decoded).toBe('attachment:65846')
    // The legacy blob URL must NOT leak into the DOM or the ref.
    expect(out).not.toContain('/wiki/download/attachments/65822')
    expect(out).not.toContain('cosmos-works.atlassian.net')
  })

  it('rewrites an absolute *.atlassian.net /wiki <img> to the opaque scheme', () => {
    const out = sanitize(
      '<img src="https://my-site.atlassian.net/wiki/download/attachments/9/a.png">'
    )
    expect(out).toMatch(/src="cosmos-confluence-img:\/\/confluence\/[A-Za-z0-9_-]+"/)
    expect(out).not.toContain('my-site.atlassian.net')
  })

  it('leaves an absolute non-Confluence <img src> untouched (FR-008, not proxied)', () => {
    const out = sanitize('<img src="https://example.com/x.png" alt="ext">')
    expect(out).toContain('https://example.com/x.png')
    expect(out).not.toContain('cosmos-confluence-img:')
  })

  it('still strips a data: image src (FR-007 hardening intact, not rewritten)', () => {
    const out = sanitize('<img src="data:image/svg+xml,<svg onload=alert(1)>">')
    expect(out.toLowerCase()).not.toContain('data:')
    expect(out).not.toContain('cosmos-confluence-img:')
    expect(out.toLowerCase()).not.toContain('alert(1)')
  })

  it('does not regress emoticon → glyph (emoticon img is replaced, never proxied)', () => {
    const out = sanitize(
      '<img class="emoticon" data-emoji-id="1f5d3" src="/wiki/s/-1224781331/64/abc.png">'
    )
    expect(out).toContain('\u{1F5D3}') // 🗓 glyph
    expect(out).not.toMatch(/<img/i)
    expect(out).not.toContain('cosmos-confluence-img:')
    expect(out).not.toContain('/wiki/s/')
  })

  it('still strips a javascript: img src (no XSS via the widened allow-list)', () => {
    // eslint-disable-next-line no-script-url
    const out = sanitize('<img src="javascript:alert(1)" alt="x">')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).not.toContain('cosmos-confluence-img:')
  })
})

describe('sanitizeConfluenceHtml — safe degradation (FR-012)', () => {
  it('returns "" for an empty body', () => {
    expect(sanitize('')).toBe('')
  })

  it('returns "" for a non-string body (never throws)', () => {
    expect(sanitize(undefined)).toBe('')
    expect(sanitize(null)).toBe('')
    expect(sanitize(42)).toBe('')
  })
})
