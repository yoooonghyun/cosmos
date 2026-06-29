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
 */

/** A Cosmos tab. `default` is the pinned, undeletable conversation tab; `favorite` is forward-compat. */
export interface CosmosTab {
  /** Stable tab id. The default tab's id is the fixed {@link DEFAULT_TAB_ID}. */
  id: string
  /** Display label. */
  label: string
  /**
   * The tab's role: `'default'` = the pinned, undeletable default-session conversation
   * (exactly one); `'favorite'` = a future appended, closeable tab (none built in step 3).
   */
  kind: 'default' | 'favorite'
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
 * Append a favorited tab (FR-115). The forward-compat additive op: a closeable `favorite`
 * tab is appended AFTER the pinned default, which stays first. Not wired into the UI in
 * step 3 (no favorites built) — present so favorites are a pure additive change later.
 */
export function appendFavorite(
  state: CosmosTabsState,
  favorite: { id: string; label: string }
): CosmosTabsState {
  const tab: CosmosTab = { id: favorite.id, label: favorite.label, kind: 'favorite' }
  return { tabs: [...state.tabs, tab], activeTabId: favorite.id }
}

/** Set the active tab (only to a tab that exists). */
export function setActiveCosmosTab(state: CosmosTabsState, tabId: string): CosmosTabsState {
  if (!state.tabs.some((t) => t.id === tabId)) {
    return state
  }
  return { ...state, activeTabId: tabId }
}
