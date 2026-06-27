import { describe, it, expect } from 'vitest'
import {
  initialCosmosTabs,
  isCloseable,
  closeCosmosTab,
  appendFavorite,
  setActiveCosmosTab,
  DEFAULT_TAB_ID
} from './cosmosTabs'

describe('cosmosTabs', () => {
  it('starts with a single pinned default tab, active (FR-114)', () => {
    const state = initialCosmosTabs()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].id).toBe(DEFAULT_TAB_ID)
    expect(state.tabs[0].kind).toBe('default')
    expect(state.activeTabId).toBe(DEFAULT_TAB_ID)
  })

  it('the default tab is NOT closeable (FR-114)', () => {
    const state = initialCosmosTabs()
    expect(isCloseable(state.tabs[0])).toBe(false)
  })

  it('closing the default tab is a no-op (FR-114)', () => {
    const state = initialCosmosTabs()
    const after = closeCosmosTab(state, DEFAULT_TAB_ID)
    expect(after).toBe(state) // unchanged reference
    expect(after.tabs).toHaveLength(1)
  })

  it('closing an unknown id is a no-op', () => {
    const state = initialCosmosTabs()
    expect(closeCosmosTab(state, 'nope')).toBe(state)
  })

  it('appends a favorite that is closeable, leaving the default pinned/first (FR-115)', () => {
    const state = appendFavorite(initialCosmosTabs(), { id: 'fav-1', label: 'Saved view' })
    expect(state.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID, 'fav-1'])
    expect(state.tabs[0].kind).toBe('default')
    expect(isCloseable(state.tabs[1])).toBe(true)
    expect(state.activeTabId).toBe('fav-1')
  })

  it('closing an active favorite hands focus back to the default (FR-114/FR-115)', () => {
    const withFav = appendFavorite(initialCosmosTabs(), { id: 'fav-1', label: 'F' })
    const after = closeCosmosTab(withFav, 'fav-1')
    expect(after.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID])
    expect(after.activeTabId).toBe(DEFAULT_TAB_ID)
  })

  it('setActive only honors existing tabs', () => {
    const state = initialCosmosTabs()
    expect(setActiveCosmosTab(state, 'ghost')).toBe(state)
    expect(setActiveCosmosTab(state, DEFAULT_TAB_ID).activeTabId).toBe(DEFAULT_TAB_ID)
  })
})
