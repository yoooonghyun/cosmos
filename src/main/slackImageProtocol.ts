/**
 * slackImageProtocol — the Electron wiring for the Slack image proxy
 * (slack-rich-message-render-v1, FR-010/FR-011, Track D). The PURE codec + SSRF validator
 * lives in `slackImageRef.ts` (node-testable, no Electron); this file is the thin Electron
 * layer: the privileged-scheme registration (pre-app-ready) + the `protocol.handle` handler
 * factory (post-ready) that fetches with the bearer token and streams the response back.
 *
 * A privileged custom scheme `cosmos-slack-img://slack/<base64url(host\npath)>` lets the
 * renderer reference an auth-gated Slack image (attachment on `files.slack.com`, custom emoji
 * on the `*.slack-edge.com` CDN) WITHOUT ever holding the token or a token-bearing URL
 * (FR-014). For each request the handler decodes + REVALIDATES the reference (forged /
 * off-allowlist → broken image, no fetch), resolves the LIVE Slack auth (token for the
 * connected session, or null), reassembles the trusted `https://<host><path>` URL, and streams
 * `net.fetch` with the bearer back to the `<img>`. The token never leaves main — it is only
 * ever attached to the outbound fetch. Never throws (FR-010): every failure becomes a non-2xx
 * Response (an ordinary broken image), so one missing asset never blanks or crashes the body.
 *
 * Mirrors `confluenceImageProtocol.ts` (the path-ref branch); no attachment-metadata indirection
 * is needed since Slack image URLs are fetched directly with the bearer.
 */

import { protocol, net } from 'electron'
import type { SlackCallAuth } from './integrations/slackClient'
import {
  COSMOS_SLACK_IMG_SCHEME,
  buildSlackImageUrl,
  decodeImageRef
} from './slackImageRef'

export { COSMOS_SLACK_IMG_SCHEME }

/** Resolves the live Slack auth (token) for the connected session, or `null` when not
 * connected / no token. Sourced from `SlackManager.currentAuth()`; the protocol layer never
 * stores a token and always reads the current one. */
export type SlackAuthResolver = () => SlackCallAuth | null

/**
 * Register the privileged streaming scheme. MUST be called at module load in main, BEFORE
 * `app.whenReady` (Electron requires pre-ready registration). `standard` + `secure` +
 * `supportFetchAPI` + `stream` let the handler return a streamed `net.fetch` Response an
 * `<img>` consumes natively. Mirrors {@link registerConfluenceImageScheme}.
 */
export function registerSlackImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: COSMOS_SLACK_IMG_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** A non-2xx Response standing in for a broken image (FR-010/FR-011). */
function brokenImageResponse(status: number): Response {
  return new Response(null, { status })
}

/**
 * Build the `protocol.handle` handler. Decodes + revalidates the reference (forged /
 * off-allowlist → 400, no fetch), resolves the live auth (not connected → 401), reassembles
 * the trusted `https://<host><path>` URL, and streams `net.fetch` with the bearer token. Never
 * throws (FR-010) — any failure becomes a non-2xx Response.
 */
export function handleSlackImage(
  resolveAuth: SlackAuthResolver
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const target = decodeImageRef(request.url)
    if (!target) {
      // Forged / malformed / off-allowlist reference — SSRF guard rejected it (FR-011).
      return brokenImageResponse(400)
    }
    let auth: SlackCallAuth | null
    try {
      auth = resolveAuth()
    } catch {
      auth = null
    }
    if (!auth || !auth.token) {
      // Not connected / no token — degrade to a broken image (no prompt loop, FR-010).
      return brokenImageResponse(401)
    }
    try {
      return await net.fetch(buildSlackImageUrl(target), {
        headers: { Authorization: `Bearer ${auth.token}` }
      })
    } catch {
      // Network error / rejection — broken image, never a main crash (FR-010).
      return brokenImageResponse(502)
    }
  }
}

/** Register the running handler. Call AFTER `app.whenReady` (alongside `createWindow`). */
export function installSlackImageProtocol(resolveAuth: SlackAuthResolver): void {
  protocol.handle(COSMOS_SLACK_IMG_SCHEME, handleSlackImage(resolveAuth))
}
