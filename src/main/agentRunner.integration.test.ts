/**
 * Integration tests for AgentRunner + agentSessionQueue — REAL wiring, INJECTED spawn.
 *
 * These tests differ from the pure-unit agentRunner.test.ts in that they exercise the
 * COMBINED serialization contract end-to-end: the runner, the queue decision, and the
 * drain path together, using an injected fake spawn that records every child in order.
 *
 * Focus areas:
 *   1. Multiple targets queue and drain ONE AT A TIME (serialization invariant).
 *   2. Every spawned run carries the SAME persistent session id (session continuity).
 *   3. SESSION-ID COLLISION scenario: simulate the "Session ID is already in use" error
 *      class (a child that exits non-zero with that stderr) and assert that the runner
 *      serializes — i.e. the second run never starts while the first is in flight — so
 *      two same-session runs can never overlap.
 *   4. A run that fails with the session-in-use error still drains the queue (no stall).
 *
 * NOTE ON BUG STATUS: the serialization guard is implemented in AgentRunner.run() via
 * decideSubmit(). The unit tests in agentRunner.test.ts already exercise the guard with
 * a single shared fake child. These integration tests add:
 *   a) a multi-child harness (each spawn returns a FRESH child) to verify the queue
 *      drains correctly across child boundaries, and
 *   b) a "session-in-use" failure test that documents the exact error class that shipped
 *      as a real bug and asserts the serializer prevents it from being triggered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { AgentRunner, type AgentRunnerSinks, type SpawnFn } from './agentRunner'
import { RESUME_RETRY_BACKOFF_MS, type SessionLockEnv } from './pty/sessionLockRecovery'
import type { AgentStatusPayload } from '../shared/ipc'

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

type FakeChild = ReturnType<typeof makeFakeChild>

interface SerialHarness {
  runner: AgentRunner
  statuses: AgentStatusPayload[]
  spawn: ReturnType<typeof vi.fn>
  children: FakeChild[]
  sessionId: string
}

const SANDBOX = '/tmp/cosmos-integ-sandbox'
const SESSION_ID = 'cosmos-session-integ-0001'

function makeSerialHarness(sessionId = SESSION_ID): SerialHarness {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const c = makeFakeChild()
    children.push(c)
    return c
  }) as unknown as ReturnType<typeof vi.fn>

  const statuses: AgentStatusPayload[] = []
  const sinks: AgentRunnerSinks = { onStatus: (p) => statuses.push(p) }

  const runner = new AgentRunner(sinks, {
    sandboxDir: SANDBOX,
    spawn: spawn as unknown as SpawnFn,
    resolveExecutable: vi.fn(() => true),
    defaultSessionId: sessionId
  })

  return { runner, statuses, spawn, children, sessionId }
}

/** Retrieve `--session-id` value from a spawn call's args array. */
function getSessionId(args: string[]): string | undefined {
  const idx = args.indexOf('--session-id')
  return idx >= 0 ? args[idx + 1] : undefined
}

/** Retrieve `-p` utterance from a spawn call's args array. */
function getUtterance(args: string[]): string | undefined {
  const idx = args.indexOf('-p')
  return idx >= 0 ? args[idx + 1] : undefined
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

// ---------------------------------------------------------------------------
// 1. Serialization: multiple targets queue and drain one at a time
// ---------------------------------------------------------------------------

describe('AgentRunner integration — multi-target serialization', () => {
  it('queues three submits across different targets and drains them strictly one at a time', () => {
    const h = makeSerialHarness()

    h.runner.run('a', 'generated-ui')
    h.runner.run('b', 'jira')
    h.runner.run('c', 'slack')

    // Only one child spawned at this point
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.children).toHaveLength(1)

    // First completes → second starts
    h.children[0].emit('close', 0)
    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(h.children).toHaveLength(2)

    // Second completes → third starts
    h.children[1].emit('close', 0)
    expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(h.children).toHaveLength(3)

    // Third completes → queue empty, no more spawns
    h.children[2].emit('close', 0)
    expect(h.spawn).toHaveBeenCalledTimes(3)
  })

  it('drains submits in FIFO order — utterances preserved in sequence', () => {
    const h = makeSerialHarness()

    h.runner.run('first')
    h.runner.run('second')
    h.runner.run('third')

    h.children[0].emit('close', 0)
    h.children[1].emit('close', 0)
    h.children[2].emit('close', 0)

    const utterances = h.spawn.mock.calls.map((call) => getUtterance(call[1] as string[]))
    expect(utterances).toEqual(['first', 'second', 'third'])
  })

  it('never has more than one child alive at the same time (the two-concurrent guard)', () => {
    const h = makeSerialHarness()
    let maxConcurrent = 0
    let activeSoFar = 0

    h.spawn.mockImplementation(() => {
      activeSoFar++
      maxConcurrent = Math.max(maxConcurrent, activeSoFar)
      const c = makeFakeChild()
      h.children.push(c)
      // Intercept close to decrement the active count
      const origEmit = c.emit.bind(c) as (...a: unknown[]) => boolean
      c.emit = (event: string, ...rest: unknown[]): boolean => {
        if (event === 'close') activeSoFar--
        return origEmit(event, ...rest)
      }
      return c
    })

    h.runner.run('a')
    h.runner.run('b')
    h.runner.run('c')

    h.children[0].emit('close', 0)
    h.children[1].emit('close', 0)
    h.children[2].emit('close', 0)

    expect(maxConcurrent).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Every run carries the SAME persistent session id
// ---------------------------------------------------------------------------

describe('AgentRunner integration — persistent session id across targets', () => {
  it('passes the same --session-id for generated-ui, jira, slack, and confluence runs in sequence', () => {
    const h = makeSerialHarness()
    const targets = ['generated-ui', 'jira', 'slack', 'confluence'] as const

    h.runner.run('a', targets[0])
    h.children[0].emit('close', 0)
    h.runner.run('b', targets[1])
    h.children[1].emit('close', 0)
    h.runner.run('c', targets[2])
    h.children[2].emit('close', 0)
    h.runner.run('d', targets[3])
    h.children[3].emit('close', 0)

    for (const call of h.spawn.mock.calls) {
      const sid = getSessionId(call[1] as string[])
      expect(sid).toBe(SESSION_ID)
    }
  })

  it('passes --session-id even for queued submits that drain later', () => {
    const h = makeSerialHarness()

    // Queue two more while the first is in flight
    h.runner.run('x')
    h.runner.run('y')
    h.runner.run('z')

    h.children[0].emit('close', 0)
    h.children[1].emit('close', 0)
    h.children[2].emit('close', 0)

    for (const call of h.spawn.mock.calls) {
      expect(getSessionId(call[1] as string[])).toBe(SESSION_ID)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. SESSION-ID COLLISION: the exact bug that shipped
//
// "Session ID is already in use" is what `claude` outputs on stderr when two
// `claude -p --session-id <same-id>` processes run concurrently.
//
// This test documents the bug and asserts the serializer PREVENTS the scenario:
// the second run must never start while the first is in flight.
// ---------------------------------------------------------------------------

describe('AgentRunner integration — Session ID already in use (the shipped bug)', () => {
  it('does NOT spawn a second child while the first is in flight — prevents the session-collision error class', () => {
    // This is the exact race: two submits for the same persistent session id while the
    // first child is still running. Before the serializer was added, both children would
    // spawn concurrently and the second would receive "Session ID is already in use" on
    // stderr + exit non-zero.
    const h = makeSerialHarness()

    h.runner.run('utterance-one')
    // First child is in flight. Simulate the second submit arriving immediately.
    h.runner.run('utterance-two')

    // CRITICAL: only ONE child must have been spawned. A second spawn here means two
    // `claude -p --session-id <same-id>` processes are live — that is the collision.
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.children).toHaveLength(1)

    // The first child is still running (isRunning = true).
    expect(h.runner.isRunning).toBe(true)
  })

  it('the second run only starts AFTER the first child closes — zero overlap window', () => {
    const h = makeSerialHarness()

    h.runner.run('utterance-one')
    h.runner.run('utterance-two')

    // Before first closes: one child only
    expect(h.spawn).toHaveBeenCalledTimes(1)

    // First closes — now the queued run may start
    h.children[0].emit('close', 0)

    expect(h.spawn).toHaveBeenCalledTimes(2)
    // The second run got the SAME session id
    expect(getSessionId(h.spawn.mock.calls[1][1] as string[])).toBe(SESSION_ID)
  })

  it('simulates "Session ID is already in use" error from stderr — runner emits error and drains queue without stalling', () => {
    // Simulate what happens if (despite the serializer) a child exits with the exact
    // "Session ID is already in use" stderr. The runner should surface an error status
    // AND drain the queue so the conversation is not stranded.
    const SESSION_IN_USE_MSG = 'Session ID is already in use'

    const h = makeSerialHarness()
    h.runner.run('first-run')
    h.runner.run('queued-run') // queued — must not be dropped

    // Simulate the in-flight child failing with the session-collision error
    h.children[0].stderr.emit('data', SESSION_IN_USE_MSG)
    h.children[0].emit('close', 1) // non-zero exit

    // The runner must have emitted an error for the failed run
    const errorStatuses = h.statuses.filter((s) => s.state === 'error')
    expect(errorStatuses).toHaveLength(1)
    expect(errorStatuses[0].message).toContain(SESSION_IN_USE_MSG)

    // The queued run must have started (queue drained, conversation not stalled)
    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(getSessionId(h.spawn.mock.calls[1][1] as string[])).toBe(SESSION_ID)
    expect(getUtterance(h.spawn.mock.calls[1][1] as string[])).toBe('queued-run')
  })

  it('drains all queued submits even after multiple consecutive session-in-use errors', () => {
    const h = makeSerialHarness()

    h.runner.run('a')
    h.runner.run('b')
    h.runner.run('c')

    // All fail with session-collision-style error
    h.children[0].stderr.emit('data', 'Session ID is already in use')
    h.children[0].emit('close', 1)

    h.children[1].stderr.emit('data', 'Session ID is already in use')
    h.children[1].emit('close', 1)

    h.children[2].emit('close', 0) // c succeeds

    // All three were spawned (queue fully drained)
    expect(h.spawn).toHaveBeenCalledTimes(3)

    // Two errors, one completed
    expect(h.statuses.filter((s) => s.state === 'error')).toHaveLength(2)
    expect(h.statuses.filter((s) => s.state === 'completed')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 3b. REGISTRY-RELEASE RETRY (session-id-already-in-use-runtime-v1)
//
// The load-bearing fix: when a queued run is drained the instant the previous
// `claude` child exits, the prior child may not yet have removed its
// `~/.claude/sessions/<pid>.json` registry entry. The next same-id run is then
// hard-rejected "already in use". The runner must NOT surface that as a terminal
// error and immediately drain — it must wait a backoff (planResumeRetry) and
// RE-SPAWN the SAME submit. This mirrors the PTY `--resume` path.
//
// These tests inject a SessionLockEnv stub modeling a STALE dead-pid registry
// entry and use fake timers to prove the retry is DELAYED (not immediate).
// RED without the fix (no retry wiring → child 1 spawned immediately / never).
// ---------------------------------------------------------------------------

const SESSION_IN_USE_STDERR = 'Session ID cosmos-session-integ-0001 is already in use.'

/**
 * A SessionLockEnv modeling ONE stale registry entry: a dead pid still holding the session id
 * (claude exited without cleaning up the file). `isAlive` returns false so recoverSessionLock
 * removes the stale file and the retry plan proceeds — the dying-orphan / registry-release race.
 */
function makeStaleRegistryEnv(sessionId: string): SessionLockEnv & { removed: string[] } {
  const removed: string[] = []
  const filePath = '/fake/.claude/sessions/4242.json'
  return {
    removed,
    listRegistryFiles: () => (removed.includes(filePath) ? [] : [filePath]),
    readEntry: (p) => (p === filePath ? { pid: 4242, sessionId } : null),
    isAlive: () => false, // dead pid → stale entry
    killPid: () => {},
    removeFile: (p) => {
      removed.push(p)
    }
  }
}

function makeRetryHarness(sessionId = SESSION_ID) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const c = makeFakeChild()
    children.push(c)
    return c
  }) as unknown as ReturnType<typeof vi.fn>
  const statuses: AgentStatusPayload[] = []
  const sinks: AgentRunnerSinks = { onStatus: (p) => statuses.push(p) }
  const env = makeStaleRegistryEnv(sessionId)
  const runner = new AgentRunner(sinks, {
    sandboxDir: SANDBOX,
    spawn: spawn as unknown as SpawnFn,
    resolveExecutable: vi.fn(() => true),
    defaultSessionId: sessionId,
    sessionLockEnv: env
  })
  return { runner, statuses, spawn, children, env }
}

describe('AgentRunner integration — registry-release retry on "already in use"', () => {
  it('does NOT spawn the queued run immediately on an in-use exit, and DOES spawn it after the backoff', () => {
    vi.useFakeTimers()
    const h = makeRetryHarness()

    // Two submits for the same session id: first runs, second queues.
    h.runner.run('first-run')
    h.runner.run('queued-run')
    expect(h.spawn).toHaveBeenCalledTimes(1)

    // Child 0 exits with the "already in use" rejection (the registry-release race): the just-exited
    // prior child has not yet released the id, so claude rejected this same-id run.
    h.children[0].stderr.emit('data', SESSION_IN_USE_STDERR)
    h.children[0].emit('close', 1)

    // CRITICAL (the fix): child 1 must NOT have been spawned yet — the runner is backing off, not
    // draining straight into a terminal error. Pre-fix this would already be 2 (immediate drain).
    expect(h.spawn).toHaveBeenCalledTimes(1)
    // No terminal error was surfaced for the retried attempt.
    expect(h.statuses.filter((s) => s.state === 'error')).toHaveLength(0)

    // After the first backoff slot elapses, the SAME submit is re-spawned.
    vi.advanceTimersByTime(RESUME_RETRY_BACKOFF_MS[0])
    expect(h.spawn).toHaveBeenCalledTimes(2)
    // It re-ran with the same session id and the same utterance (the queued one drained first,
    // because the first run completed before the in-use child — here the in-use child IS the
    // first run, so its OWN retry re-spawns 'first-run').
    expect(getSessionId(h.spawn.mock.calls[1][1] as string[])).toBe(SESSION_ID)
    expect(getUtterance(h.spawn.mock.calls[1][1] as string[])).toBe('first-run')

    vi.useRealTimers()
  })

  it('a successful retry then drains the queued run — conversation continues', () => {
    vi.useFakeTimers()
    const h = makeRetryHarness()

    h.runner.run('first-run')
    h.runner.run('queued-run')

    // First exits in-use → backoff retry.
    h.children[0].stderr.emit('data', SESSION_IN_USE_STDERR)
    h.children[0].emit('close', 1)
    vi.advanceTimersByTime(RESUME_RETRY_BACKOFF_MS[0])
    expect(h.spawn).toHaveBeenCalledTimes(2) // first-run retried

    // The retry (child 1) now succeeds → the queued run finally drains.
    h.children[1].emit('close', 0)
    expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(getUtterance(h.spawn.mock.calls[2][1] as string[])).toBe('queued-run')

    expect(h.statuses.filter((s) => s.state === 'error')).toHaveLength(0)
    expect(h.statuses.filter((s) => s.state === 'completed')).toHaveLength(1)

    vi.useRealTimers()
  })

  it('gives up and surfaces an error once the backoff budget is exhausted', () => {
    vi.useFakeTimers()
    const h = makeRetryHarness()
    h.runner.run('doomed-run')

    // Fail "already in use" on every attempt: initial + each retry within the budget.
    for (let i = 0; i <= RESUME_RETRY_BACKOFF_MS.length; i++) {
      const child = h.children[h.children.length - 1]
      child.stderr.emit('data', SESSION_IN_USE_STDERR)
      child.emit('close', 1)
      if (i < RESUME_RETRY_BACKOFF_MS.length) {
        vi.advanceTimersByTime(RESUME_RETRY_BACKOFF_MS[i])
      }
    }

    // Budget exhausted → exactly one terminal error surfaced, carrying the in-use message.
    const errors = h.statuses.filter((s) => s.state === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('already in use')

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// 3c. BACKOFF-GAP RACE (session-id-already-in-use-runtime-v2)
//
// The real runtime failure: a submit() arriving DURING the backoff gap (while
// this.running is false between finish() and the setTimeout firing) spawns a
// SECOND child with the same --session-id, colliding with the pending retry.
//
// Fix: runner re-arms this.running = true before the setTimeout so the gap
// is closed. Without the fix, spawn is called twice within the gap.
// ---------------------------------------------------------------------------

describe('AgentRunner integration — submit during backoff gap does not spawn second child', () => {
  it('blocks a submit() during the in-use backoff gap — runner stays busy until retry fires', () => {
    vi.useFakeTimers()
    const h = makeRetryHarness()

    // First run starts.
    h.runner.run('first-run')
    expect(h.spawn).toHaveBeenCalledTimes(1)

    // Child 0 exits "already in use" → runner calls finish() (running=false) then
    // schedules the retry setTimeout. THIS is the gap the bug exploited.
    h.children[0].stderr.emit('data', SESSION_IN_USE_STDERR)
    h.children[0].emit('close', 1)

    // The gap: running must be true again (fix) so this submit is QUEUED, not spawned.
    h.runner.run('gap-submit')

    // Without the fix: spawn would be called a second time here (collision).
    // With the fix: still exactly 1 spawn — the gap is closed.
    expect(h.spawn).toHaveBeenCalledTimes(1)
    expect(h.runner.isRunning).toBe(true)

    // After the backoff fires, the retry (first-run) spawns — still 2, not 3.
    vi.advanceTimersByTime(RESUME_RETRY_BACKOFF_MS[0])
    expect(h.spawn).toHaveBeenCalledTimes(2)
    expect(getUtterance(h.spawn.mock.calls[1][1] as string[])).toBe('first-run')

    // Retry succeeds → gap-submit drains as child 3.
    h.children[1].emit('close', 0)
    expect(h.spawn).toHaveBeenCalledTimes(3)
    expect(getUtterance(h.spawn.mock.calls[2][1] as string[])).toBe('gap-submit')

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// 4. dispose() clears the queue — teardown never fires stale submits
// ---------------------------------------------------------------------------

describe('AgentRunner integration — dispose clears queue', () => {
  it('clears queued submits on dispose so a late child close does not spawn stale runs', () => {
    const h = makeSerialHarness()

    h.runner.run('in-flight')
    h.runner.run('queued')

    h.runner.dispose()

    // Late close from the killed child: must NOT drain the now-cleared queue
    h.children[0].emit('close', 0)

    expect(h.spawn).toHaveBeenCalledTimes(1) // only the in-flight run was ever spawned
  })
})
