import { describe, it, expect } from 'vitest'
import {
  compareTs,
  mapSlackError,
  SlackClient,
  sortMessagesByTs,
  type FetchLike,
  type SlackHttpResponse
} from './slackClient'

describe('mapSlackError (FR-026, SC-005, SC-007, SC-009)', () => {
  it('maps HTTP 429 to rate_limited and honors Retry-After (FR-026)', () => {
    const e = mapSlackError(429, undefined, 30, false)
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAfterSeconds).toBe(30)
    expect(e.message).toMatch(/busy/i)
  })

  it('maps invalid_auth / token_revoked / token_expired to reconnect_needed (SC-007)', () => {
    for (const err of ['invalid_auth', 'token_revoked', 'token_expired']) {
      expect(mapSlackError(200, err, undefined, false).kind).toBe('reconnect_needed')
    }
  })

  it('maps a missing search scope on a SEARCH call to search_unavailable (FR-015)', () => {
    expect(mapSlackError(200, 'missing_scope', undefined, true).kind).toBe('search_unavailable')
    expect(mapSlackError(200, 'not_allowed_token_type', undefined, true).kind).toBe(
      'search_unavailable'
    )
  })

  it('does NOT mark a non-search scope error as search_unavailable', () => {
    expect(mapSlackError(200, 'missing_scope', undefined, false).kind).toBe('network')
  })

  it('maps an unknown Slack error and a bare HTTP error to network (recoverable)', () => {
    expect(mapSlackError(200, 'something_weird', undefined, false).kind).toBe('network')
    expect(mapSlackError(500, undefined, undefined, false).kind).toBe('network')
  })
})

function res(body: unknown, status = 200, retryAfter?: string): SlackHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    json: async () => body
  }
}

const auth = { token: 'xoxb-test' }

describe('SlackClient.authTest (FR-001 — validate a pasted token)', () => {
  it('maps team_id/team/user_id to teamId/teamName/userId on ok', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ ok: true, team_id: 'T9', team: 'Globex', user_id: 'U9' })
    const client = new SlackClient({ fetchImpl })
    const result = await client.authTest(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ teamId: 'T9', teamName: 'Globex', userId: 'U9' })
    }
  })

  it('returns the mapped SlackError on a rejected token (FR-026)', async () => {
    const fetchImpl: FetchLike = async () => res({ ok: false, error: 'invalid_auth' })
    const client = new SlackClient({ fetchImpl })
    const result = await client.authTest(auth)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })
})

describe('SlackClient reads (FR-013, FR-014, FR-026)', () => {
  it('listChannels maps channels and threads next_cursor (FR-013 pagination)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_member: true },
          { id: 'C2', name: 'random', is_member: false }
        ],
        response_metadata: { next_cursor: 'CUR2' }
      })
    const client = new SlackClient({ fetchImpl })
    const result = await client.listChannels(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([
        { id: 'C1', name: 'general', isMember: true },
        { id: 'C2', name: 'random', isMember: false }
      ])
      expect(result.data.nextCursor).toBe('CUR2')
    }
  })

  it('listChannels omits nextCursor when next_cursor is empty (list simply ends)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ ok: true, channels: [], response_metadata: { next_cursor: '' } })
    const result = await new SlackClient({ fetchImpl }).listChannels(auth)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nextCursor).toBeUndefined()
    }
  })

  it('getHistory maps messages with replyCount', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        ok: true,
        messages: [
          { ts: '1.1', user: 'U1', text: 'hi', reply_count: 2 },
          { ts: '1.2', user: 'U2', text: 'yo' }
        ]
      })
    const result = await new SlackClient({ fetchImpl }).getHistory(auth, 'C1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items[0]).toEqual({ ts: '1.1', userId: 'U1', text: 'hi', replyCount: 2 })
      expect(result.data.items[1]).toEqual({ ts: '1.2', userId: 'U2', text: 'yo' })
    }
  })

  it('returns a typed rate_limited error on HTTP 429 honoring Retry-After (FR-026)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 429, '12')
    const result = await new SlackClient({ fetchImpl }).getHistory(auth, 'C1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBe(12)
    }
  })

  it('returns reconnect_needed when Slack rejects the token (SC-007)', async () => {
    const fetchImpl: FetchLike = async () => res({ ok: false, error: 'token_revoked' })
    const result = await new SlackClient({ fetchImpl }).listChannels(auth)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('returns a network error (never throws) when fetch rejects (SC-009)', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await new SlackClient({ fetchImpl }).listChannels(auth)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('search maps matches + channel context and exposes a next page cursor (FR-015)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        ok: true,
        messages: {
          matches: [
            { ts: '9.9', user: 'U7', text: 'found it', channel: { id: 'C3', name: 'eng' } }
          ],
          paging: { page: 1, pages: 3 }
        }
      })
    const result = await new SlackClient({ fetchImpl }).search({ token: 'xoxp-user' }, 'hello')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items[0]).toEqual({
        ts: '9.9',
        userId: 'U7',
        text: 'found it',
        channelId: 'C3',
        channelName: 'eng'
      })
      expect(result.data.nextCursor).toBe('2')
    }
  })

  // slack-thread-open-in-slack-v1: getReplies additionally resolves the thread root's canonical
  // "Open in Slack" permalink via chat.getPermalink and carries it on the page. A URL-routed
  // fetch mock answers BOTH calls (conversations.replies + chat.getPermalink).
  it('getReplies carries the thread permalink from chat.getPermalink (happy path)', async () => {
    const permalink = 'https://acme.slack.com/archives/C1/p1700000000000100'
    const fetchImpl: FetchLike = async (input) => {
      if (input.includes('chat.getPermalink')) {
        return res({ ok: true, permalink })
      }
      return res({ ok: true, messages: [{ ts: '1700000000.000100', user: 'U1', text: 'root' }] })
    }
    const result = await new SlackClient({ fetchImpl }).getReplies(auth, 'C1', '1700000000.000100')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.permalink).toBe(permalink)
    }
  })

  it('getReplies omits the permalink when chat.getPermalink fails (degrade-to-omit, no crash)', async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input.includes('chat.getPermalink')) {
        return res({ ok: false, error: 'message_not_found' })
      }
      return res({ ok: true, messages: [{ ts: '1700000000.000100', user: 'U1', text: 'root' }] })
    }
    const result = await new SlackClient({ fetchImpl }).getReplies(auth, 'C1', '1700000000.000100')
    // The replies read still SUCCEEDS — a permalink failure never fails the thread read.
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.permalink).toBeUndefined()
      expect(result.data.items).toHaveLength(1)
    }
  })

  it('getReplies does not re-resolve the permalink on a paginated (cursor) page', async () => {
    let permalinkCalls = 0
    const fetchImpl: FetchLike = async (input) => {
      if (input.includes('chat.getPermalink')) {
        permalinkCalls += 1
        return res({ ok: true, permalink: 'https://acme.slack.com/archives/C1/p1' })
      }
      return res({ ok: true, messages: [] })
    }
    await new SlackClient({ fetchImpl }).getReplies(auth, 'C1', '1700000000.000100', 'CUR')
    expect(permalinkCalls).toBe(0)
  })

  it('getReplies drops a non-http(s) permalink (openable-url guard)', async () => {
    const fetchImpl: FetchLike = async (input) => {
      if (input.includes('chat.getPermalink')) {
        return res({ ok: true, permalink: 'slack://channel?team=T1&id=C1' })
      }
      return res({ ok: true, messages: [{ ts: '1700000000.000100', user: 'U1', text: 'root' }] })
    }
    const result = await new SlackClient({ fetchImpl }).getReplies(auth, 'C1', '1700000000.000100')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.permalink).toBeUndefined()
    }
  })

  it('search maps a missing-scope error to search_unavailable (FR-015)', async () => {
    const fetchImpl: FetchLike = async () => res({ ok: false, error: 'missing_scope' })
    const result = await new SlackClient({ fetchImpl }).search({ token: 'xoxp' }, 'q')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('search_unavailable')
    }
  })

  it('getUser resolves a display name (display_name > real_name > name > id)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ ok: true, user: { name: 'fallback', profile: { display_name: 'Ada L.' } } })
    const result = await new SlackClient({ fetchImpl }).getUser(auth, 'U1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: 'U1', displayName: 'Ada L.' })
    }
  })

  it('getUser falls back to the raw id when no name resolves (FR-014)', async () => {
    const fetchImpl: FetchLike = async () => res({ ok: true, user: {} })
    const result = await new SlackClient({ fetchImpl }).getUser(auth, 'U9')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.displayName).toBe('U9')
    }
  })
})

describe('message ordering (slack-thread-order-and-empty-reply-v1, Bug 1)', () => {
  it('compareTs orders epoch ts NUMERICALLY, not lexically (unequal-length integer parts)', () => {
    // Lexical compare would put "999.9" AFTER "1000.0" (because '9' > '1'); numeric does not.
    expect(compareTs('999.900000', '1000.000000')).toBeLessThan(0)
    // Microsecond suffix tiebreaks two same-second messages.
    expect(compareTs('1718900000.012300', '1718900000.012301')).toBeLessThan(0)
    expect(compareTs(undefined, '1.0')).toBeLessThan(0)
  })

  it('sortMessagesByTs returns oldest→newest without mutating the input', () => {
    const input = [{ ts: '1718900000.000200' }, { ts: '1718900000.000100' }]
    const sorted = sortMessagesByTs(input)
    expect(sorted.map((m) => m.ts)).toEqual(['1718900000.000100', '1718900000.000200'])
    // input untouched (new array)
    expect(input.map((m) => m.ts)).toEqual(['1718900000.000200', '1718900000.000100'])
  })

  it('getHistory returns messages oldest→newest even when Slack returns them newest-first', async () => {
    // Slack's conversations.history returns NEWEST-first; the panel renders top-to-bottom, so
    // without normalization the channel shows newest-at-top (opposite of Slack). The fix sorts
    // ascending so the channel reads oldest→newest like Slack.
    const fetchImpl: FetchLike = async () =>
      res({
        ok: true,
        messages: [
          { ts: '1718900000.000300', user: 'U3', text: 'newest' },
          { ts: '1718900000.000200', user: 'U2', text: 'middle' },
          { ts: '1718900000.000100', user: 'U1', text: 'oldest' }
        ]
      })
    const result = await new SlackClient({ fetchImpl }).getHistory(auth, 'C1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.map((m) => m.text)).toEqual(['oldest', 'middle', 'newest'])
    }
  })

  it('getReplies returns the same oldest→newest order as the channel (parent first, then replies)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({
        ok: true,
        messages: [
          { ts: '1718900000.000100', user: 'U1', text: 'parent' },
          { ts: '1718900000.000300', user: 'U3', text: 'second reply' },
          { ts: '1718900000.000200', user: 'U2', text: 'first reply' }
        ]
      })
    const result = await new SlackClient({ fetchImpl }).getReplies(auth, 'C1', '1718900000.000100')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items.map((m) => m.text)).toEqual([
        'parent',
        'first reply',
        'second reply'
      ])
    }
  })
})

describe('SlackClient.postMessage (slack-send-message-v1, FR-006)', () => {
  /** Capture the (url, init) of the single outbound request. */
  function captureFetch(
    body: unknown,
    status = 200
  ): { fetchImpl: FetchLike; calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
    const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return res(body, status)
    }
    return { fetchImpl, calls }
  }

  it('POSTs chat.postMessage with the bearer token and a JSON body; returns ts (FR-006)', async () => {
    const { fetchImpl, calls } = captureFetch({ ok: true, ts: '1700000000.000200' })
    const result = await new SlackClient({ fetchImpl }).postMessage(
      { token: 'xoxp-user' },
      'C1',
      'hello world'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.ts).toBe('1700000000.000200')
    }
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toContain('/chat.postMessage')
    expect(init?.method).toBe('POST')
    expect(init?.headers?.authorization).toBe('Bearer xoxp-user')
    const sent = JSON.parse(init?.body ?? '{}')
    expect(sent).toEqual({ channel: 'C1', text: 'hello world' })
  })

  it('includes thread_ts in the body when threadTs is provided (FR-002)', async () => {
    const { fetchImpl, calls } = captureFetch({ ok: true, ts: '1.3' })
    await new SlackClient({ fetchImpl }).postMessage({ token: 'xoxp' }, 'C1', 'reply', '1.2')
    const sent = JSON.parse(calls[0].init?.body ?? '{}')
    expect(sent).toEqual({ channel: 'C1', text: 'reply', thread_ts: '1.2' })
  })

  it('maps a rejected token to reconnect_needed (SC-007)', async () => {
    const { fetchImpl } = captureFetch({ ok: false, error: 'token_revoked' })
    const result = await new SlackClient({ fetchImpl }).postMessage({ token: 'x' }, 'C1', 'hi')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('maps HTTP 429 to rate_limited honoring Retry-After (FR-026)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 429, '7')
    const result = await new SlackClient({ fetchImpl }).postMessage({ token: 'x' }, 'C1', 'hi')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('rate_limited')
      expect(result.retryAfterSeconds).toBe(7)
    }
  })

  it('returns a network error (never throws) when fetch rejects (SC-009)', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await new SlackClient({ fetchImpl }).postMessage({ token: 'x' }, 'C1', 'hi')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })
})
