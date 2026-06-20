/**
 * jiraCatalog — the Jira custom A2UI catalog (`catalogId: 'jira'`), Jira generative-UI
 * v2 (FR-006). A completely custom `Catalog` value passed to the Jira panel's
 * `<A2UIProvider catalog={jiraCatalog}>`; the Generated-UI panel keeps the standard
 * catalog (design §1.2 — two panels, two catalogs, both clean because the catalog is
 * a per-provider prop, not a global registry).
 *
 * `components` maps each component TYPE NAME (the string the surface JSON's
 * `component` field carries, emitted by `jiraSurfaceBuilder`) to its React component.
 * `functions` is empty (reserved by the SDK). A surface naming a type NOT in this map
 * degrades to the SDK's `UnknownComponent` (warn, no throw) — the panel never
 * white-screens (design §1.5).
 *
 * Component type names (the surface vocabulary) — must match the builder's emitted
 * `component` strings exactly:
 *   StatusBadge · TicketCard · IssueList · TransitionPicker · CommentRow ·
 *   CommentList · AddCommentControl · Notice
 */

import { type Catalog } from '@a2ui-sdk/react/0.9'
import {
  AddCommentControl,
  CommentList,
  CommentRow,
  CreateIssueForm,
  EditIssueForm,
  IssueList,
  LoadMoreButton,
  Notice,
  PaginationBar,
  StatusBadge,
  Text,
  TicketCard,
  TransitionPicker
} from './components'
// bug slack-generative-wrap-v1 (Jira latent instance): register width-clamped Column/Row
// wrappers in place of the raw SDK layout containers so an agent-grouped list/detail wraps
// instead of overflowing horizontally.
import { Column, Row } from './layout'

/** The `catalogId` stamped on the Jira panel's `createSurface` envelope. */
export const JIRA_CATALOG_ID = 'jira'

/**
 * The renderer-local open-detail nav action (jira-ticket-detail-v1, FR-001/FR-002),
 * re-exported so the panel can intercept it in its `onAction` seam (mirrors Slack's
 * `SLACK_OPEN_CHANNEL_ACTION` re-export).
 */
export { JIRA_OPEN_DETAIL_ACTION } from './logic'

/**
 * The detail surfaceId + the unsolicited-frame discriminator (#86, R-A), re-exported so
 * the panel can route a `jira:requestIssueDetail` detail frame into its dock slot instead
 * of clobbering the tab's list surface.
 */
export { JIRA_DETAIL_SURFACE_ID, isDetailSurfaceSpec } from './logic'

/**
 * The Jira custom catalog. The six contract components, the `Notice` block the
 * post-write re-push prepends (design §9.5), plus two generic passthroughs the
 * detail surface needs (design §1.1 permits Column/Text): the SDK's standard
 * `Column`/`Row` layout containers (render children by id) and a thin cosmos `Text`.
 * The agent's surface vocabulary remains the Jira components; the layout passthroughs
 * are emitted by the main-side builder for container roots + description, and the
 * `render_jira_ui` tool advertises `Column`/`Row` for optional grouping — so both
 * MUST be registered here or an agent-emitted `Row`/`Column` root fails to render.
 */
export const jiraCatalog: Catalog = {
  components: {
    StatusBadge,
    TicketCard,
    IssueList,
    TransitionPicker,
    CommentRow,
    CommentList,
    AddCommentControl,
    CreateIssueForm,
    EditIssueForm,
    LoadMoreButton,
    PaginationBar,
    Notice,
    Text,
    Column,
    Row
  },
  functions: {}
}
