/**
 * Atlassian desktop OAuth flow + cloudId resolution + token refresh (Atlassian
 * integration v1). A thin, product-agnostic orchestrator over the generic
 * {@link oauthPkce} foundation (FR-A01, FR-A15), parameterized by the product's
 * scope list so ONE module serves both the Jira and Confluence connects.
 *
 * Flow (FR-A01..FR-A07):
 *   1. generate a PKCE pair (S256) + a CSRF `state`.
 *   2. bind a short-lived loopback listener; once it binds, assemble the authorize
 *      URL with that port's exact `redirect_uri` (audience, prompt=consent, the
 *      product scopes + offline_access) and open the system browser.
 *   3. capture the redirect (code), verify `state`, close the listener.
 *   4. exchange the code at `auth.atlassian.com/oauth/token`. Per FR-A03, ATTEMPT
 *      THE EXCHANGE SECRET-LESS FIRST, then fall back — as an explicit, documented
 *      branch — to including `client_secret` (Atlassian Cloud is a confidential
 *      client, so this is the expected active path). The secret is read in main
 *      only and is NEVER logged, IPC'd, bridged, or returned in any result.
 *   5. resolve the site cloudId via accessible-resources (FR-A07; first site for v1).
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
  refreshToken,
  type FetchLike,
  type ServerFactory,
  type TokenExchangeResult
} from './oauthPkce'
import {
  ATLASSIAN_ACCESSIBLE_RESOURCES_ENDPOINT,
  ATLASSIAN_AUDIENCE,
  ATLASSIAN_AUTHORIZE_ENDPOINT,
  ATLASSIAN_TOKEN_ENDPOINT
} from './atlassianConfig'

/** Abandon the consent flow if no redirect arrives within this window. */
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export interface RunAtlassianOAuthDeps {
  /** The product's read scopes (+ offline_access) — Jira or Confluence (FR-A04). */
  scopes: string[]
  /** cosmos's registered Atlassian client id (from COSMOS_ATLASSIAN_CLIENT_ID). */
  clientId: string
  /**
   * cosmos's Atlassian client secret (from COSMOS_ATLASSIAN_CLIENT_SECRET). Used
   * ONLY in the documented secret fallback at token exchange (FR-A03). When unset,
   * only the secret-less attempt runs; if Atlassian rejects it, connect fails fast
   * with a "not configured" message. Never logged / IPC'd / bridged / in a result.
   */
  clientSecret?: string
  /** Open the consent URL in the system browser (Electron `shell.openExternal`). */
  openExternal: (url: string) => void | Promise<void>
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Injectable http-server factory (tests pass a fake). */
  serverFactory?: ServerFactory
}

/** A completed Atlassian OAuth — tokens + non-secret site/account identity (FR-A07/A08). */
export interface AtlassianOAuthResult {
  /** The Bearer access token (expires ~1h). */
  accessToken: string
  /** The refresh token (rotates on each refresh — FR-A09). */
  refreshToken: string
  /** Absolute access-token expiry as epoch ms, when known. */
  expiresAtMs?: number
  /** Granted scopes (persisted in the token set). */
  scopes: string[]
  /** The resolved site cloudId (targets every read — FR-A07). */
  cloudId: string
  /** Atlassian site name (e.g. `acme.atlassian.net`); non-secret identity. */
  siteName?: string
  /** Atlassian site URL; non-secret identity. */
  siteUrl?: string
}

/** One entry from accessible-resources (FR-A07). */
interface AccessibleResource {
  id: string
  name?: string
  url?: string
}

/**
 * Resolve the site cloudId from accessible-resources (FR-A07). v1 uses the FIRST
 * site returned (multi-site picker deferred — Open Question #3). Throws when no
 * site is accessible so Connect fails with a clear message and stores nothing.
 */
export async function resolveCloudId(
  accessToken: string,
  fetchImpl?: FetchLike
): Promise<AccessibleResource> {
  const f = fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const res = await f(ATLASSIAN_ACCESSIBLE_RESOURCES_ENDPOINT, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
  })
  if (!res.ok) {
    throw new Error(`accessible-resources HTTP ${res.status}`)
  }
  const json = await res.json()
  const list = Array.isArray(json) ? json : []
  const first = list.find((r): r is Record<string, unknown> => isRecord(r) && typeof r.id === 'string')
  if (!first) {
    throw new Error('No accessible Atlassian site for this account.')
  }
  return {
    id: String(first.id),
    ...(typeof first.name === 'string' ? { name: first.name } : {}),
    ...(typeof first.url === 'string' ? { url: first.url } : {})
  }
}

/**
 * Exchange an authorization code, secret-less FIRST then with `client_secret`
 * (FR-A03). The fallback is explicit and logged at debug WITHOUT the secret itself.
 * If both attempts fail (or the secret is absent on a confidential client), throws.
 */
async function exchangeWithSecretFallback(deps: {
  clientId: string
  clientSecret?: string
  code: string
  redirectUri: string
  codeVerifier: string
  fetchImpl?: FetchLike
}): Promise<Record<string, unknown>> {
  try {
    // Public-client (PKCE) attempt FIRST — auto-adapts if Atlassian ever enables it.
    return await exchangeCodeRaw({
      tokenEndpoint: ATLASSIAN_TOKEN_ENDPOINT,
      clientId: deps.clientId,
      code: deps.code,
      redirectUri: deps.redirectUri,
      codeVerifier: deps.codeVerifier,
      fetchImpl: deps.fetchImpl
    })
  } catch (err) {
    if (!deps.clientSecret) {
      // No secret to fall back to — surface the original failure (FR-A04/A03).
      throw err
    }
    // Documented, explicit confidential-client fallback (the expected Cloud path).
    // Never log the secret; this debug line records only that the branch ran.
    console.debug('[atlassian] secret-less token exchange rejected — retrying with client_secret')
    return exchangeCodeRaw({
      tokenEndpoint: ATLASSIAN_TOKEN_ENDPOINT,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      code: deps.code,
      redirectUri: deps.redirectUri,
      codeVerifier: deps.codeVerifier,
      fetchImpl: deps.fetchImpl
    })
  }
}

function scopesFromRaw(raw: Record<string, unknown>, fallback: string[]): string[] {
  if (typeof raw.scope === 'string' && raw.scope.trim() !== '') {
    return raw.scope.split(/\s+/)
  }
  return fallback
}

/**
 * Run the Atlassian desktop OAuth flow and resolve the token set + identity.
 * Rejects (via the loopback foundation) on user-deny, state mismatch, timeout, a
 * token-endpoint error, or no accessible site — the manager maps these to a clear
 * lastError. The access + refresh token are returned to the manager (in-process
 * only) which persists them encrypted; they never leave main (FR-A11, SC-009).
 */
export async function runAtlassianOAuth(
  deps: RunAtlassianOAuthDeps
): Promise<AtlassianOAuthResult> {
  const pkce = createPkcePair()
  const state = createState()

  const { code, port } = await awaitLoopbackCallback({
    ports: LOOPBACK_PORTS,
    expectedState: state,
    timeoutMs: OAUTH_TIMEOUT_MS,
    serverFactory: deps.serverFactory,
    onListening: (boundPort) => {
      const authorizeUrl = buildAuthorizeUrl({
        authorizeEndpoint: ATLASSIAN_AUTHORIZE_ENDPOINT,
        audience: ATLASSIAN_AUDIENCE,
        clientId: deps.clientId,
        scopes: deps.scopes,
        redirectUri: loopbackRedirectUri(boundPort),
        responseType: 'code',
        prompt: 'consent',
        state,
        codeChallenge: pkce.codeChallenge
      })
      void deps.openExternal(authorizeUrl)
    }
  })

  const raw = await exchangeWithSecretFallback({
    clientId: deps.clientId,
    ...(deps.clientSecret ? { clientSecret: deps.clientSecret } : {}),
    code,
    redirectUri: loopbackRedirectUri(port),
    codeVerifier: pkce.codeVerifier,
    fetchImpl: deps.fetchImpl
  })

  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : undefined
  if (!accessToken) {
    throw new Error('Atlassian token response missing access_token')
  }
  const refreshTok = typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined
  if (!refreshTok) {
    throw new Error('Atlassian token response missing refresh_token (offline_access not granted)')
  }
  const expiresAtMs =
    typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : undefined

  const site = await resolveCloudId(accessToken, deps.fetchImpl)

  return {
    accessToken,
    refreshToken: refreshTok,
    ...(typeof expiresAtMs === 'number' ? { expiresAtMs } : {}),
    scopes: scopesFromRaw(raw, deps.scopes),
    cloudId: site.id,
    ...(site.name ? { siteName: site.name } : {}),
    ...(site.url ? { siteUrl: site.url } : {})
  }
}

/** Inputs for an Atlassian token refresh (rotation — FR-A09). */
export interface RefreshAtlassianDeps {
  clientId: string
  /** Confidential-client secret (Cloud requires it on refresh too — FR-A09). */
  clientSecret?: string
  refreshToken: string
  fetchImpl?: FetchLike
}

/**
 * Refresh the access token using the stored refresh token (FR-A09). Atlassian
 * ROTATES the refresh token, so the caller MUST persist the returned rotated set.
 * Mirrors the secret-less-first-then-secret discipline of the initial exchange so
 * the code adapts if Atlassian ever stops requiring the secret.
 */
export async function refreshAtlassianToken(
  deps: RefreshAtlassianDeps
): Promise<TokenExchangeResult> {
  try {
    return await refreshToken({
      tokenEndpoint: ATLASSIAN_TOKEN_ENDPOINT,
      clientId: deps.clientId,
      refreshToken: deps.refreshToken,
      fetchImpl: deps.fetchImpl
    })
  } catch (err) {
    if (!deps.clientSecret) {
      throw err
    }
    console.debug('[atlassian] secret-less refresh rejected — retrying with client_secret')
    return refreshToken({
      tokenEndpoint: ATLASSIAN_TOKEN_ENDPOINT,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      refreshToken: deps.refreshToken,
      fetchImpl: deps.fetchImpl
    })
  }
}
