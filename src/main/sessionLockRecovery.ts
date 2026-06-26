/**
 * session-resume-relaunch-v1 — recover a recorded `claude` session id that is being
 * REJECTED on relaunch with "Session ID <id> is already in use".
 *
 * ROOT CAUSE (verified on disk, claude-code 2.1.150):
 *  - claude does NOT use a per-session on-disk `.lock` file. There is no lockfile under
 *    `~/.claude/projects/<cwd-hash>/<id>...` — session transcripts are plain `.jsonl`.
 *  - Instead, every LIVE interactive `claude` writes a RUNNING-SESSION REGISTRY file at
 *    `~/.claude/sessions/<pid>.json` = `{ pid, sessionId, cwd, status, ... }`. A new
 *    `--resume <id>` / `--session-id <id>` spawn scans that directory and REJECTS the id
 *    when another registry entry names it AND that entry's pid is still alive ("already in
 *    use"). (`--resume` may instead "defer until it exits"; `--session-id` hard-rejects.)
 *  - So the blocker on a genuine relaunch is a LIVE ORPHAN `claude` process that survived
 *    cosmos's previous exit. cosmos's `before-quit`/`killAll` reaps the PTY children on a
 *    CLEAN quit, but a macOS SLEEP, a force-quit, or a SIGKILL of cosmos never runs that
 *    cleanup — the embedded `claude` keeps running, keeps its registry entry, and the next
 *    launch's resume of the recorded id collides with it.
 *
 * RECOVERY (this module, pure + injectable so it is node-testable without Electron/fs):
 *  - Given the recorded session id, scan the registry. If an entry NAMES that id:
 *      - pid ALIVE  → it is the orphan from the previous run; KILL it (freeing the id), then
 *        the caller retries the resume ONCE. (We only ever kill a process that the registry
 *        itself says is holding OUR recorded id — never an arbitrary pid.)
 *      - pid DEAD   → the registry file is STALE (claude crashed/was SIGKILLed without
 *        cleaning up); REMOVE the stale file so the scan no longer reports the id as held,
 *        then retry once.
 *  - If NO entry names the id, there is nothing to recover here (the rejection came from
 *    something else); do not retry.
 *
 * The caller (index.ts) gates this on "THIS cosmos has no live PTY for that paneId/id", so
 * we never kill a sibling pane's own just-spawned claude — only a true orphan/stale holder.
 * We NEVER mint a fresh session id (that re-introduces the content-loss bug); the whole point
 * is to free and resume the ORIGINAL id.
 */

/** One parsed `~/.claude/sessions/<pid>.json` running-session registry entry. */
export interface ClaudeSessionRegistryEntry {
  /** The OS pid of the live (or formerly-live) `claude` process. */
  pid: number
  /** The claude session id this process holds. */
  sessionId: string
  /** Absolute path of the registry file this entry came from. */
  filePath: string
}

/** Injectable side-effects so the resolver stays pure / node-testable. */
export interface SessionLockEnv {
  /** Absolute paths of every `~/.claude/sessions/*.json` registry file. */
  listRegistryFiles(): string[]
  /** Read + parse one registry file into `{ pid, sessionId }`, or null when unreadable/foreign-shaped. */
  readEntry(filePath: string): { pid: number; sessionId: string } | null
  /** True when `pid` is a currently-running process (e.g. `process.kill(pid, 0)` succeeds). */
  isAlive(pid: number): boolean
  /** Terminate `pid` (e.g. SIGTERM then, if needed, the OS reaps it). Best-effort; never throws. */
  killPid(pid: number): void
  /** Remove a stale registry file. Best-effort; never throws. */
  removeFile(filePath: string): void
}

/** The phrase claude prints/exits with when a session id is held by a live process. */
const ALREADY_IN_USE_RE = /Session ID\s+\S+\s+is already in use/i

/**
 * Does this terminal output / error text carry claude's "already in use" rejection?
 * Matched loosely (case-insensitive, id-agnostic) so a minor wording/whitespace change in a
 * future claude build still classifies. Pure — safe to call on any best-effort string.
 */
export function isAlreadyInUseError(text: string | undefined): boolean {
  if (typeof text !== 'string' || text.length === 0) {
    return false
  }
  return ALREADY_IN_USE_RE.test(text)
}

/**
 * Find the running-session registry entry (if any) that holds `sessionId`.
 * Returns the FIRST match (a session id is held by at most one live process). Null when no
 * registry file names it. Never throws — a malformed/foreign file is skipped.
 */
export function findRegistryHolder(
  sessionId: string,
  env: SessionLockEnv
): ClaudeSessionRegistryEntry | null {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null
  }
  for (const filePath of env.listRegistryFiles()) {
    const entry = env.readEntry(filePath)
    if (entry && entry.sessionId === sessionId && Number.isInteger(entry.pid)) {
      return { pid: entry.pid, sessionId, filePath }
    }
  }
  return null
}

/** The decision the recovery resolver returns to the caller. */
export type SessionLockRecovery =
  | {
      /** A live orphan held the id; it was killed. Caller should retry the resume ONCE. */
      kind: 'killed-orphan'
      pid: number
      retry: true
    }
  | {
      /** A stale (dead-pid) registry file held the id; it was removed. Caller retries ONCE. */
      kind: 'removed-stale'
      pid: number
      retry: true
    }
  | {
      /** No registry entry names the id — the rejection is not a recoverable holder. */
      kind: 'no-holder'
      retry: false
    }

/**
 * Recover the recorded `sessionId` so the caller can resume it: free a LIVE orphan (kill) or a
 * STALE registry file (remove), and report whether a retry is warranted. Pure decision +
 * injected side-effects; never throws, never mints a fresh id.
 *
 * The caller MUST only invoke this for an id that THIS process is NOT itself currently running
 * (no live PTY for it) — that gate is what makes killing the holder safe (it is an orphan from a
 * previous launch, not a sibling pane).
 */
export function recoverSessionLock(
  sessionId: string,
  env: SessionLockEnv
): SessionLockRecovery {
  const holder = findRegistryHolder(sessionId, env)
  if (!holder) {
    return { kind: 'no-holder', retry: false }
  }
  if (env.isAlive(holder.pid)) {
    // The orphaned claude from the previous (un-clean) cosmos exit is still holding the id.
    // Killing it frees the id; also drop its registry file so the scan is immediately clean.
    env.killPid(holder.pid)
    env.removeFile(holder.filePath)
    return { kind: 'killed-orphan', pid: holder.pid, retry: true }
  }
  // The registry file points at a dead pid — claude died without cleaning up. The id is not
  // actually held; removing the stale file makes the next scan agree.
  env.removeFile(holder.filePath)
  return { kind: 'removed-stale', pid: holder.pid, retry: true }
}
