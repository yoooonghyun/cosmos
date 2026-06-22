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
