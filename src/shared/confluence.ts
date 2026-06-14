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
 * Full page detail (FR-C04: title, space, body/excerpt). `body` is the page body
 * flattened to plain readable text (storage/HTML-ish → text, no macro rendering —
 * design Q2).
 */
export interface ConfluencePageDetail {
  /** Page id. */
  id: string
  /** Page title. */
  title: string
  /** Space name (or key); absent when unknown. */
  space?: string
  /** Page body as flattened, plain readable text; '' when empty (design Q2). */
  body: string
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
 *   write_not_authorized — the stored token lacks `write:confluence-content`; the
 *                      create was not attempted (no client call). Reconnect to grant it.
 */
export type ConfluenceErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'rate_limited'
  | 'network'
  | 'write_not_authorized'

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

/** The single (granular) OAuth scope a Confluence page-create requires. */
export const CONFLUENCE_WRITE_SCOPE = 'write:page:confluence'

/** User-facing message when a create is attempted without the write scope (reconnect to grant it). */
export const CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE =
  'cosmos is not authorized to create Confluence pages yet. Disconnect and reconnect ' +
  'Confluence to grant write access, then try again.'

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
  CreatePage: 'confluence_create_page'
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
  CreatePage: 'createPage'
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
