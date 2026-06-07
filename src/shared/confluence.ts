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

/** The single OAuth scope a Confluence page-create requires (granular fallback: `write:page:confluence`). */
export const CONFLUENCE_WRITE_SCOPE = 'write:confluence-content'

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
