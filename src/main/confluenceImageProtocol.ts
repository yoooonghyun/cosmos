/**
 * confluenceImageProtocol — the Electron wiring for the Confluence content-image proxy
 * (confluence-content-images-v1). The PURE codec + SSRF validator lives in
 * `confluenceImageRef.ts` (node-testable, no Electron); this file is the thin Electron layer:
 * the privileged-scheme registration (pre-app-ready) + the `protocol.handle` handler factory
 * (post-ready) that fetches with the bearer token and streams the response back.
 *
 * A privileged custom scheme `cosmos-confluence-img://confluence/<base64url-path>` lets the
 * renderer reference a Confluence content/attachment image WITHOUT ever holding the access
 * token or a token-bearing URL (FR-002). For each request the handler decodes + validates the
 * reference (forged → broken image), resolves the LIVE auth (token + cloudId for the connected
 * session, or null), builds the gateway URL, and streams `net.fetch` with the bearer back to
 * the `<img>`. The token never leaves main — it is only ever attached to the outbound fetch.
 * Never throws (FR-010): every failure becomes a non-2xx Response, i.e. an ordinary broken
 * image, so one missing asset never blanks or crashes the body.
 */

import { protocol, net } from 'electron'
import type { ConfluenceCallAuth } from './integrations/confluenceClient'
import {
  COSMOS_CONFLUENCE_IMG_SCHEME,
  buildAssetUrl,
  decodeImageRef
} from './confluenceImageRef'

export { COSMOS_CONFLUENCE_IMG_SCHEME }

/** Resolves the live Confluence auth (token + cloudId) for the connected session, or `null`
 * when not connected / no token. Sourced from `ConfluenceManager.currentAuth()`; the protocol
 * layer never stores a token and always reads the current (refreshed) one. */
export type ConfluenceAuthResolver = () => ConfluenceCallAuth | null

/**
 * Register the privileged streaming scheme. MUST be called at module load in main, BEFORE
 * `app.whenReady` (Electron requires pre-ready registration). `standard` + `secure` +
 * `supportFetchAPI` + `stream` let the handler return a streamed `net.fetch` Response that an
 * `<img>` consumes natively.
 */
export function registerConfluenceImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: COSMOS_CONFLUENCE_IMG_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** A non-2xx Response standing in for a broken image (FR-010). The `<img>` shows its broken
 * state; the rest of the body renders. */
function brokenImageResponse(status: number): Response {
  return new Response(null, { status })
}

/**
 * Build the `protocol.handle` handler. Decodes + validates the reference (forged → 400),
 * resolves the live auth (not connected → 401), builds the gateway URL, and streams
 * `net.fetch` with the bearer token. Never throws (FR-010) — any failure becomes a non-2xx
 * Response. No size cap — the response is streamed.
 */
export function handleConfluenceImage(
  resolveAuth: ConfluenceAuthResolver
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const relativePath = decodeImageRef(request.url)
    if (!relativePath) {
      // Forged / malformed reference — SSRF guard rejected it. Broken image, no fetch.
      return brokenImageResponse(400)
    }
    let auth: ConfluenceCallAuth | null
    try {
      auth = resolveAuth()
    } catch {
      auth = null
    }
    if (!auth || !auth.token || !auth.cloudId) {
      // Not connected / no token — degrade to a broken image (no token-prompt loop, FR-010).
      return brokenImageResponse(401)
    }
    const url = buildAssetUrl(auth.cloudId, relativePath)
    try {
      // net.fetch streams the upstream response transparently; a non-2xx upstream status is
      // passed straight through to the <img> as a broken image (FR-010).
      return await net.fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` }
      })
    } catch {
      // Network error / rejection — broken image, never a main crash (FR-010).
      return brokenImageResponse(502)
    }
  }
}

/** Register the running handler. Call AFTER `app.whenReady` (alongside `createWindow`). */
export function installConfluenceImageProtocol(resolveAuth: ConfluenceAuthResolver): void {
  protocol.handle(COSMOS_CONFLUENCE_IMG_SCHEME, handleConfluenceImage(resolveAuth))
}
