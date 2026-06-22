/**
 * PKCE OAuth authorization-code flow handler (integration foundation, generic).
 * Slack integration v1 — but deliberately integration-agnostic so Jira/Confluence
 * reuse it (FR-010, SC-012).
 *
 * Runs the OAuth flow as a PUBLIC client using PKCE — no client secret, no hosted
 * backend/token-broker (plan: Slack PKCE public-client flow). Pieces:
 *   - PKCE pair generation (S256) via `node:crypto` only (FR-005, no new dep).
 *   - authorize-URL assembly for the system browser (FR-002).
 *   - a short-lived loopback `http.Server` that captures the single redirect on a
 *     fixed port (7421, fallback 7422/7423), verifies `state`, then closes (FR-003,
 *     FR-004).
 *   - code->token exchange and refresh against the provider token endpoint (FR-005).
 *
 * Side-effecting collaborators (the http server, global fetch, the system-browser
 * opener) are injected so the flow is unit-testable without Electron or a network.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'

/** Fixed loopback redirect port + ordered fallbacks (plan: exact-match redirect). */
export const LOOPBACK_PORTS = [7421, 7422, 7423] as const
/** The redirect path the loopback server listens on. */
export const LOOPBACK_PATH = '/callback'
/** Loopback host (IPv4 literal — Slack allowlists the exact URI). */
export const LOOPBACK_HOST = '127.0.0.1'

/** Build the exact redirect URI for a given port (must match the app allowlist). */
export function loopbackRedirectUri(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}${LOOPBACK_PATH}`
}

/** A PKCE verifier/challenge pair (S256). */
export interface PkcePair {
  /** 43+ char base64url random; sent at token exchange. */
  codeVerifier: string
  /** base64url SHA-256 of the verifier; sent at authorize time. */
  codeChallenge: string
  /** Always 'S256' for cosmos. */
  method: 'S256'
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a PKCE pair using `node:crypto` only (FR-005). */
export function createPkcePair(): PkcePair {
  // 32 random bytes -> base64url is 43 chars, satisfying RFC 7636's 43..128 range.
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  return { codeVerifier, codeChallenge, method: 'S256' }
}

/** Generate a cryptographically random `state` for CSRF protection (FR-004). */
export function createState(): string {
  return base64url(randomBytes(16))
}

/** Inputs for the authorize URL (provider consent page). */
export interface AuthorizeUrlParams {
  /** The provider authorize endpoint (e.g. https://slack.com/oauth/v2/authorize). */
  authorizeEndpoint: string
  /** The bundled public client id. */
  clientId: string
  /** Bot/standard scopes (Slack: `scope`; Atlassian: `scope`). */
  scopes: string[]
  /** User-token scopes (Slack: `user_scope`); omitted when empty. */
  userScopes?: string[]
  /** The exact loopback redirect URI. */
  redirectUri: string
  /** Per-attempt `state`. */
  state: string
  /** PKCE code challenge (S256). */
  codeChallenge: string
  /**
   * `response_type` (default `code`). Atlassian requires it explicitly; Slack
   * omits it without harm, so it defaults to `code` only when provided.
   */
  responseType?: string
  /**
   * Provider `audience` (Atlassian: `api.atlassian.com`). Added only when present
   * so Slack's call site stays byte-for-byte identical (no audience param).
   */
  audience?: string
  /**
   * Provider `prompt` (Atlassian: `consent`). Added only when present so Slack's
   * authorize URL is unchanged.
   */
  prompt?: string
  /**
   * Extra provider-specific authorize params (Google: `access_type=offline` so a
   * refresh token is issued, `include_granted_scopes=true`). Each is added verbatim
   * to the query ONLY when present, so existing call sites (Slack/Atlassian) are
   * byte-for-byte unchanged. NEVER carry a secret here — secrets go in the token POST.
   */
  extraParams?: Record<string, string>
}

/**
 * Assemble the authorization URL (FR-002 / Atlassian FR-A02). Uses standard OAuth
 * param names; `scope` / `user_scope` are space-delimited. No client secret is ever
 * included here (the secret, when a provider requires one, is added at the token
 * POST only — Atlassian FR-A03). `audience`/`prompt`/`response_type` are emitted
 * only when supplied so existing call sites (Slack) are unaffected.
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(params.authorizeEndpoint)
  if (params.audience) {
    url.searchParams.set('audience', params.audience)
  }
  url.searchParams.set('client_id', params.clientId)
  if (params.scopes.length > 0) {
    url.searchParams.set('scope', params.scopes.join(' '))
  }
  if (params.userScopes && params.userScopes.length > 0) {
    url.searchParams.set('user_scope', params.userScopes.join(' '))
  }
  url.searchParams.set('redirect_uri', params.redirectUri)
  if (params.responseType) {
    url.searchParams.set('response_type', params.responseType)
  }
  url.searchParams.set('state', params.state)
  if (params.prompt) {
    url.searchParams.set('prompt', params.prompt)
  }
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value)
    }
  }
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * Why awaiting the loopback callback failed.
 *   - `cancelled` when the caller aborts the in-flight flow via the {@link AwaitLoopbackParams.signal}
 *     `AbortSignal` (e.g. the user clicks Cancel after closing the browser tab — there is no
 *     `error` redirect, so the flow would otherwise wait out the full `timeoutMs`).
 */
export type LoopbackErrorKind = 'denied' | 'state_mismatch' | 'timeout' | 'no_port' | 'cancelled'

/** Error thrown/rejected by {@link awaitLoopbackCallback}. */
export class LoopbackCallbackError extends Error {
  constructor(
    readonly kind: LoopbackErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'LoopbackCallbackError'
  }
}

/** A minimal http-server factory (injectable; defaults to `node:http`). */
export type ServerFactory = (
  handler: (req: IncomingMessage, res: ServerResponse) => void
) => Server

const defaultServerFactory: ServerFactory = (handler) => createServer(handler)

export interface AwaitLoopbackParams {
  /** Candidate ports in priority order. */
  ports: readonly number[]
  /** The redirect path to accept (default `/callback`). */
  path?: string
  /** The `state` the callback must echo (FR-004). */
  expectedState: string
  /** Abandon-after timeout in ms (FR-003 — never hold a port forever). */
  timeoutMs: number
  /**
   * Called once the listener binds, with the port it bound. The caller uses this
   * to assemble the authorize URL with the exact `redirect_uri` and open the
   * browser — the redirect_uri must match this port at token exchange.
   */
  onListening?: (port: number) => void
  /** Injectable server factory (tests pass a fake). */
  serverFactory?: ServerFactory
  /**
   * Optional abort handle: when the caller aborts this signal the loopback server is closed
   * cleanly and the pending promise rejects with a `cancelled` {@link LoopbackCallbackError}.
   * Lets a manager abort an in-flight connect (the user closed the browser tab, so no `error`
   * redirect arrives) WITHOUT waiting out `timeoutMs`. Abort after settle is a safe no-op; an
   * already-aborted signal rejects immediately without binding a port.
   */
  signal?: AbortSignal
}

/** Result of a successful loopback capture. */
export interface LoopbackResult {
  /** The authorization code. */
  code: string
  /** The port the listener actually bound (its redirect_uri must be reused at exchange). */
  port: number
}

/**
 * Listen on the first available loopback port, capture the single redirect, verify
 * `state`, and resolve `{code, port}` — then always close the server (FR-003).
 *
 * Rejects with a {@link LoopbackCallbackError}:
 *   - `denied`         when the redirect carries `error` (user deny/cancel — SC-002).
 *   - `state_mismatch` when `state` does not match the pending attempt (FR-004).
 *   - `timeout`        when no callback arrives before `timeoutMs` (FR-003).
 *   - `no_port`        when no candidate port can be bound.
 */
export function awaitLoopbackCallback(
  params: AwaitLoopbackParams
): Promise<LoopbackResult> {
  const path = params.path ?? LOOPBACK_PATH
  const factory = params.serverFactory ?? defaultServerFactory

  return new Promise<LoopbackResult>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let boundPort = 0

    const server = factory((req, res) => {
      // Only the callback path is meaningful; ignore favicon etc.
      const reqUrl = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}:${boundPort}`)
      if (reqUrl.pathname !== path) {
        res.statusCode = 404
        res.end()
        return
      }
      const error = reqUrl.searchParams.get('error')
      const state = reqUrl.searchParams.get('state')
      const code = reqUrl.searchParams.get('code')

      if (error) {
        respond(res, 'You can close this window and return to cosmos.')
        finish(new LoopbackCallbackError('denied', `authorization denied: ${error}`))
        return
      }
      if (state !== params.expectedState) {
        respond(res, 'You can close this window and return to cosmos.')
        finish(new LoopbackCallbackError('state_mismatch', 'state did not match'))
        return
      }
      if (!code) {
        respond(res, 'You can close this window and return to cosmos.')
        finish(new LoopbackCallbackError('state_mismatch', 'no authorization code in callback'))
        return
      }
      respond(res, 'Connected to cosmos. You can close this window.')
      finish(null, { code, port: boundPort })
    })

    function respond(res: ServerResponse, body: string): void {
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`)
    }

    function cleanup(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      try {
        server.close()
      } catch {
        // best effort
      }
    }

    function finish(err: Error | null, result?: LoopbackResult): void {
      if (settled) {
        return
      }
      settled = true
      if (params.signal) {
        params.signal.removeEventListener('abort', onAbort)
      }
      cleanup()
      if (err) {
        reject(err)
      } else if (result) {
        resolve(result)
      }
    }

    // Cancel path: aborting closes the server (via cleanup in finish) and rejects with
    // `cancelled`. Idempotent + safe after settle (finish short-circuits once settled).
    function onAbort(): void {
      finish(new LoopbackCallbackError('cancelled', 'authorization cancelled'))
    }
    if (params.signal) {
      if (params.signal.aborted) {
        // Already aborted before we bind a port — reject immediately, bind nothing.
        finish(new LoopbackCallbackError('cancelled', 'authorization cancelled'))
        return
      }
      params.signal.addEventListener('abort', onAbort)
    }

    server.on('error', () => {
      // surfaced via tryNext / listen error handling below
    })

    // Try ports in order until one binds; if none bind, reject no_port.
    const tryPort = (index: number): void => {
      if (index >= params.ports.length) {
        finish(new LoopbackCallbackError('no_port', 'no loopback port available'))
        return
      }
      const port = params.ports[index]
      const onError = (): void => {
        server.removeListener('error', onError)
        tryPort(index + 1)
      }
      server.once('error', onError)
      server.listen(port, LOOPBACK_HOST, () => {
        server.removeListener('error', onError)
        boundPort = port
        timer = setTimeout(() => {
          finish(new LoopbackCallbackError('timeout', 'authorization timed out'))
        }, params.timeoutMs)
        params.onListening?.(port)
      })
    }
    tryPort(0)
  })
}

/* ------------------------------------------------------------------------- *
 * Token exchange + refresh (provider token endpoint)
 * ------------------------------------------------------------------------- */

/** Minimal `fetch` shape we depend on (injectable; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

/** The raw token-endpoint response fields cosmos consumes (provider-agnostic). */
export interface TokenExchangeResult {
  /** The access token (bot or whichever the provider returns at top level). */
  accessToken: string
  /** Refresh token, when the provider issues one (token rotation). */
  refreshToken?: string
  /** Seconds until the access token expires, when provided. */
  expiresInSeconds?: number
  /** The raw provider payload, so the manager can read provider-specific fields. */
  raw: Record<string, unknown>
}

/** Inputs for a code->token exchange. */
export interface ExchangeCodeParams {
  /** Provider token endpoint (Slack: oauth.v2.access). */
  tokenEndpoint: string
  clientId: string
  code: string
  /** Must equal the redirect_uri used at authorize time (exact match). */
  redirectUri: string
  /** The PKCE verifier matching the challenge sent at authorize time. */
  codeVerifier: string
  /**
   * Optional confidential-client secret (Atlassian Cloud FR-A03). When present it
   * is added to the token POST body ONLY — never to the authorize URL, never
   * logged. Absent for public-client (Slack PKCE) exchanges, so their body is
   * byte-for-byte unchanged.
   */
  clientSecret?: string
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

async function postForm(
  endpoint: string,
  form: Record<string, string>,
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const json = await res.json()
  if (!isRecord(json)) {
    throw new Error('token endpoint returned a non-object response')
  }
  // Slack returns HTTP 200 with `{ ok: false, error }` on failure.
  if (json.ok === false) {
    throw new Error(`token endpoint error: ${String(json.error ?? 'unknown')}`)
  }
  if (!res.ok) {
    throw new Error(`token endpoint HTTP ${res.status}`)
  }
  return json
}

function toExchangeResult(raw: Record<string, unknown>): TokenExchangeResult {
  const accessToken =
    typeof raw.access_token === 'string' ? raw.access_token : undefined
  if (!accessToken) {
    throw new Error('token endpoint response missing access_token')
  }
  return {
    accessToken,
    ...(typeof raw.refresh_token === 'string' ? { refreshToken: raw.refresh_token } : {}),
    ...(typeof raw.expires_in === 'number' ? { expiresInSeconds: raw.expires_in } : {}),
    raw
  }
}

/**
 * Exchange an authorization code and return the raw provider payload (FR-005).
 * PKCE: no client secret. Some providers (Slack's user-scope-only flow) return no
 * top-level `access_token` — the token lives in a provider-specific field — so the
 * caller maps the raw payload itself rather than going through {@link toExchangeResult}.
 */
export async function exchangeCodeRaw(
  params: ExchangeCodeParams
): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  return postForm(
    params.tokenEndpoint,
    {
      client_id: params.clientId,
      ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier
    },
    fetchImpl
  )
}

/** Exchange an authorization code for tokens (FR-005). PKCE: no client secret. */
export async function exchangeCode(
  params: ExchangeCodeParams
): Promise<TokenExchangeResult> {
  return toExchangeResult(await exchangeCodeRaw(params))
}

/** Inputs for a refresh-token exchange (token rotation). */
export interface RefreshTokenParams {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
  /**
   * Optional confidential-client secret (Atlassian Cloud FR-A03). Added to the
   * refresh POST body ONLY when present; never logged. Absent for Slack.
   */
  clientSecret?: string
  fetchImpl?: FetchLike
}

/** Refresh an access token with `grant_type=refresh_token` (FR-005, plan). */
export async function refreshToken(
  params: RefreshTokenParams
): Promise<TokenExchangeResult> {
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const raw = await postForm(
    params.tokenEndpoint,
    {
      client_id: params.clientId,
      ...(params.clientSecret ? { client_secret: params.clientSecret } : {}),
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken
    },
    fetchImpl
  )
  return toExchangeResult(raw)
}
