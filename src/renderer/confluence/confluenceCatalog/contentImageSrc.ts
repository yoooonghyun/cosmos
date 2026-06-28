/**
 * contentImageSrc — pure classification + opaque-src rewrite for Confluence content
 * (attachment) images in the page-detail body (confluence-content-images-v1).
 *
 * A Confluence `body-format=view` body embeds real pictures as `<img>` whose `src` is a
 * relative, auth-gated Confluence URL (e.g. `/wiki/download/attachments/<id>/<file>` or
 * `/wiki/s/.../x.png`). The asset is behind Confluence auth whose access token lives only
 * in main, so the renderer cannot load it directly — it 404s to a broken image.
 *
 * This module is the RENDERER half: it classifies an `<img>` and rewrites a CONTENT image's
 * `src` to the opaque `cosmos-confluence-img://` scheme that the main-process protocol
 * handler resolves (fetching with the bearer token + streaming the bytes back). It does NOT
 * do DOM mutation, network, or hold any token — it only swaps a benign, already-sanitized
 * relative path for the opaque scheme. Pure + node-testable in isolation.
 *
 * The transform is invoked from the single sanitize gate (`sanitize.ts`) AFTER DOMPurify and
 * AFTER the emoticon-replacement / `data:`-strip / input-inert steps, so:
 *   - emoticons are already collapsed to glyphs (never reach here),
 *   - `data:` srcs are already stripped (FR-007 — never rewritten),
 *   - the one XSS gate still runs first.
 */

/** The custom privileged Electron scheme content images are rewritten to. Kept in sync with
 * the main-process protocol registration (`confluenceImageProtocol.ts`). */
export const COSMOS_CONFLUENCE_IMG_SCHEME = 'cosmos-confluence-img'

/** The fixed authority segment of an opaque content-image URL. The real Confluence host is
 * NEVER encoded into the reference — only an attachment id or a `/wiki/...` relative path is —
 * so a forged reference can never redirect the main-process fetch off the Confluence origin
 * (FR-011). */
export const COSMOS_CONFLUENCE_IMG_AUTHORITY = 'confluence'

/**
 * Prefix marking an opaque ref as an ATTACHMENT-ID ref (the granular-scope path). Confluence
 * embeds an attachment image with a LEGACY `/wiki/download/attachments/...` blob URL that 401s
 * under granular OAuth scopes ("scope does not match" — classic content endpoint, not authorized
 * by `read:attachment:confluence`). The `<img>` also carries `data-linked-resource-id` (the
 * attachment id), so we encode `attachment:<id>` instead and let main resolve the bytes via the
 * granular-authorized v2 attachments API (`GET /wiki/api/v2/attachments/{id}` → `downloadLink`).
 * The legacy relative-path ref (no prefix) is kept as a fallback for any non-attachment content
 * image whose `/wiki/...` src is granular-fetchable as-is. */
export const COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX = 'attachment:'

/**
 * How an `<img>` in a sanitized Confluence body is treated:
 *  - `emoticon`           — an emoji/emoticon image (handled upstream → glyph; never here).
 *  - `confluence-content` — a Confluence content/attachment image with a relative or
 *                           absolute-site `/wiki/...` src → rewrite to the opaque scheme.
 *  - `external`           — an absolute non-Confluence URL → leave untouched (FR-008).
 *  - `drop`               — no usable src, or a src that is neither (e.g. already `data:`,
 *                           already the opaque scheme) → do not rewrite.
 */
export type ImgClass = 'emoticon' | 'confluence-content' | 'external' | 'drop'

/** True for a Confluence emoji/emoticon `<img>` (carries `data-emoji-id`, or a class that
 * contains `emoticon`). Mirrors the emoticon detection in `sanitize.ts`; kept here so this
 * module classifies completely on its own (and the test can assert emoticons are NOT
 * content). */
export function isEmoticonImgEl(el: Element): boolean {
  if (el.tagName !== 'IMG') {
    return false
  }
  if (el.getAttribute('data-emoji-id')) {
    return true
  }
  const cls = el.getAttribute('class') ?? ''
  return /(^|\s)emoticon(\s|-|$)/.test(cls)
}

/**
 * Extract the Confluence-relative asset path (`/wiki/...`, path + query) from an `<img>`
 * `src`, or `null` when the src is not a Confluence content asset:
 *   - a relative `/wiki/...` src → returned verbatim (path + query).
 *   - an absolute Confluence-site URL `https://<site>.atlassian.net/wiki/...` → normalized to
 *     its `/wiki/...` path + query (the host is dropped; main re-resolves against the gateway
 *     base for the connected cloudId).
 *   - anything else (absolute non-Confluence, `data:`, the opaque scheme, empty) → `null`.
 *
 * Pure; never throws. Used by both `classifyImg` and the sanitize rewrite.
 */
export function confluenceRelativePath(src: unknown): string | null {
  if (typeof src !== 'string') {
    return null
  }
  const value = src.trim()
  if (value === '') {
    return null
  }
  // Relative, root-anchored Confluence path. Must start with `/wiki/` (not `//host`, not a
  // bare `/foo`); reject protocol-relative `//` outright.
  if (value.startsWith('/')) {
    return value.startsWith('/wiki/') ? value : null
  }
  // Absolute URL: only an *.atlassian.net `/wiki/...` is a Confluence asset; map it to its
  // relative path. Everything else is external (handled directly) — return null here.
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  if (!/(^|\.)atlassian\.net$/i.test(url.hostname)) {
    return null
  }
  if (!url.pathname.startsWith('/wiki/')) {
    return null
  }
  return `${url.pathname}${url.search}`
}

/**
 * Extract a Confluence attachment id from an `<img>`'s `data-linked-resource-id` when the
 * element is an embedded ATTACHMENT (`data-linked-resource-type="attachment"`). Returns the
 * numeric id string (e.g. `"65846"`) or `null` when absent/not-an-attachment/malformed. The id
 * is the key for the granular-scope v2 attachments fetch (so we never use the legacy
 * `/wiki/download/attachments/...` blob URL the `src` carries). Pure; never throws.
 */
export function attachmentIdOf(el: Element): string | null {
  if (!el || el.tagName !== 'IMG') {
    return null
  }
  const type = el.getAttribute('data-linked-resource-type')
  if (type !== null && type !== 'attachment') {
    // An explicitly non-attachment linked resource — not the v2-attachment path.
    return null
  }
  const id = el.getAttribute('data-linked-resource-id')
  if (typeof id !== 'string') {
    return null
  }
  const trimmed = id.trim()
  // Confluence attachment ids are positive integers; reject anything else (SSRF/path safety —
  // main double-checks, but keep the renderer ref clean).
  return /^[0-9]+$/.test(trimmed) ? trimmed : null
}

/**
 * Build the opaque content-image src for a Confluence attachment id (the granular-scope path).
 * Encodes `attachment:<id>` under the fixed authority — never a host, never a token, never the
 * legacy blob URL. Main decodes the id and resolves the bytes via the v2 attachments API.
 *
 * `cosmos-confluence-img://confluence/<base64url('attachment:<id>')>`
 */
export function toAttachmentOpaqueSrc(attachmentId: string): string {
  return `${COSMOS_CONFLUENCE_IMG_SCHEME}://${COSMOS_CONFLUENCE_IMG_AUTHORITY}/${encodeRelativePath(
    `${COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX}${attachmentId}`
  )}`
}

/**
 * Classify an `<img>` element for the content-image rewrite. Emoticons short-circuit to
 * `emoticon` (they are replaced upstream); a Confluence `/wiki/...` asset → `confluence-content`;
 * an absolute non-Confluence URL → `external`; anything without a usable Confluence path that
 * is also not external → `drop`. Pure; never throws.
 */
export function classifyImg(el: Element): ImgClass {
  if (!el || el.tagName !== 'IMG') {
    return 'drop'
  }
  if (isEmoticonImgEl(el)) {
    return 'emoticon'
  }
  const src = el.getAttribute('src')
  if (typeof src !== 'string' || src.trim() === '') {
    return 'drop'
  }
  if (confluenceRelativePath(src) !== null) {
    return 'confluence-content'
  }
  // An absolute http(s) URL that is not a Confluence asset → external (rendered directly).
  if (/^https?:\/\//i.test(src.trim())) {
    return 'external'
  }
  // `data:`, the opaque scheme, or any other relative path we don't proxy → drop (left to
  // the existing sanitize handling; not rewritten here).
  return 'drop'
}

/**
 * Build the opaque content-image src for a Confluence-relative asset path. The reference
 * encodes ONLY the relative path (base64url) under the fixed authority — never a host, never
 * a token — so the renderer/DOM only ever holds the opaque scheme (FR-002) and a forged
 * reference cannot escape the Confluence origin (FR-011, enforced again in main).
 *
 * `cosmos-confluence-img://confluence/<base64url(relativePath)>`
 */
export function toOpaqueSrc(relativePath: string): string {
  return `${COSMOS_CONFLUENCE_IMG_SCHEME}://${COSMOS_CONFLUENCE_IMG_AUTHORITY}/${encodeRelativePath(
    relativePath
  )}`
}

/**
 * base64url-encode a relative path for the opaque src. base64url (RFC 4648 §5: `-`/`_`, no
 * padding) is URL-safe and round-trips a path that already carries `%`-escapes and a query
 * string without nested-percent-encoding ambiguity. Uses `btoa` in the renderer; falls back
 * to a Buffer in node (tests) — both yield the same standard base64, then mapped to base64url.
 */
export function encodeRelativePath(relativePath: string): string {
  const utf8 = unescape(encodeURIComponent(relativePath))
  const b64 =
    typeof btoa === 'function'
      ? btoa(utf8)
      : Buffer.from(relativePath, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
