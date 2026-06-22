/**
 * Google desktop OAuth flow + identity resolution + token refresh (Google Calendar
 * integration v1). A thin orchestrator over the generic {@link oauthPkce} foundation,
 * mirroring `atlassianOAuth.ts` but for a CONFIDENTIAL client (Google requires the
 * client_secret at the token POST) and read-only Calendar scope.
 *
 * Flow:
 *   1. generate a PKCE pair (S256) + a CSRF `state`.
 *   2. bind a short-lived loopback listener; once it binds, assemble the authorize URL
 *      with that port's exact `redirect_uri` (the Calendar scope, `access_type=offline`
 *      + `prompt=consent` so Google issues a refresh token) and open the system browser.
 *   3. capture the redirect (code), verify `state`, close the listener.
 *   4. exchange the code at `oauth2.googleapis.com/token` WITH the client_secret
 *      (confidential client). Google issues a refresh token ONLY when offline access +
 *      consent were requested; if none is returned, connect FAILS (the manager can't
 *      transparently refresh) — we throw a clear error rather than store a non-refreshable
 *      token.
 *   5. resolve identity (account email / name / time zone) via the primary-calendar read.
 *
 * The client_secret is read in main only and is NEVER logged, IPC'd, bridged, or
 * returned in any result. Side-effecting collaborators (the browser opener, fetch, the
 * http server) are injected so the flow is unit-testable without Electron or a network.
 */

import {
  awaitLoopbackCallback,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCodeRaw,
  loopbackRedirectUri,
  LOOPBACK_PORTS,
  refreshToken,
  type FetchLike,
  type ServerFactory,
  type TokenExchangeResult
} from './oauthPkce'
import {
  GOOGLE_AUTHORIZE_ENDPOINT,
  GOOGLE_AUTHORIZE_EXTRA_PARAMS,
  GOOGLE_AUTHORIZE_PROMPT,
  GOOGLE_TOKEN_ENDPOINT
} from './googleConfig'
import { GoogleCalendarClient } from './googleCalendarClient'

/** Abandon the consent flow if no redirect arrives within this window. */
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000

export interface RunGoogleOAuthDeps {
  /** The Calendar read scope(s). */
  scopes: string[]
  /** cosmos's registered Google client id (from COSMOS_GOOGLE_CLIENT_ID / Settings). */
  clientId: string
  /**
   * cosmos's Google client secret (Google is a confidential client — required at the
   * token POST). When unset, connect fails fast with a "not configured" message. Never
   * logged / IPC'd / bridged / in a result.
   */
  clientSecret: string
  /** Open the consent URL in the system browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => void | Promise<void>
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Injectable http-server factory (tests pass a fake). */
  serverFactory?: ServerFactory
  /** Optional abort handle to cancel an in-flight connect (threaded to the loopback wait). */
  signal?: AbortSignal
}

/** A completed Google OAuth — tokens + non-secret account identity. */
export interface GoogleOAuthResult {
  /** The Bearer access token (expires ~1h). */
  accessToken: string
  /** The refresh token (required — Google issues it under offline access + consent). */
  refreshToken: string
  /** Absolute access-token expiry as epoch ms, when known. */
  expiresAtMs?: number
  /** Granted scopes (persisted in the token set). */
  scopes: string[]
  /** Primary-calendar account email (non-secret identity). */
  accountEmail?: string
  /** Account display name (non-secret identity). */
  accountName?: string
  /** Primary calendar time zone (IANA). */
  timeZone?: string
}

function scopesFromRaw(raw: Record<string, unknown>, fallback: string[]): string[] {
  if (typeof raw.scope === 'string' && raw.scope.trim() !== '') {
    return raw.scope.split(/\s+/)
  }
  return fallback
}

/**
 * Run the Google desktop OAuth flow and resolve the token set + identity. Rejects
 * (via the loopback foundation) on user-deny, state mismatch, timeout, a token-endpoint
 * error, a missing refresh token, or an identity-read failure — the manager maps these
 * to a clear lastError. Tokens are returned to the manager (in-process only), which
 * persists them encrypted; they never leave main.
 */
export async function runGoogleOAuth(deps: RunGoogleOAuthDeps): Promise<GoogleOAuthResult> {
  if (!deps.clientSecret) {
    throw new Error('Google Calendar is not configured (missing client secret).')
  }
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
        authorizeEndpoint: GOOGLE_AUTHORIZE_ENDPOINT,
        clientId: deps.clientId,
        scopes: deps.scopes,
        redirectUri: loopbackRedirectUri(boundPort),
        responseType: 'code',
        prompt: GOOGLE_AUTHORIZE_PROMPT,
        extraParams: GOOGLE_AUTHORIZE_EXTRA_PARAMS,
        state,
        codeChallenge: pkce.codeChallenge
      })
      void deps.openExternal(authorizeUrl)
    }
  })

  const raw = await exchangeCodeRaw({
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    code,
    redirectUri: loopbackRedirectUri(port),
    codeVerifier: pkce.codeVerifier,
    fetchImpl: deps.fetchImpl
  })

  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : undefined
  if (!accessToken) {
    throw new Error('Google token response missing access_token')
  }
  const refreshTok = typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined
  if (!refreshTok) {
    throw new Error('Google token response missing refresh_token (offline access not granted)')
  }
  const expiresAtMs =
    typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : undefined

  // Resolve non-secret identity from the primary calendar (id is the account email).
  const client = new GoogleCalendarClient({ fetchImpl: deps.fetchImpl })
  const identity = await client.getPrimaryCalendar({ token: accessToken })

  const result: GoogleOAuthResult = {
    accessToken,
    refreshToken: refreshTok,
    ...(typeof expiresAtMs === 'number' ? { expiresAtMs } : {}),
    scopes: scopesFromRaw(raw, deps.scopes)
  }
  if (identity.ok) {
    if (identity.data.id) {
      result.accountEmail = identity.data.id
    }
    if (identity.data.summary) {
      result.accountName = identity.data.summary
    }
    if (identity.data.timeZone) {
      result.timeZone = identity.data.timeZone
    }
  }
  return result
}

/** Inputs for a Google token refresh (rotation). */
export interface RefreshGoogleDeps {
  clientId: string
  /** Confidential-client secret (Google requires it on refresh too). */
  clientSecret: string
  refreshToken: string
  fetchImpl?: FetchLike
}

/**
 * Refresh the access token using the stored refresh token. Google does NOT rotate the
 * refresh token on every refresh, so the caller preserves the existing one when the
 * response omits it (handled by the manager). The client_secret is required.
 */
export async function refreshGoogleToken(deps: RefreshGoogleDeps): Promise<TokenExchangeResult> {
  return refreshToken({
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    refreshToken: deps.refreshToken,
    fetchImpl: deps.fetchImpl
  })
}
