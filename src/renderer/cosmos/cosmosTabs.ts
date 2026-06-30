/**
 * PURE Cosmos panel tab state (cosmos-conversation-panel-v2, step 3). Spec:
 * FR-114/FR-115/FR-116.
 *
 * The Cosmos panel is a conversation timeline, NOT the surface-per-tab model of
 * `useGenerativePanelTabs` (which the other four generative panels keep). It has exactly
 * ONE pinned, UNDELETABLE default tab hosting the default-session conversation. The state
 * is modelled with a `kind` discriminator so future "favorited" tabs are appended
 * ADDITIVELY (closeable, beside the pinned default) with no rewrite — building favorites is
 * OUT OF SCOPE for step 3 (only the accommodating shape is required).
 *
 * NO React/DOM import — pure functions + the immutable default, unit-tested in node.
 *
 * cosmos-home-favorite-tabs-v1 wires the forward-compat `favorite` seam: a favorite tab is a LIVE
 * shortcut to another generative panel's open tab. It records its `source` ({panelId, tabId}); the
 * panel renders its source's live A2UI surface inline through the shared `ActiveTabSurface` host.
 */

import type { GateableIntegration } from '../../shared/ipc'

/**
 * The generative panels whose tabs can be pinned as Home favorites — terminal is NOT pinnable
 * (a PTY tab has no A2UI surface, FR-040), so a favorite's `source.panelId` is always one of the
 * four gateable integrations. Equals the cross-panel ids minus `terminal`.
 */
export type FavoritePanelId = GateableIntegration

/** A Cosmos tab. `default` is the pinned, undeletable conversation tab; `favorite` is a pinned shortcut. */
export interface CosmosTab {
  /** Stable tab id. The default tab's id is the fixed {@link DEFAULT_TAB_ID}; a favorite's is {@link favoriteId}. */
  id: string
  /** Display label. For a favorite this is the source tab's (relabel-on-rename) label. */
  label: string
  /**
   * The tab's role: `'default'` = the pinned, undeletable default-session conversation
   * (exactly one); `'favorite'` = a closeable pinned shortcut to a source panel+tab.
   */
  kind: 'default' | 'favorite'
  /**
   * Favorite-only (cosmos-home-favorite-tabs-v1): the source panel+tab this favorite mirrors.
   * Absent on the default tab. Non-secret ids only (the panel id + the stable generative tab id).
   */
  source?: { panelId: FavoritePanelId; tabId: string }
}

/** The stable, idempotent favorite tab id for a source panel+tab (de-dupes a repeat pin). */
export function favoriteId(source: { panelId: FavoritePanelId; tabId: string }): string {
  return `fav:${source.panelId}:${source.tabId}`
}

/** True when a favorite for this source panel+tab is already pinned (drives the Pin vs Unpin menu). */
export function isPinned(
  state: CosmosTabsState,
  source: { panelId: FavoritePanelId; tabId: string }
): boolean {
  const id = favoriteId(source)
  return state.tabs.some((t) => t.kind === 'favorite' && t.id === id)
}

/** The fixed id of the pinned default conversation tab (one per panel — FR-114). */
export const DEFAULT_TAB_ID = 'cosmos-default'

/** The pinned default conversation tab (FR-114). Immutable; always present + first. */
export const DEFAULT_TAB: CosmosTab = {
  id: DEFAULT_TAB_ID,
  label: 'Cosmos',
  kind: 'default'
}

/**
 * The Cosmos tab collection. ALWAYS contains the pinned default tab first (FR-114), with
 * any favorited tabs appended after it (FR-115). Step 3 only ever holds the default tab.
 */
export interface CosmosTabsState {
  tabs: CosmosTab[]
  activeTabId: string
}

/** The initial state: just the pinned default tab, active (FR-114). */
export function initialCosmosTabs(): CosmosTabsState {
  return { tabs: [DEFAULT_TAB], activeTabId: DEFAULT_TAB_ID }
}

/** A tab is closeable ONLY when it is a favorite — the default tab is never closeable (FR-114). */
export function isCloseable(tab: CosmosTab): boolean {
  return tab.kind === 'favorite'
}

/**
 * Close a tab BY ID (FR-114). Closing the pinned default tab (or an unknown id) is a NO-OP
 * — the state is returned UNCHANGED. A closed favorite that was active hands focus back to
 * the default tab. Building favorites is out of scope, but this op is the additive seam.
 */
export function closeCosmosTab(state: CosmosTabsState, tabId: string): CosmosTabsState {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab || !isCloseable(tab)) {
    return state // FR-114: the default (or an unknown id) cannot be closed.
  }
  const tabs = state.tabs.filter((t) => t.id !== tabId)
  const activeTabId = state.activeTabId === tabId ? DEFAULT_TAB_ID : state.activeTabId
  return { tabs, activeTabId }
}

/**
 * Append a favorited tab and activate it (cosmos-home-favorite-tabs-v1, FR-010/FR-013). A closeable
 * `favorite` tab keyed by {@link favoriteId} is appended AFTER the pinned default, which stays first.
 * IDEMPOTENT / de-duped by source: if a favorite for this source is already pinned, the state is
 * returned UNCHANGED (same reference — no duplicate, no-op render).
 */
export function appendFavorite(
  state: CosmosTabsState,
  favorite: { source: { panelId: FavoritePanelId; tabId: string }; label: string }
): CosmosTabsState {
  const id = favoriteId(favorite.source)
  if (state.tabs.some((t) => t.id === id)) {
    return state // FR-013: already pinned — idempotent no-op.
  }
  const tab: CosmosTab = { id, label: favorite.label, kind: 'favorite', source: favorite.source }
  return { tabs: [...state.tabs, tab], activeTabId: id }
}

/** Set the active tab (only to a tab that exists). */
export function setActiveCosmosTab(state: CosmosTabsState, tabId: string): CosmosTabsState {
  if (!state.tabs.some((t) => t.id === tabId)) {
    return state
  }
  return { ...state, activeTabId: tabId }
}
