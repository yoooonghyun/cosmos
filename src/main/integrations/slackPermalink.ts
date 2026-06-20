/**
 * slackPermalink — pure helpers for the Slack thread dock's "Open in Slack" link
 * (slack-thread-open-in-slack-v1). The canonical thread permalink is obtained from Slack's
 * own `chat.getPermalink` API (args: `channel` + `message_ts`) — it is NEVER hand-built from
 * `https://<team>.slack.com/archives/…`, so the URL shape can't be guessed wrong.
 *
 * Two responsibilities, both pure + node-testable (no fetch, no token):
 *  - {@link isOpenableWebUrl} — the openable-web-url guard (mirrors the Confluence
 *    `PageDetailTitle` guard): a value is openable iff it parses to an absolute `http(s)` URL.
 *    Re-validates the API-returned string so a non-`http(s)`/malformed value can never become a
 *    live link or cross IPC as a "permalink".
 *  - {@link permalinkFromResponse} — read the `permalink` off a raw `chat.getPermalink` body,
 *    returning it ONLY when it passes the guard; otherwise `undefined` (degrade-to-omit → no
 *    icon, plain header). Total: any odd/absent body yields `undefined`, never throws.
 *
 * NEVER receives or returns a token/secret — only the non-secret canonical web permalink.
 */

/**
 * Whether `url` is a live-openable web URL: a non-empty string that parses to an ABSOLUTE
 * `http:`/`https:` URL. Pure; never throws (parse failures → false). Mirrors the Confluence
 * `isOpenableWebUrl` guard so a non-`http(s)`/malformed value can never become a link.
 */
export function isOpenableWebUrl(url: string | undefined): url is string {
  if (typeof url !== 'string' || url.trim() === '') {
    return false
  }
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Extract the canonical thread permalink from a raw `chat.getPermalink` response body, but
 * ONLY when it is an openable `http(s)` web URL (the {@link isOpenableWebUrl} guard). A missing/
 * non-string/non-`http(s)` `permalink` yields `undefined` so the caller omits the field
 * (degrade-to-omit — no icon, plain header). Total + pure: never throws.
 */
export function permalinkFromResponse(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  const permalink = (body as Record<string, unknown>).permalink
  return isOpenableWebUrl(typeof permalink === 'string' ? permalink : undefined)
    ? permalink
    : undefined
}
