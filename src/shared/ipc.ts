/**
 * Shared IPC contract (cosmos PoC milestones 1 & 2).
 *
 * This module is the single source of truth for the channel names and payload
 * types exchanged between the Electron main process and the renderer, bridged by
 * the preload `contextBridge`.
 *
 * Milestone 1 (Terminal Panel): every Pty* type traces to an FR in
 * .sdd/specs/terminal-panel-v1.md.
 * Milestone 2 (render_ui MCP + Generated-UI panel): every Ui and A2ui type
 * traces to an FR in .sdd/specs/render-ui-v1.md.
 * No field exists that a spec does not require.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type { UpdateComponentsPayload } from '@a2ui-sdk/types/0.9'

/**
 * Channel name constants. Centralized so main, preload, and renderer never
 * disagree on a string literal.
 */
export const PtyChannel = {
  /** M->R: a chunk of raw PTY output bytes (ANSI included). FR-002. */
  Data: 'pty:data',
  /** R->M: keyboard input from xterm.js to the PTY stdin. FR-004. */
  Input: 'pty:input',
  /** R->M: terminal resize (cols, rows) from the renderer to the PTY. FR-005. */
  Resize: 'pty:resize',
  /** M->R: the `claude` process exited / failed to start. FR-007 + edge case. */
  Exit: 'pty:exit',
  /** R->M: request a fresh `claude` session for the given pane. FR-008, FR-026. */
  Restart: 'pty:restart',
  /**
   * R->M: spawn a NEW PTY session for a freshly-opened terminal tab (panel-tabs
   * v1, FR-021/FR-022). Each terminal tab is its own live `claude` process keyed
   * by a renderer-minted `paneId`; the renderer issues this on tab create. (The
   * single PTY is no longer auto-started at window create — every pane starts via
   * an explicit `pty:start`.)
   */
  Start: 'pty:start',
  /**
   * R->M: dispose/kill a terminal tab's PTY session on tab close (panel-tabs v1,
   * FR-023). Kills exactly that `paneId`'s `claude` process; no exit event is
   * emitted back (the tab is gone).
   */
  Dispose: 'pty:dispose'
} as const

export type PtyChannelName = (typeof PtyChannel)[keyof typeof PtyChannel]

/**
 * M->R. A chunk of raw PTY output. `data` is the terminal byte stream encoded
 * as a UTF-8 string (xterm.js `write` accepts string). FR-002, FR-003.
 *
 * `paneId` identifies WHICH terminal tab's PTY produced the output so the
 * renderer routes it to the matching xterm instance (panel-tabs v1, FR-021/FR-025).
 */
export interface PtyDataPayload {
  /** Which terminal tab's PTY produced this output (panel-tabs v1, FR-021). */
  paneId: string
  /** Raw terminal output, including ANSI escape sequences. */
  data: string
}

/**
 * R->M. Keyboard input destined for the PTY stdin. FR-004.
 *
 * `paneId` routes the input to the correct terminal tab's PTY (panel-tabs v1,
 * FR-021).
 */
export interface PtyInputPayload {
  /** Which terminal tab's PTY to write to (panel-tabs v1, FR-021). */
  paneId: string
  /** The bytes the user typed, as produced by xterm.js `onData`. */
  data: string
}

/**
 * R->M. New terminal dimensions for one terminal tab's PTY. FR-005.
 *
 * `paneId` routes the resize to the correct terminal tab's PTY (panel-tabs v1,
 * FR-021).
 */
export interface PtyResizePayload {
  /** Which terminal tab's PTY to resize (panel-tabs v1, FR-021). */
  paneId: string
  /** Number of columns; MUST be a positive integer. */
  cols: number
  /** Number of rows; MUST be a positive integer. */
  rows: number
}

/**
 * R->M. Spawn a new PTY session for a freshly-opened terminal tab (panel-tabs
 * v1, FR-021/FR-022) or dispose one on tab close (FR-023). Carries only the
 * renderer-minted `paneId` that keys the session.
 */
export interface PtyStartPayload {
  /** The terminal tab's PTY to spawn (panel-tabs v1, FR-021/FR-022). */
  paneId: string
}

/**
 * R->M. Request a fresh `claude` session for one terminal tab (panel-tabs v1,
 * FR-026 — per-tab restart). Carries only the renderer-minted `paneId`.
 */
export interface PtyRestartPayload {
  /** Which terminal tab's PTY to restart (panel-tabs v1, FR-021/FR-026). */
  paneId: string
}

/**
 * R->M. Dispose/kill a terminal tab's PTY session on tab close (panel-tabs v1,
 * FR-023). Carries only the renderer-minted `paneId`.
 */
export interface PtyDisposePayload {
  /** Which terminal tab's PTY to dispose (panel-tabs v1, FR-023). */
  paneId: string
}

/**
 * M->R. Signals that the `claude` process is no longer running. FR-007.
 *
 * Covers both normal exit and the "binary not found" edge case:
 *  - On a normal/abnormal exit, `exitCode` (and optionally `signal`) are set.
 *  - When `claude` could not be started at all, `error` carries a human-readable
 *    message for display in the panel; `exitCode`/`signal` may be absent.
 *
 * All fields are optional because not every exit path provides every detail;
 * the renderer treats the message as best-effort. FR-007, edge case.
 */
export interface PtyExitPayload {
  /** Which terminal tab's PTY exited (panel-tabs v1, FR-021/FR-025). */
  paneId: string
  /** Process exit code, when the process actually started and then exited. */
  exitCode?: number
  /** Terminating signal, if the process was killed by a signal. */
  signal?: number
  /** Human-readable reason (e.g. `claude` not found on PATH). */
  error?: string
}

/**
 * The API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.pty`. FR-006: this is the ONLY main-process surface the
 * renderer can reach.
 *
 * Each `on*` registrar returns an unsubscribe function so the renderer can
 * detach listeners on unmount (avoids leaks / double-binding on HMR).
 */
export interface PtyApi {
  /**
   * R->M. Spawn a new PTY session for a terminal tab (panel-tabs v1,
   * FR-021/FR-022). The renderer mints `paneId` per terminal tab and calls this
   * on tab create (the single PTY is no longer auto-started at window create).
   */
  start(paneId: string): void
  /** R->M. Send keyboard input to a tab's PTY (panel-tabs v1, FR-021). FR-004. */
  sendInput(payload: PtyInputPayload): void
  /** R->M. Notify a tab's PTY of new dimensions (panel-tabs v1, FR-021). FR-005. */
  resize(payload: PtyResizePayload): void
  /** R->M. Request a fresh `claude` session for a tab (panel-tabs v1, FR-026). FR-008. */
  restart(paneId: string): void
  /** R->M. Dispose/kill a terminal tab's PTY on tab close (panel-tabs v1, FR-023). */
  dispose(paneId: string): void
  /**
   * M->R. Subscribe to PTY output for ALL panes; each payload carries its own
   * `paneId` so the renderer routes it to the matching tab (panel-tabs v1,
   * FR-021). Returns an unsubscribe fn. FR-002/FR-003.
   */
  onData(listener: (payload: PtyDataPayload) => void): () => void
  /**
   * M->R. Subscribe to PTY exit/error events for ALL panes; each payload carries
   * its own `paneId` (panel-tabs v1, FR-021). Returns an unsubscribe fn. FR-007.
   */
  onExit(listener: (payload: PtyExitPayload) => void): () => void
}

/* ------------------------------------------------------------------------- *
 * Milestone 2 — render_ui MCP server & Generated-UI panel
 * Spec: .sdd/specs/render-ui-v1.md
 * ------------------------------------------------------------------------- */

/**
 * UI channel name constants for the A2UI Generated-UI panel. FR-008: a single
 * shared interaction contract, consumed by both the MCP bridge and the renderer.
 */
export const UiChannel = {
  /** M->R: push an A2UI surface to render in the panel. FR-004. */
  Render: 'ui:render',
  /** R->M: return the user's interaction (action or cancel) for a surface. FR-006. */
  Action: 'ui:action'
} as const

export type UiChannelName = (typeof UiChannel)[keyof typeof UiChannel]

/**
 * Jira generative-UI v2 — render-target discriminator (D1 / v2 FR-004, FR-012).
 *
 * The EXISTING `ui:render` channel now carries a `target` so MULTIPLE panels can
 * consume it, each hosting its OWN `A2UIProvider`/catalog and FILTERING incoming
 * `ui:render` by `target` (rendering only payloads whose `target` matches its own
 * panel, ignoring the rest). No dedicated Jira channel set is added.
 *
 *  - `'generated-ui'` — the generic Generated-UI panel (standard catalog). The
 *    DEFAULT when a render frame omits `target` (backward-compatible with the
 *    unchanged standard `render_ui`).
 *  - `'jira'` — the native Jira rail panel (the `catalogId: 'jira'` custom catalog).
 *    Set by the deterministic default-view + post-write re-pushes and by the
 *    Jira-scoped `render_jira_ui` tool.
 *  - `'slack'` — the native Slack rail panel (the `catalogId: 'slack'` custom
 *    catalog). Set by the Slack-scoped `render_slack_ui` tool. Display-only / read-only
 *    (Slack + Confluence generative-UI v1, FR-001).
 *  - `'confluence'` — the native Confluence rail panel (the `catalogId: 'confluence'`
 *    custom catalog). Set by the Confluence-scoped `render_confluence_ui` tool.
 *    Display-only / read-only (Slack + Confluence generative-UI v1, FR-001).
 */
export type UiRenderTarget = 'jira' | 'generated-ui' | 'slack' | 'confluence'

/** The default render target when a render frame omits one (D1 / v2 FR-004). */
export const DEFAULT_UI_RENDER_TARGET: UiRenderTarget = 'generated-ui'

/**
 * The A2UI surface payload that `render_ui(spec)` receives and the panel renders
 * (FR-001, FR-005). Typed alias over the installed SDK's 0.9
 * `UpdateComponentsPayload` (`@a2ui-sdk/types/0.9`) — `{ surfaceId, components }`
 * — so cosmos and the SDK never disagree on the surface shape. The panel
 * synthesizes the 0.9 `createSurface` envelope around it at render time.
 */
export type A2uiSurfaceUpdate = UpdateComponentsPayload

/**
 * M->R. Push a surface to the Generated-UI panel. FR-004, FR-012.
 *
 * `requestId` is minted by the main-process bridge per `render_ui` call so the
 * returned action resolves the correct pending call.
 */
export interface UiRenderPayload {
  /** Per-call correlation id minted in main. FR-012. */
  requestId: string
  /** The A2UI surfaceUpdate spec to render. FR-001, FR-005. */
  spec: A2uiSurfaceUpdate
  /**
   * Which panel should render this surface (Jira generative-UI v2, D1 / v2
   * FR-004, FR-012). Each panel filters incoming `ui:render` by this field. Always
   * present on a pushed payload — main defaults it to `'generated-ui'` when the
   * originating render frame omits a target (backward-compatible). NO secret.
   */
  target: UiRenderTarget
}

/**
 * The user's interaction with a surface, mapped from the A2UI SDK's
 * `ActionPayload` (renderer) or generated by the panel's own dismiss affordance.
 * FR-006, FR-009.
 *
 *  - `type: 'submit'` — a control fired. `actionId` is the SDK action name (the
 *    control that fired); `values` is the action's resolved context/form data.
 *  - `type: 'cancel'` — the user dismissed/cancelled without acting (FR-009);
 *    `actionId`/`values` are absent.
 */
export interface A2uiAction {
  /** Discriminates a completed action from an explicit cancel. FR-006, FR-009. */
  type: 'submit' | 'cancel'
  /** Which control fired (SDK action `name`). Present for `submit`. FR-006. */
  actionId?: string
  /** Associated values (e.g. form fields / SDK action context). FR-006. */
  values?: Record<string, unknown>
}

/**
 * R->M. Return the user's interaction for a surface. FR-006, FR-012.
 * The `requestId` echoes the one from the matching `UiRenderPayload`.
 */
export interface UiActionPayload {
  /** Correlates to the pushed surface's requestId. FR-012. */
  requestId: string
  /** The user's interaction. FR-006, FR-009. */
  action: A2uiAction
}

/**
 * The UI API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.ui`, alongside (not merged into) `window.cosmos.pty`. FR-011.
 */
export interface UiApi {
  /**
   * M->R. Subscribe to pushed surfaces. Returns an unsubscribe fn so the panel
   * can detach on unmount (avoids leaks / double-binding on HMR). FR-004.
   */
  onRender(listener: (payload: UiRenderPayload) => void): () => void
  /** R->M. Return the user's interaction for a surface. FR-006, FR-009. */
  sendAction(payload: UiActionPayload): void
}

/* ------------------------------------------------------------------------- *
 * Slack integration — native panel IPC surface
 * Spec: .sdd/specs/slack-integration-v1.md
 * ------------------------------------------------------------------------- */

import type {
  SlackChannel,
  SlackConnectionStatus,
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackMessage,
  SlackPage,
  SlackRepliesParams,
  SlackResult,
  SlackSearchMatch,
  SlackSearchParams,
  SlackUser
} from './slack'

/**
 * Slack IPC channel name constants (FR-025). The reads are request/response via
 * `ipcRenderer.invoke`/`ipcMain.handle` (unlike PTY's streaming send); only
 * `StatusChanged` is a fire-and-forget M->R event for live connection state.
 *
 * NO channel carries the access token in either direction (FR-006, SC-008): the
 * renderer requests *operations*; main attaches the token.
 */
export const SlackChannelName = {
  /** R->M (invoke): current connection status. FR-007. */
  GetStatus: 'slack:getStatus',
  /** R->M (invoke): run the desktop OAuth flow (opens the browser); resolves with the new status. FR-001. */
  Connect: 'slack:connect',
  /** R->M (invoke): delete the stored token; resolves with not-connected status. FR-009. */
  Disconnect: 'slack:disconnect',
  /** R->M (invoke): list public channels (paginated). FR-013. */
  ListChannels: 'slack:listChannels',
  /** R->M (invoke): read a channel's recent history (paginated). FR-013. */
  GetHistory: 'slack:getHistory',
  /** R->M (invoke): read a thread's replies (paginated). FR-013. */
  GetReplies: 'slack:getReplies',
  /** R->M (invoke): keyword message search. FR-015. */
  Search: 'slack:search',
  /** R->M (invoke): resolve a user id to a display name. FR-014. */
  GetUser: 'slack:getUser',
  /** M->R (event): connection status changed (e.g. connect finished, reconnect needed). FR-007. */
  StatusChanged: 'slack:statusChanged'
} as const

export type SlackChannelNameValue =
  (typeof SlackChannelName)[keyof typeof SlackChannelName]

/**
 * The Slack API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.slack`, alongside (not merged into) `pty` and `ui` (FR-007).
 *
 * Every read resolves with a `SlackResult<T>` so the panel branches on `ok` and
 * degrades gracefully (FR-016, FR-020, FR-026). No method takes or returns a
 * token (FR-006, SC-008).
 */
export interface SlackApi {
  /** R->M. Current connection status. FR-007. */
  getStatus(): Promise<SlackConnectionStatus>
  /** R->M. Run the desktop OAuth flow (opens the browser); resolves with the resulting status. FR-001, FR-002. */
  connect(): Promise<SlackConnectionStatus>
  /** R->M. Delete the stored token; resolves with not-connected status. FR-009. */
  disconnect(): Promise<SlackConnectionStatus>
  /** R->M. List public channels (paginated). FR-013. */
  listChannels(params: SlackListChannelsParams): Promise<SlackResult<SlackPage<SlackChannel>>>
  /** R->M. Read a channel's recent history (paginated). FR-013. */
  getHistory(params: SlackHistoryParams): Promise<SlackResult<SlackPage<SlackMessage>>>
  /** R->M. Read a thread's replies (paginated). FR-013. */
  getReplies(params: SlackRepliesParams): Promise<SlackResult<SlackPage<SlackMessage>>>
  /** R->M. Keyword message search. FR-015. */
  search(params: SlackSearchParams): Promise<SlackResult<SlackPage<SlackSearchMatch>>>
  /** R->M. Resolve a user id to a display name. FR-014. */
  getUser(params: SlackGetUserParams): Promise<SlackResult<SlackUser>>
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so
   * the panel can detach on unmount (avoids leaks / double-binding on HMR). FR-007.
   */
  onStatusChanged(listener: (status: SlackConnectionStatus) => void): () => void
}

/* ------------------------------------------------------------------------- *
 * Atlassian — Jira native panel IPC surface
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group A FR-A12, Group J)
 * ------------------------------------------------------------------------- */

import type {
  JiraConnectionStatus,
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraSearchParams
} from './jira'

/**
 * Jira IPC channel name constants (FR-X06). Reads are request/response via
 * `ipcRenderer.invoke`/`ipcMain.handle`; only `StatusChanged` is a fire-and-forget
 * M->R event for live connection state. NO channel carries a token in either
 * direction (FR-A11, SC-009): the renderer requests *operations*; main attaches
 * the token.
 */
export const JiraChannelName = {
  /** R->M (invoke): current connection status. FR-A12. */
  GetStatus: 'jira:getStatus',
  /** R->M (invoke): run the desktop OAuth flow (opens the browser); resolves with the new status. FR-A01. */
  Connect: 'jira:connect',
  /** R->M (invoke): delete the stored token; resolves with not-connected status. FR-A14. */
  Disconnect: 'jira:disconnect',
  /** R->M (invoke): search issues by JQL (paginated). FR-J04. */
  SearchIssues: 'jira:searchIssues',
  /** R->M (invoke): read one issue's detail. FR-J04. */
  GetIssue: 'jira:getIssue',
  /**
   * R->M (send): the Jira panel became the active rail surface; main re-composes
   * the default recent-issues view and pushes it with `target: 'jira'` (Jira
   * generative-UI v2, D4 / v2 FR-002, FR-019, FR-020). Fire-and-forget — the rail
   * switch never blocks on the read.
   */
  RequestDefaultView: 'jira:requestDefaultView',
  /**
   * R->M (send): the Jira panel's native JQL search box was submitted; main runs the
   * SAME bounded read/compose/push as the default view but for the supplied JQL
   * (jira-jql-search-v1, FR-003). Carries `{ jql }`; main trims it and falls back to the
   * my-tickets default JQL when empty/whitespace (FR-005). Deterministic — NOT an
   * `AgentRunner` run. Fire-and-forget — the surface arrives via `ui:render`
   * (`target: 'jira'`) as an unsolicited frame into the active tab; never blocks.
   */
  RequestSearchView: 'jira:requestSearchView',
  /**
   * R->M (send): a `TicketCard` in the Jira panel's `IssueList` was clicked to open its
   * full detail in place (jira-ticket-detail-v1, FR-003/FR-010). Carries `{ issueKey }`;
   * main runs the deterministic native `getIssue` read and composes the result through
   * `buildIssueDetailSurface`, pushed with `target: 'jira'` as an UNSOLICITED frame into
   * the active tab. Read-only — NOT an `AgentRunner` run, no new OAuth scope, no token on
   * the payload (FR-010). Fire-and-forget — the surface arrives via `ui:render`
   * (`target: 'jira'`); never blocks. Parallels `RequestSearchView`.
   */
  RequestIssueDetail: 'jira:requestIssueDetail',
  /** M->R (event): connection status changed. FR-A12. */
  StatusChanged: 'jira:statusChanged'
} as const

export type JiraChannelNameValue =
  (typeof JiraChannelName)[keyof typeof JiraChannelName]

/**
 * R->M. The Jira panel's per-switch default-view request (Jira generative-UI v2,
 * D4 / v2 FR-002). Carries NO field — it is a pure "I was switched to" trigger;
 * main owns the default JQL, the bounded single-page read, and the deterministic
 * compose. NO secret-bearing field (v2 FR-017).
 */
export type JiraRequestDefaultViewPayload = Record<string, never>

/**
 * R->M. The Jira panel's native JQL search submit (jira-jql-search-v1, FR-003). Carries
 * ONLY the raw `jql` string the user typed (FR-011 — no token/secret). An empty or
 * whitespace-only `jql` is the valid "clear to default" case, resolved in MAIN (it
 * trims and falls back to `JIRA_DEFAULT_VIEW_JQL`, FR-005); the payload type itself just
 * requires a string.
 */
export interface JiraRequestSearchViewPayload {
  /** The raw JQL the user typed. Empty/whitespace ⇒ default view (resolved in main). */
  jql: string
}

/**
 * R->M. The Jira panel's click-to-open ticket-detail request (jira-ticket-detail-v1,
 * FR-003/FR-010). Carries ONLY the clicked `issueKey` — the ONLY field; NO token/secret
 * (FR-010). A non-empty `issueKey` is enforced by the boundary validator (an empty key is
 * invalid here — there is no "default detail", unlike the search view's empty⇒default).
 */
export interface JiraRequestIssueDetailPayload {
  /** The clicked ticket's key (e.g. `PROJ-123`). Non-empty — enforced by the validator. */
  issueKey: string
}

/**
 * The Jira API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.jira`, alongside (not merged into) `pty`, `ui`, and `slack`
 * (FR-A12). Every read resolves with a `JiraResult<T>` so the panel branches on
 * `ok` and degrades gracefully. No method takes or returns a token (FR-A11, SC-009).
 */
export interface JiraApi {
  /** R->M. Current connection status. FR-A12. */
  getStatus(): Promise<JiraConnectionStatus>
  /** R->M. Run the desktop OAuth flow (opens the browser); resolves with the resulting status. FR-A01. */
  connect(): Promise<JiraConnectionStatus>
  /** R->M. Delete the stored token; resolves with not-connected status. FR-A14. */
  disconnect(): Promise<JiraConnectionStatus>
  /** R->M. Search issues by JQL (paginated). FR-J04. */
  searchIssues(params: JiraSearchParams): Promise<JiraResult<JiraPage<JiraIssueSummary>>>
  /** R->M. Read one issue's detail. FR-J04. */
  getIssue(params: JiraGetIssueParams): Promise<JiraResult<JiraIssueDetail>>
  /**
   * R->M. Tell main the Jira panel became the active rail surface so it
   * re-composes + pushes the default recent-issues view (Jira generative-UI v2,
   * D4 / v2 FR-002). Fire-and-forget; the surface arrives via `ui:render`
   * (`target: 'jira'`). Never blocks the rail switch.
   */
  requestDefaultView(): void
  /**
   * R->M. Submit the native JQL search box (jira-jql-search-v1, FR-003). Sends the raw
   * `jql` the user typed; main trims it and runs the same read/compose/push as the
   * default view (empty/whitespace ⇒ the my-tickets default view, FR-005).
   * Fire-and-forget; the surface arrives via `ui:render` (`target: 'jira'`) into the
   * active tab. Never blocks. No token on the payload (FR-011).
   */
  requestSearchView(payload: JiraRequestSearchViewPayload): void
  /**
   * R->M. Open a clicked ticket's full detail in place (jira-ticket-detail-v1,
   * FR-003/FR-010). Sends only the `issueKey`; main runs the deterministic `getIssue`
   * read and composes `buildIssueDetailSurface`, pushing it via `ui:render`
   * (`target: 'jira'`) into the active tab. Fire-and-forget; never blocks. Read-only —
   * no new scope, no token on the payload (FR-010). Mirrors `requestSearchView`.
   */
  requestIssueDetail(payload: JiraRequestIssueDetailPayload): void
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so
   * the panel can detach on unmount (avoids leaks / double-binding on HMR). FR-A12.
   */
  onStatusChanged(listener: (status: JiraConnectionStatus) => void): () => void
}

/* ------------------------------------------------------------------------- *
 * Atlassian — Confluence native panel IPC surface
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group A FR-A12, Group C)
 * ------------------------------------------------------------------------- */

import type {
  ConfluenceConnectionStatus,
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult
} from './confluence'

/**
 * Confluence IPC channel name constants (FR-X06). Same request/response +
 * status-event model as Jira; fully separate connection (FR-A13). No channel
 * carries a token (FR-A11, SC-009).
 */
export const ConfluenceChannelName = {
  /** R->M (invoke): current connection status. FR-A12. */
  GetStatus: 'confluence:getStatus',
  /** R->M (invoke): run the desktop OAuth flow; resolves with the new status. FR-A01. */
  Connect: 'confluence:connect',
  /** R->M (invoke): delete the stored token; resolves with not-connected status. FR-A14. */
  Disconnect: 'confluence:disconnect',
  /** R->M (invoke): search content (paginated). FR-C04. */
  SearchContent: 'confluence:searchContent',
  /**
   * R->M (invoke): the default personal activity feed — pages the user @mentions,
   * watches, or favorited, most-recently-modified first (paginated). The fixed
   * personal-scope CQL lives only in the main-process client; this channel's payload
   * carries only an optional cursor (confluence-default-feed v1, FR-006, FR-016).
   */
  DefaultFeed: 'confluence:defaultFeed',
  /** R->M (invoke): read one page's detail. FR-C04. */
  GetPage: 'confluence:getPage',
  /** M->R (event): connection status changed. FR-A12. */
  StatusChanged: 'confluence:statusChanged'
} as const

export type ConfluenceChannelNameValue =
  (typeof ConfluenceChannelName)[keyof typeof ConfluenceChannelName]

/**
 * The Confluence API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.confluence`, alongside (not merged into) `pty`, `ui`, `slack`,
 * and `jira` (FR-A12). Every read resolves with a `ConfluenceResult<T>`. No method
 * takes or returns a token (FR-A11, SC-009).
 */
export interface ConfluenceApi {
  /** R->M. Current connection status. FR-A12. */
  getStatus(): Promise<ConfluenceConnectionStatus>
  /** R->M. Run the desktop OAuth flow; resolves with the resulting status. FR-A01. */
  connect(): Promise<ConfluenceConnectionStatus>
  /** R->M. Delete the stored token; resolves with not-connected status. FR-A14. */
  disconnect(): Promise<ConfluenceConnectionStatus>
  /** R->M. Search content (paginated). FR-C04. */
  searchContent(
    params: ConfluenceSearchParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>
  /**
   * R->M. The default personal activity feed (paginated) — mentions / watches /
   * favorites, most-recently-modified first (confluence-default-feed v1, FR-001,
   * FR-006). Cursor-only params; the personal CQL stays in main. Same result DTO as
   * `searchContent` so the panel's `ContentList` renders either source unchanged.
   */
  defaultFeed(
    params: ConfluenceDefaultFeedParams
  ): Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>
  /** R->M. Read one page's detail. FR-C04. */
  getPage(params: ConfluenceGetPageParams): Promise<ConfluenceResult<ConfluencePageDetail>>
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so the
   * panel can detach on unmount (avoids leaks / double-binding on HMR). FR-A12.
   */
  onStatusChanged(listener: (status: ConfluenceConnectionStatus) => void): () => void
}

/* ------------------------------------------------------------------------- *
 * Generative UI foundation — headless agent runner IPC surface
 * Spec: .sdd/specs/generative-ui-foundation-v1.md
 * ------------------------------------------------------------------------- */

/**
 * Agent channel name constants (FR-009). A dedicated channel set for the headless
 * `claude -p` runner, exposed to the renderer ONLY as `window.cosmos.agent`,
 * alongside (not merged into) the pty/ui/slack/jira/confluence surfaces.
 */
export const AgentChannel = {
  /** R->M: submit a natural-language utterance to compose a surface. FR-002. */
  Submit: 'agent:submit',
  /** M->R: run lifecycle/status (started, completed, error). FR-009, FR-011. */
  Status: 'agent:status'
} as const

export type AgentChannelName = (typeof AgentChannel)[keyof typeof AgentChannel]

/**
 * R->M. Submit an utterance to the headless runner. Carries ONLY the utterance
 * string — nothing else (FR-002).
 */
export interface AgentSubmitPayload {
  /** The user's natural-language utterance. FR-002. */
  utterance: string
  /**
   * Which panel this run composes for (Jira generative-UI v2, D2 / v2 FR-013).
   * The Jira panel's composer submits `'jira'` (the run grants `render_jira_ui`
   * and its render is tagged `target: 'jira'`); the generic composer submits
   * `'generated-ui'` (grants `render_ui`). Absent ⇒ `'generated-ui'`
   * (backward-compatible). NO secret.
   */
  target?: UiRenderTarget
}

/**
 * The lifecycle state of a headless run (FR-009, FR-011):
 *  - `started`   — the headless run has begun (input shows in-progress).
 *  - `completed` — the run exited successfully (input returns to idle).
 *  - `error`     — the run failed or could not start (input shows error, FR-014).
 */
export type AgentRunState = 'started' | 'completed' | 'error'

/**
 * M->R. Run lifecycle/status for the headless runner (FR-009, FR-011). Carries
 * ONLY what the panel needs to display state — NO tokens, secrets, provider
 * credentials, or raw transcript (FR-011, FR-012).
 */
export interface AgentStatusPayload {
  /** The run's lifecycle state. FR-009. */
  state: AgentRunState
  /** Human-readable failure reason; present only for `error` (FR-014). */
  message?: string
}

/**
 * The agent API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.agent`, alongside (not merged into) the other surfaces (FR-009).
 */
export interface AgentApi {
  /** R->M. Submit an utterance for a headless run. FR-002. */
  submit(payload: AgentSubmitPayload): void
  /**
   * M->R. Subscribe to run lifecycle/status. Returns an unsubscribe fn so the
   * panel can detach on unmount (avoids leaks / double-binding on HMR). FR-011.
   */
  onStatus(listener: (payload: AgentStatusPayload) => void): () => void
}

/**
 * Channel for global tab/window keyboard shortcuts (Chrome-style). Key combos
 * are matched in MAIN (via `before-input-event`) so they fire regardless of DOM
 * focus (incl. an xterm-focused terminal) and can be `preventDefault`'d before
 * the renderer/window sees them; main then forwards the resolved command here.
 */
export const ShortcutChannel = {
  /** M->R: a matched shortcut command (e.g. open a tab, switch surface). */
  Trigger: 'shortcut:trigger'
} as const

export type ShortcutChannelName = (typeof ShortcutChannel)[keyof typeof ShortcutChannel]

/**
 * A resolved tab/window shortcut command, dispatched from main to the renderer.
 *  - `tab:new`      — open a new tab in the active rail surface (Cmd+T).
 *  - `tab:close`    — close the active tab in the active rail surface (Cmd+W).
 *  - `tab:next`     — activate the next tab, wrapping (Ctrl+Tab, Cmd+Opt+Right).
 *  - `tab:prev`     — activate the previous tab, wrapping (Ctrl+Shift+Tab, Cmd+Opt+Left).
 *  - `tab:jump`     — activate the tab at `index` (Cmd+1..8 ⇒ index 0..7).
 *  - `tab:last`     — activate the last tab (Cmd+9).
 *  - `surface:next` — switch to the next left-rail surface (Cmd+Shift+]).
 *  - `surface:prev` — switch to the previous left-rail surface (Cmd+Shift+[).
 */
export type ShortcutCommand =
  | 'tab:new'
  | 'tab:close'
  | 'tab:next'
  | 'tab:prev'
  | 'tab:jump'
  | 'tab:last'
  | 'surface:next'
  | 'surface:prev'

/**
 * M->R. A matched shortcut. `index` is present only for `tab:jump` (0-based: the
 * Nth tab to activate). No other payload — the renderer maps the command onto the
 * active surface's existing tab ops.
 */
export interface ShortcutTriggerPayload {
  /** The resolved command. */
  command: ShortcutCommand
  /** 0-based tab index for `tab:jump`; absent for every other command. */
  index?: number
}

/**
 * Shortcut API exposed to the renderer as `window.cosmos.shortcuts`. Renderer is
 * receive-only here; the key matching lives in main.
 */
export interface ShortcutApi {
  /**
   * M->R. Subscribe to resolved shortcut commands. Returns an unsubscribe fn so
   * subscribers can detach on unmount (avoids leaks / double-binding on HMR).
   */
  onTrigger(listener: (payload: ShortcutTriggerPayload) => void): () => void
}

/* ------------------------------------------------------------------------- *
 * Session persistence — on-disk working-session snapshot
 * Spec: .sdd/specs/session-persistence-v1.md
 * ------------------------------------------------------------------------- */

/**
 * Session IPC channel name constants (session-persistence-v1, FR-003).
 *
 * `Load` is request/response (`ipcRenderer.invoke`/`ipcMain.handle`) — read once
 * at startup. `Save` is fire-and-forget (`ipcRenderer.send`/`ipcMain.on`) — the
 * renderer pushes the debounced snapshot on change (FR-007). NO channel carries
 * a secret in either direction (FR-006): the snapshot is non-secret structure.
 */
export const SessionChannel = {
  /** R->M (invoke): read the persisted snapshot at startup; null when absent/corrupt. FR-001/FR-005. */
  Load: 'session:load',
  /** R->M (send): persist the latest snapshot (debounced on change). FR-001/FR-007. */
  Save: 'session:save'
} as const

export type SessionChannelName =
  (typeof SessionChannel)[keyof typeof SessionChannel]

/**
 * The current on-disk snapshot schema version (session-persistence-v1, FR-002).
 * Bump on any breaking shape change; main treats a non-matching version as
 * unreadable → warn + clean empty session (FR-002/FR-005).
 */
export const SESSION_SCHEMA_VERSION = 1

/**
 * One terminal tab's persisted state (FR-008/FR-018/FR-019/FR-021).
 *
 * The `id` IS the renderer-minted `paneId` that keys the live PTY session; on
 * relaunch the same id re-binds the tab to its resumed `claude` session. `sessionId`
 * is the MAIN-minted `claude --session-id <uuid>` used to `--resume` (D2/FR-019).
 * NO secret — this is process-session structure, not credentials (FR-006).
 */
export interface TerminalTabSnapshot {
  /** Renderer-minted paneId (the live PTY key). FR-008/FR-021. */
  id: string
  /** Tab label (default e.g. "Terminal 1" or a user rename). FR-008. */
  label: string
  /** True when the user renamed the tab, so the label is preserved verbatim. FR-009. */
  renamed?: boolean
  /** Main-minted `claude` session id used to `--resume` on relaunch. FR-019/FR-020. */
  sessionId: string
  /** The working directory the session was spawned in. FR-019. */
  cwd: string
  /** Bounded serialized scrollback, restored as on-screen history (≤~256KB). FR-021. */
  scrollback?: string
}

/**
 * The Terminal panel's persisted state (FR-008/FR-010/FR-011). Terminal always
 * restores ≥1 tab; an empty/absent collection is reconciled to a single default
 * tab at restore (FR-011).
 */
export interface TerminalPanelSnapshot {
  /** Ordered terminal tabs (FR-008). */
  tabs: TerminalTabSnapshot[]
  /** The active tab's id, or null. FR-008. */
  activeTabId: string | null
  /** Monotonic "ever opened" counter, restored so new tab indices never collide. FR-010. */
  everOpened: number
}

/**
 * One generative-panel tab's persisted state (FR-008/FR-012/FR-013/FR-014/FR-015).
 *
 * ONLY a `composed: true` surface persists its `surface.spec` verbatim (FR-012);
 * a live integration-data view (`composed: false`) is structurally NOT representable
 * here — it carries no `surface`, so it restores to base and re-fetches (FR-015).
 * Transient run state (inFlight/loadingDefault/error) is intentionally ABSENT from
 * this shape (FR-014). NO secret (FR-006).
 */
export interface GenerativeTabSnapshot {
  /** Renderer tab id. FR-008. */
  id: string
  /** Tab label. FR-008. */
  label: string
  /** True for a never-composed "Untitled" tab. FR-008. */
  untitled: boolean
  /** True when the user renamed the tab. FR-009. */
  renamed?: boolean
  /**
   * The verbatim composed A2UI surface spec; present ONLY when `composed` is true.
   * Absent for a base/empty tab or a live-data view (FR-012/FR-015).
   */
  surface?: { spec: A2uiSurfaceUpdate }
  /**
   * Discriminates a restorable composed surface. ONLY ever `true` here — a
   * `composed: false` view is not persisted as a surface (FR-012/FR-015).
   */
  composed?: true
}

/**
 * A generative panel's persisted state (Generated-UI / Jira / Slack / Confluence).
 * A zero-tab panel stays zero-tab on restore (FR-011); only `composed:true` tab
 * surfaces survive (FR-012). No integration data/cursors are persisted (FR-016).
 */
export interface GenerativePanelSnapshot {
  /** Ordered tabs (FR-008). */
  tabs: GenerativeTabSnapshot[]
  /** The active tab's id, or null. FR-008. */
  activeTabId: string | null
  /** Monotonic "ever opened" counter, restored so new tab indices never collide. FR-010. */
  everOpened: number
}

/**
 * The persisted working-session snapshot (session-persistence-v1, FR-001/FR-002).
 *
 * Schema-versioned; an unknown `schemaVersion` is treated as unreadable (FR-002).
 * Holds ONLY non-secret tab/terminal structure + composed-surface specs — never
 * tokens, OAuth material, or the Atlassian client_secret (FR-006). Integration
 * connection state itself is NOT stored; panels rehydrate to not-connected /
 * re-fetch on restore (FR-016/FR-017).
 */
export interface SessionSnapshot {
  /** Snapshot schema version; MUST equal SESSION_SCHEMA_VERSION to be readable. FR-002. */
  schemaVersion: number
  /** Per-panel persisted state, keyed by render target (+ terminal). FR-008. */
  panels: {
    terminal: TerminalPanelSnapshot
    'generated-ui': GenerativePanelSnapshot
    jira: GenerativePanelSnapshot
    slack: GenerativePanelSnapshot
    confluence: GenerativePanelSnapshot
  }
}

/** The four generative render targets that own a persisted panel. */
export type GenerativePanelKey = Exclude<keyof SessionSnapshot['panels'], 'terminal'>

/**
 * The session API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.session` (FR-003). Load is the single startup read; save is the
 * debounced push. NO method takes or returns a secret (FR-006).
 */
export interface SessionApi {
  /**
   * R->M (invoke). Read the persisted snapshot at startup. Resolves with `null`
   * when no snapshot exists or the file is missing/corrupt/wrong-version, so the
   * renderer falls back to a clean empty session (FR-001/FR-005).
   */
  load(): Promise<SessionSnapshot | null>
  /**
   * R->M (send). Persist the latest snapshot. Fire-and-forget; main validates at
   * the boundary and ignores an invalid payload without overwriting a good file
   * (FR-004/FR-007).
   */
  save(snapshot: SessionSnapshot): void
}

/** Shape attached to `window` by the preload. */
export interface CosmosApi {
  pty: PtyApi
  ui: UiApi
  slack: SlackApi
  jira: JiraApi
  confluence: ConfluenceApi
  agent: AgentApi
  shortcuts: ShortcutApi
  session: SessionApi
}
