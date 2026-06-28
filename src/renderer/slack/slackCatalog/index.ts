/**
 * slackCatalog — the Slack custom A2UI catalog (`catalogId: 'slack'`), Slack +
 * Confluence generative-UI v1 (FR-006). A completely custom `Catalog` value passed to
 * the Slack panel's `<A2UIProvider catalog={slackCatalog}>`; the Generated-UI and Jira
 * panels keep their own catalogs (design §1.2 — per-provider prop, not a global
 * registry).
 *
 * `components` maps each component TYPE NAME (the string the surface JSON's `component`
 * field carries, emitted by the agent via `render_slack_ui`) to its React component.
 * `functions` is empty (reserved by the SDK). A surface naming a type NOT in this map
 * degrades to the SDK's `UnknownComponent` (warn, no throw) — the panel never
 * white-screens (design §1.5).
 *
 * Component type names (the surface vocabulary) — must match the `render_slack_ui`
 * tool's advertised `component` strings exactly:
 *   ChannelRow · ChannelList · MessageRow · MessageList · SearchResultRow ·
 *   SearchResultList · UserChip · Notice · Text (+ Column/Row passthroughs)
 */

import { type Catalog } from '@a2ui-sdk/react/0.9'
import {
  ChannelList,
  ChannelRow,
  MessageList,
  MessageRow,
  Notice,
  SearchResultList,
  SearchResultRow,
  Text,
  UserChip
} from './components'
// slack-generative-adapter-v1 (design §6): the bound lists' tail load-more reuses the
// SHARED adapter control verbatim. Slack is append-only, so it registers LoadMoreButton
// ONLY — never PaginationBar. Refresh moved to the panel chrome (panel-refresh-v1, FR-006).
import { LoadMoreButton } from '../../generative/catalogShared/controls'
// bug slack-generative-wrap-v1: the agent-emitted Column/Row are registered through these
// width-clamped wrappers (not the raw SDK ones) so a long message line wraps to the panel
// width instead of expanding the unclamped SDK flex container and overflowing horizontally.
import { Column, Row } from './layout'

/** The `catalogId` the Slack panel's `<A2UIProvider>` registers. */
export const SLACK_CATALOG_ID = 'slack'

/** Re-exported so the panel can intercept a generated channel-row click (see logic.ts). */
export { SLACK_OPEN_CHANNEL_ACTION } from './logic'

/**
 * The Slack custom catalog. The nine display-only contract components plus two generic
 * passthroughs the agent may use for grouping/labelling (design §1.1 permits
 * Column/Row/Text): the SDK's standard `Column`/`Row` layout containers (render children
 * by id), wrapped in width clamps (`./layout`, bug slack-generative-wrap-v1) so a grouped
 * list wraps to the panel instead of overflowing. The `render_slack_ui` tool advertises
 * `Column`/`Row`, so both MUST be registered here or an agent-emitted `Row`/`Column` root
 * fails to render.
 */
export const slackCatalog: Catalog = {
  components: {
    ChannelRow,
    ChannelList,
    MessageRow,
    MessageList,
    SearchResultRow,
    SearchResultList,
    UserChip,
    Notice,
    Text,
    LoadMoreButton,
    // bug slack-generative-wrap-v1: width-clamped wrappers, NOT the raw SDK Column/Row,
    // so an agent-grouped list wraps instead of overflowing.
    Column,
    Row
  },
  functions: {}
}
