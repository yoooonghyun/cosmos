/**
 * confluenceWebUrl — pure assembler for a Confluence page's canonical web-UI URL
 * (confluence-detail-weblink-v1 #87; 404 fix confluence-link-404-v1 #100 → v2 deeper fix).
 *
 * 404 ROOT CAUSE (v2, the deeper one #100 v1 missed):
 *   The v2 `GET /wiki/api/v2/pages/{id}` response's per-page `_links` is the
 *   `AbstractPageLinks` schema: `{ webui, editui, tinyui }` — it does NOT contain a
 *   `base`. `base` is a field of the `MultiEntityLinks` schema (the TOP-LEVEL `_links` of
 *   LIST/multi-entity responses), NOT the single-page object (confirmed against the v2
 *   OpenAPI). So the prior fix's premise — "the page read's OWN `_links.base` JOINED with
 *   `_links.webui`" — was reading a field the single-page read does not reliably return.
 *   Whatever value the runtime happened to put in `_links.base` was undocumented/unstable,
 *   so joining it to `webui` still produced a 404 URL (e.g. a doubled or missing `/wiki`).
 *
 * THE BROWSABLE URL is the page's host-relative `_links.webui`
 *   (e.g. `/spaces/ENG/pages/123/Title`, or on some sites `/wiki/spaces/...`)
 * resolved against the SITE WEB ORIGIN persisted from OAuth accessible-resources `siteUrl`
 *   (e.g. `https://acme.atlassian.net`, the bare origin, NO `/wiki`).
 * Confluence is served under the `/wiki` context path, so the canonical URL is
 *   `<siteUrl>/wiki<webui>`
 *   → "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title".
 * We normalize the `/wiki` seam so it is neither DOUBLED (a `webui` that already starts
 * with `/wiki`) nor DROPPED — the exact failure modes the old `_links.base` join hit.
 *
 * This deliberately does NOT use the page `_links.base` (unreliable per above) and NOT the
 * cloudId API host (`https://api.atlassian.com/ex/confluence/<cloudId>` is an API host, not
 * a user-facing web URL).
 *
 * Returns the assembled URL ONLY if it parses to an ABSOLUTE `http(s)` URL; otherwise
 * `undefined` so `getPage` omits the non-secret `webUrl` DTO field (degrade-to-omit,
 * FR-004/FR-008/FR-010). Pure; NEVER throws (parse failures → `undefined`).
 *
 * When `siteUrl` or `webui` is missing/non-string the URL is treated as absent and the
 * affordance does not render — the contract (`webUrl?: string`, omit-when-absent) is
 * unchanged either way.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Build `<siteOrigin>/wiki<webui>`, normalizing the `/wiki` seam so it is present EXACTLY
 * once. `siteUrl` is the bare site web origin from OAuth accessible-resources
 * (e.g. `https://acme.atlassian.net`); a trailing slash and a defensive trailing `/wiki`
 * are stripped first so we never double it. `webui` is the page's host-relative web link,
 * which on some sites already carries the `/wiki` prefix — also collapsed to one.
 */
function joinSiteAndWebui(siteUrl: string, webui: string): string {
  // Normalize the site origin: drop a trailing slash, then a trailing `/wiki`, so we add
  // exactly one `/wiki` segment ourselves.
  let origin = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl
  if (origin.endsWith('/wiki')) {
    origin = origin.slice(0, -'/wiki'.length)
  }
  // Normalize webui to a leading-slash path and strip a leading `/wiki` so it is not doubled.
  let path = webui.startsWith('/') ? webui : `/${webui}`
  if (path === '/wiki' || path.startsWith('/wiki/')) {
    path = path.slice('/wiki'.length) || '/'
  }
  return `${origin}/wiki${path}`
}

/**
 * Assemble the canonical web URL for a page.
 * @param siteUrl the persisted site web origin (OAuth accessible-resources `url`,
 *   e.g. `https://acme.atlassian.net`). Absent/empty/non-absolute → omit the affordance.
 * @param links the raw `_links` value off the v2 page response (untrusted/unknown); only
 *   `webui` is read (the single-page `_links` has no reliable `base`).
 * @returns an absolute `http(s)` URL string, or `undefined` to OMIT the affordance.
 */
export function confluenceWebUrl(siteUrl: unknown, links: unknown): string | undefined {
  if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
    return undefined
  }
  if (!isRecord(links)) {
    return undefined
  }
  const webui = links.webui
  if (typeof webui !== 'string' || webui.trim() === '') {
    return undefined
  }
  let resolved: URL
  try {
    // Parse the WHOLE assembled string. A non-absolute `siteUrl` (no origin) is
    // unparseable here → undefined (degrade-to-omit).
    resolved = new URL(joinSiteAndWebui(siteUrl, webui))
  } catch {
    return undefined
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return undefined
  }
  return resolved.toString()
}
