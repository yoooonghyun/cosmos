import { describe, it, expect, vi } from 'vitest'
import {
  slackAdapterResolver,
  slackBindOptionsForSource,
  slackChannelRow,
  slackChannelsBindOptions,
  slackHistoryBindOptions,
  slackMessageRow,
  slackSearchBindOptions,
  slackSearchRow,
  SLACK_CHANNELS_PATH,
  SLACK_MATCHES_PATH,
  SLACK_MESSAGES_PATH,
  type SlackAdapterManager
} from './slackAdapter'
import { SlackAdapterSource } from '../../shared/types/slack'
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
} from '../../shared/types/slack'

/* slack-generative-adapter-v1 — the Slack-specific resolver + bind options (FR-005..FR-008).
 * Maps a secret-free descriptor to a SlackManager read, resolves author names in MAIN, and
 * normalizes the page into the panel-agnostic AdapterFetchResult. Pattern per FR: happy path;
 * missing optional (no nextCursor/userName → no error); recoverable failure (safe ok:false,
 * never throws); name-resolution fallback; secret-free. APPEND-ONLY: no prevCursor. */

const CHANNEL: SlackChannel = { id: 'C1', name: 'general', isMember: true }
const MESSAGE: SlackMessage = { ts: '1700000000.000100', userId: 'U1', text: 'hi' }
const MATCH: SlackSearchMatch = {
  ts: '1700000000.000200',
  userId: 'U2',
  text: 'found',
  channelId: 'C1'
}
const USER: SlackUser = { id: 'U1', displayName: 'Ada' }

function manager(over: Partial<SlackAdapterManager> = {}): SlackAdapterManager {
  return {
    listChannels: vi.fn(
      async (_p: SlackListChannelsParams): Promise<SlackResult<SlackPage<SlackChannel>>> => ({
        ok: true,
        data: { items: [CHANNEL] }
      })
    ),
    getHistory: vi.fn(
      async (_p: SlackHistoryParams): Promise<SlackResult<SlackPage<SlackMessage>>> => ({
        ok: true,
        data: { items: [MESSAGE] }
      })
    ),
    search: vi.fn(
      async (_p: SlackSearchParams): Promise<SlackResult<SlackPage<SlackSearchMatch>>> => ({
        ok: true,
        data: { items: [MATCH] }
      })
    ),
    getUser: vi.fn(
      async (_p: { userId: string }): Promise<SlackResult<SlackUser>> => ({ ok: true, data: USER })
    ),
    ...over
  }
}

describe('row mappers (non-secret bound-row shape parity)', () => {
  it('slackChannelRow maps id/name/isMember', () => {
    expect(slackChannelRow(CHANNEL)).toEqual({ id: 'C1', name: 'general', isMember: true })
  })

  it('slackMessageRow omits absent userName/replyCount (missing optional)', () => {
    expect(slackMessageRow(MESSAGE)).toEqual({ ts: MESSAGE.ts, userId: 'U1', text: 'hi' })
    expect(slackMessageRow({ ...MESSAGE, userName: 'Ada', replyCount: 2 })).toEqual({
      ts: MESSAGE.ts,
      userId: 'U1',
      userName: 'Ada',
      text: 'hi',
      replyCount: 2
    })
  })

  // slack-generative-message-parity-v1 (FR-005/FR-013): non-secret thread coordinates.
  it('slackMessageRow injects channelId + threadTs (== message.ts) when a channelId is supplied', () => {
    expect(slackMessageRow(MESSAGE, 'C1')).toEqual({
      ts: MESSAGE.ts,
      userId: 'U1',
      text: 'hi',
      channelId: 'C1',
      threadTs: MESSAGE.ts
    })
  })

  it('slackMessageRow omits both thread coordinates when no channelId is supplied (search rows)', () => {
    const row = slackMessageRow(MESSAGE)
    expect(row).not.toHaveProperty('channelId')
    expect(row).not.toHaveProperty('threadTs')
  })

  it('slackMessageRow omits the coordinates for a blank channelId (never an empty channelId)', () => {
    const row = slackMessageRow(MESSAGE, '')
    expect(row).not.toHaveProperty('channelId')
    expect(row).not.toHaveProperty('threadTs')
  })

  it('slackMessageRow carries no token/secret even with coordinates (FR-019)', () => {
    expect(JSON.stringify(slackMessageRow(MESSAGE, 'C1'))).not.toMatch(
      /Bearer|xoxb|xoxp|accessToken|refreshToken|token/i
    )
  })

  it('slackSearchRow omits absent userName/channelName/images/threadTs (missing optional)', () => {
    expect(slackSearchRow(MATCH)).toEqual({
      ts: MATCH.ts,
      userId: 'U2',
      text: 'found',
      channelId: 'C1'
    })
    expect(slackSearchRow({ ...MATCH, userName: 'Bo', channelName: 'general' })).toMatchObject({
      userName: 'Bo',
      channelName: 'general'
    })
  })

  // slack-search-row-full-parity-v1: a search hit now carries the SAME render-bearing fields a
  // history row does — inline images + the thread coordinate (threadTs = ts) so the generated
  // search row shows thumbnails AND is clickable to open its thread. replyCount stays absent.
  it('slackSearchRow carries images + threadTs when the match has them (full parity)', () => {
    const images = [{ ref: 'cosmos-slack-img://x', alt: 'pic' }]
    const row = slackSearchRow({ ...MATCH, images, threadTs: MATCH.ts })
    expect(row).toMatchObject({ images, threadTs: MATCH.ts, channelId: 'C1' })
    // The coords let the generated SearchResultRow build a thread-open context (channelId+threadTs).
    expect(row).toHaveProperty('threadTs', MATCH.ts)
  })

  it('slackSearchRow carries no token/secret even with coordinates/images (FR-019)', () => {
    const images = [{ ref: 'cosmos-slack-img://x' }]
    expect(
      JSON.stringify(slackSearchRow({ ...MATCH, images, threadTs: MATCH.ts }))
    ).not.toMatch(/Bearer|xoxb|xoxp|accessToken|refreshToken|token/i)
  })
})

describe('bind options (append-only — FR-010/FR-011)', () => {
  it('every Slack list binds its path with pagination:append (no replace, no prev)', () => {
    expect(slackChannelsBindOptions).toEqual({ listPath: SLACK_CHANNELS_PATH, pagination: 'append' })
    expect(slackHistoryBindOptions).toEqual({ listPath: SLACK_MESSAGES_PATH, pagination: 'append' })
    expect(slackSearchBindOptions).toEqual({ listPath: SLACK_MATCHES_PATH, pagination: 'append' })
  })

  it('slackBindOptionsForSource resolves each source; null for a non-Slack source (FR-015)', () => {
    expect(slackBindOptionsForSource(SlackAdapterSource.ListChannels)).toBe(slackChannelsBindOptions)
    expect(slackBindOptionsForSource(SlackAdapterSource.GetHistory)).toBe(slackHistoryBindOptions)
    expect(slackBindOptionsForSource(SlackAdapterSource.Search)).toBe(slackSearchBindOptions)
    expect(slackBindOptionsForSource('getReplies')).toBeNull()
    expect(slackBindOptionsForSource('bogus')).toBeNull()
  })
})

describe('slackAdapterResolver — listChannels (FR-005/FR-006)', () => {
  it('maps a channels descriptor to items + nextCursor (happy path)', async () => {
    const m = manager({
      listChannels: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackChannel>>> => ({
          ok: true,
          data: { items: [CHANNEL], nextCursor: 'c2' }
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.ListChannels,
      query: { cursor: 'c1' }
    })
    expect(out).toEqual({ ok: true, items: [slackChannelRow(CHANNEL)], nextCursor: 'c2' })
    expect(m.listChannels).toHaveBeenCalledWith({ cursor: 'c1' })
  })

  it('omits nextCursor when the page has none (missing optional → hasMore:false, no error)', async () => {
    const out = await slackAdapterResolver(manager())({
      dataSource: SlackAdapterSource.ListChannels,
      query: {}
    })
    expect(out).toEqual({ ok: true, items: [slackChannelRow(CHANNEL)] })
    expect(out.ok && 'nextCursor' in out).toBe(false)
    expect(out.ok && 'prevCursor' in out).toBe(false)
  })

  it('does NOT resolve user names for channels (no getUser call)', async () => {
    const m = manager()
    await slackAdapterResolver(m)({ dataSource: SlackAdapterSource.ListChannels, query: {} })
    expect(m.getUser).not.toHaveBeenCalled()
  })

  it('surfaces a recoverable failure as ok:false (never throws — FR-007)', async () => {
    const m = manager({
      listChannels: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackChannel>>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'Reconnect.'
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.ListChannels,
      query: {}
    })
    expect(out).toEqual({ ok: false, kind: 'reconnect_needed', message: 'Reconnect.' })
  })
})

describe('slackAdapterResolver — getHistory (FR-006/FR-008 name resolution)', () => {
  it('passes the channelId + cursor and resolves the author name in main (happy path)', async () => {
    const m = manager({
      getHistory: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackMessage>>> => ({
          ok: true,
          data: { items: [MESSAGE], nextCursor: 'h2' }
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1', cursor: 'h1' }
    })
    expect(m.getHistory).toHaveBeenCalledWith({ channelId: 'C1', cursor: 'h1' })
    expect(m.getUser).toHaveBeenCalledWith({ userId: 'U1' })
    // slack-generative-message-parity-v1 (FR-013): history rows carry the thread coords.
    expect(out).toEqual({
      ok: true,
      items: [slackMessageRow({ ...MESSAGE, userName: 'Ada' }, 'C1')],
      nextCursor: 'h2'
    })
  })

  // slack-generative-message-parity-v1 (FR-013): the getHistory branch threads the
  // descriptor's (non-secret) channelId into every row so the reply drill-in works.
  it('injects channelId + threadTs (== ts) into each history row (FR-013)', async () => {
    const out = await slackAdapterResolver(manager())({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1' }
    })
    expect(out.ok).toBe(true)
    const items = (out.ok ? out.items : []) ?? []
    expect(items[0]).toMatchObject({ channelId: 'C1', threadTs: MESSAGE.ts })
  })

  it('falls back to the raw userId when getUser fails (FR-008, never blocks/throws)', async () => {
    const m = manager({
      getUser: vi.fn(async (): Promise<SlackResult<SlackUser>> => {
        throw new Error('boom')
      })
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1' }
    })
    expect(out).toEqual({ ok: true, items: [slackMessageRow({ ...MESSAGE, userName: 'U1' }, 'C1')] })
  })

  it('keeps an already-present userName without a lookup (no getUser call)', async () => {
    const named: SlackMessage = { ...MESSAGE, userName: 'Pre' }
    const m = manager({
      getHistory: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackMessage>>> => ({ ok: true, data: { items: [named] } })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1' }
    })
    expect(m.getUser).not.toHaveBeenCalled()
    expect(out).toEqual({ ok: true, items: [slackMessageRow(named, 'C1')] })
  })

  it('surfaces a recoverable failure as ok:false (FR-007)', async () => {
    const m = manager({
      getHistory: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackMessage>>> => ({
          ok: false,
          kind: 'rate_limited',
          message: 'Busy.'
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1' }
    })
    expect(out).toEqual({ ok: false, kind: 'rate_limited', message: 'Busy.' })
  })
})

describe('slackAdapterResolver — search (FR-006)', () => {
  it('passes the query + cursor and resolves names (happy path)', async () => {
    const m = manager({
      search: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackSearchMatch>>> => ({
          ok: true,
          data: { items: [MATCH], nextCursor: '2' }
        })
      ),
      getUser: vi.fn(
        async (): Promise<SlackResult<SlackUser>> => ({ ok: true, data: { id: 'U2', displayName: 'Bo' } })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.Search,
      query: { query: 'hello', cursor: '1' }
    })
    expect(m.search).toHaveBeenCalledWith({ query: 'hello', cursor: '1' })
    expect(out).toEqual({
      ok: true,
      items: [slackSearchRow({ ...MATCH, userName: 'Bo' })],
      nextCursor: '2'
    })
  })

  // slack-search-row-full-parity-v1 (supersedes the old "search rows must NOT gain thread coords"):
  // the resolver passes the match's own fields through `slackSearchRow`, so a match that carries
  // images + threadTs (main extracts them now) yields a row with them — the generated search row
  // then shows thumbnails AND is clickable to open its thread, exactly like a history row.
  it('passes through images + threadTs from the match (full parity, FR-013)', async () => {
    const images = [{ ref: 'cosmos-slack-img://x' }]
    const m = manager({
      search: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackSearchMatch>>> => ({
          ok: true,
          data: { items: [{ ...MATCH, userName: 'Bo', images, threadTs: MATCH.ts }] }
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.Search,
      query: { query: 'hello' }
    })
    expect(out.ok).toBe(true)
    const items = (out.ok ? out.items : []) ?? []
    expect(items[0]).toMatchObject({ images, threadTs: MATCH.ts, channelId: 'C1' })
  })

  it('a match WITHOUT thread coords yields a non-interactive row (graceful — no threadTs)', async () => {
    const out = await slackAdapterResolver(manager())({
      dataSource: SlackAdapterSource.Search,
      query: { query: 'hello' }
    })
    expect(out.ok).toBe(true)
    const items = (out.ok ? out.items : []) ?? []
    // The default MATCH fixture has no threadTs, so the row stays non-interactive (degrades safely).
    expect(items[0]).not.toHaveProperty('threadTs')
  })

  it('surfaces search_unavailable as a recoverable notice (FR-007)', async () => {
    const m = manager({
      search: vi.fn(
        async (): Promise<SlackResult<SlackPage<SlackSearchMatch>>> => ({
          ok: false,
          kind: 'search_unavailable',
          message: 'Search not available.'
        })
      )
    })
    const out = await slackAdapterResolver(m)({
      dataSource: SlackAdapterSource.Search,
      query: { query: 'x' }
    })
    expect(out).toEqual({ ok: false, kind: 'search_unavailable', message: 'Search not available.' })
  })
})

describe('slackAdapterResolver — unknown source + secret-free (FR-007/FR-018)', () => {
  it('returns a recoverable notice for an unknown dataSource (never crash)', async () => {
    const out = await slackAdapterResolver(manager())({ dataSource: 'getReplies', query: {} })
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ kind: 'network' })
  })

  it('carries no token/secret in the normalized result (FR-018)', async () => {
    const out = await slackAdapterResolver(manager())({
      dataSource: SlackAdapterSource.GetHistory,
      query: { channelId: 'C1' }
    })
    expect(JSON.stringify(out)).not.toMatch(/Bearer|xoxb|xoxp|accessToken|refreshToken|token/i)
  })
})
