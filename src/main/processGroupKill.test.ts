import { describe, it, expect } from 'vitest'
import {
  canGroupKill,
  groupKillPhase,
  shouldEscalateKill,
  type ProcessGroupKiller
} from './processGroupKill'

/**
 * session-resume-relaunch-v3 — process-GROUP teardown of the embedded `claude` PTY + its MCP-server
 * children. node-pty's leader-only `proc.kill()` leaves the MCP grandchildren orphaned; a negative-
 * pid (`process.kill(-pid, sig)`) group kill reaps the whole group. These tests pin the SAFETY gate
 * (never `-0`/`-1`) and the SIGHUP→SIGKILL escalation decision.
 */

/** A killer that records every group signal and reports liveness from an injectable predicate. */
function makeKiller(aliveAfter: (pid: number, calls: number) => boolean): {
  killer: ProcessGroupKiller
  signals: Array<{ pid: number; signal: NodeJS.Signals }>
} {
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = []
  let liveProbes = 0
  const killer: ProcessGroupKiller = {
    killGroup: (pid, signal) => {
      signals.push({ pid, signal })
    },
    isGroupAlive: (pid) => aliveAfter(pid, liveProbes++)
  }
  return { killer, signals }
}

describe('canGroupKill — negative-pid safety gate', () => {
  it('permits a real isolated group leader (pid > 1, integer)', () => {
    expect(canGroupKill(42)).toBe(true)
    expect(canGroupKill(2)).toBe(true)
  })

  it('REJECTS the catastrophic / invalid pids (never -0, -1, negatives, non-integers)', () => {
    expect(canGroupKill(0)).toBe(false) // -0 → caller's own group
    expect(canGroupKill(1)).toBe(false) // -1 → every owned process
    expect(canGroupKill(-5)).toBe(false)
    expect(canGroupKill(3.5)).toBe(false)
    expect(canGroupKill(Number.NaN)).toBe(false)
    expect(canGroupKill(undefined)).toBe(false)
    expect(canGroupKill(null)).toBe(false)
  })
})

describe('groupKillPhase', () => {
  it('graceful phase signals the whole GROUP with SIGHUP', () => {
    const { killer, signals } = makeKiller(() => true)
    expect(groupKillPhase(58742, killer, false)).toBe('signalled-hup')
    expect(signals).toEqual([{ pid: 58742, signal: 'SIGHUP' }])
  })

  it('escalation phase SIGKILLs the group only when a member survives the grace window', () => {
    const { killer, signals } = makeKiller(() => true) // still alive after grace
    expect(groupKillPhase(58742, killer, true)).toBe('escalated-kill')
    expect(signals).toEqual([{ pid: 58742, signal: 'SIGKILL' }])
  })

  it('escalation phase is a no-op when the whole group already exited gracefully', () => {
    const { killer, signals } = makeKiller(() => false) // group gone after SIGHUP
    expect(groupKillPhase(58742, killer, true)).toBe('already-dead')
    expect(signals).toEqual([]) // never SIGKILL a dead group
  })

  it('skips entirely (no signal) for an unsafe pid', () => {
    const { killer, signals } = makeKiller(() => true)
    expect(groupKillPhase(0, killer, false)).toBe('skipped')
    expect(groupKillPhase(1, killer, true)).toBe('skipped')
    expect(signals).toEqual([])
  })

  it('full lifecycle: SIGHUP then SIGKILL the survivor (leader exits, MCP child lingers)', () => {
    const { killer, signals } = makeKiller(() => true)
    // graceful
    expect(groupKillPhase(100, killer, false)).toBe('signalled-hup')
    // after grace, a child is still alive → escalate
    expect(groupKillPhase(100, killer, true)).toBe('escalated-kill')
    expect(signals).toEqual([
      { pid: 100, signal: 'SIGHUP' },
      { pid: 100, signal: 'SIGKILL' }
    ])
  })
})

describe('shouldEscalateKill', () => {
  it('escalates only when killable AND a group member is still alive', () => {
    const { killer } = makeKiller(() => true)
    expect(shouldEscalateKill(100, killer)).toBe(true)
  })

  it('does not escalate when the group has already exited', () => {
    const { killer } = makeKiller(() => false)
    expect(shouldEscalateKill(100, killer)).toBe(false)
  })

  it('does not escalate (and never probes a -1/-0 group) for an unsafe pid', () => {
    let probed = false
    const killer: ProcessGroupKiller = {
      killGroup: () => {},
      isGroupAlive: () => {
        probed = true
        return true
      }
    }
    expect(shouldEscalateKill(1, killer)).toBe(false)
    expect(shouldEscalateKill(0, killer)).toBe(false)
    expect(probed).toBe(false) // short-circuits before any liveness probe of an unsafe group
  })
})
