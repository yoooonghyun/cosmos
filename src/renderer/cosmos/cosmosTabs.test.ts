import { describe, it, expect } from 'vitest'
import {
  initialCosmosTabs,
  isCloseable,
  closeCosmosTab,
  appendFavorite,
  setActiveCosmosTab,
  favoriteId,
  isPinned,
  DEFAULT_TAB_ID
} from './cosmosTabs'
import { cycleActiveId } from '../tabs/panelTabs'

const JIRA_SOURCE = { panelId: 'jira' as const, tabId: 'j1' }
const SLACK_SOURCE = { panelId: 'slack' as const, tabId: 'c1' }

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

  it('appends a favorite that is closeable, leaving the default pinned/first (FR-115/FR-010)', () => {
    const state = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'Saved view' })
    const id = favoriteId(JIRA_SOURCE)
    expect(state.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID, id])
    expect(state.tabs[0].kind).toBe('default')
    expect(state.tabs[1].kind).toBe('favorite')
    expect(state.tabs[1].source).toEqual(JIRA_SOURCE)
    expect(isCloseable(state.tabs[1])).toBe(true)
  })

  it('pinning is NON-DISRUPTIVE: appendFavorite does NOT activate the new favorite (FR-010)', () => {
    // Regression for the navigate-on-pin bug: pinning appends the favorite but the active tab is
    // UNCHANGED (the user stays on whatever tab they were on — here the default).
    const state = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'Saved view' })
    const id = favoriteId(JIRA_SOURCE)
    expect(state.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID, id]) // favorite IS appended
    expect(state.activeTabId).toBe(DEFAULT_TAB_ID) // active stays the default — NOT the favorite
    expect(state.activeTabId).not.toBe(id)
  })

  it('pinning preserves a non-default active tab too (stays where the user is)', () => {
    // Pin one favorite + make it active, then pin a SECOND — the active stays on the first favorite.
    const first = favoriteId(JIRA_SOURCE)
    const withFirst = setActiveCosmosTab(
      appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'A' }),
      first
    )
    const withSecond = appendFavorite(withFirst, { source: SLACK_SOURCE, label: 'B' })
    expect(withSecond.tabs.map((t) => t.id)).toEqual([
      DEFAULT_TAB_ID,
      first,
      favoriteId(SLACK_SOURCE)
    ])
    expect(withSecond.activeTabId).toBe(first) // unchanged — pinning B did not navigate away
  })

  it('favoriteId is deterministic + idempotent per source (FR-013)', () => {
    expect(favoriteId(JIRA_SOURCE)).toBe('fav:jira:j1')
    expect(favoriteId({ panelId: 'slack', tabId: 'c9' })).toBe('fav:slack:c9')
  })

  it('re-pinning the SAME source is an idempotent no-op (same reference, no duplicate) (FR-013)', () => {
    const once = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'A' })
    const twice = appendFavorite(once, { source: JIRA_SOURCE, label: 'A again' })
    expect(twice).toBe(once) // unchanged reference
    expect(twice.tabs.filter((t) => t.kind === 'favorite')).toHaveLength(1)
  })

  it('isPinned reflects whether a source is pinned (FR-002)', () => {
    const state = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'A' })
    expect(isPinned(state, JIRA_SOURCE)).toBe(true)
    expect(isPinned(state, { panelId: 'slack', tabId: 'c1' })).toBe(false)
    expect(isPinned(initialCosmosTabs(), JIRA_SOURCE)).toBe(false)
  })

  it('closing/unpinning an active favorite hands focus back to the default (FR-114/FR-012)', () => {
    const withFav = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'F' })
    const after = closeCosmosTab(withFav, favoriteId(JIRA_SOURCE))
    expect(after.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID])
    expect(after.activeTabId).toBe(DEFAULT_TAB_ID)
  })

  it('setActive only honors existing tabs', () => {
    const state = initialCosmosTabs()
    expect(setActiveCosmosTab(state, 'ghost')).toBe(state)
    expect(setActiveCosmosTab(state, DEFAULT_TAB_ID).activeTabId).toBe(DEFAULT_TAB_ID)
  })
})

// cosmos-home-keyboard-tab-nav-v1: Home cycles its tabs through the SHARED `cycleActiveId` wrap math
// (the same the `useTabShortcuts` hook applies), over `cosmosTabs` order [default, fav…]. These pin
// the navigation contract the keyboard shortcut relies on, with NO parallel helper.
describe('cosmosTabs keyboard navigation (cosmos-home-keyboard-tab-nav-v1)', () => {
  /** Build [default, favJira, favSlack] in pin order. */
  function twoFavorites() {
    const a = appendFavorite(initialCosmosTabs(), { source: JIRA_SOURCE, label: 'Sprint board' })
    return appendFavorite(a, { source: SLACK_SOURCE, label: 'General' })
  }

  it('single tab (default only) → tab:next/prev is a no-op (FR-009)', () => {
    const { tabs } = initialCosmosTabs()
    expect(cycleActiveId(tabs, DEFAULT_TAB_ID, 1)).toBe(DEFAULT_TAB_ID)
    expect(cycleActiveId(tabs, DEFAULT_TAB_ID, -1)).toBe(DEFAULT_TAB_ID)
  })

  it('tab:next cycles default → favJira → favSlack → wrap to default (FR-001/FR-002/FR-003)', () => {
    const { tabs } = twoFavorites()
    const favJira = favoriteId(JIRA_SOURCE)
    const favSlack = favoriteId(SLACK_SOURCE)
    expect(tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID, favJira, favSlack])
    expect(cycleActiveId(tabs, DEFAULT_TAB_ID, 1)).toBe(favJira)
    expect(cycleActiveId(tabs, favJira, 1)).toBe(favSlack)
    expect(cycleActiveId(tabs, favSlack, 1)).toBe(DEFAULT_TAB_ID) // wrap
  })

  it('tab:prev from the default wraps to the last favorite (FR-003)', () => {
    const { tabs } = twoFavorites()
    expect(cycleActiveId(tabs, DEFAULT_TAB_ID, -1)).toBe(favoriteId(SLACK_SOURCE))
  })

  it('unpinning the ACTIVE favorite reconciles to the default, then cycles the REMAINING tabs (FR-010)', () => {
    // Pinning no longer auto-activates (non-disruptive), so explicitly make favSlack the active tab
    // to exercise the "unpin the ACTIVE favorite" path.
    const state = setActiveCosmosTab(twoFavorites(), favoriteId(SLACK_SOURCE))
    expect(state.activeTabId).toBe(favoriteId(SLACK_SOURCE))
    const after = closeCosmosTab(state, favoriteId(SLACK_SOURCE))
    expect(after.activeTabId).toBe(DEFAULT_TAB_ID) // handed back to default
    // The remaining order is [default, favJira]; cycling from the reconciled active has no stale index.
    expect(after.tabs.map((t) => t.id)).toEqual([DEFAULT_TAB_ID, favoriteId(JIRA_SOURCE)])
    expect(cycleActiveId(after.tabs, after.activeTabId, 1)).toBe(favoriteId(JIRA_SOURCE))
    expect(cycleActiveId(after.tabs, favoriteId(JIRA_SOURCE), 1)).toBe(DEFAULT_TAB_ID) // wrap over 2
  })
})
