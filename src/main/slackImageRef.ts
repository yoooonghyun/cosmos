/**
 * slackImageRef — the PURE codec + SSRF validator for the Slack image proxy
 * (slack-rich-message-render-v1, FR-010/FR-011). No Electron import, so it is
 * node-unit-testable in isolation (the `.ts`/`.test.ts` split). The Electron wiring
 * that USES these functions lives in `slackImageProtocol.ts`.
 *
 * Slack attachment images live on auth-gated `https://files.slack.com/...` URLs;
 * workspace custom-emoji images live on the Slack emoji CDN (`*.slack-edge.com`, e.g.
 * `emoji.slack-edge.com`). Both are behind the Slack token, which lives ONLY in main —
 * so the renderer can never load them directly. Main encodes the asset's `host + path`
 * into an OPAQUE `cosmos-slack-img://slack/<base64url>` reference (this module's
 * {@link encodeImageRef}); the renderer holds only that ref; main decodes + revalidates
 * it ({@link decodeImageRef}) and fetches with the bearer attached only to the outbound
 * fetch. NO token is ever encoded; only a host (from a fixed allowlist) + a path.
 *
 * The codec is SSRF-safe: BOTH encode and decode reject any URL whose host is not on the
 * 2-entry allowlist (`files.slack.com` for attachments + the Slack emoji CDN for custom
 * emoji), any non-https scheme, any `..` traversal, any control char/backslash, and any
 * protocol-relative `//host`. A forged / origin-escaping ref decodes to `null` → broken
 * image, no fetch (FR-011 / SC-006), exactly like the Confluence ref codec.
 */

/** The privileged scheme. Kept in sync with the renderer (refs are produced in main). */
export const COSMOS_SLACK_IMG_SCHEME = 'cosmos-slack-img'

/** The fixed authority segment. The real Slack host is encoded INSIDE the ref payload
 * (allowlisted), never as the URL authority — so a forged authority is rejected. */
export const COSMOS_SLACK_IMG_AUTHORITY = 'slack'

/**
 * Host allowlist (lower-case). An asset URL is acceptable ONLY when its host is exactly
 * `files.slack.com` (attachment images) OR is `slack-edge.com` / a `*.slack-edge.com`
 * subdomain (the Slack emoji CDN — `emoji.slack-edge.com`, `a.slack-edge.com`, …). Any
 * other host is rejected at BOTH encode and decode (SSRF guard, FR-011).
 */
const FILES_HOST = 'files.slack.com'
const EMOJI_CDN_SUFFIX = '.slack-edge.com'
const EMOJI_CDN_HOST = 'slack-edge.com'

/** True iff `host` (already lower-cased) is on the Slack image host allowlist. */
export function isAllowedSlackImageHost(host: string): boolean {
  if (typeof host !== 'string' || host === '') {
    return false
  }
  const h = host.toLowerCase()
  return h === FILES_HOST || h === EMOJI_CDN_HOST || h.endsWith(EMOJI_CDN_SUFFIX)
}

/**
 * A decoded + validated Slack image reference: an allowlisted host + a root-anchored
 * path (path + query). A forged / non-allowed-host / origin-escaping ref decodes to
 * `null`. {@link buildSlackImageUrl} reassembles the trusted `https://<host><path>` URL.
 */
export interface SlackImageTarget {
  /** The allowlisted host (`files.slack.com` or a `*.slack-edge.com` emoji CDN host). */
  host: string
  /** The root-anchored asset path + query (`/files-pri/...`, `/production/.../x.png`). */
  path: string
}

/**
 * base64url-encode a UTF-8 string (RFC 4648 §5: `-`/`_`, no padding). Node-only (main
 * produces every ref), so a Buffer is always available. Pure.
 */
export function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * base64url-decode a segment back to its UTF-8 string, or `null` on malformed input
 * (wrong alphabet / undecodable). Inverse of {@link encodeBase64Url}. Pure.
 */
export function decodeBase64Url(encoded: string): string | null {
  if (typeof encoded !== 'string' || encoded === '') {
    return null
  }
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
 * Validate a root-anchored asset path is safe (no traversal / host smuggling). Returns
 * the path (path + query) or `null`. Mirrors the Confluence `safeWikiPath` guard but is
 * not anchored to a fixed prefix (Slack paths vary: `/files-pri/...`, `/production/...`).
 * Pure; never throws.
 */
export function safeSlackPath(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') {
    return null
  }
  // No control chars (0x00-0x1F, DEL), no literal space, no backslash (some URL parsers
  // treat `\` as `/`, enabling traversal / host smuggling).
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
  // No `..` traversal segment (decode `%2e%2e` escapes first so they can't smuggle one).
  let decodedPathPart: string
  try {
    decodedPathPart = decodeURIComponent(pathPart)
  } catch {
    return null
  }
  for (const segment of decodedPathPart.split('/')) {
    if (segment === '..') {
      return null
    }
  }
  return path
}

/**
 * Encode an allowlisted Slack asset URL into the opaque `cosmos-slack-img://slack/<seg>`
 * reference (the value main puts on a `SlackMessage`/custom-emoji map). Returns `null`
 * when the URL is malformed, not https, off the host allowlist, or path-unsafe — so a
 * non-allowed asset never becomes a ref (and the renderer shows nothing rather than a
 * dead ref). The payload encoded is `<host>\n<path>`; NO token is ever encoded. Pure.
 */
export function encodeImageRef(rawUrl: unknown): string | null {
  const target = parseAllowedUrl(rawUrl)
  if (target === null) {
    return null
  }
  const payload = `${target.host}\n${target.path}`
  return `${COSMOS_SLACK_IMG_SCHEME}://${COSMOS_SLACK_IMG_AUTHORITY}/${encodeBase64Url(payload)}`
}

/**
 * Decode + VALIDATE an opaque Slack image reference (the full `cosmos-slack-img://...`
 * URL, or the bare encoded segment) into a classified {@link SlackImageTarget}, or
 * `null` if the reference is absent/malformed/forged/off-allowlist. This is the main-
 * side SSRF guard (FR-011). Pure; never throws.
 */
export function decodeImageRef(ref: unknown): SlackImageTarget | null {
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
  const nl = decoded.indexOf('\n')
  if (nl === -1) {
    return null
  }
  const host = decoded.slice(0, nl).toLowerCase()
  const rawPath = decoded.slice(nl + 1)
  if (!isAllowedSlackImageHost(host)) {
    return null
  }
  const path = safeSlackPath(rawPath)
  return path === null ? null : { host, path }
}

/**
 * Reassemble the absolute, allowlisted fetch URL from a validated target —
 * ALWAYS `https://<host><path>`, fixing the scheme to https and the host to the
 * allowlisted value. Pure.
 */
export function buildSlackImageUrl(target: SlackImageTarget): string {
  return `https://${target.host}${target.path}`
}

/**
 * Parse + allowlist-check an asset URL into `{ host, path }`, or `null`. Used by
 * {@link encodeImageRef}. Accepts ONLY an absolute https URL whose host is on the
 * allowlist and whose path is safe. Pure; never throws.
 */
function parseAllowedUrl(rawUrl: unknown): SlackImageTarget | null {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return null
  }
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!isAllowedSlackImageHost(host)) {
    return null
  }
  const path = safeSlackPath(`${url.pathname}${url.search}`)
  return path === null ? null : { host, path }
}

/** Pull the base64url segment out of a `cosmos-slack-img://slack/<seg>` URL, or treat
 * the input as the bare segment when it is not a scheme URL. Returns `null` for a URL
 * with the wrong scheme/authority, a different scheme, or no segment. Mirrors the
 * Confluence `encodedSegmentOf`. */
function encodedSegmentOf(ref: string): string | null {
  const schemePrefix = `${COSMOS_SLACK_IMG_SCHEME}://`
  if (ref.toLowerCase().startsWith(schemePrefix)) {
    const rest = ref.slice(schemePrefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) {
      return null
    }
    const authority = rest.slice(0, slash)
    const segment = rest.slice(slash + 1)
    if (authority.toLowerCase() !== COSMOS_SLACK_IMG_AUTHORITY || segment === '') {
      return null
    }
    return segment.split('/')[0] || null
  }
  // A scheme URL of a DIFFERENT scheme is not ours.
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return null
  }
  return ref
}
