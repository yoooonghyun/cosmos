/**
 * Startup orphan reaper (session-resume-relaunch-v4 / orphan prevention, part c).
 *
 * The group-kill teardown (processGroupKill.ts) reaps `claude` + its MCP-server children on a CLEAN
 * quit, but it can only clean what it RUNS for. Two residual leak sources survive it:
 *  1. ABRUPT termination of cosmos (macOS sleep, force-quit, SIGKILL) — no quit hook runs, so the
 *     `claude` group survives as an orphan.
 *  2. PRE-EXISTING orphans from before the teardown fix shipped (their `claude` leader is already
 *     dead, so teardown can never retroactively reap them).
 * Both leave stray `node .../out/main/mcp/<X>Server.js` processes reparented to launchd.
 *
 * This module finds those orphans at STARTUP (a backstop that matches by COMMAND + SOCKET signature,
 * not by process group — so it also catches anything that escaped the group via its own `setsid`)
 * and the caller SIGKILLs them. It is a PURE decision: given a process-table snapshot + this
 * install's signature, it returns the orphan pids to kill. The OS calls (enumerate / kill) are
 * injected, so the predicate is fully node-testable.
 *
 * SAFETY — three independent gates so we never kill the wrong thing:
 *  - SIGNATURE: the command must be one of OUR server scripts under THIS app's out dir AND its
 *    env-augmented command line must contain THIS install's sandbox socket dir. A different cosmos
 *    checkout (different out dir) or a different install instance (different userData sandbox) fails
 *    one of these and is left alone.
 *  - ORPHANED: the process must be genuinely parentless — reparented to launchd (`ppid === 1`), or
 *    its parent pid is not a live process in the snapshot (its `claude` leader died). A server whose
 *    parent is still alive belongs to a LIVE session (ours-to-be or a concurrent cosmos) and is
 *    SKIPPED.
 *  - PID GATE: `pid > 1` (defense in depth; the killer also re-checks before any negative-pid kill).
 */

/** One row of the process-table snapshot (env-augmented `ps -axEww -o pid,ppid,pgid,command`). */
export interface ProcSnapshotRow {
  pid: number
  ppid: number
  pgid: number
  /** The full command line INCLUDING the appended env (so the socket env var is matchable). */
  command: string
}

/** This cosmos install's identifying signature for an MCP-server process. */
export interface CosmosMcpSignature {
  /**
   * Absolute path fragment that every one of OUR server scripts shares — the app's MCP out dir,
   * e.g. `<app.getAppPath()>/out/main/mcp/`. Matching this (a) confirms the script is ours and
   * (b) scopes to THIS checkout's out dir, so a different cosmos build is never touched.
   */
  outDirMarker: string
  /**
   * Absolute path fragment unique to THIS install's bridge sockets — the sandbox dir under this
   * install's userData, e.g. `<app.getPath('userData')>/sandbox`. The servers are launched with
   * `COSMOS_*_BRIDGE_SOCKET=<sandbox>/.cosmos-*.sock`, visible in the env-augmented command line.
   * A server bound to a DIFFERENT socket dir is a different install instance — left alone.
   */
  sandboxMarker: string
}

/** Does this row look like one of OUR MCP server scripts for THIS install (signature match)? */
export function matchesCosmosMcpServer(row: ProcSnapshotRow, sig: CosmosMcpSignature): boolean {
  const cmd = row.command
  if (typeof cmd !== 'string' || cmd.length === 0) {
    return false
  }
  // Our server scripts live at `<outDirMarker><X>Server.js`. Require the out-dir marker AND the
  // `Server.js` suffix of one of our scripts, so a random node process under the dir is not matched.
  const scriptHit = cmd.includes(sig.outDirMarker) && /Server\.js(\s|$|")/.test(cmd)
  if (!scriptHit) {
    return false
  }
  // Install scoping: the env-augmented command line must reference THIS install's sandbox socket dir.
  // (Empty marker would match everything — refuse it as a safety degenerate.)
  return sig.sandboxMarker.length > 0 && cmd.includes(sig.sandboxMarker)
}

/**
 * Is `row` a genuinely ORPHANED MCP server — its owning `claude` is gone? True when reparented to
 * launchd (`ppid === 1`) OR its parent pid is not a live process in this snapshot. A server whose
 * parent IS alive (a live `claude` session — ours-to-spawn or a concurrent cosmos) is NOT an orphan.
 */
export function isOrphanedMcpServer(row: ProcSnapshotRow, livePids: ReadonlySet<number>): boolean {
  if (row.ppid === 1) {
    return true
  }
  // Parent still present in the snapshot ⇒ a live session owns it ⇒ not an orphan.
  return !livePids.has(row.ppid)
}

/**
 * Pure reaper decision: from a process-table snapshot + this install's signature, return the set of
 * orphan MCP-server pids to SIGKILL. A pid qualifies iff it (1) matches our command+socket signature,
 * (2) is genuinely orphaned (owning `claude` dead), and (3) is `> 1`. The caller's own current pid
 * is never selected (it is not an MCP server script). Deterministic, deduped, ascending.
 */
export function selectOrphanMcpServers(
  snapshot: readonly ProcSnapshotRow[],
  sig: CosmosMcpSignature
): number[] {
  const livePids = new Set<number>(snapshot.map((r) => r.pid))
  const orphans = new Set<number>()
  for (const row of snapshot) {
    if (!Number.isInteger(row.pid) || row.pid <= 1) {
      continue // pid gate (defense in depth)
    }
    if (!matchesCosmosMcpServer(row, sig)) {
      continue // not our server / not this install
    }
    if (!isOrphanedMcpServer(row, livePids)) {
      continue // owning claude is alive — leave the live session's server be
    }
    orphans.add(row.pid)
  }
  return [...orphans].sort((a, b) => a - b)
}
