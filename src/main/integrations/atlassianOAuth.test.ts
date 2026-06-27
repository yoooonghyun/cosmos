import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  refreshAtlassianToken,
  resolveCloudId,
  runAtlassianOAuth
} from './atlassianOAuth'
import {
  ATLASSIAN_ACCESSIBLE_RESOURCES_ENDPOINT,
  ATLASSIAN_TOKEN_ENDPOINT,
  CONFLUENCE_OAUTH_SCOPES
} from './atlassianConfig'
import type { FetchLike, ServerFactory } from './oauthPkce'

/** A fetch response builder mirroring the oauthPkce test helper. */
function res(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    headers: { get: (): string | null => null },
    json: async () => body
  }
}

/**
 * A fake loopback http.Server that auto-delivers a redirect once `listen` binds,
 * so `runAtlassianOAuth` proceeds to the token exchange without a real socket.
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
    // Deliver a matching redirect shortly after binding (after onListening has run,
    // so `capturedState` reflects the state minted for this flow).
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

// awaitLoopbackCallback mints `state` internally via runAtlassianOAuth; we cannot
// read it directly, so we intercept by capturing it from the authorize URL the
// opener receives. A module-level holder lets FakeServer echo the right state.
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

describe('resolveCloudId (FR-A07)', () => {
  it('returns the FIRST accessible site (v1 single-site)', async () => {
    const fetchImpl: FetchLike = async () =>
      res([
        { id: 'cloud-1', name: 'acme.atlassian.net', url: 'https://acme.atlassian.net' },
        { id: 'cloud-2', name: 'other' }
      ])
    const site = await resolveCloudId('at-token', fetchImpl)
    expect(site).toEqual({
      id: 'cloud-1',
      name: 'acme.atlassian.net',
      url: 'https://acme.atlassian.net'
    })
  })

  it('sends a Bearer token to the accessible-resources endpoint', async () => {
    let url = ''
    let auth: string | undefined
    const fetchImpl: FetchLike = async (u, init) => {
      url = u
      auth = init?.headers?.authorization
      return res([{ id: 'c1' }])
    }
    await resolveCloudId('SECRET-AT', fetchImpl)
    expect(url).toBe(ATLASSIAN_ACCESSIBLE_RESOURCES_ENDPOINT)
    expect(auth).toBe('Bearer SECRET-AT')
  })

  it('throws when no site is accessible (Connect fails clearly, stores nothing)', async () => {
    const fetchImpl: FetchLike = async () => res([])
    await expect(resolveCloudId('t', fetchImpl)).rejects.toThrow(/No accessible Atlassian site/)
  })

  it('throws on a non-OK accessible-resources response', async () => {
    const fetchImpl: FetchLike = async () => res('', 401, false)
    await expect(resolveCloudId('t', fetchImpl)).rejects.toThrow(/HTTP 401/)
  })
})

describe('runAtlassianOAuth — secret-less FIRST then client_secret fallback (FR-A03)', () => {
  it('exchanges secret-less when Atlassian accepts the public-client attempt', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const bodies: string[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        bodies.push(init?.body ?? '')
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'read:jira-work offline_access' })
      }
      return res([{ id: 'cloud-9', name: 'acme.atlassian.net', url: 'https://acme.atlassian.net' }])
    }
    const result = await runAtlassianOAuth({
      scopes: ['read:jira-work', 'offline_access'],
      clientId: 'CID',
      clientSecret: 'SHHH',
      openExternal: (u) => {
        capturedState = new URL(u).searchParams.get('state') ?? ''
      },
      fetchImpl,
      serverFactory: fakeFactory(servers)
    })
    expect(result.accessToken).toBe('AT')
    expect(result.refreshToken).toBe('RT')
    expect(result.cloudId).toBe('cloud-9')
    expect(result.siteName).toBe('acme.atlassian.net')
    expect(result.scopes).toEqual(['read:jira-work', 'offline_access'])
    // Exactly ONE token POST, and it carried NO client_secret (secret-less success).
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toContain('client_secret')
  })

  it('falls back to client_secret when the secret-less attempt is rejected (the Cloud path)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const bodies: string[] = []
    let tokenCalls = 0
    const fetchImpl: FetchLike = async (url, init) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        tokenCalls += 1
        bodies.push(init?.body ?? '')
        // First (secret-less) attempt: 401 -> throws -> triggers fallback.
        if (tokenCalls === 1) return res({ error: 'invalid_client' }, 401, false)
        return res({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })
      }
      return res([{ id: 'cloud-1' }])
    }
    const result = await runAtlassianOAuth({
      scopes: ['read:jira-work', 'offline_access'],
      clientId: 'CID',
      clientSecret: 'TOPSECRET',
      openExternal: (u) => {
        capturedState = new URL(u).searchParams.get('state') ?? ''
      },
      fetchImpl,
      serverFactory: fakeFactory(servers)
    })
    expect(result.accessToken).toBe('AT2')
    expect(tokenCalls).toBe(2)
    expect(bodies[0]).not.toContain('client_secret')
    expect(bodies[1]).toContain('client_secret=TOPSECRET')
  })

  it('fails fast (no fallback) when no secret is configured and Atlassian rejects', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    let tokenCalls = 0
    const fetchImpl: FetchLike = async (url) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        tokenCalls += 1
        return res({ error: 'invalid_client' }, 401, false)
      }
      return res([{ id: 'c' }])
    }
    await expect(
      runAtlassianOAuth({
        scopes: ['read:jira-work', 'offline_access'],
        clientId: 'CID',
        openExternal: (u) => {
          capturedState = new URL(u).searchParams.get('state') ?? ''
        },
        fetchImpl,
        serverFactory: fakeFactory(servers)
      })
    ).rejects.toThrow()
    expect(tokenCalls).toBe(1)
  })

  it('throws when the token response lacks a refresh_token (offline_access not granted)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', expires_in: 3600 })
      }
      return res([{ id: 'c' }])
    }
    await expect(
      runAtlassianOAuth({
        scopes: ['read:jira-work', 'offline_access'],
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

  it('opens the authorize URL with audience, prompt=consent, and offline_access scope (FR-A02)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    let authorizeUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
      }
      return res([{ id: 'c' }])
    }
    await runAtlassianOAuth({
      scopes: ['read:jira-work', 'offline_access'],
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
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // Secret NEVER appears in the authorize URL (SC-009).
    expect(authorizeUrl).not.toContain('client_secret')
  })

  // confluence-comment-author-name-v1: a reconnect must FORCE re-consent so the new token
  // carries the CURRENT full scope set (incl. the granular user-read scope). Atlassian otherwise
  // reuses the prior consent and mints a token with the OLD scope set, so the authed-user lookup
  // 403s and the comment author renders as the raw account id. `prompt=consent` is the fix;
  // this asserts the built authorize URL carries it alongside every required param AND the
  // read:user:confluence scope, while offline_access (refresh) + PKCE (S256) stay intact.
  it('forces re-consent and carries the full Confluence scope set incl. the user-read scope', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    let authorizeUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
      }
      return res([{ id: 'c' }])
    }
    await runAtlassianOAuth({
      scopes: CONFLUENCE_OAUTH_SCOPES,
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
    // Re-consent is forced on every connect/reconnect.
    expect(url.searchParams.get('prompt')).toBe('consent')
    // Required Atlassian authorize params.
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com')
    expect(url.searchParams.get('client_id')).toBe('CID')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe(capturedState)
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    // PKCE redirect stays intact (S256 challenge present, verifier kept out of the URL).
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // The granted scope set is the full CURRENT one: refresh (offline_access) + the granular
    // user-read scope whose absence caused the raw-account-id regression.
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('read:user:confluence')
    expect(scope).toContain('offline_access')
    // Secret NEVER appears in the authorize URL (SC-009).
    expect(authorizeUrl).not.toContain('client_secret')
  })

  it('never leaks the secret in the returned result (SC-009)', async () => {
    capturedState = ''
    const servers: FakeServer[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (url === ATLASSIAN_TOKEN_ENDPOINT) {
        return res({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
      }
      return res([{ id: 'c' }])
    }
    const result = await runAtlassianOAuth({
      scopes: ['read:jira-work', 'offline_access'],
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

describe('refreshAtlassianToken — secret-less FIRST then client_secret (FR-A09)', () => {
  it('refreshes secret-less when accepted', async () => {
    const bodies: string[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(init?.body ?? '')
      return res({ access_token: 'AT', refresh_token: 'RT-NEW', expires_in: 3600 })
    }
    const out = await refreshAtlassianToken({
      clientId: 'CID',
      clientSecret: 'S',
      refreshToken: 'OLD',
      fetchImpl
    })
    expect(out.accessToken).toBe('AT')
    expect(out.refreshToken).toBe('RT-NEW')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toContain('client_secret')
  })

  it('falls back to client_secret when the secret-less refresh is rejected (rotation)', async () => {
    const bodies: string[] = []
    let calls = 0
    const fetchImpl: FetchLike = async (_url, init) => {
      calls += 1
      bodies.push(init?.body ?? '')
      if (calls === 1) return res({ error: 'invalid_client' }, 401, false)
      return res({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })
    }
    const out = await refreshAtlassianToken({
      clientId: 'CID',
      clientSecret: 'SECRET',
      refreshToken: 'OLD',
      fetchImpl
    })
    expect(out.refreshToken).toBe('RT2')
    expect(calls).toBe(2)
    expect(bodies[1]).toContain('client_secret=SECRET')
  })

  it('rethrows without a secret to fall back to', async () => {
    const fetchImpl: FetchLike = async () => res({ error: 'invalid_grant' }, 400, false)
    await expect(
      refreshAtlassianToken({ clientId: 'CID', refreshToken: 'OLD', fetchImpl })
    ).rejects.toThrow()
  })
})
