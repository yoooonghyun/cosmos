/**
 * ConfluenceManager — owns the Confluence connection state machine and is the SOLE
 * caller of {@link ConfluenceClient} (FR-A13). Fully separate from JiraManager
 * (independent token store entry, connection state) per FR-A13. Both surfaces
 * (the native panel over IPC, the MCP tools over the bridge) route their
 * *operations* through this one manager so they share one token, one cloudId, and
 * one connection. The token never leaves main (FR-A11, SC-009).
 *
 * State machine (FR-A12): not_connected -> connecting -> connected -> reconnect_needed.
 * Reads transparently refresh on expiry/401 (FR-A09); only a refresh failure flips
 * to reconnect_needed (FR-A10, SC-007).
 *
 * The token store, client, OAuth runner, and refresher are injected so the state
 * machine is unit-testable without Electron, the browser, or the network.
 */

import type {
  ConfluenceCommentParams,
  ConfluenceCommentResult,
  ConfluenceConnectionStatus,
  ConfluenceCreateParams,
  ConfluenceCreateResult,
  ConfluenceDefaultFeedParams,
  ConfluenceGetCommentsParams,
  ConfluenceGetCommentsResult,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult,
  ConfluenceUpdateParams,
  ConfluenceUpdateResult
} from '../shared/types/confluence'
import {
  CONFLUENCE_COMMENT_NOT_AUTHORIZED_MESSAGE,
  CONFLUENCE_COMMENT_READ_NOT_AUTHORIZED_MESSAGE,
  CONFLUENCE_COMMENT_READ_SCOPE,
  CONFLUENCE_COMMENT_SCOPE,
  CONFLUENCE_USER_READ_SCOPE,
  CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE,
  CONFLUENCE_WRITE_SCOPE
} from '../shared/types/confluence'
import type { ConfluenceCallAuth, ConfluenceClient } from './integrations/confluenceClient'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { AtlassianOAuthResult } from './integrations/atlassianOAuth'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import { expiryFromSeconds } from './integrations/tokenStore'

/** A refresh callback the manager invokes when the access token is expired/rejected. */
export type RefreshFn = (refreshToken: string) => Promise<TokenExchangeResult>

export interface ConfluenceManagerDeps {
  client: ConfluenceClient
  tokenStore: TokenStore
  /**
   * Run the Atlassian OAuth flow for Confluence (main wires {@link runAtlassianOAuth}). The
   * optional `signal` is threaded to the loopback wait so {@link ConfluenceManager.cancelConnect}
   * can abort an in-flight connect instead of waiting out the 3-minute OAuth timeout.
   */
  runOAuth: (signal?: AbortSignal) => Promise<AtlassianOAuthResult>
  /** Refresh the access token (rotation — FR-A09); main wires {@link refreshAtlassianToken}. */
  refresh: RefreshFn
  /** Notify on every state change (main wires this to `confluence:statusChanged`). */
  onStatusChanged?: (status: ConfluenceConnectionStatus) => void
}

export class ConfluenceManager {
  private readonly deps: ConfluenceManagerDeps
  private state: ConfluenceConnectionStatus['state'] = 'not_connected'
  private lastError: string | null = null
  /**
   * Abort handle for the in-flight connect (oauth-cancel-v1). Held only while `connecting`
   * so {@link cancelConnect} can abort the pending loopback wait. Cleared when connect settles.
   */
  private connectAbort: AbortController | null = null

  constructor(deps: ConfluenceManagerDeps) {
    this.deps = deps
    if (this.deps.tokenStore.has()) {
      this.state = 'connected'
    }
  }

  /** Current connection status (non-secret identity only — SC-009). */
  getStatus(): ConfluenceConnectionStatus {
    const tokens = this.state === 'not_connected' ? null : this.deps.tokenStore.load()
    const siteName = readSiteName(tokens)
    return {
      state: this.state,
      ...(siteName ? { siteName } : {}),
      ...(tokens?.accountName ? { accountName: tokens.accountName } : {}),
      ...(this.state === 'not_connected' && this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private setState(state: ConfluenceConnectionStatus['state']): void {
    this.state = state
    this.deps.onStatusChanged?.(this.getStatus())
  }

  /**
   * Connect via the Atlassian desktop OAuth flow (FR-A01). On deny/timeout/error/
   * no-site, returns to not_connected with a clear lastError. No token is logged or
   * returned to the renderer (SC-009).
   */
  async connect(): Promise<ConfluenceConnectionStatus> {
    if (this.state === 'connecting') {
      return this.getStatus()
    }
    this.lastError = null
    const abort = new AbortController()
    this.connectAbort = abort
    this.setState('connecting')

    let oauth: AtlassianOAuthResult
    try {
      oauth = await this.deps.runOAuth(abort.signal)
    } catch (err) {
      // A user cancel (cancelConnect aborted the signal) already reset state with its own
      // gentle message; the `connectAbort === abort` guard keeps this branch from clobbering it.
      if (this.connectAbort === abort) {
        this.lastError =
          'Confluence connection was cancelled or failed. Click Connect to try again.'
        this.connectAbort = null
        console.error('[confluence] connect failed:', err instanceof Error ? err.message : err)
        this.setState('not_connected')
      }
      return this.getStatus()
    }
    this.connectAbort = null

    this.deps.tokenStore.save(toStoredTokenSet(oauth))
    this.setState('connected')
    return this.getStatus()
  }

  /** Delete the stored token; return to not_connected (FR-A14). Only this product's token. */
  disconnect(): ConfluenceConnectionStatus {
    this.deps.tokenStore.clear()
    this.setState('not_connected')
    return this.getStatus()
  }

  /**
   * Abort an in-flight connect (oauth-cancel-v1). A cancelled browser consent sends no `error`
   * redirect, so the loopback wait would hang until the 3-minute OAuth timeout. This aborts the
   * pending wait and returns to not_connected so the user can retry. No-op when no connect is in
   * flight; carries no token/secret.
   */
  cancelConnect(): ConfluenceConnectionStatus {
    if (this.state !== 'connecting' || !this.connectAbort) {
      return this.getStatus()
    }
    const abort = this.connectAbort
    this.connectAbort = null
    this.lastError = 'Connection cancelled.'
    this.setState('not_connected')
    abort.abort()
    return this.getStatus()
  }

  private auth(tokens: StoredTokenSet): ConfluenceCallAuth {
    const siteUrl = readSiteUrl(tokens)
    return {
      token: tokens.accessToken,
      cloudId: readCloudId(tokens),
      // Non-secret site web origin (e.g. https://acme.atlassian.net) used ONLY to assemble
      // the page web URL in getPage (confluence-link-404-v1 #100). Absent on legacy tokens.
      ...(siteUrl ? { siteUrl } : {})
    }
  }

  /**
   * The live per-call auth (token + cloudId) for the connected session, or `null` when not
   * connected / no token (confluence-content-images-v1, FR-003). MAIN-ONLY: the sole consumer
   * is the `cosmos-confluence-img` protocol handler, which attaches the token to its outbound
   * `net.fetch` and never returns it to the renderer. This is NOT an IPC method and the token
   * is NEVER put in any IPC payload / bridge frame / surface (SC-009 / FR-002).
   *
   * Synchronous (the protocol resolver is sync) and does NOT proactively refresh: an expired
   * token simply yields a 401 → graceful broken image (FR-010), and the next interactive read
   * runs the normal `ensureToken` refresh/reconnect path. Returns the CURRENT stored token, so
   * a refresh applied by a concurrent read is reflected on the next image request.
   */
  currentAuth(): ConfluenceCallAuth | null {
    if (this.state === 'not_connected') {
      return null
    }
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      return null
    }
    return this.auth(tokens)
  }

  private async ensureToken(): Promise<StoredTokenSet | ConfluenceResult<never>> {
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      this.setState('not_connected')
      return { ok: false, kind: 'not_connected', message: 'Connect Confluence in cosmos first.' }
    }
    if (this.deps.tokenStore.isExpired() && tokens.refreshToken) {
      const refreshed = await this.tryRefresh(tokens)
      if (!refreshed) {
        return {
          ok: false,
          kind: 'reconnect_needed',
          message: 'Your Confluence connection expired. Reconnect to continue.'
        }
      }
      return refreshed
    }
    return tokens
  }

  private async tryRefresh(tokens: StoredTokenSet): Promise<StoredTokenSet | null> {
    if (!tokens.refreshToken) {
      this.setState('reconnect_needed')
      return null
    }
    try {
      const result = await this.deps.refresh(tokens.refreshToken)
      const rotated: StoredTokenSet = {
        ...tokens,
        accessToken: result.accessToken,
        ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
        ...(typeof result.expiresInSeconds === 'number'
          ? { expiresAtMs: expiryFromSeconds(result.expiresInSeconds) }
          : {})
      }
      this.deps.tokenStore.save(rotated)
      return rotated
    } catch (err) {
      console.error('[confluence] token refresh failed:', err instanceof Error ? err.message : err)
      this.setState('reconnect_needed')
      return null
    }
  }

  private async run<T>(
    fn: (auth: ConfluenceCallAuth) => Promise<ConfluenceResult<T>>
  ): Promise<ConfluenceResult<T>> {
    const ensured = await this.ensureToken()
    if ('ok' in ensured) {
      return ensured as ConfluenceResult<T>
    }
    let tokens = ensured
    let result = await fn(this.auth(tokens))
    if (!result.ok && result.kind === 'reconnect_needed' && tokens.refreshToken) {
      const refreshed = await this.tryRefresh(tokens)
      if (refreshed) {
        tokens = refreshed
        result = await fn(this.auth(tokens))
      }
    }
    if (!result.ok && result.kind === 'reconnect_needed' && this.state !== 'reconnect_needed') {
      this.setState('reconnect_needed')
    }
    return result
  }

  searchContent(
    params: ConfluenceSearchParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> {
    return this.run((auth) => this.deps.client.searchContent(auth, params.query, params.cursor))
  }

  /**
   * The default personal activity feed (confluence-default-feed v1, FR-014). Routes
   * through `run()` so it inherits the same proactive/reactive token refresh +
   * `reconnect_needed` handling as the other reads and returns the same
   * `ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>` shape. Read-only — no
   * scope/write logic (FR-012); the fixed personal CQL lives in the client.
   */
  defaultFeed(
    params: ConfluenceDefaultFeedParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> {
    return this.run((auth) => this.deps.client.defaultFeed(auth, params.cursor))
  }

  getPage(params: ConfluenceGetPageParams): Promise<ConfluenceResult<ConfluencePageDetail>> {
    return this.run((auth) => this.deps.client.getPage(auth, params.pageId))
  }

  /**
   * Whether the stored token grants `write:page:confluence` (page create/update). Read
   * from the persisted `StoredTokenSet.scopes`. False when not connected or when the
   * scope is absent (a read-only-era token), so a create/update short-circuits to
   * `write_not_authorized` WITHOUT calling the client.
   */
  getWriteCapability(): boolean {
    const tokens = this.deps.tokenStore.load()
    return Array.isArray(tokens?.scopes) && tokens.scopes.includes(CONFLUENCE_WRITE_SCOPE)
  }

  /**
   * Whether the stored token grants `write:comment:confluence` (footer comments). Read
   * from the persisted `StoredTokenSet.scopes`. False when not connected or when the
   * scope is absent (a token granted before the comment scope was added), so a comment
   * short-circuits to `write_not_authorized` WITHOUT calling the client — the user must
   * reconnect to grant the new comment consent.
   */
  getCommentCapability(): boolean {
    const tokens = this.deps.tokenStore.load()
    return Array.isArray(tokens?.scopes) && tokens.scopes.includes(CONFLUENCE_COMMENT_SCOPE)
  }

  /**
   * Whether the stored token grants `read:comment:confluence` (read a page's footer
   * comments — confluence-dock-comments-v1, FR-004). Read from the persisted
   * `StoredTokenSet.scopes`. False when not connected or when the scope is absent (the
   * default for every connection made before this scope was added), so a comments READ
   * short-circuits to `comment_read_not_authorized` WITHOUT calling the client — the user
   * reconnects ONCE to grant it. INDEPENDENT of the comment-WRITE capability (FR-007): one
   * missing does not disable the other.
   */
  getCommentReadCapability(): boolean {
    const tokens = this.deps.tokenStore.load()
    return Array.isArray(tokens?.scopes) && tokens.scopes.includes(CONFLUENCE_COMMENT_READ_SCOPE)
  }

  /**
   * Create a page (a Confluence write). Short-circuits to `write_not_authorized` when
   * the stored token lacks the page-write scope (no client call); otherwise routes
   * through `run()` so the same proactive/reactive refresh + `reconnect_needed` handling
   * as reads applies.
   */
  createPage(params: ConfluenceCreateParams): Promise<ConfluenceResult<ConfluenceCreateResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.createPage(auth, params))
  }

  /**
   * Update an existing page (confluence-mcp-write-v1). Mirrors `createPage`:
   * short-circuits to `write_not_authorized` when the token lacks the page-write scope
   * (no client call); otherwise routes through `run()`. The client reads the current
   * version + body and submits version+1; a stale-version race surfaces as
   * `version_conflict` (FR-009b) — no clobber, no crash.
   */
  updatePage(params: ConfluenceUpdateParams): Promise<ConfluenceResult<ConfluenceUpdateResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.updatePage(auth, params))
  }

  /**
   * Add a footer comment to a page (confluence-mcp-write-v1). Gated on the SEPARATE
   * `write:comment:confluence` scope: short-circuits to `write_not_authorized` (with the
   * comment-specific reconnect message) when absent (no client call); otherwise routes
   * through `run()`.
   */
  createComment(
    params: ConfluenceCommentParams
  ): Promise<ConfluenceResult<ConfluenceCommentResult>> {
    if (!this.getCommentCapability()) {
      return Promise.resolve(this.commentNotAuthorized())
    }
    return this.run((auth) => this.deps.client.createComment(auth, params))
  }

  /**
   * Read a page's footer comments (confluence-dock-comments-v1, FR-003). Gated on the
   * SEPARATE `read:comment:confluence` scope: short-circuits to `comment_read_not_authorized`
   * (no client call) when absent so the dock surfaces a calm reconnect affordance; otherwise
   * routes through `run()` so it inherits the same refresh + `reconnect_needed` handling as
   * the other reads. INDEPENDENT of the comment-write capability (FR-007).
   */
  getComments(
    params: ConfluenceGetCommentsParams
  ): Promise<ConfluenceResult<ConfluenceGetCommentsResult>> {
    if (!this.getCommentReadCapability()) {
      return Promise.resolve(this.commentReadNotAuthorized())
    }
    // confluence-comment-author-name-v1: the author display-NAME lookup needs a SEPARATE
    // `read:user:confluence` scope. When the stored token lacks it (connected before the scope
    // was added, OR the Atlassian app registration never enabled it), the per-author lookup 403s
    // silently and every author renders as the raw account id. This is the single recurring
    // "author shows uuid" cause — surface it ONCE per read as an actionable main-process warning
    // (no token logged) instead of failing invisibly. Reads still proceed (names are best-effort).
    const tokens = this.deps.tokenStore.load()
    if (Array.isArray(tokens?.scopes) && !tokens.scopes.includes(CONFLUENCE_USER_READ_SCOPE)) {
      console.warn(
        `[confluence] author names will show as account ids: the connected token is missing the ` +
          `"${CONFLUENCE_USER_READ_SCOPE}" scope. Disconnect + reconnect Confluence (and ensure that ` +
          `scope is enabled on the Atlassian app registration) to resolve author display names.`
      )
    }
    return this.run((auth) => this.deps.client.getComments(auth, params))
  }

  /**
   * Add a footer comment from the renderer dock (confluence-dock-comments-v1, FR-006). REUSES
   * the existing {@link createComment} (the SINGLE comment-write impl — same
   * `write:comment:confluence` gate, same client call). No second write path. Gated
   * INDEPENDENTLY of the comment-read capability (FR-007).
   */
  addComment(
    params: ConfluenceCommentParams
  ): Promise<ConfluenceResult<ConfluenceCommentResult>> {
    return this.createComment(params)
  }

  /** The structured scope-gap result returned for a page write without the page-write scope. */
  private writeNotAuthorized(): ConfluenceResult<never> {
    return {
      ok: false,
      kind: 'write_not_authorized',
      message: CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE
    }
  }

  /** The structured scope-gap result returned for a comment without the comment-write scope. */
  private commentNotAuthorized(): ConfluenceResult<never> {
    return {
      ok: false,
      kind: 'write_not_authorized',
      message: CONFLUENCE_COMMENT_NOT_AUTHORIZED_MESSAGE
    }
  }

  /**
   * The structured scope-gap result returned for a comments READ without the
   * `read:comment:confluence` scope (confluence-dock-comments-v1, FR-004). A distinct
   * `comment_read_not_authorized` kind so the dock branches to a calm reconnect affordance
   * rather than an error tone.
   */
  private commentReadNotAuthorized(): ConfluenceResult<never> {
    return {
      ok: false,
      kind: 'comment_read_not_authorized',
      message: CONFLUENCE_COMMENT_READ_NOT_AUTHORIZED_MESSAGE
    }
  }
}

function toStoredTokenSet(oauth: AtlassianOAuthResult): StoredTokenSet {
  return {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    ...(typeof oauth.expiresAtMs === 'number' ? { expiresAtMs: oauth.expiresAtMs } : {}),
    scopes: oauth.scopes,
    ...(oauth.siteName ? { accountName: oauth.siteName } : {}),
    extra: {
      cloudId: oauth.cloudId,
      ...(oauth.siteName ? { siteName: oauth.siteName } : {}),
      ...(oauth.siteUrl ? { siteUrl: oauth.siteUrl } : {})
    }
  }
}

function readCloudId(tokens: StoredTokenSet): string {
  const extra = tokens.extra
  return extra && typeof extra.cloudId === 'string' ? extra.cloudId : ''
}

/**
 * The persisted site web ORIGIN (OAuth accessible-resources `url`, e.g.
 * `https://acme.atlassian.net`), threaded to `getPage` to build the user-facing page web
 * URL (confluence-link-404-v1 #100). Non-secret. Absent on legacy token sets that predate
 * persisting `siteUrl` → the "Open in Confluence" affordance simply omits.
 */
function readSiteUrl(tokens: StoredTokenSet): string | undefined {
  const extra = tokens.extra
  return extra && typeof extra.siteUrl === 'string' && extra.siteUrl !== ''
    ? extra.siteUrl
    : undefined
}

function readSiteName(tokens: StoredTokenSet | null): string | undefined {
  if (!tokens) {
    return undefined
  }
  const extra = tokens.extra
  if (extra && typeof extra.siteName === 'string') {
    return extra.siteName
  }
  return tokens.accountName
}
