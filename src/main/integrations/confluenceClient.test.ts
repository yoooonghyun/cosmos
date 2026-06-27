import { describe, it, expect } from 'vitest'
import {
  ConfluenceClient,
  confluenceUserName,
  cursorFromNextLink,
  mapConfluenceError,
  pageViewBody,
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

// siteUrl is the persisted OAuth accessible-resources origin (bare, NO /wiki) — the source
// getPage uses to assemble the user-facing page web URL (confluence-link-404-v1 #100).
const auth = { token: 'at-test', cloudId: 'cloud-1', siteUrl: 'https://acme.atlassian.net' }

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

  it('decodes literal \\uXXXX emoji escapes in list title/space/excerpt (re-open)', async () => {
    // Confluence serializes some emoji as literal escape text even in plain fields; the
    // LIST screen must show real glyphs, not "👥".
    const fetchImpl: FetchLike = async () =>
      res({
        results: [
          {
            title: '\\uD83D\\uDC65 Team page',
            excerpt: '\\uD83E\\uDD45 Goals',
            content: { id: '333', title: '\\uD83D\\uDC65 Team page' },
            resultGlobalContainer: { title: '\\uD83C\\uDFA8 Design' }
          }
        ],
        _links: {}
      })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.searchContent(auth, 'team')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([
        {
          id: '333',
          title: '\u{1F465} Team page',
          space: '\u{1F3A8} Design',
          excerpt: '\u{1F945} Goals'
        }
      ])
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

describe('ConfluenceClient.getPage (FR-C04; confluence-detail-rich-render-v1 FR-005/FR-006)', () => {
  it('reads v2 page detail with body-format=view and returns the RAW view HTML unchanged', async () => {
    const viewHtml = '<h1>Runbook</h1><ul><li>Step one</li><li>Step two</li></ul>'
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toContain('/wiki/api/v2/pages/12345')
      // FR-005: the rich view body, NOT storage (no longer flattened to plain text).
      expect(url).toContain('body-format=view')
      expect(url).not.toContain('body-format=storage')
      return res({
        id: '12345',
        title: 'Runbook',
        spaceId: 777,
        body: { view: { value: viewHtml } }
      })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '12345')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe('12345')
      expect(result.data.title).toBe('Runbook')
      expect(result.data.space).toBe('777')
      // FR-006: raw server-rendered HTML carried unchanged (sanitized later in renderer).
      expect(result.data.body).toBe(viewHtml)
    }
  })

  it('enriches webUrl from auth.siteUrl + the REAL v2 _links.webui (NO base) — #87/#100', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        id: '12345',
        title: 'Runbook',
        body: { view: { value: '<p>x</p>' } },
        // REAL v2 GET /wiki/api/v2/pages/{id} `_links` = AbstractPageLinks: webui/editui/tinyui,
        // NO `base` (that's a LIST-response field). The host comes from auth.siteUrl, not _links.
        _links: {
          webui: '/spaces/ENG/pages/12345/Runbook',
          editui: '/pages/resumedraft.action?draftId=12345',
          tinyui: '/x/AbCdEf'
        }
      })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '12345')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Corrected, resolvable URL: site origin + /wiki + webui (exactly one /wiki).
      expect(result.data.webUrl).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Runbook')
      // #100 regression: NOT the old /wiki-less 404 URL, NOR a doubled /wiki.
      expect(result.data.webUrl).not.toBe('https://acme.atlassian.net/spaces/ENG/pages/12345/Runbook')
      expect(result.data.webUrl).not.toBe(
        'https://acme.atlassian.net/wiki/wiki/spaces/ENG/pages/12345/Runbook'
      )
    }
  })

  it('OMITS the webUrl key when _links are absent (degrade-to-omit — #87 FR-004/FR-008)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: '1', title: 't', body: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // missing optional must not error and must not surface an undefined key.
      expect('webUrl' in result.data).toBe(false)
    }
  })

  it('OMITS webUrl when auth.siteUrl is absent (legacy token set — #100 degrade-to-omit)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        id: '1',
        title: 't',
        body: {},
        _links: { webui: '/spaces/ENG/pages/1/T' }
      })
    const client = new ConfluenceClient({ fetchImpl })
    // No siteUrl (a token set persisted before siteUrl was threaded) → no browsable host.
    const result = await client.getPage({ token: 'at-test', cloudId: 'cloud-1' }, '1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect('webUrl' in result.data).toBe(false)
    }
  })

  it('maps an empty / missing view body to "" (safe empty-body state — FR-012)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: '1', title: 't', body: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.body).toBe('')
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: '1', title: 't', body: {} })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getPage(auth, '1')
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})

describe('pageViewBody (pure body-format=view mapper — FR-005/FR-006/FR-012)', () => {
  it('returns the raw view HTML string from body.view.value (happy path)', () => {
    const html = '<table><tbody><tr><td>cell</td></tr></tbody></table>'
    expect(pageViewBody({ body: { view: { value: html } } })).toBe(html)
  })

  it('returns "" when view.value is missing (empty body)', () => {
    expect(pageViewBody({ body: { view: {} } })).toBe('')
    expect(pageViewBody({ body: {} })).toBe('')
    expect(pageViewBody({})).toBe('')
  })

  it('returns "" for a non-string view.value or non-object input (never throws)', () => {
    expect(pageViewBody({ body: { view: { value: 42 } } })).toBe('')
    expect(pageViewBody(null)).toBe('')
    expect(pageViewBody('nope')).toBe('')
    expect(pageViewBody(undefined)).toBe('')
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

describe('ConfluenceClient.updatePage (confluence-mcp-write-v1, FR-009/FR-009a/FR-009b)', () => {
  interface Captured {
    url: string
    method?: string
    body?: string
  }

  it('reads the current version+storage then PUTs version+1 with the NEW storage body (body replace)', async () => {
    const calls: Captured[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body })
      // First call: the read-for-update (storage body + version).
      if (init?.method === undefined || init?.method === 'GET') {
        return res({
          id: '12345',
          title: 'Old Title',
          version: { number: 3 },
          body: { storage: { value: '<p>old body</p>' } }
        })
      }
      // Second call: the PUT.
      return res({ id: '12345', title: 'New Title', version: { number: 4 } })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, {
      pageId: '12345',
      title: 'New Title',
      body: 'line one\nline two',
      versionMessage: 'reworked'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: '12345', title: 'New Title', version: 4 })
    }
    // The read requests the STORAGE body + version (NOT body-format=view).
    expect(calls[0].url).toContain('/wiki/api/v2/pages/12345')
    expect(calls[0].url).toContain('body-format=storage')
    expect(calls[0].url).toContain('version=true')
    expect(calls[0].url).not.toContain('body-format=view')
    // The PUT targets the page and carries version current+1 + the new storage body.
    expect(calls[1].method).toBe('PUT')
    expect(calls[1].url).toContain('/wiki/api/v2/pages/12345')
    const payload = JSON.parse(calls[1].body ?? '{}')
    expect(payload.id).toBe('12345')
    expect(payload.status).toBe('current')
    expect(payload.title).toBe('New Title')
    expect(payload.body).toEqual({
      representation: 'storage',
      value: '<p>line one</p><p>line two</p>'
    })
    expect(payload.version).toEqual({ number: 4, message: 'reworked' })
  })

  it('preserves the existing storage body on a title-only update (no body)', async () => {
    let putBody = ''
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        putBody = init.body ?? ''
        return res({ id: '12345', title: 'Renamed', version: { number: 8 } })
      }
      return res({
        id: '12345',
        title: 'Old',
        version: { number: 7 },
        body: { storage: { value: '<p>keep me</p>' } }
      })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '12345', title: 'Renamed' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe(8)
    }
    const payload = JSON.parse(putBody)
    // The existing storage body is re-sent UNCHANGED — never wiped.
    expect(payload.body).toEqual({ representation: 'storage', value: '<p>keep me</p>' })
    expect(payload.version.number).toBe(8)
    // No versionMessage supplied → no message key.
    expect(payload.version.message).toBeUndefined()
  })

  it('treats an empty/whitespace body as absent (preserve existing — §C3, no wipe)', async () => {
    let putBody = ''
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        putBody = init.body ?? ''
        return res({ id: '1', title: 'T', version: { number: 2 } })
      }
      return res({
        id: '1',
        title: 'T',
        version: { number: 1 },
        body: { storage: { value: '<p>do not wipe</p>' } }
      })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: '   ' })
    expect(result.ok).toBe(true)
    expect(JSON.parse(putBody).body.value).toBe('<p>do not wipe</p>')
  })

  it('maps a 409 on the PUT to version_conflict (FR-009b — re-read and retry)', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        return res({ errors: [{ title: 'Version mismatch' }] }, 409)
      }
      return res({ id: '1', title: 'T', version: { number: 1 }, body: { storage: { value: '<p>x</p>' } } })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: 'new' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('version_conflict')
    }
  })

  it('maps a 400 whose body indicates a version mismatch to version_conflict', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        return res({ message: 'The version number does not match the latest version' }, 400)
      }
      return res({ id: '1', title: 'T', version: { number: 1 }, body: { storage: { value: '<p>x</p>' } } })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: 'new' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('version_conflict')
    }
  })

  it('maps a non-version 400 on the PUT to a recoverable network error', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        return res({ message: 'title is required' }, 400)
      }
      return res({ id: '1', title: 'T', version: { number: 1 }, body: { storage: { value: '<p>x</p>' } } })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: 'new' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('maps a 403 on the read-for-update to reconnect_needed (unknown/inaccessible page)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 403)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: 'nope', title: 'T' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('maps a 404 on the read-for-update to a recoverable network error (no crash)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 404)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: 'gone', title: 'T' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('maps a 429 on the PUT to rate_limited and honors Retry-After', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'PUT') {
        return res({}, 429, '9')
      }
      return res({ id: '1', title: 'T', version: { number: 1 }, body: { storage: { value: '<p>x</p>' } } })
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: 'new' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBe(9)
    }
  })

  it('returns network when the read returns no version number (defensive)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: '1', title: 'T', body: { storage: { value: '<p>x</p>' } } })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async (_url, init) =>
      init?.method === 'PUT'
        ? res({ id: '1', title: 'T', version: { number: 2 } })
        : res({ id: '1', title: 'T', version: { number: 1 }, body: { storage: { value: '<p>x</p>' } } })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.updatePage(auth, { pageId: '1', title: 'T', body: 'new' })
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})

describe('ConfluenceClient.createComment (confluence-mcp-write-v1, comment FR)', () => {
  it('POSTs /footer-comments with the pageId + storage body and returns the comment id', async () => {
    let captured: { url: string; method?: string; body?: string } = { url: '' }
    const fetchImpl: FetchLike = async (url, init) => {
      captured = { url, method: init?.method, body: init?.body }
      return res({ id: 'c-99', pageId: '12345' }, 201)
    }
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createComment(auth, { pageId: '12345', body: 'first\nsecond' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: 'c-99', pageId: '12345' })
    }
    expect(captured.url).toContain('/wiki/api/v2/footer-comments')
    expect(captured.method).toBe('POST')
    const payload = JSON.parse(captured.body ?? '{}')
    expect(payload.pageId).toBe('12345')
    expect(payload.body).toEqual({
      representation: 'storage',
      value: '<p>first</p><p>second</p>'
    })
  })

  it('maps a 403 to reconnect_needed and a 404 to network (no crash)', async () => {
    const c403 = new ConfluenceClient({ fetchImpl: async () => res({}, 403) })
    const r403 = await c403.createComment(auth, { pageId: '1', body: 'x' })
    expect(r403.ok).toBe(false)
    if (!r403.ok) {
      expect(r403.kind).toBe('reconnect_needed')
    }
    const c404 = new ConfluenceClient({ fetchImpl: async () => res({}, 404) })
    const r404 = await c404.createComment(auth, { pageId: 'gone', body: 'x' })
    expect(r404.ok).toBe(false)
    if (!r404.ok) {
      expect(r404.kind).toBe('network')
    }
  })

  it('returns network when Confluence returns no comment id', async () => {
    const fetchImpl: FetchLike = async () => res({ pageId: '1' }, 201)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createComment(auth, { pageId: '1', body: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async () => res({ id: 'c1', pageId: '1' }, 201)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.createComment(auth, { pageId: '1', body: 'x' })
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})

describe('ConfluenceClient.getComments (confluence-dock-comments-v1, FR-003)', () => {
  // A top-level footer comment, v2 shape (authorId + version.createdAt + body.storage.value).
  // The list endpoints (/pages/{id}/footer-comments and /footer-comments/{id}/children) only
  // support body-format=storage — `view` is not in their response schema and returns HTTP 400.
  const topComment = (id: string, value: string) => ({
    id,
    version: { authorId: `acct-${id}`, createdAt: '2026-06-27T10:00:00.000Z' },
    body: { storage: { value } }
  })

  /**
   * Route fetch: the user-resolution URL, the top-level footer-comments URL, and each comment's
   * /children URL. `user(accountId)` defaults to a 200 with NO name fields (→ name resolves to
   * undefined → renderer falls back to the raw id), so a test only overrides it to exercise
   * name resolution.
   */
  function routedFetch(map: {
    top: unknown
    topStatus?: number
    children: (commentId: string) => { body: unknown; status?: number }
    user?: (accountId: string) => { body: unknown; status?: number }
  }): { fetchImpl: FetchLike; urls: string[] } {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url)
      const userMatch = url.match(/\/wiki\/rest\/api\/user\?/)
      if (userMatch) {
        const accountId = new URL(url).searchParams.get('accountId') ?? ''
        const u = map.user ? map.user(accountId) : { body: {} }
        return res(u.body, u.status ?? 200)
      }
      const childMatch = url.match(/footer-comments\/([^/]+)\/children/)
      if (childMatch) {
        const c = map.children(decodeURIComponent(childMatch[1]))
        return res(c.body, c.status ?? 200)
      }
      return res(map.top, map.topStatus ?? 200)
    }
    return { fetchImpl, urls }
  }

  it('shapes top-level comments each with their one-level replies', async () => {
    const { fetchImpl, urls } = routedFetch({
      top: {
        results: [topComment('1', '<p>top one</p>'), topComment('2', '<p>top two</p>')],
        _links: { next: '/wiki/api/v2/pages/777/footer-comments?cursor=NXT' }
      },
      children: (id) =>
        id === '1'
          ? { body: { results: [topComment('1a', '<p>reply to one</p>')] } }
          : { body: { results: [] } }
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.comments).toHaveLength(2)
      const [c1, c2] = result.data.comments
      expect(c1.id).toBe('1')
      expect(c1.author.accountId).toBe('acct-1')
      expect(c1.created).toBe('2026-06-27T10:00:00.000Z')
      expect(c1.body).toBe('<p>top one</p>')
      expect(c1.replies).toHaveLength(1)
      expect(c1.replies[0]).toMatchObject({ id: '1a', body: '<p>reply to one</p>', replies: [] })
      expect(c2.replies).toHaveLength(0)
      expect(result.data.nextCursor).toBe('NXT')
    }
    // The top-level page URL hits the footer-comments collection with body-format=storage.
    expect(urls[0]).toContain('/wiki/api/v2/pages/777/footer-comments')
    expect(urls[0]).toContain('body-format=storage')
  })

  it('degrades a FAILED children read to no replies (best-effort), not a whole-read failure', async () => {
    const { fetchImpl } = routedFetch({
      top: { results: [topComment('1', '<p>top</p>')], _links: {} },
      // The children read 500s — the comment must still render with replies: [].
      children: () => ({ body: { message: 'boom' }, status: 500 })
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.comments).toHaveLength(1)
      expect(result.data.comments[0].replies).toEqual([])
    }
  })

  it('falls back gracefully when an author/timestamp are absent (degrade-never-throw)', async () => {
    const { fetchImpl } = routedFetch({
      top: { results: [{ id: '9', body: { storage: { value: '<p>hi</p>' } } }], _links: {} },
      children: () => ({ body: { results: [] } })
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const c = result.data.comments[0]
      expect(c.author).toEqual({}) // no accountId/displayName — renderer falls back to 'Unknown'
      expect(c.created).toBeUndefined()
      expect(c.body).toBe('<p>hi</p>')
    }
  })

  it('maps a top-level 403 to reconnect_needed via mapConfluenceError', async () => {
    const fetchImpl: FetchLike = async () => res({ message: 'no' }, 403)
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('maps a top-level 429 to rate_limited (honoring Retry-After)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 429, '7')
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBe(7)
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const { fetchImpl } = routedFetch({
      top: { results: [topComment('1', '<p>x</p>')], _links: {} },
      children: () => ({ body: { results: [] } })
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(JSON.stringify(result)).not.toContain('at-test')
  })

  it('resolves each author accountId to a display name on tops AND replies (author-name-v1)', async () => {
    const { fetchImpl, urls } = routedFetch({
      top: { results: [topComment('1', '<p>top</p>')], _links: {} },
      children: () => ({ body: { results: [topComment('1a', '<p>reply</p>')] } }),
      // The user endpoint returns the registered display name keyed by accountId.
      user: (accountId) =>
        accountId === 'acct-1'
          ? { body: { accountId, displayName: 'Ada Lovelace', publicName: 'ada' } }
          : { body: { accountId, displayName: 'Grace Hopper' } }
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const c1 = result.data.comments[0]
      // Top-level author resolved to the display NAME (id kept alongside).
      expect(c1.author.displayName).toBe('Ada Lovelace')
      expect(c1.author.accountId).toBe('acct-1')
      // The reply author is resolved too.
      expect(c1.replies[0].author.displayName).toBe('Grace Hopper')
      expect(c1.replies[0].author.accountId).toBe('acct-1a')
    }
    // The user endpoint was hit for resolution.
    expect(urls.some((u) => u.includes('/wiki/rest/api/user?'))).toBe(true)
  })

  it('fetches each UNIQUE author once (per-request cache), not once per comment', async () => {
    let userCalls = 0
    const { fetchImpl } = routedFetch({
      // Two top-level comments by the SAME author (acct-1 via topComment id reuse below).
      top: {
        results: [
          { id: 'a', version: { authorId: 'acct-same' }, body: { storage: { value: '<p>1</p>' } } },
          { id: 'b', version: { authorId: 'acct-same' }, body: { storage: { value: '<p>2</p>' } } }
        ],
        _links: {}
      },
      children: () => ({ body: { results: [] } }),
      user: (accountId) => {
        userCalls += 1
        return { body: { accountId, displayName: 'Solo Author' } }
      }
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.comments[0].author.displayName).toBe('Solo Author')
      expect(result.data.comments[1].author.displayName).toBe('Solo Author')
    }
    // Same accountId across both comments → exactly ONE user fetch.
    expect(userCalls).toBe(1)
  })

  it('falls back to the raw account id when name resolution fails (degrade-never-throw)', async () => {
    const { fetchImpl } = routedFetch({
      top: { results: [topComment('1', '<p>top</p>')], _links: {} },
      children: () => ({ body: { results: [] } }),
      // The user endpoint 500s → no displayName; the renderer falls back to accountId.
      user: () => ({ body: { message: 'boom' }, status: 500 })
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '777' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const c1 = result.data.comments[0]
      expect(c1.author.displayName).toBeUndefined()
      expect(c1.author.accountId).toBe('acct-1')
    }
  })
})

describe('confluenceUserName (pure user-name extractor — author-name-v1)', () => {
  it('returns displayName when present', () => {
    expect(confluenceUserName({ displayName: 'Ada Lovelace', publicName: 'ada' })).toBe(
      'Ada Lovelace'
    )
  })
  it('falls back to publicName when displayName is absent/empty', () => {
    expect(confluenceUserName({ publicName: 'grace' })).toBe('grace')
    expect(confluenceUserName({ displayName: '', publicName: 'grace' })).toBe('grace')
  })
  it('returns undefined when neither name is a non-empty string (never throws)', () => {
    expect(confluenceUserName({})).toBeUndefined()
    expect(confluenceUserName({ displayName: 42 })).toBeUndefined()
    expect(confluenceUserName(null)).toBeUndefined()
    expect(confluenceUserName('nope')).toBeUndefined()
    expect(confluenceUserName(undefined)).toBeUndefined()
  })
  it('never reads a secret/email field', () => {
    expect(confluenceUserName({ email: 'a@b.com' })).toBeUndefined()
  })
})
