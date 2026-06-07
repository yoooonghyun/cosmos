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
  ConfluenceConnectionStatus,
  ConfluenceCreateParams,
  ConfluenceCreateResult,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult
} from '../shared/confluence'
import {
  CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE,
  CONFLUENCE_WRITE_SCOPE
} from '../shared/confluence'
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
  /** Run the Atlassian OAuth flow for Confluence (main wires {@link runAtlassianOAuth}). */
  runOAuth: () => Promise<AtlassianOAuthResult>
  /** Refresh the access token (rotation — FR-A09); main wires {@link refreshAtlassianToken}. */
  refresh: RefreshFn
  /** Notify on every state change (main wires this to `confluence:statusChanged`). */
  onStatusChanged?: (status: ConfluenceConnectionStatus) => void
}

export class ConfluenceManager {
  private readonly deps: ConfluenceManagerDeps
  private state: ConfluenceConnectionStatus['state'] = 'not_connected'
  private lastError: string | null = null

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
    this.setState('connecting')

    let oauth: AtlassianOAuthResult
    try {
      oauth = await this.deps.runOAuth()
    } catch (err) {
      this.lastError =
        'Confluence connection was cancelled or failed. Click Connect to try again.'
      console.error('[confluence] connect failed:', err instanceof Error ? err.message : err)
      this.setState('not_connected')
      return this.getStatus()
    }

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

  private auth(tokens: StoredTokenSet): ConfluenceCallAuth {
    return { token: tokens.accessToken, cloudId: readCloudId(tokens) }
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

  getPage(params: ConfluenceGetPageParams): Promise<ConfluenceResult<ConfluencePageDetail>> {
    return this.run((auth) => this.deps.client.getPage(auth, params.pageId))
  }

  /**
   * Whether the stored token grants `write:confluence-content`. Read from the
   * persisted `StoredTokenSet.scopes`. False when not connected or when the scope is
   * absent (a read-only-era token), so a create short-circuits to
   * `write_not_authorized` WITHOUT calling the client.
   */
  getWriteCapability(): boolean {
    const tokens = this.deps.tokenStore.load()
    return Array.isArray(tokens?.scopes) && tokens.scopes.includes(CONFLUENCE_WRITE_SCOPE)
  }

  /**
   * Create a page (the single Confluence write). Short-circuits to
   * `write_not_authorized` when the stored token lacks the write scope (no client
   * call); otherwise routes through `run()` so the same proactive/reactive refresh +
   * `reconnect_needed` handling as reads applies.
   */
  createPage(params: ConfluenceCreateParams): Promise<ConfluenceResult<ConfluenceCreateResult>> {
    if (!this.getWriteCapability()) {
      return Promise.resolve(this.writeNotAuthorized())
    }
    return this.run((auth) => this.deps.client.createPage(auth, params))
  }

  /** The structured scope-gap result returned for a create without the write scope. */
  private writeNotAuthorized(): ConfluenceResult<never> {
    return {
      ok: false,
      kind: 'write_not_authorized',
      message: CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE
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
