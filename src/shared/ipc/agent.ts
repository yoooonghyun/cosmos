/**
 * Generative UI foundation — headless agent runner IPC surface.
 * Spec: .sdd/specs/generative-ui-foundation-v1.md. Re-exported (unchanged) through
 * the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type { UiRenderTarget } from './common'

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
 * Non-secret identifiers/labels describing what the user is CURRENTLY VIEWING in the
 * active panel when they send an utterance (open-prompt-view-context-v1, FR-001..FR-004).
 * Threaded to the headless run as model-visible grounding so deictic utterances ("this
 * ticket / this channel / this thread / this page / this event") resolve to the on-screen
 * item — it is NEVER concatenated into the user's literal utterance (FR-007).
 *
 * Every field is OPTIONAL and DATA-ONLY: absence is equivalent to today's behaviour
 * (FR-005). The `target` on {@link AgentSubmitPayload} disambiguates which fields are
 * meaningful for a given panel; a panel populates only the fields it owns. Each panel
 * derives these from the view state it ALREADY holds — no new fetch, no new tracking.
 *
 * SECURITY (FR-002): every field below is a NON-SECRET display/identity label the
 * renderer already legitimately shows on screen. It MUST NEVER carry a token, OAuth
 * secret, credential, or raw transcript.
 */
export interface ViewContext {
  /** jira: the open detail dock's issue key (e.g. `PROJ-123`). NO secret. */
  selectedIssueKey?: string
  /** slack: the open channel's id (e.g. `C0123`). NO secret. */
  selectedChannelId?: string
  /** slack: the open channel's display name (label only, e.g. `general`). NO secret. */
  selectedChannelName?: string
  /** slack: the open thread dock's parent `ts` (the thread root key). NO secret. */
  threadTs?: string
  /** confluence: the open page's id. NO secret. */
  selectedPageId?: string
  /** confluence: the open page's title (label only). NO secret. */
  selectedPageTitle?: string
  /** google-calendar: the selected event's id. NO secret. */
  selectedEventId?: string
  /** google-calendar: the selected event's title/summary (label only). NO secret. */
  selectedEventTitle?: string
}

/**
 * R->M. Submit an utterance to the headless runner. Carries the utterance string,
 * an optional render `target`, and an optional non-secret {@link ViewContext} (FR-002).
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
  /**
   * The active panel's current view context (open-prompt-view-context-v1). OPTIONAL +
   * additive: absent ⇒ exactly today's behaviour (FR-001/FR-005). Non-secret identifiers
   * only (FR-002); validated warn-and-ignore at the main boundary (an invalid value is
   * dropped while the run still starts — FR-006). NO secret.
   */
  viewContext?: ViewContext
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
  /**
   * open-prompt-spinner-gating-v1 (FR-001/FR-002): whether THIS run pushed a
   * `generated-ui` `ui:render` surface frame. Present only on `completed` — the
   * non-secret signal main derives purely from "was a render frame pushed for this
   * run" (NO token, transcript, or surface content). The Open Prompt panel uses it to
   * deterministically distinguish a UI-generation run (keep the "Generating…" spinner /
   * surface path) from a plain command (release the in-flight tab so the spinner never
   * hangs). OPTIONAL + additive: ABSENT ⇒ the renderer falls back to surface-presence,
   * so an old/partial payload never regresses a real UI run. NO secret.
   */
  producedSurface?: boolean
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
