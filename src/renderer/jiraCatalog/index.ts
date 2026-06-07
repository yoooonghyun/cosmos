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

import { standardCatalog, type Catalog } from '@a2ui-sdk/react/0.9'
import {
  AddCommentControl,
  CommentList,
  CommentRow,
  CreateIssueForm,
  EditIssueForm,
  IssueList,
  Notice,
  StatusBadge,
  Text,
  TicketCard,
  TransitionPicker
} from './components'

/** The `catalogId` stamped on the Jira panel's `createSurface` envelope. */
export const JIRA_CATALOG_ID = 'jira'

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
    Notice,
    Text,
    Column: standardCatalog.components.Column,
    Row: standardCatalog.components.Row
  },
  functions: {}
}
