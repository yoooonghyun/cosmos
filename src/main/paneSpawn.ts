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
 *    (terminal-open-directory-picker-v1, FR-004) — it overrides the default sandbox cwd
 *    for the fresh spawn ONLY.
 *  - A resumed pane IGNORES `overrideCwd` entirely; a restored tab always keeps its
 *    persisted cwd (OQ-2).
 * Either way `sessionMap` records the pane's session id + cwd so the `session:save`
 * boundary can persist the chosen directory.
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
 * @param overrideCwd  OPTIONAL chosen directory for a FRESH spawn (FR-004); ignored on resume
 */
export function resolvePaneSpawn(
  paneId: string,
  sandboxDir: string,
  resumeMap: Map<string, PaneSessionRecord>,
  sessionMap: Map<string, PaneSessionRecord>,
  mintSessionId: () => string,
  overrideCwd?: string
): ResolvedPaneSpawn {
  const resume = resumeMap.get(paneId)
  if (resume) {
    // Resume path: persisted cwd wins; the chosen-directory override is ignored (OQ-2).
    resumeMap.delete(paneId)
    sessionMap.set(paneId, { sessionId: resume.sessionId, cwd: resume.cwd })
    return { args: ['--resume', resume.sessionId], resume: true, cwd: resume.cwd }
  }
  // Fresh path: a non-empty chosen directory overrides the default sandbox cwd (FR-004).
  const cwd = overrideCwd && overrideCwd.length > 0 ? overrideCwd : sandboxDir
  const sessionId = mintSessionId()
  sessionMap.set(paneId, { sessionId, cwd })
  return { args: ['--session-id', sessionId], resume: false, cwd }
}
