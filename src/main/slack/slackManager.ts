/**
 * SlackManager — owns the Slack connection state machine and is the SOLE caller
 * of {@link SlackClient} (FR-008). Both surfaces (the native panel over IPC, the
 * MCP tools over the bridge) route their *operations* through this one manager so
 * they share one token and one connection. The token never leaves main: callers
 * request operations; the manager reads the token from the store and attaches it
 * (FR-006, SC-008).
 *
 * State machine (FR-007):
 *   not_connected -> connecting -> connected -> reconnect_needed
 *
 * Connecting runs the Slack desktop PKCE OAuth flow (no client secret, no per-user
 * bot install): the user clicks Connect, consents in the browser, and the manager
 * persists the resulting USER token that drives every read including search. A classic
 * `xoxp-…` token is long-lived with no refresh token, so there is no silent refresh.
 * When the Slack app has TOKEN ROTATION enabled, connect persists the rotating token's
 * refresh token + expiry, and the manager refreshes it on expiry/401 — otherwise the
 * short-lived rotating token would expire and the connection would keep dropping into
 * reconnect_needed (slack-oauth-keeps-unlinking-v1). A reconnect_needed result from any
 * read flips connection state so both surfaces reflect it (SC-007).
 *
 * The token store, client, and OAuth runner are injected so the state machine is
 * unit-testable without Electron, the browser, or the network.
 */

import type {
  SlackChannel,
  SlackConnectionStatus,
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackMessage,
  SlackPage,
  SlackRepliesParams,
  SlackResult,
  SlackSearchMatch,
  SlackSearchParams,
  SlackSendParams,
  SlackSendResult,
  SlackUser
} from '../../shared/types/slack'
import { SLACK_WRITE_NOT_AUTHORIZED_MESSAGE, SLACK_WRITE_SCOPE } from '../../shared/types/slack'
import type { MessageResolvers, SlackCallAuth, SlackClient } from '../integrations/slackClient'
import type { StoredTokenSet, TokenStore } from '../integrations/tokenStore'
import { expiryFromSeconds } from '../integrations/tokenStore'
import type { SlackOAuthResult } from '../integrations/slackOAuth'
import type { TokenExchangeResult } from '../integrations/oauthPkce'
import { SLACK_SEARCH_SCOPE } from '../integrations/slackConfig'
import { SlackCustomEmojiResolver } from '../integrations/slackEmojiList'

/** Refresh a rotating Slack user token; main wires {@link refreshSlackToken}. */
export type SlackRefreshFn = (refreshToken: string) => Promise<TokenExchangeResult>

export interface SlackManagerDeps {
  client: SlackClient
  tokenStore: TokenStore
  /**
   * Run the Slack desktop PKCE OAuth flow (opens the browser, captures the
   * redirect, exchanges the code) and resolve the user token + identity. Injected
   * so the state machine is unit-testable without Electron, the browser, or a
   * network (main wires this to {@link runSlackOAuth}). The optional `signal` is
   * threaded to the loopback wait so {@link SlackManager.cancelConnect} can abort an
   * in-flight connect (the user closed the browser tab) instead of waiting out the
   * 3-minute timeout.
   */
  runOAuth: (signal?: AbortSignal) => Promise<SlackOAuthResult>
  /**
   * Refresh a rotating user token (slack-oauth-keeps-unlinking-v1). Invoked ONLY when
   * a refresh token was persisted (rotation-enabled apps); a classic non-expiring token
   * never has one, so this is never called for it. Optional so existing call sites /
   * tests that never rotate need not provide it.
   */
  refresh?: SlackRefreshFn
  /** Notify on every state change (main wires this to `slack:statusChanged`). */
  onStatusChanged?: (status: SlackConnectionStatus) => void
}

export class SlackManager {
  private readonly deps: SlackManagerDeps
  private state: SlackConnectionStatus['state'] = 'not_connected'
  /** Reason the most recent connect attempt failed (surfaced to the panel). */
  private lastError: string | null = null
  /**
   * Per-session rich-content resolver cache (slack-rich-message-render-v1, Tracks B/C). Keyed
   * by the live token so a reconnect (new token) rebuilds it; each user-name / custom-emoji
   * lookup is then resolved at most once per session. Rebuilt lazily by {@link resolvers}.
   */
  private resolverCache: { token: string; resolvers: MessageResolvers } | null = null
  /**
   * Single-flight guard for token refresh (slack-oauth-keeps-unlinking-v2). Slack
   * rotating refresh tokens are SINGLE-USE: each refresh call invalidates the token
   * used and issues a new one. Without this guard, two concurrent expired-token reads
   * each call tryRefresh with the same stored refresh token; the first rotates it, the
   * second posts the now-invalid token → Slack returns invalid_refresh_token → the
   * connection flips to reconnect_needed. Coalescing concurrent callers onto the same
   * in-flight promise means exactly one POST is issued per expiry event.
   */
  private refreshInFlight: Promise<StoredTokenSet | null> | null = null
  /**
   * The abort handle for the in-flight connect (slack-oauth-cancel-v1). Held only while
   * `state === 'connecting'` so {@link cancelConnect} can abort the pending loopback wait
   * and immediately return to not_connected (the user closed the browser tab — no `error`
   * redirect arrives, so the flow would otherwise hang for the full OAuth timeout). Cleared
   * when connect settles.
   */
  private connectAbort: AbortController | null = null

  constructor(deps: SlackManagerDeps) {
    this.deps = deps
    // Reflect a previously-persisted connection on startup.
    if (this.deps.tokenStore.has()) {
      this.state = 'connected'
    }
  }

  /** Current connection status (non-secret identity/capability only — SC-008). */
  getStatus(): SlackConnectionStatus {
    const tokens = this.state === 'not_connected' ? null : this.deps.tokenStore.load()
    return {
      state: this.state,
      ...(tokens?.accountName ? { workspaceName: tokens.accountName } : {}),
      ...(tokens?.accountId ? { teamId: tokens.accountId } : {}),
      ...(this.state === 'connected' ? { canSearch: this.canSearch(tokens) } : {}),
      ...(this.state === 'connected' ? { canSend: this.canSend(tokens) } : {}),
      ...(this.state === 'not_connected' && this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private canSearch(tokens: StoredTokenSet | null): boolean {
    if (!tokens) {
      return false
    }
    // One user token drives every read; search is available iff its grant
    // includes search:read (FR-015).
    return Array.isArray(tokens.scopes) && tokens.scopes.includes(SLACK_SEARCH_SCOPE)
  }

  /**
   * Whether the stored token grants `chat:write` (slack-send-message-v1, FR-008/FR-009).
   * Read from the persisted `StoredTokenSet.scopes` (the Jira/Confluence pattern). Returns
   * false when not connected or when the scope is absent (a read-only-era token), so a send
   * short-circuits to `write_not_authorized` WITHOUT calling the client. Surfaced as the
   * non-secret `canSend` status flag so the composer gates itself up front.
   */
  private canSend(tokens: StoredTokenSet | null): boolean {
    if (!tokens) {
      return false
    }
    return Array.isArray(tokens.scopes) && tokens.scopes.includes(SLACK_WRITE_SCOPE)
  }

  /**
   * Public capability probe used by the send short-circuit (FR-008). Reads the granted
   * scopes from the stored token; false on a read-only-era token / not connected.
   */
  getSendCapability(): boolean {
    return this.canSend(this.deps.tokenStore.load())
  }

  private setState(state: SlackConnectionStatus['state']): void {
    this.state = state
    this.deps.onStatusChanged?.(this.getStatus())
  }

  /**
   * Connect via the Slack desktop PKCE OAuth flow (FR-001). Opens the browser for
   * consent, exchanges the code for a USER token (no secret), then persists the
   * token set and moves to connected. On deny/timeout/error, returns to
   * not_connected with a clear lastError. No token is logged or returned to the
   * renderer (SC-008).
   */
  async connect(): Promise<SlackConnectionStatus> {
    if (this.state === 'connecting') {
      return this.getStatus()
    }
    this.lastError = null
    const abort = new AbortController()
    this.connectAbort = abort
    this.setState('connecting')

    let oauth: SlackOAuthResult
    try {
      oauth = await this.deps.runOAuth(abort.signal)
    } catch (err) {
      // SC-002: deny/timeout/cancel/unreachable -> back to not_connected with a clear
      // reason. Log the failure, NEVER a token. A user cancel (cancelConnect aborted the
      // signal) already reset the state to not_connected with its own gentle message; don't
      // clobber it with the generic failure message.
      if (this.connectAbort === abort) {
        this.lastError =
          'Slack connection was cancelled or failed. Click Connect to try again.'
        this.connectAbort = null
        console.error('[slack] connect failed:', err instanceof Error ? err.message : err)
        this.setState('not_connected')
      }
      return this.getStatus()
    }
    this.connectAbort = null

    const tokens: StoredTokenSet = {
      accessToken: oauth.userToken,
      scopes: oauth.scopes,
      // Token rotation (slack-oauth-keeps-unlinking-v1): persist the refresh token + expiry
      // when the app rotates tokens, so the short-lived token can refresh instead of expiring
      // into reconnect_needed. Absent for a classic non-expiring xoxp token (no-op).
      ...(oauth.refreshToken ? { refreshToken: oauth.refreshToken } : {}),
      ...(typeof oauth.expiresInSeconds === 'number'
        ? { expiresAtMs: expiryFromSeconds(oauth.expiresInSeconds) }
        : {}),
      ...(oauth.teamId ? { accountId: oauth.teamId } : {}),
      ...(oauth.teamName ? { accountName: oauth.teamName } : {})
    }
    this.deps.tokenStore.save(tokens)
    this.setState('connected')
    return this.getStatus()
  }

  /** Delete the stored token; return to not_connected (FR-009, SC-010). */
  disconnect(): SlackConnectionStatus {
    this.deps.tokenStore.clear()
    this.resolverCache = null
    this.setState('not_connected')
    return this.getStatus()
  }

  /**
   * Abort an in-flight connect (slack-oauth-cancel-v1). When the user cancels the browser
   * consent (closes/cancels the tab) NO `error` redirect is sent, so the loopback wait would
   * otherwise hang until the 3-minute OAuth timeout — leaving the panel stuck on "Connecting…"
   * and a re-click of Connect a no-op (connect early-returns while connecting). This aborts the
   * pending loopback wait (closing its http server) and immediately returns to not_connected so
   * the user can retry. A no-op when no connect is in flight. Carries NO token/secret.
   */
  cancelConnect(): SlackConnectionStatus {
    if (this.state !== 'connecting' || !this.connectAbort) {
      return this.getStatus()
    }
    const abort = this.connectAbort
    // Reset state BEFORE aborting so the rejected connect()'s `connectAbort === abort` guard
    // is false and it won't re-emit not_connected / overwrite this gentle message.
    this.connectAbort = null
    this.lastError = 'Connection cancelled.'
    this.setState('not_connected')
    abort.abort()
    return this.getStatus()
  }

  /**
   * Ensure a usable access token. A classic `xoxp` token has no refresh token/expiry, so
   * it is returned as-is (no silent refresh). A rotating token (slack-oauth-keeps-unlinking-v1)
   * is refreshed PROACTIVELY when expired so it never lapses into reconnect_needed; a refresh
   * failure flips to reconnect_needed. Returns a structured `not_connected` when no token is stored.
   */
  private async ensureToken(): Promise<StoredTokenSet | SlackResult<never>> {
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      this.setState('not_connected')
      return { ok: false, kind: 'not_connected', message: 'Connect Slack in cosmos first.' }
    }
    if (tokens.refreshToken && this.deps.tokenStore.isExpired()) {
      const refreshed = await this.tryRefresh(tokens)
      if (!refreshed) {
        return {
          ok: false,
          kind: 'reconnect_needed',
          message: 'Your Slack connection expired. Reconnect to continue.'
        }
      }
      return refreshed
    }
    return tokens
  }

  /**
   * Refresh + persist a rotating user token (slack-oauth-keeps-unlinking-v1), preserving the
   * non-secret identity + scopes. Slack rotates the refresh token, so the new one replaces the
   * old (falling back to the existing one if the response omits it). Returns the new set, or
   * null on failure (after flipping to reconnect_needed). NEVER logs the token.
   *
   * Single-flight (slack-oauth-keeps-unlinking-v2): concurrent callers share the same
   * in-flight promise so exactly ONE refresh POST is issued per expiry event — posting the
   * same single-use refresh token twice would invalidate it and force a reconnect.
   */
  private tryRefresh(tokens: StoredTokenSet): Promise<StoredTokenSet | null> {
    if (!tokens.refreshToken || !this.deps.refresh) {
      this.setState('reconnect_needed')
      return Promise.resolve(null)
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }
    this.refreshInFlight = (async () => {
      try {
        const result = await this.deps.refresh!(tokens.refreshToken!)
        const refreshedSet: StoredTokenSet = {
          ...tokens,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken ?? tokens.refreshToken,
          ...(typeof result.expiresInSeconds === 'number'
            ? { expiresAtMs: expiryFromSeconds(result.expiresInSeconds) }
            : {})
        }
        this.deps.tokenStore.save(refreshedSet)
        // A reconnect made the cached resolvers stale (keyed by the old token); drop them.
        this.resolverCache = null
        return refreshedSet
      } catch (err) {
        console.error('[slack] token refresh failed:', err instanceof Error ? err.message : err)
        this.setState('reconnect_needed')
        return null
      } finally {
        this.refreshInFlight = null
      }
    })()
    return this.refreshInFlight
  }

  private auth(tokens: StoredTokenSet): SlackCallAuth {
    return { token: tokens.accessToken }
  }

  /**
   * The live per-call auth (token) for the connected session, or `null` when not connected /
   * no token (slack-rich-message-render-v1, FR-014). MAIN-ONLY: the sole consumer is the
   * `cosmos-slack-img` protocol handler, which attaches the token to its outbound `net.fetch`
   * and never returns it to the renderer. NOT an IPC method; the token is NEVER put in any IPC
   * payload / bridge frame / surface (SC-008). Mirrors {@link ConfluenceManager.currentAuth}.
   */
  currentAuth(): SlackCallAuth | null {
    if (this.state === 'not_connected') {
      return null
    }
    const tokens = this.deps.tokenStore.load()
    return tokens ? this.auth(tokens) : null
  }

  /**
   * Build (or reuse) the per-session rich-content resolvers for a read (Tracks B/C). Cached
   * per token so a reconnect rebuilds them; each user-name lookup is memoized in a Map and the
   * custom-emoji `emoji.list` map is fetched at most once. Both degrade-never-throw: a failed
   * user lookup yields the raw id (FR-004), a failed emoji read yields no custom emoji (FR-016).
   */
  private resolvers(tokens: StoredTokenSet): MessageResolvers {
    if (this.resolverCache && this.resolverCache.token === tokens.accessToken) {
      return this.resolverCache.resolvers
    }
    const auth = this.auth(tokens)
    const nameCache = new Map<string, Promise<string>>()
    const resolveUserName = (id: string): Promise<string> => {
      let p = nameCache.get(id)
      if (!p) {
        p = this.deps.client.getUser(auth, id).then((r) => (r.ok ? r.data.displayName : id))
        nameCache.set(id, p)
      }
      return p
    }
    const emojiResolver = new SlackCustomEmojiResolver(async () => {
      const r = await this.deps.client.getEmojiList(auth)
      return r.ok ? r.data : null
    })
    const resolvers: MessageResolvers = {
      resolveUserName,
      resolveCustomEmojiRef: (shortcode) => emojiResolver.forShortcode(shortcode)
    }
    this.resolverCache = { token: tokens.accessToken, resolvers }
    return resolvers
  }

  /**
   * Run a read through the client, threading a reconnect_needed result back into
   * the state machine so both surfaces reflect a rejected token (SC-007).
   */
  private async run<T>(
    fn: (tokens: StoredTokenSet) => Promise<SlackResult<T>>
  ): Promise<SlackResult<T>> {
    const ensured = await this.ensureToken()
    if ('ok' in ensured) {
      return ensured as SlackResult<T>
    }
    let tokens = ensured
    let result = await fn(tokens)
    // Rotating token (slack-oauth-keeps-unlinking-v1): a reconnect_needed the proactive refresh
    // did not pre-empt (e.g. early revocation) gets ONE reactive refresh + retry before surfacing.
    if (!result.ok && result.kind === 'reconnect_needed' && tokens.refreshToken && this.deps.refresh) {
      const refreshed = await this.tryRefresh(tokens)
      if (refreshed) {
        tokens = refreshed
        result = await fn(tokens)
      }
    }
    if (!result.ok && result.kind === 'reconnect_needed' && this.state !== 'reconnect_needed') {
      this.setState('reconnect_needed')
    }
    return result
  }

  listChannels(
    params: SlackListChannelsParams
  ): Promise<SlackResult<SlackPage<SlackChannel>>> {
    return this.run((t) => this.deps.client.listChannels(this.auth(t), params.cursor))
  }

  getHistory(params: SlackHistoryParams): Promise<SlackResult<SlackPage<SlackMessage>>> {
    return this.run((t) =>
      this.deps.client.getHistory(this.auth(t), params.channelId, params.cursor, this.resolvers(t))
    )
  }

  getReplies(params: SlackRepliesParams): Promise<SlackResult<SlackPage<SlackMessage>>> {
    return this.run((t) =>
      this.deps.client.getReplies(
        this.auth(t),
        params.channelId,
        params.threadTs,
        params.cursor,
        this.resolvers(t)
      )
    )
  }

  search(params: SlackSearchParams): Promise<SlackResult<SlackPage<SlackSearchMatch>>> {
    return this.run((tokens) => {
      // FR-015: search needs search:read on the user token; absent -> unavailable.
      if (!this.canSearch(tokens)) {
        return Promise.resolve<SlackResult<SlackPage<SlackSearchMatch>>>({
          ok: false,
          kind: 'search_unavailable',
          message: "Search isn't available for this connection."
        })
      }
      return this.deps.client.search(
        this.auth(tokens),
        params.query,
        params.cursor,
        this.resolvers(tokens)
      )
    })
  }

  getUser(params: SlackGetUserParams): Promise<SlackResult<SlackUser>> {
    return this.run((t) => this.deps.client.getUser(this.auth(t), params.userId))
  }

  /**
   * Send a plain-text message — the FIRST write (slack-send-message-v1, FR-006/FR-008).
   * Short-circuits to `write_not_authorized` (NO client call) when the stored token lacks
   * `chat:write`; otherwise routes through `run()` so the same `not_connected` /
   * `reconnect_needed` discipline as reads applies (FR-015). A present `threadTs` posts a
   * thread reply; absent posts a channel message. Resolves the posted message `ts`. The
   * token stays in main and never crosses the IPC boundary (SC-006).
   */
  sendMessage(params: SlackSendParams): Promise<SlackResult<SlackSendResult>> {
    return this.run((t) => {
      // FR-008: writing needs chat:write on the user token; absent (a read-only-era
      // token) -> short-circuit to write_not_authorized with NO client call. Checked
      // inside run() (after ensureToken) so a disconnected send still reports
      // not_connected rather than a misleading scope error.
      if (!this.canSend(t)) {
        return Promise.resolve<SlackResult<SlackSendResult>>({
          ok: false,
          kind: 'write_not_authorized',
          message: SLACK_WRITE_NOT_AUTHORIZED_MESSAGE
        })
      }
      return this.deps.client.postMessage(
        this.auth(t),
        params.channelId,
        params.text,
        params.threadTs
      )
    })
  }
}
