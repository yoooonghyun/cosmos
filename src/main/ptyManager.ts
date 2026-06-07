/**
 * PTY Manager (Electron main process) — multi-session (panel-tabs v1, Track A).
 *
 * Spawns the interactive `claude` CLI inside a pseudo-terminal via node-pty,
 * streams its raw output to the renderer, relays keyboard input and resize
 * events back into the PTY, detects exit, and supports restart.
 *
 * Each terminal tab is a DISTINCT live PTY session keyed by a renderer-minted
 * `paneId` (panel-tabs v1, FR-021): the manager holds a `Map<paneId, IPty>` and
 * routes start/write/resize/restart/kill by `paneId`. Sinks tag every event with
 * its `paneId` so the renderer routes it to the matching xterm instance.
 *
 * Spec trace:
 *   FR-001 spawn `claude` via node-pty in main with a PTY
 *   FR-002 stream raw output (bytes/ANSI) to renderer
 *   FR-004 write keyboard input to PTY stdin
 *   FR-005 propagate resize (cols, rows)
 *   FR-007 detect process exit and signal it
 *   FR-008 restart without restarting the app
 *   FR-009 start with the project root as cwd
 *   FR-010 inbound payloads are validated by callers (src/shared/validate.ts)
 *   panel-tabs v1 FR-021 one PTY per terminal tab, keyed by paneId
 *   panel-tabs v1 FR-022 start a new pane's session
 *   panel-tabs v1 FR-023 dispose a single pane's session (others unaffected)
 *   panel-tabs v1 FR-025 each pane's session is independent
 *   panel-tabs v1 FR-026 per-tab restart restarts only that pane's PTY
 *   Edge case: `claude` not found -> surface per-pane error, do not crash
 */

import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type {
  PtyDataPayload,
  PtyExitPayload,
  PtyResizePayload
} from '../shared/ipc'

/** Sinks the manager pushes events into; wired to IPC by the caller. */
export interface PtyManagerSinks {
  /** FR-002: deliver a chunk of raw output to the renderer. */
  onData(payload: PtyDataPayload): void
  /** FR-007: deliver an exit/error event to the renderer. */
  onExit(payload: PtyExitPayload): void
}

export interface PtyManagerOptions {
  /** FR-009: working directory for the spawned `claude` process. */
  cwd: string
  /** The command to spawn. Defaults to `claude`. */
  command?: string
  /** Extra args passed to the command. Defaults to none. */
  args?: string[]
  /** Initial terminal size. */
  cols?: number
  rows?: number
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Best-effort check that `command` can be located and executed. Absolute paths
 * are checked directly; bare names are resolved against PATH. Returns true when
 * unsure (PATH unset) so we never block a legitimate spawn — the spawn itself
 * remains the source of truth, with `onExit` as the fallback.
 */
export function isExecutableResolvable(command: string): boolean {
  const canExec = (p: string): boolean => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  if (isAbsolute(command) || command.includes('/')) {
    return canExec(command)
  }

  const pathEnv = process.env['PATH']
  if (!pathEnv) {
    return true
  }
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => canExec(join(dir, command)))
}

/** One live terminal-tab session: its PTY plus its last-known dimensions. */
interface PtySession {
  proc: IPty
  cols: number
  rows: number
}

export class PtyManager {
  /**
   * One PTY per terminal tab, keyed by the renderer-minted `paneId` (panel-tabs
   * v1, FR-021). Replaces the previous single `proc`.
   */
  private readonly sessions = new Map<string, PtySession>()
  private readonly sinks: PtyManagerSinks
  private readonly options: Required<Pick<PtyManagerOptions, 'cwd'>> &
    PtyManagerOptions
  private readonly defaultCols: number
  private readonly defaultRows: number

  constructor(sinks: PtyManagerSinks, options: PtyManagerOptions) {
    this.sinks = sinks
    this.options = options
    this.defaultCols = options.cols ?? DEFAULT_COLS
    this.defaultRows = options.rows ?? DEFAULT_ROWS
  }

  /** True when a live PTY process is attached for `paneId` (panel-tabs v1, FR-021). */
  isRunning(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  /**
   * Spawn the `claude` process for `paneId` (FR-001, FR-009; panel-tabs v1
   * FR-021/FR-022). If a process is already running for this pane it is killed
   * first so restart reuses the same tab (FR-008/FR-026) — other panes are never
   * touched. If the binary cannot be found, emits a per-pane exit event with an
   * `error` rather than throwing (edge case: do not crash).
   */
  start(paneId: string): void {
    const existing = this.sessions.get(paneId)
    if (existing) {
      this.kill(paneId)
    }

    const command = this.options.command ?? 'claude'
    const args = this.options.args ?? []
    const cols = existing?.cols ?? this.defaultCols
    const rows = existing?.rows ?? this.defaultRows

    // Edge case (per pane): `claude` not found on PATH. node-pty does not reject a
    // missing binary synchronously on this platform (it exits with code 1 and no
    // output), so we pre-check and surface a clear error rather than a bare exit
    // code. The error is tagged with this pane's id so only that tab shows it.
    if (!isExecutableResolvable(command)) {
      this.sinks.onExit({
        paneId,
        error: `"${command}" was not found on PATH. Install Claude Code or ensure it is on PATH, then restart.`
      })
      return
    }

    let proc: IPty
    try {
      proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.options.cwd,
        env: process.env as { [key: string]: string }
      })
    } catch (err) {
      // ENOENT (binary not found) and similar spawn failures land here.
      const message = err instanceof Error ? err.message : String(err)
      this.sinks.onExit({ paneId, error: `Failed to start "${command}": ${message}` })
      return
    }

    const session: PtySession = { proc, cols, rows }
    this.sessions.set(paneId, session)

    proc.onData((data: string) => {
      this.sinks.onData({ paneId, data })
    })

    proc.onExit(({ exitCode, signal }) => {
      // Only clear if this is still the active session for the pane (guards
      // against a stale handler firing after a restart replaced the process).
      if (this.sessions.get(paneId) === session) {
        this.sessions.delete(paneId)
      }
      this.sinks.onExit({ paneId, exitCode, signal })
    })
  }

  /**
   * FR-008/FR-026: kill `paneId`'s current process then spawn a fresh one. Other
   * panes are unaffected.
   */
  restart(paneId: string): void {
    this.start(paneId)
  }

  /**
   * FR-004 (panel-tabs v1 FR-021): write validated input to `paneId`'s PTY.
   * No-op if that pane is not running.
   */
  write(paneId: string, data: string): void {
    const session = this.sessions.get(paneId)
    if (!session) {
      return
    }
    session.proc.write(data)
  }

  /**
   * FR-005 (panel-tabs v1 FR-021): resize `paneId`'s PTY. Remembers the size so a
   * later restart of that pane reuses it. No-op if the pane is not running.
   */
  resize(paneId: string, payload: PtyResizePayload): void {
    const session = this.sessions.get(paneId)
    if (!session) {
      return
    }
    session.cols = payload.cols
    session.rows = payload.rows
    try {
      session.proc.resize(payload.cols, payload.rows)
    } catch {
      // A resize racing with exit can throw; ignore rather than crash.
    }
  }

  /**
   * Kill `paneId`'s process without emitting an exit event to the renderer
   * (panel-tabs v1, FR-023 — tab close). Used for tab dispose and for clean
   * teardown on app quit / renderer reload (edge case: do not orphan the PTY).
   * Detaches the session first so its exit handler does not re-emit. No-op if the
   * pane is unknown.
   */
  kill(paneId: string): void {
    const session = this.sessions.get(paneId)
    if (!session) {
      return
    }
    this.sessions.delete(paneId)
    try {
      session.proc.kill()
    } catch {
      // Already dead; nothing to do.
    }
  }

  /**
   * Kill EVERY pane's process and clear the map, without emitting exit events.
   * Used for full teardown on app quit / window close / renderer reload so no
   * `claude` session is orphaned (panel-tabs v1, FR-023 teardown).
   */
  killAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill()
      } catch {
        // Already dead; nothing to do.
      }
    }
    this.sessions.clear()
  }
}
