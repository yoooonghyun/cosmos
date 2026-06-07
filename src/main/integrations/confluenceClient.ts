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
 *   search: GET {base}/wiki/rest/api/search?cql=…&cursor=…      (v1 CQL search)
 *   page:   GET {base}/wiki/api/v2/pages/{id}?body-format=storage (v2 page read)
 * where `base = https://api.atlassian.com/ex/confluence/{cloudId}`.
 */

import type {
  ConfluenceCreateParams,
  ConfluenceCreateResult,
  ConfluenceError,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchResult
} from '../../shared/confluence'
import { confluenceApiBase } from './atlassianConfig'
import { plainTextToStorage, storageToPlainText } from './atlassianText'

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

/** Per-call auth + targeting inputs threaded by ConfluenceManager (never stored). */
export interface ConfluenceCallAuth {
  /** The bearer access token to attach. */
  token: string
  /** The resolved site cloudId targeting every read (FR-A07). */
  cloudId: string
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
    const results = Array.isArray(r.body.results) ? r.body.results : []
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
        title,
        ...(typeof space.title === 'string' ? { space: space.title } : {}),
        excerpt: typeof hit.excerpt === 'string' ? stripHighlight(hit.excerpt) : ''
      }
    })
    const links = isRecord(r.body._links) ? r.body._links : {}
    const nextCursor = cursorFromNextLink(links.next)
    return { ok: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }
  }

  /**
   * Read one page's detail (FR-C04). GET /wiki/api/v2/pages/{id}?body-format=storage.
   * The storage body is flattened to plain text (no macro rendering — design Q2).
   */
  async getPage(
    auth: ConfluenceCallAuth,
    pageId: string
  ): Promise<ConfluenceResult<ConfluencePageDetail>> {
    const url =
      `${this.base(auth.cloudId)}/wiki/api/v2/pages/${encodeURIComponent(pageId)}` +
      `?body-format=storage`
    const r = await this.call(url, auth.token)
    if (!r.ok) {
      return r.error
    }
    const body = isRecord(r.body.body) ? r.body.body : {}
    const storage = isRecord(body.storage) ? body.storage : {}
    // v2 returns the space as an id; the space name is not inlined, so we surface
    // a spaceId chip when present (v1 keeps the resolution simple — design §5.1).
    const spaceId =
      typeof r.body.spaceId === 'string'
        ? r.body.spaceId
        : typeof r.body.spaceId === 'number'
          ? String(r.body.spaceId)
          : undefined
    return {
      ok: true,
      data: {
        id: typeof r.body.id === 'string' ? r.body.id : String(r.body.id ?? pageId),
        title: typeof r.body.title === 'string' ? r.body.title : '',
        ...(spaceId ? { space: spaceId } : {}),
        body: storageToPlainText(storage.value)
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
