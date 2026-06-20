/**
 * The single Slack Web API client (Slack integration v1). This is the ONLY place
 * Slack is called from (FR-008) — SlackManager is its sole caller.
 *
 * READ-ONLY (FR-019, SC-011): only the five read endpoints exist here. There is
 * NO method that posts/edits/deletes/reacts. Bearer-token auth (the token is
 * passed in per call by the manager — the client never stores or persists it).
 *
 * Every method returns a `SlackResult<T>`: a typed error mapper distinguishes
 * `reconnect_needed`, `search_unavailable`, `rate_limited` (honoring `Retry-After`),
 * and transient `network` errors so both surfaces degrade gracefully and the app
 * never crashes from a Slack failure (FR-026, SC-007, SC-009).
 */

import type {
  SlackChannel,
  SlackError,
  SlackImageRef,
  SlackMessage,
  SlackPage,
  SlackResult,
  SlackSearchMatch,
  SlackSendResult,
  SlackUser
} from '../../shared/slack'
import {
  decodeSlackText,
  extractEmojiShortcodes,
  extractMentionIds
} from './slackText'
import { extractImageRefs } from './slackImageExtract'
import { permalinkFromResponse } from './slackPermalink'
import type { EmojiListMap } from './slackEmojiList'

/** Minimal `fetch` shape (injectable; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<SlackHttpResponse>

export interface SlackHttpResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

const SLACK_API_BASE = 'https://slack.com/api'

/** Slack error strings that mean the token is no longer valid (FR-026). */
const RECONNECT_ERRORS = new Set([
  'invalid_auth',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'not_authed'
])

/** Slack error strings that mean the scope/token can't search (FR-015). */
const SEARCH_UNAVAILABLE_ERRORS = new Set([
  'missing_scope',
  'not_allowed_token_type',
  'no_permission'
])

function err(
  kind: SlackError['kind'],
  message: string,
  retryAfterSeconds?: number
): SlackError {
  return {
    ok: false,
    kind,
    message,
    ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {})
  }
}

/**
 * Map a raw Slack failure to a typed {@link SlackError} (pure; unit-tested).
 *
 * @param status     HTTP status (429 => rate_limited).
 * @param slackError Slack's `error` field from a `{ ok:false }` body, if any.
 * @param retryAfter parsed `Retry-After` seconds for a 429, if present.
 * @param forSearch  whether the call was a search (affects scope-error mapping).
 */
export function mapSlackError(
  status: number,
  slackError: string | undefined,
  retryAfter: number | undefined,
  forSearch: boolean
): SlackError {
  if (status === 429) {
    return err(
      'rate_limited',
      'Slack is busy — retrying shortly.',
      typeof retryAfter === 'number' ? retryAfter : undefined
    )
  }
  if (slackError && RECONNECT_ERRORS.has(slackError)) {
    return err('reconnect_needed', 'Your Slack connection expired. Reconnect to continue.')
  }
  if (forSearch && slackError && SEARCH_UNAVAILABLE_ERRORS.has(slackError)) {
    return err('search_unavailable', "Search isn't available for this connection.")
  }
  if (slackError && SEARCH_UNAVAILABLE_ERRORS.has(slackError)) {
    // A scope error on a non-search call still means the connection can't do this
    // read; surface it as a recoverable network-style error rather than crashing.
    return err('network', `Slack request failed: ${slackError}`)
  }
  if (slackError) {
    return err('network', `Slack request failed: ${slackError}`)
  }
  if (status >= 400) {
    return err('network', `Slack request failed (HTTP ${status}).`)
  }
  return err('network', 'Slack request failed.')
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export interface SlackClientDeps {
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Base API URL override for tests. */
  apiBase?: string
}

/** Per-call auth + cursor inputs threaded by SlackManager. */
export interface SlackCallAuth {
  /** The bearer token to attach (bot token for channel/user reads). */
  token: string
}

export class SlackClient {
  private readonly fetchImpl: FetchLike
  private readonly apiBase: string

  constructor(deps: SlackClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.apiBase = deps.apiBase ?? SLACK_API_BASE
  }

  /**
   * Issue one GET to a Slack `method`, returning either the parsed body (when
   * `{ ok:true }`) or a typed SlackError. Read-only — callers only pass read
   * methods. `forSearch` tunes scope-error mapping (FR-015).
   */
  private async call(
    method: string,
    token: string,
    query: Record<string, string>,
    forSearch = false
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: SlackError }> {
    const url = new URL(`${this.apiBase}/${method}`)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, v)
      }
    }
    let res: SlackHttpResponse
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      })
    } catch {
      // FR-026: a network error is recoverable, never a crash.
      return { ok: false, error: err('network', 'Could not reach Slack. Check your connection and retry.') }
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: mapSlackError(429, undefined, parseRetryAfter(res.headers.get('retry-after')), forSearch)
      }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: err('network', 'Slack returned an unreadable response.') }
    }
    if (!isRecord(body)) {
      return { ok: false, error: err('network', 'Slack returned an unexpected response.') }
    }
    if (body.ok === false) {
      const slackError = typeof body.error === 'string' ? body.error : undefined
      return { ok: false, error: mapSlackError(res.status, slackError, undefined, forSearch) }
    }
    if (!res.ok) {
      return { ok: false, error: mapSlackError(res.status, undefined, undefined, forSearch) }
    }
    return { ok: true, body }
  }

  /**
   * Issue one POST to a Slack `method` with a JSON body (the client's only non-GET
   * path — slack-send-message-v1, FR-006). Mirrors {@link call}'s typed-error
   * handling so a write degrades exactly like a read (reconnect_needed / rate_limited
   * / network), never a crash. The bearer token is attached here and NEVER returned.
   */
  private async post(
    method: string,
    token: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: SlackError }> {
    let res: SlackHttpResponse
    try {
      res = await this.fetchImpl(`${this.apiBase}/${method}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      })
    } catch {
      // FR-014: a network error is recoverable, never a crash.
      return { ok: false, error: err('network', 'Could not reach Slack. Check your connection and retry.') }
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: mapSlackError(429, undefined, parseRetryAfter(res.headers.get('retry-after')), false)
      }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: err('network', 'Slack returned an unreadable response.') }
    }
    if (!isRecord(body)) {
      return { ok: false, error: err('network', 'Slack returned an unexpected response.') }
    }
    if (body.ok === false) {
      const slackError = typeof body.error === 'string' ? body.error : undefined
      return { ok: false, error: mapSlackError(res.status, slackError, undefined, false) }
    }
    if (!res.ok) {
      return { ok: false, error: mapSlackError(res.status, undefined, undefined, false) }
    }
    return { ok: true, body }
  }

  private nextCursor(body: Record<string, unknown>): string | undefined {
    const meta = body.response_metadata
    if (isRecord(meta) && typeof meta.next_cursor === 'string' && meta.next_cursor !== '') {
      return meta.next_cursor
    }
    return undefined
  }

  /**
   * Validate a token and fetch workspace identity (auth.test). Used by connect
   * to confirm a pasted bot token before persisting it (FR-001). Maps the body's
   * `team_id`/`team`/`user_id` to `teamId`/`teamName`/`userId`; on failure returns
   * the mapped SlackError like the other reads (FR-026).
   */
  async authTest(
    auth: SlackCallAuth
  ): Promise<SlackResult<{ teamId: string; teamName: string; userId: string }>> {
    const r = await this.call('auth.test', auth.token, {})
    if (!r.ok) {
      return r.error
    }
    return {
      ok: true,
      data: {
        teamId: String(r.body.team_id ?? ''),
        teamName: String(r.body.team ?? ''),
        userId: String(r.body.user_id ?? '')
      }
    }
  }

  /** List public channels (conversations.list, FR-013). */
  async listChannels(
    auth: SlackCallAuth,
    cursor?: string
  ): Promise<SlackResult<SlackPage<SlackChannel>>> {
    const r = await this.call('conversations.list', auth.token, {
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '100',
      ...(cursor ? { cursor } : {})
    })
    if (!r.ok) {
      return r.error
    }
    const raw = Array.isArray(r.body.channels) ? r.body.channels : []
    const items: SlackChannel[] = raw.filter(isRecord).map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      isMember: c.is_member === true
    }))
    return { ok: true, data: { items, ...(this.nextCursor(r.body) ? { nextCursor: this.nextCursor(r.body) } : {}) } }
  }

  /** Read a channel's recent history (conversations.history, FR-013). */
  async getHistory(
    auth: SlackCallAuth,
    channelId: string,
    cursor?: string,
    resolvers: MessageResolvers = {}
  ): Promise<SlackResult<SlackPage<SlackMessage>>> {
    const r = await this.call('conversations.history', auth.token, {
      channel: channelId,
      limit: '50',
      ...(cursor ? { cursor } : {})
    })
    if (!r.ok) {
      return r.error
    }
    return {
      ok: true,
      data: {
        items: await toMessages(r.body.messages, resolvers),
        ...(this.nextCursor(r.body) ? { nextCursor: this.nextCursor(r.body) } : {})
      }
    }
  }

  /** Read a thread's replies (conversations.replies, FR-013). */
  async getReplies(
    auth: SlackCallAuth,
    channelId: string,
    threadTs: string,
    cursor?: string,
    resolvers: MessageResolvers = {}
  ): Promise<SlackResult<SlackPage<SlackMessage>>> {
    const r = await this.call('conversations.replies', auth.token, {
      channel: channelId,
      ts: threadTs,
      limit: '50',
      ...(cursor ? { cursor } : {})
    })
    if (!r.ok) {
      return r.error
    }
    // slack-thread-open-in-slack-v1: resolve the thread root's canonical "Open in Slack"
    // permalink from Slack's OWN chat.getPermalink API (never hand-built). Only the FIRST
    // page carries it (no cursor) — the dock header is fixed; later pages need not re-resolve.
    // A failed/absent permalink degrades to omit (no icon) and NEVER fails the replies read.
    const permalink = cursor ? undefined : await this.getPermalink(auth, channelId, threadTs)
    return {
      ok: true,
      data: {
        items: await toMessages(r.body.messages, resolvers),
        ...(this.nextCursor(r.body) ? { nextCursor: this.nextCursor(r.body) } : {}),
        ...(permalink ? { permalink } : {})
      }
    }
  }

  /**
   * Resolve a message's canonical web permalink via chat.getPermalink (args: `channel` +
   * `message_ts`) — the authoritative URL Slack's own UI links to (slack-thread-open-in-slack-v1).
   * Read-only; needs no special scope beyond the connection's read grant. Returns the
   * `permalink` ONLY when it is an openable `http(s)` URL; any failure/non-openable value yields
   * `undefined` (degrade-to-omit). NEVER throws and NEVER returns a token.
   */
  private async getPermalink(
    auth: SlackCallAuth,
    channelId: string,
    messageTs: string
  ): Promise<string | undefined> {
    const r = await this.call('chat.getPermalink', auth.token, {
      channel: channelId,
      message_ts: messageTs
    })
    if (!r.ok) {
      return undefined
    }
    return permalinkFromResponse(r.body)
  }

  /**
   * Keyword search (search.messages, FR-015). Requires a user token; pass the
   * user token here (the manager decides which token to attach). Mentions + custom
   * emoji are resolved per-match via the same {@link MessageResolvers} as history so a
   * search row's body renders identically (slack-rich-message-render-v1, FR-012). Search
   * rows do NOT carry image attachments in v1.
   */
  async search(
    auth: SlackCallAuth,
    query: string,
    cursor?: string,
    resolvers: MessageResolvers = {}
  ): Promise<SlackResult<SlackPage<SlackSearchMatch>>> {
    const r = await this.call(
      'search.messages',
      auth.token,
      { query, count: '20', ...(cursor ? { page: cursor } : {}) },
      true
    )
    if (!r.ok) {
      return r.error
    }
    const messages = isRecord(r.body.messages) ? r.body.messages : {}
    const matchesRaw = Array.isArray((messages as Record<string, unknown>).matches)
      ? ((messages as Record<string, unknown>).matches as unknown[])
      : []
    const items: SlackSearchMatch[] = await Promise.all(
      matchesRaw.filter(isRecord).map(async (m) => {
        const channel = isRecord(m.channel) ? m.channel : {}
        const rawText = m.text
        const idToName = await resolveMentionNames(rawText, resolvers.resolveUserName)
        const customEmoji = await resolveCustomEmoji(rawText, resolvers.resolveCustomEmojiRef)
        const customEmojiNames = new Set(Object.keys(customEmoji))
        return {
          ts: String(m.ts ?? ''),
          userId: String(m.user ?? ''),
          text: decodeSlackText(rawText, { idToName, customEmoji: customEmojiNames }),
          channelId: String((channel as Record<string, unknown>).id ?? ''),
          ...(typeof (channel as Record<string, unknown>).name === 'string'
            ? { channelName: String((channel as Record<string, unknown>).name) }
            : {}),
          ...(customEmojiNames.size > 0 ? { customEmoji } : {})
        }
      })
    )
    // search.messages paginates by page number; expose the next page as a cursor.
    const paging = isRecord((messages as Record<string, unknown>).paging)
      ? ((messages as Record<string, unknown>).paging as Record<string, unknown>)
      : {}
    const page = typeof paging.page === 'number' ? paging.page : undefined
    const pages = typeof paging.pages === 'number' ? paging.pages : undefined
    const nextCursor =
      page !== undefined && pages !== undefined && page < pages ? String(page + 1) : undefined
    return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }
  }

  /** Resolve a user id to a display name (users.info, FR-014). */
  async getUser(auth: SlackCallAuth, userId: string): Promise<SlackResult<SlackUser>> {
    const r = await this.call('users.info', auth.token, { user: userId })
    if (!r.ok) {
      return r.error
    }
    const user = isRecord(r.body.user) ? r.body.user : {}
    const profile = isRecord((user as Record<string, unknown>).profile)
      ? ((user as Record<string, unknown>).profile as Record<string, unknown>)
      : {}
    const displayName =
      (typeof profile.display_name === 'string' && profile.display_name) ||
      (typeof profile.real_name === 'string' && profile.real_name) ||
      (typeof (user as Record<string, unknown>).name === 'string' && (user as Record<string, unknown>).name) ||
      userId
    return { ok: true, data: { id: userId, displayName: String(displayName) } }
  }

  /**
   * List the workspace's custom emoji (emoji.list, slack-rich-message-render-v1 FR-006).
   * Requires the `emoji:read` scope; absent / any failure → a recoverable SlackError (the
   * custom-emoji resolver degrades to literal — FR-016, never fails a message read). The
   * returned map is `{ name: imageUrl | "alias:other" }`.
   */
  async getEmojiList(auth: SlackCallAuth): Promise<SlackResult<EmojiListMap>> {
    const r = await this.call('emoji.list', auth.token, {})
    if (!r.ok) {
      return r.error
    }
    const raw = isRecord(r.body.emoji) ? r.body.emoji : {}
    const map: EmojiListMap = {}
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        map[name] = value
      }
    }
    return { ok: true, data: map }
  }

  /**
   * Send a plain-text message (chat.postMessage — slack-send-message-v1, FR-006). The
   * ONLY write on the client. A present `threadTs` posts a thread reply (`thread_ts`);
   * absent posts a top-level channel message. Returns the posted message `ts` on
   * success, or a mapped {@link SlackError} (reconnect_needed / rate_limited / network).
   * The token is attached here and NEVER returned (SC-006).
   */
  async postMessage(
    auth: SlackCallAuth,
    channelId: string,
    text: string,
    threadTs?: string
  ): Promise<SlackResult<SlackSendResult>> {
    const r = await this.post('chat.postMessage', auth.token, {
      channel: channelId,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {})
    })
    if (!r.ok) {
      return r.error
    }
    return { ok: true, data: { ts: String(r.body.ts ?? '') } }
  }
}

/**
 * The async per-message rich-content resolvers threaded by SlackManager into the single
 * message-mapping point (slack-rich-message-render-v1, Tracks B/C). Both are CACHED in the
 * manager (each id/shortcode resolved once per session) and degrade-never-throw:
 *   - `resolveUserName(id)` → the user's display name, or the raw id on failure (FR-002/004).
 *   - `resolveCustomEmojiRef(shortcode)` → an opaque `cosmos-slack-img://` ref for a workspace
 *     custom emoji, or `null` (standard/unknown/`emoji:read` absent — FR-006/008/016).
 * When omitted, mentions fall back to raw ids and no custom emoji are resolved (the same safe
 * degraded behavior as before this feature).
 */
export interface MessageResolvers {
  resolveUserName?: (id: string) => Promise<string>
  resolveCustomEmojiRef?: (shortcode: string) => Promise<string | null>
}

/**
 * Map raw Slack message objects to SlackMessage DTOs (FR-013, FR-014; rich content
 * slack-rich-message-render-v1 FR-001/006/009). The SINGLE message-mapping point — history,
 * replies, and search all benefit. ASYNC because mention/custom-emoji resolution are batched
 * lookups (cached in the manager). Per message it: resolves unlabeled `<@U…>` ids → names,
 * resolves which `:shortcode:` are workspace custom emoji (→ a per-message ref map; the
 * marker stays literal in `text` for the renderer), decodes the text, and extracts image
 * attachment refs. Never throws (a failed lookup degrades to the raw id / literal / no image).
 */
export async function toMessages(
  raw: unknown,
  resolvers: MessageResolvers = {}
): Promise<SlackMessage[]> {
  if (!Array.isArray(raw)) {
    return []
  }
  const records = raw.filter(isRecord)
  const mapped = await Promise.all(records.map((m) => toMessage(m, resolvers)))
  // slack-thread-order-and-empty-reply-v1 (Bug 1): Slack's conversations.history returns
  // messages NEWEST-first while conversations.replies returns OLDEST-first, so without a
  // single sort the channel list and the thread view disagree on direction. Normalize BOTH
  // at this one mapping point to ascending chronological order (oldest → newest top-to-bottom)
  // — matching how Slack itself shows a channel (and a thread: parent first, then replies
  // oldest → newest). The compare is NUMERIC on the epoch `ts` (string compare misorders
  // unequal-length integer parts, e.g. "999.x" vs "1000.x").
  return sortMessagesByTs(mapped)
}

/**
 * Compare two Slack epoch `ts` strings ("seconds.micros", e.g. "1718900000.012300")
 * NUMERICALLY (slack-thread-order-and-empty-reply-v1, Bug 1). A lexical/string compare
 * misorders unequal-length integer parts ("999.9" would sort after "1000.0"); `Number()`
 * parses the whole fixed-point value so the microsecond suffix tiebreaks correctly. A
 * non-numeric/absent `ts` sorts as 0 (stable, never throws). Pure + total.
 */
export function compareTs(a: string | undefined, b: string | undefined): number {
  const na = Number(a)
  const nb = Number(b)
  const va = Number.isFinite(na) ? na : 0
  const vb = Number.isFinite(nb) ? nb : 0
  return va - vb
}

/**
 * Sort messages ascending by `ts` (oldest → newest) — the ONE canonical chronological
 * order both the channel history and the thread replies render in
 * (slack-thread-order-and-empty-reply-v1, Bug 1). Returns a NEW array (does not mutate the
 * input). Pure + total: an empty/odd list yields a safe sorted copy, never throws.
 */
export function sortMessagesByTs<T extends { ts?: string }>(messages: readonly T[]): T[] {
  return [...messages].sort((a, b) => compareTs(a.ts, b.ts))
}

/** Map one raw Slack message record to a {@link SlackMessage} (the per-message rich decode). */
async function toMessage(
  m: Record<string, unknown>,
  resolvers: MessageResolvers
): Promise<SlackMessage> {
  const rawText = m.text
  const idToName = await resolveMentionNames(rawText, resolvers.resolveUserName)
  const customEmoji = await resolveCustomEmoji(rawText, resolvers.resolveCustomEmojiRef)
  const customEmojiNames = new Set(Object.keys(customEmoji))
  const text = decodeSlackText(rawText, { idToName, customEmoji: customEmojiNames })
  const images = extractImageRefs(m)
  return {
    ts: String(m.ts ?? ''),
    userId: String(m.user ?? ''),
    text,
    ...(typeof m.reply_count === 'number' ? { replyCount: m.reply_count } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(customEmojiNames.size > 0 ? { customEmoji } : {})
  }
}

/** Batch-resolve the unlabeled mention ids in a raw text to a `{ id: name }` map (each id
 * looked up once via the cached resolver). Empty map when no resolver / no mentions. */
async function resolveMentionNames(
  rawText: unknown,
  resolveUserName?: (id: string) => Promise<string>
): Promise<Record<string, string>> {
  const idToName: Record<string, string> = {}
  if (!resolveUserName) {
    return idToName
  }
  const ids = extractMentionIds(rawText)
  await Promise.all(
    ids.map(async (id) => {
      try {
        idToName[id] = await resolveUserName(id)
      } catch {
        // FR-004: a failed lookup degrades to the raw id (decodeSlackText falls back).
      }
    })
  )
  return idToName
}

/** Resolve which `:shortcode:` in a raw text are workspace custom emoji → `{ name: ref }`.
 * Empty when no resolver / no custom matches. Each shortcode resolved once. */
async function resolveCustomEmoji(
  rawText: unknown,
  resolveCustomEmojiRef?: (shortcode: string) => Promise<string | null>
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  if (!resolveCustomEmojiRef) {
    return map
  }
  const names = extractEmojiShortcodes(rawText)
  await Promise.all(
    names.map(async (name) => {
      try {
        const ref = await resolveCustomEmojiRef(name)
        if (typeof ref === 'string' && ref !== '') {
          map[name] = ref
        }
      } catch {
        // FR-008/016: a failed resolve leaves the shortcode standard/literal.
      }
    })
  )
  return map
}

// Re-exported for the SlackImageRef type used by the extractor's signature.
export type { SlackImageRef }
