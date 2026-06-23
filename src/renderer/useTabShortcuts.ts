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
  /** Open a new tab (Cmd+T). */
  onNewTab: () => void
  /** Close the tab with this id (Cmd+W). */
  onCloseTab: (id: string) => void
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
}

export function useTabShortcuts(ops: TabShortcutOps): void {
  // The IPC subscription binds once; a ref keeps it reading the latest tab state
  // (tabs/activeTabId change every render) without rebinding the listener.
  const ref = useRef(ops)
  ref.current = ops

  useEffect(() => {
    const off = window.cosmos.shortcuts.onTrigger((payload) => {
      const { active, tabs, activeTabId, onActivate, onNewTab, onCloseTab, resolveClose, onCloseFileTab } =
        ref.current
      if (!active) {
        return
      }
      switch (payload.command) {
        case 'tab:new':
          onNewTab()
          break
        case 'tab:close':
          // terminal-focus-aware-close-tab-v1: when the active pane's file viewer holds focus and
          // has an open file, close that file tab instead of the panel tab (FR-001/FR-002). The
          // resolver is only wired by the Terminal panel; every other panel falls straight through.
          if (resolveClose?.() === 'file-tab' && onCloseFileTab) {
            onCloseFileTab()
          } else if (activeTabId) {
            onCloseTab(activeTabId)
          }
          break
        case 'tab:next':
        case 'tab:prev': {
          if (tabs.length === 0) {
            break
          }
          const current = tabs.findIndex((t) => t.id === activeTabId)
          const from = current < 0 ? 0 : current
          const delta = payload.command === 'tab:next' ? 1 : -1
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
