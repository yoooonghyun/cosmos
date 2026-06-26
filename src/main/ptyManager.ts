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
import type { IPty, IPtyForkOptions } from 'node-pty'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type {
  PtyDataPayload,
  PtyExitPayload,
  PtyResizePayload
} from '../shared/ipc'
import { isAlreadyInUseError } from './sessionLockRecovery'

/** The node-pty `spawn` signature — injectable so tests run without a real PTY. */
export type SpawnPtyFn = (
  command: string,
  args: string[],
  options: IPtyForkOptions
) => IPty

/** Sinks the manager pushes events into; wired to IPC by the caller. */
export interface PtyManagerSinks {
  /** FR-002: deliver a chunk of raw output to the renderer. */
  onData(payload: PtyDataPayload): void
  /** FR-007: deliver an exit/error event to the renderer. */
  onExit(payload: PtyExitPayload): void
  /**
   * session-persistence-v1 OQ-1/FR-022: a session that was spawned with `--resume`
   * exited abnormally (non-zero code / killed signal) too soon to be a normal exit,
   * i.e. the resume failed. Main reacts by re-minting a fresh `--session-id` and
   * re-starting this pane ONCE, keeping the restored scrollback as read-only history.
   * Optional — absent in non-persistence callers (plain start has no resume).
   */
  onResumeFailure?(paneId: string): void
  /**
   * session-resume-relaunch-v1: a `--resume`/`--session-id <id>` spawn was REJECTED by
   * claude with "Session ID <id> is already in use" — the recorded id is held by a LIVE
   * ORPHAN claude (one that survived cosmos's previous un-clean exit: macOS sleep, force-quit,
   * SIGKILL) or by a STALE registry entry. Main reacts by freeing the id (kill the orphan /
   * remove the stale `~/.claude/sessions/<pid>.json`) and re-starting this pane ONCE with the
   * SAME id — NEVER minting a fresh one (that would orphan the conversation). `sessionId` is the
   * id claude reported as in use (the one this pane was spawned with). Optional — absent in
   * non-persistence callers. Fires INSTEAD of `onExit`/`onResumeFailure` for that exit so the
   * renderer does not flash a spurious "claude exited" before the retry attaches.
   */
  onSessionInUse?(paneId: string, sessionId: string): void
}

export interface PtyManagerOptions {
  /** FR-009: working directory for the spawned `claude` process. */
  cwd: string
  /** The command to spawn. Defaults to `claude`. */
  command?: string
  /** Base args prepended to every pane's per-pane args (e.g. `--mcp-config <path>`). */
  args?: string[]
  /** Initial terminal size. */
  cols?: number
  rows?: number
  /** Injectable node-pty spawn (defaults to `pty.spawn`), for unit tests. */
  spawn?: SpawnPtyFn
}

/**
 * Per-pane spawn options (session-persistence-v1, D2). The renderer mints `paneId`;
 * MAIN mints the `claude` session id and passes the resume flags here.
 *  - `args`: per-pane extra args appended after the base `options.args` (e.g.
 *    `['--session-id', <uuid>]` on first start or `['--resume', <id>]` on relaunch).
 *  - `resume`: true when these args are a `--resume` (so an abnormal early exit is a
 *    resume-failure → `onResumeFailure`, FR-022/OQ-1).
 *  - `cwd`: per-pane working directory (the persisted session cwd), overriding the
 *    manager default when restoring a tab in a different directory (FR-019).
 */
export interface PaneSpawnOptions {
  args?: string[]
  resume?: boolean
  cwd?: string
}

/**
 * How quickly (ms) after a `--resume` spawn an abnormal exit is treated as a
 * resume-failure rather than a user-driven exit (OQ-1). A resume that fails does so
 * almost immediately; a long-lived session that the user later exits is NOT a resume
 * failure. Conservative window.
 */
const RESUME_FAILURE_WINDOW_MS = 4000

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * session-resume-relaunch-v1: how many trailing bytes of PTY output to retain per session for the
 * "already in use" scan. The rejection is a short startup line, so a few KB of tail is ample while
 * staying bounded for a long-lived session.
 */
const IN_USE_SCAN_BYTES = 4096

/**
 * session-resume-relaunch-v1: extract the `claude` session id from a pane's spawn args. Both
 * `--resume <id>` and `--session-id <id>` place the id immediately after the flag. Returns the id,
 * or undefined when neither flag is present (a spawn that carries no recorded id can't be in "use").
 */
function sessionIdFromArgs(args: string[] | undefined): string | undefined {
  if (!args) {
    return undefined
  }
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--resume' || args[i] === '--session-id') {
      return args[i + 1]
    }
  }
  return undefined
}

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
  /** True when this session was spawned with `--resume` (OQ-1 failure detection). */
  resume: boolean
  /** Epoch ms when this session was spawned (for the resume-failure window). */
  startedAtMs: number
  /**
   * session-resume-relaunch-v1: the `claude` session id this pane was spawned with (parsed from
   * the `--resume <id>` / `--session-id <id>` args), or undefined for a spawn that carries
   * neither (e.g. a bare start). Needed so the "already in use" recovery knows WHICH id to free.
   */
  sessionId?: string
  /**
   * session-resume-relaunch-v1: a small ring of the most-recent PTY output for THIS session,
   * scanned on an abnormal early exit to detect claude's "Session ID <id> is already in use"
   * startup rejection. Bounded so it never grows with a long-lived session.
   */
  recentOutput: string
  /**
   * The absolute working directory this pane was spawned in (the persisted/picked
   * session cwd, FR-019). Remembered so a per-tab `restart` (FR-026) respawns in the
   * SAME directory instead of reverting to the manager-default sandbox cwd — which
   * would otherwise make a restored/restarted tab (and its file explorer) point at the
   * wrong directory (terminal-restart-cwd-regression).
   */
  cwd?: string
  /**
   * True once this session has been INTENTIONALLY killed via `kill`/`killAll`
   * (tab close, app quit, renderer reload). node-pty's `proc.kill()` makes the
   * PTY's `onExit` fire asynchronously with SIGHUP (signal 1); the captured
   * handler checks this flag and returns WITHOUT emitting to the renderer, so an
   * intentional kill never produces a spurious "claude exited (signal 1)" event
   * — which on a renderer reload would otherwise reach the reloaded, restored
   * pane and break both the claude pane and its file explorer
   * (restart-pty-cwd regression). A genuine, self-driven abnormal exit leaves
   * this false and still emits normally.
   */
  disposed: boolean
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
  private readonly spawn: SpawnPtyFn
  /** Injectable clock (ms) for the resume-failure window; defaults to Date.now. */
  private readonly now: () => number

  constructor(sinks: PtyManagerSinks, options: PtyManagerOptions, now: () => number = Date.now) {
    this.sinks = sinks
    this.options = options
    this.defaultCols = options.cols ?? DEFAULT_COLS
    this.defaultRows = options.rows ?? DEFAULT_ROWS
    this.spawn = options.spawn ?? ((c, a, o) => pty.spawn(c, a, o))
    this.now = now
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
  start(paneId: string, pane: PaneSpawnOptions = {}): void {
    const existing = this.sessions.get(paneId)
    if (existing) {
      this.kill(paneId)
    }

    const command = this.options.command ?? 'claude'
    // Base args (e.g. `--mcp-config <path>`) + this pane's resume/session flags (D2).
    const args = [...(this.options.args ?? []), ...(pane.args ?? [])]
    const cwd = pane.cwd ?? this.options.cwd
    const cols = existing?.cols ?? this.defaultCols
    const rows = existing?.rows ?? this.defaultRows
    const resume = pane.resume === true
    // session-resume-relaunch-v1: the id this pane carries (`--resume <id>` or `--session-id <id>`)
    // so an "already in use" rejection knows which id to free. Either flag is immediately followed
    // by the id in the per-pane args.
    const sessionId = sessionIdFromArgs(pane.args)

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
      proc = this.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as { [key: string]: string }
      })
    } catch (err) {
      // ENOENT (binary not found) and similar spawn failures land here.
      const message = err instanceof Error ? err.message : String(err)
      this.sinks.onExit({ paneId, error: `Failed to start "${command}": ${message}` })
      return
    }

    const session: PtySession = {
      proc,
      cols,
      rows,
      resume,
      startedAtMs: this.now(),
      sessionId,
      recentOutput: '',
      cwd,
      disposed: false
    }
    this.sessions.set(paneId, session)

    proc.onData((data: string) => {
      // session-resume-relaunch-v1: keep a small ring of recent output so an abnormal early exit
      // can be classified as the "Session ID <id> is already in use" startup rejection. Bounded so
      // a long-lived, chatty session never accumulates output here.
      session.recentOutput = (session.recentOutput + data).slice(-IN_USE_SCAN_BYTES)
      this.sinks.onData({ paneId, data })
    })

    proc.onExit(({ exitCode, signal }) => {
      // An INTENTIONAL kill (`kill`/`killAll`) sets `disposed` before calling
      // `proc.kill()`. node-pty then fires this handler asynchronously with
      // SIGHUP (signal 1); we must NOT emit an exit for it, or a renderer reload
      // (which calls killAll while the window survives) would deliver a spurious
      // "claude exited (signal 1)" to the reloaded, restored pane and break both
      // the claude pane and its file explorer (restart-pty-cwd regression). The
      // session object is captured here, so this works even after the map entry
      // was already removed by `kill`. A genuine self-driven exit leaves
      // `disposed` false and still emits below.
      if (session.disposed) {
        return
      }
      // Only clear if this is still the active session for the pane (guards
      // against a stale handler firing after a restart replaced the process).
      if (this.sessions.get(paneId) === session) {
        this.sessions.delete(paneId)
      }
      // session-resume-relaunch-v1: a spawn carrying a recorded id that died abnormally within the
      // failure window AND printed "Session ID <id> is already in use" was REJECTED because a LIVE
      // ORPHAN (or a stale registry entry) holds that id. Route to the in-use recovery (free the id
      // + retry the SAME id ONCE) INSTEAD of the resume-failure path below (which would mint a fresh
      // id and orphan the conversation). Checked first so it wins over `onResumeFailure`. The normal
      // exit is suppressed so the renderer does not flash "claude exited" before the retry attaches.
      if (
        session.sessionId &&
        this.sinks.onSessionInUse &&
        this.isAbnormalExit(exitCode, signal) &&
        this.now() - session.startedAtMs <= RESUME_FAILURE_WINDOW_MS &&
        isAlreadyInUseError(session.recentOutput)
      ) {
        this.sinks.onSessionInUse(paneId, session.sessionId)
        return
      }
      // OQ-1/FR-022: a `--resume` session that died abnormally within the failure
      // window is a resume-failure → ask main to re-mint a fresh session ONCE. The
      // normal exit event is suppressed in that case so the renderer doesn't flash a
      // spurious "claude exited" before the fresh session attaches.
      if (
        session.resume &&
        this.sinks.onResumeFailure &&
        this.isAbnormalExit(exitCode, signal) &&
        this.now() - session.startedAtMs <= RESUME_FAILURE_WINDOW_MS
      ) {
        this.sinks.onResumeFailure(paneId)
        return
      }
      this.sinks.onExit({ paneId, exitCode, signal })
    })
  }

  /**
   * Whether an exit looks abnormal (resume failed) vs. a clean user-driven exit
   * (OQ-1): a non-zero exit code or a terminating signal. A clean `exit 0` is NOT a
   * resume failure.
   */
  private isAbnormalExit(exitCode: number | undefined, signal: number | undefined): boolean {
    if (typeof signal === 'number' && signal !== 0) return true
    return typeof exitCode === 'number' && exitCode !== 0
  }

  /**
   * FR-008/FR-026: kill `paneId`'s current process then spawn a fresh one IN THE SAME
   * WORKING DIRECTORY. The respawn reuses the pane's remembered cwd (the persisted/
   * picked session dir) so a restart never reverts the terminal — and its file
   * explorer, which roots on this cwd — to the manager-default sandbox dir
   * (terminal-restart-cwd-regression). A restart is always a FRESH spawn (no `--resume`),
   * so it never re-arms the resume-failure window. Other panes are unaffected. The pane's
   * cwd must be read BEFORE `start` kills the existing session (which clears it).
   */
  restart(paneId: string): void {
    const cwd = this.sessions.get(paneId)?.cwd
    this.start(paneId, cwd !== undefined ? { cwd } : {})
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
    // Mark intentional BEFORE killing so the captured `onExit` handler suppresses
    // the SIGHUP exit node-pty fires for an intentional kill (restart-pty-cwd).
    session.disposed = true
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
      // Mark intentional BEFORE killing so each captured `onExit` handler
      // suppresses the SIGHUP exit node-pty fires for an intentional kill — on a
      // renderer reload the window survives, so an emitted exit would reach the
      // reloaded, restored pane (restart-pty-cwd).
      session.disposed = true
      try {
        session.proc.kill()
      } catch {
        // Already dead; nothing to do.
      }
    }
    this.sessions.clear()
  }
}
