/**
 * Shared Slack DTOs + the read-only Slack MCP tool contract (Slack integration v1).
 *
 * Single source of truth for the Slack content shapes exchanged between the main
 * process, the renderer (over `window.cosmos.slack` IPC), and the Slack MCP tools
 * (over the socket bridge). Every field traces to a read surface in
 * .sdd/specs/slack-integration-v1.md (FR-013..FR-017, FR-025).
 *
 * READ-ONLY (FR-019, SC-011): there is no write/mutation type anywhere in this
 * module — no post/edit/delete/react op exists. The token NEVER appears here
 * (FR-006, FR-021, SC-008): these are content/metadata the user could see in Slack.
 */

/* ------------------------------------------------------------------------- *
 * Connection status (shared by the panel + status events)
 * ------------------------------------------------------------------------- */

/**
 * The connection state machine the renderer reflects (FR-007, design §2.1):
 *   not_connected  — no token; show the Connect button, perform no reads (FR-012).
 *   connecting     — the browser OAuth flow is in progress (consent + exchange).
 *   connected      — a valid token; reads allowed.
 *   reconnect_needed — token rejected/expired; prompt re-connect (FR-026, SC-007).
 */
export type SlackConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'reconnect_needed'

/**
 * Connection status surfaced to the renderer (FR-007). Carries only non-secret
 * identity/capability metadata — NEVER the token (FR-006, SC-008).
 */
export interface SlackConnectionStatus {
  /** Current connection state. */
  state: SlackConnectionState
  /** Workspace/team display name when connected (FR-007, design §2.1). */
  workspaceName?: string
  /** Slack team id when connected (stable identity; not a secret). */
  teamId?: string
  /**
   * Whether the granted scopes/token permit message search (FR-015). When false,
   * the panel marks search unavailable rather than failing silently.
   */
  canSearch?: boolean
  /**
   * Human-readable reason the last connect attempt failed (e.g. cancelled,
   * timed out, or not configured). Set when a connect ends back at
   * not_connected so the panel can explain *why* instead of appearing inert.
   * Never a secret.
   */
  lastError?: string
}

/* ------------------------------------------------------------------------- *
 * Read-surface DTOs (FR-013, FR-014)
 * ------------------------------------------------------------------------- */

/** A public channel the token can read (FR-013, Scopes: channels:read). */
export interface SlackChannel {
  /** Slack channel id (e.g. `C0123ABCD`). */
  id: string
  /** Channel name without the leading `#`. */
  name: string
  /** Whether the connected user is a member of this channel (FR-013). */
  isMember: boolean
}

/**
 * A message in a channel or a thread reply (FR-013, FR-014).
 * `userId` is always present; `userName` is the resolved display name when the
 * granted scopes allow, else absent and the panel falls back to `userId` (FR-014).
 */
export interface SlackMessage {
  /** Slack message timestamp/id (`ts`), unique within a channel; thread key. */
  ts: string
  /** Author user id (e.g. `U0123ABCD`); always present (FR-014 raw-id fallback). */
  userId: string
  /** Resolved author display name when scopes allow (users:read), else absent. */
  userName?: string
  /** Message text. */
  text: string
  /** Number of replies in this message's thread, when it has one (FR-013). */
  replyCount?: number
}

/** A user/display-name lookup result (FR-014, FR-017, Scopes: users:read). */
export interface SlackUser {
  /** Slack user id. */
  id: string
  /** Human-readable display name (display_name || real_name || name). */
  displayName: string
}

/** A single search hit (FR-015, FR-017, Scopes: search:read user token). */
export interface SlackSearchMatch {
  /** Message timestamp/id of the hit. */
  ts: string
  /** Author user id of the hit. */
  userId: string
  /** Resolved author display name when available (FR-014), else absent. */
  userName?: string
  /** Matching message text. */
  text: string
  /** Channel id the hit is in. */
  channelId: string
  /** Channel name the hit is in (for the `#channel` context chip, design §2.2). */
  channelName?: string
}

/* ------------------------------------------------------------------------- *
 * Paged read results — cursor pagination (FR-013)
 * ------------------------------------------------------------------------- */

/**
 * A page of results plus the cursor for the next page. `nextCursor` is absent
 * when there are no more pages (the list simply ends — design §2.2). Mirrors
 * Slack's `response_metadata.next_cursor` cursor model.
 */
export interface SlackPage<T> {
  /** The items on this page. */
  items: T[]
  /** Opaque cursor for the next page, or absent when no more pages exist. */
  nextCursor?: string
}

/* ------------------------------------------------------------------------- *
 * Read operation results — discriminated union (FR-020, FR-026, SC-007, SC-009)
 * ------------------------------------------------------------------------- */

/**
 * Why a Slack read could not complete. Both surfaces map these to graceful,
 * recoverable states; never a crash, hang, or stack trace (FR-020, FR-026, SC-007).
 *   not_connected      — no token; "connect Slack in cosmos first" (FR-020).
 *   reconnect_needed   — token rejected/expired/revoked; prompt re-connect (FR-026).
 *   search_unavailable — search scope/token absent; mark search unavailable (FR-015).
 *   rate_limited       — Slack 429; honor Retry-After, "busy, retry shortly" (FR-026).
 *   network            — transient network/HTTP error; recoverable Retry (FR-026).
 */
export type SlackErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'search_unavailable'
  | 'rate_limited'
  | 'network'

/** A failed Slack read (FR-020, FR-026). Carries NO secret (FR-021, SC-008). */
export interface SlackError {
  /** Discriminates a failure result from `ok`. */
  ok: false
  /** Why the read failed. */
  kind: SlackErrorKind
  /** Human-readable, non-alarming message for the panel / tool result. */
  message: string
  /** For `rate_limited`: seconds to wait before retrying (Slack Retry-After). */
  retryAfterSeconds?: number
}

/** A successful Slack read carrying its typed data (FR-013..FR-017). */
export interface SlackOk<T> {
  /** Discriminates a success result from an error. */
  ok: true
  /** The read's typed data. */
  data: T
}

/**
 * Every Slack read returns this discriminated result so both surfaces branch on
 * `ok` and degrade gracefully on failure (FR-020, FR-026, SC-007, SC-009).
 */
export type SlackResult<T> = SlackOk<T> | SlackError

/* ------------------------------------------------------------------------- *
 * Read operation parameter shapes (shared by IPC + MCP tool surfaces)
 * ------------------------------------------------------------------------- */

/** Params for listing public channels (FR-013). */
export interface SlackListChannelsParams {
  /** Cursor for the next page; absent for the first page (FR-013 pagination). */
  cursor?: string
}

/** Params for reading a channel's recent message history (FR-013). */
export interface SlackHistoryParams {
  /** The channel id to read. */
  channelId: string
  /** Cursor for the next page; absent for the first page. */
  cursor?: string
}

/** Params for reading a thread's replies (FR-013). */
export interface SlackRepliesParams {
  /** The channel id the thread lives in. */
  channelId: string
  /** The parent message `ts` whose replies to read. */
  threadTs: string
  /** Cursor for the next page; absent for the first page. */
  cursor?: string
}

/** Params for keyword message search (FR-015). */
export interface SlackSearchParams {
  /** The search query. */
  query: string
  /** Cursor for the next page; absent for the first page. */
  cursor?: string
}

/** Params for resolving a user id to a display name (FR-014, FR-017). */
export interface SlackGetUserParams {
  /** The user id to look up. */
  userId: string
}

/* ------------------------------------------------------------------------- *
 * Read-only MCP tool contract (FR-017, FR-019, FR-022)
 * ------------------------------------------------------------------------- */

/**
 * The five read-only Slack MCP tool names (FR-017). Centralized so the entry
 * script, the bridge, and the manager never disagree on a string literal (FR-025).
 * NO write tool exists (FR-019, SC-011).
 */
export const SlackTool = {
  /** List public channels (paginated). */
  ListChannels: 'slack_list_channels',
  /** Read a channel's recent message history (paginated). */
  ReadHistory: 'slack_read_history',
  /** Read a thread's replies (paginated). */
  ReadThread: 'slack_read_thread',
  /** Keyword search across messages. */
  SearchMessages: 'slack_search_messages',
  /** Resolve a user id to display-name info. */
  LookupUser: 'slack_lookup_user'
} as const

export type SlackToolName = (typeof SlackTool)[keyof typeof SlackTool]

/**
 * The bridge-level Slack operation discriminator. Each maps 1:1 to a SlackManager
 * read method; both the MCP tools and the IPC handlers route through these so the
 * single main-process client serves both surfaces (FR-008).
 */
export const SlackOp = {
  ListChannels: 'listChannels',
  GetHistory: 'getHistory',
  GetReplies: 'getReplies',
  Search: 'search',
  GetUser: 'getUser'
} as const

export type SlackOpName = (typeof SlackOp)[keyof typeof SlackOp]
