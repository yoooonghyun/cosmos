/**
 * Terminal Panel (Milestone 1) IPC contract — `pty:*` channels + payloads.
 * Spec: .sdd/specs/terminal-panel-v1.md. Re-exported (unchanged) through the
 * `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

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
  Dispose: 'pty:dispose',
  /**
   * R->M, request/response (`ipcRenderer.invoke` / `ipcMain.handle`): open the
   * native OS directory picker so the user can choose the working directory for a
   * freshly-opened terminal tab (terminal-open-directory-picker-v1, FR-002/FR-003).
   * The dialog runs in MAIN ONLY; the renderer never opens it directly. Resolves
   * with the chosen absolute directory path, or `null` when the user cancelled.
   * The chosen path is a user-selected local filesystem path, NOT a secret — but it
   * still rides only this typed, validated boundary.
   */
  PickDirectory: 'pty:pickDirectory',
  /**
   * R->M, request/response (`ipcRenderer.invoke` / `ipcMain.handle`): list the
   * `paneId`s that CURRENTLY have a live PTY session in main
   * (cosmos-dev-wake-reload-session-survival-v1, FR-005/FR-011). Used by the reloaded
   * renderer to reconcile its rehydrated tabs against main's surviving sessions —
   * reattach a survivor, adopt a live pane whose tab wasn't in the (debounced, possibly
   * stale) snapshot, and route a genuinely-dead tab to the resume/exit-banner path
   * rather than respawning over a live session. NON-SECRET: renderer-minted paneIds
   * ONLY — no cwd, sessionId, scrollback, or token ever crosses this surface.
   */
  ListLive: 'pty:listLive'
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
  /**
   * OPTIONAL working directory for a FRESH spawn, set when the renderer is spawning
   * a freshly-picked tab (terminal-open-directory-picker-v1, FR-004). Present only
   * after the user chose a directory via the native picker; ABSENT for the
   * restore/normal path (additive + backward-compatible). When present it overrides
   * the default sandbox cwd for a fresh (non-resume) spawn, REUSING the existing
   * `PaneSpawnOptions.cwd` path — no new spawn option is invented. A resumed pane
   * IGNORES this and keeps its persisted cwd.
   */
  cwd?: string
}

/**
 * R->M (request). Open the native OS directory picker
 * (terminal-open-directory-picker-v1, FR-002/FR-003). Carries NO field today — the
 * picker uses the OS default location (OQ-4, no `defaultPath`). Typed as an empty
 * record so a future `defaultPath` is an additive change.
 */
export type PtyPickDirectoryRequest = Record<string, never>

/**
 * M->R (response). The outcome of the native OS directory picker
 * (terminal-open-directory-picker-v1, FR-002/FR-006). `path` is the chosen absolute
 * directory, or `null` when the user cancelled/dismissed the picker (cancel is a
 * normal, error-free outcome — there is deliberately NO error field). The response
 * is built entirely in MAIN from the dialog result. No token/secret is involved.
 */
export interface PtyPickDirectoryResult {
  /** The chosen absolute directory path, or `null` on cancel. */
  path: string | null
}

/**
 * R->M (request). List the live PTY sessions
 * (cosmos-dev-wake-reload-session-survival-v1, FR-005/FR-011). Carries NO field — the
 * whole response is built in main from its live-session map. Typed as an empty record
 * (mirroring `PtyPickDirectoryRequest`) so a future filter is an additive change.
 */
export type PtyListLiveRequest = Record<string, never>

/**
 * M->R (response). The set of `paneId`s with a live PTY session in main
 * (cosmos-dev-wake-reload-session-survival-v1, FR-005/FR-011). Built entirely in main
 * from its session map. NON-SECRET: renderer-minted paneIds ONLY — no cwd, sessionId,
 * scrollback, or token.
 */
export interface PtyListLiveResult {
  /** The paneIds that currently have a live `claude` process attached. */
  paneIds: string[]
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
   *
   * `opts.cwd` (terminal-open-directory-picker-v1, FR-004): when the user picked a
   * directory for a freshly-opened tab, pass it here so the fresh spawn runs in that
   * directory. OMIT it for the restore/normal path (the default sandbox cwd is used).
   */
  start(paneId: string, opts?: { cwd?: string }): void
  /**
   * R->M, request/response. Open the native OS directory picker and resolve with the
   * chosen directory path, or `null` on cancel (terminal-open-directory-picker-v1,
   * FR-002/FR-003/FR-006). The dialog runs in MAIN ONLY. No token/secret crosses
   * this surface.
   *
   * NEW preload method — adding it requires a FULL `npm run dev` restart; HMR alone
   * leaves `window.cosmos.pty.pickDirectory` as "not a function" (CLAUDE.md).
   */
  pickDirectory(): Promise<PtyPickDirectoryResult>
  /**
   * R->M, request/response. List the paneIds that currently have a live PTY session in
   * main (cosmos-dev-wake-reload-session-survival-v1, FR-005/FR-011). The reloaded
   * renderer calls this once on mount to reconcile its rehydrated tabs against main's
   * surviving sessions (reattach vs. spawn vs. adopt). Resolves with `{ paneIds }`.
   * NON-SECRET — paneIds only.
   *
   * NEW preload method — adding it requires a FULL `npm run dev` restart; HMR alone
   * leaves `window.cosmos.pty.listLive` as "not a function" (CLAUDE.md).
   */
  listLive(): Promise<PtyListLiveResult>
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
