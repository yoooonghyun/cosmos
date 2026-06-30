/**
 * confluenceSurfaceBuilder (main) — the pure Confluence bound-shell / row helpers live in
 * the SHARED module `src/shared/surfaceBuilders/confluenceSurfaceBuilder.ts`. This file
 * RE-EXPORTS them (single source of truth; the main resolver/dispatcher imports are
 * unchanged) and keeps the MAIN-ONLY `buildConfluenceBoundShell` (panel-refresh-v1) here.
 */

import type { A2uiSurfaceUpdate } from '../../shared/ipc'
import { ConfluenceAdapterSource } from '../../shared/types/confluence'
import {
  boundListSpec,
  boundPageDetailSpec,
  CONFLUENCE_FEED_PATH,
  CONFLUENCE_RESULTS_PATH,
  SURFACE_CONFLUENCE_FEED,
  SURFACE_CONFLUENCE_SEARCH
} from '../../shared/surfaceBuilders/confluenceSurfaceBuilder'

// Re-export the relocated pure row mapper + constants (single source of truth).
export {
  confluenceResultRow,
  CONFLUENCE_FEED_PATH,
  CONFLUENCE_RESULTS_PATH,
  CONFLUENCE_PAGE_PATH,
  SURFACE_CONFLUENCE_FEED,
  SURFACE_CONFLUENCE_SEARCH,
  SURFACE_CONFLUENCE_PAGE
} from '../../shared/surfaceBuilders/confluenceSurfaceBuilder'

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
