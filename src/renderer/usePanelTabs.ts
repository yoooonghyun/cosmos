/**
 * usePanelTabs — the React hook that wraps the pure `panelTabs.ts` logic into a
 * per-panel tab-state model (panel-tabs v1, Track B / Phase 3).
 *
 * Each rail panel calls this once to own its OWN independent ordered set of tabs
 * (FR-001), the active tab id (FR-002/FR-003), and the mutating operations
 * (open/close/setActive/update). All list logic lives in `panelTabs.ts` and is
 * unit-tested there; this hook only adapts it to `useState` + stable callbacks so
 * the components stay thin and no tab logic is inlined in a `.tsx`.
 *
 * The hook is generic over the tab record `T` (which must carry a stable `id`):
 *   - generative panels use `{ id, label, surface, inFlight, error? }`
 *   - the Terminal panel uses `{ id (=paneId), label, exitState }`
 *
 * Spec trace: FR-001 (independent set), FR-003 (setActive), FR-005 (open active),
 * FR-006/FR-007 (close adjacent-activation), FR-013/FR-014/FR-015/FR-027 (update).
 */

import { useCallback, useMemo, useState } from 'react'
import {
  closeTab as closeTabPure,
  openTab as openTabPure,
  setActiveTab as setActiveTabPure,
  updateTab as updateTabPure,
  type TabLike,
  type TabsState
} from './panelTabs'

/** The value returned by `usePanelTabs` — read state + the four operations. */
export interface PanelTabsController<T extends TabLike> {
  /** The open tabs, in their open order (FR-002). */
  tabs: T[]
  /** The active tab id, or null when the panel has zero tabs (FR-016/017/018). */
  activeTabId: string | null
  /** The active tab record, or null when there are zero tabs (convenience). */
  activeTab: T | null
  /** Append a tab and make it active (FR-005). */
  open: (tab: T) => void
  /** Close a tab, re-picking the active tab by adjacency (FR-006/FR-007). */
  close: (tabId: string) => void
  /** Make an existing tab active (FR-003). */
  setActive: (tabId: string) => void
  /** Patch one tab's record — file a surface / set in-flight / set error (FR-013/14/15). */
  update: (tabId: string, patch: Partial<T>) => void
}

/**
 * Per-panel tab-state hook. `initial` seeds the collection (empty by default — a
 * generative panel starts at its native base / idle placeholder; the Terminal
 * panel seeds one default terminal, FR-024).
 */
export function usePanelTabs<T extends TabLike>(
  initial: TabsState<T> = { tabs: [], activeTabId: null }
): PanelTabsController<T> {
  const [state, setState] = useState<TabsState<T>>(initial)

  const open = useCallback((tab: T) => {
    setState((s) => openTabPure(s, tab))
  }, [])

  const close = useCallback((tabId: string) => {
    setState((s) => closeTabPure(s, tabId))
  }, [])

  const setActive = useCallback((tabId: string) => {
    setState((s) => setActiveTabPure(s, tabId))
  }, [])

  const update = useCallback((tabId: string, patch: Partial<T>) => {
    setState((s) => updateTabPure(s, tabId, patch))
  }, [])

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) ?? null,
    [state.tabs, state.activeTabId]
  )

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    open,
    close,
    setActive,
    update
  }
}
