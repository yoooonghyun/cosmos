/**
 * slackSurfaceBuilder — pure Slack → A2UI 0.9 SLACK-CUSTOM-catalog BOUND surface
 * composition (slack-generative-adapter-v1, FR-002/FR-003). Mirrors the bound builders
 * in `jiraSurfaceBuilder.ts`.
 *
 * A bound Slack surface carries `{path}` bindings instead of literal row props, plus an
 * INITIAL data-model seed (the first page + `/loading=false` + `/hasMore`) and a
 * SECRET-FREE descriptor for re-execution. The catalog `ChannelList`/`MessageList`/
 * `SearchResultList` read the bound list path + flags; the shared AdapterDispatcher
 * pushes fresh `updateDataModel` on refresh / load-more (append). The row shapes
 * (ChannelRow/MessageRow/SearchResultRow) are unchanged (FR-002/FR-004).
 *
 * APPEND-ONLY (FR-010/FR-011): every list binds `loading`/`hasMore` only — no `hasPrev`,
 * no PaginationBar. READ-ONLY (FR-017): no write controls. Pure mapping: NO Slack API
 * calls, no IPC, no secrets — only the non-secret row content + the secret-free
 * descriptor cross (FR-018).
 */

import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../shared/ipc'
import type {
  SlackChannel,
  SlackMessage,
  SlackPage,
  SlackSearchMatch
} from '../shared/slack'
import {
  SlackAdapterSource,
  slackChannelsDescriptor,
  slackHistoryDescriptor,
  slackSearchDescriptor,
  type SlackAdapterDescriptor
} from '../shared/slack'
import {
  SLACK_CHANNELS_PATH,
  SLACK_MATCHES_PATH,
  SLACK_MESSAGES_PATH,
  slackChannelRow,
  slackMessageRow,
  slackSearchRow
} from './slackAdapter'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** Stable surface ids per bound Slack surface kind (mirrors the Jira surface ids). */
export const SURFACE_SLACK_CHANNELS = 'slack-channels'
export const SURFACE_SLACK_HISTORY = 'slack-history'
export const SURFACE_SLACK_SEARCH = 'slack-search'

/** The reserved flag paths every bound list seeds + binds (shared convention). */
const PATH_LOADING = '/loading'
const PATH_HAS_MORE = '/hasMore'

/** A composed BOUND Slack surface: the view spec + its initial data model + its descriptor. */
export interface SlackBoundSurface {
  /** The `{path}`-bound A2UI surface spec (data-free; rows/flags read the data model). */
  spec: A2uiSurfaceUpdate
  /** The initial data-model seed (first page + `/loading`/`/hasMore`) — FR-002/FR-003. */
  dataModel: UiDataModelPayload[]
  /** The secret-free descriptor for re-execution (refresh / append) — FR-005/FR-006. */
  descriptor: SlackAdapterDescriptor
}

/**
 * Build the initial data-model seed for a bound Slack list (first page rows + flags).
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
 * Compose a single bound-list root component reading its rows + flags from the data model
 * (FR-001/FR-002). The list `component` type + the rows prop name (`channels`/`messages`/
 * `matches`) match the Slack catalog's bound list variants.
 */
function boundListSpec(
  surfaceId: string,
  component: string,
  rowsProp: string,
  listPath: string
): A2uiSurfaceUpdate {
  const root: Component = {
    id: 'root',
    component,
    // FR-001: rows + flags are BOUND (data-free spec). The catalog component reads these
    // paths via `useBound`/`useDataBinding`; the dispatcher updates them in place.
    [rowsProp]: { path: listPath },
    loading: { path: PATH_LOADING },
    hasMore: { path: PATH_HAS_MORE },
    error: { path: '/error' }
  }
  return { surfaceId, components: [root] }
}

/**
 * Compose a BOUND channel-LIST surface (FR-002/FR-003/FR-006). The `ChannelList` root
 * reads its rows from `/channels` + the `loading`/`hasMore` flags; the descriptor
 * (`listChannels` + optional cursor) drives refresh + append. Seeded from the first page.
 */
export function buildBoundChannelListSurface(
  page: SlackPage<SlackChannel>
): SlackBoundSurface {
  const rows = page.items.map(slackChannelRow)
  return {
    spec: boundListSpec(SURFACE_SLACK_CHANNELS, 'ChannelList', 'channels', SLACK_CHANNELS_PATH),
    dataModel: listSeed(SURFACE_SLACK_CHANNELS, SLACK_CHANNELS_PATH, rows, page.nextCursor),
    descriptor: slackChannelsDescriptor(undefined)
  }
}

/**
 * Compose a BOUND message-HISTORY surface (FR-002/FR-003/FR-006). The `MessageList` root
 * reads its rows from `/messages` + flags; the descriptor (`getHistory` + the channelId)
 * drives refresh + append. The agent composes the real `channelId` into the descriptor at
 * compose time (it has the id from its read — spec Open Question), kept secret-free.
 */
export function buildBoundMessageListSurface(
  channelId: string,
  page: SlackPage<SlackMessage>
): SlackBoundSurface {
  // slack-generative-message-parity-v1 (FR-013): the first-paint SEED rows carry the same
  // non-secret thread coords (channelId + threadTs) the refresh resolver injects, so the
  // seeded "N replies" affordance is interactive before any refresh.
  const rows = page.items.map((m) => slackMessageRow(m, channelId))
  return {
    spec: boundListSpec(SURFACE_SLACK_HISTORY, 'MessageList', 'messages', SLACK_MESSAGES_PATH),
    dataModel: listSeed(SURFACE_SLACK_HISTORY, SLACK_MESSAGES_PATH, rows, page.nextCursor),
    descriptor: slackHistoryDescriptor(channelId, undefined)
  }
}

/**
 * Compose a BOUND search-RESULTS surface (FR-002/FR-003/FR-006). The `SearchResultList`
 * root reads its rows from `/matches` + flags; the descriptor (`search` + the query)
 * drives refresh + append via the synthetic forward page cursor (FR-011). Seeded from the
 * first page.
 */
export function buildBoundSearchResultListSurface(
  query: string,
  page: SlackPage<SlackSearchMatch>
): SlackBoundSurface {
  const rows = page.items.map(slackSearchRow)
  return {
    spec: boundListSpec(SURFACE_SLACK_SEARCH, 'SearchResultList', 'matches', SLACK_MATCHES_PATH),
    dataModel: listSeed(SURFACE_SLACK_SEARCH, SLACK_MATCHES_PATH, rows, page.nextCursor),
    descriptor: slackSearchDescriptor(query, undefined)
  }
}

/**
 * panel-refresh-v1 (OQ-5 = main-composes): build the DATA-FREE bound SHELL surface for a
 * Slack `dataSource`, so main can push a `{path}`-bound surface (instead of the agent's
 * literal-prop spec) and then let the AdapterDispatcher's first `refresh` paint it in
 * place. The shell carries no data — just the bound root reading the reserved paths the
 * dispatcher writes. Returns `null` for a non-Slack source. The surfaceId is stable per
 * source so a later refresh's `updateDataModel` (keyed by surfaceId) lands here.
 */
export function buildSlackBoundShell(dataSource: string): A2uiSurfaceUpdate | null {
  switch (dataSource) {
    case SlackAdapterSource.ListChannels:
      return boundListSpec(SURFACE_SLACK_CHANNELS, 'ChannelList', 'channels', SLACK_CHANNELS_PATH)
    case SlackAdapterSource.GetHistory:
      return boundListSpec(SURFACE_SLACK_HISTORY, 'MessageList', 'messages', SLACK_MESSAGES_PATH)
    case SlackAdapterSource.Search:
      return boundListSpec(SURFACE_SLACK_SEARCH, 'SearchResultList', 'matches', SLACK_MATCHES_PATH)
    default:
      return null
  }
}
