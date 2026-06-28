/**
 * localFileRef — the PURE codec + validator for the Terminal File Explorer's local-image
 * streaming scheme `cosmos-file://` (terminal-file-explorer-v1, FR-010/FR-027/FR-028). No
 * Electron import, so it is node-unit-testable in isolation (the `.ts`/`.test.ts` split).
 * The Electron wiring that USES these functions lives in `localFileProtocol.ts`. Mirrors
 * `confluenceImageRef.ts` / `slackImageRef.ts`.
 *
 * A supported image in the viewer is delivered via `<img src="cosmos-file://file/<paneId>/
 * <base64url(relPath)>">` (no size cap, no bytes-over-IPC — FR-010). The reference encodes
 * ONLY the tab's `paneId` + a root-RELATIVE path; NEVER an absolute path, a host, or a
 * token (purely local files). {@link decodeLocalFileRef} decodes + VALIDATES it and
 * rejects (→ null) anything that could escape the tab's root: an absolute path, a `..`
 * traversal segment, a backslash, a control char, a protocol-relative `//host`, or a wrong
 * scheme/authority. The REAL-path / symlink containment against the tab's on-disk root is
 * done by `pathConfine` in the protocol handler (this codec is the cheap first gate); a
 * forged/out-of-root ref still becomes a broken image, never a read (FR-028).
 */

/** The privileged scheme. Kept in sync with the renderer's URL builder (the renderer
 * helper mirrors `confluenceCatalog/contentImageSrc.ts`). */
export const COSMOS_FILE_SCHEME = 'cosmos-file'

/** The fixed authority segment. The on-disk root is NEVER encoded into a reference — only
 * a `paneId` (which main resolves to the root) + a root-relative path. */
export const COSMOS_FILE_AUTHORITY = 'file'

/**
 * A decoded + validated local-file reference: the tab's `paneId` (so main looks up the
 * root) + the root-RELATIVE path of the image. A forged / malformed / escaping ref
 * decodes to `null` (the first SSRF gate rejected it; `pathConfine` is the second).
 */
export interface LocalFileRef {
  /** The terminal tab whose root the path is relative to (FR-022). */
  paneId: string
  /** The root-relative path of the image file (validated non-escaping). */
  relPath: string
}

/**
 * base64url-encode a UTF-8 string (RFC 4648 §5: `-`/`_`, no padding). Used by the
 * renderer URL builder AND mirrored here so the round-trip is provable. In the renderer
 * `btoa` is used; in node a Buffer. Pure.
 */
export function encodeBase64Url(value: string): string {
  const b64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(value)))
      : Buffer.from(value, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * base64url-decode a segment back to its UTF-8 string, or `null` on malformed input
 * (wrong alphabet / undecodable). Inverse of {@link encodeBase64Url}. Pure; never throws.
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
 * Validate a decoded root-relative path is non-escaping (FR-020 — the cheap first gate;
 * `pathConfine` does the real-path/symlink check). Returns the path or `null`. Rejects:
 * a control char / literal space / backslash; a root-anchored (`/...`) or protocol-
 * relative (`//host`) path (an absolute escape); and any `..` traversal segment. An
 * empty path is rejected (an image ref always names a file). Pure; never throws.
 */
export function safeRelPath(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') {
    return null
  }
  // No control chars (0x00-0x1F, DEL), no literal space, no backslash (some path/URL
  // parsers treat `\` as `/`, enabling traversal / drive-letter escapes on Windows).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f \\]/.test(path)) {
    return null
  }
  // Must be RELATIVE — not root-anchored, not protocol-relative `//host`. (`pathConfine`
  // also rejects an absolute relPath, but reject it here too so a forged ref never even
  // reaches a root lookup.)
  if (path.startsWith('/')) {
    return null
  }
  // No `..` traversal segment (split on both separators so a Windows `..\` is caught).
  for (const segment of path.split(/[\\/]/)) {
    if (segment === '..') {
      return null
    }
  }
  return path
}

/**
 * Validate a `paneId` segment: a non-empty string with no path separator, no control
 * char, no whitespace, and no `..` (it is a URL path component AND a map key, so keep it
 * opaque-but-clean). The renderer mints `paneId` as a `crypto.randomUUID()`; this guard
 * keeps a forged ref from smuggling a separator into the authority/path split. Pure.
 */
export function safePaneId(paneId: unknown): string | null {
  if (typeof paneId !== 'string' || paneId === '') {
    return null
  }
  // No separator/control/whitespace; no `%` (a forged ref could smuggle a `%2f`/`%2e`
  // encoded separator/dot through a later decode). A real paneId is a UUID — clean already.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f \\/%]/.test(paneId) || paneId === '..' || paneId === '.') {
    return null
  }
  return paneId
}

/**
 * Build the opaque `cosmos-file://file/<paneId>/<base64url(relPath)>` URL for an image.
 * The renderer's helper mirrors this exactly (it consumes the output as `<img src>`). The
 * `paneId` is a raw path segment (validated clean); the `relPath` is base64url-encoded so
 * a path with `/`, `%`, or unicode round-trips without ambiguity. NO host, NO token, NO
 * absolute path. Pure; returns `null` if the inputs are not encodable (forged paneId/path).
 */
export function encodeLocalFileRef(paneId: string, relPath: string): string | null {
  const safePane = safePaneId(paneId)
  const safePath = safeRelPath(relPath)
  if (safePane === null || safePath === null) {
    return null
  }
  return `${COSMOS_FILE_SCHEME}://${COSMOS_FILE_AUTHORITY}/${safePane}/${encodeBase64Url(safePath)}`
}

/**
 * Decode + VALIDATE an opaque `cosmos-file://` reference (the full URL) into a classified
 * {@link LocalFileRef}, or `null` if the reference is absent / malformed / forged /
 * escaping. This is the first SSRF gate (FR-028); `pathConfine` (real-path/symlink) is the
 * second, in the protocol handler. Pure; never throws.
 */
export function decodeLocalFileRef(ref: unknown): LocalFileRef | null {
  if (typeof ref !== 'string' || ref.trim() === '') {
    return null
  }
  const value = ref.trim()
  const schemePrefix = `${COSMOS_FILE_SCHEME}://`
  if (!value.toLowerCase().startsWith(schemePrefix)) {
    return null
  }
  const rest = value.slice(schemePrefix.length)
  // Split into [authority, paneId, encodedRelPath]. Authority + paneId are raw segments;
  // the encoded relPath is the LAST segment (base64url has no `/`).
  const firstSlash = rest.indexOf('/')
  if (firstSlash === -1) {
    return null
  }
  const authority = rest.slice(0, firstSlash)
  if (authority.toLowerCase() !== COSMOS_FILE_AUTHORITY) {
    return null
  }
  const afterAuthority = rest.slice(firstSlash + 1)
  const secondSlash = afterAuthority.indexOf('/')
  if (secondSlash === -1) {
    return null
  }
  const rawPaneId = afterAuthority.slice(0, secondSlash)
  // The encoded relPath is everything after the paneId's slash, up to any further `/` or
  // query/fragment — base64url itself contains none of those, so a `/` here is forgery.
  const encodedSegment = afterAuthority.slice(secondSlash + 1)
  if (encodedSegment === '' || /[/?#]/.test(encodedSegment)) {
    return null
  }
  const paneId = safePaneId(rawPaneId)
  if (paneId === null) {
    return null
  }
  const decodedPath = decodeBase64Url(encodedSegment)
  if (decodedPath === null) {
    return null
  }
  const relPath = safeRelPath(decodedPath)
  if (relPath === null) {
    return null
  }
  return { paneId, relPath }
}
