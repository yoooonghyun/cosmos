/**
 * PTY Manager (Electron main process) — cosmos PoC milestone 1.
 *
 * Spawns the interactive `claude` CLI inside a pseudo-terminal via node-pty,
 * streams its raw output to the renderer, relays keyboard input and resize
 * events back into the PTY, detects exit, and supports restart.
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
 *   Edge case: `claude` not found -> surface error, do not crash
 */

import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { PtyDataPayload, PtyExitPayload, PtyResizePayload } from '../shared/ipc'

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
function isExecutableResolvable(command: string): boolean {
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

export class PtyManager {
  private proc: IPty | null = null
  private readonly sinks: PtyManagerSinks
  private readonly options: Required<Pick<PtyManagerOptions, 'cwd'>> &
    PtyManagerOptions
  private cols: number
  private rows: number

  constructor(sinks: PtyManagerSinks, options: PtyManagerOptions) {
    this.sinks = sinks
    this.options = options
    this.cols = options.cols ?? DEFAULT_COLS
    this.rows = options.rows ?? DEFAULT_ROWS
  }

  /** True when a live PTY process is attached. */
  get isRunning(): boolean {
    return this.proc !== null
  }

  /**
   * Spawn the `claude` process (FR-001, FR-009). If a process is already
   * running it is killed first so restart reuses the same panel (FR-008).
   * If the binary cannot be found, emits an exit event with an `error` rather
   * than throwing (edge case: do not crash).
   */
  start(): void {
    if (this.proc) {
      this.kill()
    }

    const command = this.options.command ?? 'claude'
    const args = this.options.args ?? []

    // Edge case: `claude` not found on PATH. node-pty does not reject a missing
    // binary synchronously on this platform (it exits with code 1 and no output),
    // so we pre-check and surface a clear error rather than a bare exit code.
    if (!isExecutableResolvable(command)) {
      this.proc = null
      this.sinks.onExit({
        error: `"${command}" was not found on PATH. Install Claude Code or ensure it is on PATH, then restart.`
      })
      return
    }

    try {
      this.proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: this.options.cwd,
        env: process.env as { [key: string]: string }
      })
    } catch (err) {
      // ENOENT (binary not found) and similar spawn failures land here.
      this.proc = null
      const message =
        err instanceof Error ? err.message : String(err)
      this.sinks.onExit({
        error: `Failed to start "${command}": ${message}`
      })
      return
    }

    const active = this.proc

    active.onData((data: string) => {
      this.sinks.onData({ data })
    })

    active.onExit(({ exitCode, signal }) => {
      // Only report if this is still the active process (guards against a
      // stale handler firing after a restart replaced `this.proc`).
      if (this.proc === active) {
        this.proc = null
      }
      this.sinks.onExit({ exitCode, signal })
    })
  }

  /** FR-008: kill the current process then spawn a fresh one. */
  restart(): void {
    this.start()
  }

  /** FR-004: write validated input to the PTY. No-op if not running. */
  write(data: string): void {
    if (!this.proc) {
      return
    }
    this.proc.write(data)
  }

  /** FR-005: resize the PTY. Remembers size so a later restart uses it. */
  resize(payload: PtyResizePayload): void {
    this.cols = payload.cols
    this.rows = payload.rows
    if (!this.proc) {
      return
    }
    try {
      this.proc.resize(payload.cols, payload.rows)
    } catch {
      // A resize racing with exit can throw; ignore rather than crash.
    }
  }

  /**
   * Kill the current process without emitting an exit event to the renderer.
   * Used for clean teardown on app quit / renderer reload (edge case: do not
   * orphan the PTY). Detaches the active handler reference first.
   */
  kill(): void {
    const active = this.proc
    if (!active) {
      return
    }
    this.proc = null
    try {
      active.kill()
    } catch {
      // Already dead; nothing to do.
    }
  }
}
