/**
 * Slack OAuth + read-scope configuration (Slack integration v1).
 *
 * cosmos connects Slack via a desktop PKCE browser flow against its OWN registered
 * public client (no client secret, no per-user bot install): the user clicks
 * "Connect Slack", consents in the browser, and cosmos receives a USER OAuth token
 * (`xoxp-…`) that drives every read — channels, history, threads, user lookups, and
 * search — from a single token.
 *
 * Desktop/localhost redirects can request USER scopes only (not bot scopes), so the
 * authorize call sends these as `user_scope` and an empty `scope` (FR-002).
 *
 * READ-ONLY scopes only (FR-002, SC-011): no write scope is ever requested.
 */

/** Slack authorize endpoint (consent page opened in the system browser). */
export const SLACK_AUTHORIZE_ENDPOINT = 'https://slack.com/oauth/v2/authorize'
/** Slack token endpoint (code -> user token exchange; PKCE, no secret). */
export const SLACK_TOKEN_ENDPOINT = 'https://slack.com/api/oauth.v2.access'

/**
 * User-token read scopes requested at authorize time (Slack `user_scope`). A
 * single user token grants all reads including search (search.messages is
 * user-token-only — FR-015).
 */
export const SLACK_USER_OAUTH_SCOPES = [
  'channels:read',
  'channels:history',
  'users:read',
  'search:read'
]

/** Search requires this scope on the user token (FR-015). */
export const SLACK_SEARCH_SCOPE = 'search:read'
