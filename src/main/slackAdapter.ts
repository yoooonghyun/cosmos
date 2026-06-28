/**
 * slackAdapter — the SLACK-SPECIFIC wiring for the shared generative adapter
 * (slack-generative-adapter-v1, FR-005/FR-006/FR-007/FR-008). Mirrors `jiraAdapter.ts`.
 * Two responsibilities, both pure of Electron so they are node-testable:
 *
 *  1. `slackAdapterResolver(manager)` — an {@link AdapterResolver} the shared
 *     {@link AdapterDispatcher} calls to re-execute a Slack descriptor. It maps the
 *     descriptor's `dataSource` (`listChannels`|`getHistory`|`search`) to the real
 *     SlackManager read (token stays in main — FR-018), resolves author display names
 *     via `getUser` (FR-008, mirroring the native panel's `resolveNames`), and
 *     normalizes the `SlackResult<SlackPage<…>>` into the panel-agnostic
 *     {@link AdapterFetchResult} (items + nextCursor, or an `ok:false` recoverable
 *     notice carrying `kind`/`message`). The shared layer never parses a Slack DTO —
 *     only this resolver does. It MUST NOT throw and MUST NOT leak a secret (FR-007).
 *
 *  2. The Slack BIND OPTIONS for each surface ({@link slackChannelsBindOptions} /
 *     {@link slackHistoryBindOptions} / {@link slackSearchBindOptions}) the dispatcher
 *     registers a surface with — the bound list path + `pagination: 'append'`. APPEND
 *     ONLY (FR-010/FR-011): Slack cursors are forward-only + opaque, so there is no
 *     page-replace and `hasPrev` is unused.
 *
 * READ-ONLY (FR-017): the manager subset is the three READS + `getUser`; no write.
 * `getReplies` is deliberately NOT mapped (held `slack-thread-replies-v1`).
 *
 * The bound-surface COMPOSITION (the `{path}`/initial-data-model surface specs) lives
 * in `slackSurfaceBuilder.ts`; this module owns only the read mapping + bind options.
 */

import type {
  AdapterFetchResult,
  AdapterRegisterOptions,
  AdapterResolver
} from './adapterDispatcher'
import type { AdapterDescriptor } from '../shared/types/adapter'
import { AdapterSourcePath } from '../shared/types/adapter'
import { SlackAdapterSource } from '../shared/types/slack'
import type {
  SlackChannel,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackMessage,
  SlackPage,
  SlackResult,
  SlackSearchMatch,
  SlackSearchParams,
  SlackUser
} from '../shared/types/slack'

/** The bound data-model path the channel-list reads its rows from. Single-sourced from the
 * shared {@link AdapterSourcePath} so the tool-description text + the dispatcher agree. */
export const SLACK_CHANNELS_PATH = AdapterSourcePath.listChannels
/** The bound data-model path the message-history reads its rows from (single-sourced). */
export const SLACK_MESSAGES_PATH = AdapterSourcePath.getHistory
/** The bound data-model path the search-results reads its rows from (single-sourced). */
export const SLACK_MATCHES_PATH = AdapterSourcePath.search

/** Bind options for a channel-LIST surface: append/load-more pagination (FR-010/FR-011). */
export const slackChannelsBindOptions: AdapterRegisterOptions = {
  listPath: SLACK_CHANNELS_PATH,
  pagination: 'append'
}
/** Bind options for a message-HISTORY surface: append/load-more pagination (FR-010/FR-011). */
export const slackHistoryBindOptions: AdapterRegisterOptions = {
  listPath: SLACK_MESSAGES_PATH,
  pagination: 'append'
}
/** Bind options for a SEARCH-results surface: append/load-more pagination (FR-010/FR-011). */
export const slackSearchBindOptions: AdapterRegisterOptions = {
  listPath: SLACK_MATCHES_PATH,
  pagination: 'append'
}

/**
 * Resolve the bind options a Slack descriptor's `dataSource` implies (FR-015). Used by
 * main's lazy re-registration on a restore/re-activation refresh so it never has to
 * special-case each source inline. Returns `null` for a non-Slack/unknown source.
 */
export function slackBindOptionsForSource(dataSource: string): AdapterRegisterOptions | null {
  switch (dataSource) {
    case SlackAdapterSource.ListChannels:
      return slackChannelsBindOptions
    case SlackAdapterSource.GetHistory:
      return slackHistoryBindOptions
    case SlackAdapterSource.Search:
      return slackSearchBindOptions
    default:
      return null
  }
}

/**
 * The SlackManager subset the resolver needs — the three list READS + `getUser` for
 * name resolution (never a write — FR-017). Matches the real SlackManager method shapes.
 */
export interface SlackAdapterManager {
  listChannels(params: SlackListChannelsParams): Promise<SlackResult<SlackPage<SlackChannel>>>
  getHistory(params: SlackHistoryParams): Promise<SlackResult<SlackPage<SlackMessage>>>
  search(params: SlackSearchParams): Promise<SlackResult<SlackPage<SlackSearchMatch>>>
  getUser(params: { userId: string }): Promise<SlackResult<SlackUser>>
}

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

/**
 * Resolve author display names for a page of rows via `getUser` (FR-008), mirroring the
 * native panel's `resolveNames`: every distinct `userId` missing a `userName` is looked
 * up ONCE (in main, token attached inside the manager); a failed lookup falls back to
 * the raw id (never blocks the view, never alters the non-secret row shape). Returns the
 * rows with `userName` filled. NEVER throws.
 */
async function resolveAuthorNames<T extends { userId: string; userName?: string }>(
  manager: SlackAdapterManager,
  rows: T[]
): Promise<T[]> {
  const cache = new Map<string, string>()
  const unknownIds = Array.from(
    new Set(rows.filter((r) => r.userId && !r.userName).map((r) => r.userId))
  )
  await Promise.all(
    unknownIds.map(async (id) => {
      try {
        const result = await manager.getUser({ userId: id })
        cache.set(id, result.ok ? result.data.displayName : id)
      } catch {
        // FR-008: a failed/odd lookup falls back to the raw id (never blocks/throws).
        cache.set(id, id)
      }
    })
  )
  return rows.map((r) =>
    r.userName ? r : ({ ...r, userName: cache.get(r.userId) ?? r.userId } as T)
  )
}

/**
 * Build the {@link AdapterResolver} for Slack. The dispatcher calls it with a descriptor
 * (the base query merged with the page cursor); this maps it to the SlackManager read,
 * resolves names, and normalizes the result. A `reconnect_needed`/`not_connected`/
 * `search_unavailable`/network/rate-limited failure is surfaced as a recoverable
 * `ok:false` notice (the dispatcher renders the message + clears loading, leaving prior
 * data intact — FR-007). Never throws. Secret-free result (FR-018).
 */
export function slackAdapterResolver(manager: SlackAdapterManager): AdapterResolver {
  return async (descriptor: AdapterDescriptor): Promise<AdapterFetchResult> => {
    if (descriptor.dataSource === SlackAdapterSource.ListChannels) {
      const params: SlackListChannelsParams = {
        ...(typeof descriptor.query.cursor === 'string' ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.listChannels(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      return {
        ok: true,
        items: result.data.items.map(slackChannelRow),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    if (descriptor.dataSource === SlackAdapterSource.GetHistory) {
      const channelId = typeof descriptor.query.channelId === 'string' ? descriptor.query.channelId : ''
      const params: SlackHistoryParams = {
        channelId,
        ...(typeof descriptor.query.cursor === 'string' ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.getHistory(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      // FR-008: resolve names in main so refreshed/appended rows carry the userName the
      // composed surface had (the row shape is unchanged — userName already in SlackMessage).
      const named = await resolveAuthorNames(manager, result.data.items)
      return {
        ok: true,
        // slack-generative-message-parity-v1 (FR-013): thread the (non-secret) channelId
        // through so each history row carries `channelId`/`threadTs` for the reply drill-in.
        items: named.map((m) => slackMessageRow(m, channelId)),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    if (descriptor.dataSource === SlackAdapterSource.Search) {
      const query = typeof descriptor.query.query === 'string' ? descriptor.query.query : ''
      const params: SlackSearchParams = {
        query,
        ...(typeof descriptor.query.cursor === 'string' ? { cursor: descriptor.query.cursor } : {})
      }
      const result = await manager.search(params)
      if (!result.ok) {
        return { ok: false, kind: result.kind, message: result.message }
      }
      const named = await resolveAuthorNames(manager, result.data.items)
      return {
        ok: true,
        items: named.map(slackSearchRow),
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {})
      }
    }

    // Unknown dataSource — recoverable, never a crash (FR-007).
    return { ok: false, kind: 'network', message: 'Unknown Slack data source.' }
  }
}
