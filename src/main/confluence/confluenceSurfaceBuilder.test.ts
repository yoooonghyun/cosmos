import { describe, it, expect } from 'vitest'
import {
  buildBoundDefaultFeedSurface,
  buildBoundPageDetailSurface,
  buildBoundSearchResultsSurface,
  SURFACE_CONFLUENCE_FEED,
  SURFACE_CONFLUENCE_PAGE,
  SURFACE_CONFLUENCE_SEARCH
} from './confluenceSurfaceBuilder'
import {
  CONFLUENCE_FEED_PATH,
  CONFLUENCE_PAGE_PATH,
  CONFLUENCE_RESULTS_PATH,
  confluenceResultRow
} from './confluenceAdapter'
import { ConfluenceAdapterSource } from '../../shared/types/confluence'
import type {
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceSearchResult
} from '../../shared/types/confluence'

/* confluence-generative-adapter-v1 — the bound surface builders (FR-002/FR-003). Each
 * re-expresses a surface with `{path}` bindings + an initial updateDataModel seed + a
 * secret-free descriptor. Pattern: bound (no literal data props); seed = first page +
 * /loading=false + /hasMore = nextCursor present; detail seeds the value; secret-free;
 * append-only (hasPrev never emitted); ONE SearchResultList backs feed + search. */

const HIT: ConfluenceSearchResult = { id: 'P1', title: 'Page One', space: 'ENG', excerpt: 'hi' }
const FEED_PAGE: ConfluencePage<ConfluenceSearchResult> = { items: [HIT], nextCursor: 'c2' }
const SEARCH_PAGE: ConfluencePage<ConfluenceSearchResult> = { items: [HIT] }
const DETAIL: ConfluencePageDetail = { id: 'P1', title: 'Page One', space: 'ENG', body: 'the body' }

function rootOf(spec: { components: Array<Record<string, unknown>> }): Record<string, unknown> {
  return spec.components[0]
}

describe('buildBoundDefaultFeedSurface (FR-002/FR-003/FR-006/FR-007)', () => {
  const surface = buildBoundDefaultFeedSurface(FEED_PAGE)

  it('binds the SearchResultList rows + flags to /feed paths (no literal data props)', () => {
    const root = rootOf(surface.spec)
    expect(surface.spec.surfaceId).toBe(SURFACE_CONFLUENCE_FEED)
    expect(root.component).toBe('SearchResultList')
    expect(root.results).toEqual({ path: CONFLUENCE_FEED_PATH })
    expect(root.loading).toEqual({ path: '/loading' })
    expect(root.hasMore).toEqual({ path: '/hasMore' })
    expect(root.error).toEqual({ path: '/error' })
    // append-only: no hasPrev / pagination bar binding.
    expect(root).not.toHaveProperty('hasPrev')
    // no literal rows baked in.
    expect(Array.isArray(root.results)).toBe(false)
  })

  it('seeds the first page + /loading=false + /hasMore from nextCursor presence', () => {
    expect(surface.dataModel).toEqual([
      { surfaceId: SURFACE_CONFLUENCE_FEED, path: CONFLUENCE_FEED_PATH, value: [confluenceResultRow(HIT)] },
      { surfaceId: SURFACE_CONFLUENCE_FEED, path: '/loading', value: false },
      { surfaceId: SURFACE_CONFLUENCE_FEED, path: '/hasMore', value: true }
    ])
  })

  it('emits a secret-free defaultFeed descriptor with NO CQL — cursor-only (FR-007)', () => {
    expect(surface.descriptor.dataSource).toBe(ConfluenceAdapterSource.DefaultFeed)
    expect(surface.descriptor.query).toEqual({})
    expect(JSON.stringify(surface.descriptor)).not.toMatch(/cql|mention|watcher|favourite|currentUser/i)
  })
})

describe('buildBoundSearchResultsSurface (FR-002/FR-003/FR-006)', () => {
  const surface = buildBoundSearchResultsSurface('spec', SEARCH_PAGE)

  it('reuses the SAME SearchResultList component, bound to /results', () => {
    const root = rootOf(surface.spec)
    expect(surface.spec.surfaceId).toBe(SURFACE_CONFLUENCE_SEARCH)
    expect(root.component).toBe('SearchResultList')
    expect(root.results).toEqual({ path: CONFLUENCE_RESULTS_PATH })
  })

  it('seeds /hasMore=false when the first page has no nextCursor (missing optional)', () => {
    expect(surface.dataModel).toEqual([
      {
        surfaceId: SURFACE_CONFLUENCE_SEARCH,
        path: CONFLUENCE_RESULTS_PATH,
        value: [confluenceResultRow(HIT)]
      },
      { surfaceId: SURFACE_CONFLUENCE_SEARCH, path: '/loading', value: false },
      { surfaceId: SURFACE_CONFLUENCE_SEARCH, path: '/hasMore', value: false }
    ])
  })

  it('emits a secret-free searchContent descriptor carrying the query', () => {
    expect(surface.descriptor.dataSource).toBe(ConfluenceAdapterSource.SearchContent)
    expect(surface.descriptor.query).toEqual({ query: 'spec' })
  })
})

describe('buildBoundPageDetailSurface (FR-002/FR-003/FR-006/FR-010)', () => {
  const surface = buildBoundPageDetailSurface(DETAIL)

  it('binds title/space/body/webUrl to sub-paths of the single /page value (no literal props)', () => {
    const root = rootOf(surface.spec)
    expect(surface.spec.surfaceId).toBe(SURFACE_CONFLUENCE_PAGE)
    expect(root.component).toBe('PageDetail')
    expect(root.title).toEqual({ path: `${CONFLUENCE_PAGE_PATH}/title` })
    expect(root.space).toEqual({ path: `${CONFLUENCE_PAGE_PATH}/space` })
    expect(root.body).toEqual({ path: `${CONFLUENCE_PAGE_PATH}/body` })
    // #87: the bound webUrl sub-path rides the same /page value (omit-when-absent in data).
    expect(root.webUrl).toEqual({ path: `${CONFLUENCE_PAGE_PATH}/webUrl` })
    expect(root.loading).toEqual({ path: '/loading' })
    expect(root.error).toEqual({ path: '/error' })
    // refresh-only: no load-more / hasMore / hasPrev binding.
    expect(root).not.toHaveProperty('hasMore')
    expect(root).not.toHaveProperty('hasPrev')
  })

  it('seeds the page value + /loading=false (no /hasMore for a none-pagination detail)', () => {
    expect(surface.dataModel).toEqual([
      { surfaceId: SURFACE_CONFLUENCE_PAGE, path: CONFLUENCE_PAGE_PATH, value: DETAIL },
      { surfaceId: SURFACE_CONFLUENCE_PAGE, path: '/loading', value: false }
    ])
  })

  it('does not error and carries no webUrl in the seed when the detail omits it (#87 FR-004)', () => {
    // DETAIL has no webUrl key; the seed serializes the whole value, so a missing optional
    // simply does not appear — the bound webUrl path resolves to absent → affordance omitted.
    const seed = surface.dataModel.find((d) => d.path === CONFLUENCE_PAGE_PATH)
    expect(seed?.value).toEqual(DETAIL)
    expect('webUrl' in (seed?.value as object)).toBe(false)
  })

  it('carries webUrl through the seed when the detail has it (#87 FR-003)', () => {
    const withUrl: ConfluencePageDetail = {
      ...DETAIL,
      webUrl: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/P1/Page-One'
    }
    const s = buildBoundPageDetailSurface(withUrl)
    const seed = s.dataModel.find((d) => d.path === CONFLUENCE_PAGE_PATH)
    expect((seed?.value as ConfluencePageDetail).webUrl).toBe(withUrl.webUrl)
  })

  it('emits a secret-free getPage descriptor carrying the pageId', () => {
    expect(surface.descriptor.dataSource).toBe(ConfluenceAdapterSource.GetPage)
    expect(surface.descriptor.query).toEqual({ pageId: 'P1' })
    expect(JSON.stringify(surface.descriptor)).not.toMatch(
      /Bearer|accessToken|refreshToken|client_secret|cloudId|token/i
    )
  })
})
