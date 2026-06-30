import { describe, it, expect, vi } from 'vitest'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../../shared/ipc'
import {
  emptyEnabledIntegrations,
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
      confluence: { tabs: [], activeTabId: null, everOpened: 0 },
      'google-calendar': { tabs: [], activeTabId: null, everOpened: 0 }
    },
    enabled: { slack: false, jira: false, confluence: false, 'google-calendar': false }
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

describe('validateTerminalTab — openFiles (persist-workdir-open-files-v1, FR-003/FR-009/FR-012)', () => {
  it('round-trips a valid openFiles slice (ordered relPaths + a surviving active path)', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      {
        id: 'p',
        label: 'T',
        sessionId: 's',
        cwd: '/w',
        openFiles: { files: ['a.ts', 'src/b.ts', 'c.ts'], activeRelPath: 'src/b.ts' }
      }
    ]
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.panels.terminal.tabs[0].openFiles).toEqual({
      files: ['a.ts', 'src/b.ts', 'c.ts'],
      activeRelPath: 'src/b.ts'
    })
  })

  it('restores a tab with NO openFiles (older snapshot / no files open) without error — safe default', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [{ id: 'p', label: 'T', sessionId: 's', cwd: '/w' }]
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.panels.terminal.tabs[0]).not.toHaveProperty('openFiles')
  })

  it('drops a non-array files / non-string entries; omits the field when nothing valid survives', () => {
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      { id: 'a', label: 'T', sessionId: 's', cwd: '/w', openFiles: { files: 'nope', activeRelPath: null } } as never,
      {
        id: 'b',
        label: 'T',
        sessionId: 's',
        cwd: '/w',
        openFiles: { files: [1, '', 'keep.ts', null, 'keep.ts'], activeRelPath: 'keep.ts' }
      } as never,
      { id: 'c', label: 'T', sessionId: 's', cwd: '/w', openFiles: { files: [42, null], activeRelPath: 'x' } } as never
    ]
    const out = validateSnapshot(snap)
    // a: files not an array → field omitted entirely.
    expect(out!.panels.terminal.tabs[0]).not.toHaveProperty('openFiles')
    // b: non-string + empty + duplicate dropped → only 'keep.ts' survives (de-duped).
    expect(out!.panels.terminal.tabs[1].openFiles).toEqual({ files: ['keep.ts'], activeRelPath: 'keep.ts' })
    // c: every entry invalid → nothing valid → field omitted.
    expect(out!.panels.terminal.tabs[2]).not.toHaveProperty('openFiles')
  })

  it('nulls an active path that does not name a surviving open file (FR-009)', () => {
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      {
        id: 'p',
        label: 'T',
        sessionId: 's',
        cwd: '/w',
        openFiles: { files: ['a.ts', 'b.ts'], activeRelPath: 'gone.ts' }
      }
    ]
    const out = validateSnapshot(snap)
    expect(out!.panels.terminal.tabs[0].openFiles).toEqual({ files: ['a.ts', 'b.ts'], activeRelPath: null })
  })

  it('nulls a non-string active path while keeping the files', () => {
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      { id: 'p', label: 'T', sessionId: 's', cwd: '/w', openFiles: { files: ['a.ts'], activeRelPath: 7 } } as never
    ]
    const out = validateSnapshot(snap)
    expect(out!.panels.terminal.tabs[0].openFiles).toEqual({ files: ['a.ts'], activeRelPath: null })
  })

  it('treats a non-object openFiles as absent (safe fallback)', () => {
    const snap = goodSnapshot()
    snap.panels.terminal.tabs = [
      { id: 'p', label: 'T', sessionId: 's', cwd: '/w', openFiles: 'nope' } as never
    ]
    const out = validateSnapshot(snap)
    expect(out!.panels.terminal.tabs[0]).not.toHaveProperty('openFiles')
  })
})

describe('validateSnapshot — version bump v8 (persist-workdir-open-files-v1, FR-011/SC-006)', () => {
  it('rejects a v7 (older) snapshot → null → clean session', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    ;(snap as { schemaVersion: number }).schemaVersion = 7
    expect(validateSnapshot(snap, warn)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('schemaVersion'))
  })

  it('the current schema version is 8 (calendar-selection-persistence is additive — no bump)', () => {
    expect(SESSION_SCHEMA_VERSION).toBe(8)
  })

  // Regression guard for the schema-bump wipe (calendar-selection-persistence): a previous
  // story bumped 8→9 for an ADDITIVE field, which made every on-disk v8 snapshot fail the
  // equality gate and wiped the restored terminal session. The bump was reverted. A v8
  // snapshot (the current version) carrying terminal tabs + the new additive PER-TAB
  // hiddenCalendars field must now be ACCEPTED and its terminal tabs restored — NOT wiped.
  it('ACCEPTS a v8 snapshot with terminal tabs + additive per-tab hiddenCalendars (no wipe)', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    ;(snap as { schemaVersion: number }).schemaVersion = 8
    snap.panels.terminal.tabs = [
      { id: 'pane-1', label: 'Terminal', sessionId: 'sess-1', cwd: '/work', scrollback: 'hi' }
    ]
    snap.panels['google-calendar'] = {
      tabs: [{ id: 'cal-1', label: 'Calendar', untitled: false, hiddenCalendars: ['team@x'] }],
      activeTabId: 'cal-1',
      everOpened: 1
    }
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out).not.toBeNull()
    // The terminal session survives — NOT reset to an empty session.
    expect(out!.panels.terminal.tabs).toHaveLength(1)
    expect(out!.panels.terminal.tabs[0]).toMatchObject({ id: 'pane-1', sessionId: 'sess-1', cwd: '/work' })
    // The additive per-tab calendar selection round-trips.
    expect(out!.panels['google-calendar'].tabs[0].hiddenCalendars).toEqual(['team@x'])
  })
})

describe('validateSnapshot — #93 enabled + open-files coexistence (FR-014/SC-008)', () => {
  it('preserves BOTH the enabled map and per-tab openFiles under one version — neither clobbers the other', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.enabled = { slack: true, jira: false, confluence: true, 'google-calendar': false }
    snap.panels.terminal.tabs = [
      {
        id: 'p1',
        label: 'T',
        sessionId: 's1',
        cwd: '/w',
        openFiles: { files: ['a.ts', 'b.ts'], activeRelPath: 'a.ts' }
      }
    ]
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    // #93's field intact.
    expect(out!.enabled).toEqual({ slack: true, jira: false, confluence: true, 'google-calendar': false })
    // this feature's field intact.
    expect(out!.panels.terminal.tabs[0].openFiles).toEqual({ files: ['a.ts', 'b.ts'], activeRelPath: 'a.ts' })
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

  it('defaults every gateable integration to disabled (FR-008)', () => {
    expect(emptySnapshot().enabled).toEqual({
      slack: false,
      jira: false,
      confluence: false,
      'google-calendar': false
    })
  })
})

describe('validateSnapshot — enabled map (settings-redesign-v1, FR-003/FR-007/FR-008)', () => {
  it('round-trips a fully-specified enabled map', () => {
    const warn = vi.fn()
    const snap = goodSnapshot()
    snap.enabled = { slack: true, jira: false, confluence: true, 'google-calendar': false }
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.enabled).toEqual({
      slack: true,
      jira: false,
      confluence: true,
      'google-calendar': false
    })
  })

  it('defaults a MISSING enabled map entirely to disabled (FR-008/FR-018)', () => {
    const snap = goodSnapshot()
    delete (snap as { enabled?: unknown }).enabled
    const out = validateSnapshot(snap)
    expect(out!.enabled).toEqual({
      slack: false,
      jira: false,
      confluence: false,
      'google-calendar': false
    })
  })

  it('defaults MISSING keys to false while keeping present true keys (the migration)', () => {
    const snap = goodSnapshot()
    snap.enabled = { jira: true } as never // only one key present
    const out = validateSnapshot(snap)
    expect(out!.enabled).toEqual({
      slack: false,
      jira: true,
      confluence: false,
      'google-calendar': false
    })
  })

  it('coerces a non-boolean / malformed enabled value to false, never crashing (FR-016/SC-009)', () => {
    const snap = goodSnapshot()
    snap.enabled = { slack: 'yes', jira: 1, confluence: null, 'google-calendar': true } as never
    const out = validateSnapshot(snap)
    expect(out).not.toBeNull()
    expect(out!.enabled).toEqual({
      slack: false,
      jira: false,
      confluence: false,
      'google-calendar': true
    })
  })

  it('treats a non-object enabled field as all-disabled (FR-016)', () => {
    const snap = goodSnapshot()
    snap.enabled = 'nope' as never
    const out = validateSnapshot(snap)
    expect(out!.enabled).toEqual(emptyEnabledIntegrations())
  })
})

describe('validateGenerativeTab — per-tab hiddenCalendars (calendar-selection-persistence, additive)', () => {
  /** Build a snapshot whose google-calendar panel carries the given tabs. */
  function withCalendarTabs(tabs: unknown[]): SessionSnapshot {
    const snap = goodSnapshot()
    snap.panels['google-calendar'] = {
      tabs: tabs as never,
      activeTabId: (tabs[0] as { id?: string } | undefined)?.id ?? null,
      everOpened: tabs.length
    }
    return snap
  }

  it('round-trips a valid per-tab hiddenCalendars list (the persisted deselected calendars)', () => {
    const warn = vi.fn()
    const snap = withCalendarTabs([
      { id: 'cal-1', label: 'Calendar', untitled: false, hiddenCalendars: ['holidays@x', 'team@x'] }
    ])
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.panels['google-calendar'].tabs[0].hiddenCalendars).toEqual(['holidays@x', 'team@x'])
  })

  it('defaults a MISSING hiddenCalendars to absent (the safe default — every calendar shown)', () => {
    const snap = withCalendarTabs([{ id: 'cal-1', label: 'Calendar', untitled: false }])
    const out = validateSnapshot(snap)
    // Absent ⇒ the field is omitted (undefined), not an empty array — older snapshots restore cleanly.
    expect(out!.panels['google-calendar'].tabs[0]).not.toHaveProperty('hiddenCalendars')
  })

  it('drops non-string / empty entries and dedupes, never crashing (the in-version migration)', () => {
    const snap = withCalendarTabs([
      { id: 'cal-1', label: 'Calendar', untitled: false, hiddenCalendars: ['a@x', '', 'a@x', 42, null, 'b@x'] }
    ])
    const out = validateSnapshot(snap)
    expect(out).not.toBeNull()
    expect(out!.panels['google-calendar'].tabs[0].hiddenCalendars).toEqual(['a@x', 'b@x'])
  })

  it('treats a non-array hiddenCalendars field as absent (safe fallback)', () => {
    const snap = withCalendarTabs([
      { id: 'cal-1', label: 'Calendar', untitled: false, hiddenCalendars: 'nope' }
    ])
    const out = validateSnapshot(snap)
    expect(out!.panels['google-calendar'].tabs[0]).not.toHaveProperty('hiddenCalendars')
  })

  it('keeps EACH tab\'s hiddenCalendars independent — two tabs carry separate selections', () => {
    const snap = withCalendarTabs([
      { id: 'cal-1', label: 'Calendar', untitled: false, hiddenCalendars: ['team@x'] },
      { id: 'cal-2', label: 'Calendar 2', untitled: false, hiddenCalendars: ['holidays@x', 'birthdays@x'] }
    ])
    const out = validateSnapshot(snap)
    expect(out!.panels['google-calendar'].tabs[0].hiddenCalendars).toEqual(['team@x'])
    expect(out!.panels['google-calendar'].tabs[1].hiddenCalendars).toEqual(['holidays@x', 'birthdays@x'])
  })
})

describe('validateSnapshot — openPromptPosition (draggable-open-prompt-button-v1, FR-008/FR-009)', () => {
  it('round-trips a valid in-range position (two numbers only — SC-006)', () => {
    const warn = vi.fn()
    const snap = { ...goodSnapshot(), openPromptPosition: { xFrac: 0.25, yFrac: 0.8 } }
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.openPromptPosition).toEqual({ xFrac: 0.25, yFrac: 0.8 })
    // Non-secret: the only keys are the two fractions.
    expect(Object.keys(out!.openPromptPosition!).sort()).toEqual(['xFrac', 'yFrac'])
  })

  it('CLAMPS an out-of-range / off-screen-after-resize position into [0,1] (FR-005/FR-012/SC-007)', () => {
    const snap = { ...goodSnapshot(), openPromptPosition: { xFrac: 5, yFrac: -2 } }
    const out = validateSnapshot(snap)
    expect(out!.openPromptPosition).toEqual({ xFrac: 1, yFrac: 0 })
  })

  it('treats a non-number component as ABSENT (field omitted ⇒ default on restore)', () => {
    const snap = { ...goodSnapshot(), openPromptPosition: { xFrac: 'nope', yFrac: 0.5 } }
    const out = validateSnapshot(snap)
    expect(out).not.toHaveProperty('openPromptPosition')
  })

  it('treats a non-finite component (NaN/Infinity) as absent', () => {
    const snap = { ...goodSnapshot(), openPromptPosition: { xFrac: Number.NaN, yFrac: 0.5 } }
    expect(validateSnapshot(snap)).not.toHaveProperty('openPromptPosition')
  })

  it('treats a non-object openPromptPosition as absent (safe fallback)', () => {
    const snap = { ...goodSnapshot(), openPromptPosition: 'bottom' as unknown }
    expect(validateSnapshot(snap)).not.toHaveProperty('openPromptPosition')
  })

  it('a PRE-FEATURE snapshot (no field) still validates as v8 with the field absent (SC-004)', () => {
    const warn = vi.fn()
    const snap = goodSnapshot() // no openPromptPosition
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out).not.toBeNull()
    expect(out!.schemaVersion).toBe(SESSION_SCHEMA_VERSION) // still 8 — NO bump
    expect(out).not.toHaveProperty('openPromptPosition')
  })
})

describe('validateSnapshot — favorites (cosmos-home-favorite-tabs-v1, FR-030/FR-033)', () => {
  it('round-trips a valid favorites list (non-secret refs only, additive — NO schema bump)', () => {
    const warn = vi.fn()
    const snap = {
      ...goodSnapshot(),
      favorites: [
        { panelId: 'jira', tabId: 'j1', label: 'Sprint board' },
        { panelId: 'slack', tabId: 'c1', label: '#general' }
      ]
    }
    const out = validateSnapshot(snap, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(out!.schemaVersion).toBe(8) // still 8 — NO bump (additive-optional)
    expect(out!.favorites).toEqual([
      { panelId: 'jira', tabId: 'j1', label: 'Sprint board' },
      { panelId: 'slack', tabId: 'c1', label: '#general' }
    ])
  })

  it('DROPS malformed / secret-shaped / terminal / unknown-panel entries, keeping the good (FR-033)', () => {
    const snap = {
      ...goodSnapshot(),
      favorites: [
        { panelId: 'jira', tabId: 'j1', label: 'Kept', token: 'SECRET-shaped-extra' },
        { panelId: 'terminal', tabId: 't1', label: 'Terminal' }, // not pinnable
        { panelId: 'evil', tabId: 'x', label: 'x' }, // unknown panel
        { tabId: 'no-panel', label: 'x' }, // missing panelId
        'a string' // not an object
      ]
    }
    const out = validateSnapshot(snap)
    // Only the good entry survives, rebuilt to the {panelId,tabId,label} whitelist (no `token`).
    expect(out!.favorites).toEqual([{ panelId: 'jira', tabId: 'j1', label: 'Kept' }])
  })

  it('OMITS favorites entirely when the list is empty / all-dropped (so an old snapshot stays clean)', () => {
    const snap = { ...goodSnapshot(), favorites: [{ panelId: 'terminal', tabId: 't', label: 'x' }] }
    expect(validateSnapshot(snap)).not.toHaveProperty('favorites')
    expect(validateSnapshot(goodSnapshot())).not.toHaveProperty('favorites') // pre-feature
  })
})
