/**
 * JiraManager — owns the Jira connection state machine and is the SOLE caller of
 * {@link JiraClient} (FR-A13). Both surfaces (the native panel over IPC, the MCP
 * tools over the bridge) route their *operations* through this one manager so they
 * share one token, one cloudId, and one connection. The token never leaves main:
 * callers request operations; the manager reads the token from the store and
 * attaches it (FR-A11, SC-009).
 *
 * State machine (FR-A12):
 *   not_connected -> connecting -> connected -> reconnect_needed
 *
 * Connecting runs the Atlassian desktop OAuth flow ({@link runAtlassianOAuth}),
 * resolves the site cloudId, and persists the access+refresh token + expiry +
 * cloudId encrypted. Reads transparently refresh on expiry/401 (FR-A09): the
 * rotated token set is persisted and the read retried ONCE. Only when refresh
 * itself fails does the manager flip to reconnect_needed (FR-A10, SC-007).
 *
 * The token store, client, OAuth runner, and refresher are injected so the state
 * machine is unit-testable without Electron, the browser, or the network.
 *
 * Jira generative-UI v1 adds WRITE operations (`transitionIssue`, `addComment`)
 * reached by BOTH the deterministic `jira.*` dispatcher and the write MCP tools —
 * one implementation, two callers (FR-008, FR-010). Writes go through the SAME
 * `run()` refresh path as reads, and short-circuit to `write_not_authorized` when
 * the stored token lacks `write:jira-work` (D4 / FR-013). The token still never
 * leaves main.
 */

import type {
  JiraAddCommentResult,
  JiraCommentParams,
  JiraConnectionStatus,
  JiraCreateParams,
  JiraCreateResult,
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraSearchParams,
  JiraTransitionParams,
  JiraTransitionResult,
  JiraUpdateParams,
  JiraUpdateResult
} from '../shared/jira'
import { JIRA_WRITE_NOT_AUTHORIZED_MESSAGE, JIRA_WRITE_SCOPE } from '../shared/jira'
import type { JiraCallAuth, JiraClient } from './integrations/jiraClient'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { AtlassianOAuthResult } from './integrations/atlassianOAuth'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import { expiryFromSeconds } from './integrations/tokenStore'

/** A refresh callback the manager invokes when the access token is expired/rejected. */
export type RefreshFn = (refreshToken: string) => Promise<TokenExchangeResult>

export interface JiraManagerDeps {
  client: JiraClient
  tokenStore: TokenStore
  /**
   * Run the Atlassian desktop OAuth flow for Jira (opens the browser, captures the
   * redirect, exchanges the code, resolves cloudId). Injected so the state machine
   * is unit-testable (main wires this to {@link runAtlassianOAuth} with the Jira scopes).
   */
  runOAuth: () => Promise<AtlassianOAuthResult>
  /** Refresh the access token (rotation — FR-A09); main wires {@link refreshAtlassianToken}. */
  refresh: RefreshFn
  /** Notify on every state change (main wires this to `jira:statusChanged`). */
  onStatusChanged?: (status: JiraConnectionStatus) => void
}

export class JiraManager {
  private readonly deps: JiraManagerDeps
  private state: JiraConnectionStatus['state'] = 'not_connected'
  private lastError: string | null = null

  constructor(deps: JiraManagerDeps) {
    this.deps = deps
    if (this.deps.tokenStore.has()) {
      this.state = 'connected'
    }
  }

  /** Current connection status (non-secret identity only — SC-009). */
  getStatus(): JiraConnectionStatus {
    const tokens = this.state === 'not_connected' ? null : this.deps.tokenStore.load()
    const siteName = readSiteName(tokens)
    return {
      state: this.state,
      ...(siteName ? { siteName } : {}),
      ...(tokens?.accountName ? { accountName: tokens.accountName } : {}),
      ...(this.state === 'not_connected' && this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private setState(state: JiraConnectionStatus['state']): void {
    this.state = state
    this.deps.onStatusChanged?.(this.getStatus())
  }

  /**
   * Connect via the Atlassian desktop OAuth flow (FR-A01). Opens the browser for
   * consent, exchanges the code, resolves cloudId, then persists the token set and
   * moves to connected. On deny/timeout/error/no-site, returns to not_connected
   * with a clear lastError. No token is logged or returned to the renderer (SC-009).
   */
  async connect(): Promise<JiraConnectionStatus> {
    if (this.state === 'connecting') {
      return this.getStatus()
    }
    this.lastError = null
    this.setState('connecting')

    let oauth: AtlassianOAuthResult
    try {
      oauth = await this.deps.runOAuth()
    } catch (err) {
      this.lastError = 'Jira connection was cancelled or failed. Click Connect to try again.'
      console.error('[jira] connect failed:', err instanceof Error ? err.message : err)
      this.setState('not_connected')
      return this.getStatus()
    }

    this.deps.tokenStore.save(toStoredTokenSet(oauth))
    this.setState('connected')
    return this.getStatus()
  }

  /** Delete the stored token; return to not_connected (FR-A14). Only this product's token. */
  disconnect(): JiraConnectionStatus {
    this.deps.tokenStore.clear()
    this.setState('not_connected')
    return this.getStatus()
  }

  private auth(tokens: StoredTokenSet): JiraCallAuth {
    return { token: tokens.accessToken, cloudId: readCloudId(tokens) }
  }

  /**
   * Ensure a usable access token: load it, refresh PROACTIVELY when expired
   * (FR-A09), persist the rotated set, and return it. A refresh failure flips to
   * reconnect_needed and returns a structured error (FR-A10, SC-007).
   */
  private async ensureToken(): Promise<StoredTokenSet | JiraResult<never>> {
    const tokens = this.deps.tokenStore.load()
    if (!tokens) {
      this.setState('not_connected')
      return { ok: false, kind: 'not_connected', message: 'Connect Jira in cosmos first.' }
    }
    if (this.deps.tokenStore.isExpired() && tokens.refreshToken) {
      const refreshed = await this.tryRefresh(tokens)
      if (!refreshed) {
        return { ok: false, kind: 'reconnect_needed', message: 'Your Jira connection expired. Reconnect to continue.' }
      }
      return refreshed
    }
    return tokens
  }

  /**
   * Refresh + persist the rotated token set, preserving the non-secret identity
   * (cloudId, site, account). Returns the new set, or null on failure (after
   * flipping to reconnect_needed). NEVER logs the token (SC-009).
   */
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
      console.error('[jira] token refresh failed:', err instanceof Error ? err.message : err)
      this.setState('reconnect_needed')
      return null
    }
  }

  /**
   * Run a read: ensure a token (refreshing on expiry), call the client, and — if
   * the call returns `reconnect_needed` (a 401/403 the proactive refresh did not
   * pre-empt) — attempt ONE reactive refresh + retry before surfacing it (FR-A09,
   * SC-007).
   */
  private async run<T>(
    fn: (auth: JiraCallAuth) => Promise<JiraResult<T>>
  ): Promise<JiraResult<T>> {
    const ensured = await this.ensureToken()
    if ('ok' in ensured) {
      return ensured as JiraResult<T>
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

  searchIssues(params: JiraSearchParams): Promise<JiraResult<JiraPage<JiraIssueSummary>>> {
    return this.run((auth) => this.deps.client.searchIssues(auth, params.jql, params.cursor))
  }

  getIssue(params: JiraGetIssueParams): Promise<JiraResult<JiraIssueDetail>> {
    return this.run((auth) => this.deps.client.getIssue(auth, params.issueKey))
  }

  /**
   * Whether the stored token grants `write:jira-work` (Jira generative-UI v1, D4 /
   * FR-013). Read from the persisted `StoredTokenSet.scopes`. Returns false when not
   * connected or when the scope is absent (a read-only-era token), so a write
   * short-circuits to `write_not_authorized` WITHOUT calling the client.
   */
  getWriteCapability(): boolean {
    const tokens = this.deps.tokenStore.load()
    return Array.isArray(tokens?.scopes) && tokens.scopes.includes(JIRA_WRITE_SCOPE)
  }

  /**
   * Transition an issue (FR-010, FR-013). Short-circuits to `write_not_authorized`
   * when the stored token lacks `write:jira-work` (no client call — D4); otherwise
   * routes through `run()` so the same proactive/reactive refresh + `reconnect_needed`
   * handling as reads applies to writes (FR-010).
   */
  transitionIssue(params: JiraTransitionParams): Promise<JiraResult<JiraTransitionResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.transitionIssue(auth, params))
  }

  /**
   * Add a comment to an issue (FR-010, FR-013). Same scope short-circuit + `run()`
   * refresh discipline as {@link transitionIssue}.
   */
  addComment(params: JiraCommentParams): Promise<JiraResult<JiraAddCommentResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.addComment(auth, params.issueKey, params.body))
  }

  /**
   * Create a new issue (Jira write-extend v1, FR-010, FR-014). Same scope
   * short-circuit (`write_not_authorized` when the token lacks `write:jira-work`,
   * no client call) + `run()` refresh discipline as the existing writes. Returns the
   * new issue key for the dispatcher's post-create re-read (OQ1).
   */
  createIssue(params: JiraCreateParams): Promise<JiraResult<JiraCreateResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.createIssue(auth, params))
  }

  /**
   * Update an existing issue's fields (Jira write-extend v1, FR-010, FR-014). Same
   * scope short-circuit + `run()` refresh discipline as the other writes.
   */
  updateIssue(params: JiraUpdateParams): Promise<JiraResult<JiraUpdateResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.updateIssue(auth, params))
  }

  /** The structured scope-gap result returned for a write without `write:jira-work` (D4). */
  private writeNotAuthorized(): JiraResult<never> {
    return {
      ok: false,
      kind: 'write_not_authorized',
      message: JIRA_WRITE_NOT_AUTHORIZED_MESSAGE
    }
  }
}

/** Map a completed OAuth result to the persisted token set (cloudId/site in `extra`). */
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
