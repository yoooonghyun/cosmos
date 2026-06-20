/**
 * jiraWebUrl — pure assembler for a Jira issue's canonical, NON-SECRET browse URL
 * (jira-dock-autoapply-weblink-v1 #103, FR-010/FR-011). The browsable URL is the connected
 * site's origin (e.g. `https://acme.atlassian.net`, captured from OAuth `accessible-resources`
 * and persisted on the token set's `extra.siteUrl`) joined with `/browse/<KEY>` — exactly the
 * URL Jira's own UI uses to open an issue.
 *
 * It deliberately does NOT hand-construct from the cloudId API host
 * (`https://api.atlassian.com/ex/jira/<cloudId>`): that is an API host, not a user-facing web
 * URL. It is a sibling of `confluenceWebUrl` but with Jira's simpler join rule — the site
 * ORIGIN + `/browse/` + a single URL-encoded key segment (Jira has no per-page `_links` base).
 *
 * Returns the assembled URL ONLY if the site URL parses to an ABSOLUTE `http(s)` URL and the
 * issue key is non-empty; otherwise `undefined` so `getIssue` omits the non-secret `webUrl`
 * DTO field (degrade-to-omit — FR-011). Pure; NEVER throws (parse failures → `undefined`).
 *
 * NEVER receives or returns a token/secret — only the non-secret site origin and the issue key.
 */
export function jiraWebUrl(siteUrl: string | undefined, issueKey: string): string | undefined {
  if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
    return undefined
  }
  if (typeof issueKey !== 'string' || issueKey.trim() === '') {
    return undefined
  }
  let origin: URL
  try {
    origin = new URL(siteUrl)
  } catch {
    return undefined
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return undefined
  }
  // Use the site's origin (drop any path/query) + `/browse/<encoded key>` so a stray
  // trailing slash or path on `siteUrl` cannot produce a double slash or a wrong path.
  return `${origin.origin}/browse/${encodeURIComponent(issueKey)}`
}
