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
  /**
   * Defense-in-depth (session-resume-relaunch-v2): true when `pid` belongs to THIS cosmos process
   * or one of its live children — a holder we must NEVER kill (it is not an orphan from a previous
   * launch). The exact-id registry match already makes a wrong target near-impossible (a sibling
   * app like a Claude Code or fin-agent session holds a DIFFERENT id, so it is never selected), but
   * this guard ensures we also never kill our own just-spawned child should it transiently register
   * the same id. Optional — defaults to "not ours" so existing callers/tests are unaffected.
   */
  isOwnProcess?(pid: number): boolean
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
      /**
       * The live holder of the id is THIS cosmos or one of its own children — never killed
       * (session-resume-relaunch-v2 safety). The caller waits/retries rather than freeing it.
       */
      kind: 'own-process'
      pid: number
      retry: false
    }
  | {
      /** No registry entry names the id — the rejection is not a recoverable holder. */
      kind: 'no-holder'
      retry: false
    }

/**
 * Recover the recorded `sessionId` so the caller can resume it: free a LIVE orphan (kill) or a
 * STALE registry file (remove). Pure decision + injected side-effects; never throws, never mints a
 * fresh id.
 *
 * NOTE on the `no-holder` case (session-resume-relaunch-v2): "no holder" does NOT mean "give up".
 * Empirically (claude 2.1.150) `claude --resume <id>` only rejects "already in use" while a LIVE
 * holder exists; with no live holder it resumes cleanly. So an in-use rejection followed by a
 * `no-holder` scan means the orphan is in the DYING-HOLDER RACE — it was force-killed (its pty died
 * with the old cosmos), removed its registry entry, but has not fully RELEASED the id yet. The
 * caller must keep RE-ATTEMPTING the same-id resume on a short backoff (re-running this each
 * attempt) until the orphan finishes exiting — never minting a fresh id. {@link planResumeRetry}
 * encodes that decision.
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
    // Safety: never kill THIS cosmos or its own live children (session-resume-relaunch-v2). The
    // exact-id match almost never selects a non-orphan, but if the live holder is ours we wait
    // rather than kill — the backoff loop re-attempts the resume.
    if (env.isOwnProcess?.(holder.pid)) {
      return { kind: 'own-process', pid: holder.pid, retry: false }
    }
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

/**
 * Backoff schedule for the in-use resume retry (session-resume-relaunch-v2). Each entry is the
 * delay (ms) to wait BEFORE the next same-id `--resume` attempt. The total budget (~1.75s here)
 * comfortably outlasts the dying-orphan window (the orphan exits within a few hundred ms of its
 * pty dying), while staying short enough that a genuinely unrecoverable id surfaces quickly.
 * Exported so the wiring + tests share one source of truth.
 */
export const RESUME_RETRY_BACKOFF_MS: readonly number[] = [250, 250, 250, 500, 500]

/**
 * session-resume-relaunch-v4: terminal control sequence sent to a pane right BEFORE an in-use
 * backoff RETRY, to wipe the transient "Session ID <id> is already in use" line that claude's failed
 * first `--resume` attempt printed — so the user only ever sees the clean resumed session.
 *
 * `\x1b[2J` clears the visible screen and `\x1b[H` homes the cursor; we deliberately do NOT send
 * `\x1b[3J` (clear scrollback), so the RESTORED scrollback the renderer pre-wrote is preserved.
 * Emitted ONLY on the retry path (never on give-up, where the recoverable error must stay visible,
 * and never on a normal successful resume, which is untouched).
 */
export const IN_USE_RETRY_CLEAR_SEQUENCE = '\x1b[2J\x1b[H'

/** The decision {@link planResumeRetry} returns for ONE in-use rejection. */
export type ResumeRetryPlan =
  | {
      /** Retry the SAME-id `--resume` after `delayMs`. `freedHolder` is true when this attempt
       *  killed/removed a holder (so the id should be free almost immediately). */
      action: 'retry'
      delayMs: number
      freedHolder: boolean
    }
  | {
      /** The backoff budget is exhausted and the id is still rejected — surface failure. NEVER
       *  mint a fresh id on this path; the caller reports a clear, recoverable error instead. */
      action: 'give-up'
    }

/**
 * Decide what to do after an in-use `--resume` rejection on attempt #`attempt` (0-based: the
 * initial spawn that just failed is attempt 0, so the FIRST call here plans attempt 1).
 *
 * Pure: it runs the side-effecting {@link recoverSessionLock} (which may kill an orphan / remove a
 * stale file) and then consults the fixed backoff schedule. The id is ALWAYS preserved — there is
 * no fresh-mint branch. We give up only once every scheduled backoff slot has been used and the
 * holder is still not gone — at which point the caller surfaces a recoverable error.
 *
 * Why retry even on `no-holder`: the dying-orphan race (see {@link recoverSessionLock}). The scan
 * can race the orphan's exit and see nothing, yet the id is still mid-release; waiting one backoff
 * slot and re-attempting the resume is exactly what lets it succeed.
 *
 * @param sessionId  the recorded id being recovered (preserved across all attempts)
 * @param attempt    1-based index of the retry being planned (1 = first retry after the initial
 *                   failed spawn). Caller increments this per attempt.
 * @param env        the live/injected registry env
 * @param backoff    the backoff schedule (defaults to {@link RESUME_RETRY_BACKOFF_MS})
 */
export function planResumeRetry(
  sessionId: string,
  attempt: number,
  env: SessionLockEnv,
  backoff: readonly number[] = RESUME_RETRY_BACKOFF_MS
): ResumeRetryPlan {
  // attempt is 1-based; the delay for retry #N is backoff[N-1].
  if (attempt < 1 || attempt > backoff.length) {
    return { action: 'give-up' }
  }
  const recovery = recoverSessionLock(sessionId, env)
  return {
    action: 'retry',
    delayMs: backoff[attempt - 1],
    freedHolder: recovery.retry
  }
}
