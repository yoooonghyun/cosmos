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

import { standardCatalog, type Catalog } from '@a2ui-sdk/react/0.9'
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

/** The `catalogId` the Slack panel's `<A2UIProvider>` registers. */
export const SLACK_CATALOG_ID = 'slack'

/** Re-exported so the panel can intercept a generated channel-row click (see logic.ts). */
export { SLACK_OPEN_CHANNEL_ACTION } from './logic'

/**
 * The Slack custom catalog. The nine display-only contract components plus two generic
 * passthroughs the agent may use for grouping/labelling (design §1.1 permits
 * Column/Row/Text): the SDK's standard `Column`/`Row` layout containers (render
 * children by id). The `render_slack_ui` tool advertises `Column`/`Row`, so both MUST
 * be registered here or an agent-emitted `Row`/`Column` root fails to render.
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
    Column: standardCatalog.components.Column,
    Row: standardCatalog.components.Row
  },
  functions: {}
}
