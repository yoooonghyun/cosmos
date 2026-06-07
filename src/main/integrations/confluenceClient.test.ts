import { describe, it, expect } from 'vitest'
import {
  ConfluenceClient,
  cursorFromNextLink,
  mapConfluenceError,
  type ConfluenceHttpResponse,
  type FetchLike
} from './confluenceClient'

describe('mapConfluenceError (FR-X07, SC-007, SC-010)', () => {
  it('maps 429 to rate_limited and honors Retry-After', () => {
    const e = mapConfluenceError(429, 12)
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAfterSeconds).toBe(12)
  })
  it('maps 401 / 403 to reconnect_needed', () => {
    expect(mapConfluenceError(401).kind).toBe('reconnect_needed')
    expect(mapConfluenceError(403).kind).toBe('reconnect_needed')
  })
  it('maps other errors to network', () => {
    expect(mapConfluenceError(503).kind).toBe('network')
  })
})

describe('cursorFromNextLink', () => {
  it('extracts the cursor query param from a relative next link', () => {
    expect(cursorFromNextLink('/wiki/rest/api/search?cql=x&cursor=ABC123')).toBe('ABC123')
  })
  it('returns undefined when there is no next link or no cursor', () => {
    expect(cursorFromNextLink(undefined)).toBeUndefined()
    expect(cursorFromNextLink('/wiki/rest/api/search?cql=x')).toBeUndefined()
  })
})

function res(body: unknown, status = 200, retryAfter?: string): ConfluenceHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    json: async () => body
  }
}

const auth = { token: 'at-test', cloudId: 'cloud-1' }

describe('ConfluenceClient.searchContent (FR-C04)', () => {
  it('maps hits to plain-text results and exposes the next-link cursor', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({
        results: [
          {
            title: 'On@@@hl@@@board@@@endhl@@@ing',
            excerpt: 'A short @@@hl@@@excerpt@@@endhl@@@ here',
            content: { id: '111', title: 'Onboarding' },
            resultGlobalContainer: { title: 'Engineering' }
          }
        ],
        _links: { next: '/wiki/rest/api/search?cql=x&cursor=NEXT9' }
      })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.searchContent(auth, 'onboarding')
    expect(capturedUrl).toContain('/wiki/rest/api/search')
    expect(capturedUrl).toContain('cql=')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([
        { id: '111', title: 'Onboarding', space: 'Engineering', excerpt: 'A short excerpt here' }
      ])
      expect(result.data.nextCursor).toBe('NEXT9')
    }
  })

  it('omits the cursor when there is no next link', async () => {
    const fetchImpl: FetchLike = async () => res({ results: [], _links: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.searchContent(auth, 'x')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nextCursor).toBeUndefined()
    }
  })

  it('returns reconnect_needed on a 403', async () => {
    const fetchImpl: FetchLike = async () => res({}, 403)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.searchContent(auth, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })
})

describe('ConfluenceClient.defaultFeed (confluence-default-feed v1, FR-006)', () => {
  const FEED_CQL =
    '(mention = currentUser() or watcher = currentUser() or favourite = currentUser())' +
    ' and type = page order by lastmodified desc'

  it('builds the exact personal CQL (URL-encoded) and GETs the v1 search endpoint', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ results: [], _links: {} })
    }
    const client = new ConfluenceClient({ fetchImpl })
    await client.defaultFeed(auth)
    expect(capturedUrl).toContain('/wiki/rest/api/search')
    expect(capturedUrl).toContain('cql=')
    expect(capturedUrl).toContain('limit=25')
    // URL-encoded, not hand-concatenated: a literal '(' would be unencoded.
    expect(capturedUrl).toContain('cql=%28')
    expect(capturedUrl).not.toContain('cql=(')
    // The cql param decodes (via URLSearchParams, which also turns '+' back into a
    // space) to the exact fixed personal CQL.
    const cql = new URL(capturedUrl).searchParams.get('cql')
    expect(cql).toBe(FEED_CQL)
  })

  it('maps hits to plain-text results and exposes the next-link cursor', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        results: [
          {
            title: 'My @@@hl@@@watched@@@endhl@@@ page',
            excerpt: 'A short @@@hl@@@excerpt@@@endhl@@@ here',
            content: { id: '222', title: 'My watched page' },
            resultGlobalContainer: { title: 'Engineering' }
          }
        ],
        _links: { next: '/wiki/rest/api/search?cql=x&cursor=FEED9' }
      })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.defaultFeed(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([
        { id: '222', title: 'My watched page', space: 'Engineering', excerpt: 'A short excerpt here' }
      ])
      expect(result.data.nextCursor).toBe('FEED9')
    }
  })

  it('passes the cursor through to searchParams on a subsequent page', async () => {
    let capturedUrl = ''
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url
      return res({ results: [], _links: {} })
    }
    const client = new ConfluenceClient({ fetchImpl })
    await client.defaultFeed(auth, 'CUR42')
    expect(new URL(capturedUrl).searchParams.get('cursor')).toBe('CUR42')
  })

  it('omits the cursor when there is no next link', async () => {
    const fetchImpl: FetchLike = async () => res({ results: [], _links: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.defaultFeed(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nextCursor).toBeUndefined()
    }
  })

  it('returns reconnect_needed on a 403 and rate_limited on a 429', async () => {
    const c403 = new ConfluenceClient({ fetchImpl: async () => res({}, 403) })
    const r403 = await c403.defaultFeed(auth)
    expect(r403.ok).toBe(false)
    if (!r403.ok) {
      expect(r403.kind).toBe('reconnect_needed')
    }
    const c429 = new ConfluenceClient({ fetchImpl: async () => res({}, 429, '7') })
    const r429 = await c429.defaultFeed(auth)
    expect(r429.ok).toBe(false)
    if (!r429.ok) {
      expect(r429.kind).toBe('rate_limited')
      expect(r429.retryAfterSeconds).toBe(7)
    }
  })
})

describe('ConfluenceClient.getPage (FR-C04)', () => {
  it('reads v2 page detail and flattens the storage body to text', async () => {
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toContain('/wiki/api/v2/pages/12345')
      expect(url).toContain('body-format=storage')
      return res({
        id: '12345',
        title: 'Runbook',
        spaceId: 777,
        body: { storage: { value: '<p>Step one.</p><p>Step two.</p>' } }
      })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '12345')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe('12345')
      expect(result.data.title).toBe('Runbook')
      expect(result.data.space).toBe('777')
      expect(result.data.body).toBe('Step one.\nStep two.')
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: '1', title: 't', body: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '1')
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})

describe('ConfluenceClient.createPage', () => {
  interface Captured {
    url: string
    method?: string
    body?: string
  }

  it('resolves the space key to an id then POSTs the storage body (happy path)', async () => {
    const calls: Captured[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      if (url.includes('/wiki/api/v2/spaces')) {
        return res({ results: [{ id: '900', key: 'ENG' }] })
      }
      return res({ id: '12345', title: 'Meeting Notes' }, 201)
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createPage(auth, {
      spaceKey: 'ENG',
      title: 'Meeting Notes',
      body: 'line one\nline two'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: '12345', title: 'Meeting Notes' })
    }
    // First call resolves the key; second creates the page.
    expect(calls[0].url).toContain('/wiki/api/v2/spaces')
    expect(calls[0].url).toContain('keys=ENG')
    expect(calls[1].url).toContain('/wiki/api/v2/pages')
    expect(calls[1].method).toBe('POST')
    const payload = JSON.parse(calls[1].body ?? '{}')
    expect(payload.spaceId).toBe('900')
    expect(payload.status).toBe('current')
    expect(payload.title).toBe('Meeting Notes')
    expect(payload.body).toEqual({
      representation: 'storage',
      value: '<p>line one</p><p>line two</p>'
    })
    expect(payload.parentId).toBeUndefined()
  })

  it('includes parentId when provided', async () => {
    let createBody = ''
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/wiki/api/v2/spaces')) {
        return res({ results: [{ id: '900' }] })
      }
      createBody = init?.body ?? ''
      return res({ id: '999', title: 'Child' }, 201)
    }
    const client = new ConfluenceClient({ fetchImpl })
    await client.createPage(auth, { spaceKey: 'ENG', title: 'Child', body: 'x', parentId: '555' })
    expect(JSON.parse(createBody).parentId).toBe('555')
  })

  it('returns a network error when the space key resolves to nothing', async () => {
    const fetchImpl: FetchLike = async () => res({ results: [] })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createPage(auth, { spaceKey: 'NOPE', title: 'T', body: 'b' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
      expect(result.message).toContain('NOPE')
    }
  })

  it('maps a 403 on the space lookup to reconnect_needed', async () => {
    const fetchImpl: FetchLike = async () => res({}, 403)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createPage(auth, { spaceKey: 'ENG', title: 'T', body: 'b' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('maps a 400 on the create to a recoverable network error', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.includes('/wiki/api/v2/spaces') ? res({ results: [{ id: '900' }] }) : res({}, 400)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createPage(auth, { spaceKey: 'ENG', title: 'T', body: 'b' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.includes('/wiki/api/v2/spaces')
        ? res({ results: [{ id: '900' }] })
        : res({ id: '1', title: 't' }, 201)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createPage(auth, { spaceKey: 'ENG', title: 't', body: 'b' })
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})
