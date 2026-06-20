import { describe, it, expect } from 'vitest'
import type { GenerativeTab } from './useGenerativePanelTabs'
import {
  buildGenerativePanel,
  buildGenerativeTab,
  buildTerminalDraft,
  capScrollback,
  hydrateGenerativeTabs,
  hydrateTerminalTabs,
  type LiveTabsState,
  type LiveTerminalTab
} from './sessionSnapshot'

function genTab(over: Partial<GenerativeTab>): GenerativeTab {
  return { id: 'x', label: 'X', untitled: false, surface: null, inFlight: false, ...over }
}

describe('buildGenerativeTab — strip transient + non-composed (FR-012/FR-014/FR-015)', () => {
  it('persists a composed surface verbatim', () => {
    const out = buildGenerativeTab(
      genTab({
        id: 'g1',
        label: 'Form',
        composed: true,
        surface: { requestId: 'r1', spec: { surfaceId: 's', components: [] } }
      })
    )
    expect(out).toEqual({
      id: 'g1',
      label: 'Form',
      untitled: false,
      composed: true,
      surface: { spec: { surfaceId: 's', components: [] } }
    })
  })

  it('drops transient inFlight/error/loadingDefault from the persisted shape (FR-014)', () => {
    const out = buildGenerativeTab(
      genTab({
        id: 'g',
        inFlight: true,
        error: 'boom',
        loadingDefault: true,
        composed: true,
        surface: { requestId: 'r', spec: { surfaceId: 's', components: [] } }
      })
    )
    expect(out).not.toHaveProperty('inFlight')
    expect(out).not.toHaveProperty('error')
    expect(out).not.toHaveProperty('loadingDefault')
    // requestId is NOT persisted (re-minted on restore — FR-013): the surface holds
    // only `spec`, never the live correlation id.
    expect(out.surface).toEqual({ spec: { surfaceId: 's', components: [] } })
    expect(out.surface).not.toHaveProperty('requestId')
  })

  it('does NOT persist a non-composed (live-data) surface → base tab (FR-015)', () => {
    const out = buildGenerativeTab(
      genTab({
        id: 'live',
        composed: false,
        surface: { requestId: 'r', spec: { surfaceId: 's', components: [] } }
      })
    )
    expect(out.surface).toBeUndefined()
    expect(out.composed).toBeUndefined()
  })

  it('does NOT persist an errored composed surface', () => {
    const out = buildGenerativeTab(
      genTab({
        id: 'e',
        composed: true,
        surface: { requestId: 'r', spec: { surfaceId: 's', components: [] }, error: 'bad' }
      })
    )
    expect(out.surface).toBeUndefined()
  })
})

describe('buildGenerativePanel (FR-008/FR-011)', () => {
  it('keeps a zero-tab panel zero-tab and passes everOpened through', () => {
    const state: LiveTabsState<GenerativeTab> = { tabs: [], activeTabId: null }
    expect(buildGenerativePanel(state, 4)).toEqual({ tabs: [], activeTabId: null, everOpened: 4 })
  })
})

describe('buildTerminalDraft (FR-008/FR-021)', () => {
  it('emits renderer-known fields + scrollback, omitting sessionId/cwd (main enriches)', () => {
    const state: LiveTabsState<LiveTerminalTab> = {
      tabs: [
        { id: 'p1', label: 'Terminal' },
        { id: 'p2', label: 'Renamed', renamed: true }
      ],
      activeTabId: 'p2'
    }
    const draft = buildTerminalDraft(state, 2, { p1: 'scroll-1' })
    expect(draft.tabs[0]).toEqual({ id: 'p1', label: 'Terminal', scrollback: 'scroll-1' })
    expect(draft.tabs[1]).toEqual({ id: 'p2', label: 'Renamed', renamed: true })
    expect(draft.activeTabId).toBe('p2')
    expect(draft.everOpened).toBe(2)
    // no sessionId/cwd in the draft — those are main's to add.
    expect(JSON.stringify(draft)).not.toContain('sessionId')
  })

  it('carries openFiles for a pane with ≥1 open file (persist-workdir-open-files-v1, FR-003)', () => {
    const state: LiveTabsState<LiveTerminalTab> = {
      tabs: [{ id: 'p1', label: 'Terminal' }],
      activeTabId: 'p1'
    }
    const draft = buildTerminalDraft(state, 1, {}, { p1: { files: ['a.ts', 'b.ts'], activeRelPath: 'b.ts' } })
    expect(draft.tabs[0].openFiles).toEqual({ files: ['a.ts', 'b.ts'], activeRelPath: 'b.ts' })
  })

  it('omits openFiles for a pane with an EMPTY collection (no field → empty-strip restore default)', () => {
    const state: LiveTabsState<LiveTerminalTab> = {
      tabs: [{ id: 'p1', label: 'Terminal' }],
      activeTabId: 'p1'
    }
    const draft = buildTerminalDraft(state, 1, {}, { p1: { files: [], activeRelPath: null } })
    expect(draft.tabs[0]).not.toHaveProperty('openFiles')
  })

  it('omits openFiles when no open-files map is supplied at all (backward-compatible call)', () => {
    const state: LiveTabsState<LiveTerminalTab> = {
      tabs: [{ id: 'p1', label: 'Terminal' }],
      activeTabId: 'p1'
    }
    const draft = buildTerminalDraft(state, 1, {})
    expect(draft.tabs[0]).not.toHaveProperty('openFiles')
  })
})

describe('hydrateGenerativeTabs (FR-008/FR-009/FR-013)', () => {
  it('re-instates a composed surface with a FRESH requestId (FR-013)', () => {
    let n = 0
    const out = hydrateGenerativeTabs(
      {
        tabs: [
          {
            id: 'g1',
            label: 'Form',
            untitled: false,
            composed: true,
            surface: { spec: { surfaceId: 's', components: [] } }
          }
        ],
        activeTabId: 'g1',
        everOpened: 1
      },
      () => `fresh-${++n}`
    )
    expect(out.tabs[0].surface).toEqual({
      requestId: 'fresh-1',
      spec: { surfaceId: 's', components: [] }
    })
    expect(out.tabs[0].inFlight).toBe(false)
    expect(out.activeTabId).toBe('g1')
  })

  it('hydrates a base (surfaceless) tab to surface:null and preserves rename (FR-009)', () => {
    const out = hydrateGenerativeTabs(
      {
        tabs: [{ id: 'b', label: 'Custom', untitled: false, renamed: true }],
        activeTabId: 'b',
        everOpened: 1
      },
      () => 'r'
    )
    expect(out.tabs[0].surface).toBeNull()
    expect(out.tabs[0].renamed).toBe(true)
  })

  it('returns an empty state for a missing/empty panel (safe fallback)', () => {
    expect(hydrateGenerativeTabs(undefined, () => 'r')).toEqual({ tabs: [], activeTabId: null })
  })
})

describe('hydrateTerminalTabs (FR-008/FR-011)', () => {
  it('returns empty for a zero-tab/absent terminal panel (caller seeds default)', () => {
    expect(hydrateTerminalTabs(undefined)).toEqual({ tabs: [], activeTabId: null })
    expect(hydrateTerminalTabs({ tabs: [], activeTabId: null, everOpened: 0 })).toEqual({
      tabs: [],
      activeTabId: null
    })
  })

  it('maps id/label/renamed and prunes a dangling active id', () => {
    const out = hydrateTerminalTabs({
      tabs: [
        { id: 'p1', label: 'Terminal', sessionId: 's1', cwd: '/w' },
        { id: 'p2', label: 'Mine', renamed: true, sessionId: 's2', cwd: '/w' }
      ],
      activeTabId: 'gone',
      everOpened: 2
    })
    expect(out.tabs).toEqual([
      { id: 'p1', label: 'Terminal' },
      { id: 'p2', label: 'Mine', renamed: true }
    ])
    expect(out.activeTabId).toBe('p1') // dangling active id falls back to first
  })

  it('surfaces a restored openFiles slice per tab; omits it when absent/empty (persist-workdir-open-files-v1, FR-004)', () => {
    const out = hydrateTerminalTabs({
      tabs: [
        {
          id: 'p1',
          label: 'T',
          sessionId: 's1',
          cwd: '/w',
          openFiles: { files: ['a.ts', 'b.ts'], activeRelPath: 'b.ts' }
        },
        { id: 'p2', label: 'T2', sessionId: 's2', cwd: '/w' },
        { id: 'p3', label: 'T3', sessionId: 's3', cwd: '/w', openFiles: { files: [], activeRelPath: null } }
      ],
      activeTabId: 'p1',
      everOpened: 3
    })
    expect(out.tabs[0].openFiles).toEqual({ files: ['a.ts', 'b.ts'], activeRelPath: 'b.ts' })
    expect(out.tabs[1]).not.toHaveProperty('openFiles')
    expect(out.tabs[2]).not.toHaveProperty('openFiles')
  })
})

describe('capScrollback (D5 — ~256KB most-recent)', () => {
  it('returns short input unchanged', () => {
    expect(capScrollback('hi', 1024)).toBe('hi')
  })

  it('keeps only the most-recent maxBytes', () => {
    const s = 'a'.repeat(1000)
    const out = capScrollback(s, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out).toBe('a'.repeat(100))
  })

  it('degrades a non-string to empty (safe fallback)', () => {
    expect(capScrollback(undefined as never)).toBe('')
  })
})
