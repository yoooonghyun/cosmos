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

import type { AdapterDescriptor, AdapterQuery } from './adapter'

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
   * Whether the granted scopes/token permit sending a message (slack-send-message-v1,
   * FR-009). Mirrors {@link canSearch}: a non-secret per-scope capability flag derived
   * from `chat:write`. When false the composer surfaces a Reconnect affordance up front
   * instead of an enabled-but-failing send (FR-010). Never a secret.
   */
  canSend?: boolean
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
 * An opaque attachment-image reference carried on a {@link SlackMessage}
 * (slack-rich-message-render-v1, FR-009/FR-010). `ref` is a `cosmos-slack-img://`
 * scheme URL the renderer hands straight to an `<img src>`; main resolves it to the
 * auth-gated `files.slack.com` bytes with the token attached only to the outbound
 * fetch. NEVER a token, NEVER a token-bearing `files.slack.com` URL (FR-014).
 */
export interface SlackImageRef {
  /** The opaque `cosmos-slack-img://slack/<base64url>` reference. NEVER a token/URL. */
  ref: string
  /** Accessible alt / filename when Slack provides one (the broken-image fallback). */
  alt?: string
  /** Natural pixel width when known (lets the row reserve layout space). */
  w?: number
  /** Natural pixel height when known. */
  h?: number
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
  /**
   * Message text. Mentions are resolved to `@DisplayName`, standard emoji are
   * substituted to their Unicode glyph; CUSTOM-emoji shortcodes are left as `:name:`
   * markers (the renderer swaps them via {@link customEmoji}). Plain string.
   */
  text: string
  /** Number of replies in this message's thread, when it has one (FR-013). */
  replyCount?: number
  /**
   * Inline image attachments (image `files[]` / image `blocks[]`) as OPAQUE refs
   * (slack-rich-message-render-v1, FR-009/FR-010). Absent / empty → no thumbnails.
   */
  images?: SlackImageRef[]
  /**
   * Per-message custom-emoji shortcode → opaque image ref map (FR-006/FR-007). Only
   * the shortcodes actually used in this message that resolved to a workspace custom
   * (image-backed) emoji appear here; the renderer swaps the `:name:` markers in
   * `text` for an inline `<img>`. Absent → no custom emoji (standard/literal only).
   */
  customEmoji?: Record<string, string>
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
  /** Matching message text (mentions resolved, standard emoji glyph-substituted). */
  text: string
  /** Channel id the hit is in. */
  channelId: string
  /** Channel name the hit is in (for the `#channel` context chip, design §2.2). */
  channelName?: string
  /**
   * Per-match custom-emoji shortcode → opaque image ref map (slack-rich-message-
   * render-v1, FR-006/FR-012). Carried so a search row's body renders custom emoji
   * identically to a history row. Search rows do NOT carry image attachments in v1.
   */
  customEmoji?: Record<string, string>
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
  /**
   * The thread root's canonical "Open in Slack" web permalink, carried ONLY by the
   * `getReplies` (thread) read (slack-thread-open-in-slack-v1). Resolved from Slack's own
   * `chat.getPermalink` API (never hand-built) and re-validated to an openable `http(s)` URL
   * before it is attached; absent when the resolve fails or the value is non-openable
   * (degrade-to-omit → the thread dock shows a plain header with no link). NON-SECRET: the
   * canonical web URL only — NEVER a token or a token-bearing URL (SC-008).
   */
  permalink?: string
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
 *   write_not_authorized — the token lacks `chat:write`; the manager short-circuits a
 *                        send WITHOUT a Slack API call, prompting a one-time Reconnect
 *                        (slack-send-message-v1, FR-008/FR-010; mirrors the Jira kind).
 */
export type SlackErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'search_unavailable'
  | 'rate_limited'
  | 'network'
  | 'write_not_authorized'

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
 * Write operation: send a plain-text message (slack-send-message-v1)
 *
 * The FIRST write on the Slack integration. A NATIVE panel control only — NOT a
 * tool/op on the read-only MCP or generative A2UI surfaces (FR-016, SC-007). The
 * token NEVER appears here (FR-006, SC-006): the renderer requests the send; main
 * attaches the token.
 * ------------------------------------------------------------------------- */

/**
 * Params for sending a plain-text message (FR-004). A present `threadTs` makes the
 * send a thread reply (`thread_ts`); absent makes it a top-level channel message.
 * Text-only in v1 (FR-017): no attachments/blocks. Carries NO token (FR-006).
 */
export interface SlackSendParams {
  /** The channel id to post to (non-secret). */
  channelId: string
  /** The plain-text message body (non-empty, non-whitespace — FR-003). */
  text: string
  /** Present ⇒ thread reply (`thread_ts`); absent ⇒ channel message (FR-002/FR-004). */
  threadTs?: string
}

/** The data a successful send resolves: the posted message `ts` (FR-004). */
export interface SlackSendResult {
  /** The posted message's Slack timestamp/id (`ts`). */
  ts: string
}

/** The OAuth user scope a send requires; absent on read-only-era tokens (FR-007/FR-008). */
export const SLACK_WRITE_SCOPE = 'chat:write'

/** The structured-result message returned for a send without `chat:write` (FR-008/FR-010). */
export const SLACK_WRITE_NOT_AUTHORIZED_MESSAGE =
  'Reconnect Slack to send messages. Open the Slack panel and choose Reconnect.'

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

/* ------------------------------------------------------------------------- *
 * Generative adapter descriptors (slack-generative-adapter-v1)
 *
 * Slack-CONCRETE shapes of the shared, secret-free {@link AdapterDescriptor}
 * `{ dataSource, query }` (the panel-agnostic contract lives in `src/shared/adapter.ts`;
 * the dispatcher + validators are reused VERBATIM). These mirror `src/shared/jira.ts`'s
 * `JiraAdapterDescriptor`/`jiraSearchDescriptor`. A bound Slack surface persists one of
 * these beside its view spec so a refresh / load-more can re-execute the read in main
 * (token attached inside SlackManager — never here, FR-005/FR-009/FR-018).
 *
 * READ-ONLY, APPEND-ONLY (FR-010/FR-011): only the three TOP-LEVEL read surfaces are
 * mapped — `listChannels`/`getHistory`/`search`. `getReplies` (thread expansion) is
 * DELIBERATELY NOT a dataSource here; it is reserved for the held `slack-thread-replies-v1`
 * feature so the two never collide (spec "Relationship to held slack-thread-replies-v1").
 * Every cursor is forward-only + opaque, so there is no prev cursor (the dispatcher's
 * `pagination:'append'` mode + `hasMore` over `nextCursor` presence cover this).
 * ------------------------------------------------------------------------- */

/**
 * The Slack `dataSource` discriminators (FR-005/FR-006). Each maps 1:1 to a SlackManager
 * READ the adapter dispatcher's Slack resolver re-executes. Reuses the {@link SlackOp}
 * read ids so the descriptor, the resolver, and the IPC/bridge reads never disagree on a
 * string. `getReplies`/`getUser` are intentionally excluded (the former is held for the
 * thread-replies feature; the latter is a name-resolution helper, not a list surface).
 */
export const SlackAdapterSource = {
  /** Channel-list surface → `listChannels(cursor?)` (FR-006). */
  ListChannels: SlackOp.ListChannels,
  /** Message-history surface → `getHistory(channelId, cursor?)` (FR-006). */
  GetHistory: SlackOp.GetHistory,
  /** Search-results surface → `search(query, cursor?)` (FR-006). */
  Search: SlackOp.Search
} as const

export type SlackAdapterSourceName =
  (typeof SlackAdapterSource)[keyof typeof SlackAdapterSource]

/**
 * The query for a Slack `listChannels` descriptor (FR-006). Non-secret: only the opaque
 * forward cursor (absent on the first page). Mirrors {@link SlackListChannelsParams}.
 */
export interface SlackChannelsAdapterQuery extends AdapterQuery {
  /** Opaque next-page cursor (`conversations.list` next_cursor); absent on page one. */
  cursor?: string
}

/**
 * The query for a Slack `getHistory` descriptor (FR-006). Non-secret: the channel id to
 * re-read + the opaque cursor. Mirrors {@link SlackHistoryParams}.
 */
export interface SlackHistoryAdapterQuery extends AdapterQuery {
  /** The channel id whose history the surface reads (non-secret). */
  channelId: string
  /** Opaque next-page cursor (`conversations.history` next_cursor); absent on page one. */
  cursor?: string
}

/**
 * The query for a Slack `search` descriptor (FR-006). Non-secret: the search query + the
 * synthetic forward page cursor (`page+1`, surfaced as a string). Mirrors
 * {@link SlackSearchParams}.
 */
export interface SlackSearchAdapterQuery extends AdapterQuery {
  /** The keyword query the search surface reads (non-secret). */
  query: string
  /** Opaque forward cursor — `search.messages` synthetic `page+1`; absent on page one. */
  cursor?: string
}

/**
 * A Slack adapter descriptor — the {@link AdapterDescriptor} narrowed to Slack's three
 * read sources (FR-005/FR-006). Discriminated by `dataSource`. Secret-free (FR-005/FR-018).
 */
export type SlackAdapterDescriptor =
  | (AdapterDescriptor & {
      dataSource: typeof SlackAdapterSource.ListChannels
      query: SlackChannelsAdapterQuery
    })
  | (AdapterDescriptor & {
      dataSource: typeof SlackAdapterSource.GetHistory
      query: SlackHistoryAdapterQuery
    })
  | (AdapterDescriptor & {
      dataSource: typeof SlackAdapterSource.Search
      query: SlackSearchAdapterQuery
    })

/**
 * Build a secret-free Slack `listChannels` descriptor for a channel-list surface (FR-006).
 * Carries only the optional opaque cursor — never a token.
 */
export function slackChannelsDescriptor(cursor?: string): SlackAdapterDescriptor {
  return {
    dataSource: SlackAdapterSource.ListChannels,
    query: { ...(cursor ? { cursor } : {}) }
  }
}

/**
 * Build a secret-free Slack `getHistory` descriptor for a message-history surface (FR-006).
 * Carries only the (non-secret) channel id + optional cursor — never a token.
 */
export function slackHistoryDescriptor(channelId: string, cursor?: string): SlackAdapterDescriptor {
  return {
    dataSource: SlackAdapterSource.GetHistory,
    query: { channelId, ...(cursor ? { cursor } : {}) }
  }
}

/**
 * Build a secret-free Slack `search` descriptor for a search-results surface (FR-006).
 * Carries only the (non-secret) query + optional synthetic forward cursor — never a token.
 */
export function slackSearchDescriptor(query: string, cursor?: string): SlackAdapterDescriptor {
  return {
    dataSource: SlackAdapterSource.Search,
    query: { query, ...(cursor ? { cursor } : {}) }
  }
}
