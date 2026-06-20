import { describe, it, expect, vi } from 'vitest'
import { SlackManager, type SlackManagerDeps } from './slackManager'
import type { SlackClient } from './integrations/slackClient'
import type { SlackOAuthResult } from './integrations/slackOAuth'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { SlackResult } from '../shared/slack'

/** An in-memory TokenStore stand-in covering the methods SlackManager uses. */
function makeFakeStore(initial: StoredTokenSet | null = null) {
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
    isExpired: () => false
  }
  return {
    store: store as unknown as TokenStore,
    current: () => tokens
  }
}

/** A connected token set: one user token grants every read incl. search + send. */
const connectedTokens: StoredTokenSet = {
  accessToken: 'xoxp-1',
  scopes: ['channels:read', 'channels:history', 'users:read', 'search:read', 'chat:write'],
  accountId: 'T1',
  accountName: 'Acme'
}

/** Default OAuth result used by the connect-path tests. */
const oauthOk = async (): Promise<SlackOAuthResult> => ({
  userToken: 'xoxp-1',
  scopes: ['channels:read', 'channels:history', 'users:read', 'search:read'],
  teamId: 'T1',
  teamName: 'Acme'
})

function makeClient(overrides?: Partial<SlackClient>): SlackClient {
  const ok = async (): Promise<SlackResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    listChannels: vi.fn(ok),
    getHistory: vi.fn(ok),
    getReplies: vi.fn(ok),
    search: vi.fn(ok),
    getUser: vi.fn(async () => ({ ok: true, data: { id: 'U1', displayName: 'Ada' } })),
    postMessage: vi.fn(async () => ({ ok: true, data: { ts: '1700000000.000100' } })),
    ...overrides
  } as unknown as SlackClient
}

function makeManager(deps: Partial<SlackManagerDeps> & { store: TokenStore }) {
  const onStatusChanged = vi.fn()
  const manager = new SlackManager({
    client: deps.client ?? makeClient(),
    tokenStore: deps.store,
    runOAuth: deps.runOAuth ?? vi.fn(oauthOk),
    onStatusChanged
  })
  return { manager, onStatusChanged }
}

describe('SlackManager state machine (FR-008, FR-009, SC-007, SC-010)', () => {
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
    expect(status.workspaceName).toBe('Acme')
    expect(status.canSearch).toBe(true)
    expect(status.canSend).toBe(true)
  })

  it('connect() runs the OAuth flow, persists the user token, and goes connected', async () => {
    const { store, current } = makeFakeStore(null)
    const states: string[] = []
    const onStatusChanged = vi.fn((s) => states.push(s.state))
    const runOAuth = vi.fn(oauthOk)
    const manager = new SlackManager({
      client: makeClient(),
      tokenStore: store,
      runOAuth,
      onStatusChanged
    })

    const status = await manager.connect()

    expect(runOAuth).toHaveBeenCalledOnce()
    expect(status.state).toBe('connected')
    expect(status.workspaceName).toBe('Acme')
    expect(status.teamId).toBe('T1')
    expect(status.canSearch).toBe(true)
    expect(states).toEqual(['connecting', 'connected'])
    const saved = current()
    expect(saved?.accessToken).toBe('xoxp-1')
    expect(saved?.accountName).toBe('Acme')
    expect(saved?.scopes).toContain('search:read')
  })

  it('connect() without the search scope connects with canSearch false', async () => {
    const { store, current } = makeFakeStore(null)
    const runOAuth = vi.fn(
      async (): Promise<SlackOAuthResult> => ({
        userToken: 'xoxp-1',
        scopes: ['channels:read', 'channels:history', 'users:read'],
        teamId: 'T1',
        teamName: 'Acme'
      })
    )
    const { manager } = makeManager({ store, runOAuth })
    const status = await manager.connect()
    expect(status.state).toBe('connected')
    expect(status.canSearch).toBe(false)
    expect(current()?.scopes).not.toContain('search:read')
  })

  it('connect() failure (deny/timeout) -> not_connected, lastError set, no token saved (SC-002)', async () => {
    const { store, current } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<SlackOAuthResult> => {
      throw new Error('authorization timed out')
    })
    const { manager } = makeManager({ store, runOAuth })

    const status = await manager.connect()

    expect(status.state).toBe('not_connected')
    expect(status.lastError).toMatch(/cancelled|failed/i)
    expect(current()).toBeNull()
  })

  it('connect() never leaks the token into the status (SC-008)', async () => {
    const { store } = makeFakeStore(null)
    const runOAuth = vi.fn(
      async (): Promise<SlackOAuthResult> => ({
        userToken: 'xoxp-secret',
        scopes: ['channels:read', 'search:read'],
        teamId: 'T1',
        teamName: 'Acme'
      })
    )
    const { manager } = makeManager({ store, runOAuth })
    const status = await manager.connect()
    expect(JSON.stringify(status)).not.toContain('xoxp-secret')
  })

  it('disconnect() deletes the token and returns to not_connected (FR-009, SC-010)', () => {
    const { store, current } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    const status = manager.disconnect()
    expect(status.state).toBe('not_connected')
    expect(current()).toBeNull()
  })

  it('a read while not_connected returns a structured not_connected result (no token attached)', async () => {
    const { store } = makeFakeStore(null)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.listChannels({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.listChannels).not.toHaveBeenCalled()
  })

  it('forwards a successful read to the client with the user token (FR-008)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.getHistory({ channelId: 'C1' })
    // slack-rich-message-render-v1: a per-session resolvers object is threaded as the 4th arg.
    expect(client.getHistory).toHaveBeenCalledWith(
      { token: 'xoxp-1' },
      'C1',
      undefined,
      expect.objectContaining({
        resolveUserName: expect.any(Function),
        resolveCustomEmojiRef: expect.any(Function)
      })
    )
  })

  it('a reconnect_needed result mid-read flips connection state (SC-007)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listChannels: vi.fn(
        async (): Promise<SlackResult<unknown>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'expired'
        })
      ) as unknown as SlackClient['listChannels']
    })
    const { manager } = makeManager({ store, client })
    await manager.listChannels({})
    expect(manager.getStatus().state).toBe('reconnect_needed')
  })

  it('search without the search scope returns search_unavailable without calling search (FR-015)', async () => {
    const noScope: StoredTokenSet = { ...connectedTokens, scopes: ['channels:read'] }
    const { store } = makeFakeStore(noScope)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.search({ query: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('search_unavailable')
    }
    expect(client.search).not.toHaveBeenCalled()
  })

  it('search with the search scope attaches the user token (FR-015)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.search({ query: 'hi' })
    expect(client.search).toHaveBeenCalledWith(
      { token: 'xoxp-1' },
      'hi',
      undefined,
      expect.objectContaining({
        resolveUserName: expect.any(Function),
        resolveCustomEmojiRef: expect.any(Function)
      })
    )
  })

  it('canSearch is false when the search scope is absent (FR-015)', () => {
    const noScope: StoredTokenSet = { ...connectedTokens, scopes: ['channels:read'] }
    const { store } = makeFakeStore(noScope)
    const { manager } = makeManager({ store })
    expect(manager.getStatus().canSearch).toBe(false)
  })

  it('never exposes the token in the status (SC-008)', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    const json = JSON.stringify(manager.getStatus())
    expect(json).not.toContain('xoxp-1')
  })
})

describe('SlackManager.sendMessage (slack-send-message-v1, FR-006..FR-009, FR-015)', () => {
  it('getStatus reports canSend true when chat:write is granted', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    expect(manager.getStatus().canSend).toBe(true)
  })

  it('getStatus reports canSend false when chat:write is absent (read-only-era token)', () => {
    const noWrite: StoredTokenSet = { ...connectedTokens, scopes: ['channels:read', 'search:read'] }
    const { store } = makeFakeStore(noWrite)
    const { manager } = makeManager({ store })
    expect(manager.getStatus().canSend).toBe(false)
  })

  it('a send while not_connected returns not_connected without calling the client', async () => {
    const { store } = makeFakeStore(null)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.sendMessage({ channelId: 'C1', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.postMessage).not.toHaveBeenCalled()
  })

  it('short-circuits to write_not_authorized when chat:write is absent (NO client call — FR-008)', async () => {
    const noWrite: StoredTokenSet = { ...connectedTokens, scopes: ['channels:read'] }
    const { store } = makeFakeStore(noWrite)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.sendMessage({ channelId: 'C1', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('write_not_authorized')
    }
    expect(client.postMessage).not.toHaveBeenCalled()
  })

  it('posts a channel message with the user token and no thread_ts (FR-006)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    const result = await manager.sendMessage({ channelId: 'C1', text: 'hello' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.ts).toBe('1700000000.000100')
    }
    expect(client.postMessage).toHaveBeenCalledWith({ token: 'xoxp-1' }, 'C1', 'hello', undefined)
  })

  it('posts a thread reply carrying thread_ts when threadTs is present (FR-002)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.sendMessage({ channelId: 'C1', text: 'reply', threadTs: '1.2' })
    expect(client.postMessage).toHaveBeenCalledWith({ token: 'xoxp-1' }, 'C1', 'reply', '1.2')
  })

  it('a reconnect_needed send result flips connection state (FR-015)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      postMessage: vi.fn(
        async (): Promise<SlackResult<unknown>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'expired'
        })
      ) as unknown as SlackClient['postMessage']
    })
    const { manager } = makeManager({ store, client })
    await manager.sendMessage({ channelId: 'C1', text: 'hi' })
    expect(manager.getStatus().state).toBe('reconnect_needed')
  })

  it('maps a network error to a graceful result (no crash — FR-014)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      postMessage: vi.fn(
        async (): Promise<SlackResult<unknown>> => ({
          ok: false,
          kind: 'network',
          message: 'Could not reach Slack.'
        })
      ) as unknown as SlackClient['postMessage']
    })
    const { manager } = makeManager({ store, client })
    const result = await manager.sendMessage({ channelId: 'C1', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('never leaks the token into a send result (SC-006)', async () => {
    const secretTokens: StoredTokenSet = { ...connectedTokens, accessToken: 'xoxp-secret' }
    const { store } = makeFakeStore(secretTokens)
    const { manager } = makeManager({ store })
    const result = await manager.sendMessage({ channelId: 'C1', text: 'hi' })
    expect(JSON.stringify(result)).not.toContain('xoxp-secret')
  })
})
