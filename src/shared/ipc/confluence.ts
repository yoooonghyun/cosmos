/**
 * Atlassian — Confluence native panel IPC surface.
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group A FR-A12, Group C).
 * Re-exported (unchanged) through the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type {
  ConfluenceCommentParams,
  ConfluenceCommentResult,
  ConfluenceConnectionStatus,
  ConfluenceDefaultFeedParams,
  ConfluenceGetCommentsParams,
  ConfluenceGetCommentsResult,
  ConfluenceGetPageParams,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchParams,
  ConfluenceSearchResult
} from '../types/confluence'

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
  /**
   * R->M (invoke): abort an in-flight connect (the user cancelled the browser consent);
   * resolves with the resulting not-connected status so the panel can retry immediately
   * (oauth-cancel-v1). Carries no payload and no token/secret.
   */
  CancelConnect: 'confluence:cancelConnect',
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
  /**
   * R->M (invoke): read a page's footer comments (top-level + one-level reply tree).
   * Requires the `read:comment:confluence` scope (confluence-dock-comments-v1, FR-003/FR-004).
   */
  GetComments: 'confluence:getComments',
  /**
   * R->M (invoke): add a footer comment to a page — the renderer write path that REUSES the
   * existing `ConfluenceManager.createComment` (no second write impl). Requires the already-
   * granted `write:comment:confluence` scope (confluence-dock-comments-v1, FR-006).
   */
  AddComment: 'confluence:addComment',
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
  /**
   * R->M. Abort an in-flight connect (the user cancelled the browser consent); resolves with
   * the resulting not-connected status so the panel can retry immediately (oauth-cancel-v1).
   */
  cancelConnect(): Promise<ConfluenceConnectionStatus>
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
   * R->M. Read a page's footer comments — top-level comments each with a one-level
   * `replies` array (confluence-dock-comments-v1, FR-003). Requires `read:comment:confluence`;
   * a token without it resolves to a `comment_read_not_authorized` result so the dock surfaces
   * a calm reconnect affordance (FR-004). No token crosses this channel (FR-011).
   */
  getComments(
    params: ConfluenceGetCommentsParams
  ): Promise<ConfluenceResult<ConfluenceGetCommentsResult>>
  /**
   * R->M. Add a footer comment to the open page — the renderer write path REUSING the
   * existing comment-write impl (confluence-dock-comments-v1, FR-006). Requires the already-
   * granted `write:comment:confluence`; a token without it resolves to `write_not_authorized`.
   * No token crosses this channel (FR-011).
   */
  addComment(
    params: ConfluenceCommentParams
  ): Promise<ConfluenceResult<ConfluenceCommentResult>>
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so the
   * panel can detach on unmount (avoids leaks / double-binding on HMR). FR-A12.
   */
  onStatusChanged(listener: (status: ConfluenceConnectionStatus) => void): () => void
}
