/**
 * DOM tests for useTabShortcuts (jsdom environment, vitest.dom.config.ts).
 *
 * useTabShortcuts calls window.cosmos.shortcuts.onTrigger (Electron preload IPC).
 * In jsdom we stub window.cosmos so the hook logic is exercised without Electron.
 *
 * Scenarios tested:
 *   1. tab:next wraps around from last to first tab.
 *   2. tab:prev wraps from first to last tab.
 *   3. When active=false the hook ignores all commands (wrong surface focus).
 *   4. tab:close routes to onCloseFileTab when resolveClose returns 'file-tab'.
 *   5. tab:close falls back to onCloseTab when resolveClose returns 'panel-tab'.
 *
 * These are the paths most likely to be wrong when someone adds a new surface
 * and forgets to set active=false on the others.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTabShortcuts } from './useTabShortcuts'
import type { ShortcutTriggerPayload } from '../../shared/ipc'

// ---------------------------------------------------------------------------
// window.cosmos stub — mimics the Electron preload API
// ---------------------------------------------------------------------------

type TriggerHandler = (payload: ShortcutTriggerPayload) => void

let _triggerHandler: TriggerHandler | null = null

const cosmosMock = {
  shortcuts: {
    onTrigger: vi.fn((handler: TriggerHandler) => {
      _triggerHandler = handler
      // Return an unsubscribe fn (mirrors the real preload)
      return () => {
        _triggerHandler = null
      }
    }),
  },
}

function fireTrigger(payload: ShortcutTriggerPayload): void {
  if (!_triggerHandler) throw new Error('No trigger handler registered — hook not mounted?')
  _triggerHandler(payload)
}

beforeEach(() => {
  _triggerHandler = null
  cosmosMock.shortcuts.onTrigger.mockClear()
  // Inject stub into window (jsdom allows arbitrary property assignment)
  ;(window as unknown as { cosmos: typeof cosmosMock }).cosmos = cosmosMock
})

afterEach(() => {
  _triggerHandler = null
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAB_A = { id: 'a' }
const TAB_B = { id: 'b' }
const TAB_C = { id: 'c' }
const TABS = [TAB_A, TAB_B, TAB_C]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTabShortcuts', () => {
  it('tab:next wraps from the last tab back to the first', () => {
    const onActivate = vi.fn()
    renderHook(() =>
      useTabShortcuts({
        active: true,
        tabs: TABS,
        activeTabId: TAB_C.id, // currently on last
        onActivate,
        onNewTab: vi.fn(),
        onCloseTab: vi.fn(),
      })
    )

    fireTrigger({ command: 'tab:next' })

    expect(onActivate).toHaveBeenCalledWith(TAB_A.id) // wraps to first
  })

  it('tab:prev wraps from the first tab back to the last', () => {
    const onActivate = vi.fn()
    renderHook(() =>
      useTabShortcuts({
        active: true,
        tabs: TABS,
        activeTabId: TAB_A.id, // currently on first
        onActivate,
        onNewTab: vi.fn(),
        onCloseTab: vi.fn(),
      })
    )

    fireTrigger({ command: 'tab:prev' })

    expect(onActivate).toHaveBeenCalledWith(TAB_C.id) // wraps to last
  })

  it('ignores ALL commands when active=false (surface not in focus)', () => {
    const onActivate = vi.fn()
    const onNewTab = vi.fn()
    const onCloseTab = vi.fn()
    renderHook(() =>
      useTabShortcuts({
        active: false,
        tabs: TABS,
        activeTabId: TAB_A.id,
        onActivate,
        onNewTab,
        onCloseTab,
      })
    )

    fireTrigger({ command: 'tab:next' })
    fireTrigger({ command: 'tab:new' })
    fireTrigger({ command: 'tab:close' })

    expect(onActivate).not.toHaveBeenCalled()
    expect(onNewTab).not.toHaveBeenCalled()
    expect(onCloseTab).not.toHaveBeenCalled()
  })

  it('tab:close routes to onCloseFileTab when resolveClose returns file-tab', () => {
    const onCloseTab = vi.fn()
    const onCloseFileTab = vi.fn()
    renderHook(() =>
      useTabShortcuts({
        active: true,
        tabs: TABS,
        activeTabId: TAB_B.id,
        onActivate: vi.fn(),
        onNewTab: vi.fn(),
        onCloseTab,
        resolveClose: () => 'file-tab',
        onCloseFileTab,
      })
    )

    fireTrigger({ command: 'tab:close' })

    expect(onCloseFileTab).toHaveBeenCalledTimes(1)
    expect(onCloseTab).not.toHaveBeenCalled()
  })

  it('tab:close falls back to onCloseTab when resolveClose returns panel-tab', () => {
    const onCloseTab = vi.fn()
    const onCloseFileTab = vi.fn()
    renderHook(() =>
      useTabShortcuts({
        active: true,
        tabs: TABS,
        activeTabId: TAB_B.id,
        onActivate: vi.fn(),
        onNewTab: vi.fn(),
        onCloseTab,
        resolveClose: () => 'panel-tab',
        onCloseFileTab,
      })
    )

    fireTrigger({ command: 'tab:close' })

    expect(onCloseTab).toHaveBeenCalledWith(TAB_B.id)
    expect(onCloseFileTab).not.toHaveBeenCalled()
  })
})
