import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  awaitLoopbackCallback,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCode,
  LoopbackCallbackError,
  loopbackRedirectUri,
  refreshToken,
  type FetchLike,
  type ServerFactory
} from './oauthPkce'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('createPkcePair (FR-005)', () => {
  it('produces a 43+ char base64url verifier and the matching S256 challenge', () => {
    const pair = createPkcePair()
    expect(pair.method).toBe('S256')
    // 32 random bytes -> 43-char base64url, within RFC 7636's 43..128 range.
    expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    // challenge MUST be base64url(SHA-256(verifier)).
    const expected = base64url(createHash('sha256').update(pair.codeVerifier).digest())
    expect(pair.codeChallenge).toBe(expected)
  })

  it('produces a fresh verifier each call', () => {
    expect(createPkcePair().codeVerifier).not.toBe(createPkcePair().codeVerifier)
  })
})

describe('buildAuthorizeUrl (FR-002)', () => {
  it('assembles the authorize URL with scopes, user_scope, redirect, state, and S256 challenge', () => {
    const state = createState()
    const url = new URL(
      buildAuthorizeUrl({
        authorizeEndpoint: 'https://slack.com/oauth/v2/authorize',
        clientId: 'CID',
        scopes: ['channels:read', 'channels:history', 'users:read'],
        userScopes: ['search:read'],
        redirectUri: loopbackRedirectUri(7421),
        state,
        codeChallenge: 'CH'
      })
    )
    expect(url.searchParams.get('client_id')).toBe('CID')
    expect(url.searchParams.get('scope')).toBe('channels:read channels:history users:read')
    expect(url.searchParams.get('user_scope')).toBe('search:read')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:7421/callback')
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('code_challenge')).toBe('CH')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('omits user_scope when none requested (no write scopes, SC-011)', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizeEndpoint: 'https://slack.com/oauth/v2/authorize',
        clientId: 'CID',
        scopes: ['channels:read'],
        redirectUri: loopbackRedirectUri(7421),
        state: 's',
        codeChallenge: 'CH'
      })
    )
    expect(url.searchParams.has('user_scope')).toBe(false)
  })
})

/**
 * A fake http.Server that lets a test "deliver" a redirect request. It records the
 * port it bound and never opens a real socket.
 */
class FakeServer extends EventEmitter {
  handler: (req: unknown, res: unknown) => void
  boundPort = 0
  closed = false
  failListen = false
  constructor(handler: (req: unknown, res: unknown) => void) {
    super()
    this.handler = handler
  }
  listen(port: number, _host?: string, cb?: () => void): this {
    if (this.failListen) {
      queueMicrotask(() => this.emit('error', new Error('EADDRINUSE')))
      return this
    }
    this.boundPort = port
    if (cb) {
      queueMicrotask(cb)
    }
    return this
  }
  close(): void {
    this.closed = true
  }
  /** Simulate a redirect hitting the loopback server. */
  deliver(query: string): { statusCode: number; ended: boolean } {
    const res = {
      statusCode: 0,
      ended: false,
      setHeader(): void {},
      end(): void {
        this.ended = true
      }
    }
    this.handler({ url: `/callback?${query}` }, res)
    return res
  }
}

function fakeFactory(servers: FakeServer[]): ServerFactory {
  return (handler) => {
    const s = new FakeServer(handler as never)
    servers.push(s)
    return s as never
  }
}

describe('awaitLoopbackCallback (FR-003, FR-004, SC-002)', () => {
  it('resolves {code, port} when the callback matches the expected state', async () => {
    const servers: FakeServer[] = []
    const promise = awaitLoopbackCallback({
      ports: [7421],
      expectedState: 'st8',
      timeoutMs: 1000,
      serverFactory: fakeFactory(servers)
    })
    // let listen() callback run so the server is bound
    await Promise.resolve()
    await Promise.resolve()
    servers[0].deliver('code=AUTH123&state=st8')
    await expect(promise).resolves.toEqual({ code: 'AUTH123', port: 7421 })
    expect(servers[0].closed).toBe(true)
  })

  it('rejects state_mismatch on a mismatched state (FR-004)', async () => {
    const servers: FakeServer[] = []
    const promise = awaitLoopbackCallback({
      ports: [7421],
      expectedState: 'expected',
      timeoutMs: 1000,
      serverFactory: fakeFactory(servers)
    })
    await Promise.resolve()
    await Promise.resolve()
    servers[0].deliver('code=AUTH&state=WRONG')
    await expect(promise).rejects.toMatchObject({ kind: 'state_mismatch' })
  })

  it('rejects denied when the redirect carries error=access_denied (SC-002)', async () => {
    const servers: FakeServer[] = []
    const promise = awaitLoopbackCallback({
      ports: [7421],
      expectedState: 'st',
      timeoutMs: 1000,
      serverFactory: fakeFactory(servers)
    })
    await Promise.resolve()
    await Promise.resolve()
    servers[0].deliver('error=access_denied&state=st')
    await expect(promise).rejects.toMatchObject({ kind: 'denied' })
  })

  it('rejects timeout when no callback arrives (FR-003 — never holds the port)', async () => {
    const servers: FakeServer[] = []
    const promise = awaitLoopbackCallback({
      ports: [7421],
      expectedState: 'st',
      timeoutMs: 5,
      serverFactory: fakeFactory(servers)
    })
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' })
    expect(servers[0].closed).toBe(true)
  })

  it('falls back to the next port when the first cannot bind', async () => {
    const servers: FakeServer[] = []
    const factory: ServerFactory = (handler) => {
      // One server is reused across ports (matching production). Make only the
      // FIRST listen() fail so the second port (7422) binds and serves.
      const s = new FakeServer(handler as never)
      let firstListen = true
      const realListen = s.listen.bind(s)
      s.listen = (port: number, host?: string, cb?: () => void) => {
        if (firstListen) {
          firstListen = false
          queueMicrotask(() => s.emit('error', new Error('EADDRINUSE')))
          return s
        }
        return realListen(port, host, cb)
      }
      servers.push(s)
      return s as never
    }
    const promise = awaitLoopbackCallback({
      ports: [7421, 7422],
      expectedState: 'st',
      timeoutMs: 1000,
      serverFactory: factory
    })
    // First port fails; same server retries on the next port (single server reused).
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    servers[0].deliver('code=C&state=st')
    await expect(promise).resolves.toEqual({ code: 'C', port: 7422 })
  })

  it('exports a LoopbackCallbackError class with a kind', () => {
    const e = new LoopbackCallbackError('timeout', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e.kind).toBe('timeout')
  })
})

describe('exchangeCode / refreshToken (FR-005)', () => {
  function fakeFetch(body: unknown, status = 200, ok = true): FetchLike {
    return async () => ({
      ok,
      status,
      headers: { get: () => null },
      json: async () => body
    })
  }

  it('exchanges a code without a client secret (PKCE public client)', async () => {
    let captured: string | undefined
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = init?.body
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ ok: true, access_token: 'xoxb-1', refresh_token: 'r1', expires_in: 3600 })
      }
    }
    const result = await exchangeCode({
      tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
      clientId: 'CID',
      code: 'AUTH',
      redirectUri: 'http://127.0.0.1:7421/callback',
      codeVerifier: 'VER',
      fetchImpl
    })
    expect(result.accessToken).toBe('xoxb-1')
    expect(result.refreshToken).toBe('r1')
    expect(result.expiresInSeconds).toBe(3600)
    // PKCE: code_verifier present, NO client_secret.
    expect(captured).toContain('code_verifier=VER')
    expect(captured).not.toContain('client_secret')
  })

  it('throws on a Slack { ok:false } token response', async () => {
    await expect(
      exchangeCode({
        tokenEndpoint: 'e',
        clientId: 'C',
        code: 'x',
        redirectUri: 'r',
        codeVerifier: 'v',
        fetchImpl: fakeFetch({ ok: false, error: 'invalid_grant' })
      })
    ).rejects.toThrow(/invalid_grant/)
  })

  it('refreshes with grant_type=refresh_token', async () => {
    let captured: string | undefined
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = init?.body
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ ok: true, access_token: 'xoxb-2', refresh_token: 'r2', expires_in: 7200 })
      }
    }
    const result = await refreshToken({
      tokenEndpoint: 'e',
      clientId: 'C',
      refreshToken: 'r1',
      fetchImpl
    })
    expect(result.accessToken).toBe('xoxb-2')
    expect(captured).toContain('grant_type=refresh_token')
    expect(captured).toContain('refresh_token=r1')
  })
})
