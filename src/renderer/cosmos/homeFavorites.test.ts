/**
 * node-unit (HOME-FAVORITES-01) for the PURE Home-favorites derivations
 * (cosmos-home-favorite-tabs-v1). Framework-free — `findLiveTab` reads the live source tab (used by
 * the favorite for GONE-vs-live detection by tab EXISTENCE, the published list being label-only since
 * cosmos-favorite-live-panel-portal-v1), `reconcileFavorites` relabels-on-rename / keeps-on-close,
 * `validateFavorites` drops malformed + secret-shaped entries, and the persistence projections
 * round-trip.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  findLiveTab,
  reconcileFavorites,
  validateFavorites,
  toHomeFavorites,
  favoritesToTabs
} from './homeFavorites'
import { appendFavorite, initialCosmosTabs, favoriteId } from './cosmosTabs'
import type { PanelTabsRegistry } from '../panelTabs/panelTabs'
import type { PanelTabGroup } from '../panelTabs/panelTabsTree'

const registry: PanelTabsRegistry = {
  jira: {
    tabs: [
      { id: 'j1', label: 'Sprint board' },
      { id: 'j2', label: 'PROJ-9' }
    ],
    activeTabId: 'j1'
  },
  slack: { tabs: [{ id: 'c1', label: '#general' }], activeTabId: 'c1' }
}

describe('findLiveTab (HOME-FAVORITES-01)', () => {
  it('returns the live tab (label-only) for the GONE-vs-live existence check', () => {
    const tab = findLiveTab(registry, 'jira', 'j1')
    expect(tab?.label).toBe('Sprint board')
    expect(tab?.id).toBe('j1')
  })

  it('returns a sibling live tab by id', () => {
    const tab = findLiveTab(registry, 'jira', 'j2')
    expect(tab?.label).toBe('PROJ-9')
  })

  it('returns null for a missing panel or missing tab (gone source)', () => {
    expect(findLiveTab(registry, 'confluence', 'p1')).toBeNull()
    expect(findLiveTab(registry, 'jira', 'ghost')).toBeNull()
  })

  it('returns null (never throws) for a missing/malformed registry', () => {
    expect(findLiveTab(null, 'jira', 'j1')).toBeNull()
    expect(findLiveTab(undefined, 'jira', 'j1')).toBeNull()
    expect(findLiveTab({ jira: { tabs: 'nope' } } as never, 'jira', 'j1')).toBeNull()
    expect(findLiveTab({ jira: null }, 'jira', 'j1')).toBeNull()
  })
})

describe('reconcileFavorites (HOME-FAVORITES-01)', () => {
  const groups: PanelTabGroup[] = [
    { panelId: 'jira', label: 'Jira', tabs: [{ id: 'j1', label: 'Sprint board' }], activeTabId: 'j1' }
  ]

  it('relabels a favorite when its source tab was RENAMED (FR-041)', () => {
    const pinned = appendFavorite(initialCosmosTabs(), {
      source: { panelId: 'jira', tabId: 'j1' },
      label: 'Old label'
    })
    const out = reconcileFavorites(pinned, groups)
    const fav = out.tabs.find((t) => t.kind === 'favorite')
    expect(fav?.label).toBe('Sprint board')
  })

  it('KEEPS a favorite whose source tab/panel is GONE — never auto-dropped (FR-031)', () => {
    const pinned = appendFavorite(initialCosmosTabs(), {
      source: { panelId: 'slack', tabId: 'gone' },
      label: '#archived'
    })
    const out = reconcileFavorites(pinned, groups) // slack absent from groups
    const fav = out.tabs.find((t) => t.kind === 'favorite')
    expect(fav).toBeDefined()
    expect(fav?.label).toBe('#archived') // unchanged
  })

  it('returns the SAME reference when nothing changed (no-op render)', () => {
    const pinned = appendFavorite(initialCosmosTabs(), {
      source: { panelId: 'jira', tabId: 'j1' },
      label: 'Sprint board'
    })
    expect(reconcileFavorites(pinned, groups)).toBe(pinned)
    // No favorites at all → also same reference.
    const base = initialCosmosTabs()
    expect(reconcileFavorites(base, groups)).toBe(base)
  })
})

describe('validateFavorites (HOME-FAVORITES-01, FR-033)', () => {
  it('keeps well-formed entries, returning ONLY the whitelisted fields', () => {
    const warn = vi.fn()
    const out = validateFavorites(
      [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board', token: 'SECRET' }],
      warn
    )
    expect(out).toEqual([{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }])
    // The extra secret-shaped key is dropped (whitelist rebuild).
    expect(Object.keys(out[0]).sort()).toEqual(['label', 'panelId', 'tabId'])
  })

  it('drops malformed + invalid-panel + non-string entries with a warn (terminal is now KEPT)', () => {
    const warn = vi.fn()
    const out = validateFavorites(
      [
        { panelId: 'nope', tabId: 'x', label: 'x' }, // unknown panel
        { panelId: 'jira', tabId: '', label: 'empty id' }, // empty tabId
        { panelId: 'slack', tabId: 'c1', label: '' }, // empty label
        'a string', // not an object
        { panelId: 'jira', tabId: 'ok', label: 'Kept' } // good
      ],
      warn
    )
    expect(out).toEqual([{ panelId: 'jira', tabId: 'ok', label: 'Kept' }])
    expect(warn).toHaveBeenCalled()
  })

  it('KEEPS a terminal favorite (cosmos-terminal-favorite-multiplex-v1 relaxed FR-040)', () => {
    const warn = vi.fn()
    const out = validateFavorites(
      [{ panelId: 'terminal', tabId: 'pane-1', label: 'Terminal 2', cwd: '/secret/path' }],
      warn
    )
    // Kept, rebuilt to the {panelId,tabId,label} whitelist (the secret-shaped `cwd` dropped).
    expect(out).toEqual([{ panelId: 'terminal', tabId: 'pane-1', label: 'Terminal 2' }])
    expect(Object.keys(out[0]).sort()).toEqual(['label', 'panelId', 'tabId'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('de-dupes a repeated (panelId, tabId) keeping the first', () => {
    const out = validateFavorites([
      { panelId: 'jira', tabId: 'j1', label: 'First' },
      { panelId: 'jira', tabId: 'j1', label: 'Second' }
    ])
    expect(out).toEqual([{ panelId: 'jira', tabId: 'j1', label: 'First' }])
  })

  it('treats undefined/non-array as empty (safe fallback, never throws)', () => {
    expect(validateFavorites(undefined)).toEqual([])
    expect(validateFavorites('bottom' as never)).toEqual([])
    expect(validateFavorites(null as never)).toEqual([])
  })
})

describe('favorites persistence projections round-trip', () => {
  it('toHomeFavorites → favoritesToTabs preserves source ids + label in order', () => {
    let state = appendFavorite(initialCosmosTabs(), {
      source: { panelId: 'jira', tabId: 'j1' },
      label: 'Sprint board'
    })
    state = appendFavorite(state, { source: { panelId: 'slack', tabId: 'c1' }, label: '#general' })
    const persisted = toHomeFavorites(state)
    expect(persisted).toEqual([
      { panelId: 'jira', tabId: 'j1', label: 'Sprint board' },
      { panelId: 'slack', tabId: 'c1', label: '#general' }
    ])
    const tabs = favoritesToTabs(persisted)
    expect(tabs.map((t) => t.id)).toEqual([
      favoriteId({ panelId: 'jira', tabId: 'j1' }),
      favoriteId({ panelId: 'slack', tabId: 'c1' })
    ])
    expect(tabs.every((t) => t.kind === 'favorite')).toBe(true)
  })
})
