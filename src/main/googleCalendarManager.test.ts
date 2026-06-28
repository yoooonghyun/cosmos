import { describe, it, expect, vi } from 'vitest'
import {
  GoogleCalendarManager,
  orderAndCapCalendars,
  type GoogleCalendarManagerDeps
} from './googleCalendarManager'
import type { GoogleCalendarClient } from './integrations/googleCalendarClient'
import type { GoogleOAuthResult } from './integrations/googleOAuth'
import type { TokenExchangeResult } from './integrations/oauthPkce'
import type { StoredTokenSet, TokenStore } from './integrations/tokenStore'
import type { GoogleCalendar, GoogleCalendarResult } from '../shared/types/googleCalendar'

/** An in-memory TokenStore stand-in covering the methods the manager uses. */
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

/** A connected token set with identity in `extra`. */
const connectedTokens: StoredTokenSet = {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  accountName: 'Me',
  extra: { accountEmail: 'me@example.com', timeZone: 'America/Los_Angeles' }
}

const oauthOk = async (): Promise<GoogleOAuthResult> => ({
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresAtMs: Date.now() + 3_600_000,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  accountEmail: 'me@example.com',
  accountName: 'Me',
  timeZone: 'America/Los_Angeles'
})

function makeClient(overrides?: Partial<GoogleCalendarClient>): GoogleCalendarClient {
  return {
    getPrimaryCalendar: vi.fn(async () => ({
      ok: true,
      data: { id: 'me@example.com', summary: 'Me', timeZone: 'America/Los_Angeles' }
    })),
    listEvents: vi.fn(async (): Promise<GoogleCalendarResult<unknown>> => ({
      ok: true,
      data: { items: [] }
    })),
    ...overrides
  } as unknown as GoogleCalendarClient
}

// Google does NOT rotate the refresh token: refresh returns a NEW access token and
// (typically) NO refresh token.
const refreshOk = async (): Promise<TokenExchangeResult> => ({
  accessToken: 'at-2',
  expiresInSeconds: 3600,
  raw: {}
})

function makeManager(deps: Partial<GoogleCalendarManagerDeps> & { store: TokenStore }) {
  const onStatusChanged = vi.fn()
  const manager = new GoogleCalendarManager({
    client: deps.client ?? makeClient(),
    tokenStore: deps.store,
    runOAuth: deps.runOAuth ?? vi.fn(oauthOk),
    refresh: deps.refresh ?? vi.fn(refreshOk),
    onStatusChanged
  })
  return { manager, onStatusChanged }
}

const window = { timeMin: '2026-06-15T00:00:00Z', timeMax: '2026-06-22T00:00:00Z' }

describe('GoogleCalendarManager state machine', () => {
  it('starts not_connected with no stored token', () => {
    const { store } = makeFakeStore(null)
    const { manager } = makeManager({ store })
    expect(manager.getStatus().state).toBe('not_connected')
  })

  it('starts connected when a token is already persisted, exposing non-secret identity', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    const status = manager.getStatus()
    expect(status.state).toBe('connected')
    expect(status.accountEmail).toBe('me@example.com')
    expect(status.accountName).toBe('Me')
    expect(status.timeZone).toBe('America/Los_Angeles')
  })

  it('connect() runs OAuth, persists tokens + identity, and goes connected', async () => {
    const { store, current } = makeFakeStore(null)
    const states: string[] = []
    const onStatusChanged = vi.fn((s) => states.push(s.state))
    const runOAuth = vi.fn(oauthOk)
    const manager = new GoogleCalendarManager({
      client: makeClient(),
      tokenStore: store,
      runOAuth,
      refresh: vi.fn(refreshOk),
      onStatusChanged
    })

    const status = await manager.connect()

    expect(runOAuth).toHaveBeenCalledOnce()
    expect(status.state).toBe('connected')
    expect(status.accountEmail).toBe('me@example.com')
    expect(states).toEqual(['connecting', 'connected'])
    const saved = current()
    expect(saved?.accessToken).toBe('at-1')
    expect(saved?.refreshToken).toBe('rt-1')
    expect(saved?.extra?.accountEmail).toBe('me@example.com')
    expect(saved?.extra?.timeZone).toBe('America/Los_Angeles')
  })

  it('connect() failure -> not_connected, lastError set, no token saved', async () => {
    const { store, current } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<GoogleOAuthResult> => {
      throw new Error('Google token response missing refresh_token')
    })
    const { manager } = makeManager({ store, runOAuth })

    const status = await manager.connect()

    expect(status.state).toBe('not_connected')
    expect(status.lastError).toMatch(/cancelled|failed/i)
    expect(current()).toBeNull()
  })

  it('connect() never leaks the token into the status (SC-009)', async () => {
    const { store } = makeFakeStore(null)
    const runOAuth = vi.fn(async (): Promise<GoogleOAuthResult> => ({
      accessToken: 'at-SECRET-XYZ',
      refreshToken: 'rt-SECRET-XYZ',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      accountEmail: 'me@example.com'
    }))
    const { manager } = makeManager({ store, runOAuth })
    const status = await manager.connect()
    expect(JSON.stringify(status)).not.toContain('SECRET-XYZ')
  })

  it('disconnect() deletes the token and returns to not_connected', () => {
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
    const result = await manager.listEvents(window)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
    expect(client.listEvents).not.toHaveBeenCalled()
  })

  it('forwards a successful read to the client with the token + window + cursor', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient()
    const { manager } = makeManager({ store, client })
    await manager.listEvents({ ...window, cursor: 'CUR' })
    expect(client.listEvents).toHaveBeenCalledWith(
      { token: 'at-1' },
      window.timeMin,
      window.timeMax,
      'CUR',
      undefined
    )
  })

  it('refreshes transparently on expiry, PRESERVES the refresh token, stays connected', async () => {
    const { store, current } = makeFakeStore(connectedTokens, true) // expired
    const refresh = vi.fn(refreshOk) // returns no refresh_token (Google non-rotating)
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.listEvents(window)

    expect(result.ok).toBe(true)
    expect(refresh).toHaveBeenCalledWith('rt-1')
    // New access token persisted; the EXISTING refresh token preserved (non-rotating).
    expect(current()?.accessToken).toBe('at-2')
    expect(current()?.refreshToken).toBe('rt-1')
    expect(client.listEvents).toHaveBeenCalledWith(
      { token: 'at-2' },
      window.timeMin,
      window.timeMax,
      undefined,
      undefined
    )
    expect(manager.getStatus().state).toBe('connected')
  })

  it('adopts a rotated refresh token when Google does return one', async () => {
    const { store, current } = makeFakeStore(connectedTokens, true)
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => ({
      accessToken: 'at-2',
      refreshToken: 'rt-ROTATED',
      expiresInSeconds: 3600,
      raw: {}
    }))
    const { manager } = makeManager({ store, refresh })
    await manager.listEvents(window)
    expect(current()?.refreshToken).toBe('rt-ROTATED')
  })

  it('a refresh failure on expiry flips to reconnect_needed', async () => {
    const { store } = makeFakeStore(connectedTokens, true) // expired
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => {
      throw new Error('invalid_grant')
    })
    const client = makeClient()
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.listEvents(window)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(manager.getStatus().state).toBe('reconnect_needed')
    expect(client.listEvents).not.toHaveBeenCalled()
  })

  it('a 401 mid-read triggers ONE reactive refresh + retry, then succeeds', async () => {
    const { store } = makeFakeStore(connectedTokens) // not expired
    let calls = 0
    const client = makeClient({
      listEvents: vi.fn(async (): Promise<GoogleCalendarResult<unknown>> => {
        calls += 1
        if (calls === 1) {
          return { ok: false, kind: 'reconnect_needed', message: 'expired' }
        }
        return { ok: true, data: { items: [] } }
      }) as unknown as GoogleCalendarClient['listEvents']
    })
    const refresh = vi.fn(refreshOk)
    const { manager } = makeManager({ store, client, refresh })

    const result = await manager.listEvents(window)

    expect(refresh).toHaveBeenCalledOnce()
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
    expect(manager.getStatus().state).toBe('connected')
  })

  it('a 401 whose reactive refresh also fails flips to reconnect_needed', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listEvents: vi.fn(
        async (): Promise<GoogleCalendarResult<unknown>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'expired'
        })
      ) as unknown as GoogleCalendarClient['listEvents']
    })
    const refresh = vi.fn(async (): Promise<TokenExchangeResult> => {
      throw new Error('invalid_grant')
    })
    const { manager } = makeManager({ store, client, refresh })

    await manager.listEvents(window)
    expect(manager.getStatus().state).toBe('reconnect_needed')
  })

  it('never exposes the token in the status (SC-009)', () => {
    const { store } = makeFakeStore(connectedTokens)
    const { manager } = makeManager({ store })
    expect(JSON.stringify(manager.getStatus())).not.toContain('at-1')
  })

  it('passes a rate_limited read result through unchanged (graceful degrade)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listEvents: vi.fn(
        async (): Promise<GoogleCalendarResult<unknown>> => ({
          ok: false,
          kind: 'rate_limited',
          message: 'busy',
          retryAfterSeconds: 30
        })
      ) as unknown as GoogleCalendarClient['listEvents']
    })
    const { manager } = makeManager({ store, client })
    const result = await manager.listEvents(window)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBe(30)
    }
    // A rate_limit must NOT flip connection state.
    expect(manager.getStatus().state).toBe('connected')
  })
})

/* shared-calendars-v1 — calendar ordering/capping (FR-013) + the bounded multi-calendar
 * fan-out with partial-failure degrade (FR-004/FR-012). */

const cal = (over: Partial<GoogleCalendar>): GoogleCalendar => ({
  id: over.id ?? 'c@x',
  summary: over.summary ?? 'C',
  ...over
})

describe('orderAndCapCalendars (FR-013 — primary → selected → rest, capped, stable)', () => {
  it('orders primary first, then selected, then the rest (stable within a tier)', () => {
    const ordered = orderAndCapCalendars(
      [
        cal({ id: 'rest1', selected: false }),
        cal({ id: 'sel1', selected: true }),
        cal({ id: 'me', primary: true }),
        cal({ id: 'sel2' }), // selected absent ⇒ treated as shown (tier 1)
        cal({ id: 'rest2', selected: false })
      ],
      10
    )
    expect(ordered.map((c) => c.id)).toEqual(['me', 'sel1', 'sel2', 'rest1', 'rest2'])
  })

  it('caps at max AFTER ordering (the most relevant calendars win)', () => {
    const big = Array.from({ length: 30 }, (_, i) => cal({ id: `c${i}` }))
    big.unshift(cal({ id: 'primary', primary: true }))
    const ordered = orderAndCapCalendars(big, 25)
    expect(ordered).toHaveLength(25)
    expect(ordered[0].id).toBe('primary')
  })

  it('degrades a non-array to empty (never throws)', () => {
    expect(orderAndCapCalendars(undefined as unknown as GoogleCalendar[], 25)).toEqual([])
  })
})

describe('GoogleCalendarManager.listAggregatedEvents (FR-004/FR-012 — fan-out + degrade)', () => {
  const calendars: GoogleCalendar[] = [
    cal({ id: 'me@x', primary: true }),
    cal({ id: 'team@x', selected: true }),
    cal({ id: 'holidays@x', selected: false })
  ]

  function eventsFor(id: string): GoogleCalendarResult<unknown> {
    return { ok: true, data: { items: [{ id: `${id}-e1`, summary: 'E', start: '2026-06-17', end: '2026-06-18', allDay: true }] } }
  }

  it('reads the list, fans out per-calendar, and TAGS each event with its calendarId', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listCalendars: vi.fn(async (): Promise<GoogleCalendarResult<GoogleCalendar[]>> => ({ ok: true, data: calendars })),
      listEvents: vi.fn(async (_auth, _min, _max, _cursor, calendarId?: string) => eventsFor(calendarId ?? 'primary')) as unknown as GoogleCalendarClient['listEvents']
    })
    const { manager } = makeManager({ store, client })

    const result = await manager.listAggregatedEvents(window)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.calendars.map((c) => c.id)).toEqual(['me@x', 'team@x', 'holidays@x'])
      expect(result.data.events).toHaveLength(3)
      // every event carries its owning calendarId
      const owners = result.data.events.map((e) => e.calendarId).sort()
      expect(owners).toEqual(['holidays@x', 'me@x', 'team@x'])
      expect(result.data.anyCalendarFailed).toBe(false)
    }
  })

  it('DEGRADES when one calendar read fails: keeps the others + flags anyCalendarFailed (FR-012)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listCalendars: vi.fn(async (): Promise<GoogleCalendarResult<GoogleCalendar[]>> => ({ ok: true, data: calendars })),
      listEvents: vi.fn(async (_auth, _min, _max, _cursor, calendarId?: string): Promise<GoogleCalendarResult<unknown>> => {
        if (calendarId === 'team@x') {
          return { ok: false, kind: 'network', message: 'flaky' }
        }
        return eventsFor(calendarId ?? 'primary')
      }) as unknown as GoogleCalendarClient['listEvents']
    })
    const { manager } = makeManager({ store, client })

    const result = await manager.listAggregatedEvents(window)

    expect(result.ok).toBe(true)
    if (result.ok) {
      // the failed calendar's legend entry STAYS; only its events are missing
      expect(result.data.calendars.map((c) => c.id)).toContain('team@x')
      expect(result.data.events.map((e) => e.calendarId).sort()).toEqual(['holidays@x', 'me@x'])
      expect(result.data.anyCalendarFailed).toBe(true)
    }
  })

  it('surfaces the structured error when the calendar LIST read itself fails', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listCalendars: vi.fn(async (): Promise<GoogleCalendarResult<GoogleCalendar[]>> => ({
        ok: false,
        kind: 'reconnect_needed',
        message: 'expired'
      })),
      listEvents: vi.fn() as unknown as GoogleCalendarClient['listEvents']
    })
    const { manager } = makeManager({ store, client })

    const result = await manager.listAggregatedEvents(window)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(client.listEvents).not.toHaveBeenCalled()
  })

  it('returns an empty merged view when there are no accessible calendars (empty grid)', async () => {
    const { store } = makeFakeStore(connectedTokens)
    const client = makeClient({
      listCalendars: vi.fn(async (): Promise<GoogleCalendarResult<GoogleCalendar[]>> => ({ ok: true, data: [] }))
    })
    const { manager } = makeManager({ store, client })

    const result = await manager.listAggregatedEvents(window)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.calendars).toEqual([])
      expect(result.data.events).toEqual([])
      expect(result.data.anyCalendarFailed).toBe(false)
    }
  })
})
