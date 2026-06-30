/**
 * confluenceSurfaceBuilder (SHARED) — pure Confluence → A2UI 0.9 CONFLUENCE-catalog BOUND
 * SHELL / row composition (confluence-generative-adapter-v1, FR-002/FR-003).
 *
 * Lives in `src/shared/` so both main and renderer can reuse these PURE, secret-free
 * helpers; the main `src/main/confluence/confluenceSurfaceBuilder.ts` + `confluenceAdapter.ts`
 * RE-EXPORT them (single source of truth; main callers unchanged).
 *
 * The bound `SearchResultList`/`PageDetail` shells carry `{path}` bindings instead of
 * literal props; the shared AdapterDispatcher pushes fresh `updateDataModel` on refresh /
 * load-more. The row shape (`confluenceResultRow`) is unchanged (FR-002/FR-004). Pure
 * mapping: NO Confluence API calls, no IPC, no secrets (FR-018).
 */

import type { A2uiSurfaceUpdate } from '../ipc'
import type { ConfluenceSearchResult } from '../types/confluence'
import { AdapterSourcePath } from '../types/adapter'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** The bound data-model path the default activity feed reads its rows from. Single-sourced
 * from the shared {@link AdapterSourcePath} so the tool-description text + the dispatcher agree. */
export const CONFLUENCE_FEED_PATH = AdapterSourcePath.defaultFeed
/** The bound data-model path the search-results list reads its rows from (single-sourced). */
export const CONFLUENCE_RESULTS_PATH = AdapterSourcePath.searchContent
/** The bound data-model path the page-detail surface reads its single value from (single-sourced). */
export const CONFLUENCE_PAGE_PATH = AdapterSourcePath.getPage

/** Stable surface ids per bound Confluence surface kind (mirrors the Slack/Jira surface ids). */
export const SURFACE_CONFLUENCE_FEED = 'confluence-feed'
export const SURFACE_CONFLUENCE_SEARCH = 'confluence-search'
export const SURFACE_CONFLUENCE_PAGE = 'confluence-page'

/** The reserved flag paths every bound surface seeds + binds (shared convention). */
const PATH_LOADING = '/loading'
const PATH_HAS_MORE = '/hasMore'
const PATH_ERROR = '/error'

/** Map one search hit to the bound row shape `SearchResultList`/`SearchResultRow` read (non-secret). */
export function confluenceResultRow(result: ConfluenceSearchResult): Record<string, unknown> {
  return {
    id: result.id,
    title: result.title,
    ...(result.space ? { space: result.space } : {}),
    excerpt: result.excerpt
  }
}

/**
 * Compose the bound `SearchResultList` root for a list surface (FR-001/FR-002). Its rows +
 * flags are BOUND (data-free spec): the catalog component reads them via `useBound`/
 * `useDataBinding`; the dispatcher updates them in place. Append-only — `loading`/`hasMore`/
 * `error` only, no `hasPrev`.
 */
export function boundListSpec(surfaceId: string, listPath: string): A2uiSurfaceUpdate {
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

/** The data-free bound PageDetail root (sub-paths of the single `/page` value). */
export function boundPageDetailSpec(): A2uiSurfaceUpdate {
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
