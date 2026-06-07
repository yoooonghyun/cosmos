import { describe, it, expect, vi } from 'vitest'
import {
  adjacentActiveId,
  closeTab,
  defaultRequestDecision,
  labelFromUtterance,
  MAX_LABEL_LENGTH,
  nextTerminalIndex,
  openTab,
  setActiveTab,
  shouldFlushDeferredDefault,
  terminalLabel,
  UNTITLED_LABEL,
  updateTab,
  type TabsState
} from './panelTabs'

/* panel-tabs v1 — pure tab-collection logic (Phase 3). Node env, no DOM. */

/** A minimal generative-flavored tab record for exercising the generic logic. */
interface Tab {
  id: string
  label: string
  inFlight?: boolean
  error?: string
  surface?: { requestId: string } | null
}

const empty: TabsState<Tab> = { tabs: [], activeTabId: null }

const tab = (id: string, label = id): Tab => ({ id, label })

/** Build a 3-tab state with `activeTabId` set to the middle tab by default. */
function threeTabs(activeId = 'b'): TabsState<Tab> {
  return { tabs: [tab('a'), tab('b'), tab('c')], activeTabId: activeId }
}

describe('openTab (FR-005)', () => {
  it('appends a tab and makes it active (happy path)', () => {
    const s1 = openTab(empty, tab('a'))
    expect(s1.tabs.map((t) => t.id)).toEqual(['a'])
    expect(s1.activeTabId).toBe('a')

    const s2 = openTab(s1, tab('b'))
    expect(s2.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    // FR-005: the newly-opened tab becomes active.
    expect(s2.activeTabId).toBe('b')
  })

  it('does not mutate the input state (purity)', () => {
    openTab(empty, tab('a'))
    expect(empty.tabs).toEqual([])
    expect(empty.activeTabId).toBeNull()
  })

  it('warns and is a no-op for a missing/empty id (invalid required arg → safe fallback)', () => {
    const warn = vi.fn()
    const bad = openTab(empty, { id: '', label: 'x' }, warn)
    expect(bad).toBe(empty)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and is a no-op for a duplicate id (safe fallback)', () => {
    const warn = vi.fn()
    const s1 = openTab(empty, tab('a'))
    const s2 = openTab(s1, tab('a'), warn)
    expect(s2).toBe(s1)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('adjacentActiveId (FR-006/FR-007)', () => {
  it('keeps the active tab when a non-active tab closes (FR-007)', () => {
    const { tabs } = threeTabs('b')
    expect(adjacentActiveId(tabs, 'a', 'b')).toBe('b')
    expect(adjacentActiveId(tabs, 'c', 'b')).toBe('b')
  })

  it('activates the right neighbor when the active (non-last) tab closes (FR-006)', () => {
    const { tabs } = threeTabs('b')
    expect(adjacentActiveId(tabs, 'b', 'b')).toBe('c')
  })

  it('activates the left neighbor when the active rightmost tab closes (FR-006)', () => {
    const { tabs } = threeTabs('c')
    expect(adjacentActiveId(tabs, 'c', 'c')).toBe('b')
  })

  it('returns null when the only tab closes', () => {
    expect(adjacentActiveId([tab('a')], 'a', 'a')).toBeNull()
  })
})

describe('closeTab (FR-004/FR-006/FR-007)', () => {
  it('closes a non-active tab and leaves the active tab unchanged (FR-007)', () => {
    const s = closeTab(threeTabs('b'), 'a')
    expect(s.tabs.map((t) => t.id)).toEqual(['b', 'c'])
    expect(s.activeTabId).toBe('b')
  })

  it('closes the active tab and activates the right neighbor (FR-006)', () => {
    const s = closeTab(threeTabs('b'), 'b')
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(s.activeTabId).toBe('c')
  })

  it('closes the active rightmost tab and activates the left neighbor (FR-006)', () => {
    const s = closeTab(threeTabs('c'), 'c')
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.activeTabId).toBe('b')
  })

  it('closing the last remaining tab yields an empty set with no active tab', () => {
    const one: TabsState<Tab> = { tabs: [tab('a')], activeTabId: 'a' }
    const s = closeTab(one, 'a')
    expect(s.tabs).toEqual([])
    expect(s.activeTabId).toBeNull()
  })

  it('warns and is a no-op for an unknown / empty id (safe fallback)', () => {
    const warn = vi.fn()
    const state = threeTabs('b')
    expect(closeTab(state, 'zzz', warn)).toBe(state)
    expect(closeTab(state, '', warn)).toBe(state)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('does not mutate the input (purity)', () => {
    const state = threeTabs('b')
    closeTab(state, 'b')
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(state.activeTabId).toBe('b')
  })
})

describe('setActiveTab (FR-003)', () => {
  it('activates an existing tab', () => {
    const s = setActiveTab(threeTabs('b'), 'c')
    expect(s.activeTabId).toBe('c')
  })

  it('is identity when the target is already active', () => {
    const state = threeTabs('b')
    expect(setActiveTab(state, 'b')).toBe(state)
  })

  it('warns and is a no-op for an unknown id (safe fallback)', () => {
    const warn = vi.fn()
    const state = threeTabs('b')
    expect(setActiveTab(state, 'zzz', warn)).toBe(state)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('updateTab (FR-013/FR-014/FR-015/FR-027)', () => {
  it('merges a partial patch into the addressed tab (file a surface / set in-flight)', () => {
    const state = threeTabs('b')
    const s = updateTab(state, 'b', { inFlight: true, surface: { requestId: 'r1' } })
    const b = s.tabs.find((t) => t.id === 'b')
    expect(b?.inFlight).toBe(true)
    expect(b?.surface).toEqual({ requestId: 'r1' })
    // other tabs untouched
    expect(s.tabs.find((t) => t.id === 'a')).toEqual(tab('a'))
  })

  it('accepts a patch omitting optional fields without error (missing optional → no throw)', () => {
    const state = threeTabs('b')
    expect(() => updateTab(state, 'b', {})).not.toThrow()
    expect(updateTab(state, 'b', {}).tabs.find((t) => t.id === 'b')).toEqual(tab('b'))
  })

  it('never lets a patch overwrite the tab id (stable key)', () => {
    const state = threeTabs('b')
    const s = updateTab(state, 'b', { id: 'HACK' } as Partial<Tab>)
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('warns and discards the patch when the tab is gone (FR-027 closed-tab surface)', () => {
    const warn = vi.fn()
    const state = threeTabs('b')
    expect(updateTab(state, 'closed', { surface: { requestId: 'r9' } }, warn)).toBe(state)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('does not mutate the input (purity)', () => {
    const state = threeTabs('b')
    updateTab(state, 'b', { error: 'boom' })
    expect(state.tabs.find((t) => t.id === 'b')?.error).toBeUndefined()
  })
})

describe('labelFromUtterance (FR-010 / FR-009)', () => {
  it('returns the trimmed, whitespace-collapsed utterance when short', () => {
    expect(labelFromUtterance('  Open  bugs  in EU ')).toBe('Open bugs in EU')
  })

  it('truncates a long utterance to MAX_LABEL_LENGTH with an ellipsis (FR-010)', () => {
    const long = 'a'.repeat(MAX_LABEL_LENGTH + 20)
    const label = labelFromUtterance(long)
    expect(label.length).toBe(MAX_LABEL_LENGTH)
    expect(label.endsWith('…')).toBe(true)
  })

  it('honors a custom maxLength', () => {
    expect(labelFromUtterance('hello world', 5)).toBe('hell…')
  })

  it('falls back to "Untitled" for empty / whitespace-only / non-string (safe fallback, FR-009)', () => {
    expect(labelFromUtterance('')).toBe(UNTITLED_LABEL)
    expect(labelFromUtterance('   \n\t ')).toBe(UNTITLED_LABEL)
    // missing/invalid input must not throw
    expect(labelFromUtterance(undefined as unknown as string)).toBe(UNTITLED_LABEL)
  })
})

describe('defaultRequestDecision (new-tab-base-view-v1 OQ-1 / FR-011)', () => {
  it('fires immediately when the correlation is idle (no compose awaiting a frame)', () => {
    expect(defaultRequestDecision(null)).toBe('fire')
  })

  it('defers while a compose is awaiting a frame (originatingTabId set)', () => {
    expect(defaultRequestDecision('tab-1')).toBe('defer')
  })
})

describe('shouldFlushDeferredDefault (new-tab-base-view-v1 FR-011)', () => {
  it('flushes when a request is queued AND the correlation is idle', () => {
    expect(shouldFlushDeferredDefault(true, null)).toBe(true)
  })

  it('does not flush when no request is queued', () => {
    expect(shouldFlushDeferredDefault(false, null)).toBe(false)
  })

  it('stays deferred when a second compose is now awaiting a frame (degrade, never hang)', () => {
    expect(shouldFlushDeferredDefault(true, 'tab-2')).toBe(false)
  })

  it('is false when neither condition holds', () => {
    expect(shouldFlushDeferredDefault(false, 'tab-2')).toBe(false)
  })
})

describe('terminalLabel / nextTerminalIndex (FR-011)', () => {
  it('formats a 1-based terminal label', () => {
    expect(terminalLabel(1)).toBe('Terminal 1')
    expect(terminalLabel(2)).toBe('Terminal 2')
  })

  it('degrades a non-positive / non-finite index to "Terminal 1" (safe fallback)', () => {
    expect(terminalLabel(0)).toBe('Terminal 1')
    expect(terminalLabel(-5)).toBe('Terminal 1')
    expect(terminalLabel(NaN)).toBe('Terminal 1')
  })

  it('nextTerminalIndex is monotonic over the ever-opened count (no renumber)', () => {
    expect(nextTerminalIndex(0)).toBe(1)
    expect(nextTerminalIndex(1)).toBe(2)
    // even if a middle terminal was closed, the counter keeps growing
    expect(nextTerminalIndex(2)).toBe(3)
  })

  it('nextTerminalIndex degrades a bad count to 1 (safe fallback)', () => {
    expect(nextTerminalIndex(-1)).toBe(1)
    expect(nextTerminalIndex(NaN)).toBe(1)
  })
})
