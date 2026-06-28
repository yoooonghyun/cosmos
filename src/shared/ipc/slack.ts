/**
 * Slack integration — native panel IPC surface.
 * Spec: .sdd/specs/slack-integration-v1.md. Re-exported (unchanged) through the
 * `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

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
  SlackSendParams,
  SlackSendResult,
  SlackUser
} from '../types/slack'

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
  /**
   * R->M (invoke): abort an in-flight connect (the user cancelled the browser consent);
   * resolves with the resulting not-connected status so the panel can retry immediately
   * (oauth-cancel-v1). Carries no payload and no token/secret.
   */
  CancelConnect: 'slack:cancelConnect',
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
  /**
   * R->M (invoke): send a plain-text message to a channel, or (with `threadTs`) a
   * thread reply. The FIRST write — native panel control only, NOT on the read-only
   * MCP/generative surfaces (slack-send-message-v1, FR-004/FR-016).
   */
  Send: 'slack:sendMessage',
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
  /**
   * R->M. Abort an in-flight connect (the user cancelled the browser consent); resolves with
   * the resulting not-connected status so the panel can retry immediately (oauth-cancel-v1).
   */
  cancelConnect(): Promise<SlackConnectionStatus>
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
   * R->M. Send a plain-text message to `channelId`, or (with `threadTs`) a thread
   * reply; resolves the posted message `ts`. The token stays in main and never
   * crosses this channel (slack-send-message-v1, FR-004/FR-006).
   */
  sendMessage(params: SlackSendParams): Promise<SlackResult<SlackSendResult>>
  /**
   * M->R. Subscribe to connection-status changes. Returns an unsubscribe fn so
   * the panel can detach on unmount (avoids leaks / double-binding on HMR). FR-007.
   */
  onStatusChanged(listener: (status: SlackConnectionStatus) => void): () => void
}
