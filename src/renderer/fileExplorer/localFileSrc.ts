/**
 * localFileSrc — PURE renderer-side builder of the opaque `cosmos-file://` `<img src>` for
 * a local image in the file viewer (terminal-file-explorer-v1, FR-010/FR-028). Mirrors
 * `confluenceCatalog/contentImageSrc.ts`: it base64url-encodes the root-RELATIVE path under
 * a fixed authority + the tab's `paneId`, so the renderer/DOM only ever holds the opaque
 * scheme — never an absolute path, a host, or a token. Pure + node-testable in isolation.
 *
 * The main-process protocol handler (`localFileProtocol.ts`) decodes this with the PURE
 * `localFileRef.decodeLocalFileRef`, resolves the root by `paneId`, and confines the path
 * (`pathConfine`) before streaming — a forged/out-of-root src is a broken image, no read.
 *
 * The encoder here is the byte-for-byte inverse of `localFileRef.decodeBase64Url`; the
 * scheme/authority constants are duplicated (not imported) because this renderer module
 * must not import a main (`src/main`) module across the process boundary, exactly as
 * `contentImageSrc.ts` duplicates the confluence scheme constants.
 */

/** The custom privileged Electron scheme. Kept in sync with main's `COSMOS_FILE_SCHEME`. */
export const COSMOS_FILE_SCHEME = 'cosmos-file'

/** The fixed authority segment. The on-disk root is never encoded — only the `paneId`
 * (main resolves it) + a root-relative path. Kept in sync with main's `COSMOS_FILE_AUTHORITY`. */
export const COSMOS_FILE_AUTHORITY = 'file'

/**
 * base64url-encode a relative path for the opaque src (RFC 4648 §5: `-`/`_`, no padding).
 * Uses `btoa` in the renderer; falls back to a Buffer in node (tests). Byte-for-byte the
 * inverse of main's `localFileRef.decodeBase64Url`. Pure.
 */
export function encodeRelPath(relPath: string): string {
  const utf8 = unescape(encodeURIComponent(relPath))
  const b64 =
    typeof btoa === 'function' ? btoa(utf8) : Buffer.from(relPath, 'utf8').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build the opaque `cosmos-file://file/<paneId>/<base64url(relPath)>` URL for an image in
 * the viewer. The `paneId` is a raw URL path segment (the renderer mints it as a UUID, so
 * it has no separators); the `relPath` is base64url-encoded so a path with `/`, `%`, or
 * unicode round-trips unambiguously. NO host, NO token, NO absolute path. Pure.
 */
export function buildLocalFileSrc(paneId: string, relPath: string): string {
  return `${COSMOS_FILE_SCHEME}://${COSMOS_FILE_AUTHORITY}/${paneId}/${encodeRelPath(relPath)}`
}
