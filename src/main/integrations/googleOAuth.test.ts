import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { refreshGoogleToken, runGoogleOAuth } from './googleOAuth'
import { GOOGLE_TOKEN_ENDPOINT } from './googleConfig'
import type { FetchLike, ServerFactory } from './oauthPkce'

/** A fetch response builder mirroring the oauthPkce / atlassianOAuth test helper. */
function res(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    headers: { get: (): string | null => null },
    json: async () => body
  }
}

/**
 * A fake loopback http.Server that auto-delivers a redirect once `listen` binds, so
 * `runGoogleOAuth` proceeds to the token exchange without a real socket. Mirrors the
 * atlassianOAuth test's FakeServer.
 */
class FakeServer extends EventEmitter {
  handler: (req: unknown, res: unknown) => void
  boundPort = 0
  closed = false
  constructor(handler: (req: unknown, res: unknown) => void) {
    super()
    this.handler = handler
  }
  listen(port: number, _host?: string, cb?: () => void): this {
    this.boundPort = port
    if (cb) queueMicrotask(cb)
    queueMicrotask(() =>
      queueMicrotask(() => {
        const r = { statusCode: 0, setHeader(): void {}, end(): void {} }
        this.handler({ url: `/callback?code=AUTH&state=${currentState()}` }, r)
      })
    )
    return this
  }
  close(): void {
    this.closed = true
  }
}

let capturedState = ''
function currentState(): string {
  return capturedState
}

function fakeFactory(servers: FakeServer[]): ServerFactory {
  return (handler) => {
    const s = new FakeServer(handler as never)
    servers.push(s)
    return s as never
  }
}

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

describe('runGoogleOAuth — confidential client (client_secret required)', () => {
  it('fails fast when no client_secret is configured (no browser, no exchange)', async () => {
    let opened = 0
    await expect(
      runGoogleOAuth({
        scopes: SCOPES,
        clientId: 'CID',
        clientSecret: '',
        openExternal: () => {
          opened += 1
        }
      })
    ).rejects.toThrow(/not configured/i)
    expect(opened).toBe(0)
  })

  it('exchanges WITH the client_secret, resolves identity, and returns tokens + identity', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const bodies: string[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      if (url === GOOGLE_TOKEN_ENDPOINT) {
        bodies.push(init?.body ?? '')
        return res({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 3600,
          scope: SCOPES.join(' ')
        })
      }
      // primary-calendar identity read
      return res({ id: 'me@example.com', summary: 'Me', timeZone: 'America/Los_Angeles' })
    }
    const result = await runGoogleOAuth({
      scopes: SCOPES,
      clientId: 'CID',
      clientSecret: 'TOPSECRET',
      openExternal: (u) => {
        capturedState = new URL(u).searchParams.get('state') ?? ''
      },
      fetchImpl,
      serverFactory: fakeFactory(servers)
    })
    expect(result.accessToken).toBe('AT')
    expect(result.refreshToken).toBe('RT')
    expect(result.accountEmail).toBe('me@example.com')
    expect(result.accountName).toBe('Me')
    expect(result.timeZone).toBe('America/Los_Angeles')
    expect(result.scopes).toEqual(SCOPES)
    // Exactly ONE token POST, and it carried the client_secret (confidential client).
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('client_secret=TOPSECRET')
  })

  it('opens the authorize URL with access_type=offline + prompt=consent (refresh token)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    let authorizeUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      if (url === GOOGLE_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
      }
      return res({ id: 'me@example.com', summary: 'Me', timeZone: 'UTC' })
    }
    await runGoogleOAuth({
      scopes: SCOPES,
      clientId: 'CID',
      clientSecret: 'S',
      openExternal: (u) => {
        authorizeUrl = u
        capturedState = new URL(u).searchParams.get('state') ?? ''
      },
      fetchImpl,
      serverFactory: fakeFactory(servers)
    })
    const url = new URL(authorizeUrl)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('calendar.readonly')
    // Secret NEVER appears in the authorize URL.
    expect(authorizeUrl).not.toContain('client_secret')
  })

  it('throws when the token response lacks a refresh_token (offline access not granted)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (url === GOOGLE_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', expires_in: 3600 })
      }
      return res({ id: 'me@example.com' })
    }
    await expect(
      runGoogleOAuth({
        scopes: SCOPES,
        clientId: 'CID',
        clientSecret: 'S',
        openExternal: (u) => {
          capturedState = new URL(u).searchParams.get('state') ?? ''
        },
        fetchImpl,
        serverFactory: fakeFactory(servers)
      })
    ).rejects.toThrow(/refresh_token/)
  })

  it('never leaks the secret in the returned result (SC-009)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (url === GOOGLE_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
      }
      return res({ id: 'me@example.com', summary: 'Me', timeZone: 'UTC' })
    }
    const result = await runGoogleOAuth({
      scopes: SCOPES,
      clientId: 'CID',
      clientSecret: 'SUPER-SECRET-XYZ',
      openExternal: (u) => {
        capturedState = new URL(u).searchParams.get('state') ?? ''
      },
      fetchImpl,
      serverFactory: fakeFactory(servers)
    })
    expect(JSON.stringify(result)).not.toContain('SUPER-SECRET-XYZ')
  })
})

describe('refreshGoogleToken — confidential client, NON-rotating', () => {
  it('refreshes WITH the client_secret and returns the new access token', async () => {
    const bodies: string[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(init?.body ?? '')
      // Google typically omits refresh_token on refresh (it does not rotate).
      return res({ access_token: 'AT-NEW', expires_in: 3600 })
    }
    const out = await refreshGoogleToken({
      clientId: 'CID',
      clientSecret: 'S',
      refreshToken: 'OLD',
      fetchImpl
    })
    expect(out.accessToken).toBe('AT-NEW')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('client_secret=S')
  })

  it('throws when Google rejects the refresh (manager flips to reconnect_needed)', async () => {
    const fetchImpl: FetchLike = async () => res({ error: 'invalid_grant' }, 400, false)
    await expect(
      refreshGoogleToken({ clientId: 'CID', clientSecret: 'S', refreshToken: 'OLD', fetchImpl })
    ).rejects.toThrow()
  })
})
