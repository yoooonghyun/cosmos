import { describe, it, expect, vi } from 'vitest'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../shared/ipc'
import {
  emptySnapshot,
  reconcileEverOpened,
  reconcileGenerativePanel,
  validateSnapshot
} from './sessionSnapshot'

/** A spec-compliant, fully-populated snapshot for the happy-path tests. */
function goodSnapshot(): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: {
        tabs: [
          { id: 'pane-1', label: 'Terminal', sessionId: 'sess-1', cwd: '/work', scrollback: 'hello' },
          { id: 'pane-2', label: 'My shell', renamed: true, sessionId: 'sess-2', cwd: '/work' }
        ],
        activeTabId: 'pane-2',
        everOpened: 2
      },
      'generated-ui': {
        tabs: [
          {
            id: 'g1',
            label: 'A form',
            untitled: false,
            composed: true,
            surface: { spec: { surfaceId: 's', components: [] } }
          }
        ],
        activeTabId: 'g1',
        everOpened: 1
      },
      jira: { tabs: [], activeTabId: null, everOpened: 0 },
      slack: { tabs: [], activeTabId: null, everOpened: 0 },
      confluence: { tabs: [], activeTabId: null, everOpened: 0 }
    }
  }
}

describe('validateSnapshot — happy path (FR-002/FR-008/FR-012)', () => {
  it('passes a fully-valid snapshot through, preserving every persisted field', () => {
    const warn = vi.fn()
    const out = validateSnapshot(goodSnapshot(), warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out).not.toBeNull()
    expect(out!.panels.terminal.tabs).toHaveLength(2)
    expect(out!.panels.terminal.tabs[0]).toMatchObject({
      id: 'pane-1',
      sessionId: 'sess-1',
      cwd: '/work',
      scrollback: 'hello'
    })
    expect(out!.panels.terminal.tabs[1].renamed).toBe(true)
    expect(out!.panels['generated-ui'].tabs[0].composed).toBe(true)
    expect(out!.panels['generated-ui'].tabs[0].surface).toEqual({
      spec: { surfaceId: 's', components: [] }
    })
  })
})

describe('validateSnapshot — missing optional fields do not error (FR-014)', () => {
  it('accepts a terminal tab without renamed/scrollback', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [{ id: 'p', label: 'T', sessionId: 's', cwd: '/w' }]
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.panels.terminal.tabs[0]).toEqual({ id: 'p', label: 'T', sessionId: 's', cwd: '/w' })
  })

  it('accepts a generative tab with no surface (base tab) and defaults its label', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    // missing label is allowed — falls back to the id.
    snap.panels.jira = {
      tabs: [{ id: 'j1', untitled: true } as never],
      activeTabId: 'j1',
      everOpened: 1
    }
    const out = validateSnapshot(snap, warn)
    expect(out!.panels.jira.tabs[0]).toEqual({ id: 'j1', label: 'j1', untitled: true })
  })
})

describe('validateSnapshot — invalid/missing required field warns + safe fallback (FR-004/FR-005)', () => {
  it('returns null + warns when the value is not an object', () => {
    const warn = vi.fn()
    expect(validateSnapshot(null, warn)).toBeNull()
    expect(validateSnapshot('nope', warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null + warns on a wrong/unknown schemaVersion (FR-002)', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    ;(snap as { schemaVersion: number }).schemaVersion = 999
    expect(validateSnapshot(snap, warn)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schemaVersion'))
  })

  it('drops a terminal tab missing required sessionId/cwd but keeps the rest', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      { id: 'ok', label: 'T', sessionId: 's', cwd: '/w' },
      { id: 'bad', label: 'T2' } as never
    ]
    const out = validateSnapshot(snap, warn)
    expect(out!.panels.terminal.tabs).toHaveLength(1)
    expect(out!.panels.terminal.tabs[0].id).toBe('ok')
    expect(warn).toHaveBeenCalled()
  })

  it('strips a generative surface that is NOT composed:true (FR-015)', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.panels.slack = {
      tabs: [
        {
          id: 's1',
          label: 'live data',
          untitled: false,
          // composed flag absent → a live data view, surface must NOT survive
          surface: { spec: { surfaceId: 'x', components: [] } }
        } as never
      ],
      activeTabId: 's1',
      everOpened: 1
    }
    const out = validateSnapshot(snap, warn)
    expect(out!.panels.slack.tabs[0].surface).toBeUndefined()
    expect(out!.panels.slack.tabs[0].composed).toBeUndefined()
  })
})

describe('reconcileEverOpened (FR-010)', () => {
  it('floors to at least the tab count', () => {
    expect(reconcileEverOpened(1, 3)).toBe(3)
    expect(reconcileEverOpened(5, 3)).toBe(5)
  })
  it('treats garbage/negative as the tab count', () => {
    expect(reconcileEverOpened('x', 2)).toBe(2)
    expect(reconcileEverOpened(-4, 2)).toBe(2)
    expect(reconcileEverOpened(undefined, 0)).toBe(0)
  })
})

describe('reconcileGenerativePanel — active id pruning (FR-008/FR-011)', () => {
  it('drops an active id that no longer names a tab, falling back to the first tab', () => {
    const out = reconcileGenerativePanel(
      [{ id: 'a', label: 'A', untitled: false }],
      'gone',
      0
    )
    expect(out.activeTabId).toBe('a')
  })
  it('keeps zero tabs as a zero-tab panel (FR-011)', () => {
    const out = reconcileGenerativePanel([], 'whatever', 9)
    expect(out.tabs).toHaveLength(0)
    expect(out.activeTabId).toBeNull()
    expect(out.everOpened).toBe(9)
  })
})

describe('emptySnapshot', () => {
  it('is a clean, version-matching, zero-tab session (FR-005)', () => {
    const e = emptySnapshot()
    expect(e.schemaVersion).toBe(SESSION_SCHEMA_VERSION)
    expect(e.panels.terminal.tabs).toHaveLength(0)
    expect(e.panels['generated-ui'].tabs).toHaveLength(0)
    // round-trips through the validator unchanged.
    expect(validateSnapshot(e)).toEqual(e)
  })
})
