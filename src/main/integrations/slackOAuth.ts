/**
 * Slack desktop OAuth flow (PKCE, no client secret) — Slack integration v1.
 *
 * Runs the browser consent flow against cosmos's OWN registered public client and
 * returns a single USER OAuth token (`xoxp-…`) that drives every Slack read. The
 * flow is a thin Slack-specific orchestration over the generic {@link oauthPkce}
 * foundation:
 *
 *   1. generate a PKCE pair (S256) + a CSRF `state`.
 *   2. bind a short-lived loopback listener; once it binds, assemble the authorize
 *      URL with that port's exact `redirect_uri` and open the system browser.
 *   3. capture the redirect (code), verify `state`, close the listener.
 *   4. exchange the code at `oauth.v2.access` with the PKCE verifier and NO secret.
 *   5. read the user token from `authed_user.access_token` (Slack returns no
 *      top-level `access_token` for a user-scope-only grant).
 *
 * Desktop/localhost redirects can request USER scopes only, so the authorize call
 * sends `user_scope` with an empty `scope` (slackConfig). No secret is ever sent;
 * the app must be a PKCE public client with the loopback redirect URLs allowlisted.
 *
 * Side-effecting collaborators (the browser opener, fetch, the http server) are
 * injected so the flow is unit-testable without Electron or a network.
 */

import {
  awaitLoopbackCallback,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeRaw,
  loopbackRedirectUri,
  refreshToken as refreshTokenPkce,
  LOOPBACK_PORTS,
  type FetchLike,
  type ServerFactory,
  type TokenExchangeResult
} from './oauthPkce'
import {
  SLACK_AUTHORIZE_ENDPOINT,
  SLACK_TOKEN_ENDPOINT,
  SLACK_USER_OAUTH_SCOPES
} from './slackConfig'

/** Abandon the consent flow if no redirect arrives within this window. */
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000

export interface RunSlackOAuthDeps {
  /** cosmos's registered public client id (from COSMOS_SLACK_CLIENT_ID). */
  clientId: string
  /** Open the consent URL in the system browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => void | Promise<void>
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Injectable http-server factory (tests pass a fake). */
  serverFactory?: ServerFactory
  /** Optional abort handle to cancel an in-flight connect (threaded to the loopback wait). */
  signal?: AbortSignal
}

/** A completed Slack OAuth — the user token plus non-secret identity/capability. */
export interface SlackOAuthResult {
  /** User OAuth token (`xoxp-…` / rotating `xoxe.xoxp-…`); the single token for every read. */
  userToken: string
  /** Granted user scopes (for capability checks like search availability). */
  scopes: string[]
  /**
   * Refresh token, present ONLY when the Slack app has token rotation enabled — the
   * rotating user token is short-lived (slack-oauth-keeps-unlinking-v1). Absent for a
   * classic non-expiring `xoxp` token. Persisted so the connection refreshes silently
   * instead of expiring into reconnect_needed.
   */
  refreshToken?: string
  /** Seconds until the rotating access token expires (rotation only); absent otherwise. */
  expiresInSeconds?: number
  /** Workspace/team id (non-secret identity). */
  teamId?: string
  /** Workspace/team display name. */
  teamName?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Map Slack's `oauth.v2.access` payload to a {@link SlackOAuthResult}. The user
 * token and granted scopes live under `authed_user`; team identity at top level.
 */
export function mapSlackTokenResponse(raw: Record<string, unknown>): SlackOAuthResult {
  const authedUser = isRecord(raw.authed_user) ? raw.authed_user : undefined
  const userToken =
    typeof authedUser?.access_token === 'string' ? authedUser.access_token : undefined
  if (!userToken) {
    throw new Error('Slack OAuth response missing user access token (authed_user.access_token)')
  }
  const scope = typeof authedUser?.scope === 'string' ? authedUser.scope : ''
  const scopes = scope ? scope.split(',') : []
  const team = isRecord(raw.team) ? raw.team : undefined
  // Token rotation (slack-oauth-keeps-unlinking-v1): when the app has rotation enabled,
  // the rotating user token carries a refresh_token + expires_in alongside it under
  // authed_user. Capture both so the token can refresh instead of silently expiring.
  // Absent for a classic non-expiring xoxp token — the result is byte-for-byte unchanged.
  const refreshToken =
    typeof authedUser?.refresh_token === 'string' ? authedUser.refresh_token : undefined
  const expiresInSeconds =
    typeof authedUser?.expires_in === 'number' ? authedUser.expires_in : undefined
  return {
    userToken,
    scopes,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof expiresInSeconds === 'number' ? { expiresInSeconds } : {}),
    ...(typeof team?.id === 'string' ? { teamId: team.id } : {}),
    ...(typeof team?.name === 'string' ? { teamName: team.name } : {})
  }
}

/**
 * Run the Slack desktop PKCE OAuth flow and resolve the user token + identity.
 * Rejects (via the loopback foundation) on user-deny, state mismatch, timeout, or
 * a Slack token-endpoint error — the manager maps these to a clear lastError.
 */
export async function runSlackOAuth(deps: RunSlackOAuthDeps): Promise<SlackOAuthResult> {
  const pkce = createPkcePair()
  const state = createState()

  const { code, port } = await awaitLoopbackCallback({
    ports: LOOPBACK_PORTS,
    expectedState: state,
    timeoutMs: OAUTH_TIMEOUT_MS,
    serverFactory: deps.serverFactory,
    ...(deps.signal ? { signal: deps.signal } : {}),
    onListening: (boundPort) => {
      const authorizeUrl = buildAuthorizeUrl({
        authorizeEndpoint: SLACK_AUTHORIZE_ENDPOINT,
        clientId: deps.clientId,
        scopes: [],
        userScopes: SLACK_USER_OAUTH_SCOPES,
        redirectUri: loopbackRedirectUri(boundPort),
        state,
        codeChallenge: pkce.codeChallenge
      })
      void deps.openExternal(authorizeUrl)
    }
  })

  const raw = await exchangeCodeRaw({
    tokenEndpoint: SLACK_TOKEN_ENDPOINT,
    clientId: deps.clientId,
    code,
    redirectUri: loopbackRedirectUri(port),
    codeVerifier: pkce.codeVerifier,
    fetchImpl: deps.fetchImpl
  })
  return mapSlackTokenResponse(raw)
}

/** Inputs for a Slack rotating-token refresh (token rotation only). */
export interface RefreshSlackOAuthDeps {
  /** cosmos's registered public client id (from COSMOS_SLACK_CLIENT_ID). */
  clientId: string
  /** The refresh token persisted from a rotation-enabled connect. */
  refreshToken: string
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
}

/**
 * Refresh a rotating Slack user token (slack-oauth-keeps-unlinking-v1). PKCE public
 * client — NO secret, exactly like connect. `oauth.v2.access` with
 * `grant_type=refresh_token` returns the new token at the TOP level (`access_token`,
 * `refresh_token`, `expires_in`), so the generic {@link refreshTokenPkce} maps it. Only
 * invoked when a refresh token was persisted (classic non-expiring tokens never have one).
 */
export function refreshSlackToken(deps: RefreshSlackOAuthDeps): Promise<TokenExchangeResult> {
  return refreshTokenPkce({
    tokenEndpoint: SLACK_TOKEN_ENDPOINT,
    clientId: deps.clientId,
    refreshToken: deps.refreshToken,
    fetchImpl: deps.fetchImpl
  })
}
