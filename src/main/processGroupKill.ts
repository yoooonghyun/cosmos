/**
 * Process-group teardown for the embedded `claude` PTYs (session-resume-relaunch-v3 / orphan
 * prevention). Pure decision helpers + a small injectable executor so the logic is node-testable
 * without spawning real processes.
 *
 * WHY A GROUP KILL (verified empirically, macOS):
 *  - node-pty forks the child in a NEW session (`setsid`), so the PTY leader (`claude`) is the
 *    SESSION + PROCESS-GROUP leader: its pid EQUALS its pgid. Every process `claude` spawns — the
 *    ~6-7 `out/main/mcp/*Server.js` node MCP servers — inherits that same pgid.
 *  - node-pty's `UnixTerminal.kill` does `process.kill(this.pid, 'SIGHUP')` — it signals ONLY the
 *    leader. `claude`'s handler is `process.on('SIGHUP', () => process.exit())`, which exits WITHOUT
 *    reaping its children. So a leader-only kill leaves the MCP-server children alive; they reparent
 *    to launchd and survive cosmos's teardown (confirmed: leader dies, child stays alive; a
 *    subsequent `process.kill(-pid, SIGKILL)` reaps BOTH).
 *  - Therefore teardown must signal the whole GROUP via the NEGATIVE pid: `process.kill(-pid, sig)`
 *    delivers `sig` to every process in group `pid`, reaping `claude` AND its MCP children.
 *
 * SAFETY: a negative-pid kill is only ever issued for a real, isolated group leader. `-0` would
 * signal the CALLER's own group and `-1` would signal (almost) every process the user owns — both
 * catastrophic. {@link canGroupKill} gates on `pid > 1` (and integer), and the leader being its own
 * group leader is guaranteed by node-pty's setsid. Every signal is best-effort (ESRCH = already
 * gone) and never throws.
 */

/** The OS-signal side of a group teardown, injected so the decision logic stays pure/testable. */
export interface ProcessGroupKiller {
  /**
   * Deliver `signal` to the process GROUP led by `pid` (i.e. `process.kill(-pid, signal)`).
   * Best-effort: a missing group / permission error must NOT throw.
   */
  killGroup(pid: number, signal: NodeJS.Signals): void
  /** True when ANY process in the group led by `pid` is still alive (e.g. `process.kill(-pid, 0)`). */
  isGroupAlive(pid: number): boolean
}

/**
 * Is it SAFE to issue a negative-pid (process-group) kill for `pid`? Only a real, isolated group
 * leader qualifies: a positive integer strictly greater than 1. This rejects `0` (→ `-0`, the
 * caller's own group), `1` (→ `-1`, every owned process), negatives, NaN and non-integers. node-pty
 * guarantees the PTY leader is its own group leader (setsid), so `pid` here is always a group id.
 */
export function canGroupKill(pid: number | undefined | null): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 1
}

/**
 * Tear down the process group led by `pid`: SIGHUP the whole group (graceful — `claude` exits, its
 * MCP children get the same signal), then — if any group member is still alive after the caller's
 * grace window — SIGKILL the survivors. Returns what was done, for logging/tests. Never throws.
 *
 * The grace wait itself is the caller's responsibility (sync vs async differs between dispose and
 * app-quit); this function performs ONE phase. Call with `escalate:false` for the initial graceful
 * signal and `escalate:true` after the grace window to reap survivors.
 */
export function groupKillPhase(
  pid: number,
  killer: ProcessGroupKiller,
  escalate: boolean
): 'skipped' | 'signalled-hup' | 'escalated-kill' | 'already-dead' {
  if (!canGroupKill(pid)) {
    return 'skipped'
  }
  if (!escalate) {
    killer.killGroup(pid, 'SIGHUP')
    return 'signalled-hup'
  }
  if (killer.isGroupAlive(pid)) {
    killer.killGroup(pid, 'SIGKILL')
    return 'escalated-kill'
  }
  return 'already-dead'
}

/** Grace (ms) between the graceful SIGHUP and the SIGKILL escalation. Short — claude exits fast. */
export const GROUP_KILL_GRACE_MS = 400

/**
 * Decide whether the SIGKILL-escalation phase is still warranted for `pid` after the grace window:
 * only when the pid is group-killable AND some group member is still alive. Pure (delegates the
 * liveness probe to the injected killer) so the escalate-vs-skip decision is unit-testable.
 */
export function shouldEscalateKill(pid: number, killer: ProcessGroupKiller): boolean {
  return canGroupKill(pid) && killer.isGroupAlive(pid)
}
