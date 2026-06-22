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
  // Fresh path: a non-empty chosen directory overrides the default sandbox cwd (FR-004).
  const cwd = overrideCwd && overrideCwd.length > 0 ? overrideCwd : sandboxDir
  const sessionId = mintSessionId()
  sessionMap.set(paneId, { sessionId, cwd })
  return { args: ['--session-id', sessionId], resume: false, cwd }
}
