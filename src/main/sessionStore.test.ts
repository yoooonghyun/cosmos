import { describe, it, expect, vi } from 'vitest'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../shared/ipc'
import { SessionStore, type SessionFsLike } from './sessionStore'

/** An in-memory fs that records writes and supports atomic rename. */
function makeFs(): SessionFsLike & {
  files: Map<string, Buffer>
  dirs: Set<string>
  writes: string[]
} {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()
  const writes: string[] = []
  return {
    files,
    dirs,
    writes,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const b = files.get(p)
      if (!b) throw new Error('ENOENT')
      return b
    },
    writeFileSync: (p, data) => {
      writes.push(p)
      files.set(p, data)
    },
    mkdirSync: (p) => {
      dirs.add(p)
    },
    renameSync: (from, to) => {
      const b = files.get(from)
      if (!b) throw new Error('ENOENT')
      files.set(to, b)
      files.delete(from)
    },
    rmSync: (p) => {
      files.delete(p)
    }
  }
}

function goodSnapshot(): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: {
        tabs: [{ id: 'p1', label: 'Terminal', sessionId: 'sess-1', cwd: '/work' }],
        activeTabId: 'p1',
        everOpened: 1
      },
      'generated-ui': { tabs: [], activeTabId: null, everOpened: 0 },
      jira: { tabs: [], activeTabId: null, everOpened: 0 },
      slack: { tabs: [], activeTabId: null, everOpened: 0 },
      confluence: { tabs: [], activeTabId: null, everOpened: 0 }
    }
  }
}

function makeStore(warn = vi.fn()) {
  const fs = makeFs()
  const store = new SessionStore({
    filePath: '/u/session.json',
    dirPath: '/u',
    fs,
    warn
  })
  return { store, fs, warn }
}

describe('SessionStore — round trip (FR-001)', () => {
  it('saves then loads back the same snapshot', () => {
    const { store } = makeStore()
    const snap = goodSnapshot()
    store.save(snap)
    expect(store.load()).toEqual(snap)
  })

  it('writes to a tmp path then renames over the target (atomic — FR-007)', () => {
    const { store, fs } = makeStore()
    store.save(goodSnapshot())
    expect(fs.writes).toEqual(['/u/session.json.tmp'])
    expect(fs.files.has('/u/session.json')).toBe(true)
    expect(fs.files.has('/u/session.json.tmp')).toBe(false)
  })
})

describe('SessionStore — load fallback (FR-005)', () => {
  it('returns null when no file exists', () => {
    const { store } = makeStore()
    expect(store.load()).toBeNull()
  })

  it('returns null + warns on unparseable JSON', () => {
    const { store, fs, warn } = makeStore()
    fs.files.set('/u/session.json', Buffer.from('{not json', 'utf8'))
    expect(store.load()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null on a wrong-schema file (FR-002)', () => {
    const { store, fs } = makeStore()
    fs.files.set('/u/session.json', Buffer.from(JSON.stringify({ schemaVersion: 99 }), 'utf8'))
    expect(store.load()).toBeNull()
  })
})

describe('SessionStore — save guards (FR-004/FR-007)', () => {
  it('ignores an invalid snapshot WITHOUT overwriting an existing good file', () => {
    const { store, fs, warn } = makeStore()
    store.save(goodSnapshot())
    const before = fs.files.get('/u/session.json')
    store.save({ schemaVersion: 99 } as never)
    expect(warn).toHaveBeenCalled()
    expect(fs.files.get('/u/session.json')).toBe(before) // unchanged
  })

  it('writes no secret-bearing fields — the persisted bytes are just structure (SC-004)', () => {
    const { store, fs } = makeStore()
    store.save(goodSnapshot())
    const onDisk = fs.files.get('/u/session.json')!.toString('utf8')
    expect(onDisk).not.toContain('accessToken')
    expect(onDisk).not.toContain('refreshToken')
    expect(onDisk).not.toContain('client_secret')
    expect(onDisk).not.toContain('Authorization')
  })
})
