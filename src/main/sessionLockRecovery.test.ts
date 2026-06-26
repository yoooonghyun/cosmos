import { describe, it, expect } from 'vitest'
import {
  isAlreadyInUseError,
  findRegistryHolder,
  recoverSessionLock,
  type SessionLockEnv
} from './sessionLockRecovery'

/**
 * session-resume-relaunch-v1 — pure recovery of a recorded `claude` session id rejected on
 * relaunch with "Session ID <id> is already in use". The blocker is a running-session registry
 * entry (`~/.claude/sessions/<pid>.json`) naming the id with a still-alive (orphan) pid, or a
 * stale entry whose pid is dead. The resolver kills the orphan / removes the stale file and tells
 * the caller to retry the resume ONCE — never minting a fresh id (which would orphan the content).
 */
describe('isAlreadyInUseError', () => {
  it('matches claude\'s "already in use" rejection (id-agnostic, case-insensitive)', () => {
    expect(
      isAlreadyInUseError('Error: Session ID 53764148-d493-4cfe-81cd-1501d8e4abea is already in use.')
    ).toBe(true)
    expect(isAlreadyInUseError('session id ABC is ALREADY IN USE')).toBe(true)
  })

  it('does not match unrelated output or missing/empty text', () => {
    expect(isAlreadyInUseError('No conversation found with session ID: abc')).toBe(false)
    expect(isAlreadyInUseError('claude exited (signal 1)')).toBe(false)
    expect(isAlreadyInUseError(undefined)).toBe(false)
    expect(isAlreadyInUseError('')).toBe(false)
  })
})

/** Build a SessionLockEnv over an in-memory registry for deterministic tests. */
function makeEnv(
  entries: Array<{ file: string; pid: number; sessionId: string }>,
  alivePids: Set<number>
): {
  env: SessionLockEnv
  killed: number[]
  removed: string[]
} {
  const killed: number[] = []
  const removed: string[] = []
  const byFile = new Map(entries.map((e) => [e.file, { pid: e.pid, sessionId: e.sessionId }]))
  const env: SessionLockEnv = {
    listRegistryFiles: () => entries.map((e) => e.file),
    readEntry: (filePath) => byFile.get(filePath) ?? null,
    isAlive: (pid) => alivePids.has(pid),
    killPid: (pid) => {
      killed.push(pid)
    },
    removeFile: (filePath) => {
      removed.push(filePath)
    }
  }
  return { env, killed, removed }
}

describe('findRegistryHolder', () => {
  it('returns the entry naming the session id', () => {
    const { env } = makeEnv(
      [
        { file: '/s/100.json', pid: 100, sessionId: 'other' },
        { file: '/s/200.json', pid: 200, sessionId: 'target' }
      ],
      new Set([100, 200])
    )
    expect(findRegistryHolder('target', env)).toEqual({
      pid: 200,
      sessionId: 'target',
      filePath: '/s/200.json'
    })
  })

  it('returns null when no entry names the id, and skips malformed entries', () => {
    const env: SessionLockEnv = {
      listRegistryFiles: () => ['/s/1.json', '/s/2.json'],
      readEntry: (f) => (f === '/s/1.json' ? null : { pid: 9, sessionId: 'nope' }),
      isAlive: () => true,
      killPid: () => {},
      removeFile: () => {}
    }
    expect(findRegistryHolder('target', env)).toBeNull()
  })

  it('returns null for an empty/invalid session id', () => {
    const { env } = makeEnv([{ file: '/s/1.json', pid: 1, sessionId: '' }], new Set([1]))
    expect(findRegistryHolder('', env)).toBeNull()
  })
})

describe('recoverSessionLock', () => {
  // THE PRIMARY RECOVERY: a live orphan claude (survived a Mac sleep / force-quit of cosmos) still
  // holds the recorded id. Kill it + drop its registry file so the id is free; caller retries ONCE.
  it('kills a LIVE orphan holding the id and signals retry (never mints a fresh id)', () => {
    const { env, killed, removed } = makeEnv(
      [{ file: '/s/777.json', pid: 777, sessionId: 'sess-orphan' }],
      new Set([777])
    )
    const result = recoverSessionLock('sess-orphan', env)
    expect(result).toEqual({ kind: 'killed-orphan', pid: 777, retry: true })
    expect(killed).toEqual([777]) // ONLY the registry-named holder was killed
    expect(removed).toEqual(['/s/777.json'])
  })

  // A registry file whose pid is DEAD = claude crashed/SIGKILLed without cleanup. The id is not
  // actually held; remove the stale file so the next scan agrees, and retry.
  it('removes a STALE (dead-pid) registry file and signals retry', () => {
    const { env, killed, removed } = makeEnv(
      [{ file: '/s/888.json', pid: 888, sessionId: 'sess-stale' }],
      new Set() // 888 is not alive
    )
    const result = recoverSessionLock('sess-stale', env)
    expect(result).toEqual({ kind: 'removed-stale', pid: 888, retry: true })
    expect(killed).toEqual([]) // never kill a dead pid
    expect(removed).toEqual(['/s/888.json'])
  })

  // No registry entry names the id → the "already in use" did not come from a recoverable holder
  // (or the holder already exited between the reject and the scan). Do NOT retry blindly.
  it('does nothing and signals no-retry when no registry entry holds the id', () => {
    const { env, killed, removed } = makeEnv(
      [{ file: '/s/1.json', pid: 1, sessionId: 'unrelated' }],
      new Set([1])
    )
    const result = recoverSessionLock('sess-missing', env)
    expect(result).toEqual({ kind: 'no-holder', retry: false })
    expect(killed).toEqual([])
    expect(removed).toEqual([])
  })

  it('never throws and only touches the holder it found (other live sessions untouched)', () => {
    const { env, killed, removed } = makeEnv(
      [
        { file: '/s/100.json', pid: 100, sessionId: 'sibling-alive' },
        { file: '/s/200.json', pid: 200, sessionId: 'sess-orphan' }
      ],
      new Set([100, 200])
    )
    const result = recoverSessionLock('sess-orphan', env)
    expect(result.kind).toBe('killed-orphan')
    expect(killed).toEqual([200]) // the sibling's live claude (pid 100) is never killed
    expect(removed).toEqual(['/s/200.json'])
  })
})
