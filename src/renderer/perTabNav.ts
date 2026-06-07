/**
 * perTabNav — pure, framework-free per-tab navigation-state logic for the native
 * "base" browser of the generative rail panels (bug panel-shared-tab-nav-state-v1).
 *
 * The generative A2UI *surface* of each tab is already isolated on
 * `GenerativeTab.surface` (`useGenerativePanelTabs.ts`). The native-base browser nav
 * (Slack: `view`/`searchText`; Confluence: `view`/`searchText`/`query`) was held in a
 * single panel-level `useState`, so every tab's base reflected the same navigation.
 * This module holds that nav state PER-TAB, keyed by tab id, so each tab is independent.
 *
 * It is intentionally React-free and DOM-free so it can be unit-tested in vitest's
 * node env (no jsdom) — the CLAUDE.md convention ("keep testable logic in a plain
 * `.ts`, never import a `.tsx` from a `.test.ts`"). `usePerTabNav.ts` wraps it in a
 * React hook; `SlackPanel.tsx`/`ConfluencePanel.tsx` consume the hook.
 *
 * Generic over the per-panel nav shape `N` (Slack's `View`, Confluence's combined
 * `{ view, searchText, query }`): this module only knows "a map of tabId -> N with a
 * per-panel default for an unset tab".
 */

/** The per-tab nav map: tab id -> that tab's nav state. */
export type PerTabNav<N> = Record<string, N>

/**
 * Read a tab's nav state, falling back to `fallback` when the tab has no stored entry
 * yet (a fresh `+` tab reads its panel default — the bug's core "each unset tab is
 * independent" requirement). Never throws; a missing/empty tabId also returns the
 * fallback (safe default).
 */
export function getNav<N>(map: PerTabNav<N>, tabId: string | null, fallback: N): N {
  if (typeof tabId !== 'string' || tabId === '') {
    return fallback
  }
  return Object.prototype.hasOwnProperty.call(map, tabId) ? map[tabId] : fallback
}

/**
 * Set a single tab's nav state. Pure: returns a fresh map, does not mutate the input.
 * A missing/empty tabId is a no-op that warns and returns the unchanged map (safe
 * fallback) so a misuse never corrupts another tab's state.
 */
export function setNav<N>(
  map: PerTabNav<N>,
  tabId: string | null,
  next: N,
  warn: (msg: string) => void = console.warn
): PerTabNav<N> {
  if (typeof tabId !== 'string' || tabId === '') {
    warn('[perTabNav] setNav: tabId must be a non-empty string; ignoring')
    return map
  }
  return { ...map, [tabId]: next }
}

/**
 * Drop a tab's nav entry (call when a tab is closed so the map does not leak entries
 * for tabs that no longer exist). Pure; returns a fresh map. Dropping an absent or
 * empty tabId is a harmless no-op that returns the unchanged map (no warning — closing
 * a tab that never navigated is normal).
 */
export function dropNav<N>(map: PerTabNav<N>, tabId: string | null): PerTabNav<N> {
  if (typeof tabId !== 'string' || tabId === '' || !Object.prototype.hasOwnProperty.call(map, tabId)) {
    return map
  }
  const next = { ...map }
  delete next[tabId]
  return next
}

/**
 * Clear ALL tabs' nav entries (reset to the empty map, so every tab falls back to its
 * panel default). Used on a connection transition (connect/disconnect/refreshStatus):
 * while disconnected the connect call-to-action replaces the base entirely, so it is
 * coherent to reset every tab's base nav rather than leave stale per-tab drill-ins
 * behind a reconnect. Pure; returns a fresh empty map.
 */
export function clearAllNav<N>(): PerTabNav<N> {
  return {}
}
