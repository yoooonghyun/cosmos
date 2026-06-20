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
 * Read scopes drive every read; slack-send-message-v1 adds exactly ONE write scope
 * — `chat:write` — so the user can send a plain-text message (FR-007). A token granted
 * before that feature lacks `chat:write`; the manager gates sends on it and prompts a
 * one-time Reconnect (FR-008/FR-010).
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
  'search:read',
  // slack-rich-message-render-v1 (FR-006): list workspace custom emoji (emoji.list) to render
  // image-backed `:shortcode:` emoji. Read-only; absent → custom emoji degrade to literal (FR-016).
  'emoji:read',
  // slack-attachment-image-broken-v1: download auth-gated files.slack.com image attachments
  // (url_private / thumb_*) through the cosmos-slack-img:// proxy. Read-only; absent → attachment
  // images fetch a non-image (login/403) response and render broken.
  'files:read',
  // slack-send-message-v1 (FR-007): the ONLY write scope — post a plain-text message
  // (chat.postMessage). Absent on a pre-feature token → sends short-circuit to
  // write_not_authorized and the composer prompts a one-time Reconnect (FR-008/FR-010).
  'chat:write'
]

/** Search requires this scope on the user token (FR-015). */
export const SLACK_SEARCH_SCOPE = 'search:read'

/**
 * Sending a message requires this scope on the user token (slack-send-message-v1,
 * FR-007/FR-008). Re-exported from the shared module so the manager's capability
 * gate and the OAuth scope set never disagree on the literal.
 */
export { SLACK_WRITE_SCOPE } from '../../shared/slack'
