import { describe, it, expect, vi } from 'vitest'
import { resolvePaneSpawn, type PaneSessionRecord } from './paneSpawn'

/**
 * terminal-open-directory-picker-v1 FR-004 + session-persistence-v1 D2/FR-019/FR-020:
 * the pure per-pane spawn resolver. A fresh tab honours an override cwd (the chosen
 * directory); a resumed tab keeps its persisted cwd and ignores the override (OQ-2).
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

  it('resumes in the persisted cwd and IGNORES any override (OQ-2)', () => {
    const { resumeMap, sessionMap } = makeMaps()
    resumeMap.set('p1', { sessionId: 'sess-old', cwd: '/persisted/dir' })
    const mint = vi.fn(() => 'sess-fresh')
    // Even with an override cwd supplied, a resumed pane keeps its persisted cwd.
    const result = resolvePaneSpawn('p1', SANDBOX, resumeMap, sessionMap, mint, '/Users/me/other')
    expect(result).toEqual({ args: ['--resume', 'sess-old'], resume: true, cwd: '/persisted/dir' })
    expect(mint).not.toHaveBeenCalled()
    // The resume entry is consumed (deleted) and the session map records the persisted cwd.
    expect(resumeMap.has('p1')).toBe(false)
    expect(sessionMap.get('p1')).toEqual({ sessionId: 'sess-old', cwd: '/persisted/dir' })
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
