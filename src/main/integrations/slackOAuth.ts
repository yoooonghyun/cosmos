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
  LOOPBACK_PORTS,
  type FetchLike,
  type ServerFactory
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
}

/** A completed Slack OAuth — the user token plus non-secret identity/capability. */
export interface SlackOAuthResult {
  /** User OAuth token (`xoxp-…`); the single token for every read. */
  userToken: string
  /** Granted user scopes (for capability checks like search availability). */
  scopes: string[]
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
  return {
    userToken,
    scopes,
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
