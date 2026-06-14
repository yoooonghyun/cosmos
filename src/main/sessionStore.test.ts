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

  // panel-refresh-v1 regression: a pre-v3 snapshot can pair a literal-prop surface with a
  // descriptor — restored under the new code that combination enables the panel refresh
  // control yet cannot repaint (literal props ignore updateDataModel). The schema bump must
  // invalidate it so it falls back to a clean session instead of a dead refresh button.
  it('rejects a stale v2 snapshot whose composed surface is literal-prop + descriptor', () => {
    const { store, fs } = makeStore()
    const staleV2 = {
      schemaVersion: 2,
      panels: {
        terminal: { tabs: [], activeTabId: null, everOpened: 0 },
        'generated-ui': { tabs: [], activeTabId: null, everOpened: 0 },
        jira: {
          tabs: [
            {
              id: 't1',
              label: '칸반보드로 만들어줘',
              untitled: false,
              composed: true,
              descriptor: { dataSource: 'getIssue', query: { issueKey: 'CSMS-7' } },
              surface: {
                spec: {
                  surfaceId: 'jira-kanban',
                  components: [{ id: 'root', component: 'IssueList', issues: [{ issueKey: 'CSMS-7' }] }]
                }
              }
            }
          ],
          activeTabId: 't1',
          everOpened: 1
        },
        slack: { tabs: [], activeTabId: null, everOpened: 0 },
        confluence: { tabs: [], activeTabId: null, everOpened: 0 }
      }
    }
    fs.files.set('/u/session.json', Buffer.from(JSON.stringify(staleV2), 'utf8'))
    expect(store.load()).toBeNull()
  })

  // refreshable-custom-generative-ui-v1 (FR-013/SC-005): the register-agent-surface rule
  // changed the meaning of a persisted descriptor-bearing surface (it is now the AGENT's own
  // spec, re-registered under the AGENT's surfaceId). A v3 snapshot was written under the
  // shell-replacement rule, so its descriptor pairs with a SHELL spec; restored under v4 it
  // would be wrongly re-registered as the agent's own bound layout. The 3→4 bump must treat a
  // v3 snapshot as unreadable, falling back to a clean session.
  it('rejects a stale v3 snapshot after the 3→4 bump (SC-005)', () => {
    const { store, fs } = makeStore()
    const staleV3 = {
      schemaVersion: 3,
      panels: {
        terminal: { tabs: [], activeTabId: null, everOpened: 0 },
        'generated-ui': { tabs: [], activeTabId: null, everOpened: 0 },
        jira: {
          tabs: [
            {
              id: 't1',
              label: '칸반보드로 만들어줘',
              untitled: false,
              composed: true,
              descriptor: { dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()' } },
              // v3 persisted the SHELL spec (register-by-shell), not the agent's custom layout.
              surface: {
                spec: { surfaceId: 'jira-issue-list', components: [{ id: 'root', component: 'IssueList' }] }
              }
            }
          ],
          activeTabId: 't1',
          everOpened: 1
        },
        slack: { tabs: [], activeTabId: null, everOpened: 0 },
        confluence: { tabs: [], activeTabId: null, everOpened: 0 }
      }
    }
    fs.files.set('/u/session.json', Buffer.from(JSON.stringify(staleV3), 'utf8'))
    expect(store.load()).toBeNull()
  })

  // FR-010: a CURRENT (v4) snapshot carrying a custom agent bound surface (its verbatim spec +
  // secret-free descriptor) round-trips intact, so a restored custom bound surface is
  // re-instated + refreshable.
  it('round-trips a v4 custom bound composed surface + descriptor (FR-010)', () => {
    const { store } = makeStore()
    const snap: SessionSnapshot = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      panels: {
        terminal: { tabs: [], activeTabId: null, everOpened: 0 },
        'generated-ui': { tabs: [], activeTabId: null, everOpened: 0 },
        jira: {
          tabs: [
            {
              id: 't1',
              label: '칸반보드로 만들어줘',
              untitled: false,
              composed: true,
              descriptor: { dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()' } },
              surface: {
                spec: {
                  surfaceId: 'agent-kanban-7',
                  components: [{ id: 'root', component: 'Column', children: [] }]
                }
              }
            }
          ],
          activeTabId: 't1',
          everOpened: 1
        },
        slack: { tabs: [], activeTabId: null, everOpened: 0 },
        confluence: { tabs: [], activeTabId: null, everOpened: 0 }
      }
    } as unknown as SessionSnapshot
    store.save(snap)
    expect(store.load()).toEqual(snap)
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
