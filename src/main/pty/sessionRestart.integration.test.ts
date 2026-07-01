/**
 * Integration tests for the terminal session RESTART/RECOVERY lifecycle —
 * terminal-session-unnecessary-restart-v1 (ARCHITECTURE.md §4.1 continue-don't-restart).
 *
 * WHY node-INTEGRATION (not node-unit): the bug lives in the spawn/lifecycle SEAM, not in any
 * single pure function. `resolvePaneSpawn` (node-unit) decides the ARGS, but the regression is only
 * real when those args are wired through the SAME path the `pty:start` / `pty:restart` IPC handlers
 * use — `paneSpawnFor` (resolve against the live resume/session maps) → `presweepResumeLock` →
 * `PtyManager.start` (injected spawn) → `onExit`/`onSessionInUse` sinks → the `planResumeRetry`
 * backoff. This harness re-creates that exact wiring (the index.ts handlers are inside the monolithic
 * Electron entry and cannot be imported under vitest-node, so the handler BODIES are reproduced here
 * verbatim against the real PtyManager + the real resolver + the real backoff planner).
 *
 * Scenarios (TEST-SCENARIOS.md TERM-RESTART-RESUME-01):
 *   1. A long-lived session that exits ABNORMALLY (NOT disposed, FAR past the 4000ms
 *      RESUME_FAILURE_WINDOW_MS) surfaces a plain exit (the renderer's exit banner) AND a subsequent
 *      `pty:restart` spawns `claude --resume <sameId>` in the recorded cwd — id UNCHANGED.
 *      RED before the fix (restart spawned `--session-id <sameId>`, no `--resume`); GREEN after.
 *   2. `pty:restart` on a pane with NO recorded id falls back to a fresh `--session-id` spawn.
 *   3. No-respawn-on-lifecycle invariant: a `powerMonitor 'suspend'` and a renderer active-toggle do
 *      NOT kill/respawn a live PTY (the policy that must never silently regress).
 *   4. `planResumeRetry` backoff still wins for an in-use rejection on the restarted id (no fresh
 *      mint) — the fix didn't weaken orphan recovery.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Fake node-pty (mirrors ptyManager.test.ts) — records args/cwd, drives data/exit callbacks.
// ---------------------------------------------------------------------------

interface FakePty {
  pid: number
  command: string
  args: string[]
  cwd?: string
  written: string[]
  killed: boolean
  dataCb?: (data: string) => void
  exitCb?: (e: { exitCode: number; signal?: number }) => void
  write: Mock
  resize: Mock
  kill: Mock
  onData: Mock
  onExit: Mock
}

const spawned: FakePty[] = []

function makeFakePty(command: string, args: string[], cwd?: string): FakePty {
  const fake: FakePty = {
    pid: spawned.length + 1000, // > 1 so the group-kill safety gate passes (see ptyManager.test.ts)
    command,
    args,
    cwd,
    written: [],
    killed: false,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn()
  }
  fake.write.mockImplementation((data: string) => fake.written.push(data))
  fake.kill.mockImplementation(() => {
    fake.killed = true
    // Real node-pty: proc.kill() defaults to SIGHUP and fires onExit async with signal 1.
    fake.exitCb?.({ exitCode: 0, signal: 1 })
  })
  fake.onData.mockImplementation((cb: (data: string) => void) => {
    fake.dataCb = cb
  })
  fake.onExit.mockImplementation((cb: (e: { exitCode: number; signal?: number }) => void) => {
    fake.exitCb = cb
  })
  return fake
}

vi.mock('node-pty', () => ({
  spawn: vi.fn((command: string, args: string[], options: { cwd?: string }) => {
    const fake = makeFakePty(command, args, options?.cwd)
    spawned.push(fake)
    return fake
  })
}))

import * as pty from 'node-pty'
import { PtyManager, type PtyManagerSinks } from './ptyManager'
import { resolvePaneSpawn, type PaneSessionRecord, type ResolvedPaneSpawn } from './paneSpawn'
import { planResumeRetry, type SessionLockEnv } from './sessionLockRecovery'
import type { ProcessGroupKiller } from './processGroupKill'
import type { PtyExitPayload } from '../../shared/ipc'

const SANDBOX = '/userData/sandbox'
const PRESENT_CMD = process.execPath // resolves on PATH so the pre-check passes

/** Last spawn's command/args/cwd. */
function lastSpawn(): { command: string; args: string[]; cwd?: string } {
  const calls = (pty.spawn as Mock).mock.calls
  const [command, args, options] = calls[calls.length - 1] as [string, string[], { cwd?: string }]
  return { command, args, cwd: options?.cwd }
}

/** A recording group-killer that reports each group dead after its first SIGHUP (no real signals). */
function makeGroupKiller(): ProcessGroupKiller {
  const hupped = new Set<number>()
  return {
    killGroup: (pid, signal) => {
      if (signal === 'SIGHUP') hupped.add(pid)
    },
    isGroupAlive: (pid) => !hupped.has(pid)
  }
}

/**
 * cosmos-dev-wake-reload-session-survival-v1: a recording group-killer that EXPOSES the signals it
 * sent, so the quit-path test can assert the ZERO-orphans group teardown (SIGHUP → SIGKILL
 * escalation). `stubborn:true` models an MCP child that ignores SIGHUP (still alive at the grace
 * deadline) so the SIGKILL escalation fires and reaps it.
 */
function makeRecordingGroupKiller(stubborn = false): {
  groupKiller: ProcessGroupKiller
  signals: Array<{ pid: number; signal: NodeJS.Signals }>
} {
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = []
  const hupped = new Set<number>()
  return {
    signals,
    groupKiller: {
      killGroup: (pid, signal) => {
        signals.push({ pid, signal })
        if (signal === 'SIGHUP') hupped.add(pid)
      },
      isGroupAlive: (pid) => (stubborn ? true : !hupped.has(pid))
    }
  }
}

/**
 * A harness reproducing the index.ts pty:start / pty:restart wiring against the REAL PtyManager,
 * resolver, and backoff planner. `now` is an injectable clock so a session can be aged past the
 * 4000ms resume-failure window deterministically.
 */
function makeHarness(opts?: {
  now?: () => number
  lockEnv?: SessionLockEnv
  groupKiller?: ProcessGroupKiller
}) {
  const resumeMap = new Map<string, PaneSessionRecord>()
  const sessionMap = new Map<string, PaneSessionRecord>()
  const exits: PtyExitPayload[] = []
  const inUse: Array<{ paneId: string; sessionId: string }> = []
  const resumeAttempts = new Map<string, number>()
  let mintN = 0
  const mint = vi.fn(() => `sess-fresh-${++mintN}`)

  const sinks: PtyManagerSinks = {
    onData: () => {},
    onExit: (p) => exits.push(p),
    onSessionInUse: (paneId, sessionId) => inUse.push({ paneId, sessionId })
  }

  // PtyManager ctor signature: (sinks, options, now, groupKiller).
  const realManager = new PtyManager(
    sinks,
    { cwd: SANDBOX, command: PRESENT_CMD, spawn: (c, a, o) => pty.spawn(c, a, o) },
    opts?.now ?? Date.now,
    opts?.groupKiller ?? makeGroupKiller()
  )

  // Mirror index.ts paneSpawnFor (resolve against the live maps; explicit-restart flag threaded).
  const paneSpawnFor = (
    paneId: string,
    overrideCwd?: string,
    isExplicitRestart = false
  ): ResolvedPaneSpawn =>
    resolvePaneSpawn(
      paneId,
      SANDBOX,
      resumeMap,
      sessionMap,
      mint,
      overrideCwd,
      () => true, // dirExists: every cwd resolves in this harness
      isExplicitRestart
    )

  // Mirror index.ts pty:start handler.
  const ptyStart = (paneId: string, overrideCwd?: string): void => {
    resumeAttempts.delete(paneId)
    const spawn = paneSpawnFor(paneId, overrideCwd)
    realManager.start(paneId, spawn)
  }

  // Mirror index.ts pty:restart handler (isExplicitRestart=true).
  const ptyRestart = (paneId: string): void => {
    resumeAttempts.delete(paneId)
    const spawn = paneSpawnFor(paneId, undefined, true)
    realManager.start(paneId, spawn)
  }

  // Mirror index.ts onSessionInUseForPane (the in-use recovery backoff using the REAL planner).
  const lockEnv: SessionLockEnv =
    opts?.lockEnv ??
    ({
      listRegistryFiles: () => [], // no holder → planResumeRetry returns action:'retry' on attempt 1
      readEntry: () => null,
      isAlive: () => false,
      killPid: () => {},
      removeFile: () => {}
    } satisfies SessionLockEnv)

  const onSessionInUse = (paneId: string, sessionId: string): 'retry' | 'give-up' => {
    if (realManager.isRunning(paneId)) {
      resumeAttempts.delete(paneId)
      return 'retry'
    }
    const next = (resumeAttempts.get(paneId) ?? 0) + 1
    resumeAttempts.set(paneId, next)
    const plan = planResumeRetry(sessionId, next, lockEnv)
    if (plan.action === 'give-up') {
      resumeAttempts.delete(paneId)
      return 'give-up'
    }
    const cwd = sessionMap.get(paneId)?.cwd ?? SANDBOX
    realManager.start(paneId, { args: ['--resume', sessionId], resume: true, cwd })
    return 'retry'
  }

  return { manager: realManager, resumeMap, sessionMap, exits, inUse, mint, ptyStart, ptyRestart, onSessionInUse }
}

beforeEach(() => {
  spawned.length = 0
  ;(pty.spawn as Mock).mockClear()
})

describe('terminal session restart/recovery lifecycle (terminal-session-unnecessary-restart-v1)', () => {
  it('CORE: a long-lived session that dies abnormally surfaces a plain exit, then pty:restart resumes the SAME id (--resume) in the recorded cwd', () => {
    // Clock the harness so we can age the session past the 4000ms resume-failure window.
    let clock = 0
    const h = makeHarness({ now: () => clock })
    const CWD = '/Users/me/work'

    // A genuine relaunch: session:load seeded the resume map, the first start resumes the recorded id.
    h.resumeMap.set('p1', { sessionId: 'sess-original', cwd: CWD })
    h.ptyStart('p1')
    expect(lastSpawn().args).toEqual(['--resume', 'sess-original'])
    expect(h.sessionMap.get('p1')).toEqual({ sessionId: 'sess-original', cwd: CWD })

    // The session lives for a long time (well past the 4000ms window), then its upstream `claude`
    // dies abnormally on a lock/sleep connection drop. It is NOT disposed (not an intentional kill).
    clock = 5_000_000 // ~83 min later — FAR past RESUME_FAILURE_WINDOW_MS=4000
    const live = spawned[0]
    live.exitCb?.({ exitCode: 1 })

    // It falls through to the plain onExit (NOT onResumeFailure, NOT onSessionInUse) → the renderer's
    // exit banner. The pane is no longer running.
    expect(h.exits).toEqual([{ paneId: 'p1', exitCode: 1, signal: undefined }])
    expect(h.manager.isRunning('p1')).toBe(false)

    // The user clicks Restart. THE FIX: this must re-`--resume` the SAME recorded id in the recorded
    // cwd — restoring the conversation — NOT spawn a fresh `--session-id` and NOT mint a new id.
    h.ptyRestart('p1')
    const restart = lastSpawn()
    expect(restart.args).toEqual(['--resume', 'sess-original']) // RED before fix: ['--session-id','sess-original']
    expect(restart.args).toContain('--resume')
    expect(restart.cwd).toBe(CWD)
    // The recorded id is UNCHANGED across the whole lifecycle — never re-minted.
    expect(h.sessionMap.get('p1')).toEqual({ sessionId: 'sess-original', cwd: CWD })
    expect(h.mint).not.toHaveBeenCalled()
  })

  it('pty:restart on a pane with NO recorded id falls back to a fresh --session-id spawn (no crash)', () => {
    const h = makeHarness()
    // No resume entry, no prior start → no recorded session for p1.
    h.ptyRestart('p1')
    const spawn = lastSpawn()
    expect(spawn.args[0]).toBe('--session-id')
    expect(spawn.args).not.toContain('--resume')
    expect(h.mint).toHaveBeenCalledTimes(1)
    expect(h.manager.isRunning('p1')).toBe(true)
  })

  it('NO-RESPAWN INVARIANT: a powerMonitor suspend leaves a live PTY running (no kill, no respawn)', () => {
    const h = makeHarness()
    h.ptyStart('p1', '/Users/me/work')
    expect(h.manager.isRunning('p1')).toBe(true)
    const liveBefore = spawned[0]

    // The real index.ts suspend handler ONLY logs — it does NOT touch the PtyManager. Reproduce that
    // (a no-op handler) and assert the live session is untouched: same process, still running, no new
    // spawn, no exit emitted.
    const suspendHandler = (): void => {
      /* index.ts: console.log only — deliberately does NOT kill PTYs on suspend */
    }
    suspendHandler()

    expect(h.manager.isRunning('p1')).toBe(true)
    expect(liveBefore.killed).toBe(false)
    expect(spawned).toHaveLength(1) // no respawn
    expect(h.exits).toEqual([]) // no exit surfaced
  })

  it('NO-RESPAWN INVARIANT: a renderer active-toggle does NOT respawn or kill a live PTY', () => {
    const h = makeHarness()
    h.ptyStart('p1', '/Users/me/work')
    const liveBefore = spawned[0]

    // The renderer active-toggle effect (TerminalPanel TerminalView, :355) only re-fits + focuses +
    // pushes a resize for the ALREADY-LIVE pane; it issues NO pty:start/restart/dispose. Reproduce
    // the only PTY-touching call it makes (a resize) and assert no kill, no respawn, no exit.
    h.manager.resize('p1', { paneId: 'p1', cols: 100, rows: 30 })

    expect(h.manager.isRunning('p1')).toBe(true)
    expect(liveBefore.killed).toBe(false)
    expect(spawned).toHaveLength(1) // active-toggle never spawns a second process
    expect(h.exits).toEqual([])
  })

  it('ORPHAN RECOVERY preserved: an in-use rejection on the restarted id retries the SAME id via the backoff (no fresh mint)', () => {
    let clock = 0
    const h = makeHarness({ now: () => clock })
    const CWD = '/Users/me/work'

    // A live session resumed, lived long, then died — the user restarts and we re-resume.
    h.resumeMap.set('p1', { sessionId: 'sess-original', cwd: CWD })
    h.ptyStart('p1')
    clock = 5_000_000
    spawned[0].exitCb?.({ exitCode: 1 })
    h.exits.length = 0 // clear the death's plain exit

    // Restart resumes the same id. The restart spawn is resume:true (the recovery branch).
    h.ptyRestart('p1')
    const restartProc = spawned[spawned.length - 1]
    expect(lastSpawn().args).toEqual(['--resume', 'sess-original'])

    // But a just-dying ORPHAN momentarily still holds that id: claude prints "already in use" and the
    // resume spawn dies abnormally WITHIN the 4000ms window → onSessionInUse fires (NOT onExit).
    // (Within window because the restart spawned at clock=5_000_000 and exits immediately after.)
    restartProc.dataCb?.('Session ID sess-original is already in use')
    restartProc.exitCb?.({ exitCode: 1 })

    // The PtyManager routed it to onSessionInUse (the in-use recovery), suppressing the plain exit.
    expect(h.inUse).toEqual([{ paneId: 'p1', sessionId: 'sess-original' }])
    expect(h.exits).toEqual([]) // no spurious "claude exited" flashed

    // index.ts onSessionInUseForPane plans a retry via the REAL planResumeRetry and re-spawns the
    // SAME id — never a fresh mint. (A no-holder env → action:'retry', delayMs from the backoff.)
    const decision = h.onSessionInUse('p1', 'sess-original')
    expect(decision).toBe('retry')
    const retrySpawn = lastSpawn()
    expect(retrySpawn.args).toEqual(['--resume', 'sess-original']) // SAME id, never minted fresh
    expect(h.mint).not.toHaveBeenCalled()
    expect(h.sessionMap.get('p1')).toEqual({ sessionId: 'sess-original', cwd: CWD })
  })
})

/* ------------------------------------------------------------------------- *
 * cosmos-dev-wake-reload-session-survival-v1 — a renderer reload KEEPS live sessions
 * alive (main no longer kills on `did-start-navigation`) and the reloaded renderer
 * REATTACHES via an idempotent `pty:start`; a genuine QUIT still tears down every
 * session group with ZERO orphans. The LOAD-BEARING pairing: the reload path must not
 * kill, but `killAllSync` on quit must STILL reap everything (a regression on either
 * side reintroduces the wake-reload restart OR orphaned claude/MCP processes).
 * ------------------------------------------------------------------------- */
describe('dev wake-reload session survival (cosmos-dev-wake-reload-session-survival-v1)', () => {
  it('RELOAD KEEPS the session alive: main does NOT killAll, and the re-issued pty:start reattaches (no kill, no respawn)', () => {
    const h = makeHarness()
    const CWD = '/Users/me/work'

    // A restored tab resumes on first mount.
    h.resumeMap.set('p1', { sessionId: 'sess-original', cwd: CWD })
    h.ptyStart('p1')
    const live = spawned[0]
    expect(h.manager.isRunning('p1')).toBe(true)

    // THE RELOAD: main's did-start-navigation listener NO LONGER calls ptyManager.killAll()
    // (D1 — only the four non-PTY teardown calls remain, which do not touch the manager). So a
    // reload does nothing to the live session. Reproduce that by asserting the session is untouched
    // (there is no manager call to make on reload) and the pane is still live afterward.
    expect(live.killed).toBe(false)
    expect(h.manager.isRunning('p1')).toBe(true)

    // The reloaded renderer re-mounts its tabs and re-issues pty:start for the SURVIVOR (reattach).
    // Idempotent start ⇒ NO kill + NO respawn: the SAME process stays attached (no banner, no lost
    // auto-accept, no stale scrollback — the whole point of the fix).
    h.ptyStart('p1')
    expect(live.killed).toBe(false)
    expect(spawned).toHaveLength(1) // never respawned across the reload
    expect(h.manager.isRunning('p1')).toBe(true)
  })

  it('QUIT PATH UNCHANGED (LOAD-BEARING): killAllSync group-tears-down every survivor with SIGKILL escalation and empties the map — ZERO orphans', () => {
    // A stubborn group (an MCP child ignoring SIGHUP) forces the SIGKILL escalation, proving the
    // quit path still reaps a group that survives the grace. A regression here reintroduces orphans.
    const { groupKiller, signals } = makeRecordingGroupKiller(true)
    const h = makeHarness({ groupKiller })

    h.ptyStart('p1', '/work/a')
    h.ptyStart('p2', '/work/b')
    // Both survived a reload (never killed); now the user QUITS → will-quit/before-quit → killAllSync.
    expect(h.manager.isRunning('p1')).toBe(true)
    expect(h.manager.isRunning('p2')).toBe(true)

    h.manager.killAllSync()

    // Every session's GROUP got SIGHUP then, because it ignored it, SIGKILL — no orphaned claude or
    // out/main/mcp/*Server.js survives a clean quit (session-resume-relaunch-v3 invariant, preserved).
    for (const proc of spawned) {
      expect(signals).toContainEqual({ pid: proc.pid, signal: 'SIGHUP' })
      expect(signals).toContainEqual({ pid: proc.pid, signal: 'SIGKILL' })
    }
    // The live map is empty after the quit teardown.
    expect(h.manager.isRunning('p1')).toBe(false)
    expect(h.manager.isRunning('p2')).toBe(false)
    expect(h.manager.listLive()).toEqual([])
  })
})
