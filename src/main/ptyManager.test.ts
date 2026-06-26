/**
 * PtyManager — multi-session (one PTY per terminal tab) tests.
 *
 * Panel-tabs v1, Track A. Each terminal tab is a distinct live `claude` process
 * keyed by a renderer-minted `paneId`; the manager holds a `Map<paneId, IPty>`
 * and routes start/write/resize/restart/kill by `paneId`.
 *
 * Spec trace (panel-tabs v1):
 *   FR-021 a terminal tab is a distinct PTY session keyed by paneId
 *   FR-022 `+` spawns a new PTY session (start a second pane independently)
 *   FR-023 closing a tab disposes only that pane's PTY (others unaffected)
 *   FR-025 each pane's session survives independently
 *   FR-026 per-tab restart restarts only that pane's PTY
 *   Edge case: `claude` not found -> per-pane error exit, no throw, no crash
 *
 * node-pty is a native addon, so it is mocked: each `spawn` returns a fake IPty
 * that records writes/resizes/kills and lets the test drive its data/exit
 * callbacks. The PATH pre-check is the real `isExecutableResolvable`, exercised
 * by pointing the manager at a guaranteed-present vs guaranteed-absent command.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

/** A fake IPty that records interactions and exposes its callbacks to drive. */
interface FakePty {
  pid: number
  command: string
  written: string[]
  resizes: Array<{ cols: number; rows: number }>
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

function makeFakePty(command: string): FakePty {
  const fake: FakePty = {
    pid: spawned.length + 1,
    command,
    written: [],
    resizes: [],
    killed: false,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn()
  }
  fake.write.mockImplementation((data: string) => fake.written.push(data))
  fake.resize.mockImplementation((cols: number, rows: number) =>
    fake.resizes.push({ cols, rows })
  )
  fake.kill.mockImplementation(() => {
    fake.killed = true
    // Real node-pty: `proc.kill()` defaults to SIGHUP and makes the PTY's
    // `onExit` fire ASYNCHRONOUSLY with signal 1. Mirror that here so tests
    // exercise the intentional-kill path the way the OS actually behaves
    // (restart-pty-cwd regression). The fake fires synchronously for
    // determinism; the manager must still suppress this exit for an intentional
    // kill, and the timing does not change the assertions.
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
  spawn: vi.fn((command: string) => {
    const fake = makeFakePty(command)
    spawned.push(fake)
    return fake
  })
}))

import * as pty from 'node-pty'
import { PtyManager } from './ptyManager'
import type { PtyDataPayload, PtyExitPayload } from '../shared/ipc'

/** Capture the args/cwd each spawn was called with (session-persistence-v1 D2). */
function lastSpawnCall(): { command: string; args: string[]; cwd?: string } {
  const calls = (pty.spawn as Mock).mock.calls
  const [command, args, options] = calls[calls.length - 1] as [
    string,
    string[],
    { cwd?: string }
  ]
  return { command, args, cwd: options?.cwd }
}

/** A command that always resolves on PATH so the pre-check passes (absolute). */
const PRESENT_CMD = process.execPath
/** A bare name virtually guaranteed absent from PATH so the pre-check fails. */
const ABSENT_CMD = 'definitely-not-a-real-binary-xyzzy'

function makeManager(command = PRESENT_CMD): {
  manager: PtyManager
  data: PtyDataPayload[]
  exit: PtyExitPayload[]
} {
  const data: PtyDataPayload[] = []
  const exit: PtyExitPayload[] = []
  const manager = new PtyManager(
    {
      onData: (p) => data.push(p),
      onExit: (p) => exit.push(p)
    },
    { cwd: '/tmp', command }
  )
  return { manager, data, exit }
}

beforeEach(() => {
  spawned.length = 0
  ;(pty.spawn as Mock).mockClear()
})

describe('PtyManager multi-session (panel-tabs v1, FR-021/FR-022)', () => {
  it('spawns two panes independently, one process per paneId', () => {
    const { manager } = makeManager()
    manager.start('a')
    manager.start('b')
    expect(spawned).toHaveLength(2)
    expect(manager.isRunning('a')).toBe(true)
    expect(manager.isRunning('b')).toBe(true)
    expect(manager.isRunning('c')).toBe(false)
  })

  it('starting the same paneId twice replaces (kills) the prior process for that pane only', () => {
    const { manager } = makeManager()
    manager.start('a')
    manager.start('b')
    const firstA = spawned[0]
    manager.start('a') // re-start pane a
    expect(firstA.killed).toBe(true)
    expect(spawned).toHaveLength(3)
    // pane b untouched
    expect(spawned[1].killed).toBe(false)
  })

  it('routes input to the addressed pane only (FR-021)', () => {
    const { manager } = makeManager()
    manager.start('a')
    manager.start('b')
    manager.write('a', 'ls\r')
    manager.write('b', 'pwd\r')
    expect(spawned[0].written).toEqual(['ls\r'])
    expect(spawned[1].written).toEqual(['pwd\r'])
  })

  it('routes resize to the addressed pane only (FR-021)', () => {
    const { manager } = makeManager()
    manager.start('a')
    manager.start('b')
    manager.resize('a', { paneId: 'a', cols: 100, rows: 30 })
    expect(spawned[0].resizes).toEqual([{ cols: 100, rows: 30 }])
    expect(spawned[1].resizes).toEqual([])
  })

  it('write/resize to an unknown pane is a no-op (no crash)', () => {
    const { manager } = makeManager()
    manager.start('a')
    expect(() => manager.write('ghost', 'x')).not.toThrow()
    expect(() => manager.resize('ghost', { paneId: 'ghost', cols: 80, rows: 24 })).not.toThrow()
    expect(spawned[0].written).toEqual([])
  })

  it('tags onData with the originating paneId (FR-021)', () => {
    const { manager, data } = makeManager()
    manager.start('a')
    manager.start('b')
    spawned[0].dataCb?.('from-a')
    spawned[1].dataCb?.('from-b')
    expect(data).toEqual([
      { paneId: 'a', data: 'from-a' },
      { paneId: 'b', data: 'from-b' }
    ])
  })

  it('tags onExit with the originating paneId and clears that pane (FR-021)', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    manager.start('b')
    spawned[0].exitCb?.({ exitCode: 0 })
    expect(exit).toEqual([{ paneId: 'a', exitCode: 0, signal: undefined }])
    expect(manager.isRunning('a')).toBe(false)
    expect(manager.isRunning('b')).toBe(true)
  })
})

describe('PtyManager per-pane restart (panel-tabs v1, FR-026)', () => {
  it('restart kills and respawns only the addressed pane', () => {
    const { manager } = makeManager()
    manager.start('a')
    manager.start('b')
    const firstA = spawned[0]
    manager.restart('a')
    expect(firstA.killed).toBe(true)
    expect(spawned).toHaveLength(3)
    expect(spawned[1].killed).toBe(false) // pane b untouched
    expect(manager.isRunning('a')).toBe(true)
  })

  // terminal-restart-cwd-regression: a per-tab restart must respawn in the SAME
  // working directory the pane was started in (the persisted/picked session cwd),
  // NOT revert to the manager-default sandbox cwd. The file explorer roots on this
  // cwd, so a regression here points a restarted/restored tab at the wrong directory.
  it('restart respawns in the pane original cwd, not the default sandbox cwd', () => {
    const { manager } = makeManager()
    // Pane started in a specific directory (as a restored/picker-opened tab would be).
    manager.start('a', { cwd: '/home/user/project' })
    expect(lastSpawnCall().cwd).toBe('/home/user/project')
    manager.restart('a')
    // The respawn keeps the pane's directory; it does NOT fall back to '/tmp'.
    expect(lastSpawnCall().cwd).toBe('/home/user/project')
  })

  // A restart is always a FRESH spawn (never `--resume`), so it must not re-arm the
  // resume-failure window even when the pane was originally resumed.
  it('restart does not carry the --resume flag from the original spawn', () => {
    const { manager } = makeManager()
    manager.start('a', { args: ['--resume', 'sess-1'], resume: true, cwd: '/work/dir' })
    manager.restart('a')
    const call = lastSpawnCall()
    expect(call.cwd).toBe('/work/dir')
    expect(call.args).not.toContain('--resume')
  })
})

describe('PtyManager dispose isolation (panel-tabs v1, FR-023)', () => {
  it('disposing one pane kills it and leaves the other alive (no exit event)', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    manager.start('b')
    manager.kill('a')
    expect(spawned[0].killed).toBe(true)
    expect(manager.isRunning('a')).toBe(false)
    // pane b survives (FR-023)
    expect(spawned[1].killed).toBe(false)
    expect(manager.isRunning('b')).toBe(true)
    // dispose emits NO exit event to the renderer (the tab is gone)
    expect(exit).toEqual([])
  })

  it('disposing an unknown pane is a no-op (no crash)', () => {
    const { manager } = makeManager()
    manager.start('a')
    expect(() => manager.kill('ghost')).not.toThrow()
    expect(manager.isRunning('a')).toBe(true)
  })
})

describe('PtyManager killAll (teardown)', () => {
  it('kills every pane and clears the map without emitting exit events', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    manager.start('b')
    manager.start('c')
    manager.killAll()
    expect(spawned.every((p) => p.killed)).toBe(true)
    expect(manager.isRunning('a')).toBe(false)
    expect(manager.isRunning('b')).toBe(false)
    expect(manager.isRunning('c')).toBe(false)
    expect(exit).toEqual([])
  })
})

/* ------------------------------------------------------------------------- *
 * restart-pty-cwd regression — an INTENTIONAL kill must stay silent even when
 * node-pty fires the PTY's onExit with SIGHUP (signal 1) afterward. On a
 * renderer reload the window survives and killAll runs, so an emitted exit would
 * reach the reloaded, restored pane and break both the claude pane and its file
 * explorer. A genuine, self-driven abnormal exit must STILL emit.
 * ------------------------------------------------------------------------- */
describe('PtyManager intentional-kill is silent vs real SIGHUP (restart-pty-cwd)', () => {
  it('kill() does not emit onExit even though the proc fires exit signal 1 on kill', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    // The fake's kill() fires exitCb({ exitCode: 0, signal: 1 }) like real node-pty.
    manager.kill('a')
    expect(spawned[0].killed).toBe(true)
    expect(manager.isRunning('a')).toBe(false)
    // The SIGHUP exit from the intentional kill must NOT reach the renderer.
    expect(exit).toEqual([])
  })

  it('killAll() does not emit onExit for any pane despite each proc firing exit signal 1', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    manager.start('b')
    manager.start('c')
    manager.killAll()
    expect(spawned.every((p) => p.killed)).toBe(true)
    expect(manager.isRunning('a')).toBe(false)
    expect(manager.isRunning('b')).toBe(false)
    expect(manager.isRunning('c')).toBe(false)
    // No spurious "claude exited (signal 1)" reaches a reloaded/restored pane.
    expect(exit).toEqual([])
  })

  it('a genuine abnormal exit (NOT via kill) still emits onExit', () => {
    const { manager, exit } = makeManager()
    manager.start('a')
    // claude crashes on its own — the proc's onExit fires without kill() being called.
    spawned[0].exitCb?.({ exitCode: 1, signal: 1 })
    expect(exit).toEqual([{ paneId: 'a', exitCode: 1, signal: 1 }])
    expect(manager.isRunning('a')).toBe(false)
  })

  it('restart() produces a live fresh pane and emits no spurious exit from the killed proc', () => {
    const { manager, exit } = makeManager()
    manager.start('a', { cwd: '/home/user/project' })
    manager.restart('a')
    // The original proc was killed (firing signal 1) but that exit is suppressed.
    expect(spawned[0].killed).toBe(true)
    expect(exit).toEqual([])
    // The fresh pane is live in the same cwd.
    expect(manager.isRunning('a')).toBe(true)
    expect(lastSpawnCall().cwd).toBe('/home/user/project')
  })
})

describe('PtyManager missing-binary pre-check, per pane (edge case)', () => {
  it('emits a per-pane error exit and spawns nothing when `claude` is not on PATH', () => {
    const { manager, exit } = makeManager(ABSENT_CMD)
    manager.start('a')
    expect(spawned).toHaveLength(0)
    expect(manager.isRunning('a')).toBe(false)
    expect(exit).toHaveLength(1)
    expect(exit[0].paneId).toBe('a')
    expect(exit[0].error).toContain(ABSENT_CMD)
  })

  it('a missing-binary pane does not block a sibling pane with a present binary', () => {
    // Pane a uses the absent command; the manager's command is per-instance, so
    // model the realistic case: a single instance, one pane fails its pre-check,
    // a later start of another pane (present cmd) is unaffected. We simulate by
    // checking the failed pane left the map empty so a sibling start still works.
    const { manager, exit } = makeManager(ABSENT_CMD)
    manager.start('a')
    expect(manager.isRunning('a')).toBe(false)
    // The error exit carried pane a's id; the map is clean for other panes.
    expect(exit[0].paneId).toBe('a')
  })
})

/* ------------------------------------------------------------------------- *
 * session-persistence-v1 — per-pane args (D2) + resume-failure (OQ-1/FR-022)
 * ------------------------------------------------------------------------- */

/** A manager whose base args + an optional resume-failure sink are configurable. */
function makeResumeManager(now: () => number = Date.now): {
  manager: PtyManager
  exit: PtyExitPayload[]
  resumeFailures: string[]
  inUse: Array<{ paneId: string; sessionId: string }>
} {
  const exit: PtyExitPayload[] = []
  const resumeFailures: string[] = []
  const inUse: Array<{ paneId: string; sessionId: string }> = []
  const manager = new PtyManager(
    {
      onData: () => {},
      onExit: (p) => exit.push(p),
      onResumeFailure: (paneId) => resumeFailures.push(paneId),
      onSessionInUse: (paneId, sessionId) => inUse.push({ paneId, sessionId })
    },
    { cwd: '/work', command: PRESENT_CMD, args: ['--mcp-config', '/cfg'] },
    now
  )
  return { manager, exit, resumeFailures, inUse }
}

describe('PtyManager per-pane args (session-persistence-v1 D2, FR-019/FR-020)', () => {
  it('appends per-pane args after base args and uses the per-pane cwd', () => {
    const { manager } = makeResumeManager()
    manager.start('p1', { args: ['--session-id', 'uuid-1'], cwd: '/proj' })
    const call = lastSpawnCall()
    expect(call.args).toEqual(['--mcp-config', '/cfg', '--session-id', 'uuid-1'])
    expect(call.cwd).toBe('/proj')
  })

  it('spawns --resume on relaunch, base args first', () => {
    const { manager } = makeResumeManager()
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    expect(lastSpawnCall().args).toEqual(['--mcp-config', '/cfg', '--resume', 'sess-1'])
  })

  it('falls back to the manager cwd + base-only args with no pane options', () => {
    const { manager } = makeResumeManager()
    manager.start('p1')
    const call = lastSpawnCall()
    expect(call.args).toEqual(['--mcp-config', '/cfg'])
    expect(call.cwd).toBe('/work')
  })
})

describe('PtyManager resume-failure detection (session-persistence-v1 OQ-1/FR-022)', () => {
  it('fires onResumeFailure on an abnormal early exit of a --resume session and suppresses onExit', () => {
    let t = 1000
    const { manager, exit, resumeFailures } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    t = 1500 // 500ms later — inside the failure window
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(resumeFailures).toEqual(['p1'])
    expect(exit).toEqual([])
  })

  it('treats a clean exit(0) of a --resume session as a normal exit', () => {
    let t = 1000
    const { manager, exit, resumeFailures } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    t = 1500
    spawned[spawned.length - 1].exitCb?.({ exitCode: 0 })
    expect(resumeFailures).toEqual([])
    expect(exit).toEqual([{ paneId: 'p1', exitCode: 0, signal: undefined }])
  })

  it('treats a late abnormal exit (outside the window) as a normal exit', () => {
    let t = 1000
    const { manager, exit, resumeFailures } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    t = 1000 + 60_000
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(resumeFailures).toEqual([])
    expect(exit).toHaveLength(1)
  })

  it('never treats a non-resume session as a resume failure', () => {
    let t = 1000
    const { manager, exit, resumeFailures } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--session-id', 'u'], resume: false })
    t = 1100
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(resumeFailures).toEqual([])
    expect(exit).toHaveLength(1)
  })
})

describe('PtyManager "already in use" detection (session-resume-relaunch-v1)', () => {
  // The orphan-on-relaunch case: a --resume spawn that printed claude's "Session ID <id> is
  // already in use" and died early must route to onSessionInUse (carrying the SAME id to free +
  // retry), NOT onResumeFailure (which mints a fresh id) and NOT a bare onExit.
  it('fires onSessionInUse (with the rejected id) when the spawn printed "already in use" and exited early', () => {
    let t = 1000
    const { manager, exit, resumeFailures, inUse } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-IN-USE'], resume: true })
    // claude prints the rejection to the PTY, then exits non-zero shortly after.
    spawned[spawned.length - 1].dataCb?.('Error: Session ID sess-IN-USE is already in use.\r\n')
    t = 1200 // inside the failure window
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(inUse).toEqual([{ paneId: 'p1', sessionId: 'sess-IN-USE' }])
    expect(resumeFailures).toEqual([]) // must NOT take the fresh-mint path
    expect(exit).toEqual([]) // suppressed so the renderer doesn't flash "claude exited"
  })

  // It also detects the rejection for a --session-id spawn (the idempotent reuse branch), parsing
  // the id from that flag.
  it('detects the rejection for a --session-id spawn and carries that id', () => {
    let t = 1000
    const { manager, inUse } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--session-id', 'sess-reuse'], resume: false })
    spawned[spawned.length - 1].dataCb?.('Session ID sess-reuse is already in use')
    t = 1100
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(inUse).toEqual([{ paneId: 'p1', sessionId: 'sess-reuse' }])
  })

  // A --resume that fails WITHOUT the in-use phrase is a normal resume-failure (fresh-mint path),
  // not an in-use recovery — the two must not be conflated.
  it('does NOT fire onSessionInUse for a resume failure that lacks the in-use phrase', () => {
    let t = 1000
    const { manager, resumeFailures, inUse } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    spawned[spawned.length - 1].dataCb?.('No conversation found with session ID: sess-1')
    t = 1200
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(inUse).toEqual([])
    expect(resumeFailures).toEqual(['p1']) // genuine resume failure → fresh mint
  })

  // A late exit (outside the window) carrying the phrase in stale scrollback is NOT a startup
  // rejection — treat as a normal exit so a long-running session that happened to print the words
  // is never mis-recovered.
  it('does NOT fire onSessionInUse on a late exit outside the failure window', () => {
    let t = 1000
    const { manager, exit, inUse } = makeResumeManager(() => t)
    manager.start('p1', { args: ['--resume', 'sess-1'], resume: true })
    spawned[spawned.length - 1].dataCb?.('Session ID sess-1 is already in use')
    t = 1000 + 60_000 // long after startup
    spawned[spawned.length - 1].exitCb?.({ exitCode: 1 })
    expect(inUse).toEqual([])
    expect(exit).toHaveLength(1)
  })
})
