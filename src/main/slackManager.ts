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
 * persists the resulting USER token (`xoxp-…`) that drives every read including
 * search. Pasted/granted user tokens are long-lived with no refresh token, so there
 * is no silent refresh. A reconnect_needed result from any read flips connection
 * state so both surfaces reflect it (SC-007).
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
} from '../shared/slack'
import { SLACK_WRITE_NOT_AUTHORIZED_MESSAGE, SLACK_WRITE_SCOPE } from '../shared/slack'
import type { MessageResolvers, SlackCallAuth, SlackClient } from './integrations/slackClient'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { SlackOAuthResult } from './integrations/slackOAuth'
import { SLACK_SEARCH_SCOPE } from './integrations/slackConfig'
import { SlackCustomEmojiResolver } from './integrations/slackEmojiList'

export interface SlackManagerDeps {
  client: SlackClient
  tokenStore: TokenStore
  /**
   * Run the Slack desktop PKCE OAuth flow (opens the browser, captures the
   * redirect, exchanges the code) and resolve the user token + identity. Injected
   * so the state machine is unit-testable without Electron, the browser, or a
   * network (main wires this to {@link runSlackOAuth}).
   */
  runOAuth: () => Promise<SlackOAuthResult>
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
    this.setState('connecting')

    let oauth: SlackOAuthResult
    try {
      oauth = await this.deps.runOAuth()
    } catch (err) {
      // SC-002: deny/timeout/unreachable -> back to not_connected with a clear
      // reason. Log the failure, NEVER a token.
      this.lastError =
        'Slack connection was cancelled or failed. Click Connect to try again.'
      console.error('[slack] connect failed:', err instanceof Error ? err.message : err)
      this.setState('not_connected')
      return this.getStatus()
    }

    const tokens: StoredTokenSet = {
      accessToken: oauth.userToken,
      scopes: oauth.scopes,
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
   * Load the stored user token. The granted `xoxp` token is long-lived with no
   * refresh token, so there is no silent refresh: either a token is present or the
   * read returns a `not_connected` SlackError. A token later rejected by Slack
   * flips to reconnect_needed via {@link run} (SC-007).
   */
  private async ensureToken(): Promise<StoredTokenSet | SlackResult<never>> {
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      this.setState('not_connected')
      return { ok: false, kind: 'not_connected', message: 'Connect Slack in cosmos first.' }
    }
    return tokens
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
    const result = await fn(ensured)
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
