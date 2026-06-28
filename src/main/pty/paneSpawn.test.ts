import { describe, it, expect, vi } from 'vitest'
import { resolvePaneSpawn, type PaneSessionRecord } from './paneSpawn'

/**
 * terminal-open-directory-picker-v1 FR-004 + session-persistence-v1 D2/FR-019/FR-020:
 * the pure per-pane spawn resolver. A fresh tab honours an override cwd (the chosen
 * directory); a resumed tab without an explicit pick keeps its persisted cwd (OQ-2);
 * a resumed tab WITH an explicit pick re-points to the picked folder (restart-pty-cwd-v1).
 */
describe('resolvePaneSpawn', () => {
  const SANDBOX = '/userData/sandbox'

  const makeMaps = (): {
    resumeMap: Map<string, PaneSessionRecord>
    sessionMap: Map<string, PaneSessionRecord>
  } => ({ resumeMap: new Map(), sessionMap: new Map() })

  it('mints a fresh session in the sandbox cwd when no override and no resume', () => {
    const { resumeMap, sessionMap } = makeMaps()
    const mint = vi.fn(() => 'sess-fresh')
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint)
    expect(result).toEqual({ args: ['--session-id', 'sess-fresh'], resume: false, cwd: SANDBOX })
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-fresh', cwd: SANDBOX })
  })

  it('spawns a fresh session in the chosen override cwd (FR-004)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    const mint = vi.fn(() => 'sess-fresh')
    const chosen = '/Users/me/project'
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, chosen)
    expect(result).toEqual({ args: ['--session-id', 'sess-fresh'], resume: false, cwd: chosen })
    // The chosen cwd is recorded so a later save persists it.
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-fresh', cwd: chosen })
  })

  it('falls back to the sandbox cwd when the override is an empty string', () => {
    const { resumeMap, sessionMap } = makeMaps()
    const mint = vi.fn(() => 'sess-fresh')
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, '')
    expect(result.cwd).toBe(SANDBOX)
  })

  it('resumes WITHOUT an explicit pick: persisted cwd is kept unchanged (OQ-2 — normal restore path)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    resumeMap.set('p1', { sessionId: 'sess-old', cwd: '/persisted/dir' })
    const mint = vi.fn(() => 'sess-fresh')
    // No overrideCwd supplied → persisted cwd wins (normal auto-resume on app restart).
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint)
    expect(result).toEqual({ args: ['--resume', 'sess-old'], resume: true, cwd: '/persisted/dir' })
    expect(mint).not.toHaveBeenCalled()
    expect(resumeMap.has('p1')).toBe(false)
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-old', cwd: '/persisted/dir' })
  })

  // restart-pty-cwd-v1 regression: an explicit pick (overrideCwd) for a pane that is ALSO in
  // the resume map must record + spawn in the PICKED folder (not the stale resume/sandbox cwd).
  // This is the exact bug: the persisted sandbox cwd perpetuated forever because the old resume
  // branch silently discarded every explicit pick, making it impossible to correct a bad cwd.
  it('resumes WITH an explicit pick: overrideCwd wins over the stale resume cwd (restart-pty-cwd-v1 fix)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    // Simulate the corrupted state: sandbox was persisted as the cwd for this session.
    resumeMap.set('p1', { sessionId: 'sess-old', cwd: SANDBOX })
    const mint = vi.fn(() => 'sess-fresh')
    const picked = '/Users/me/my-project'
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, picked)
    // Still a --resume (session history preserved), but cwd is the picked folder.
    expect(result).toEqual({ args: ['--resume', 'sess-old'], resume: true, cwd: picked })
    expect(mint).not.toHaveBeenCalled()
    expect(resumeMap.has('p1')).toBe(false)
    // The record (terminalSessionMap → enrichSnapshotForSave → session.json) now holds
    // the picked folder, so the next save overwrites the corrupted sandbox value.
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-old', cwd: picked })
  })

  // restart-pty-cwd-v1/v3: on app restart a persisted resume cwd can point at a directory that
  // no longer resolves (deleted/renamed/moved, or a transiently unmounted volume). Resuming
  // `claude` INTO it kills the child on spawn (SIGHUP / exit 0). The resolver must detect the
  // missing dir via the injected `dirExists` and SPAWN in the sandbox cwd instead. But v3: the
  // RECORDED cwd MUST stay the chosen folder — `sessionMap` is what the save boundary persists,
  // so overwriting it with the sandbox (the v1 behaviour) would permanently erase the chosen
  // folder on a single transient miss, downgrading every future restore to the sandbox.
  it('SPAWNS in the sandbox cwd when the persisted cwd no longer exists, but PRESERVES the chosen folder in the record (stale-cwd guard, non-destructive)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    resumeMap.set('p1', { sessionId: 'sess-old', cwd: '/persisted/gone' })
    const mint = vi.fn(() => 'sess-fresh')
    // dirExists reports the persisted cwd is gone but the sandbox exists.
    const dirExists = vi.fn((d: string) => d === SANDBOX)
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    // Still a resume (the session id is valid; only its cwd was lost). The SPAWN cwd falls back
    // to the sandbox so `claude` does not die.
    expect(result).toEqual({ args: ['--resume', 'sess-old'], resume: true, cwd: SANDBOX })
    // NON-DESTRUCTIVE: the RECORDED (persisted) cwd keeps the user's chosen folder, so when the
    // folder reappears the next launch restores it (it is never erased by a transient miss).
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-old', cwd: '/persisted/gone' })
    expect(mint).not.toHaveBeenCalled()
  })

  // restart-pty-cwd-v3 (regression): the user's picked folder round-trips through persist →
  // session:load (seeds the resume map) → resolvePaneSpawn and the RESTORED cwd equals the
  // chosen folder, NOT the sandbox. This is the exact bug: a restored terminal must root its
  // file explorer at the ACTUAL persisted cwd, not fall back to the sandbox/state dir. Fails
  // without the fix only when the guard wrongly downgrades a still-existing folder — covered by
  // the existing "resumes in the persisted cwd when it still exists" case; this asserts the full
  // persist→load→resolve hop for a present folder and that the record (explorer root) matches.
  it('round-trips a picked cwd through persist→load→resolve: the restored cwd is the chosen folder, not the sandbox (dirExists=true)', () => {
    const CHOSEN = '/Users/me/picked-project'
    // Persist hop (what enrichSnapshotForSave wrote into the snapshot): the chosen folder.
    const persistedTab = { sessionId: 'sess-keep', cwd: CHOSEN }
    // session:load seeds the resume map from the persisted tab (index.ts session:load handler).
    const resumeMap = new Map<string, PaneSessionRecord>([['p1', { ...persistedTab }]])
    const sessionMap = new Map<string, PaneSessionRecord>()
    const mint = vi.fn(() => 'sess-fresh')
    const dirExists = vi.fn(() => true) // the chosen folder still exists on disk
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    // The resume spawns AND roots the explorer at the chosen folder — never the sandbox.
    expect(result).toEqual({ args: ['--resume', 'sess-keep'], resume: true, cwd: CHOSEN })
    expect(result.cwd).not.toBe(SANDBOX)
    // The record (terminalSessionMap → paneRoot → file explorer root + next save) is the chosen folder.
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-keep', cwd: CHOSEN })
  })

  it('resumes in the persisted cwd when it still exists (stale-cwd guard inactive)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    resumeMap.set('p1', { sessionId: 'sess-old', cwd: '/persisted/dir' })
    const mint = vi.fn(() => 'sess-fresh')
    const dirExists = vi.fn(() => true)
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(result).toEqual({ args: ['--resume', 'sess-old'], resume: true, cwd: '/persisted/dir' })
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-old', cwd: '/persisted/dir' })
  })

  // terminal-cwd-persist-v1 regression: after onResumeFailure re-spawns a fresh session,
  // the tab's cwd must survive through the fresh session's exit so enrichSnapshotForSave
  // can persist it and pty:restart can use it. The bug: onExit deleted the sessionMap
  // entry, so the next save dropped the tab (or pty:restart fell to sandbox). Fix:
  // onExit no longer deletes from terminalSessionMap (only pty:dispose does). This test
  // asserts the invariant: a pty:restart re-spawn (fresh, no resumeMap entry) using the
  // recorded cwd from sessionMap produces the correct spawn in the picked folder, NOT sandbox.
  it('pty:restart re-spawn via sessionMap cwd produces the picked folder, not sandbox (terminal-cwd-persist-v1 regression)', () => {
    const SANDBOX = '/userData/sandbox'
    const PICKED = '/Users/me/my-project'

    // Step 1: user picks a folder — fresh tab, no resumeMap entry.
    const resumeMap = new Map<string, PaneSessionRecord>()
    const sessionMap = new Map<string, PaneSessionRecord>()
    let n = 0
    const mint = vi.fn(() => `sess-${++n}`)

    const firstSpawn = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, PICKED)
    expect(firstSpawn.cwd).toBe(PICKED)
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-1', cwd: PICKED })

    // Step 2: the fresh claude exits. With the fix, onExit does NOT delete from
    // sessionMap — the cwd record survives. Simulate by leaving sessionMap intact.
    // (Pre-fix: onExit called terminalSessionMap.delete(paneId) here, losing PICKED.)

    // Step 3: pty:restart re-spawns. The handler reads cwd from sessionMap (index.ts fix),
    // then calls resolvePaneSpawn as a FRESH spawn (paneId NOT in resumeMap).
    // The recorded cwd is PICKED — not sandbox.
    const recorded = sessionMap.get('p1')
    expect(recorded?.cwd).toBe(PICKED) // would be undefined pre-fix (entry was deleted)

    const restartSpawn = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, recorded?.cwd)
    expect(restartSpawn.cwd).toBe(PICKED)
    expect(restartSpawn.resume).toBe(false)
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-2', cwd: PICKED })
  })

  // session-resume-relaunch-v1 (THE BUG): a restored tab's `pty:start` fires TWICE for the same
  // paneId — React StrictMode in dev mounts → disposes → remounts. Start #1 finds the resume
  // entry, resumes the ORIGINAL session in the picked cwd, and SINGLE-CONSUMES the resume entry.
  // The dispose between the two starts no longer clears `terminalSessionMap` (index.ts fix), so the
  // session RECORD survives. Start #2 (same paneId, NO overrideCwd, no resume entry) must
  // RE-ATTACH THE SAME ORIGINAL session id in the SAME picked cwd — NOT mint a fresh id and NOT
  // re-sandbox.
  //
  // ROOT CAUSE this guards: the prior reuse branch MINTED A FRESH session id here, overwriting the
  // record with an EMPTY session that has no conversation on disk. `enrichSnapshotForSave` then
  // persisted that fresh id, so on the next relaunch the conversation was "lost" (orphaned) AND
  // `--resume <persisted-id>` found nothing. Reusing the ORIGINAL id preserves resumability
  // (FR-019 stable id / FR-020 resume).
  //
  // FLAG: the reuse branch uses `--session-id <ORIGINAL>` (NOT `--resume`). `--session-id` is
  // create-or-continue: a populated session continues, an empty one never prints "No conversation
  // found with session ID: <id>". (The genuine restore-from-disk Start #1 still uses `--resume`.)
  it('idempotent re-start: Start#2 (same paneId, no override) re-attaches the ORIGINAL session id in the picked cwd (StrictMode double-start, resumability preserved)', () => {
    const PICKED = '/Users/me/a2tui'
    const resumeMap = new Map<string, PaneSessionRecord>([
      ['p1', { sessionId: 'sess-resume', cwd: PICKED }]
    ])
    const sessionMap = new Map<string, PaneSessionRecord>()
    const mint = vi.fn(() => 'sess-fresh-SHOULD-NOT-BE-USED')
    const dirExists = vi.fn(() => true)

    // Start #1: GENUINE restore-from-disk — resume in the picked cwd; single-consumes the resume
    // entry, records the ORIGINAL id. This path keeps `--resume` (a prior conversation exists).
    const start1 = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(start1).toEqual({ args: ['--resume', 'sess-resume'], resume: true, cwd: PICKED })
    expect(resumeMap.has('p1')).toBe(false) // single-consumed
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-resume', cwd: PICKED })

    // (StrictMode dispose runs here — index.ts no longer clears sessionMap, so the record survives.)

    // Start #2: same paneId, NO resume entry, NO override. Re-attach the SAME ORIGINAL id so the
    // conversation is preserved — never mint a fresh id (which would orphan it) and never sandbox.
    const start2 = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(start2.resume).toBe(false)
    expect(start2.cwd).toBe(PICKED) // cwd preserved
    expect(start2.cwd).not.toBe(SANDBOX)
    expect(start2.args[0]).toBe('--session-id')
    expect(start2.args).not.toContain('--resume') // never "No conversation found"
    expect(start2.args[1]).toBe('sess-resume') // <-- THE FIX: the ORIGINAL id, not a fresh one
    expect(mint).not.toHaveBeenCalled() // no fresh id minted — the conversation is preserved
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-resume', cwd: PICKED })
  })

  // session-resume-relaunch-v1: the SAME idempotent re-start protects a FRESHLY-PICKED tab too. Its
  // first start is a fresh spawn that records the picked cwd; a StrictMode remount (no resume
  // entry, no override) must re-attach that recorded session in the picked cwd, keeping the SAME id
  // (reusing it via `--session-id` create-or-continues an as-yet-empty session without error).
  it('idempotent re-start of a freshly-picked tab: re-start re-attaches the recorded session id + picked cwd via --session-id', () => {
    const PICKED = '/Users/me/project'
    const { resumeMap, sessionMap } = makeMaps()
    let n = 0
    const mint = vi.fn(() => `sess-${++n}`)

    // First start: fresh pick records the picked cwd + minted session.
    const first = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, PICKED)
    expect(first).toEqual({ args: ['--session-id', 'sess-1'], resume: false, cwd: PICKED })

    // StrictMode remount: no override, sessionMap record survives → re-attach the picked cwd with
    // the SAME id (create-or-continue; reusing 'sess-1' preserves whatever conversation now exists).
    const second = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint)
    expect(second.resume).toBe(false)
    expect(second.cwd).toBe(PICKED) // cwd preserved, NOT re-sandboxed
    expect(second.cwd).not.toBe(SANDBOX)
    expect(second.args).not.toContain('--resume') // never "No conversation found" on empty session
    expect(second.args[1]).toBe('sess-1') // SAME id — the conversation continues
    expect(mint).toHaveBeenCalledTimes(1) // only the first start minted; the re-start reuses
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-1', cwd: PICKED })
  })

  // restart-pty-cwd-v1 must still win on a re-start: an explicit folder pick (overrideCwd) on a
  // pane that ALREADY has a recorded session must change the cwd — the idempotent reuse branch
  // only applies to a cwd-LESS re-start, never suppressing a genuine pick (#121 not regressed).
  it('an explicit overrideCwd on a re-start still changes the cwd (pick wins over idempotent reuse)', () => {
    const FIRST = '/Users/me/first'
    const SECOND = '/Users/me/second'
    const { resumeMap, sessionMap } = makeMaps()
    let n = 0
    const mint = vi.fn(() => `sess-${++n}`)

    // The pane already started once (recorded FIRST).
    resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, FIRST)
    expect(sessionMap.get('p1')?.cwd).toBe(FIRST)

    // A real pick of SECOND must re-point the pane (fresh spawn in SECOND), not reuse FIRST.
    const picked = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, SECOND)
    expect(picked.cwd).toBe(SECOND)
    expect(sessionMap.get('p1')?.cwd).toBe(SECOND)
  })

  // session-resume-relaunch-v1: the stale-cwd guard still applies to the idempotent reuse branch —
  // if the recorded folder no longer resolves the SPAWN falls back to the sandbox while the RECORD
  // keeps the chosen folder (non-destructive), so a transient miss never erases it. The SESSION ID
  // is preserved regardless (only the spawn cwd falls back), so the conversation stays resumable.
  it('idempotent re-start falls the SPAWN back to sandbox when the recorded cwd is gone, preserving the record AND the session id', () => {
    const GONE = '/persisted/gone'
    const { resumeMap, sessionMap } = makeMaps()
    sessionMap.set('p1', { sessionId: 'sess-keep', cwd: GONE })
    const mint = vi.fn(() => 'sess-new-SHOULD-NOT-BE-USED')
    const dirExists = vi.fn((d: string) => d === SANDBOX)
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    // Reuse branch keeps the SAME `--session-id` (create-or-continue, conversation preserved); the
    // SPAWN falls back to sandbox because the recorded folder is gone.
    expect(result.args[0]).toBe('--session-id')
    expect(result.args[1]).toBe('sess-keep') // SAME id — never re-minted
    expect(result.resume).toBe(false)
    expect(result.cwd).toBe(SANDBOX)
    expect(mint).not.toHaveBeenCalled()
    // The record keeps the chosen folder + the original id so a reappearing folder restores next launch.
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-keep', cwd: GONE })
  })

  // session-resume-relaunch-v1 (THE REGRESSION, end-to-end branch selection): on a genuine
  // quit→relaunch OR a Mac sleep/wake→restart recovery, the pane MUST continue the ORIGINAL
  // claude session, NEVER replace it with a fresh `--session-id`. This asserts the full sequence
  // that the two symptoms (content lost + resume impossible) both stem from a fresh-id substitution.
  it('relaunch + restart-recovery keeps the ORIGINAL session id across the whole lifecycle (no fresh id ever substituted)', () => {
    const CWD = '/Users/me/work'
    const ORIGINAL = 'sess-original-conversation'
    // session:load seeds the resume map from the persisted tab (index.ts session:load handler).
    const resumeMap = new Map<string, PaneSessionRecord>([['p1', { sessionId: ORIGINAL, cwd: CWD }]])
    const sessionMap = new Map<string, PaneSessionRecord>()
    const mint = vi.fn(() => 'sess-FRESH-must-never-appear')
    const dirExists = vi.fn(() => true)

    // Relaunch: the first pty:start RESUMES the original conversation in its persisted cwd.
    const relaunch = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(relaunch).toEqual({ args: ['--resume', ORIGINAL], resume: true, cwd: CWD })
    expect(sessionMap.get('p1')?.sessionId).toBe(ORIGINAL)

    // Mac sleep/wake later kills the PTY; the user clicks Restart (index.ts PtyChannel.Restart now
    // delegates to paneSpawnFor with NO override). The resume entry was already consumed, so this
    // is the idempotent reuse branch — it MUST continue the ORIGINAL id, not start fresh.
    const restart = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(restart.resume).toBe(false)
    expect(restart.args).toEqual(['--session-id', ORIGINAL]) // continue, do not orphan
    expect(restart.cwd).toBe(CWD)

    // A SECOND restart still continues the same conversation — the id is a stable invariant.
    const restart2 = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, undefined, dirExists)
    expect(restart2.args).toEqual(['--session-id', ORIGINAL])

    // Across the entire lifecycle a fresh id was NEVER minted — the persisted id stays ORIGINAL, so
    // every future relaunch can `--resume` the real conversation (both symptoms fixed at the root).
    expect(mint).not.toHaveBeenCalled()
    expect(sessionMap.get('p1')).toEqual({ sessionId: ORIGINAL, cwd: CWD })
  })

  it('does not affect a different pane (per-pane independence, FR-007)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    let n = 0
    const mint = vi.fn(() => `sess-${++n}`)
    resolvePaneSpawn('a', SANDBOX, resumeMap, sessionMap, mint, '/dir/a')
    resolvePaneSpawn('b', SANDBOX, resumeMap, sessionMap, mint, '/dir/b')
    expect(sessionMap.get('a')?.cwd).toBe('/dir/a')
    expect(sessionMap.get('b')?.cwd).toBe('/dir/b')
  })
})
