/**
 * fetchLocalFileBytes — read a local DOCUMENT file's bytes for the byte-consuming renderers
 * (file-viewer-multiformat-v1, FR-007). The PDF (pdf.js), DOCX (docx-preview) and SHEET (SheetJS)
 * renderers all take an `ArrayBuffer`, so they share this one helper.
 *
 * The bytes ride the typed, root-confined `window.cosmos.fs.readBytes` IPC — NOT a fetch of the
 * privileged `cosmos-file://` scheme. Chromium refuses `fetch()`/XHR to a custom scheme from the
 * http dev-server origin ("URL scheme cosmos-file is not supported"), which broke all three
 * byte-consuming viewers; the `<img>` resource-load path is unaffected and still uses
 * `cosmos-file://`. Main resolves the pane root by `paneId`, confines the target, and enforces the
 * per-format size cap before returning the bytes — no absolute path or arbitrary read reaches here.
 *
 * Not pure (it does IPC I/O), so it lives in its own thin `.ts` and is consumed by the `.tsx`
 * renderers; the byte→viewer decisions remain in the pure `viewerKind`/`viewerState` modules.
 */

/**
 * Read `relPath` (root-relative, addressed by `paneId`) as an `ArrayBuffer` over the typed
 * `window.cosmos.fs.readBytes` IPC. THROWS on any failure (`too-large`/`out-of-root`/`not-found`/
 * `denied`), so the calling renderer's existing try/catch flips to its calm `render-error` block
 * (FR-008) instead of rendering garbage. Returns a fresh `ArrayBuffer` copy of the result bytes.
 */
export async function fetchLocalFileBytes(paneId: string, relPath: string): Promise<ArrayBuffer> {
  const res = await window.cosmos.fs.readBytes(paneId, relPath)
  if (!res.ok) {
    throw new Error(`fs.readBytes failed (${res.reason}) for ${relPath}`)
  }
  // Copy out of the (possibly shared) backing buffer into a standalone ArrayBuffer the
  // byte-consuming renderers can own — `byteOffset`/`byteLength` honor any sub-array view.
  const { bytes } = res
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
