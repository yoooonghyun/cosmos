/**
 * sanitize — the single XSS gate for Confluence page-detail HTML
 * (confluence-detail-rich-render-v1, FR-008/SC-003). `ConfluencePageDetail.body` carries
 * RAW, UNTRUSTED Confluence `body-format=view` HTML; this helper sanitizes it with
 * DOMPurify BEFORE the catalog/native `PageDetail` injects it via
 * `dangerouslySetInnerHTML`. This is the one place the project relaxes the no-raw-HTML
 * rule, and it is gated entirely on this function running first.
 *
 * Extracted into a pure `.ts` (no React, no JSX) so the sanitization decisions are
 * node-testable under the node-env vitest config. DOMPurify needs a DOM `window`:
 *   - in the RENDERER (browser DOM) the default global `window` is used — call
 *     `sanitizeConfluenceHtml(html)`;
 *   - in NODE (the unit test) there is no global `window`, so the caller passes a
 *     jsdom window — `sanitizeConfluenceHtml(html, new JSDOM('').window)` — and the
 *     SAME code path runs. DOMPurify v3's default export is a FACTORY: `DOMPurify(win)`
 *     returns an instance bound to that window's DOM whose `.sanitize()` strips hostile
 *     markup. Pure; never throws (a non-string body degrades to '').
 */

import DOMPurify, { type WindowLike } from 'dompurify'
import { decodeUnicodeEscapes } from '../../shared/types/confluence'
import {
  attachmentIdOf,
  confluenceRelativePath,
  toAttachmentOpaqueSrc,
  toOpaqueSrc
} from './contentImageSrc'

export { decodeUnicodeEscapes }

/**
 * Decode a Confluence emoji `data-emoji-id` into its real Unicode glyph
 * (confluence-detail-emoji-checkbox-stripped-v1 re-open). The id is one or more hex
 * Unicode codepoints, hyphen-separated for compound/flag emoji:
 *   `1f5d3`        → 🗓  (single codepoint)
 *   `1f1fa-1f1f8`  → 🇺🇸 (regional-indicator flag, two codepoints)
 * Returns `null` for an absent / malformed / out-of-range id (e.g. legacy
 * Atlassian-only emoticons like `emoticon-blue-star` that carry no Unicode id) so the
 * caller can degrade to a shortname/alt rather than emit a broken glyph. Pure; no throw.
 */
export function emojiIdToGlyph(id: unknown): string | null {
  if (typeof id !== 'string' || id.trim() === '') {
    return null
  }
  const parts = id.trim().split('-')
  const codepoints: number[] = []
  for (const part of parts) {
    // Each part must be pure hex; reject anything else (e.g. "zzz", "blue-star").
    if (!/^[0-9a-f]+$/i.test(part)) {
      return null
    }
    const cp = parseInt(part, 16)
    // Valid Unicode scalar range, excluding surrogate halves (which fromCodePoint rejects).
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return null
    }
    codepoints.push(cp)
  }
  if (codepoints.length === 0) {
    return null
  }
  try {
    return String.fromCodePoint(...codepoints)
  } catch {
    return null
  }
}

/**
 * The DOMPurify allow-list config for Confluence rich body (FR-007). Permits the benign
 * structural/typographic tags a page authors with (headings, lists, tables, links, code,
 * emphasis, quotes, rules) and strips everything else. `<script>`/`<iframe>`/`on*=`
 * handlers/`javascript:` URLs are removed by DOMPurify's defaults regardless; the
 * allow-list further drops unknown/dynamic-macro markup to inert text (FR-012).
 *
 * `img` + `input` are allow-listed for benign Confluence `body-format=view` markup
 * (bug confluence-detail-emoji-checkbox-stripped-v1): emoji/emoticons render as
 * `<img class="emoticon" src="https://…" alt="(smile)" data-emoji-*>` and task-list
 * checkboxes as `<input type="checkbox" checked>`. The `<img src>` stays constrained to
 * http(s)/relative by ALLOWED_URI_REGEXP (no `javascript:`/`data:` vectors). Task
 * checkboxes are forced inert (display-only) by the `afterSanitizeAttributes` hook below.
 */
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a',
    'code', 'pre',
    'blockquote',
    'strong', 'em', 'b', 'i', 'u', 's',
    'span', 'div',
    // emoji image + task-list checkbox (confluence-detail-emoji-checkbox-stripped-v1)
    'img', 'input'
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'colspan', 'rowspan',
    // emoji <img>: src/alt/dimensions + class for catalog (prose-cosmos) styling
    'src', 'alt', 'class', 'width', 'height',
    // task-list <input>: render the checkbox + its checked/inert state (forced inert below)
    'type', 'checked', 'disabled',
    // Confluence emoji metadata (benign data-* the emoji <img> carries)
    'data-emoji-id', 'data-emoji-shortname', 'data-emoji-fallback', 'data-emoji-short-name',
    // Confluence attachment metadata (confluence-attachment-scope-v1): the embedded
    // attachment <img> carries `data-linked-resource-id` (the attachment id) +
    // `data-linked-resource-type="attachment"`. The hook reads these to encode the
    // granular-scope attachment-id opaque ref, so they MUST survive DOMPurify's attribute
    // allow-list (the hook runs AFTER attribute filtering). Benign ids/strings; no URL/script.
    'data-linked-resource-id', 'data-linked-resource-type'
  ],
  // Block any URL scheme that is not http/https/mailto/relative/cosmos-confluence-img —
  // defeats javascript:. The `cosmos-confluence-img:` scheme is allowed DELIBERATELY (and
  // scoped to that exact scheme) so the content-image rewrite below can swap a content
  // `<img src>` to the opaque main-process proxy scheme (confluence-content-images-v1); it
  // carries no token and no host, only an opaque base64url `/wiki/...` ref.
  // NOTE: DOMPurify still permits `data:` URIs on media tags (img/audio/video/…) by its
  // own internal allow-list REGARDLESS of this regexp, so `data:` on `<img src>` is
  // additionally stripped by the hook below (a `data:image/svg+xml` payload can carry an
  // inline-script SVG — an XSS vector — so it must NOT survive).
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|cosmos-confluence-img):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i
}

/**
 * Per-instance DOMPurify hook enforcing two read-only-viewer guarantees that the static
 * allow-list cannot express (confluence-detail-emoji-checkbox-stripped-v1):
 *
 *  1. Task-list checkboxes are DISPLAY-ONLY. Every surviving `<input>` is forced
 *     `disabled` so a rendered checkbox shows its `checked` state but is never toggleable
 *     or focusable — there is no write path. Confluence does not always emit `disabled`
 *     itself, so we add it unconditionally rather than trusting the source markup.
 *  2. No `data:` URLs on `<img src>`. DOMPurify's media-tag data-URI allowance bypasses
 *     `ALLOWED_URI_REGEXP`, so we drop any `src` (or `href`) whose scheme is `data:` to
 *     close the `data:image/svg+xml` inline-script vector. Emoji images are always
 *     http(s) URLs, so this costs nothing legitimate.
 *  3. Emoticon `<img>` → Unicode glyph (re-open fix). Confluence emits emoji as an
 *     emoticon image whose `src` is RELATIVE + behind auth, so in the renderer it 404s to
 *     a broken-image icon and its `data-emoji-fallback` shows as literal escaped text.
 *     We replace each emoticon `<img>` with its real glyph decoded from `data-emoji-id`
 *     (offline, no network/auth), degrading to `data-emoji-shortname`/`alt` when the id is
 *     absent/undecodable — never leaving a broken image.
 *
 * Registered once per purifier instance.
 */

/** True for a Confluence emoji/emoticon `<img>` (class contains `emoticon`, or carries a
 * `data-emoji-id`). Content/attachment images do NOT match, so they are untouched here. */
function isEmoticonImg(el: Element): boolean {
  if (el.tagName !== 'IMG') {
    return false
  }
  if (el.getAttribute('data-emoji-id')) {
    return true
  }
  const cls = el.getAttribute('class') ?? ''
  return /(^|\s)emoticon(\s|-|$)/.test(cls)
}

/** The text an emoticon `<img>` should collapse to: the decoded glyph, else its
 * shortname, else its alt, else '' (drop). Never returns a broken-image placeholder. */
function emoticonReplacementText(el: Element): string {
  const glyph = emojiIdToGlyph(el.getAttribute('data-emoji-id'))
  if (glyph) {
    return glyph
  }
  const shortname =
    el.getAttribute('data-emoji-shortname') ?? el.getAttribute('data-emoji-short-name')
  if (shortname && shortname.trim() !== '') {
    return shortname
  }
  const alt = el.getAttribute('alt')
  return alt && alt.trim() !== '' ? alt : ''
}

function registerSanitizeHook(instance: ReturnType<typeof DOMPurify>): void {
  instance.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    // Decode literal `\uXXXX` escapes in this element's direct text children. Every text
    // node is some element's child and DOMPurify visits every element exactly once, so all
    // text is covered. Fixes emoji emitted as literal escape text (👥 → 👥) rather
    // than as emoticon <img>.
    const children = el.childNodes
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.nodeType === 3 && typeof child.nodeValue === 'string' && child.nodeValue.includes('\\u')) {
          child.nodeValue = decodeUnicodeEscapes(child.nodeValue)
        }
      }
    }
    if (el.tagName === 'INPUT') {
      el.setAttribute('disabled', '')
    }
    for (const attr of ['src', 'href'] as const) {
      const value = el.getAttribute?.(attr)
      if (value && /^\s*data:/i.test(value)) {
        el.removeAttribute(attr)
      }
    }
    // Emoticon <img> → real Unicode glyph (or shortname/alt fallback). Replace the node
    // in place so no broken authed/relative image is ever emitted.
    if (isEmoticonImg(el) && el.parentNode) {
      const text = emoticonReplacementText(el)
      const doc = el.ownerDocument
      const replacement = doc.createTextNode(text)
      el.parentNode.replaceChild(replacement, el)
      return
    }
    // Content/attachment <img> → opaque main-process proxy scheme
    // (confluence-content-images-v1). A real page picture's `src` is a relative, auth-gated
    // Confluence URL that 404s/401s in the renderer because the access token is main-only.
    // Rewrite it to `cosmos-confluence-img://...` (carrying ONLY an opaque base64url ref — no
    // token, no host), which the main-process protocol handler fetches with the bearer token
    // and streams back. Runs AFTER DOMPurify + AFTER the `data:`-strip, so `data:`/emoticon
    // images never reach here. The opaque scheme is allow-listed in ALLOWED_URI_REGEXP above.
    //
    // PREFER the attachment-id ref (confluence-attachment-scope-v1): Confluence embeds an
    // attachment with a LEGACY `/wiki/download/attachments/...` blob URL that 401s under
    // granular OAuth scopes ("scope does not match" — classic content endpoint). The `<img>`
    // also carries `data-linked-resource-id`, so when present we encode `attachment:<id>` and
    // let main resolve the bytes via the granular-authorized v2 attachments API. Fall back to
    // the relative-path ref for any non-attachment `/wiki/...` content image. An absolute
    // non-Confluence `src` returns null on both → left untouched (FR-008).
    if (el.tagName === 'IMG') {
      const attachmentId = attachmentIdOf(el)
      if (attachmentId !== null) {
        el.setAttribute('src', toAttachmentOpaqueSrc(attachmentId))
      } else {
        const relativePath = confluenceRelativePath(el.getAttribute('src'))
        if (relativePath !== null) {
          el.setAttribute('src', toOpaqueSrc(relativePath))
        }
      }
    }
  })
}

/**
 * The DOMPurify instance for the active window. In the renderer this resolves once to the
 * global `window`-bound instance. A per-window instance is cached so repeated detail
 * renders don't rebuild it.
 */
let cached: { win: WindowLike | undefined; instance: ReturnType<typeof DOMPurify> } | null = null

function purifierFor(win?: WindowLike): ReturnType<typeof DOMPurify> {
  // In the renderer, the default export is already bound to the global window — call it
  // with no arg. In node, the caller passes a jsdom window to bind a DOM.
  const root = win ?? (typeof window !== 'undefined' ? (window as unknown as WindowLike) : undefined)
  if (cached && cached.win === root) {
    return cached.instance
  }
  const instance = root ? DOMPurify(root) : DOMPurify
  registerSanitizeHook(instance)
  cached = { win: root, instance }
  return instance
}

/**
 * Sanitize raw Confluence `body-format=view` HTML to a safe HTML string for
 * `dangerouslySetInnerHTML` (FR-008). Strips `<script>`/`<iframe>`/`on*=` handlers/
 * `javascript:` URLs while keeping benign rich tags (FR-007). A non-string / absent body
 * degrades to `''` (FR-012) — never throws.
 *
 * @param html  the raw Confluence view HTML (or anything; non-string → '').
 * @param win   an optional DOM window (jsdom in node tests); defaults to the renderer's
 *              global `window`.
 */
export function sanitizeConfluenceHtml(html: unknown, win?: WindowLike): string {
  if (typeof html !== 'string' || html === '') {
    return ''
  }
  return purifierFor(win).sanitize(html, SANITIZE_CONFIG)
}
