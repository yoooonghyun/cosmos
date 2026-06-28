/**
 * confluenceImageRef — the PURE codec + SSRF validator for the Confluence content-image
 * proxy (confluence-content-images-v1). No Electron import, so it is node-unit-testable in
 * isolation (the `.ts`/`.test.ts` split). The Electron wiring that USES these functions lives
 * in `confluenceImageProtocol.ts`.
 *
 * The renderer rewrites a content `<img src>` to
 * `cosmos-confluence-img://confluence/<base64url(ref)>` (see the renderer's
 * `contentImageSrc.ts`), where `ref` is ONE of:
 *   - `attachment:<id>` — the granular-scope path (confluence-attachment-scope-v1). The legacy
 *     `/wiki/download/attachments/...` blob URL Confluence embeds 401s under granular OAuth
 *     scopes ("scope does not match" — classic content endpoint). The `<img>` carries the
 *     attachment id (`data-linked-resource-id`), so we resolve the bytes via the
 *     granular-authorized v2 attachments API instead (`buildAttachmentMetaUrl` →
 *     `GET /wiki/api/v2/attachments/{id}` → its `downloadLink` → `buildDownloadUrl`).
 *   - a Confluence-relative `/wiki/...` path — the original path (kept for any non-attachment
 *     content image whose `/wiki/...` src is granular-fetchable as-is).
 * The reference encodes ONLY an attachment id or a `/wiki/...` path — never a host, never an
 * absolute URL, never a token. `decodeImageRef` decodes + classifies it and REJECTS (→ null)
 * anything that could escape the Confluence origin (FR-011 / SC-005 — SSRF-safe): a non-`/wiki`
 * path, an embedded scheme, a protocol-relative `//host`, a `..` traversal, a backslash, a
 * control char, or a non-numeric attachment id. `buildAssetUrl`/`buildAttachmentMetaUrl`/
 * `buildDownloadUrl` then append the validated value to the TRUSTED gateway base, fixing origin.
 */

import { confluenceApiBase } from '../integrations/atlassianConfig'

/** The privileged scheme. Kept in sync with the renderer's `COSMOS_CONFLUENCE_IMG_SCHEME`. */
export const COSMOS_CONFLUENCE_IMG_SCHEME = 'cosmos-confluence-img'

/** The fixed authority segment. The real Confluence host is never encoded into a reference. */
export const COSMOS_CONFLUENCE_IMG_AUTHORITY = 'confluence'

/** Prefix marking a decoded ref as an attachment-id ref. Kept in sync with the renderer's
 * `COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX`. */
export const COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX = 'attachment:'

/**
 * A decoded + validated content-image reference. Either an ATTACHMENT id (resolve via the v2
 * attachments API) or a Confluence-relative `/wiki/...` PATH (fetch directly). A forged /
 * malformed / origin-escaping ref decodes to `null` (the SSRF guard rejected it).
 */
export type ImageRef =
  | { kind: 'attachment'; attachmentId: string }
  | { kind: 'path'; relativePath: string }

/**
 * base64url-decode the encoded path segment back to its UTF-8 string, or `null` on malformed
 * input. Inverse of the renderer's `encodeRelativePath` (base64url, no padding). Pure.
 */
export function decodeBase64Url(encoded: string): string | null {
  if (typeof encoded !== 'string' || encoded === '') {
    return null
  }
  // Only the base64url alphabet (the encoder emits no padding).
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null
  }
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Decode + VALIDATE an opaque content-image reference (the full `cosmos-confluence-img://...`
 * URL, or just the encoded path segment) into a classified {@link ImageRef} — an `attachment`
 * id or a safe Confluence-relative `/wiki/...` `path` — or `null` if the reference is
 * absent/malformed/forged. This is the SSRF guard (FR-011). Pure; never throws.
 */
export function decodeImageRef(ref: unknown): ImageRef | null {
  if (typeof ref !== 'string' || ref.trim() === '') {
    return null
  }
  const encoded = encodedSegmentOf(ref.trim())
  if (encoded === null) {
    return null
  }
  const decoded = decodeBase64Url(encoded)
  if (decoded === null) {
    return null
  }
  // Attachment-id ref (the granular-scope path). Validate the id is a positive integer — a
  // non-numeric id could otherwise be path-smuggled into the v2 attachments URL.
  if (decoded.startsWith(COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX)) {
    const id = decoded.slice(COSMOS_CONFLUENCE_ATTACHMENT_REF_PREFIX.length)
    return /^[0-9]+$/.test(id) ? { kind: 'attachment', attachmentId: id } : null
  }
  // Legacy relative-path ref (kept for non-attachment `/wiki/...` content images).
  const relativePath = safeWikiPath(decoded)
  return relativePath === null ? null : { kind: 'path', relativePath }
}

/** Pull the base64url path segment out of a `cosmos-confluence-img://confluence/<seg>` URL,
 * or treat the input as the bare segment when it is not a scheme URL. Returns `null` for a
 * URL with the wrong scheme/authority, a different scheme, or no segment. */
function encodedSegmentOf(ref: string): string | null {
  const schemePrefix = `${COSMOS_CONFLUENCE_IMG_SCHEME}://`
  if (ref.toLowerCase().startsWith(schemePrefix)) {
    const rest = ref.slice(schemePrefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      return null
    }
    const authority = rest.slice(0, slash)
    const segment = rest.slice(slash + 1)
    if (authority.toLowerCase() !== COSMOS_CONFLUENCE_IMG_AUTHORITY || segment === '') {
      return null
    }
    // Only the first path component is the encoded segment.
    return segment.split('/')[0] || null
  }
  // A scheme URL of a DIFFERENT scheme is not ours.
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return null
  }
  // Bare segment.
  return ref
}

/**
 * Validate a decoded path is a safe Confluence-relative `/wiki/...` path. Returns the path
 * (path + query) or `null`. The single chokepoint of the SSRF guard. Pure.
 */
export function safeWikiPath(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') {
    return null
  }
  // No control chars (0x00-0x1F, DEL), no literal space, no backslash (some URL parsers treat
  // `\` as `/`, enabling traversal / host smuggling).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f \\]/.test(path)) {
    return null
  }
  // Root-anchored, NOT protocol-relative `//host`.
  if (!path.startsWith('/') || path.startsWith('//')) {
    return null
  }
  const queryIdx = path.indexOf('?')
  const pathPart = queryIdx === -1 ? path : path.slice(0, queryIdx)
  if (!pathPart.startsWith('/wiki/')) {
    return null
  }
  // No `..` traversal segment (decoded, so `..%2f`-style escapes can't smuggle one).
  const decodedPathPart = safeDecodeURIComponentPath(pathPart)
  if (decodedPathPart === null) {
    return null
  }
  for (const segment of decodedPathPart.split('/')) {
    if (segment === '..') {
      return null
    }
  }
  return path
}

/** Best-effort `%xx` decode of a path for the traversal check; `null` if not validly
 * percent-encoded (reject rather than risk a smuggled `..`). */
function safeDecodeURIComponentPath(pathPart: string): string | null {
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return null
  }
}

/**
 * Build the absolute gateway fetch URL for a validated relative path. ALWAYS
 * `${confluenceApiBase(cloudId)}${relativePath}` — the relative path is appended to the
 * trusted base, fixing the origin to `https://api.atlassian.com/ex/confluence/{cloudId}`. Pure.
 */
export function buildAssetUrl(cloudId: string, relativePath: string): string {
  return `${confluenceApiBase(cloudId)}${relativePath}`
}

/**
 * Build the v2 attachment METADATA URL for a validated numeric attachment id
 * (confluence-attachment-scope-v1): `${base}/wiki/api/v2/attachments/{id}` — the
 * granular-authorized read (`read:attachment:confluence`) that returns the attachment's
 * `downloadLink`. The id is `encodeURIComponent`-escaped defensively (it is already validated
 * to digits by `decodeImageRef`, so this is belt-and-suspenders). Pure.
 */
export function buildAttachmentMetaUrl(cloudId: string, attachmentId: string): string {
  return `${confluenceApiBase(cloudId)}/wiki/api/v2/attachments/${encodeURIComponent(attachmentId)}`
}

/**
 * Build the absolute bytes URL from an attachment's `downloadLink` (the value returned by the
 * v2 attachments metadata endpoint). The download link is a Confluence-relative path; Confluence
 * returns it either rooted at the wiki context (`/wiki/...`) or at the site root (`/download/...`,
 * `/rest/api/content/.../download`, …), so this prefixes `/wiki` to ANY non-`/wiki/` site-root
 * path and then applies the SAME SSRF guard ({@link safeWikiPath}) before appending it to the
 * trusted gateway base — a forged/origin-escaping link (`//host`, `..`) is rejected (→ null),
 * never fetched. Pure; never throws.
 */
export function buildDownloadUrl(cloudId: string, downloadLink: unknown): string | null {
  if (typeof downloadLink !== 'string' || downloadLink.trim() === '') {
    return null
  }
  let path = downloadLink.trim()
  // Normalize a site-root path (`/download/...`, `/rest/...`, …) to the wiki-context `/wiki/...`
  // form so it passes the `/wiki/`-anchored SSRF guard and resolves against the gateway base. A
  // link already `/wiki/...` is left as-is; `//host` is left for the guard to reject.
  if (path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/wiki/')) {
    path = `/wiki${path}`
  }
  const safe = safeWikiPath(path)
  return safe === null ? null : `${confluenceApiBase(cloudId)}${safe}`
}
