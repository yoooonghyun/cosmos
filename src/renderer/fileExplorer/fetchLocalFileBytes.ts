/**
 * fetchLocalFileBytes — fetch a local file's bytes from the confined `cosmos-file://` stream
 * (file-viewer-multiformat-v1, FR-007). The DOCX (docx-preview) and SHEET (SheetJS) renderers
 * take an `ArrayBuffer`, so they fetch the SAME opaque, root-confined URL the `<img>` and
 * pdf.js use — no new arbitrary-filesystem IPC, no absolute path in the renderer (D-2). One
 * fetch helper, two consumers.
 *
 * The bytes flow ENTIRELY through the main-process protocol handler (`localFileProtocol.ts`),
 * which resolved the pane root by `paneId` and `pathConfine`-checked the target before
 * streaming — a forged/out-of-root URL is a non-2xx Response (rejected here as an error), never
 * a read. The renderer CSP must allow `connect-src cosmos-file:` or this `fetch` is blocked.
 *
 * Not pure (it does I/O), so it lives in its own thin `.ts` and is consumed by the `.tsx`
 * renderers; the byte→viewer decisions remain in the pure `viewerKind`/`viewerState` modules.
 */

import { buildLocalFileSrc } from './localFileSrc'

/**
 * Fetch `relPath` (root-relative, addressed by `paneId`) as an `ArrayBuffer` over
 * `cosmos-file://`. Rejects on a non-2xx Response (forged/out-of-root/vanished → the protocol
 * handler returns a broken-stream status) or a network/CSP error, so the calling renderer's
 * try/catch flips to its calm `render-error` block (FR-008) instead of rendering garbage.
 */
export async function fetchLocalFileBytes(paneId: string, relPath: string): Promise<ArrayBuffer> {
  const res = await fetch(buildLocalFileSrc(paneId, relPath))
  if (!res.ok) {
    throw new Error(`cosmos-file fetch failed (${res.status}) for ${relPath}`)
  }
  return res.arrayBuffer()
}
