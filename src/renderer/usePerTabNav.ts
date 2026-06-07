/**
 * usePerTabNav — the React hook that wraps the pure `perTabNav.ts` logic so the
 * native-base browser nav of a generative panel is held PER-TAB, keyed by tab id
 * (bug panel-shared-tab-nav-state-v1).
 *
 * The panel passes the active tab id and a per-panel `fallback` (the default nav for
 * an unset tab). The hook exposes the active tab's nav (`nav`), a setter scoped to the
 * active tab (`setNav`), an explicit per-tab drop (`drop`, on tab close), and a
 * panel-wide reset (`clearAll`, on a connection transition). All map logic lives in
 * `perTabNav.ts` and is unit-tested there; this hook only adapts it to `useState`.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  clearAllNav,
  dropNav,
  getNav,
  setNav as setNavPure,
  type PerTabNav
} from './perTabNav'

export interface PerTabNavController<N> {
  /** The active tab's nav state (the panel's `fallback` when that tab is unset). */
  nav: N
  /**
   * Set the ACTIVE tab's nav state (no-op when there is no active tab). Accepts either
   * a value or an updater `(prev) => next` (prev = the active tab's current nav, or the
   * panel `fallback` when unset) so partial updates compose without clobbering.
   */
  setNav: (next: N | ((prev: N) => N)) => void
  /** Drop a specific tab's nav entry (call on tab close). */
  drop: (tabId: string) => void
  /** Reset every tab's nav (call on connect/disconnect/refreshStatus). */
  clearAll: () => void
}

/**
 * @param activeTabId the currently active tab (null at zero tabs)
 * @param fallback    the per-panel default nav for an unset tab
 */
export function usePerTabNav<N>(activeTabId: string | null, fallback: N): PerTabNavController<N> {
  const [map, setMap] = useState<PerTabNav<N>>({})

  const nav = useMemo(() => getNav(map, activeTabId, fallback), [map, activeTabId, fallback])

  const setNav = useCallback(
    (next: N | ((prev: N) => N)) => {
      setMap((m) => {
        const resolved =
          typeof next === 'function'
            ? (next as (prev: N) => N)(getNav(m, activeTabId, fallback))
            : next
        return setNavPure(m, activeTabId, resolved)
      })
    },
    [activeTabId, fallback]
  )

  const drop = useCallback((tabId: string) => {
    setMap((m) => dropNav(m, tabId))
  }, [])

  const clearAll = useCallback(() => {
    setMap(() => clearAllNav<N>())
  }, [])

  return { nav, setNav, drop, clearAll }
}
