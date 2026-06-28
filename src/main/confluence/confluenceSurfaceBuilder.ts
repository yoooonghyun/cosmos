/**
 * confluenceSurfaceBuilder — pure Confluence → A2UI 0.9 CONFLUENCE-catalog BOUND
 * surface composition (confluence-generative-adapter-v1, FR-002/FR-003). Mirrors the
 * bound builders in `slackSurfaceBuilder.ts` (the two lists) and `jiraSurfaceBuilder.ts`
 * (the refresh-only detail).
 *
 * A bound Confluence surface carries `{path}` bindings instead of literal props, plus an
 * INITIAL data-model seed (for a list: the first page + `/loading=false` + `/hasMore`;
 * for the detail: the page value + `/loading=false`) and a SECRET-FREE descriptor for
 * re-execution. The catalog `SearchResultList`/`PageDetail` read the bound paths + flags;
 * the shared AdapterDispatcher pushes fresh `updateDataModel` on refresh / load-more
 * (append for the lists). The row/detail shapes are unchanged (FR-002/FR-004).
 *
 * ONE bound `SearchResultList` backs BOTH the default feed and search results (design
 * §1/§6.3): the two builders seed different descriptors + bound paths but the SAME
 * component. APPEND-ONLY for the lists (FR-010/FR-011): each binds `loading`/`hasMore`
 * only — no `hasPrev`, no PaginationBar. The page detail is `none` (refresh-only).
 * READ-ONLY (FR-017): no write controls. Pure mapping: NO Confluence API calls, no IPC,
 * no secrets — only the non-secret row/detail content + the secret-free descriptor
 * cross (FR-018).
 */

import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../../shared/ipc'
import type {
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceSearchResult
} from '../../shared/types/confluence'
import {
  ConfluenceAdapterSource,
  confluenceFeedDescriptor,
  confluencePageDescriptor,
  confluenceSearchDescriptor,
  type ConfluenceAdapterDescriptor
} from '../../shared/types/confluence'
import {
  CONFLUENCE_FEED_PATH,
  CONFLUENCE_PAGE_PATH,
  CONFLUENCE_RESULTS_PATH,
  confluenceResultRow
} from './confluenceAdapter'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** Stable surface ids per bound Confluence surface kind (mirrors the Slack/Jira surface ids). */
export const SURFACE_CONFLUENCE_FEED = 'confluence-feed'
export const SURFACE_CONFLUENCE_SEARCH = 'confluence-search'
export const SURFACE_CONFLUENCE_PAGE = 'confluence-page'

/** The reserved flag paths every bound surface seeds + binds (shared convention). */
const PATH_LOADING = '/loading'
const PATH_HAS_MORE = '/hasMore'
const PATH_ERROR = '/error'

/** A composed BOUND Confluence surface: the view spec + its initial data model + its descriptor. */
export interface ConfluenceBoundSurface {
  /** The `{path}`-bound A2UI surface spec (data-free; rows/value/flags read the data model). */
  spec: A2uiSurfaceUpdate
  /** The initial data-model seed — FR-002/FR-003. */
  dataModel: UiDataModelPayload[]
  /** The secret-free descriptor for re-execution (refresh / append) — FR-005/FR-006. */
  descriptor: ConfluenceAdapterDescriptor
}

/**
 * Build the initial data-model seed for a bound Confluence LIST (first page rows + flags).
 * `hasMore` reflects the presence of the page's `nextCursor` (FR-012). `loading=false`
 * on first paint (FR-003).
 */
function listSeed(
  surfaceId: string,
  listPath: string,
  rows: Record<string, unknown>[],
  nextCursor: string | undefined
): UiDataModelPayload[] {
  return [
    { surfaceId, path: listPath, value: rows },
    { surfaceId, path: PATH_LOADING, value: false },
    { surfaceId, path: PATH_HAS_MORE, value: nextCursor !== undefined }
  ]
}

/**
 * Compose the bound `SearchResultList` root for a list surface (FR-001/FR-002). Its rows +
 * flags are BOUND (data-free spec): the catalog component reads them via `useBound`/
 * `useDataBinding`; the dispatcher updates them in place. Append-only — `loading`/`hasMore`/
 * `error` only, no `hasPrev`.
 */
function boundListSpec(surfaceId: string, listPath: string): A2uiSurfaceUpdate {
  const root: Component = {
    id: 'root',
    component: 'SearchResultList',
    results: { path: listPath },
    loading: { path: PATH_LOADING },
    hasMore: { path: PATH_HAS_MORE },
    error: { path: PATH_ERROR }
  }
  return { surfaceId, components: [root] }
}

/**
 * Compose a BOUND default-FEED surface (FR-002/FR-003/FR-006/FR-007). The bound
 * `SearchResultList` reads its rows from `/feed` + the `loading`/`hasMore` flags; the
 * descriptor (`defaultFeed` + optional cursor — NO CQL, FR-007) drives refresh + append.
 * Seeded from the first page.
 */
export function buildBoundDefaultFeedSurface(
  page: ConfluencePage<ConfluenceSearchResult>
): ConfluenceBoundSurface {
  const rows = page.items.map(confluenceResultRow)
  return {
    spec: boundListSpec(SURFACE_CONFLUENCE_FEED, CONFLUENCE_FEED_PATH),
    dataModel: listSeed(SURFACE_CONFLUENCE_FEED, CONFLUENCE_FEED_PATH, rows, page.nextCursor),
    descriptor: confluenceFeedDescriptor(undefined)
  }
}

/**
 * Compose a BOUND search-RESULTS surface (FR-002/FR-003/FR-006). The SAME bound
 * `SearchResultList` reads its rows from `/results` + flags; the descriptor
 * (`searchContent` + the query) drives refresh + append via the opaque forward cursor
 * (FR-011). Seeded from the first page.
 */
export function buildBoundSearchResultsSurface(
  query: string,
  page: ConfluencePage<ConfluenceSearchResult>
): ConfluenceBoundSurface {
  const rows = page.items.map(confluenceResultRow)
  return {
    spec: boundListSpec(SURFACE_CONFLUENCE_SEARCH, CONFLUENCE_RESULTS_PATH),
    dataModel: listSeed(SURFACE_CONFLUENCE_SEARCH, CONFLUENCE_RESULTS_PATH, rows, page.nextCursor),
    descriptor: confluenceSearchDescriptor(query, undefined)
  }
}

/**
 * Compose a BOUND page-DETAIL surface (FR-002/FR-003/FR-006/FR-010). The detail has NO
 * pagination ('none') but is refreshable (FR-014): its `title`/`space`/`body` display
 * props bind to sub-paths of the single bound page value at {@link CONFLUENCE_PAGE_PATH}
 * (`/page`), so a refresh `updateDataModel` of `/page` re-renders the whole detail in
 * place — no view re-compose (FR-016). Manual refresh is now a panel-chrome control
 * (panel-refresh-v1, FR-006), not an in-header button; the detail still binds `loading`
 * (aria-busy) and a bound `error` for the recoverable notice.
 * Seed = the page value + `/loading=false`; descriptor = `getPage` + pageId.
 */
export function buildBoundPageDetailSurface(
  detail: ConfluencePageDetail
): ConfluenceBoundSurface {
  const root: Component = {
    id: 'root',
    component: 'PageDetail',
    // FR-001: every display prop is BOUND to a sub-path of the single page value.
    title: { path: `${CONFLUENCE_PAGE_PATH}/title` },
    space: { path: `${CONFLUENCE_PAGE_PATH}/space` },
    body: { path: `${CONFLUENCE_PAGE_PATH}/body` },
    // #87: the canonical web URL rides the same /page value (omit-when-absent in the data).
    webUrl: { path: `${CONFLUENCE_PAGE_PATH}/webUrl` },
    loading: { path: PATH_LOADING },
    error: { path: PATH_ERROR }
  }
  return {
    spec: { surfaceId: SURFACE_CONFLUENCE_PAGE, components: [root] },
    dataModel: [
      { surfaceId: SURFACE_CONFLUENCE_PAGE, path: CONFLUENCE_PAGE_PATH, value: detail },
      { surfaceId: SURFACE_CONFLUENCE_PAGE, path: PATH_LOADING, value: false }
    ],
    descriptor: confluencePageDescriptor(detail.id)
  }
}

/** The data-free bound PageDetail root (sub-paths of the single `/page` value). */
function boundPageDetailSpec(): A2uiSurfaceUpdate {
  const root: Component = {
    id: 'root',
    component: 'PageDetail',
    title: { path: `${CONFLUENCE_PAGE_PATH}/title` },
    space: { path: `${CONFLUENCE_PAGE_PATH}/space` },
    body: { path: `${CONFLUENCE_PAGE_PATH}/body` },
    // #87: the canonical web URL rides the same /page value (omit-when-absent in the data).
    webUrl: { path: `${CONFLUENCE_PAGE_PATH}/webUrl` },
    loading: { path: PATH_LOADING },
    error: { path: PATH_ERROR }
  }
  return { surfaceId: SURFACE_CONFLUENCE_PAGE, components: [root] }
}

/**
 * panel-refresh-v1 (OQ-5 = main-composes): build the DATA-FREE bound SHELL surface for a
 * Confluence `dataSource`, so main can push a `{path}`-bound surface (instead of the
 * agent's literal-prop spec) and let the AdapterDispatcher's first `refresh` paint it in
 * place. Returns `null` for a non-Confluence source. The surfaceId is stable per source.
 */
export function buildConfluenceBoundShell(dataSource: string): A2uiSurfaceUpdate | null {
  switch (dataSource) {
    case ConfluenceAdapterSource.DefaultFeed:
      return boundListSpec(SURFACE_CONFLUENCE_FEED, CONFLUENCE_FEED_PATH)
    case ConfluenceAdapterSource.SearchContent:
      return boundListSpec(SURFACE_CONFLUENCE_SEARCH, CONFLUENCE_RESULTS_PATH)
    case ConfluenceAdapterSource.GetPage:
      return boundPageDetailSpec()
    default:
      return null
  }
}
