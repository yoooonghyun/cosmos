import { describe, it, expect, vi } from 'vitest'
import { ConfluenceManager, type ConfluenceManagerDeps } from './confluenceManager'
import type { ConfluenceClient } from './integrations/confluenceClient'
import type { AtlassianOAuthResult } from './integrations/atlassianOAuth'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { ConfluenceResult } from '../shared/confluence'

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

const connectedTokens: StoredTokenSet = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scopes: ['read:page:confluence', 'read:space:confluence', 'search:confluence', 'offline_access'],
  accountName: 'acme.atlassian.net',
  extra: { cloudId: 'cloud-9', siteName: 'acme.atlassian.net' }
}

const oauthOk = async (): Promise<AtlassianOAuthResult> => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresAtMs: Date.now() + 3_600_000,
  scopes: ['read:page:confluence', 'read:space:confluence', 'search:confluence', 'offline_access'],
  cloudId: 'cloud-9',
  siteName: 'acme.atlassian.net'
})

function makeClient(overrides?: Partial<ConfluenceClient>): ConfluenceClient {
  const ok = async (): Promise<ConfluenceResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    searchContent: vi.fn(ok),
    defaultFeed: vi.fn(ok),
    getPage: vi.fn(async () => ({ ok: true, data: { id: '1', title: 't', body: '' } })),
    createPage: vi.fn(async () => ({ ok: true, data: { id: '777', title: 'Notes' } })),
    ...overrides
  } as unknown as ConfluenceClient
}

const writeTokens: StoredTokenSet = {
  ...connectedTokens,
  scopes: ['read:page:confluence', 'write:page:confluence', 'offline_access']
}

const refreshOk = async (): Promise<TokenExchangeResult> => ({
  accessToken: 'at-2',
  refreshToken: 'rt-2',
  expiresInSeconds: 3600,
  raw: {}
})

function makeManager(deps: Partial<ConfluenceManagerDeps> & { store: TokenStore }) {
  const onStatusChanged = vi.fn()
  const manager = new ConfluenceManager({
    client: deps.client ?? makeClient(),
    tokenStore: deps.store,
    runOAuth: deps.runOAuth ?? vi.fn(oauthOk),
    refresh: deps.refresh ?? vi.fn(refreshOk),
    onStatusChanged
  })
  return { manager, onStatusChanged }
}

describe('ConfluenceManager state machine (FR-A09, FR-A10, FR-A13, FR-A14, SC-007, SC-009)', () => {
  it('starts not_connected with no stored token', () => {
    const { store } = makeFakeStore(null)
    expect(makeManager({ store }).manager.getStatus().state).toBe('not_connected')
  })

  it('starts connected when a token is already persisted', () => {
    const { store } = makeFakeStore(connectedTokens)
    const status = makeManager({ store }).manager.getStatus()
    expect(status.state).toBe('connected')
    expect(status.siteName).toBe('acme.atlassian.net')
  })

  it('connect() runs OAuth, persists cloudId, and goes connected', async () => {
    const { store, current } = makeFakeStore(null)
    const { manager } = makeManager({ store })
    const status = await manager.connect()
    expect(status.state).toBe('connected')
    expect(current()?.extra?.cloudId).toBe('cloud-9')
  })

  it('connect() failure -> not_connected with lastError, no token saved', async () => {
    const { store, current } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<AtlassianOAuthResult> => {
      throw new Error('denied')
    })
    const { manager } = makeManager({ store, runOAuth })
    const status = await manager.connect()
    expect(status.state).toBe('not_connected')
    expect(status.lastError).toMatch(/cancelled|failed/i)
    expect(current()).toBeNull()
  })

  it('disconnect() deletes only this connection token (FR-A14)', () => {
    const { store, current } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    manager.disconnect()
    expect(current()).toBeNull()
  })

  it('a read while not_connected returns a structured result without a client call', async () => {
    const { store } = makeFakeStore(null)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.searchContent({ query: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.searchContent).not.toHaveBeenCalled()
  })

  it('forwards a read with token + cloudId', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.getPage({ pageId: '12345' })
    expect(client.getPage).toHaveBeenCalledWith({ token: 'at-1', cloudId: 'cloud-9' }, '12345')
  })

  it('refreshes transparently on expiry and stays connected (FR-A09)', async () => {
    const { store, current } = makeFakeStore(connectedTokens, true)
    const refresh = vi.fn(refreshOk)
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })
    const result = await manager.searchContent({ query: 'x' })
    expect(result.ok).toBe(true)
    expect(current()?.accessToken).toBe('at-2')
    expect(manager.getStatus().state).toBe('connected')
  })

  it('a refresh failure on expiry flips to reconnect_needed (FR-A10)', async () => {
    const { store } = makeFakeStore(connectedTokens, true)
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => {
      throw new Error('invalid_grant')
    })
    const { manager } = makeManager({ store, refresh })
    const result = await manager.searchContent({ query: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(manager.getStatus().state).toBe('reconnect_needed')
  })

  it('never exposes the token in the status (SC-009)', () => {
    const { store } = makeFakeStore(connectedTokens)
    expect(JSON.stringify(makeManager({ store }).manager.getStatus())).not.toContain('at-1')
  })
})

describe('ConfluenceManager.defaultFeed (confluence-default-feed v1, FR-014, FR-015)', () => {
  it('resolves ok and calls client.defaultFeed once when connected', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.defaultFeed({})
    expect(result.ok).toBe(true)
    expect(client.defaultFeed).toHaveBeenCalledTimes(1)
  })

  it('returns not_connected without a client call when not connected (FR-015)', async () => {
    const { store } = makeFakeStore(null)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.defaultFeed({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.defaultFeed).not.toHaveBeenCalled()
  })

  it('retries after a successful refresh when the client returns reconnect_needed once', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const reconnectThenOk = vi
      .fn<ConfluenceClient['defaultFeed']>()
      .mockResolvedValueOnce({
        ok: false,
        kind: 'reconnect_needed',
        message: 'expired'
      })
      .mockResolvedValueOnce({ ok: true, data: { items: [] } })
    const client = makeClient({ defaultFeed: reconnectThenOk })
    const refresh = vi.fn(refreshOk)
    const { manager } = makeManager({ store, client, refresh })
    const result = await manager.defaultFeed({})
    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(reconnectThenOk).toHaveBeenCalledTimes(2)
    expect(manager.getStatus().state).toBe('connected')
  })

  it('passes params.cursor to client.defaultFeed (cursor passthrough)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.defaultFeed({ cursor: 'CUR42' })
    expect(client.defaultFeed).toHaveBeenCalledWith({ token: 'at-1', cloudId: 'cloud-9' }, 'CUR42')
  })
})

describe('ConfluenceManager.createPage (write scope short-circuit)', () => {
  it('reports the write capability from the stored scopes', () => {
    expect(makeManager({ store: makeFakeStore(writeTokens).store }).manager.getWriteCapability()).toBe(
      true
    )
    expect(
      makeManager({ store: makeFakeStore(connectedTokens).store }).manager.getWriteCapability()
    ).toBe(false)
  })

  it('short-circuits to write_not_authorized when the token lacks the write scope (no client call)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.createPage({ spaceKey: 'ENG', title: 'T', body: 'b' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('write_not_authorized')
    }
    expect(client.createPage).not.toHaveBeenCalled()
  })

  it('routes the create through the client when the write scope is present (happy path)', async () => {
    const { store } = makeFakeStore(writeTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.createPage({ spaceKey: 'ENG', title: 'Notes', body: 'hi' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: '777', title: 'Notes' })
    }
    expect(client.createPage).toHaveBeenCalledWith(
      { token: 'at-1', cloudId: 'cloud-9' },
      { spaceKey: 'ENG', title: 'Notes', body: 'hi' }
    )
  })

  it('short-circuits (write_not_authorized) when there is no token — a scope-less state', async () => {
    const { store } = makeFakeStore(null)
    const result = await makeManager({ store }).manager.createPage({
      spaceKey: 'ENG',
      title: 'T',
      body: 'b'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('write_not_authorized')
    }
  })
})
