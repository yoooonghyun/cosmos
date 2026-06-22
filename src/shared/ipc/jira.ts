/**
 * Atlassian — Jira native panel IPC surface.
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group A FR-A12, Group J).
 * Re-exported (unchanged) through the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type {
  JiraConnectionStatus,
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraSearchParams
} from '../jira'

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
  /**
   * R->M (invoke): abort an in-flight connect (the user cancelled the browser consent);
   * resolves with the resulting not-connected status so the panel can retry immediately
   * (oauth-cancel-v1). Carries no payload and no token/secret.
   */
  CancelConnect: 'jira:cancelConnect',
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
  /**
   * R->M. Abort an in-flight connect (the user cancelled the browser consent); resolves with
   * the resulting not-connected status so the panel can retry immediately (oauth-cancel-v1).
   */
  cancelConnect(): Promise<JiraConnectionStatus>
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
