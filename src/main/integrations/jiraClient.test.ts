import { describe, it, expect } from 'vitest'
import {
  JiraClient,
  mapJiraError,
  mapStatusCategory,
  type FetchLike,
  type JiraHttpResponse
} from './jiraClient'

describe('mapJiraError (FR-X07, SC-007, SC-010)', () => {
  it('maps HTTP 429 to rate_limited and honors Retry-After', () => {
    const e = mapJiraError(429, 30)
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAfterSeconds).toBe(30)
    expect(e.message).toMatch(/busy/i)
  })
  it('maps 401 / 403 to reconnect_needed (SC-007)', () => {
    expect(mapJiraError(401).kind).toBe('reconnect_needed')
    expect(mapJiraError(403).kind).toBe('reconnect_needed')
  })
  it('maps other HTTP errors to network (recoverable)', () => {
    expect(mapJiraError(500).kind).toBe('network')
  })
})

describe('mapStatusCategory (design §3.1, Q3)', () => {
  it('maps the statusCategory key to the normalized category', () => {
    expect(mapStatusCategory('new')).toBe('todo')
    expect(mapStatusCategory('indeterminate')).toBe('in_progress')
    expect(mapStatusCategory('done')).toBe('done')
  })
  it('falls back to unknown for an unrecognized/missing key', () => {
    expect(mapStatusCategory('weird')).toBe('unknown')
    expect(mapStatusCategory(undefined)).toBe('unknown')
  })
})

function res(body: unknown, status = 200, retryAfter?: string): JiraHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    json: async () => body
  }
}

const auth = { token: 'at-test', cloudId: 'cloud-1' }

describe('JiraClient.searchIssues (FR-J04)', () => {
  it('maps issues to summaries and exposes nextPageToken as the cursor', async () => {
    let capturedUrl = ''
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url
      capturedBody = init?.body
      return res({
        issues: [
          {
            key: 'ABC-1',
            fields: {
              summary: 'Fix the thing',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              assignee: { accountId: 'a1', displayName: 'Ada' }
            }
          }
        ],
        isLast: false,
        nextPageToken: 'PAGE2'
      })
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.searchIssues(auth, 'project = ABC')
    expect(capturedUrl).toContain('/rest/api/3/search/jql')
    expect(capturedBody).toContain('project = ABC')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([
        {
          key: 'ABC-1',
          summary: 'Fix the thing',
          statusName: 'In Progress',
          statusCategory: 'in_progress',
          assignee: { accountId: 'a1', displayName: 'Ada' }
        }
      ])
      expect(result.data.nextCursor).toBe('PAGE2')
    }
  })

  it('omits the cursor when isLast is true (no more pages)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ issues: [], isLast: true, nextPageToken: 'X' })
    const client = new JiraClient({ fetchImpl })
    const result = await client.searchIssues(auth, 'x')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nextCursor).toBeUndefined()
    }
  })

  it('returns reconnect_needed on a 401', async () => {
    const fetchImpl: FetchLike = async () => res({}, 401)
    const client = new JiraClient({ fetchImpl })
    const result = await client.searchIssues(auth, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })

  it('returns network on a thrown fetch (offline)', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.searchIssues(auth, 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })
})

describe('JiraClient.getIssue (FR-J04)', () => {
  it('maps detail incl. reporter, ADF description, and comments in order', async () => {
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toContain('/rest/api/3/issue/ABC-1')
      if (url.endsWith('/transitions')) {
        return res({ transitions: [] })
      }
      expect(url).toContain('comment')
      return res({
        key: 'ABC-1',
        fields: {
          summary: 'A title',
          status: { name: 'Done', statusCategory: { key: 'done' } },
          assignee: { accountId: 'a1', displayName: 'Ada' },
          reporter: { accountId: 'r1', displayName: 'Bob' },
          description: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Hello world.' }] }
            ]
          },
          comment: {
            comments: [
              {
                id: 'c1',
                author: { accountId: 'a2', displayName: 'Cy' },
                created: '2026-01-01T00:00:00.000Z',
                body: {
                  type: 'doc',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nice.' }] }]
                }
              }
            ]
          }
        }
      })
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(auth, 'ABC-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.key).toBe('ABC-1')
      expect(result.data.statusCategory).toBe('done')
      expect(result.data.reporter).toEqual({ accountId: 'r1', displayName: 'Bob' })
      expect(result.data.description).toBe('Hello world.')
      expect(result.data.comments).toEqual([
        {
          id: 'c1',
          author: { accountId: 'a2', displayName: 'Cy' },
          created: '2026-01-01T00:00:00.000Z',
          body: 'Nice.'
        }
      ])
      expect(result.data.availableTransitions).toEqual([])
    }
  })

  it('never attaches a token to the result (SC-009)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ key: 'ABC-1', fields: { summary: 's', status: {} } })
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(auth, 'ABC-1')
    expect(JSON.stringify(result)).not.toContain('at-test')
  })

  // jira-dock-autoapply-weblink-v1 (FR-010): when auth carries the non-secret siteUrl,
  // getIssue assembles `<siteUrl>/browse/<KEY>`; absent siteUrl → webUrl omitted (FR-011).
  it('sets webUrl from auth.siteUrl when present (FR-010)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ key: 'ABC-1', fields: { summary: 's', status: {} } })
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(
      { token: 'at-test', cloudId: 'cloud-1', siteUrl: 'https://acme.atlassian.net' },
      'ABC-1'
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.webUrl).toBe('https://acme.atlassian.net/browse/ABC-1')
    }
  })

  it('omits webUrl when auth.siteUrl is absent (FR-011)', async () => {
    const fetchImpl: FetchLike = async () =>
      res({ key: 'ABC-1', fields: { summary: 's', status: {} } })
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(auth, 'ABC-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.webUrl).toBeUndefined()
    }
  })

  it('surfaces availableTransitions from the transitions read (D3)', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/transitions')) {
        return res({
          transitions: [
            { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '31', name: 'Done', to: { name: 'Done', statusCategory: { key: 'done' } } },
            { id: '', name: 'bad' } // dropped: missing id
          ]
        })
      }
      return res({ key: 'ABC-1', fields: { summary: 's', status: {} } })
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(auth, 'ABC-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.availableTransitions).toEqual([
        { id: '11', name: 'Start Progress', toStatusName: 'In Progress', toStatusCategory: 'in_progress' },
        { id: '31', name: 'Done', toStatusName: 'Done', toStatusCategory: 'done' }
      ])
    }
  })

  it('degrades availableTransitions to [] when the transitions read fails (FR-020)', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/transitions')) {
        return res({}, 500)
      }
      return res({ key: 'ABC-1', fields: { summary: 's', status: {} } })
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.getIssue(auth, 'ABC-1')
    expect(result.ok).toBe(true) // a failed transitions read MUST NOT fail the issue read
    if (result.ok) {
      expect(result.data.availableTransitions).toEqual([])
    }
  })
})

describe('JiraClient.transitionIssue (FR-011, FR-020)', () => {
  it('POSTs the transitions endpoint with { transition: { id } } and returns ok on 204', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body
      return { ok: true, status: 204, headers: { get: () => null }, json: async () => ({}) }
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.transitionIssue(auth, { issueKey: 'ABC-1', transitionId: '31' })
    expect(capturedUrl).toContain('/rest/api/3/issue/ABC-1/transitions')
    expect(capturedMethod).toBe('POST')
    expect(capturedBody).toBe(JSON.stringify({ transition: { id: '31' } }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.transitionId).toBe('31')
    }
  })

  it('maps a stale/invalid transition (HTTP 400/404) to a recoverable network error (FR-017/020)', async () => {
    const fetchImpl: FetchLike = async () => res({}, 404)
    const client = new JiraClient({ fetchImpl })
    const result = await client.transitionIssue(auth, { issueKey: 'ABC-1', transitionId: '99' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('maps 401 → reconnect_needed and 429 → rate_limited (FR-011)', async () => {
    const c401 = new JiraClient({ fetchImpl: async () => res({}, 401) })
    const r401 = await c401.transitionIssue(auth, { issueKey: 'ABC-1', transitionId: '1' })
    expect(r401.ok).toBe(false)
    if (!r401.ok) expect(r401.kind).toBe('reconnect_needed')

    const c429 = new JiraClient({ fetchImpl: async () => res({}, 429, '12') })
    const r429 = await c429.transitionIssue(auth, { issueKey: 'ABC-1', transitionId: '1' })
    expect(r429.ok).toBe(false)
    if (!r429.ok) {
      expect(r429.kind).toBe('rate_limited')
      expect(r429.retryAfterSeconds).toBe(12)
    }
  })
})

describe('JiraClient.addComment (FR-011)', () => {
  it('POSTs the comment endpoint with a minimal ADF body and returns the new comment', async () => {
    let capturedUrl = ''
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url
      capturedBody = init?.body
      return res({
        id: 'c9',
        author: { accountId: 'a1', displayName: 'Ada' },
        created: '2026-02-02T00:00:00.000Z',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LGTM' }] }] }
      })
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.addComment(auth, 'ABC-1', 'LGTM')
    expect(capturedUrl).toContain('/rest/api/3/issue/ABC-1/comment')
    // body wrapped as ADF: { body: { type:'doc', version:1, content:[paragraph[text]] } }
    expect(capturedBody).toContain('"type":"doc"')
    expect(capturedBody).toContain('LGTM')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        id: 'c9',
        author: { accountId: 'a1', displayName: 'Ada' },
        created: '2026-02-02T00:00:00.000Z',
        body: 'LGTM'
      })
    }
  })

  it('maps an HTTP failure (403) through the error mapper (FR-011)', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({}, 403) })
    const result = await client.addComment(auth, 'ABC-1', 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
  })
})

describe('JiraClient.createIssue (Jira write-extend v1, FR-011, OQ1)', () => {
  it('POSTs /issue with the fixed minimal fields (ADF description) and returns the new key', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body
      return res({ id: '10042', key: 'ABC-42' }, 201)
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 'Wire it up',
      description: 'Details here.'
    })
    expect(capturedUrl).toContain('/rest/api/3/issue')
    expect(capturedMethod).toBe('POST')
    expect(capturedBody).toContain('"project":{"key":"ABC"}')
    expect(capturedBody).toContain('"issuetype":{"name":"Task"}')
    expect(capturedBody).toContain('Wire it up')
    // description wrapped as ADF
    expect(capturedBody).toContain('"type":"doc"')
    expect(capturedBody).toContain('Details here.')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ key: 'ABC-42' })
    }
  })

  // jira-create-parent-v1 (FR-002, SC-001) — optional fields.parent.
  it('includes fields.parent = { key } in the POST body when parentKey is set', async () => {
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body
      return res({ id: '10043', key: 'ABC-43' }, 201)
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Sub-task',
      summary: 'Nested',
      description: '',
      parentKey: 'ABC-1'
    })
    expect(capturedBody).toContain('"parent":{"key":"ABC-1"}')
    expect(result.ok).toBe(true)
  })

  it('OMITS the parent key entirely when parentKey is absent (byte-identical to today — FR-002)', async () => {
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body
      return res({ id: '10044', key: 'ABC-44' }, 201)
    }
    const client = new JiraClient({ fetchImpl })
    await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 'Top-level',
      description: ''
    })
    expect(capturedBody).not.toContain('parent')
    expect(JSON.parse(capturedBody ?? '{}').fields).not.toHaveProperty('parent')
  })

  it('returns a recoverable network error when the project needs extra required fields (HTTP 400 — FR-002, no createmeta)', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({ errors: { customfield_1: 'required' } }, 400) })
    const result = await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 's',
      description: ''
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('returns network when Jira created the issue but returned no key', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({ id: '1' }, 201) })
    const result = await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 's',
      description: ''
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('maps 401 → reconnect_needed and never attaches the token (SC-009)', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({}, 401) })
    const result = await client.createIssue(auth, {
      projectKey: 'ABC',
      issueType: 'Task',
      summary: 's',
      description: ''
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})

describe('JiraClient.updateIssue (Jira write-extend v1, FR-011)', () => {
  it('PUTs /issue/{key} with only the changed fields (ADF description) and echoes the key on 204', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url
      capturedMethod = init?.method ?? 'GET'
      capturedBody = init?.body
      return { ok: true, status: 204, headers: { get: () => null }, json: async () => ({}) }
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.updateIssue(auth, {
      issueKey: 'ABC-1',
      fields: { summary: 'New title', description: 'New body.' }
    })
    expect(capturedUrl).toContain('/rest/api/3/issue/ABC-1')
    expect(capturedMethod).toBe('PUT')
    expect(capturedBody).toContain('New title')
    expect(capturedBody).toContain('"type":"doc"')
    expect(capturedBody).toContain('New body.')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ issueKey: 'ABC-1' })
    }
  })

  it('carries an assignee accountId when present', async () => {
    let capturedBody: string | undefined
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = init?.body
      return { ok: true, status: 204, headers: { get: () => null }, json: async () => ({}) }
    }
    const client = new JiraClient({ fetchImpl })
    const result = await client.updateIssue(auth, {
      issueKey: 'ABC-1',
      fields: { assignee: { accountId: 'acc-9' } }
    })
    expect(capturedBody).toContain('"assignee":{"accountId":"acc-9"}')
    expect(result.ok).toBe(true)
  })

  it('maps an unknown/inaccessible key (HTTP 404) to a recoverable network error (FR-013)', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({}, 404) })
    const result = await client.updateIssue(auth, {
      issueKey: 'NOPE-1',
      fields: { summary: 'x' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
  })

  it('maps 403 → reconnect_needed and never attaches the token (SC-009)', async () => {
    const client = new JiraClient({ fetchImpl: async () => res({}, 403) })
    const result = await client.updateIssue(auth, {
      issueKey: 'ABC-1',
      fields: { summary: 'x' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('reconnect_needed')
    }
    expect(JSON.stringify(result)).not.toContain('at-test')
  })
})
