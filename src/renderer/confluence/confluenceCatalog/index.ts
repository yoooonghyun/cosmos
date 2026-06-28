/**
 * confluenceCatalog — the Confluence custom A2UI catalog (`catalogId: 'confluence'`),
 * Slack + Confluence generative-UI v1 (FR-006). A completely custom `Catalog` value
 * passed to the Confluence panel's `<A2UIProvider catalog={confluenceCatalog}>`; the
 * other panels keep their own catalogs (design §1.2 — per-provider prop, not a global
 * registry).
 *
 * `components` maps each component TYPE NAME (the string the surface JSON's `component`
 * field carries, emitted by the agent via `render_confluence_ui`) to its React
 * component. `functions` is empty (reserved by the SDK). A surface naming a type NOT in
 * this map degrades to the SDK's `UnknownComponent` (warn, no throw) — the panel never
 * white-screens (design §1.5).
 *
 * Component type names (the surface vocabulary) — must match the
 * `render_confluence_ui` tool's advertised `component` strings exactly:
 *   SearchResultRow · SearchResultList · PageDetail · Notice · Text
 *   (+ Column/Row passthroughs)
 */

import { type Catalog } from '@a2ui-sdk/react/0.9'
import {
  Notice,
  PageDetail,
  SearchResultList,
  SearchResultRow,
  Text
} from './components'
// bug slack-generative-wrap-v1 (Confluence latent instance): register width-clamped
// Column/Row wrappers in place of the raw SDK layout containers so an agent-grouped
// list/detail wraps instead of overflowing horizontally.
import { Column, Row } from './layout'
// confluence-generative-adapter-v1 (design §6.1): the bound list's tail load-more reuses
// the SHARED adapter control verbatim. Confluence is append-only, so it registers
// LoadMoreButton ONLY — never PaginationBar. Refresh moved to the panel chrome
// (panel-refresh-v1, FR-006).
import { LoadMoreButton } from '../../catalogShared/controls'

/** The `catalogId` the Confluence panel's `<A2UIProvider>` registers. */
export const CONFLUENCE_CATALOG_ID = 'confluence'

/**
 * The Confluence custom catalog. The four display-only contract components plus two
 * generic passthroughs the agent may use for grouping/labelling (design §1.1 permits
 * Column/Row/Text): the SDK's standard `Column`/`Row` layout containers (render
 * children by id). The `render_confluence_ui` tool advertises `Column`/`Row`, so both
 * MUST be registered here or an agent-emitted `Row`/`Column` root fails to render.
 */
export const confluenceCatalog: Catalog = {
  components: {
    SearchResultRow,
    SearchResultList,
    PageDetail,
    Notice,
    Text,
    LoadMoreButton,
    Column,
    Row
  },
  functions: {}
}
