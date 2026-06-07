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
  SlackMessage,
  SlackPage,
  SlackResult,
  SlackSearchMatch,
  SlackUser
} from '../../shared/slack'

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
    cursor?: string
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
        items: toMessages(r.body.messages),
        ...(this.nextCursor(r.body) ? { nextCursor: this.nextCursor(r.body) } : {})
      }
    }
  }

  /** Read a thread's replies (conversations.replies, FR-013). */
  async getReplies(
    auth: SlackCallAuth,
    channelId: string,
    threadTs: string,
    cursor?: string
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
    return {
      ok: true,
      data: {
        items: toMessages(r.body.messages),
        ...(this.nextCursor(r.body) ? { nextCursor: this.nextCursor(r.body) } : {})
      }
    }
  }

  /**
   * Keyword search (search.messages, FR-015). Requires a user token; pass the
   * user token here (the manager decides which token to attach).
   */
  async search(
    auth: SlackCallAuth,
    query: string,
    cursor?: string
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
    const items: SlackSearchMatch[] = matchesRaw.filter(isRecord).map((m) => {
      const channel = isRecord(m.channel) ? m.channel : {}
      return {
        ts: String(m.ts ?? ''),
        userId: String(m.user ?? ''),
        text: String(m.text ?? ''),
        channelId: String((channel as Record<string, unknown>).id ?? ''),
        ...(typeof (channel as Record<string, unknown>).name === 'string'
          ? { channelName: String((channel as Record<string, unknown>).name) }
          : {})
      }
    })
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
}

/** Map raw Slack message objects to SlackMessage DTOs (FR-013, FR-014). */
function toMessages(raw: unknown): SlackMessage[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter(isRecord).map((m) => ({
    ts: String(m.ts ?? ''),
    userId: String(m.user ?? ''),
    text: String(m.text ?? ''),
    ...(typeof m.reply_count === 'number' ? { replyCount: m.reply_count } : {})
  }))
}
