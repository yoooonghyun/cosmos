/**
 * localFileProtocol — the Electron wiring for the Terminal File Explorer's local-image
 * streaming scheme `cosmos-file://` (terminal-file-explorer-v1, FR-010/FR-027/FR-028). The
 * PURE codec + first SSRF gate lives in `localFileRef.ts` (node-testable, no Electron) and
 * the confinement guard in `pathConfine.ts`; this file is the thin Electron layer: the
 * privileged-scheme registration (pre-app-ready) + the `protocol.handle` handler factory
 * (post-ready) that resolves the tab's root, confines the path, and streams the file bytes.
 *
 * `<img src="cosmos-file://file/<paneId>/<base64url(relPath)>">` lets the viewer show a
 * supported local image WITHOUT bytes riding IPC (FR-010) and WITHOUT the renderer ever
 * holding an absolute path (D-2). For each request the handler:
 *   1. decodes + validates the ref (forged/escaping → broken image, no read — FR-028),
 *   2. resolves the tab's root by `paneId` (`getRoot`, never a renderer-supplied root —
 *      FR-022); no live root → broken image,
 *   3. CONFINES the joined target against that root (real-path/symlink escape refused —
 *      FR-019/020/021),
 *   4. rejects a non-image extension (this scheme is image-only; text/binary go over IPC),
 *   5. streams the file bytes back to the `<img>`.
 * Never throws (FR-028): every failure is a non-2xx Response — an ordinary broken image, so
 * one missing/forged asset never blanks or crashes the viewer. No size cap (FR-012).
 */

import { protocol } from 'electron'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { confine, type ConfineFs } from './pathConfine'
import { COSMOS_FILE_SCHEME, decodeLocalFileRef } from './localFileRef'

export { COSMOS_FILE_SCHEME }

/** Resolve a pane's absolute root directory (its `claude` cwd), or `undefined` when the
 * pane has no live session. Injected so the protocol never reaches into `terminalSessionMap`
 * directly (FR-022) — `index.ts` wires `terminalSessionMap.get(paneId)?.cwd`. */
export type RootResolver = (paneId: string) => string | undefined

/**
 * Register the privileged streaming scheme. MUST be called at module load in main, BEFORE
 * `app.whenReady` (Electron requires pre-ready registration). `standard` + `secure` +
 * `supportFetchAPI` + `stream` let the handler return a streamed Response an `<img>`
 * consumes natively.
 */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: COSMOS_FILE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** A non-2xx Response standing in for a broken image (FR-028). The `<img>` shows its broken
 * state; the rest of the viewer renders. */
function brokenImageResponse(status: number): Response {
  return new Response(null, { status })
}

/** The real-disk `ConfineFs` — `realpathSync` canonicalizes (resolving symlinks) and returns
 * `null` (not throw) for a missing/unreadable path, as `pathConfine` requires. */
const diskConfineFs: ConfineFs = {
  realpath(p: string): string | null {
    try {
      return realpathSync(p)
    } catch {
      return null
    }
  }
}

/**
 * Build the `protocol.handle` handler. Decodes + validates the ref, resolves the tab's root,
 * confines the path, checks it is a supported image extension, then streams the file. Any
 * failure → a non-2xx Response (broken image); never throws (FR-028).
 */
export function handleLocalFile(getRoot: RootResolver): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const ref = decodeLocalFileRef(request.url)
    if (!ref) {
      // Forged / malformed / escaping ref — first SSRF gate rejected it. No read.
      return brokenImageResponse(400)
    }
    let root: string | undefined
    try {
      root = getRoot(ref.paneId)
    } catch {
      root = undefined
    }
    if (typeof root !== 'string' || root === '') {
      // No live root for this pane (awaiting-directory / disposed / exited) — broken image.
      return brokenImageResponse(404)
    }
    // Confine the joined target to the tab's root (real-path / symlink escape refused). Even
    // though the codec already rejected `..`/absolute, this is the authoritative second gate.
    const c = confine(root, ref.relPath, diskConfineFs)
    if (!c.ok) {
      return brokenImageResponse(c.reason === 'not-found' ? 404 : 403)
    }
    // file-viewer-multiformat-v1 (FR-007/FR-014): the image-only 415 gate is RELAXED — this
    // scheme now streams ANY confined in-root regular file so the document renderers
    // (pdf/docx/sheet) can fetch their bytes through the SAME confinement envelope as images.
    // The security model is unchanged: the ref was decoded + validated (first SSRF gate), the
    // root was resolved by paneId (never renderer-supplied), and `confine` real-path-checked
    // the target against that root above — only the extension allowlist is dropped. text/code
    // still rides `fs:read` (Monaco), so in practice the consumers here are images + documents.
    try {
      // Confirm it is a regular file (not a dir/socket) before streaming.
      const stat = statSync(c.abs)
      if (!stat.isFile()) {
        return brokenImageResponse(404)
      }
      // Stream the bytes (no size cap, FR-012). Node's `Readable` is adapted to a web
      // `ReadableStream` so the privileged-scheme Response streams it to the `<img>`.
      const nodeStream = createReadStream(c.abs)
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
      return new Response(webStream, { status: 200 })
    } catch {
      // Read/stat error (vanished mid-request, permission) — broken image, never a crash.
      return brokenImageResponse(404)
    }
  }
}

/** Register the running handler. Call AFTER `app.whenReady` (alongside `createWindow`). */
export function installLocalFileProtocol(getRoot: RootResolver): void {
  protocol.handle(COSMOS_FILE_SCHEME, handleLocalFile(getRoot))
}
