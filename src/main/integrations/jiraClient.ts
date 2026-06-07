/**
 * The single Jira REST client (Atlassian integration v1). This is the ONLY place
 * Jira is called from (FR-A13) — JiraManager is its sole caller.
 *
 * Reads: JQL search and single-issue read (the issue read now also surfaces the
 * issue's available transitions — Jira generative-UI v1, D3). Writes (Jira
 * generative-UI v1, FR-011): `transitionIssue` and `addComment` — the FIRST
 * mutations here. Bearer-token auth (the token + cloudId are passed in per call by
 * the manager — the client never stores or persists them).
 *
 * Every method returns a `JiraResult<T>`: a pure error mapper distinguishes
 * `reconnect_needed` (401/403), `rate_limited` (429, honoring `Retry-After`), and
 * transient `network` errors so both surfaces degrade gracefully and the app never
 * crashes from a Jira failure (FR-X07, SC-007, SC-010).
 *
 * Endpoints (plan §B):
 *   search:  POST {base}/rest/api/3/search/jql      (nextPageToken / isLast)
 *   issue:   GET  {base}/rest/api/3/issue/{key}?fields=…,comment
 * where `base = https://api.atlassian.com/ex/jira/{cloudId}`.
 */

import type {
  JiraAddCommentResult,
  JiraComment,
  JiraCreateParams,
  JiraCreateResult,
  JiraError,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraStatusCategory,
  JiraTransition,
  JiraTransitionParams,
  JiraTransitionResult,
  JiraUpdateParams,
  JiraUpdateResult,
  JiraUserRef
} from '../../shared/jira'
import { jiraApiBase } from './atlassianConfig'
import { adfToPlainText, plainTextToAdf } from './atlassianText'

/** Minimal `fetch` shape (injectable; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<JiraHttpResponse>

export interface JiraHttpResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

function err(
  kind: JiraError['kind'],
  message: string,
  retryAfterSeconds?: number
): JiraError {
  return {
    ok: false,
    kind,
    message,
    ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {})
  }
}

/**
 * Map a raw Jira HTTP failure to a typed {@link JiraError} (pure; unit-tested).
 *   429        -> rate_limited (Retry-After honored)
 *   401 / 403  -> reconnect_needed (the manager flips connection state)
 *   else >=400 -> network (recoverable Retry)
 */
export function mapJiraError(status: number, retryAfter?: number): JiraError {
  if (status === 429) {
    return err(
      'rate_limited',
      'Atlassian is busy — retrying shortly.',
      typeof retryAfter === 'number' ? retryAfter : undefined
    )
  }
  if (status === 401 || status === 403) {
    return err('reconnect_needed', 'Your Jira connection expired. Reconnect to continue.')
  }
  return err('network', `Jira request failed (HTTP ${status}).`)
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

/** Per-call auth + targeting inputs threaded by JiraManager (never stored). */
export interface JiraCallAuth {
  /** The bearer access token to attach. */
  token: string
  /** The resolved site cloudId targeting every read (FR-A07). */
  cloudId: string
}

export interface JiraClientDeps {
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Base API URL override for tests (else derived from cloudId). */
  apiBase?: string
}

/** Map a raw Jira `statusCategory.key` to the normalized category (design §3.1, Q3). */
export function mapStatusCategory(key: unknown): JiraStatusCategory {
  switch (key) {
    case 'new':
      return 'todo'
    case 'indeterminate':
      return 'in_progress'
    case 'done':
      return 'done'
    default:
      return 'unknown'
  }
}

/** Map a raw Jira user object to a {@link JiraUserRef}, or undefined when absent. */
function toUserRef(raw: unknown): JiraUserRef | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const accountId =
    typeof raw.accountId === 'string' && raw.accountId !== '' ? raw.accountId : undefined
  if (!accountId) {
    return undefined
  }
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName !== '' ? raw.displayName : accountId
  return { accountId, displayName }
}

/**
 * Map one raw Jira transition object (from `GET /issue/{key}/transitions`) to a
 * {@link JiraTransition}, or undefined when it lacks the required id/name (D3).
 * Surfaces the destination status name/category when the API supplies `to`.
 */
function toTransition(raw: unknown): JiraTransition | undefined {
  if (!isRecord(raw)) {
    return undefined
  }
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined
  const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : undefined
  if (!id || !name) {
    return undefined
  }
  const to = isRecord(raw.to) ? raw.to : undefined
  const toStatusName = to && typeof to.name === 'string' && to.name !== '' ? to.name : undefined
  const toCat = to && isRecord(to.statusCategory) ? to.statusCategory : undefined
  const toStatusCategory = toCat ? mapStatusCategory(toCat.key) : undefined
  return {
    id,
    name,
    ...(toStatusName ? { toStatusName } : {}),
    ...(toStatusCategory ? { toStatusCategory } : {})
  }
}

/** Extract `{statusName, statusCategory}` from an issue's `fields.status`. */
function readStatus(fields: Record<string, unknown>): {
  statusName: string
  statusCategory: JiraStatusCategory
} {
  const status = isRecord(fields.status) ? fields.status : {}
  const statusName = typeof status.name === 'string' ? status.name : ''
  const cat = isRecord(status.statusCategory) ? status.statusCategory : {}
  return { statusName, statusCategory: mapStatusCategory(cat.key) }
}

export class JiraClient {
  private readonly fetchImpl: FetchLike
  private readonly apiBaseOverride?: string

  constructor(deps: JiraClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.apiBaseOverride = deps.apiBase
  }

  private base(cloudId: string): string {
    return this.apiBaseOverride ?? jiraApiBase(cloudId)
  }

  /**
   * Issue one request, returning the parsed JSON body (on 2xx) or a typed
   * JiraError. Read-only — callers only pass GET reads and the read-only
   * `search/jql` POST (a query, not a mutation).
   */
  private async call(
    url: string,
    token: string,
    init?: { method?: string; body?: string }
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: JiraError }> {
    let res: JiraHttpResponse
    try {
      res = await this.fetchImpl(url, {
        method: init?.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : {})
        },
        ...(init?.body ? { body: init.body } : {})
      })
    } catch {
      return {
        ok: false,
        error: err('network', 'Could not reach Atlassian. Check your connection and retry.')
      }
    }
    if (res.status === 429) {
      return { ok: false, error: mapJiraError(429, parseRetryAfter(res.headers.get('retry-after'))) }
    }
    if (!res.ok) {
      return { ok: false, error: mapJiraError(res.status) }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: err('network', 'Atlassian returned an unreadable response.') }
    }
    if (!isRecord(body)) {
      return { ok: false, error: err('network', 'Atlassian returned an unexpected response.') }
    }
    return { ok: true, body }
  }

  /**
   * Search issues by JQL (FR-J04). POST /rest/api/3/search/jql with cursor-based
   * pagination (`nextPageToken` / `isLast`). Maps each issue to a summary DTO.
   */
  async searchIssues(
    auth: JiraCallAuth,
    jql: string,
    cursor?: string
  ): Promise<JiraResult<JiraPage<JiraIssueSummary>>> {
    const url = `${this.base(auth.cloudId)}/rest/api/3/search/jql`
    const body = JSON.stringify({
      jql,
      maxResults: 50,
      fields: ['summary', 'status', 'assignee'],
      ...(cursor ? { nextPageToken: cursor } : {})
    })
    const r = await this.call(url, auth.token, { method: 'POST', body })
    if (!r.ok) {
      return r.error
    }
    const rawIssues = Array.isArray(r.body.issues) ? r.body.issues : []
    const items: JiraIssueSummary[] = rawIssues.filter(isRecord).map((issue) => {
      const fields = isRecord(issue.fields) ? issue.fields : {}
      const { statusName, statusCategory } = readStatus(fields)
      const assignee = toUserRef(fields.assignee)
      return {
        key: typeof issue.key === 'string' ? issue.key : '',
        summary: typeof fields.summary === 'string' ? fields.summary : '',
        statusName,
        statusCategory,
        ...(assignee ? { assignee } : {})
      }
    })
    // isLast===true OR a missing nextPageToken means no more pages.
    const isLast = r.body.isLast === true
    const nextCursor =
      !isLast && typeof r.body.nextPageToken === 'string' && r.body.nextPageToken !== ''
        ? r.body.nextPageToken
        : undefined
    return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }
  }

  /**
   * Read one issue's detail (FR-J04). GET /rest/api/3/issue/{key} requesting the
   * summary, status, assignee, reporter, description, and comments. Description and
   * comment bodies are flattened ADF -> plain text (design Q1).
   */
  async getIssue(auth: JiraCallAuth, issueKey: string): Promise<JiraResult<JiraIssueDetail>> {
    const url =
      `${this.base(auth.cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}` +
      `?fields=summary,status,assignee,reporter,description,comment`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const fields = isRecord(r.body.fields) ? r.body.fields : {}
    const { statusName, statusCategory } = readStatus(fields)
    const assignee = toUserRef(fields.assignee)
    const reporter = toUserRef(fields.reporter)
    const commentContainer = isRecord(fields.comment) ? fields.comment : {}
    const rawComments = Array.isArray(commentContainer.comments) ? commentContainer.comments : []
    const comments: JiraComment[] = rawComments.filter(isRecord).map((c) => {
      const author = toUserRef(c.author)
      return {
        id: typeof c.id === 'string' ? c.id : '',
        ...(author ? { author } : {}),
        body: adfToPlainText(c.body),
        ...(typeof c.created === 'string' ? { created: c.created } : {})
      }
    })
    // D3: surface the issue's available transitions so the composing agent / the
    // surface builder can offer a concrete `transitionId`. A failed/empty
    // transitions read MUST NOT fail the whole issue read (FR-020) — degrade to [].
    const availableTransitions = await this.readTransitions(auth, issueKey)
    return {
      ok: true,
      data: {
        key: typeof r.body.key === 'string' ? r.body.key : issueKey,
        summary: typeof fields.summary === 'string' ? fields.summary : '',
        statusName,
        statusCategory,
        ...(assignee ? { assignee } : {}),
        ...(reporter ? { reporter } : {}),
        description: adfToPlainText(fields.description),
        comments,
        availableTransitions
      }
    }
  }

  /**
   * Read an issue's available transitions (D3). GET /rest/api/3/issue/{key}/transitions
   * → `{ transitions: [...] }`. Best-effort: any failure (HTTP error, malformed
   * body) yields `[]` so the issue read still succeeds and a stale id is later a
   * write failure, never a crash (FR-020, FR-017).
   */
  private async readTransitions(
    auth: JiraCallAuth,
    issueKey: string
  ): Promise<JiraTransition[]> {
    const url =
      `${this.base(auth.cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return []
    }
    const raw = Array.isArray(r.body.transitions) ? r.body.transitions : []
    return raw
      .map(toTransition)
      .filter((t): t is JiraTransition => t !== undefined)
  }

  /**
   * Transition an issue to another status (FR-011). POST /rest/api/3/issue/{key}/
   * transitions with `{ transition: { id } }`. The endpoint returns 204 (no body) on
   * success; we surface the applied id. An invalid/stale id is a 400/404 mapped via
   * {@link mapJiraError} to `network` (surfaced as a recoverable failure — FR-017/020).
   */
  async transitionIssue(
    auth: JiraCallAuth,
    params: JiraTransitionParams
  ): Promise<JiraResult<JiraTransitionResult>> {
    const url =
      `${this.base(auth.cloudId)}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/transitions`
    const body = JSON.stringify({ transition: { id: params.transitionId } })
    const r = await this.callNoBody(url, auth.token, { method: 'POST', body })
    if (!r.ok) {
      return r.error
    }
    return { ok: true, data: { transitionId: params.transitionId } }
  }

  /**
   * Add a comment to an issue (FR-011). POST /rest/api/3/issue/{key}/comment with an
   * ADF `{ body }`. Returns the created comment (FR-J04 shape). Maps HTTP failures
   * through {@link mapJiraError} (FR-011).
   */
  async addComment(
    auth: JiraCallAuth,
    issueKey: string,
    body: string
  ): Promise<JiraResult<JiraAddCommentResult>> {
    const url =
      `${this.base(auth.cloudId)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`
    const payload = JSON.stringify({ body: plainTextToAdf(body) })
    const r = await this.call(url, auth.token, { method: 'POST', body: payload })
    if (!r.ok) {
      return r.error
    }
    const author = toUserRef(r.body.author)
    const comment: JiraComment = {
      id: typeof r.body.id === 'string' ? r.body.id : '',
      ...(author ? { author } : {}),
      body: adfToPlainText(r.body.body),
      ...(typeof r.body.created === 'string' ? { created: r.body.created } : {})
    }
    return { ok: true, data: comment }
  }

  /**
   * Create a new issue (Jira write-extend v1, FR-011). POST /rest/api/3/issue with
   * `fields: { project: { key }, issuetype: { name }, summary, description }`
   * (description wrapped via {@link plainTextToAdf}). The response carries the new
   * issue `key`, which the manager/dispatcher re-read for the post-create detail
   * (OQ1). A 400 (the project requires additional required fields beyond the minimal
   * four, or an unknown project/type) maps via {@link mapJiraError} to `network`,
   * surfaced as a recoverable failure — NO createmeta recovery (FR-002, FR-012).
   */
  async createIssue(
    auth: JiraCallAuth,
    params: JiraCreateParams
  ): Promise<JiraResult<JiraCreateResult>> {
    const url = `${this.base(auth.cloudId)}/rest/api/3/issue`
    const body = JSON.stringify({
      fields: {
        project: { key: params.projectKey },
        issuetype: { name: params.issueType },
        summary: params.summary,
        description: plainTextToAdf(params.description)
      }
    })
    const r = await this.call(url, auth.token, { method: 'POST', body })
    if (!r.ok) {
      return r.error
    }
    const key = typeof r.body.key === 'string' && r.body.key !== '' ? r.body.key : ''
    if (key === '') {
      return err('network', 'Jira created the issue but returned no key.')
    }
    return { ok: true, data: { key } }
  }

  /**
   * Update an existing issue's fields (Jira write-extend v1, FR-011). PUT
   * /rest/api/3/issue/{key} with a `fields` object carrying ONLY the changed editable
   * fields (the caller diffs surface-side; the manager re-validates non-empty). The
   * description, when present, is wrapped as ADF. The endpoint returns 204 (no body)
   * on success, so we use {@link callNoBody} and echo the edited key. A 404/403/400
   * (unknown/inaccessible key) maps via {@link mapJiraError} to a recoverable error
   * (FR-013).
   */
  async updateIssue(
    auth: JiraCallAuth,
    params: JiraUpdateParams
  ): Promise<JiraResult<JiraUpdateResult>> {
    const url =
      `${this.base(auth.cloudId)}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}`
    const fields: Record<string, unknown> = {}
    if (params.fields.summary !== undefined) {
      fields.summary = params.fields.summary
    }
    if (params.fields.description !== undefined) {
      fields.description = plainTextToAdf(params.fields.description)
    }
    if (params.fields.assignee !== undefined) {
      fields.assignee = { accountId: params.fields.assignee.accountId }
    }
    const body = JSON.stringify({ fields })
    const r = await this.callNoBody(url, auth.token, { method: 'PUT', body })
    if (!r.ok) {
      return r.error
    }
    return { ok: true, data: { issueKey: params.issueKey } }
  }

  /**
   * Issue a request that may return an empty body on success (e.g. a 204 from the
   * transitions POST). Mirrors {@link call}'s error mapping but does not require a
   * JSON body on 2xx. Read-bodyless writes only.
   */
  private async callNoBody(
    url: string,
    token: string,
    init: { method: string; body: string }
  ): Promise<{ ok: true } | { ok: false; error: JiraError }> {
    let res: JiraHttpResponse
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: init.body
      })
    } catch {
      return {
        ok: false,
        error: err('network', 'Could not reach Atlassian. Check your connection and retry.')
      }
    }
    if (res.status === 429) {
      return { ok: false, error: mapJiraError(429, parseRetryAfter(res.headers.get('retry-after'))) }
    }
    if (!res.ok) {
      return { ok: false, error: mapJiraError(res.status) }
    }
    return { ok: true }
  }
}
