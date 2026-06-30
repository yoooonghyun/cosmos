/**
 * PURE Home-favorites derivations (cosmos-home-favorite-tabs-v1). Framework-free + node-testable
 * (no React/DOM import — only erased `import type`s), per the `.ts`/`.test.ts` split:
 *
 *  - {@link findLiveTab} reads the LIVE source tab (incl. its current `surface`) out of the
 *    cross-panel registry so a favorite can MIRROR it through the shared `ActiveTabSurface` host.
 *  - {@link reconcileFavorites} keeps a favorite's label honest as its source tab renames, and KEEPS
 *    a favorite whose source closed (graceful degrade — never auto-dropped, FR-031).
 *  - {@link toFavoriteStripTab} maps a favorite `CosmosTab` to a `PanelTabStrip` descriptor (leading
 *    source glyph + label + closeable `X`, FR-014).
 *  - {@link toHomeFavorites} projects the favorite tabs to the persisted non-secret reference list.
 *  - {@link validateFavorites} (re-exported from the shared boundary) — the SINGLE validator reused
 *    by both the main `validateSnapshot` boundary and this renderer code (FR-033).
 *
 * DEFENSIVE (the project boundary rule): a malformed registry / group is handled without throwing.
 */

import type { CosmosTab, CosmosTabsState, FavoritePanelId } from './cosmosTabs'
import { favoriteId } from './cosmosTabs'
import type { CrossPanelId, LivePanelTab, PanelTabsRegistry } from '../panelTabs/panelTabs'
import type { PanelTabGroup } from '../panelTabs/panelTabsTree'
import type { PanelTab } from '../tabs/PanelTabStrip'
import type { RailIcon } from '../app/surfaceIcons'
import { validateFavorites, type HomeFavorite } from '../../shared/ipc'

export { validateFavorites }
export type { HomeFavorite }

/**
 * Read the LIVE source tab (id + label + its CURRENT `surface`) for a favorite to mirror, or `null`
 * when the source panel/tab is not currently published (closed / disabled / absent on relaunch).
 * DEFENSIVE: a missing/malformed registry, panel entry, or tab returns `null`, never throws — the
 * caller renders the calm gone/waiting state from a `null`.
 */
export function findLiveTab(
  registry: PanelTabsRegistry | null | undefined,
  panelId: CrossPanelId,
  tabId: string
): LivePanelTab | null {
  if (!registry || typeof registry !== 'object') {
    return null
  }
  const entry = registry[panelId]
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.tabs)) {
    return null
  }
  const tab = entry.tabs.find((t) => t && typeof t === 'object' && t.id === tabId)
  return tab ?? null
}

/**
 * Keep each favorite's label honest against the LIVE groups (cosmos-home-favorite-tabs-v1, FR-041),
 * mirroring `reconcileSelectedContext`:
 *  - a favorite whose source tab is still open but RENAMED → relabel to the fresh source label.
 *  - a favorite whose source tab/panel is GONE → KEEP unchanged (no auto-drop — FR-031; the inline
 *    render shows the calm "no longer open" state).
 *  - nothing changed → the SAME state reference (so a caller's effect/setState is a no-op).
 *
 * Pure. Never throws.
 */
export function reconcileFavorites(
  state: CosmosTabsState,
  groups: PanelTabGroup[]
): CosmosTabsState {
  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.kind !== 'favorite' || !tab.source) {
      return tab
    }
    const group = groups.find((g) => g.panelId === tab.source!.panelId)
    if (!group) {
      return tab // source panel gone → keep last-known label (FR-031).
    }
    const live = group.tabs.find((t) => t.id === tab.source!.tabId)
    if (!live) {
      return tab // source tab closed → keep (FR-031).
    }
    if (live.label === tab.label) {
      return tab // unchanged.
    }
    changed = true
    return { ...tab, label: live.label } // renamed → relabel (FR-041).
  })
  return changed ? { ...state, tabs } : state
}

/**
 * Map a favorite `CosmosTab` to a `PanelTabStrip` descriptor (FR-014): a generative-kind strip tab
 * carrying the source panel's `glyph` as a leading icon, the source label, a close `X` (= unpin), and
 * an optional `contextMenu` wrapper (the strip's right-click Unpin). Pure: the caller passes the
 * already-resolved `SURFACE_ICON[source.panelId]` glyph so this module imports no React.
 */
export function toFavoriteStripTab(
  tab: CosmosTab,
  glyph: RailIcon,
  contextMenu?: (trigger: React.ReactNode) => React.ReactNode
): PanelTab {
  return {
    id: tab.id,
    label: tab.label,
    kind: 'generative',
    status: 'idle',
    closeable: true,
    icon: glyph,
    ...(contextMenu ? { contextMenu } : {})
  }
}

/**
 * Project the favorite tabs to the persisted, NON-SECRET reference list (FR-030): only
 * `{ panelId, tabId, label }` per favorite, in pinned order. Never carries an A2UI surface (the
 * surface is re-acquired live on restore). A favorite tab missing a source is skipped defensively.
 */
export function toHomeFavorites(state: CosmosTabsState): HomeFavorite[] {
  const out: HomeFavorite[] = []
  for (const tab of state.tabs) {
    if (tab.kind === 'favorite' && tab.source) {
      out.push({ panelId: tab.source.panelId, tabId: tab.source.tabId, label: tab.label })
    }
  }
  return out
}

/**
 * Seed favorite `CosmosTab`s from the restored persisted list (FR-030), in pinned order. Pure mirror
 * of {@link toHomeFavorites}: each `{ panelId, tabId, label }` becomes a favorite tab keyed by
 * {@link favoriteId}. The label is the persisted (last-known) source label; `reconcileFavorites`
 * refreshes it once the source re-publishes on relaunch.
 */
export function favoritesToTabs(favorites: readonly HomeFavorite[]): CosmosTab[] {
  return favorites.map((f) => {
    const source = { panelId: f.panelId as FavoritePanelId, tabId: f.tabId }
    return { id: favoriteId(source), label: f.label, kind: 'favorite' as const, source }
  })
}
