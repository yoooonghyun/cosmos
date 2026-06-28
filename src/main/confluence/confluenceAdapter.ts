/**
 * confluenceAdapter — the CONFLUENCE-SPECIFIC wiring for the shared generative
 * adapter (confluence-generative-adapter-v1, FR-005/FR-006/FR-007/FR-008).
 * Mirrors `slackAdapter.ts` (append-only lists) + `jiraAdapter.ts` (the single
 * refresh-only detail). Two responsibilities, both pure of Electron so they are
 * node-testable:
 *
 *  1. `confluenceAdapterResolver(manager)` — an {@link AdapterResolver} the shared
 *     {@link AdapterDispatcher} calls to re-execute a Confluence descriptor. It maps
 *     the descriptor's `dataSource` (`defaultFeed`|`searchContent`|`getPage`) to the
 *     real ConfluenceManager READ (token + cloudId stay in main — FR-008/FR-018), and
 *     normalizes the `ConfluenceResult<ConfluencePage<…>>` / `ConfluenceResult<
 *     ConfluencePageDetail>` into the panel-agnostic {@link AdapterFetchResult} (items +
 *     nextCursor for the two lists; a single `value` for the page detail; or an
 *     `ok:false` recoverable notice carrying `kind`/`message`). The shared layer never
 *     parses a Confluence DTO — only this resolver does. It MUST NOT throw and MUST NOT
 *     leak a secret (FR-008/FR-018).
 *
 *  2. The Confluence BIND OPTIONS for each surface ({@link confluenceFeedBindOptions} /
 *     {@link confluenceSearchBindOptions} / {@link confluencePageBindOptions}) the
 *     dispatcher registers a surface with — the bound list/value path + the pagination
 *     mode. APPEND ONLY for the two lists (FR-010/FR-011): Confluence's only paging
 *     cursor is the opaque, forward-only `_links.next` value, so there is no
 *     page-replace and `hasPrev` is unused; page detail is `none` (refresh-only).
 *
 * READ-ONLY (FR-017): the manager subset is the three READS — no write. NO name
 * resolution step (unlike Slack): Confluence rows carry no user-id needing a lookup.
 *
 * The bound-surface COMPOSITION (the `{path}`/initial-data-model surface specs) lives
 * in `confluenceSurfaceBuilder.ts`; this module owns only the read mapping + bind options.
 */

import type {
  AdapterFetchResult,
  AdapterRegisterOptions,
  AdapterResolver
} from '../generative/adapterDispatcher'
import type { AdapterDescriptor } from '../../shared/types/adapter'
import { AdapterSourcePath } from '../../shared/types/adapter'
import { ConfluenceAdapterSource } from '../../shared/types/confluence'
import type {
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult
} from '../../shared/types/confluence'

/** The bound data-model path the default activity feed reads its rows from. Single-sourced
 * from the shared {@link AdapterSourcePath} so the tool-description text + the dispatcher agree. */
export const CONFLUENCE_FEED_PATH = AdapterSourcePath.defaultFeed
/** The bound data-model path the search-results list reads its rows from (single-sourced). */
export const CONFLUENCE_RESULTS_PATH = AdapterSourcePath.searchContent
/** The bound data-model path the page-detail surface reads its single value from (single-sourced). */
export const CONFLUENCE_PAGE_PATH = AdapterSourcePath.getPage

/** Bind options for the default-FEED list surface: append/load-more pagination (FR-010/FR-011). */
export const confluenceFeedBindOptions: AdapterRegisterOptions = {
  listPath: CONFLUENCE_FEED_PATH,
  pagination: 'append'
}
/** Bind options for the SEARCH-results list surface: append/load-more pagination (FR-010/FR-011). */
export const confluenceSearchBindOptions: AdapterRegisterOptions = {
  listPath: CONFLUENCE_RESULTS_PATH,
  pagination: 'append'
}
/** Bind options for the page-DETAIL surface: single value, no pagination (FR-010). */
export const confluencePageBindOptions: AdapterRegisterOptions = {
  listPath: CONFLUENCE_PAGE_PATH,
  pagination: 'none'
}

/**
 * Resolve the bind options a Confluence descriptor's `dataSource` implies (FR-015).
 * Used by main's lazy re-registration on a restore/re-activation refresh so it never
 * special-cases each source inline. Returns `null` for a non-Confluence/unknown source.
 */
export function confluenceBindOptionsForSource(
  dataSource: string
): AdapterRegisterOptions | null {
  switch (dataSource) {
    case ConfluenceAdapterSource.DefaultFeed:
      return confluenceFeedBindOptions
    case ConfluenceAdapterSource.SearchContent:
      return confluenceSearchBindOptions
    case ConfluenceAdapterSource.GetPage:
      return confluencePageBindOptions
    default:
      return null
  }
}

/**
 * The ConfluenceManager subset the resolver needs — the three READS (never a write —
 * FR-017). Matches the real ConfluenceManager method shapes. `createPage` is
 * deliberately excluded (the separate `confluence-create-page-v1` feature).
 */
export interface ConfluenceAdapterManager {
  defaultFeed(
    params: ConfluenceDefaultFeedParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>
  searchContent(
    params: ConfluenceSearchParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>
  getPage(params: ConfluenceGetPageParams): Promise<ConfluenceResult<ConfluencePageDetail>>
}

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
 * Build the {@link AdapterResolver} for Confluence. The dispatcher calls it with a
 * descriptor (the base query merged with the page cursor); this maps it to the
 * ConfluenceManager read and normalizes the result. A `reconnect_needed`/
 * `not_connected`/`rate_limited`/`network` failure is surfaced as a recoverable
 * `ok:false` notice (the dispatcher renders the message + clears loading, leaving prior
 * data intact — FR-008). Never throws. Secret-free result (FR-018). NO name resolution.
 */
export function confluenceAdapterResolver(
  manager: ConfluenceAdapterManager
): AdapterResolver {
  return async (descriptor: AdapterDescriptor): Promise<AdapterFetchResult> => {
    if (descriptor.dataSource === ConfluenceAdapterSource.DefaultFeed) {
      // FR-007: the feed descriptor is CURSOR-ONLY — no CQL crosses here.
      const params: ConfluenceDefaultFeedParams = {
        ...(typeof descriptor.query.cursor === 'string' ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.defaultFeed(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      return {
        ok: true,
        items: result.data.items.map(confluenceResultRow),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    if (descriptor.dataSource === ConfluenceAdapterSource.SearchContent) {
      const query = typeof descriptor.query.query === 'string' ? descriptor.query.query : ''
      const params: ConfluenceSearchParams = {
        query,
        ...(typeof descriptor.query.cursor === 'string' ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.searchContent(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      return {
        ok: true,
        items: result.data.items.map(confluenceResultRow),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    if (descriptor.dataSource === ConfluenceAdapterSource.GetPage) {
      const pageId = typeof descriptor.query.pageId === 'string' ? descriptor.query.pageId : ''
      const result = await manager.getPage({ pageId })
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      // A detail surface binds a single value (no list / cursors).
      return { ok: true, value: result.data }
    }

    // Unknown dataSource — recoverable, never a crash (FR-008).
    return { ok: false, kind: 'network', message: 'Unknown Confluence data source.' }
  }
}
