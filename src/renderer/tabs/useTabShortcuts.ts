/**
 * useTabShortcuts — wires the global tab keyboard shortcuts (matched in main and
 * delivered via `window.cosmos.shortcuts.onTrigger`) onto ONE rail surface's tab
 * ops. Every rail panel calls this with its own tab collection; only the panel
 * whose surface is currently visible (`active`) acts, so the same global command
 * resolves against exactly the tab strip the user is looking at.
 *
 * `surface:*` commands are NOT handled here — App.tsx owns left-rail switching.
 *
 * Tab map (see `ShortcutCommand`): tab:new → onNewTab; tab:close → onCloseTab(active);
 * tab:next/prev → activate neighbour with wrap-around; tab:jump → activate index;
 * tab:last → activate the final tab.
 *
 * `onNewTab` / `onCloseTab` are OPTIONAL: a panel MAY omit either, making `tab:new` /
 * `tab:close` an intrinsic no-op for that surface (cosmos-home-keyboard-tab-nav-v1 — the
 * Home/Cosmos panel has no new-tab affordance and defers close, so it omits both and still
 * gets navigation). The four generative panels + terminal pass both, unchanged.
 */

import { useEffect, useRef } from 'react'
import type { CloseTarget } from './closeTabRouting'

export interface TabShortcutOps {
  /** True only for the currently-visible rail surface (gates all tab commands). */
  active: boolean
  /** The panel's open tabs, in strip order. */
  tabs: { id: string }[]
  /** The active tab id (null when none). */
  activeTabId: string | null
  /** Activate the tab with this id (Ctrl+Tab / Cmd+Opt+arrow / Cmd+N / Cmd+9). */
  onActivate: (id: string) => void
  /** Open a new tab (Cmd+T). OPTIONAL — omit ⇒ `tab:new` is a no-op for this surface. */
  onNewTab?: () => void
  /** Close the tab with this id (Cmd+W). OPTIONAL — omit ⇒ `tab:close` is a no-op for this surface. */
  onCloseTab?: (id: string) => void
  /**
   * Optional focus-aware `tab:close` routing (terminal-focus-aware-close-tab-v1, FR-001/FR-008).
   * Only the Terminal panel passes these; other panels omit them and keep the panel-tab close.
   * When `resolveClose` returns `'file-tab'` AND `onCloseFileTab` is wired, `tab:close` closes the
   * file viewer's active open-file tab instead of the panel tab. Any other case (no resolver,
   * `'panel-tab'`, or no `onCloseFileTab`) falls back to the existing `onCloseTab(active)`.
   */
  resolveClose?: () => CloseTarget
  /** Close the active open-file tab in the focused file viewer (FR-002/FR-003/FR-011). */
  onCloseFileTab?: () => void
  /**
   * Optional focus-aware `tab:next`/`tab:prev` routing (terminal-focus-aware-tab-nav-v1).
   * Only the Terminal panel passes these. When `resolveNav` returns `'file-tab'` AND
   * `onNavFileTab` is wired, Cmd+Opt+Arrow cycles the FOCUSED file viewer's open-file tabs
   * instead of the terminal panel tabs (the reported bug: nav always moved terminal tabs
   * regardless of editor focus). Any other case (no resolver, `'panel-tab'`, or no
   * `onNavFileTab`) falls back to the existing terminal-tab wrap-around below.
   */
  resolveNav?: () => CloseTarget
  /** Step the focused file viewer's active tab by `delta` (+1 next / -1 prev), with wrap. */
  onNavFileTab?: (delta: number) => void
}

export function useTabShortcuts(ops: TabShortcutOps): void {
  // The IPC subscription binds once; a ref keeps it reading the latest tab state
  // (tabs/activeTabId change every render) without rebinding the listener.
  const ref = useRef(ops)
  ref.current = ops

  useEffect(() => {
    const off = window.cosmos.shortcuts.onTrigger((payload) => {
      const {
        active,
        tabs,
        activeTabId,
        onActivate,
        onNewTab,
        onCloseTab,
        resolveClose,
        onCloseFileTab,
        resolveNav,
        onNavFileTab
      } = ref.current
      if (!active) {
        return
      }
      switch (payload.command) {
        case 'tab:new':
          // cosmos-home-keyboard-tab-nav-v1: a panel that omits onNewTab (Home) treats tab:new as a no-op.
          onNewTab?.()
          break
        case 'tab:close':
          // terminal-focus-aware-close-tab-v1: when the active pane's file viewer holds focus and
          // has an open file, close that file tab instead of the panel tab (FR-001/FR-002). The
          // resolver is only wired by the Terminal panel; every other panel falls straight through.
          // cosmos-home-keyboard-tab-nav-v1: a panel that omits onCloseTab (Home) treats tab:close as a no-op.
          if (resolveClose?.() === 'file-tab' && onCloseFileTab) {
            onCloseFileTab()
          } else if (activeTabId) {
            onCloseTab?.(activeTabId)
          }
          break
        case 'tab:next':
        case 'tab:prev': {
          const delta = payload.command === 'tab:next' ? 1 : -1
          // terminal-focus-aware-tab-nav-v1: when the active pane's file viewer/editor holds focus
          // and has an open file, Cmd+Opt+Arrow cycles the FILE tabs (the strip the user is looking
          // at), NOT the terminal tabs (the reported routing bug). The resolver/callback are only
          // wired by the Terminal panel; every other panel falls straight through to its own tabs.
          if (resolveNav?.() === 'file-tab' && onNavFileTab) {
            onNavFileTab(delta)
            break
          }
          if (tabs.length === 0) {
            break
          }
          const current = tabs.findIndex((t) => t.id === activeTabId)
          const from = current < 0 ? 0 : current
          const next = (from + delta + tabs.length) % tabs.length
          onActivate(tabs[next].id)
          break
        }
        case 'tab:jump': {
          const index = payload.index ?? 0
          if (index < tabs.length) {
            onActivate(tabs[index].id)
          }
          break
        }
        case 'tab:last':
          if (tabs.length > 0) {
            onActivate(tabs[tabs.length - 1].id)
          }
          break
        // surface:next / surface:prev are handled by App.tsx, not here.
      }
    })
    return off
  }, [])
}
