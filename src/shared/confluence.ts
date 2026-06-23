/**
 * Shared Confluence DTOs + the read-only Confluence MCP tool contract (Atlassian
 * integration v1).
 *
 * Single source of truth for the Confluence content shapes exchanged between the
 * main process, the renderer (over `window.cosmos.confluence` IPC), and the
 * Confluence MCP tools (over the socket bridge). Every field traces to a read
 * surface in .sdd/specs/atlassian-integration-v1.md (Group C: FR-C04, FR-C06;
 * Group A: FR-A12).
 *
 * READ-ONLY (FR-C01, FR-C07, SC-012): there is no write/mutation type anywhere.
 * The access/refresh token NEVER appears here (FR-A11, SC-009): these are content
 * the user could see in Confluence.
 *
 * This file deliberately mirrors `src/shared/slack.ts` / `src/shared/jira.ts` so
 * every surface branches on the same `Result<T>`/`Page<T>` discipline.
 */

import type { AdapterDescriptor, AdapterQuery } from './adapter'

/**
 * Decode literal JS-style `\uXXXX` escape sequences in a text run into their real
 * characters (confluence-detail-emoji-checkbox-stripped-v1 re-open). Confluence sometimes
 * serializes emoji as the literal six-character text `👥` (👥) — both in
 * `body-format=view` HTML AND in plain `title`/`excerpt` fields — rather than the actual
 * glyph. Each `\uXXXX` is one UTF-16 code unit; emitting the high+low surrogate units
 * adjacently re-forms the astral glyph naturally (JS strings are UTF-16), so independent
 * replacement is correct: `👥` → '\uD83D' + '\uDC65' → 👥. Only well-formed
 * 4-hex-digit escapes are touched; all other text is returned verbatim. Pure; never throws.
 *
 * Shared so BOTH the renderer's HTML sanitizer (text-node decode in the page-detail body)
 * AND the main process (plain `title`/`excerpt` mapping for the search/feed LIST screen)
 * apply the SAME transform.
 */
export function decodeUnicodeEscapes(text: unknown): string {
  if (typeof text !== 'string' || !text.includes('\\u')) {
    return typeof text === 'string' ? text : ''
  }
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/* ------------------------------------------------------------------------- *
 * Connection status (shared by the panel + status events)
 * ------------------------------------------------------------------------- */

/**
 * The connection state machine the renderer reflects (FR-A12, design §2.1):
 *   not_connected    — no token; show the Connect button, perform no reads (FR-C03).
 *   connecting       — the browser OAuth flow is in progress (consent + exchange).
 *   connected        — a valid token (refreshed transparently on expiry); reads allowed.
 *   reconnect_needed — refresh itself failed; prompt re-connect (FR-A10, SC-007).
 */
export type ConfluenceConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'reconnect_needed'

/**
 * Connection status surfaced to the renderer (FR-A12). Carries only non-secret
 * identity metadata — NEVER the token, refresh token, or client_secret (FR-A11, SC-009).
 */
export interface ConfluenceConnectionStatus {
  /** Current connection state. */
  state: ConfluenceConnectionState
  /** Atlassian site name when connected (e.g. `acme.atlassian.net`) — design §2.2. */
  siteName?: string
  /** Account display name when connected (non-secret identity) — design §2.2. */
  accountName?: string
  /**
   * Human-readable reason the last connect attempt failed (cancelled, denied,
   * state-mismatch, not-configured, or no accessible site). Set when a connect
   * ends back at not_connected so the panel can explain why. Never a secret.
   */
  lastError?: string
}

/* ------------------------------------------------------------------------- *
 * Read-surface DTOs (FR-C04)
 * ------------------------------------------------------------------------- */

/**
 * One content hit in a search result list (FR-C04: title, space, excerpt). The
 * excerpt is flattened to plain readable text (highlight markup stripped — design Q2).
 */
export interface ConfluenceSearchResult {
  /** Page/content id (used to open the page detail). */
  id: string
  /** Content title. */
  title: string
  /** Space name (or key) shown as the space chip — design §5.1. Absent if unknown. */
  space?: string
  /** Excerpt as flattened plain text; '' when none (design Q2). */
  excerpt: string
}

/**
 * Full page detail (FR-C04: title, space, body). `body` carries the page body as
 * Confluence SERVER-RENDERED HTML (`body-format=view`) — a raw HTML string
 * (confluence-detail-rich-render-v1, FR-005/FR-006). It is UNTRUSTED HTML and MUST be
 * sanitized in the renderer (DOMPurify) before injection via `dangerouslySetInnerHTML`
 * (FR-008); sanitization is a renderer concern at the display site, so the contract
 * carries the raw `view` HTML across IPC unchanged. `''` when the page has no body
 * (the safe "no readable body" state — FR-012).
 */
export interface ConfluencePageDetail {
  /** Page id. */
  id: string
  /** Page title. */
  title: string
  /** Space name (or key); absent when unknown. */
  space?: string
  /**
   * Page body as Confluence server-rendered HTML (`body-format=view`); a RAW,
   * UNTRUSTED HTML string sanitized in the renderer before display (FR-006/FR-008).
   * `''` when the page has no readable body (FR-012).
   */
  body: string
  /**
   * Canonical Confluence web-UI page URL — the page as a human visits it in a browser
   * (confluence-detail-weblink-v1 #87, FR-003). Assembled from the page read's OWN
   * non-secret `_links.base` + `_links.webui` (NOT the cloudId API host). NON-SECRET.
   * OMITTED (no `undefined` key) when a usable absolute `http(s)` URL cannot be
   * assembled — degrade-to-omit so the "Open in Confluence" affordance simply does not
   * render (FR-004/FR-008), mirroring the calendar `htmlLink` omit-when-absent discipline.
   */
  webUrl?: string
}

/* ------------------------------------------------------------------------- *
 * Paged read results — cursor pagination (FR-C04, plan §C)
 * ------------------------------------------------------------------------- */

/**
 * A page of results plus the cursor for the next page. `nextCursor` is absent when
 * there are no more pages. Maps Confluence's `_links.next` / `Link: rel="next"`
 * cursor into the same opaque-cursor model the panel's "Load more" consumes.
 */
export interface ConfluencePage<T> {
  /** The items on this page. */
  items: T[]
  /** Opaque cursor for the next page, or absent when no more pages exist. */
  nextCursor?: string
}

/* ------------------------------------------------------------------------- *
 * Read operation results — discriminated union (FR-X06, FR-X07, SC-007, SC-010)
 * ------------------------------------------------------------------------- */

/**
 * Why a Confluence read could not complete (FR-X07, SC-007, SC-010).
 *   not_connected    — no token; "connect Confluence in cosmos first" (FR-C06).
 *   reconnect_needed — refresh failed; prompt re-connect (FR-A10, SC-007).
 *   rate_limited     — Atlassian 429; honor Retry-After (FR-X07).
 *   network          — transient network/HTTP error; recoverable Retry (FR-X07).
 *   write_not_authorized — the stored token lacks the granular write scope for the
 *                      attempted write (`write:page:confluence` for create/update,
 *                      `write:comment:confluence` for a comment); the write was not
 *                      attempted (no client call). Reconnect to grant it.
 *   version_conflict — an update raced a concurrent edit: the page version moved
 *                      underneath the read-then-write window so Confluence rejected
 *                      the stale version (HTTP 409 / 400-version). Recoverable —
 *                      re-read the page and try the update again (no clobber).
 */
export type ConfluenceErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'rate_limited'
  | 'network'
  | 'write_not_authorized'
  | 'version_conflict'

/** A failed Confluence read (FR-X07). Carries NO secret (FR-X02, SC-009). */
export interface ConfluenceError {
  /** Discriminates a failure result from `ok`. */
  ok: false
  /** Why the read failed. */
  kind: ConfluenceErrorKind
  /** Human-readable, non-alarming message for the panel / tool result. */
  message: string
  /** For `rate_limited`: seconds to wait before retrying (Atlassian Retry-After). */
  retryAfterSeconds?: number
}

/** A successful Confluence read carrying its typed data (FR-C04). */
export interface ConfluenceOk<T> {
  /** Discriminates a success result from an error. */
  ok: true
  /** The read's typed data. */
  data: T
}

/**
 * Every Confluence read returns this discriminated result so both surfaces branch
 * on `ok` and degrade gracefully on failure (FR-X06, SC-007, SC-009).
 */
export type ConfluenceResult<T> = ConfluenceOk<T> | ConfluenceError

/* ------------------------------------------------------------------------- *
 * Read operation parameter shapes (shared by IPC + MCP tool surfaces)
 * ------------------------------------------------------------------------- */

/** Params for a content search (FR-C04, FR-C06). */
export interface ConfluenceSearchParams {
  /** The search query (mapped to CQL text by the client). */
  query: string
  /** Cursor for the next page; absent for the first page. */
  cursor?: string
}

/**
 * Params for the default personal activity feed (confluence-default-feed v1, FR-006,
 * FR-016). Cursor-only: it carries NO query and NO CQL/mode string. The fixed
 * personal-scope CQL lives ONLY in `ConfluenceClient.defaultFeed` (SC-008); the
 * renderer and IPC payload never carry a CQL or a feed-mode discriminator.
 */
export interface ConfluenceDefaultFeedParams {
  /** Cursor for the next page; absent for the first page. */
  cursor?: string
}

/** Params for reading a single page's detail (FR-C04, FR-C06). */
export interface ConfluenceGetPageParams {
  /** The page id to read. */
  pageId: string
}

/**
 * Params for creating a page (the single Confluence write). All non-secret — the
 * token is attached in main, never carried here.
 *   spaceKey — the destination space KEY (e.g. `ENG`); resolved to a numeric
 *              spaceId by the client before the v2 create.
 *   title    — the new page title.
 *   body     — the page body as plain text (converted to storage XHTML by main).
 *   parentId — optional parent page id to nest under.
 */
export interface ConfluenceCreateParams {
  spaceKey: string
  title: string
  body: string
  parentId?: string
}

/** Success data for a create: the new page id + title (for a follow-up read/link). */
export interface ConfluenceCreateResult {
  id: string
  title: string
}

/**
 * Params for updating an existing page (confluence-mcp-write-v1, FR-002). All
 * non-secret — the token is attached in main, never carried here.
 *   pageId         — the id of the page to update (required).
 *   title          — the new (or unchanged) page title (required by the v2 update).
 *   body           — OPTIONAL plain text. When a non-empty body is supplied it
 *                    replaces the page body (converted to storage XHTML by main).
 *                    When absent or empty/whitespace the existing body is PRESERVED
 *                    (the client re-reads + re-sends the current storage body) to
 *                    avoid an accidental content wipe (§C3).
 *   versionMessage — OPTIONAL short change note recorded on the new version.
 */
export interface ConfluenceUpdateParams {
  pageId: string
  title: string
  body?: string
  versionMessage?: string
}

/** Success data for an update: the page id, (new) title, and the new version number. */
export interface ConfluenceUpdateResult {
  id: string
  title: string
  /** The new (incremented) version number after the update (FR-009). */
  version: number
}

/** Params for adding a footer comment to a page (confluence-mcp-write-v1, comment FR). Non-secret. */
export interface ConfluenceCommentParams {
  /** The id of the page to comment on (required). */
  pageId: string
  /** The comment text as plain text (converted to storage XHTML by main); required. */
  body: string
}

/** Success data for a comment: the new comment id + the page it was added to. */
export interface ConfluenceCommentResult {
  id: string
  pageId: string
}

/** The granular OAuth scope a Confluence page create/update requires. */
export const CONFLUENCE_WRITE_SCOPE = 'write:page:confluence'

/** The granular OAuth scope a Confluence footer-comment create requires. */
export const CONFLUENCE_COMMENT_SCOPE = 'write:comment:confluence'

/** User-facing message when a page write is attempted without the page-write scope (reconnect to grant it). */
export const CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE =
  'cosmos is not authorized to create or edit Confluence pages yet. Disconnect and ' +
  'reconnect Confluence to grant write access, then try again.'

/** User-facing message when a comment is attempted without the comment-write scope (reconnect to grant it). */
export const CONFLUENCE_COMMENT_NOT_AUTHORIZED_MESSAGE =
  'cosmos is not authorized to comment on Confluence pages yet. Disconnect and ' +
  'reconnect Confluence to grant comment access, then try again.'

/** User-facing message for a stale-version update conflict (re-read the page, then retry). */
export const CONFLUENCE_VERSION_CONFLICT_MESSAGE =
  'The page changed since it was read — re-read it and try the update again.'

/* ------------------------------------------------------------------------- *
 * Read-only MCP tool contract (FR-C06, FR-X01)
 * ------------------------------------------------------------------------- */

/**
 * The Confluence MCP tool names. Two reads (FR-C06) plus one WRITE — `create_page`
 * (model-mediated: the agent calls it directly; main attaches the token and holds the
 * `write:confluence-content` scope). Centralized so the entry script, the bridge, and
 * the manager never disagree on a string literal (FR-X06).
 */
export const ConfluenceTool = {
  /** Search content (paginated). */
  SearchContent: 'confluence_search_content',
  /** Get one page's detail (title, space, body). */
  GetPage: 'confluence_get_page',
  /** Create a new page (MUTATES Confluence). */
  CreatePage: 'confluence_create_page',
  /** Update an existing page's title and/or body (MUTATES Confluence). */
  UpdatePage: 'confluence_update_page',
  /** Add a footer comment to a page (MUTATES Confluence). */
  CreateComment: 'confluence_create_comment'
} as const

export type ConfluenceToolName = (typeof ConfluenceTool)[keyof typeof ConfluenceTool]

/**
 * The bridge-level Confluence operation discriminator. Each maps 1:1 to a
 * ConfluenceManager read method; both surfaces route through these so the single
 * main-process client serves both (FR-A13).
 */
export const ConfluenceOp = {
  SearchContent: 'searchContent',
  GetPage: 'getPage',
  CreatePage: 'createPage',
  UpdatePage: 'updatePage',
  CreateComment: 'createComment'
} as const

export type ConfluenceOpName = (typeof ConfluenceOp)[keyof typeof ConfluenceOp]

/* ------------------------------------------------------------------------- *
 * Generative-adapter descriptors (confluence-generative-adapter-v1)
 *
 * The SECRET-FREE adapter descriptors that capture HOW to refetch a bound
 * Confluence surface (FR-005/FR-006/FR-007). Mirrors `src/shared/slack.ts`'s
 * descriptor builders. Each narrows the shared {@link AdapterDescriptor}
 * `{ dataSource, query }` to one Confluence READ; the `query` carries only
 * non-secret params + the opaque forward `_links.next` cursor — never a token,
 * cloudId-derived secret, or the personal-feed CQL (FR-007/FR-018).
 *
 * READ-ONLY (FR-017): only the three reads (`defaultFeed`/`searchContent`/
 * `getPage`) — no write source. `createPage` is the separate
 * `confluence-create-page-v1` feature and is deliberately NOT an adapter source.
 * ------------------------------------------------------------------------- */

/**
 * The Confluence adapter `dataSource` values (FR-006). Each maps 1:1 to a
 * {@link ConfluenceManager} READ in `confluenceAdapterResolver`:
 *   defaultFeed   → the personal activity feed (cursor-only — FR-007).
 *   searchContent → a CQL/text content search.
 *   getPage       → one page's detail.
 * Reuses the `ConfluenceOp` read discriminators so the names never drift.
 */
export const ConfluenceAdapterSource = {
  /** Default activity-feed surface → `defaultFeed(cursor?)` (FR-006/FR-007). */
  DefaultFeed: 'defaultFeed',
  /** Content/CQL search surface → `searchContent(query, cursor?)` (FR-006). */
  SearchContent: ConfluenceOp.SearchContent,
  /** Page-detail surface → `getPage(pageId)` (FR-006). */
  GetPage: ConfluenceOp.GetPage
} as const

export type ConfluenceAdapterSourceName =
  (typeof ConfluenceAdapterSource)[keyof typeof ConfluenceAdapterSource]

/**
 * The query for a `defaultFeed` descriptor (FR-007). CURSOR-ONLY: it carries NO
 * CQL and NO feed-mode discriminator — the fixed personal-scope CQL lives ONLY
 * in `ConfluenceClient.defaultFeed`, preserving `confluence-default-feed-v1`
 * FR-006/SC-008. Mirrors {@link ConfluenceDefaultFeedParams}.
 */
export interface ConfluenceFeedAdapterQuery extends AdapterQuery {
  /** Opaque forward cursor (`_links.next`-derived); absent on page one. */
  cursor?: string
}

/**
 * The query for a `searchContent` descriptor (FR-006). Non-secret: the search
 * query (mapped to CQL text by the client) + the opaque forward cursor. Mirrors
 * {@link ConfluenceSearchParams}.
 */
export interface ConfluenceSearchAdapterQuery extends AdapterQuery {
  /** The search query the surface reads (non-secret). */
  query: string
  /** Opaque forward cursor (`_links.next`-derived); absent on page one. */
  cursor?: string
}

/**
 * The query for a `getPage` descriptor (FR-006). Non-secret: the page id to
 * re-read. Mirrors {@link ConfluenceGetPageParams}. No cursor — the detail is a
 * single value (refresh-only, `pagination: 'none'`).
 */
export interface ConfluencePageAdapterQuery extends AdapterQuery {
  /** The page id whose detail the surface reads (non-secret). */
  pageId: string
}

/**
 * A Confluence adapter descriptor — the {@link AdapterDescriptor} narrowed to
 * Confluence's three READ sources (FR-005/FR-006). Discriminated by `dataSource`.
 * Secret-free (FR-005/FR-007/FR-018).
 */
export type ConfluenceAdapterDescriptor =
  | (AdapterDescriptor & {
      dataSource: typeof ConfluenceAdapterSource.DefaultFeed
      query: ConfluenceFeedAdapterQuery
    })
  | (AdapterDescriptor & {
      dataSource: typeof ConfluenceAdapterSource.SearchContent
      query: ConfluenceSearchAdapterQuery
    })
  | (AdapterDescriptor & {
      dataSource: typeof ConfluenceAdapterSource.GetPage
      query: ConfluencePageAdapterQuery
    })

/**
 * Build a secret-free `defaultFeed` descriptor for a bound activity-feed surface
 * (FR-006/FR-007). Carries ONLY the optional opaque cursor — no CQL, no token.
 */
export function confluenceFeedDescriptor(cursor?: string): ConfluenceAdapterDescriptor {
  return {
    dataSource: ConfluenceAdapterSource.DefaultFeed,
    query: { ...(cursor ? { cursor } : {}) }
  }
}

/**
 * Build a secret-free `searchContent` descriptor for a bound search-results
 * surface (FR-006). Carries only the (non-secret) query + optional cursor.
 */
export function confluenceSearchDescriptor(
  query: string,
  cursor?: string
): ConfluenceAdapterDescriptor {
  return {
    dataSource: ConfluenceAdapterSource.SearchContent,
    query: { query, ...(cursor ? { cursor } : {}) }
  }
}

/**
 * Build a secret-free `getPage` descriptor for a bound page-detail surface
 * (FR-006). Carries only the (non-secret) page id — never a token.
 */
export function confluencePageDescriptor(pageId: string): ConfluenceAdapterDescriptor {
  return {
    dataSource: ConfluenceAdapterSource.GetPage,
    query: { pageId }
  }
}
