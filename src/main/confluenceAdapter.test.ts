import { describe, it, expect, vi } from 'vitest'
import {
  confluenceAdapterResolver,
  confluenceBindOptionsForSource,
  confluenceFeedBindOptions,
  confluencePageBindOptions,
  confluenceResultRow,
  confluenceSearchBindOptions,
  CONFLUENCE_FEED_PATH,
  CONFLUENCE_PAGE_PATH,
  CONFLUENCE_RESULTS_PATH,
  type ConfluenceAdapterManager
} from './confluenceAdapter'
import { ConfluenceAdapterSource } from '../shared/types/confluence'
import type {
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult
} from '../shared/types/confluence'

/* confluence-generative-adapter-v1 — the Confluence-specific resolver + bind options
 * (FR-005..FR-008). Maps a secret-free descriptor to a ConfluenceManager READ (token +
 * cloudId in main) and normalizes the page/detail into the panel-agnostic
 * AdapterFetchResult. Pattern per FR: happy path; missing optional (no nextCursor →
 * no hasMore); recoverable failure (safe ok:false, never throws); secret-free; feed
 * descriptor carries NO CQL; detail `value` shape. APPEND-ONLY: no prevCursor; NO name
 * resolution (no getUser). */

const HIT: ConfluenceSearchResult = { id: 'P1', title: 'Page One', space: 'ENG', excerpt: 'hello' }
const DETAIL: ConfluencePageDetail = { id: 'P1', title: 'Page One', space: 'ENG', body: 'the body' }

function manager(over: Partial<ConfluenceAdapterManager> = {}): ConfluenceAdapterManager {
  return {
    defaultFeed: vi.fn(
      async (
        _p: ConfluenceDefaultFeedParams
      ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
        ok: true,
        data: { items: [HIT] }
      })
    ),
    searchContent: vi.fn(
      async (
        _p: ConfluenceSearchParams
      ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
        ok: true,
        data: { items: [HIT] }
      })
    ),
    getPage: vi.fn(
      async (_p: ConfluenceGetPageParams): Promise<ConfluenceResult<ConfluencePageDetail>> => ({
        ok: true,
        data: DETAIL
      })
    ),
    ...over
  }
}

describe('confluenceResultRow (non-secret bound-row shape)', () => {
  it('maps id/title/space/excerpt', () => {
    expect(confluenceResultRow(HIT)).toEqual({
      id: 'P1',
      title: 'Page One',
      space: 'ENG',
      excerpt: 'hello'
    })
  })

  it('omits absent space (missing optional → no error)', () => {
    expect(confluenceResultRow({ id: 'P2', title: 'T', excerpt: '' })).toEqual({
      id: 'P2',
      title: 'T',
      excerpt: ''
    })
  })
})

describe('bind options (append lists + none detail — FR-010/FR-011)', () => {
  it('each list binds its path with pagination:append; detail is none', () => {
    expect(confluenceFeedBindOptions).toEqual({ listPath: CONFLUENCE_FEED_PATH, pagination: 'append' })
    expect(confluenceSearchBindOptions).toEqual({
      listPath: CONFLUENCE_RESULTS_PATH,
      pagination: 'append'
    })
    expect(confluencePageBindOptions).toEqual({ listPath: CONFLUENCE_PAGE_PATH, pagination: 'none' })
  })

  it('confluenceBindOptionsForSource resolves each source; null for a non-Confluence source (FR-015)', () => {
    expect(confluenceBindOptionsForSource(ConfluenceAdapterSource.DefaultFeed)).toBe(
      confluenceFeedBindOptions
    )
    expect(confluenceBindOptionsForSource(ConfluenceAdapterSource.SearchContent)).toBe(
      confluenceSearchBindOptions
    )
    expect(confluenceBindOptionsForSource(ConfluenceAdapterSource.GetPage)).toBe(
      confluencePageBindOptions
    )
    expect(confluenceBindOptionsForSource('createPage')).toBeNull()
    expect(confluenceBindOptionsForSource('bogus')).toBeNull()
  })
})

describe('confluenceAdapterResolver — defaultFeed (FR-006/FR-007)', () => {
  it('maps a feed descriptor to items + nextCursor (happy path)', async () => {
    const m = manager({
      defaultFeed: vi.fn(
        async (): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
          ok: true,
          data: { items: [HIT], nextCursor: 'c2' }
        })
      )
    })
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.DefaultFeed,
      query: { cursor: 'c1' }
    })
    expect(out).toEqual({ ok: true, items: [confluenceResultRow(HIT)], nextCursor: 'c2' })
    expect(m.defaultFeed).toHaveBeenCalledWith({ cursor: 'c1' })
  })

  it('passes ONLY the cursor — never a CQL/feed-mode string (FR-007)', async () => {
    const m = manager()
    await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.DefaultFeed,
      query: { cursor: 'c1' }
    })
    const passed = (m.defaultFeed as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(Object.keys(passed)).toEqual(['cursor'])
    expect(JSON.stringify(passed)).not.toMatch(/cql|mention|watcher|favourite|currentUser/i)
  })

  it('omits nextCursor when the page has none (missing optional → hasMore:false, no error)', async () => {
    const out = await confluenceAdapterResolver(manager())({
      dataSource: ConfluenceAdapterSource.DefaultFeed,
      query: {}
    })
    expect(out).toEqual({ ok: true, items: [confluenceResultRow(HIT)] })
    expect(out.ok && 'nextCursor' in out).toBe(false)
    expect(out.ok && 'prevCursor' in out).toBe(false)
  })

  it('surfaces a recoverable failure as ok:false (never throws — FR-008)', async () => {
    const m = manager({
      defaultFeed: vi.fn(
        async (): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'Reconnect.'
        })
      )
    })
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.DefaultFeed,
      query: {}
    })
    expect(out).toEqual({ ok: false, kind: 'reconnect_needed', message: 'Reconnect.' })
  })
})

describe('confluenceAdapterResolver — searchContent (FR-006)', () => {
  it('passes the query + cursor and maps items + nextCursor (happy path)', async () => {
    const m = manager({
      searchContent: vi.fn(
        async (): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
          ok: true,
          data: { items: [HIT], nextCursor: 's2' }
        })
      )
    })
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.SearchContent,
      query: { query: 'spec', cursor: 's1' }
    })
    expect(m.searchContent).toHaveBeenCalledWith({ query: 'spec', cursor: 's1' })
    expect(out).toEqual({ ok: true, items: [confluenceResultRow(HIT)], nextCursor: 's2' })
  })

  it('does NOT resolve any user names (no getUser exists — no name-resolution step)', async () => {
    const m = manager()
    await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.SearchContent,
      query: { query: 'x' }
    })
    expect(m).not.toHaveProperty('getUser')
  })

  it('surfaces rate_limited as a recoverable notice (FR-008)', async () => {
    const m = manager({
      searchContent: vi.fn(
        async (): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> => ({
          ok: false,
          kind: 'rate_limited',
          message: 'Busy.'
        })
      )
    })
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.SearchContent,
      query: { query: 'x' }
    })
    expect(out).toEqual({ ok: false, kind: 'rate_limited', message: 'Busy.' })
  })
})

describe('confluenceAdapterResolver — getPage (FR-006, detail value shape)', () => {
  it('passes the pageId and returns a single value (no items/cursor)', async () => {
    const m = manager()
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.GetPage,
      query: { pageId: 'P1' }
    })
    expect(m.getPage).toHaveBeenCalledWith({ pageId: 'P1' })
    expect(out).toEqual({ ok: true, value: DETAIL })
    expect(out.ok && 'items' in out).toBe(false)
    expect(out.ok && 'nextCursor' in out).toBe(false)
  })

  it('surfaces a gone/forbidden page read as a recoverable notice (FR-008, edge: gone page)', async () => {
    const m = manager({
      getPage: vi.fn(
        async (): Promise<ConfluenceResult<ConfluencePageDetail>> => ({
          ok: false,
          kind: 'network',
          message: 'That page could not be loaded.'
        })
      )
    })
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.GetPage,
      query: { pageId: 'gone' }
    })
    expect(out).toEqual({ ok: false, kind: 'network', message: 'That page could not be loaded.' })
  })
})

describe('confluenceAdapterResolver — unknown source + secret-free (FR-008/FR-018)', () => {
  it('returns a recoverable notice for an unknown dataSource (never crash)', async () => {
    const out = await confluenceAdapterResolver(manager())({ dataSource: 'createPage', query: {} })
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ kind: 'network' })
  })

  it('does not throw when a required field is missing (invalid/missing required → safe fallback)', async () => {
    const m = manager()
    const out = await confluenceAdapterResolver(m)({
      dataSource: ConfluenceAdapterSource.GetPage,
      query: {} as never
    })
    // missing pageId → empty string passed; never throws.
    expect(m.getPage).toHaveBeenCalledWith({ pageId: '' })
    expect(out.ok).toBe(true)
  })

  it('carries no token/secret/cloudId/CQL in the normalized result (FR-018)', async () => {
    const out = await confluenceAdapterResolver(manager())({
      dataSource: ConfluenceAdapterSource.DefaultFeed,
      query: { cursor: 'c1' }
    })
    expect(JSON.stringify(out)).not.toMatch(
      /Bearer|accessToken|refreshToken|client_secret|cloudId|currentUser|token/i
    )
  })
})
