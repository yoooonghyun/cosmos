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

import type { SurfaceUpdatePayload } from '@a2ui-sdk/types/0.8'

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
  /** R->M: request a fresh `claude` session in the same panel. FR-008. */
  Restart: 'pty:restart'
} as const

export type PtyChannelName = (typeof PtyChannel)[keyof typeof PtyChannel]

/**
 * M->R. A chunk of raw PTY output. `data` is the terminal byte stream encoded
 * as a UTF-8 string (xterm.js `write` accepts string). FR-002, FR-003.
 */
export interface PtyDataPayload {
  /** Raw terminal output, including ANSI escape sequences. */
  data: string
}

/**
 * R->M. Keyboard input destined for the PTY stdin. FR-004.
 */
export interface PtyInputPayload {
  /** The bytes the user typed, as produced by xterm.js `onData`. */
  data: string
}

/**
 * R->M. New terminal dimensions. FR-005.
 */
export interface PtyResizePayload {
  /** Number of columns; MUST be a positive integer. */
  cols: number
  /** Number of rows; MUST be a positive integer. */
  rows: number
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
  /** R->M. Send keyboard input to the PTY. FR-004. */
  sendInput(payload: PtyInputPayload): void
  /** R->M. Notify the PTY of new dimensions. FR-005. */
  resize(payload: PtyResizePayload): void
  /** R->M. Request a fresh `claude` session. FR-008. */
  restart(): void
  /** M->R. Subscribe to PTY output. Returns an unsubscribe fn. FR-002/FR-003. */
  onData(listener: (payload: PtyDataPayload) => void): () => void
  /** M->R. Subscribe to PTY exit/error events. Returns an unsubscribe fn. FR-007. */
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
 * The A2UI `surfaceUpdate` payload that `render_ui(spec)` receives and the panel
 * renders (FR-001, FR-005). Typed alias over the installed SDK's
 * `SurfaceUpdatePayload` (`@a2ui-sdk/types/0.8`) so cosmos and the SDK never
 * disagree on the surface shape.
 */
export type A2uiSurfaceUpdate = SurfaceUpdatePayload

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

/** Shape attached to `window` by the preload. */
export interface CosmosApi {
  pty: PtyApi
  ui: UiApi
}
