import { describe, it, expect, vi } from 'vitest'
import { AgentSessionStore, type AgentSessionFsLike } from './agentSessionStore'

/** An in-memory fs that records writes and supports atomic rename (mirrors sessionStore.test). */
function makeFs(): AgentSessionFsLike & {
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

function makeStore(warn = vi.fn()) {
  const fs = makeFs()
  const store = new AgentSessionStore({
    filePath: '/u/agent-session.json',
    dirPath: '/u',
    fs,
    warn
  })
  return { store, fs, warn }
}

describe('AgentSessionStore — round trip', () => {
  it('saves then loads back the same default session id', () => {
    const { store } = makeStore()
    store.saveDefaultSessionId('sess-abc')
    expect(store.loadDefaultSessionId()).toBe('sess-abc')
  })

  it('persists atomically (writes a .tmp then renames over the target)', () => {
    const { store, fs } = makeStore()
    store.saveDefaultSessionId('sess-xyz')
    // The only write went to the tmp path; after rename the final file holds it.
    expect(fs.writes).toEqual(['/u/agent-session.json.tmp'])
    expect(fs.files.has('/u/agent-session.json')).toBe(true)
    expect(fs.files.has('/u/agent-session.json.tmp')).toBe(false)
    const json = JSON.parse(fs.files.get('/u/agent-session.json')!.toString('utf8'))
    expect(json).toEqual({ defaultSessionId: 'sess-xyz' })
  })
})

describe('AgentSessionStore.loadDefaultSessionId — defensive', () => {
  it('returns null when no file exists (caller mints a fresh id)', () => {
    const { store } = makeStore()
    expect(store.loadDefaultSessionId()).toBeNull()
  })

  it('returns null + warns on unparsable JSON', () => {
    const { store, fs, warn } = makeStore()
    fs.files.set('/u/agent-session.json', Buffer.from('{not json', 'utf8'))
    expect(store.loadDefaultSessionId()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null + warns when the record is the wrong shape (missing/blank id)', () => {
    const { store, fs, warn } = makeStore()
    fs.files.set('/u/agent-session.json', Buffer.from(JSON.stringify({ defaultSessionId: '' }), 'utf8'))
    expect(store.loadDefaultSessionId()).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null for a non-object payload', () => {
    const { store, fs } = makeStore()
    fs.files.set('/u/agent-session.json', Buffer.from(JSON.stringify('a-bare-string'), 'utf8'))
    expect(store.loadDefaultSessionId()).toBeNull()
  })
})

describe('AgentSessionStore.saveDefaultSessionId — validation', () => {
  it('refuses to persist a blank id and never writes a file', () => {
    const { store, fs, warn } = makeStore()
    store.saveDefaultSessionId('   ')
    expect(fs.writes).toEqual([])
    expect(fs.files.has('/u/agent-session.json')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('does not throw and cleans up a stray tmp when the write fails', () => {
    const { store, fs } = makeStore()
    const rm = vi.spyOn(fs, 'rmSync')
    fs.writeFileSync = () => {
      throw new Error('EACCES')
    }
    expect(() => store.saveDefaultSessionId('sess-1')).not.toThrow()
    expect(rm).toHaveBeenCalled()
  })
})
