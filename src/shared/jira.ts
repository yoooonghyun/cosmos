/**
 * Shared Jira DTOs + the read-only Jira MCP tool contract (Atlassian integration v1).
 *
 * Single source of truth for the Jira content shapes exchanged between the main
 * process, the renderer (over `window.cosmos.jira` IPC), and the Jira MCP tools
 * (over the socket bridge). Every field traces to a read surface in
 * .sdd/specs/atlassian-integration-v1.md (Group J: FR-J04, FR-J06; Group A: FR-A12).
 *
 * Jira generative-UI v1 adds the FIRST write surface (transition + comment): the
 * `jira_transition_issue`/`jira_add_comment` tools, the `jira.*` bound-action
 * contract, and their param/result shapes. The access/refresh token + client_secret
 * STILL NEVER appear here (FR-014, FR-015, SC-009): every field is non-secret
 * content/metadata or a non-secret identifier (issueKey, transitionId, body).
 *
 * This file deliberately mirrors `src/shared/slack.ts` so both surfaces branch on
 * the same `Result<T>`/`Page<T>` discipline.
 */

/* ------------------------------------------------------------------------- *
 * Connection status (shared by the panel + status events)
 * ------------------------------------------------------------------------- */

/**
 * The connection state machine the renderer reflects (FR-A12, design §2.1):
 *   not_connected    — no token; show the Connect button, perform no reads (FR-J03).
 *   connecting       — the browser OAuth flow is in progress (consent + exchange).
 *   connected        — a valid token (refreshed transparently on expiry); reads allowed.
 *   reconnect_needed — refresh itself failed; prompt re-connect (FR-A10, SC-007).
 */
export type JiraConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'reconnect_needed'

/**
 * Connection status surfaced to the renderer (FR-A12). Carries only non-secret
 * identity metadata — NEVER the token, refresh token, or client_secret (FR-A11, SC-009).
 */
export interface JiraConnectionStatus {
  /** Current connection state. */
  state: JiraConnectionState
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
 * Status-category mapping (design §3.1 / Open Question Q3)
 * ------------------------------------------------------------------------- */

/**
 * Normalized Jira status category driving the panel's status Badge color (design
 * §3.1). Mapped in the client/manager from `fields.status.statusCategory.key`
 * (`new`→`todo`, `indeterminate`→`in_progress`, `done`→`done`, else `unknown`) so
 * the panel never parses raw, localizable status names. Color is never the sole
 * carrier — the Badge always shows the status name (design §7).
 */
export type JiraStatusCategory = 'todo' | 'in_progress' | 'done' | 'unknown'

/* ------------------------------------------------------------------------- *
 * Read-surface DTOs (FR-J04)
 * ------------------------------------------------------------------------- */

/** A person on an issue (assignee/reporter/comment author), non-secret (FR-J04). */
export interface JiraUserRef {
  /** Atlassian accountId (stable identity; not a secret). */
  accountId: string
  /** Resolved display name when available, else the accountId. */
  displayName: string
}

/**
 * One issue in a search result list (FR-J04: key, summary, status, assignee).
 * `statusCategory` is the normalized category for the status Badge (design §3.1).
 */
export interface JiraIssueSummary {
  /** Issue key (e.g. `PROJ-123`). */
  key: string
  /** Issue summary (one-line title). */
  summary: string
  /** Raw status name shown on the Badge (e.g. `In Progress`). */
  statusName: string
  /** Normalized status category for the Badge color (design §3.1). */
  statusCategory: JiraStatusCategory
  /** Assignee, absent when unassigned (panel shows "Unassigned"). */
  assignee?: JiraUserRef
}

/** A single comment on an issue (FR-J04 "comments in order"). */
export interface JiraComment {
  /** Comment id (stable within an issue). */
  id: string
  /** Comment author, absent when the API omits it. */
  author?: JiraUserRef
  /** Comment body as flattened, plain readable text (ADF → text; design Q1). */
  body: string
  /** ISO-8601 creation timestamp when present (panel renders a short time). */
  created?: string
}

/**
 * One workflow transition currently available on an issue (Jira generative-UI v1,
 * D3 / FR-020). Read alongside the issue so the composing agent (and the main-side
 * surface builder) can offer a concrete, valid `transitionId` to `jira.transition`.
 * Transitions are workflow-specific and NOT derivable from `JiraStatusCategory`
 * alone (the category is a destination class, not a transition).
 *
 * Mapped from `GET /issue/{key}/transitions` (`{ transitions: [...] }`): `id`,
 * `name`, and — when present — the destination status name/category. Carries no
 * secret.
 */
export interface JiraTransition {
  /** Transition id to POST back (workflow-specific; e.g. `31`). */
  id: string
  /** Human-readable transition name (e.g. `Start Progress`, `Done`). */
  name: string
  /** Destination status name when the API supplies `to.name` (else absent). */
  toStatusName?: string
  /** Normalized destination status category when `to.statusCategory` is present. */
  toStatusCategory?: JiraStatusCategory
}

/**
 * Full issue detail (FR-J04: summary, status, assignee, reporter, description,
 * comments in order). `description` is flattened ADF → plain text (design Q1).
 */
export interface JiraIssueDetail {
  /** Issue key (e.g. `PROJ-123`). */
  key: string
  /** Issue summary. */
  summary: string
  /** Raw status name. */
  statusName: string
  /** Normalized status category (design §3.1). */
  statusCategory: JiraStatusCategory
  /** Assignee, absent when unassigned. */
  assignee?: JiraUserRef
  /** Reporter, absent when the API omits it. */
  reporter?: JiraUserRef
  /** Description as flattened, plain readable text; '' when empty (design Q1). */
  description: string
  /** Comments in order (first page returned by the issue payload). */
  comments: JiraComment[]
  /**
   * Canonical, NON-SECRET browse URL for this issue (jira-dock-autoapply-weblink-v1,
   * FR-010/FR-011). Assembled in MAIN as `<siteUrl>/browse/<KEY>` from the connected
   * site URL already held in the token set — NEVER a token or secret. Omitted (absent)
   * when the site URL is unavailable or the assembled value is not an absolute `http(s)`
   * URL (degrade-to-omit, mirroring Confluence's `webUrl`). The dock header renders it as
   * an external link; the list/board path never binds it (dock-only — FR-012/FR-020).
   */
  webUrl?: string
  /**
   * Transitions currently available on this issue (Jira generative-UI v1, D3 /
   * FR-020). Empty when none are available or the transitions read failed (a
   * failed transitions read MUST NOT fail the whole issue read). The surface
   * builder offers these as the `jira.transition` choices; main treats a stale id
   * as a write failure, never a crash (FR-017).
   */
  availableTransitions: JiraTransition[]
}

/* ------------------------------------------------------------------------- *
 * Paged read results — cursor pagination (FR-J04, plan §B)
 * ------------------------------------------------------------------------- */

/**
 * A page of results plus the cursor for the next page. `nextCursor` is absent when
 * there are no more pages. Maps Jira's `nextPageToken`/`isLast` (search) into the
 * same opaque-cursor model the panel's "Load more" consumes (plan: shared `Page<T>`).
 */
export interface JiraPage<T> {
  /** The items on this page. */
  items: T[]
  /** Opaque cursor for the next page, or absent when no more pages exist. */
  nextCursor?: string
}

/* ------------------------------------------------------------------------- *
 * Read operation results — discriminated union (FR-X06, FR-X07, SC-007, SC-010)
 * ------------------------------------------------------------------------- */

/**
 * Why a Jira read could not complete. Both surfaces map these to graceful,
 * recoverable states; never a crash, hang, or stack trace (FR-X07, SC-007, SC-010).
 *   not_connected        — no token; "connect Jira in cosmos first" (FR-J06).
 *   reconnect_needed     — refresh failed; prompt re-connect (FR-A10, SC-007).
 *   rate_limited         — Atlassian 429; honor Retry-After, "busy, retry shortly" (FR-X07).
 *   network              — transient network/HTTP error; recoverable Retry (FR-X07).
 *   write_not_authorized — the stored token lacks `write:jira-work`; the write was
 *                          NOT attempted. The surface prompts the user to reconnect
 *                          Jira to enable actions (Jira generative-UI v1, D4 / FR-013).
 */
export type JiraErrorKind =
  | 'not_connected'
  | 'reconnect_needed'
  | 'rate_limited'
  | 'network'
  | 'write_not_authorized'

/**
 * The human-readable, non-secret message for the `write_not_authorized` scope-gap
 * state (D4 / FR-013). Centralized so the manager (which mints the error) and the
 * surface builder (which renders the notice) never disagree. Points the user at
 * the native Jira panel's existing Connect/Reconnect affordance — there is no
 * second OAuth entry point on the surface (D4).
 */
export const JIRA_WRITE_NOT_AUTHORIZED_MESSAGE =
  'Reconnect Jira to enable actions. Open the Jira panel and choose Reconnect.'

/** The OAuth scope a write requires; absent on read-only-era tokens (D4 / FR-012). */
export const JIRA_WRITE_SCOPE = 'write:jira-work'

/** A failed Jira read (FR-X07). Carries NO secret (FR-X02, SC-009). */
export interface JiraError {
  /** Discriminates a failure result from `ok`. */
  ok: false
  /** Why the read failed. */
  kind: JiraErrorKind
  /** Human-readable, non-alarming message for the panel / tool result. */
  message: string
  /** For `rate_limited`: seconds to wait before retrying (Atlassian Retry-After). */
  retryAfterSeconds?: number
}

/** A successful Jira read carrying its typed data (FR-J04). */
export interface JiraOk<T> {
  /** Discriminates a success result from an error. */
  ok: true
  /** The read's typed data. */
  data: T
}

/**
 * Every Jira read returns this discriminated result so both surfaces branch on
 * `ok` and degrade gracefully on failure (FR-X06, SC-007, SC-009).
 */
export type JiraResult<T> = JiraOk<T> | JiraError

/* ------------------------------------------------------------------------- *
 * Read operation parameter shapes (shared by IPC + MCP tool surfaces)
 * ------------------------------------------------------------------------- */

/** Params for a JQL issue search (FR-J04, FR-J06). */
export interface JiraSearchParams {
  /** The JQL query string. */
  jql: string
  /** Cursor (Jira `nextPageToken`) for the next page; absent for the first page. */
  cursor?: string
}

/** Params for reading a single issue's detail (FR-J04, FR-J06). */
export interface JiraGetIssueParams {
  /** The issue id or key (e.g. `PROJ-123`). */
  issueKey: string
}

/* ------------------------------------------------------------------------- *
 * Write operation parameter shapes (Jira generative-UI v1)
 *
 * The SINGLE contract shared by BOTH write callers (FR-005, FR-008): the
 * deterministic `jira.*` dispatcher AND the write MCP tools. Centralized here so
 * the dispatcher, the bridge, the MCP entry script, and the manager never disagree
 * on a field. Carry only non-secret content/identifiers — never a token (FR-015).
 * ------------------------------------------------------------------------- */

/**
 * Params to transition an issue to another status (FR-005, FR-020). `transitionId`
 * is a concrete, workflow-specific id resolved from {@link JiraTransition} (D3); a
 * stale/unknown id is treated as a write failure, never a crash (FR-017).
 */
export interface JiraTransitionParams {
  /** The issue key (e.g. `PROJ-123`). */
  issueKey: string
  /** The transition id to apply (from the issue's `availableTransitions`). */
  transitionId: string
}

/** Params to add a comment to an issue (FR-005). `body` is non-empty plain text. */
export interface JiraCommentParams {
  /** The issue key (e.g. `PROJ-123`). */
  issueKey: string
  /** The comment body as plain text (wrapped minimally as ADF by the client). */
  body: string
}

/**
 * Params to CREATE a new issue (Jira write-extend v1, FR-002, FR-005). The fixed
 * minimal field set ONLY — no createmeta-driven discovery, no arbitrary fields
 * (FR-002). Every field is non-secret content/identifier (FR-016). `description`
 * is plain text wrapped as ADF by the client (FR-011).
 */
export interface JiraCreateParams {
  /** The project key the issue is created in (e.g. `PROJ`). Required, non-empty. */
  projectKey: string
  /** The issue type *name* (e.g. `Task`, `Bug`). Required, non-empty. */
  issueType: string
  /** The issue summary (one-line title). Required, non-empty / non-whitespace. */
  summary: string
  /** The issue description as plain text; `''` when omitted (FR-002). */
  description: string
}

/**
 * The editable fields an update MAY change (Jira write-extend v1, FR-003). An
 * update carries ONLY the fields the user actually changed (the surface diffs
 * against the seeded values); an empty `fields` dispatches NO write (FR-003,
 * FR-006). `assignee` is `{ accountId }` only (no display-name search — out of
 * scope); the v1 edit form omits the assignee control (design §2 note B), but the
 * type can carry it so a future picker needs no contract change.
 */
export interface JiraUpdateFields {
  /** New summary when changed (non-whitespace — a required field can't be blanked). */
  summary?: string
  /** New description (plain text, wrapped as ADF by the client) when changed. */
  description?: string
  /** New assignee by accountId when changed (`{ accountId }` only — FR-003). */
  assignee?: { accountId: string }
}

/**
 * Params to UPDATE an existing issue's fields (Jira write-extend v1, FR-003,
 * FR-005). `fields` carries only the changed editable fields; an empty `fields` is
 * rejected by `validateJiraUpdate` (FR-006). Non-secret identifiers/content only.
 */
export interface JiraUpdateParams {
  /** The issue key to edit (e.g. `PROJ-123`). Required, non-empty. */
  issueKey: string
  /** The changed editable fields (non-empty — FR-003, FR-006). */
  fields: JiraUpdateFields
}

/* ------------------------------------------------------------------------- *
 * Write result data types (FR-010 — same JiraResult<T> discipline as reads)
 * ------------------------------------------------------------------------- */

/**
 * Success data for `transitionIssue` (FR-010). The REST transition endpoint returns
 * no body, so success carries only the applied id; the dispatcher re-reads the
 * issue to render the real post-write status (D1).
 */
export interface JiraTransitionResult {
  /** Echoes the applied transition id (confirmation; non-secret). */
  transitionId: string
}

/** Success data for `addComment` (FR-010): the newly created comment (FR-J04 shape). */
export type JiraAddCommentResult = JiraComment

/**
 * Success data for `createIssue` (Jira write-extend v1, FR-010, OQ1). The
 * `POST /rest/api/3/issue` response includes the new issue key; the dispatcher
 * re-reads it via {@link JiraIssueDetail} to compose the post-create detail surface
 * (OQ1). Echoes only the non-secret key.
 */
export interface JiraCreateResult {
  /** The newly created issue key (e.g. `PROJ-456`). */
  key: string
}

/**
 * Success data for `updateIssue` (Jira write-extend v1, FR-010). The
 * `PUT /rest/api/3/issue/{key}` endpoint returns no body, so success carries only
 * the edited key; the dispatcher re-reads the issue to render the real post-write
 * values (FR-007), mirroring transition/comment.
 */
export interface JiraUpdateResult {
  /** Echoes the edited issue key (confirmation; non-secret). */
  issueKey: string
}

/* ------------------------------------------------------------------------- *
 * Bound-action contract — the reserved `jira.*` namespace (FR-004, FR-005)
 *
 * A surface action whose `name` is in this namespace is deterministically bound:
 * main intercepts it at the `ui:action` boundary and executes the write itself via
 * JiraManager, WITHOUT re-invoking `claude` (FR-004). The action name + its required
 * context fields are the single contract shared by main's dispatcher and any surface
 * that emits the action (FR-005) — never an ad-hoc string literal.
 * ------------------------------------------------------------------------- */

/**
 * The reserved bound-action names (FR-005). A surface control emits one of these as
 * its action `name`; main matches on it to dispatch deterministically. Both share
 * the `jira.` prefix — see {@link JIRA_BOUND_ACTION_PREFIX} for the namespace test.
 */
export const JiraBoundAction = {
  /** Transition an issue; context `{ issueKey, transitionId }` (FR-005). */
  Transition: 'jira.transition',
  /** Comment on an issue; context `{ issueKey, body }` (FR-005). */
  Comment: 'jira.comment',
  /** Create an issue; context `{ projectKey, issueType, summary, description }` (FR-004/005). */
  Create: 'jira.create',
  /** Update an issue's fields; context `{ issueKey, fields }` (FR-004/005). */
  Update: 'jira.update'
} as const

export type JiraBoundActionName = (typeof JiraBoundAction)[keyof typeof JiraBoundAction]

/** The reserved namespace prefix main discriminates on at the `ui:action` boundary. */
export const JIRA_BOUND_ACTION_PREFIX = 'jira.'

/** True when an `actionId` is in the reserved `jira.*` namespace (FR-004). */
export function isJiraBoundActionId(actionId: string | undefined): boolean {
  return typeof actionId === 'string' && actionId.startsWith(JIRA_BOUND_ACTION_PREFIX)
}

/**
 * A validated bound action, discriminated by `name`, ready for the dispatcher to
 * execute (FR-006). Produced by `validateJiraBoundAction` from a validated
 * `ui:action`; an unknown name / missing field never yields one (warn + ignore).
 */
export type JiraBoundActionRequest =
  | { name: typeof JiraBoundAction.Transition; params: JiraTransitionParams }
  | { name: typeof JiraBoundAction.Comment; params: JiraCommentParams }
  | { name: typeof JiraBoundAction.Create; params: JiraCreateParams }
  | { name: typeof JiraBoundAction.Update; params: JiraUpdateParams }

/* ------------------------------------------------------------------------- *
 * Adapter descriptor — Jira concrete shapes (jira-generative-adapter-v1, FR-008)
 *
 * The Jira wiring of the SHARED, secret-free `AdapterDescriptor` (`src/shared/adapter.ts`).
 * `dataSource` maps to a JiraManager READ (`searchIssues` for list/search/default,
 * `getIssue` for detail); `query` carries only non-secret JQL/cursor or issueKey —
 * never a token (FR-007/FR-008). Persisted in the tab snapshot + carried on the
 * `adapter.*` dispatch path; the dispatcher's Jira resolver maps it back to the read.
 * ------------------------------------------------------------------------- */

import type { AdapterDescriptor, AdapterQuery } from './adapter'

/**
 * The Jira `dataSource` discriminators (FR-008). Each maps 1:1 to a JiraManager READ
 * the adapter dispatcher's Jira resolver re-executes. Reused from {@link JiraOp} so
 * the descriptor, the resolver, and the IPC reads never disagree on a string.
 */
export const JiraAdapterSource = {
  /** List/search/default surfaces → `searchIssues(jql, cursor)` (FR-008). */
  SearchIssues: 'searchIssues',
  /** Issue-detail surface → `getIssue(issueKey)` (FR-008). */
  GetIssue: 'getIssue'
} as const

export type JiraAdapterSourceName =
  (typeof JiraAdapterSource)[keyof typeof JiraAdapterSource]

/**
 * The query for a Jira `searchIssues` descriptor (FR-008). Non-secret: the JQL the
 * surface was composed from + an optional opaque cursor for pagination. Mirrors
 * {@link JiraSearchParams} so the resolver passes it straight through.
 */
export interface JiraSearchAdapterQuery extends AdapterQuery {
  /** The JQL the list/search/default surface reads (non-secret). */
  jql: string
  /** Opaque next-page cursor (Jira `nextPageToken`); absent on the first page. */
  cursor?: string
}

/**
 * The query for a Jira `getIssue` descriptor (FR-008). Non-secret: just the issue key
 * to re-read. Mirrors {@link JiraGetIssueParams}.
 */
export interface JiraGetIssueAdapterQuery extends AdapterQuery {
  /** The issue key to re-read (e.g. `PROJ-123`); non-secret. */
  issueKey: string
}

/**
 * A Jira adapter descriptor — the {@link AdapterDescriptor} narrowed to Jira's two
 * read sources (FR-005/FR-008). Discriminated by `dataSource`. Secret-free (FR-007).
 */
export type JiraAdapterDescriptor =
  | (AdapterDescriptor & {
      dataSource: typeof JiraAdapterSource.SearchIssues
      query: JiraSearchAdapterQuery
    })
  | (AdapterDescriptor & {
      dataSource: typeof JiraAdapterSource.GetIssue
      query: JiraGetIssueAdapterQuery
    })

/**
 * Build a secret-free Jira `searchIssues` descriptor for a list/search/default surface
 * (FR-008). Carries only the JQL + (optionally) the cursor — never a token.
 */
export function jiraSearchDescriptor(jql: string, cursor?: string): JiraAdapterDescriptor {
  return {
    dataSource: JiraAdapterSource.SearchIssues,
    query: { jql, ...(cursor ? { cursor } : {}) }
  }
}

/**
 * Build a secret-free Jira `getIssue` descriptor for an issue-detail surface (FR-008).
 * Carries only the issue key — never a token.
 */
export function jiraGetIssueDescriptor(issueKey: string): JiraAdapterDescriptor {
  return { dataSource: JiraAdapterSource.GetIssue, query: { issueKey } }
}

/* ------------------------------------------------------------------------- *
 * Read-only MCP tool contract (FR-J06, FR-X01)
 * ------------------------------------------------------------------------- */

/**
 * The Jira MCP tool names. Centralized so the entry script, the bridge, and the
 * manager never disagree on a string literal (FR-X06, FR-009). The two read tools
 * are unchanged (FR-018); the two WRITE tools (Jira generative-UI v1, FR-008) MUTATE
 * Jira (transition an issue, add a comment) and reach the SAME `JiraManager` write
 * methods as deterministic `jira.*` dispatch — one write implementation, two callers.
 */
export const JiraTool = {
  /** Search issues by JQL (paginated). Read-only. */
  SearchIssues: 'jira_search_issues',
  /** Get one issue's full detail (incl. comments + available transitions). Read-only. */
  GetIssue: 'jira_get_issue',
  /** Transition an issue to another status. MUTATES Jira (FR-008). */
  TransitionIssue: 'jira_transition_issue',
  /** Add a comment to an issue. MUTATES Jira (FR-008). */
  AddComment: 'jira_add_comment',
  /** Create a new issue. MUTATES Jira (Jira write-extend v1, FR-008). */
  CreateIssue: 'jira_create_issue',
  /** Update an existing issue's fields. MUTATES Jira (Jira write-extend v1, FR-008). */
  UpdateIssue: 'jira_update_issue'
} as const

export type JiraToolName = (typeof JiraTool)[keyof typeof JiraTool]

/**
 * The bridge-level Jira operation discriminator. Each maps 1:1 to a JiraManager
 * method; both the MCP tools and the IPC handlers route through these so the single
 * main-process client serves both surfaces (FR-A13). The two write ops
 * (`transitionIssue`/`addComment`) are the model-mediated path's relay to the same
 * write methods deterministic dispatch uses (FR-008).
 */
export const JiraOp = {
  SearchIssues: 'searchIssues',
  GetIssue: 'getIssue',
  TransitionIssue: 'transitionIssue',
  AddComment: 'addComment',
  CreateIssue: 'createIssue',
  UpdateIssue: 'updateIssue'
} as const

export type JiraOpName = (typeof JiraOp)[keyof typeof JiraOp]
