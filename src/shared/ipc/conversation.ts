/**
 * Cosmos conversation timeline (cosmos-conversation-panel-v2, step 3) IPC contract —
 * the `conversation:*` channels carrying the normalized, secret-safe {@link Conversation}
 * model (the default session's transcript-derived timeline) main → renderer. Spec:
 * FR-106/FR-108. Re-exported (unchanged) through the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 *
 * SECURITY: every payload here carries ONLY the normalized conversation model — never a
 * raw transcript line, file path, token, OAuth secret, credential, or `~/.claude`
 * location (FR-104/FR-106). All `~/.claude` access stays in main (FR-105).
 */

import type { Conversation } from '../conversation'

/**
 * Conversation channel name constants (FR-106).
 *
 * `Fetch` is request/response (`ipcRenderer.invoke`/`ipcMain.handle`) — the renderer
 * reads the full conversation on demand (panel mount). `Update` is fire-and-forget
 * (`webContents.send`/`ipcRenderer.on`) — main pushes a fresh conversation when the
 * default-session transcript grows (a completed default-target run — FR-107).
 */
export const ConversationChannel = {
  /** R->M (invoke): read the full default-session conversation. Resolves a {@link ConversationResult}. FR-106. */
  Fetch: 'conversation:fetch',
  /** M->R (send): push the updated conversation as the transcript grows. FR-107. */
  Update: 'conversation:update'
} as const

export type ConversationChannelName =
  (typeof ConversationChannel)[keyof typeof ConversationChannel]

/**
 * The result of reading the default-session conversation (FR-108/FR-112). A read NEVER
 * throws across the boundary — it resolves to one of:
 *  - `{ ok: true, conversation }` — the parsed conversation (which may itself be the
 *    `state:'empty'` conversation when the file existed but held no conversational turns).
 *  - `{ ok: false, reason: 'empty' }` — no transcript file yet (fresh install / no
 *    submits). The renderer shows the idle EMPTY state, not an error.
 *  - `{ ok: false, reason: 'unreadable' }` — the file exists but could not be read/parsed.
 *    The renderer shows the calm recoverable ERROR state.
 */
export type ConversationResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; reason: 'empty' | 'unreadable' }

/**
 * The conversation API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.conversation` (FR-106). `getDefault` is the on-demand fetch; `onUpdate`
 * subscribes to live pushes. NO method takes or returns a secret/path/raw line.
 *
 * NOTE: NEW preload methods — a full `npm run dev` restart is required to expose them
 * (HMR alone leaves them `not a function`).
 */
export interface ConversationApi {
  /**
   * R->M (invoke). Read the full default-session conversation. Resolves a
   * {@link ConversationResult} — never rejects for a missing/corrupt transcript
   * (those resolve to `ok:false`). FR-106/FR-108.
   */
  getDefault(): Promise<ConversationResult>
  /**
   * M->R. Subscribe to conversation updates pushed as the transcript grows (FR-107).
   * Returns an unsubscribe fn so the panel can detach on unmount (avoids leaks /
   * double-binding on HMR).
   */
  onUpdate(listener: (result: ConversationResult) => void): () => void
}
