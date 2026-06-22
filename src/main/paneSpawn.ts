/**
 * Per-pane `claude` spawn-option resolution (session-persistence-v1 D2/FR-019/FR-020/
 * FR-022; terminal-open-directory-picker-v1 FR-004). Pure with respect to its inputs
 * (maps + a session-id minter are injected), so it is node-testable without importing
 * Electron — the side effect is confined to the two maps the caller owns.
 *
 * A pane queued for RESUME spawns `--resume <id>` in its persisted cwd (resume:true so
 * an abnormal early exit triggers the resume-failure fallback). A FRESH pane mints a new
 * `--session-id <uuid>` and spawns in `overrideCwd ?? sandboxDir`:
 *  - `overrideCwd` is the directory the user chose via the native picker
 *    (terminal-open-directory-picker-v1, FR-004). For a FRESH spawn it overrides the
 *    default sandbox cwd. For a RESUMED pane an explicit pick ALSO wins (restart-pty-cwd-v1):
 *    the same `--resume <id>` is kept (session history preserved) but both the spawn cwd and
 *    the recorded cwd become the picked folder. Omitting it on a resume keeps the persisted
 *    cwd unchanged — the normal auto-restore path (OQ-2).
 * Either way `sessionMap` records the pane's session id + cwd so the `session:save`
 * boundary can persist the chosen directory.
 *
 * STALE-CWD GUARD (restart-pty-cwd-v1/v3): a persisted cwd can point at a directory that no
 * longer resolves on the next launch (deleted/renamed/moved repo, or a transiently unmounted /
 * not-yet-stat-able volume). node-pty would then spawn `claude` into a non-existent dir, which
 * dies immediately (SIGHUP / exit 0). So before resuming we verify the cwd still resolves to a
 * directory via the injected `dirExists`; if it does not, the SPAWN cwd falls back to
 * `sandboxDir` (a real directory), keeping the `--resume <id>` (the session id is still valid;
 * only its cwd was lost). The default predicate assumes the dir exists, so callers/tests that
 * don't inject one are unaffected.
 *
 * v3 fix (restart-pty-cwd-v3): the guard must be NON-DESTRUCTIVE. The RECORDED session cwd
 * (`sessionMap`) is what the save boundary persists AND what the file explorer roots on, so it
 * keeps the user's CHOSEN folder (`resume.cwd`) even when the spawn falls back — overwriting it
 * with `sandboxDir` (the v1 behaviour) would permanently erase the chosen folder on a single
 * transient miss, downgrading every future restore to the sandbox. Only the spawn cwd falls
 * back; the chosen folder is preserved so a still-existing (or reappearing) folder restores.
 */

/** One pane's resolved session identity + working directory. */
export interface PaneSessionRecord {
  sessionId: string
  cwd: string
}

/** The resolved spawn options handed to `PtyManager.start`. */
export interface ResolvedPaneSpawn {
  args: string[]
  resume: boolean
  /**
   * The directory `claude` is SPAWNED in. On a resume whose persisted cwd no longer resolves
   * this is the sandbox fallback (so the child does not die), NOT necessarily the recorded/
   * persisted cwd — the chosen folder is preserved in `sessionMap` (restart-pty-cwd-v3).
   */
  cwd: string
}

/**
 * Resolve the spawn options for one `pty:start`.
 *
 * @param paneId       the renderer-minted pane id
 * @param sandboxDir   the default sandbox cwd for a fresh, non-overridden spawn
 * @param resumeMap    paneId -> resume record; an entry means resume (consumed/deleted)
 * @param sessionMap   paneId -> session record; written with the resolved id + cwd
 * @param mintSessionId mints a fresh session id for a non-resume spawn
 * @param overrideCwd  OPTIONAL chosen directory (FR-004). For a FRESH spawn it overrides the
 *                     sandbox cwd. For a RESUMED pane an explicit pick ALSO wins — it re-points
 *                     the session to the new folder (restart-pty-cwd-v1 fix): the same
 *                     `--resume <id>` is kept (session history preserved) but both the spawn cwd
 *                     and the recorded cwd become the picked folder. Omitting it on a resume
 *                     keeps the persisted cwd unchanged (the normal restore path, OQ-2).
 * @param dirExists    predicate: does this absolute path resolve to an existing directory?
 *                     Injected so the resolver stays pure/node-testable (the caller passes a
 *                     real-fs check). Defaults to always-true (existing callers unaffected).
 *                     Used to guard a stale persisted resume cwd (restart-pty-cwd-v1).
 */
export function resolvePaneSpawn(
  paneId: string,
  sandboxDir: string,
  resumeMap: Map<string, PaneSessionRecord>,
  sessionMap: Map<string, PaneSessionRecord>,
  mintSessionId: () => string,
  overrideCwd?: string,
  dirExists: (absDir: string) => boolean = () => true
): ResolvedPaneSpawn {
  const resume = resumeMap.get(paneId)
  if (resume) {
    resumeMap.delete(paneId)
    // restart-pty-cwd-v1 (pick-wins): an explicit user pick (overrideCwd present + non-empty)
    // re-points the session to the chosen folder — both spawn cwd and recorded cwd become the
    // pick. The same `--resume <id>` is kept so session history is preserved. This is the fix
    // for the case where a corrupted sandbox cwd was persisted: the user picks a folder for a
    // restored tab and the pick takes effect immediately, overwriting the stale value for the
    // next save. Without a pick (normal auto-resume on app restart) the persisted cwd is used
    // unchanged (OQ-2 — no regression on the legitimate restore path).
    //
    // restart-pty-cwd-v3: when the effective cwd (picked or persisted) no longer resolves to a
    // directory the SPAWN falls back to the sandbox so `claude` does not die — but the RECORDED
    // cwd keeps the chosen/persisted folder so a transient miss never permanently downgrades it.
    const effectiveCwd = overrideCwd && overrideCwd.length > 0 ? overrideCwd : resume.cwd
    const exists = dirExists(effectiveCwd)
    const spawnCwd = exists ? effectiveCwd : sandboxDir
    sessionMap.set(paneId, { sessionId: resume.sessionId, cwd: effectiveCwd })
    return { args: ['--resume', resume.sessionId], resume: true, cwd: spawnCwd }
  }
  // terminal-cwd-sandbox-v1 (idempotent re-start): there is NO resume entry and NO explicit
  // pick, but this pane ALREADY has a recorded session+cwd. This is a SECOND `pty:start` for a
  // pane that has already started once — most commonly React StrictMode in dev (mount → dispose
  // → remount fires start twice), but also any benign re-issue. A re-start must NOT downgrade the
  // pane to a fresh session in the sandbox: that mints a brand-new session in the wrong cwd and
  // permanently overwrites the recorded folder, which is the exact cwd-sandbox bug. So we
  // re-attach the SAME session id in the SAME recorded cwd (idempotent).
  //
  // FLAG CHOICE — `--session-id`, NOT `--resume`: the recorded session may have been CREATED this
  // launch (a fresh pick minted `--session-id <id>` below) and then killed by Start#1 before any
  // conversation exists. `claude --resume <id>` HARD-REQUIRES an existing conversation and prints
  // "No conversation found with session ID: <id>" to the terminal when there is none — exactly the
  // StrictMode case (Start#1 minted-then-killed an empty session, Start#2 re-attaches). Per
  // `claude --help`, `--session-id <uuid>` = "Use a specific session ID for the conversation":
  // CREATE-OR-CONTINUE — it attaches to the id whether or not a conversation already exists, so an
  // empty session never errors and a populated one continues. `resume:false` (no resume-failure
  // window — there is nothing to "fail to resume"). The GENUINE restore-from-disk path (the
  // resumeMap branch above) still uses `--resume` because there we DO have a prior conversation
  // persisted across app restarts and want it restored.
  //
  // An explicit `overrideCwd` (a real folder pick / pty:restart) takes the fresh path BELOW and
  // still wins — only a cwd-less re-start is treated as idempotent. (The stale-cwd guard still
  // applies: if the recorded folder no longer resolves the SPAWN falls back to the sandbox while
  // the record is preserved, so a transient miss never erases the chosen folder.)
  const existing = sessionMap.get(paneId)
  if (existing && !(overrideCwd && overrideCwd.length > 0)) {
    const exists = dirExists(existing.cwd)
    const spawnCwd = exists ? existing.cwd : sandboxDir
    return { args: ['--session-id', existing.sessionId], resume: false, cwd: spawnCwd }
  }
  // Fresh path: a non-empty chosen directory overrides the default sandbox cwd (FR-004).
  const cwd = overrideCwd && overrideCwd.length > 0 ? overrideCwd : sandboxDir
  const sessionId = mintSessionId()
  sessionMap.set(paneId, { sessionId, cwd })
  return { args: ['--session-id', sessionId], resume: false, cwd }
}
