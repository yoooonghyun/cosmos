/**
 * slackSurfaceBuilder (SHARED) — pure Slack → A2UI 0.9 SLACK-CUSTOM-catalog BOUND surface
 * composition (slack-generative-adapter-v1, FR-002/FR-003).
 *
 * RELOCATED to `src/shared/` (cosmos-native-view-mirror-surface-v1, D3) so the RENDERER
 * can reuse these PURE, secret-free builders to project a Slack tab's CURRENT native view
 * into a favorite mirror surface — without any main dependency. The main
 * `src/main/slack/slackSurfaceBuilder.ts` + `slackAdapter.ts` RE-EXPORT these symbols
 * (single source of truth; main callers unchanged).
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

import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../ipc'
import type { SlackChannel, SlackMessage, SlackPage, SlackSearchMatch } from '../types/slack'
import {
  slackChannelsDescriptor,
  slackHistoryDescriptor,
  slackSearchDescriptor,
  type SlackAdapterDescriptor
} from '../types/slack'
import { AdapterSourcePath } from '../types/adapter'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** The bound data-model path the channel-list reads its rows from. Single-sourced from the
 * shared {@link AdapterSourcePath} so the tool-description text + the dispatcher agree. */
export const SLACK_CHANNELS_PATH = AdapterSourcePath.listChannels
/** The bound data-model path the message-history reads its rows from (single-sourced). */
export const SLACK_MESSAGES_PATH = AdapterSourcePath.getHistory
/** The bound data-model path the search-results reads its rows from (single-sourced). */
export const SLACK_MATCHES_PATH = AdapterSourcePath.search

/** Stable surface ids per bound Slack surface kind (mirrors the Jira surface ids). */
export const SURFACE_SLACK_CHANNELS = 'slack-channels'
export const SURFACE_SLACK_HISTORY = 'slack-history'
export const SURFACE_SLACK_SEARCH = 'slack-search'

/** The reserved flag paths every bound list seeds + binds (shared convention). */
const PATH_LOADING = '/loading'
const PATH_HAS_MORE = '/hasMore'

/** Map one channel to the bound row shape `ChannelList`/`ChannelRow` read (non-secret). */
export function slackChannelRow(channel: SlackChannel): Record<string, unknown> {
  return { id: channel.id, name: channel.name, isMember: channel.isMember }
}

/**
 * Map one message to the bound row shape `MessageList`/`MessageRow` read (non-secret).
 *
 * slack-generative-message-parity-v1 (FR-005/FR-013): when a `channelId` is supplied —
 * ONLY the channel-history branch has one in scope — emit the non-secret thread
 * coordinates `channelId` + `threadTs` (the message's own `ts` IS its thread key) so the
 * generated `MessageRow`'s "N replies" affordance can drill into the native thread view.
 * Omitted entirely when no `channelId` (search rows): a row without coordinates degrades
 * to the non-interactive label. NEVER carries a token/secret (FR-019).
 */
export function slackMessageRow(
  message: SlackMessage,
  channelId?: string
): Record<string, unknown> {
  return {
    ts: message.ts,
    userId: message.userId,
    ...(message.userName ? { userName: message.userName } : {}),
    text: message.text,
    ...(typeof message.replyCount === 'number' ? { replyCount: message.replyCount } : {}),
    // slack-rich-message-render-v1 (FR-006/FR-009): carry the per-message custom-emoji ref
    // map + image attachment refs so the generated row renders identically to the native one.
    ...(message.customEmoji ? { customEmoji: message.customEmoji } : {}),
    ...(message.images && message.images.length > 0 ? { images: message.images } : {}),
    ...(channelId ? { channelId, threadTs: message.ts } : {})
  }
}

/**
 * Map one search match to the bound row shape `SearchResultList`/`SearchResultRow` reads.
 *
 * slack-search-row-full-parity-v1: a search hit now carries the SAME render-bearing fields a
 * history row does so the generated search row maps to the canonical row identically — the
 * custom-emoji ref map, inline `images` (extracted main-side), AND the thread coordinate
 * `threadTs` (= the hit's own `ts`, since a message is its own thread root) so the generated row
 * is clickable to open its thread via the `channelId` + `threadTs` pair, exactly like a generated
 * history row. `replyCount` stays absent (search.messages omits reply_count) — the one documented
 * divergence (the "N replies" label simply does not render). NEVER carries a token/secret (FR-019).
 */
export function slackSearchRow(match: SlackSearchMatch): Record<string, unknown> {
  return {
    ts: match.ts,
    userId: match.userId,
    ...(match.userName ? { userName: match.userName } : {}),
    text: match.text,
    ...(match.customEmoji ? { customEmoji: match.customEmoji } : {}),
    ...(match.images && match.images.length > 0 ? { images: match.images } : {}),
    channelId: match.channelId,
    ...(match.channelName ? { channelName: match.channelName } : {}),
    ...(match.threadTs ? { threadTs: match.threadTs } : {})
  }
}

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
export function boundListSpec(
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
export function buildBoundChannelListSurface(page: SlackPage<SlackChannel>): SlackBoundSurface {
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
