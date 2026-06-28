import { describe, it, expect, vi } from 'vitest'
import { JiraManager, type JiraManagerDeps } from './jiraManager'
import type { JiraClient } from './integrations/jiraClient'
import type { AtlassianOAuthResult } from './integrations/atlassianOAuth'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { JiraResult } from '../shared/types/jira'

/** An in-memory TokenStore stand-in covering the methods JiraManager uses. */
function makeFakeStore(initial: StoredTokenSet | null = null, expired = false) {
  let tokens = initial
  const store = {
    load: () => tokens,
    save: (t: StoredTokenSet) => {
      tokens = t
    },
    clear: () => {
      tokens = null
    },
    has: () => tokens !== null,
    isExpired: () => expired
  }
  return { store: store as unknown as TokenStore, current: () => tokens }
}

/** A connected token set with cloudId/site in `extra` (FR-A07). */
const connectedTokens: StoredTokenSet = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scopes: ['read:jira-work', 'offline_access'],
  accountName: 'acme.atlassian.net',
  extra: { cloudId: 'cloud-9', siteName: 'acme.atlassian.net' }
}

const oauthOk = async (): Promise<AtlassianOAuthResult> => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresAtMs: Date.now() + 3_600_000,
  scopes: ['read:jira-work', 'offline_access'],
  cloudId: 'cloud-9',
  siteName: 'acme.atlassian.net',
  siteUrl: 'https://acme.atlassian.net'
})

function makeClient(overrides?: Partial<JiraClient>): JiraClient {
  const ok = async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    searchIssues: vi.fn(ok),
    getIssue: vi.fn(async () => ({ ok: true, data: { key: 'ABC-1' } })),
    transitionIssue: vi.fn(async () => ({ ok: true, data: { transitionId: '31' } })),
    addComment: vi.fn(async () => ({ ok: true, data: { id: 'c1', body: 'hi' } })),
    createIssue: vi.fn(async () => ({ ok: true, data: { key: 'ABC-99' } })),
    updateIssue: vi.fn(async () => ({ ok: true, data: { issueKey: 'ABC-1' } })),
    ...overrides
  } as unknown as JiraClient
}

/** A connected token set that ALSO grants the write scope (Jira generative-UI v1, D4). */
const writableTokens: StoredTokenSet = {
  ...connectedTokens,
  scopes: ['read:jira-work', 'write:jira-work', 'offline_access']
}

const refreshOk = async (): Promise<TokenExchangeResult> => ({
  accessToken: 'at-2',
  refreshToken: 'rt-2',
  expiresInSeconds: 3600,
  raw: {}
})

function makeManager(deps: Partial<JiraManagerDeps> & { store: TokenStore }) {
  const onStatusChanged = vi.fn()
  const manager = new JiraManager({
    client: deps.client ?? makeClient(),
    tokenStore: deps.store,
    runOAuth: deps.runOAuth ?? vi.fn(oauthOk),
    refresh: deps.refresh ?? vi.fn(refreshOk),
    onStatusChanged
  })
  return { manager, onStatusChanged }
}

describe('JiraManager state machine (FR-A09, FR-A10, FR-A12, FR-A14, SC-007, SC-009)', () => {
  it('starts not_connected with no stored token', () => {
    const { store } = makeFakeStore(null)
    const { manager } = makeManager({ store })
    expect(manager.getStatus().state).toBe('not_connected')
  })

  it('starts connected when a token is already persisted', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    const status = manager.getStatus()
    expect(status.state).toBe('connected')
    expect(status.siteName).toBe('acme.atlassian.net')
  })

  it('connect() runs OAuth, resolves+persists cloudId, and goes connected', async () => {
    const { store, current } = makeFakeStore(null)
    const states: string[] = []
    const onStatusChanged = vi.fn((s) => states.push(s.state))
    const runOAuth = vi.fn(oauthOk)
    const manager = new JiraManager({
      client: makeClient(),
      tokenStore: store,
      runOAuth,
      refresh: vi.fn(refreshOk),
      onStatusChanged
    })

    const status = await manager.connect()

    expect(runOAuth).toHaveBeenCalledOnce()
    expect(status.state).toBe('connected')
    expect(status.siteName).toBe('acme.atlassian.net')
    expect(states).toEqual(['connecting', 'connected'])
    const saved = current()
    expect(saved?.accessToken).toBe('at-1')
    expect(saved?.refreshToken).toBe('rt-1')
    expect(saved?.extra?.cloudId).toBe('cloud-9')
  })

  it('connect() failure -> not_connected, lastError set, no token saved (no accessible site, deny, timeout)', async () => {
    const { store, current } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<AtlassianOAuthResult> => {
      throw new Error('No accessible Atlassian site for this account.')
    })
    const { manager } = makeManager({ store, runOAuth })

    const status = await manager.connect()

    expect(status.state).toBe('not_connected')
    expect(status.lastError).toMatch(/cancelled|failed/i)
    expect(current()).toBeNull()
  })

  it('connect() never leaks the token/secret into the status (SC-009)', async () => {
    const { store } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<AtlassianOAuthResult> => ({
      accessToken: 'at-SECRET-XYZ',
      refreshToken: 'rt-SECRET-XYZ',
      scopes: ['read:jira-work', 'offline_access'],
      cloudId: 'cloud-9',
      siteName: 'acme.atlassian.net'
    }))
    const { manager } = makeManager({ store, runOAuth })
    const status = await manager.connect()
    expect(JSON.stringify(status)).not.toContain('SECRET-XYZ')
  })

  it('disconnect() deletes the token and returns to not_connected (FR-A14)', () => {
    const { store, current } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    const status = manager.disconnect()
    expect(status.state).toBe('not_connected')
    expect(current()).toBeNull()
  })

  it('a read while not_connected returns a structured not_connected result (no client call)', async () => {
    const { store } = makeFakeStore(null)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.searchIssues({ jql: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.searchIssues).not.toHaveBeenCalled()
  })

  it('forwards a successful read to the client with token + cloudId (FR-A07/A13)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.searchIssues({ jql: 'project = ABC' })
    expect(client.searchIssues).toHaveBeenCalledWith(
      { token: 'at-1', cloudId: 'cloud-9' },
      'project = ABC',
      undefined
    )
  })

  it('refreshes transparently on expiry, persists the rotated set, and stays connected (FR-A09)', async () => {
    const { store, current } = makeFakeStore(connectedTokens, true) // expired
    const refresh = vi.fn(refreshOk)
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.searchIssues({ jql: 'x' })

    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledWith('rt-1')
    // The rotated token + refresh token were persisted.
    expect(current()?.accessToken).toBe('at-2')
    expect(current()?.refreshToken).toBe('rt-2')
    // The read ran with the refreshed access token.
    expect(client.searchIssues).toHaveBeenCalledWith(
      { token: 'at-2', cloudId: 'cloud-9' },
      'x',
      undefined
    )
    expect(manager.getStatus().state).toBe('connected')
  })

  it('a refresh failure on expiry flips to reconnect_needed (FR-A10, SC-007)', async () => {
    const { store } = makeFakeStore(connectedTokens, true) // expired
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => {
      throw new Error('invalid_grant')
    })
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.searchIssues({ jql: 'x' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(manager.getStatus().state).toBe('reconnect_needed')
    expect(client.searchIssues).not.toHaveBeenCalled()
  })

  it('a 401 mid-read triggers ONE reactive refresh + retry, then succeeds (FR-A09)', async () => {
    const { store } = makeFakeStore(connectedTokens) // not expired
    let calls = 0
    const client = makeClient({
      searchIssues: vi.fn(async (): Promise<JiraResult<unknown>> => {
        calls += 1
        if (calls === 1) {
          return { ok: false, kind: 'reconnect_needed', message: 'expired' }
        }
        return { ok: true, data: { items: [] } }
      }) as unknown as JiraClient['searchIssues']
    })
    const refresh = vi.fn(refreshOk)
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.searchIssues({ jql: 'x' })

    expect(refresh).toHaveBeenCalledOnce()
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
    expect(manager.getStatus().state).toBe('connected')
  })

  it('a 401 whose reactive refresh also fails flips to reconnect_needed (SC-007)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      searchIssues: vi.fn(
        async (): Promise<JiraResult<unknown>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'expired'
        })
      ) as unknown as JiraClient['searchIssues']
    })
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => {
      throw new Error('invalid_grant')
    })
    const { manager } = makeManager({ store, client, refresh })

    await manager.searchIssues({ jql: 'x' })
    expect(manager.getStatus().state).toBe('reconnect_needed')
  })

  it('never exposes the token in the status (SC-009)', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    expect(JSON.stringify(manager.getStatus())).not.toContain('at-1')
  })
})

describe('JiraManager writes (Jira generative-UI v1, FR-010, FR-013, D4)', () => {
  it('getWriteCapability is false without write:jira-work and true with it', () => {
    const { store: ro } = makeFakeStore(connectedTokens) // read-only-era token
    expect(makeManager({ store: ro }).manager.getWriteCapability()).toBe(false)

    const { store: rw } = makeFakeStore(writableTokens)
    expect(makeManager({ store: rw }).manager.getWriteCapability()).toBe(true)
  })

  it('a write without write:jira-work short-circuits to write_not_authorized (no client call)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.transitionIssue({ issueKey: 'ABC-1', transitionId: '31' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('write_not_authorized')
      expect(result.message).toMatch(/reconnect/i)
    }
    expect(client.transitionIssue).not.toHaveBeenCalled()
  })

  it('addComment without the scope also short-circuits (no client call)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.addComment({ issueKey: 'ABC-1', body: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('write_not_authorized')
    expect(client.addComment).not.toHaveBeenCalled()
  })

  it('a write WITH the scope forwards to the client with token + cloudId (FR-010)', async () => {
    const { store } = makeFakeStore(writableTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.transitionIssue({ issueKey: 'ABC-1', transitionId: '31' })
    expect(result.ok).toBe(true)
    expect(client.transitionIssue).toHaveBeenCalledWith(
      { token: 'at-1', cloudId: 'cloud-9' },
      { issueKey: 'ABC-1', transitionId: '31' }
    )
  })

  it('a write goes through run(): expiry refreshes transparently then writes (FR-010)', async () => {
    const { store, current } = makeFakeStore(writableTokens, true) // expired
    const refresh = vi.fn(refreshOk)
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.addComment({ issueKey: 'ABC-1', body: 'hi' })
    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledWith('rt-1')
    expect(current()?.accessToken).toBe('at-2')
    expect(client.addComment).toHaveBeenCalledWith(
      { token: 'at-2', cloudId: 'cloud-9' },
      'ABC-1',
      'hi'
    )
  })

  it('a write 401 triggers ONE reactive refresh + retry like reads (FR-010)', async () => {
    const { store } = makeFakeStore(writableTokens) // not expired
    let calls = 0
    const client = makeClient({
      transitionIssue: vi.fn(async (): Promise<JiraResult<unknown>> => {
        calls += 1
        if (calls === 1) return { ok: false, kind: 'reconnect_needed', message: 'expired' }
        return { ok: true, data: { transitionId: '31' } }
      }) as unknown as JiraClient['transitionIssue']
    })
    const refresh = vi.fn(refreshOk)
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.transitionIssue({ issueKey: 'ABC-1', transitionId: '31' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('never exposes the token in a write result (SC-009)', async () => {
    const { store } = makeFakeStore(writableTokens)
    const { manager } = makeManager({ store })
    const result = await manager.transitionIssue({ issueKey: 'ABC-1', transitionId: '31' })
    expect(JSON.stringify(result)).not.toContain('at-1')
  })
})

describe('JiraManager create/update (Jira write-extend v1, FR-010, FR-012/013)', () => {
  const createParams = {
    projectKey: 'ABC',
    issueType: 'Task',
    summary: 'New issue',
    description: ''
  }
  const updateParams = { issueKey: 'ABC-1', fields: { summary: 'Edited' } }

  it('createIssue without write:jira-work short-circuits to write_not_authorized (no client call)', async () => {
    const { store } = makeFakeStore(connectedTokens) // read-only-era token
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.createIssue(createParams)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('write_not_authorized')
      expect(result.message).toMatch(/reconnect/i)
    }
    expect(client.createIssue).not.toHaveBeenCalled()
  })

  it('updateIssue without write:jira-work short-circuits to write_not_authorized (no client call)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.updateIssue(updateParams)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('write_not_authorized')
    expect(client.updateIssue).not.toHaveBeenCalled()
  })

  it('createIssue WITH the scope forwards to the client with token + cloudId + params (FR-010)', async () => {
    const { store } = makeFakeStore(writableTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.createIssue(createParams)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({ key: 'ABC-99' })
    expect(client.createIssue).toHaveBeenCalledWith(
      { token: 'at-1', cloudId: 'cloud-9' },
      createParams
    )
  })

  it('updateIssue WITH the scope forwards to the client with token + cloudId + params (FR-010)', async () => {
    const { store } = makeFakeStore(writableTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })

    const result = await manager.updateIssue(updateParams)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({ issueKey: 'ABC-1' })
    expect(client.updateIssue).toHaveBeenCalledWith(
      { token: 'at-1', cloudId: 'cloud-9' },
      updateParams
    )
  })

  it('createIssue goes through run(): expiry refreshes transparently then writes (FR-010)', async () => {
    const { store, current } = makeFakeStore(writableTokens, true) // expired
    const refresh = vi.fn(refreshOk)
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.createIssue(createParams)
    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledWith('rt-1')
    expect(current()?.accessToken).toBe('at-2')
    expect(client.createIssue).toHaveBeenCalledWith(
      { token: 'at-2', cloudId: 'cloud-9' },
      createParams
    )
  })

  it('never exposes the token in a create/update result (SC-009)', async () => {
    const { store } = makeFakeStore(writableTokens)
    const { manager } = makeManager({ store })
    const created = await manager.createIssue(createParams)
    const updated = await manager.updateIssue(updateParams)
    expect(JSON.stringify(created)).not.toContain('at-1')
    expect(JSON.stringify(updated)).not.toContain('at-1')
  })
})
