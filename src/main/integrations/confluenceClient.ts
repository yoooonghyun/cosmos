/**
 * The single Confluence REST client (Atlassian integration v1). This is the ONLY
 * place Confluence is called from (FR-A13) — ConfluenceManager is its sole caller.
 *
 * Reads: CQL content search and single-page read. Write: a single page-create
 * (`createPage`) backing the `confluence_create_page` MCP tool — there is no edit or
 * delete. Bearer-token auth (the token + cloudId are passed in per call by the
 * manager — the client never stores or persists them).
 *
 * Every method returns a `ConfluenceResult<T>`: a pure error mapper distinguishes
 * `reconnect_needed` (401/403), `rate_limited` (429, honoring `Retry-After`), and
 * transient `network` errors so both surfaces degrade gracefully (FR-X07, SC-010).
 *
 * Endpoints (plan §C):
 *   search: GET {base}/wiki/rest/api/search?cql=…&cursor=…       (v1 CQL search)
 *   page:   GET {base}/wiki/api/v2/pages/{id}?body-format=view    (v2 page read)
 * where `base = https://api.atlassian.com/ex/confluence/{cloudId}`. The page read uses
 * v2 because the connection now requests GRANULAR scopes (`read:page:confluence`),
 * which authorize the v2 API; the classic content scopes are granted on a
 * granular-migrated app but 401 ("scope does not match") on the content endpoints. The
 * CQL search stays on v1 under `search:confluence` (still honored).
 */

import type {
  ConfluenceComment,
  ConfluenceCommentParams,
  ConfluenceCommentResult,
  ConfluenceCreateParams,
  ConfluenceCreateResult,
  ConfluenceError,
  ConfluenceGetCommentsParams,
  ConfluenceGetCommentsResult,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchResult,
  ConfluenceUpdateParams,
  ConfluenceUpdateResult
} from '../../shared/confluence'
import {
  CONFLUENCE_VERSION_CONFLICT_MESSAGE,
  decodeUnicodeEscapes
} from '../../shared/confluence'
import { confluenceApiBase } from './atlassianConfig'
import { confluenceWebUrl } from './confluenceWebUrl'
import { plainTextToStorage } from './atlassianText'

/** Minimal `fetch` shape (injectable; defaults to global fetch). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<ConfluenceHttpResponse>

export interface ConfluenceHttpResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

function err(
  kind: ConfluenceError['kind'],
  message: string,
  retryAfterSeconds?: number
): ConfluenceError {
  return {
    ok: false,
    kind,
    message,
    ...(typeof retryAfterSeconds === 'number' ? { retryAfterSeconds } : {})
  }
}

/**
 * Map a raw Confluence HTTP failure to a typed {@link ConfluenceError} (pure).
 *   429        -> rate_limited (Retry-After honored)
 *   401 / 403  -> reconnect_needed (the manager flips connection state)
 *   else >=400 -> network (recoverable Retry)
 */
export function mapConfluenceError(status: number, retryAfter?: number): ConfluenceError {
  if (status === 429) {
    return err(
      'rate_limited',
      'Atlassian is busy — retrying shortly.',
      typeof retryAfter === 'number' ? retryAfter : undefined
    )
  }
  if (status === 401 || status === 403) {
    return err('reconnect_needed', 'Your Confluence connection expired. Reconnect to continue.')
  }
  return err('network', `Confluence request failed (HTTP ${status}).`)
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

/**
 * Extract the raw `body-format=view` HTML from a v2 page response body
 * (confluence-detail-rich-render-v1, FR-005/FR-006). Reads `body.view.value` — the
 * Confluence server-rendered HTML — and returns it UNCHANGED (sanitization is the
 * renderer's job at the `dangerouslySetInnerHTML` site, FR-008). A missing/empty/
 * non-string `view.value` degrades to `''` (the safe "no readable body" state — FR-012).
 * Pure; never throws. Exported for the body-mapping unit test.
 */
export function pageViewBody(responseBody: unknown): string {
  if (!isRecord(responseBody)) {
    return ''
  }
  const body = isRecord(responseBody.body) ? responseBody.body : {}
  const view = isRecord(body.view) ? body.view : {}
  return typeof view.value === 'string' ? view.value : ''
}

/** Per-call auth + targeting inputs threaded by ConfluenceManager (never stored). */
export interface ConfluenceCallAuth {
  /** The bearer access token to attach. */
  token: string
  /** The resolved site cloudId targeting every read (FR-A07). */
  cloudId: string
  /**
   * The persisted site web ORIGIN from OAuth accessible-resources `siteUrl`
   * (e.g. `https://acme.atlassian.net`, bare origin, NO `/wiki`). Non-secret. Used ONLY
   * to assemble the user-facing page web URL (`getPage` → `confluenceWebUrl`); the single
   * v2 page `_links` carries no reliable `base`, so the browsable host comes from here.
   * Absent on legacy token sets that predate persisting `siteUrl` → the affordance omits.
   */
  siteUrl?: string
}

export interface ConfluenceClientDeps {
  /** Injectable fetch (defaults to global). */
  fetchImpl?: FetchLike
  /** Base API URL override for tests (else derived from cloudId). */
  apiBase?: string
}

/**
 * Pull the opaque `cursor` value out of a Confluence `_links.next` relative URL
 * (e.g. `/wiki/rest/api/search?cql=…&cursor=ABC123`). Returns undefined when there
 * is no next link, so the panel's "Load more" stops.
 */
export function cursorFromNextLink(next: unknown): string | undefined {
  if (typeof next !== 'string' || next === '') {
    return undefined
  }
  // The link is relative; parse it against a dummy origin to read the query.
  try {
    const u = new URL(next, 'https://x')
    const c = u.searchParams.get('cursor')
    return c && c !== '' ? c : undefined
  } catch {
    return undefined
  }
}

export class ConfluenceClient {
  private readonly fetchImpl: FetchLike
  private readonly apiBaseOverride?: string

  constructor(deps: ConfluenceClientDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.apiBaseOverride = deps.apiBase
  }

  private base(cloudId: string): string {
    return this.apiBaseOverride ?? confluenceApiBase(cloudId)
  }

  /**
   * Issue one request (default GET), returning the parsed JSON body (on 2xx) or a
   * typed ConfluenceError. The reads pass no `init` (GET); the page-create passes
   * `{ method: 'POST', body }`. The error mapping is identical for both.
   */
  private async call(
    url: string,
    token: string,
    init?: { method?: string; body?: string }
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: ConfluenceError }> {
    let res: ConfluenceHttpResponse
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
      return {
        ok: false,
        error: mapConfluenceError(429, parseRetryAfter(res.headers.get('retry-after')))
      }
    }
    if (!res.ok) {
      return { ok: false, error: mapConfluenceError(res.status) }
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
   * Search content by text (FR-C04). GET /wiki/rest/api/search with a CQL query
   * (`text ~ "query"`) and cursor pagination. Each hit maps to a search-result DTO
   * with a plain-text excerpt (highlight markup stripped — design Q2).
   */
  async searchContent(
    auth: ConfluenceCallAuth,
    query: string,
    cursor?: string
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> {
    const url = new URL(`${this.base(auth.cloudId)}/wiki/rest/api/search`)
    // CQL: a quoted text match scoped to pages. The query is escaped for the quotes.
    const cql = `text ~ "${query.replace(/"/g, '\\"')}" and type = page`
    url.searchParams.set('cql', cql)
    url.searchParams.set('limit', '25')
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }
    const r = await this.call(url.toString(), auth.token)
    if (!r.ok) {
      return r.error
    }
    return { ok: true, data: mapSearchResultsPage(r.body) }
  }

  /**
   * The default personal activity feed (confluence-default-feed v1, FR-001, FR-006).
   * GET /wiki/rest/api/search with the FIXED personal-scope CQL — pages the user
   * @mentions, watches, or favorited, most-recently-modified first — authorized by the
   * same `search:confluence` scope as text search. The CQL string lives ONLY here
   * (SC-008): the renderer/IPC payload carry only an optional cursor. Same hit-mapping
   * and cursor pagination as {@link searchContent}, returning the identical
   * `ConfluencePage<ConfluenceSearchResult>` DTO so the panel renders either source
   * unchanged.
   */
  async defaultFeed(
    auth: ConfluenceCallAuth,
    cursor?: string
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>> {
    const url = new URL(`${this.base(auth.cloudId)}/wiki/rest/api/search`)
    // Let `searchParams` URL-encode the CQL (do NOT hand-concatenate the query string).
    url.searchParams.set(
      'cql',
      '(mention = currentUser() or watcher = currentUser() or favourite = currentUser())' +
        ' and type = page order by lastmodified desc'
    )
    url.searchParams.set('limit', '25')
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }
    const r = await this.call(url.toString(), auth.token)
    if (!r.ok) {
      return r.error
    }
    return { ok: true, data: mapSearchResultsPage(r.body) }
  }

  /**
   * Read one page's detail (FR-C04; confluence-detail-rich-render-v1 FR-005/FR-006). GET
   * /wiki/api/v2/pages/{id}?body-format=view — the v2 read, authorized by the granular
   * `read:page:confluence` scope (the classic `read:confluence-content.all` scope is
   * deprecated and no longer honored by the content endpoints → 401 "scope does not
   * match"). The `view` body is Confluence SERVER-RENDERED HTML (macros expanded);
   * cosmos carries it RAW through `ConfluencePageDetail.body` and the renderer sanitizes
   * it with DOMPurify before display (sanitize is a renderer concern at the
   * `dangerouslySetInnerHTML` site — FR-008). No plain-text flattening here. v2 returns
   * only a numeric `spaceId`, surfaced as the space chip.
   */
  async getPage(
    auth: ConfluenceCallAuth,
    pageId: string
  ): Promise<ConfluenceResult<ConfluencePageDetail>> {
    const url =
      `${this.base(auth.cloudId)}/wiki/api/v2/pages/${encodeURIComponent(pageId)}` +
      `?body-format=view`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    // v2 returns only a numeric spaceId (no expanded space object); surface it as-is.
    const spaceId =
      typeof r.body.spaceId === 'string' && r.body.spaceId !== ''
        ? r.body.spaceId
        : typeof r.body.spaceId === 'number'
          ? String(r.body.spaceId)
          : undefined
    // confluence-detail-weblink-v1 (#87) / 404 fix (#100, deeper): enrich the canonical,
    // non-secret web URL from the persisted site web ORIGIN (`auth.siteUrl`) + the page's
    // `_links.webui`. The single v2 page `_links` (AbstractPageLinks: webui/editui/tinyui)
    // has NO reliable `base`, so the host comes from `siteUrl`, not `_links.base`.
    // Omit-when-absent (mirrors calendar #85 `htmlLink`) so the "Open in Confluence"
    // affordance degrades to nothing (FR-004/FR-008).
    const webUrl = confluenceWebUrl(auth.siteUrl, r.body._links)
    return {
      ok: true,
      data: {
        id: typeof r.body.id === 'string' ? r.body.id : String(r.body.id ?? pageId),
        title: decodeUnicodeEscapes(typeof r.body.title === 'string' ? r.body.title : ''),
        ...(spaceId ? { space: spaceId } : {}),
        body: pageViewBody(r.body),
        ...(webUrl ? { webUrl } : {})
      }
    }
  }

  /**
   * Create a new page (the single Confluence write). The v2 create needs a numeric
   * spaceId, but the user supplies a space KEY, so this first resolves the key via
   * `GET /wiki/api/v2/spaces?keys={spaceKey}` then POSTs to `/wiki/api/v2/pages` with
   * `{ spaceId, status: 'current', title, body: { representation: 'storage', value },
   * parentId? }`. The plain-text body is wrapped to storage XHTML via
   * {@link plainTextToStorage}. Returns the new page id + title. An unknown space, a
   * 4xx, or a network failure maps via {@link mapConfluenceError} to a recoverable
   * error (no crash). A scope-less token is short-circuited by the manager BEFORE this
   * is called.
   */
  async createPage(
    auth: ConfluenceCallAuth,
    params: ConfluenceCreateParams
  ): Promise<ConfluenceResult<ConfluenceCreateResult>> {
    const spacesUrl =
      `${this.base(auth.cloudId)}/wiki/api/v2/spaces` +
      `?keys=${encodeURIComponent(params.spaceKey)}&limit=1`
    const sr = await this.call(spacesUrl, auth.token)
    if (!sr.ok) {
      return sr.error
    }
    const spaces = Array.isArray(sr.body.results) ? sr.body.results : []
    const first = spaces.find(isRecord)
    const spaceId =
      first && typeof first.id === 'string'
        ? first.id
        : first && typeof first.id === 'number'
          ? String(first.id)
          : ''
    if (spaceId === '') {
      return err('network', `No Confluence space found for key "${params.spaceKey}".`)
    }
    const payload = JSON.stringify({
      spaceId,
      status: 'current',
      title: params.title,
      body: { representation: 'storage', value: plainTextToStorage(params.body) },
      ...(params.parentId ? { parentId: params.parentId } : {})
    })
    const createUrl = `${this.base(auth.cloudId)}/wiki/api/v2/pages`
    const r = await this.call(createUrl, auth.token, { method: 'POST', body: payload })
    if (!r.ok) {
      return r.error
    }
    const id =
      typeof r.body.id === 'string'
        ? r.body.id
        : typeof r.body.id === 'number'
          ? String(r.body.id)
          : ''
    if (id === '') {
      return err('network', 'Confluence created the page but returned no id.')
    }
    const title = typeof r.body.title === 'string' && r.body.title !== '' ? r.body.title : params.title
    return { ok: true, data: { id, title } }
  }

  /**
   * Read the current version number + storage body of a page for an UPDATE
   * (confluence-mcp-write-v1, FR-009a, plan §C1). The v2 update is optimistic-locked and
   * replaces content wholesale, so it needs the CURRENT `version.number` (to submit
   * current+1) and, for a title-only / no-body update, the current STORAGE body to re-send.
   *
   * Reads `GET /wiki/api/v2/pages/{id}?body-format=storage&version=true` — NOT the public
   * `getPage` (which requests `body-format=view`, a server-rendered HTML that is NOT a valid
   * re-submittable storage body, and whose DTO drops the version). The storage body is read
   * from `body.storage.value`. Failures map via the existing error path. Pure w.r.t. the
   * token (never returned). Returns the version + storage body on success, or a typed error.
   */
  private async readForUpdate(
    auth: ConfluenceCallAuth,
    pageId: string
  ): Promise<ConfluenceResult<{ versionNumber: number; storageBody: string }>> {
    const url =
      `${this.base(auth.cloudId)}/wiki/api/v2/pages/${encodeURIComponent(pageId)}` +
      `?body-format=storage&version=true`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const version = isRecord(r.body.version) ? r.body.version : {}
    const versionNumber = typeof version.number === 'number' ? version.number : NaN
    if (!Number.isFinite(versionNumber)) {
      return err('network', 'Confluence returned no current version number for the page.')
    }
    const body = isRecord(r.body.body) ? r.body.body : {}
    const storage = isRecord(body.storage) ? body.storage : {}
    const storageBody = typeof storage.value === 'string' ? storage.value : ''
    return { ok: true, data: { versionNumber, storageBody } }
  }

  /**
   * Update an existing page (confluence-mcp-write-v1, FR-009). First reads the current
   * version + storage body (`readForUpdate`), then issues
   * `PUT /wiki/api/v2/pages/{id}` with `{ id, status: 'current', title,
   * body: { representation: 'storage', value }, version: { number: current+1, message? } }`.
   *
   * Body resolution (§C3): when `params.body` is a non-empty/non-whitespace string it is
   * wrapped to storage XHTML via {@link plainTextToStorage} and replaces the body; otherwise
   * (absent or empty/whitespace) the read storage body is re-sent UNCHANGED so a title-only
   * update never wipes content.
   *
   * A stale-version rejection (HTTP 409, or 400 whose body indicates a version mismatch)
   * maps to a recoverable `version_conflict` so the agent can re-read + retry (FR-009b);
   * all other HTTP failures map via {@link mapConfluenceError}. A scope-less token is
   * short-circuited by the manager BEFORE this is called. The token is never returned.
   */
  async updatePage(
    auth: ConfluenceCallAuth,
    params: ConfluenceUpdateParams
  ): Promise<ConfluenceResult<ConfluenceUpdateResult>> {
    const read = await this.readForUpdate(auth, params.pageId)
    if (!read.ok) {
      return read
    }
    const newVersion = read.data.versionNumber + 1
    const hasNewBody = typeof params.body === 'string' && params.body.trim().length > 0
    const value = hasNewBody ? plainTextToStorage(params.body as string) : read.data.storageBody
    const payload = JSON.stringify({
      id: params.pageId,
      status: 'current',
      title: params.title,
      body: { representation: 'storage', value },
      version: {
        number: newVersion,
        ...(typeof params.versionMessage === 'string' && params.versionMessage !== ''
          ? { message: params.versionMessage }
          : {})
      }
    })
    const url = `${this.base(auth.cloudId)}/wiki/api/v2/pages/${encodeURIComponent(params.pageId)}`
    const r = await this.callWrite(url, auth.token, 'PUT', payload)
    if (!r.ok) {
      // Map a stale-version conflict to a distinct, recoverable result (FR-009b, §C2).
      if (r.status === 409 || (r.status === 400 && bodyIndicatesVersionConflict(r.rawBody))) {
        return err('version_conflict', CONFLUENCE_VERSION_CONFLICT_MESSAGE)
      }
      return r.status === 429
        ? mapConfluenceError(429, parseRetryAfter(r.retryAfter))
        : mapConfluenceError(r.status)
    }
    const id =
      typeof r.body.id === 'string'
        ? r.body.id
        : typeof r.body.id === 'number'
          ? String(r.body.id)
          : params.pageId
    const title =
      typeof r.body.title === 'string' && r.body.title !== '' ? r.body.title : params.title
    const returnedVersion = isRecord(r.body.version) ? r.body.version : {}
    const version =
      typeof returnedVersion.number === 'number' ? returnedVersion.number : newVersion
    return { ok: true, data: { id, title, version } }
  }

  /**
   * Add a footer comment to a page (confluence-mcp-write-v1, comment FR). Issues
   * `POST /wiki/api/v2/footer-comments` with `{ pageId, body: { representation: 'storage',
   * value } }` where the plain-text comment is wrapped to storage XHTML via
   * {@link plainTextToStorage}. Requires the `write:comment:confluence` scope (gated by the
   * manager BEFORE this is called). Returns the new comment id + the page it was added to.
   * HTTP failures map via {@link mapConfluenceError}. The token is never returned.
   */
  async createComment(
    auth: ConfluenceCallAuth,
    params: ConfluenceCommentParams
  ): Promise<ConfluenceResult<ConfluenceCommentResult>> {
    const payload = JSON.stringify({
      pageId: params.pageId,
      body: { representation: 'storage', value: plainTextToStorage(params.body) }
    })
    const url = `${this.base(auth.cloudId)}/wiki/api/v2/footer-comments`
    const r = await this.call(url, auth.token, { method: 'POST', body: payload })
    if (!r.ok) {
      return r.error
    }
    const id =
      typeof r.body.id === 'string'
        ? r.body.id
        : typeof r.body.id === 'number'
          ? String(r.body.id)
          : ''
    if (id === '') {
      return err('network', 'Confluence added the comment but returned no id.')
    }
    return { ok: true, data: { id, pageId: params.pageId } }
  }

  /**
   * Read a page's footer comments (confluence-dock-comments-v1, FR-003). Two-step shape:
   *   1. GET /wiki/api/v2/pages/{pageId}/footer-comments?body-format=view&limit=N → the
   *      top-level footer comments.
   *   2. For EACH top-level comment, GET /wiki/api/v2/footer-comments/{commentId}/children
   *      ?body-format=view&limit=M → its direct replies (ONE nesting level for v1).
   *
   * Children reads are BOUNDED + BEST-EFFORT: a failed/absent children read yields an empty
   * `replies` array for that comment — it NEVER fails the whole comments read (plan §C OQ-1).
   * The body of each comment/reply is the raw `body-format=view` HTML carried UNCHANGED (the
   * renderer sanitizes at the display site, OQ-3). The author is the v2 `version.authorId`
   * account id surfaced as `author.accountId` (no name resolver — the renderer falls back to
   * the id; degrade-never-throw). The first-page failure of the TOP-LEVEL read maps via
   * {@link mapConfluenceError}. A scope-less token is short-circuited by the manager BEFORE
   * this is called. The token is never returned.
   */
  async getComments(
    auth: ConfluenceCallAuth,
    params: ConfluenceGetCommentsParams
  ): Promise<ConfluenceResult<ConfluenceGetCommentsResult>> {
    const url = new URL(
      `${this.base(auth.cloudId)}/wiki/api/v2/pages/${encodeURIComponent(params.pageId)}/footer-comments`
    )
    url.searchParams.set('body-format', 'view')
    url.searchParams.set('limit', '50')
    if (params.cursor) {
      url.searchParams.set('cursor', params.cursor)
    }
    const r = await this.call(url.toString(), auth.token)
    if (!r.ok) {
      return r.error
    }
    const results = Array.isArray(r.body.results) ? r.body.results : []
    const tops = results.filter(isRecord).map(mapFooterComment)
    // Fetch each top-level comment's direct replies (one level), best-effort and in parallel.
    const comments = await Promise.all(
      tops.map(async (c) => ({ ...c, replies: await this.commentChildren(auth, c.id) }))
    )
    const links = isRecord(r.body._links) ? r.body._links : {}
    const nextCursor = cursorFromNextLink(links.next)
    return { ok: true, data: { comments, ...(nextCursor ? { nextCursor } : {}) } }
  }

  /**
   * Best-effort read of a comment's DIRECT replies (one level — confluence-dock-comments-v1,
   * plan §C OQ-1). GET /wiki/api/v2/footer-comments/{commentId}/children?body-format=view.
   * ANY failure (network, non-2xx, malformed body) degrades to `[]` so a failed children read
   * never errors the whole comments section. Replies are shaped with `replies: []` (v1 is one
   * nesting level — replies-of-replies are not fetched). The token is never returned.
   */
  private async commentChildren(
    auth: ConfluenceCallAuth,
    commentId: string
  ): Promise<ConfluenceComment[]> {
    const url = new URL(
      `${this.base(auth.cloudId)}/wiki/api/v2/footer-comments/${encodeURIComponent(commentId)}/children`
    )
    url.searchParams.set('body-format', 'view')
    url.searchParams.set('limit', '50')
    const r = await this.call(url.toString(), auth.token)
    if (!r.ok) {
      return []
    }
    const results = Array.isArray(r.body.results) ? r.body.results : []
    return results.filter(isRecord).map(mapFooterComment)
  }

  /**
   * Issue a write request (PUT/POST) returning the parsed body AND the raw HTTP status /
   * Retry-After / unparsed body so the caller can discriminate a version conflict
   * (confluence-mcp-write-v1, §C2) before falling back to {@link mapConfluenceError}. Unlike
   * the private {@link call}, this does NOT pre-map the error — it surfaces the status so
   * `updatePage` can branch 409 / 400-version → `version_conflict`. The token is attached but
   * never returned.
   */
  private async callWrite(
    url: string,
    token: string,
    method: string,
    body: string
  ): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; status: number; retryAfter: string | null; rawBody: string }
  > {
    let res: ConfluenceHttpResponse
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body
      })
    } catch {
      // A network failure has no HTTP status; signal status 0 → mapped to `network`.
      return { ok: false, status: 0, retryAfter: null, rawBody: '' }
    }
    if (!res.ok) {
      let rawBody = ''
      try {
        const parsed = await res.json()
        rawBody = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
      } catch {
        // best effort — the version-conflict discriminator tolerates an empty body.
      }
      return { ok: false, status: res.status, retryAfter: res.headers.get('retry-after'), rawBody }
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      // A 2xx with an unreadable/empty body still succeeded; treat as an empty object.
      parsed = {}
    }
    return { ok: true, body: isRecord(parsed) ? parsed : {} }
  }
}

/**
 * Heuristic: does a 400 response body indicate a version/optimistic-locking conflict
 * (confluence-mcp-write-v1, §C2)? Confluence usually returns 409 for a stale version, but
 * may return 400 with a version-related message. Pure; tolerates any shape. Never throws.
 */
function bodyIndicatesVersionConflict(rawBody: string): boolean {
  if (typeof rawBody !== 'string' || rawBody === '') {
    return false
  }
  const lower = rawBody.toLowerCase()
  return lower.includes('version') && (lower.includes('conflict') || lower.includes('match'))
}

/**
 * Extract the raw `body-format=view` HTML from a v2 footer-comment object
 * (confluence-dock-comments-v1, FR-003). Reads `body.view.value` — the Confluence
 * server-rendered comment HTML — UNCHANGED (sanitization is the renderer's job at the
 * `dangerouslySetInnerHTML` site, OQ-3). A missing/non-string value degrades to `''` (the safe
 * "no readable body" state — FR-012). Pure; never throws. Exported for the unit test.
 */
export function footerCommentBody(comment: Record<string, unknown>): string {
  const body = isRecord(comment.body) ? comment.body : {}
  const view = isRecord(body.view) ? body.view : {}
  return typeof view.value === 'string' ? view.value : ''
}

/**
 * Map ONE v2 footer-comment object to a {@link ConfluenceComment} with an EMPTY `replies`
 * array (the caller fills `replies` for top-level comments; replies themselves stay flat —
 * v1 is one nesting level, plan §C OQ-1). Pure; never throws.
 *
 * Author: the v2 footer comment carries an author ACCOUNT ID (e.g. `version.authorId` or
 * `authorId`), not a display name — surfaced as `author.accountId`; the renderer falls back to
 * the id when no name is available (degrade-never-throw). `created` reads the ISO-8601
 * `version.createdAt` when present (degrade-to-omit otherwise — FR-002). NO token is read.
 */
export function mapFooterComment(comment: Record<string, unknown>): ConfluenceComment {
  const id =
    typeof comment.id === 'string'
      ? comment.id
      : typeof comment.id === 'number'
        ? String(comment.id)
        : ''
  const version = isRecord(comment.version) ? comment.version : {}
  const accountId =
    typeof comment.authorId === 'string' && comment.authorId !== ''
      ? comment.authorId
      : typeof version.authorId === 'string' && version.authorId !== ''
        ? version.authorId
        : undefined
  const created =
    typeof version.createdAt === 'string' && version.createdAt !== ''
      ? version.createdAt
      : typeof comment.createdAt === 'string' && comment.createdAt !== ''
        ? comment.createdAt
        : undefined
  return {
    id,
    author: { ...(accountId ? { accountId } : {}) },
    ...(created ? { created } : {}),
    body: footerCommentBody(comment),
    replies: []
  }
}

/**
 * Map a v1 CQL search response body to a `ConfluencePage<ConfluenceSearchResult>`
 * (pure). Shared by {@link ConfluenceClient.searchContent} and
 * {@link ConfluenceClient.defaultFeed} — both consume the same `/wiki/rest/api/search`
 * hit shape, so the title/space/excerpt extraction and the `_links.next` → `nextCursor`
 * pagination are identical.
 */
function mapSearchResultsPage(
  body: Record<string, unknown>
): ConfluencePage<ConfluenceSearchResult> {
  const results = Array.isArray(body.results) ? body.results : []
  const items: ConfluenceSearchResult[] = results.filter(isRecord).map((hit) => {
    const content = isRecord(hit.content) ? hit.content : {}
    const space = isRecord(hit.resultGlobalContainer) ? hit.resultGlobalContainer : {}
    const title =
      typeof hit.title === 'string'
        ? stripHighlight(hit.title)
        : typeof content.title === 'string'
          ? content.title
          : ''
    return {
      id: typeof content.id === 'string' ? content.id : String(content.id ?? ''),
      // Decode literal \uXXXX emoji escapes Confluence serializes into plain text fields,
      // so the search/feed LIST screen shows real glyphs (re-open).
      title: decodeUnicodeEscapes(title),
      ...(typeof space.title === 'string' ? { space: decodeUnicodeEscapes(space.title) } : {}),
      excerpt: typeof hit.excerpt === 'string' ? decodeUnicodeEscapes(stripHighlight(hit.excerpt)) : ''
    }
  })
  const links = isRecord(body._links) ? body._links : {}
  const nextCursor = cursorFromNextLink(links.next)
  return { items, ...(nextCursor ? { nextCursor } : {}) }
}

/**
 * Strip Confluence search highlight markup (`@@@hl@@@…@@@endhl@@@` and any stray
 * tags) from a title/excerpt, leaving plain text (design Q2).
 */
function stripHighlight(value: string): string {
  return value
    .replace(/@@@hl@@@/g, '')
    .replace(/@@@endhl@@@/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}
