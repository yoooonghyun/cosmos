import { describe, it, expect } from 'vitest'
import { mapSlackError, SlackClient, type FetchLike, type SlackHttpResponse } from './slackClient'

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
