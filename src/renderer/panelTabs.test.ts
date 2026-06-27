import { describe, it, expect, vi } from 'vitest'
import {
  adjacentActiveId,
  closeTab,
  defaultRequestDecision,
  isFolderOpen,
  labelFromUtterance,
  MAX_LABEL_LENGTH,
  nextTerminalIndex,
  normalizeRenameInput,
  panelTabLabel,
  renameCommitDecision,
  seedTerminalIndex,
  openTab,
  setActiveTab,
  shouldApplyAutoLabel,
  shouldAutoLoadDefaultView,
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

describe('shouldAutoLoadDefaultView (jira-kanban-generation-v1 Symptom 1)', () => {
  const base = {
    hasSurface: false,
    loadingDefault: false,
    hasError: false,
    inFlight: false,
    inCompose: false
  }

  it('loads the default board for a genuinely idle empty tab', () => {
    expect(shouldAutoLoadDefaultView(base)).toBe(true)
  })

  it('does NOT load while a compose is awaiting its frame (the spinner-vs-skeleton race)', () => {
    // The regression: after ui-catalog-pull-spinner-signal-v1, a freshly-submitted tab is
    // { hasSurface:false, loadingDefault:false, hasError:false, inFlight:false } in the window
    // between submit and the begin-signal. Without `inCompose` this looked idle and fired the
    // default read, showing the skeleton for the whole run. `inCompose` must suppress it.
    expect(shouldAutoLoadDefaultView({ ...base, inCompose: true })).toBe(false)
  })

  it('does not load when a surface is already present', () => {
    expect(shouldAutoLoadDefaultView({ ...base, hasSurface: true })).toBe(false)
  })

  it('does not load while a default read is already outstanding', () => {
    expect(shouldAutoLoadDefaultView({ ...base, loadingDefault: true })).toBe(false)
  })

  it('does not load when the tab carries an error', () => {
    expect(shouldAutoLoadDefaultView({ ...base, hasError: true })).toBe(false)
  })

  it('does not load once the begin-signal has set inFlight (the spinner is showing)', () => {
    expect(shouldAutoLoadDefaultView({ ...base, inFlight: true })).toBe(false)
  })
})

describe('normalizeRenameInput (tab-rename-v1 FR-006)', () => {
  it('trims leading/trailing whitespace, keeping interior verbatim (no collapse)', () => {
    expect(normalizeRenameInput('  hi  ')).toBe('hi')
    expect(normalizeRenameInput('  a  b  ')).toBe('a  b')
  })

  it('returns "" for empty / whitespace-only input', () => {
    expect(normalizeRenameInput('')).toBe('')
    expect(normalizeRenameInput('   \n\t ')).toBe('')
  })

  it('degrades a non-string to "" without throwing (safe fallback)', () => {
    expect(normalizeRenameInput(undefined as unknown as string)).toBe('')
    expect(normalizeRenameInput(null as unknown as string)).toBe('')
  })
})

describe('renameCommitDecision (tab-rename-v1 FR-005/FR-006)', () => {
  it('commits a non-empty value with the trimmed label (happy path, FR-006)', () => {
    expect(renameCommitDecision('My tab')).toEqual({ commit: true, label: 'My tab' })
  })

  it('trims leading/trailing whitespace on commit (FR-006)', () => {
    expect(renameCommitDecision('  hi  ')).toEqual({ commit: true, label: 'hi' })
  })

  it('does NOT commit empty / whitespace-only (revert, not renamed, FR-005)', () => {
    expect(renameCommitDecision('')).toEqual({ commit: false })
    expect(renameCommitDecision('   ')).toEqual({ commit: false })
    expect(renameCommitDecision('\t\n ')).toEqual({ commit: false })
  })

  it('still commits an unchanged-but-non-empty value (edge case: explicit confirm allowed)', () => {
    expect(renameCommitDecision('Untitled')).toEqual({ commit: true, label: 'Untitled' })
  })

  it('does not throw on a non-string and falls into the revert branch (safe fallback)', () => {
    expect(renameCommitDecision(undefined as unknown as string)).toEqual({ commit: false })
  })
})

describe('shouldApplyAutoLabel (tab-rename-v1 FR-008/FR-009)', () => {
  it('returns false for a renamed tab (auto-label must be skipped)', () => {
    expect(shouldApplyAutoLabel({ renamed: true })).toBe(false)
  })

  it('returns true when not renamed (missing or false flag → auto-label proceeds)', () => {
    expect(shouldApplyAutoLabel({})).toBe(true)
    expect(shouldApplyAutoLabel({ renamed: false })).toBe(true)
  })

  it('degrades a missing/null tab to true (safe fallback — auto-label is the default)', () => {
    expect(shouldApplyAutoLabel(null)).toBe(true)
    expect(shouldApplyAutoLabel(undefined)).toBe(true)
  })
})

describe('updateTab + renamed flag (tab-rename-v1 FR-007 — reuse existing patcher)', () => {
  it('merges { label, renamed: true } into the addressed tab and locks the id', () => {
    const state: TabsState<Tab & { renamed?: boolean }> = {
      tabs: [tab('a'), tab('b'), tab('c')],
      activeTabId: 'b'
    }
    const s = updateTab(state, 'b', { label: 'Renamed', renamed: true })
    const b = s.tabs.find((t) => t.id === 'b')
    expect(b?.label).toBe('Renamed')
    expect(b?.renamed).toBe(true)
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('panelTabLabel (unified seed-tab naming)', () => {
  it('uses the BARE panel name for the first tab, then "<Panel> N"', () => {
    expect(panelTabLabel('Jira', 1)).toBe('Jira')
    expect(panelTabLabel('Jira', 2)).toBe('Jira 2')
    expect(panelTabLabel('Generated UI', 3)).toBe('Generated UI 3')
  })

  it('degrades a non-positive / non-finite index to the bare panel name (safe fallback)', () => {
    expect(panelTabLabel('Slack', 0)).toBe('Slack')
    expect(panelTabLabel('Slack', -5)).toBe('Slack')
    expect(panelTabLabel('Slack', NaN)).toBe('Slack')
  })
})

describe('terminalLabel / nextTerminalIndex (FR-011)', () => {
  it('uses the bare "Terminal" for the first tab, then "Terminal N"', () => {
    expect(terminalLabel(1)).toBe('Terminal')
    expect(terminalLabel(2)).toBe('Terminal 2')
  })

  it('degrades a non-positive / non-finite index to "Terminal" (safe fallback)', () => {
    expect(terminalLabel(0)).toBe('Terminal')
    expect(terminalLabel(-5)).toBe('Terminal')
    expect(terminalLabel(NaN)).toBe('Terminal')
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

/*
 * Regression: terminal-tab-index-skip-v1.
 *
 * The Terminal panel seeds one tab from a render-phase `useState` lazy initializer.
 * React StrictMode double-invokes that initializer in dev. The OLD seed called an
 * impure `mintTab()` (read AND advanced a monotonic ref) inside it, so two invokes
 * advanced the counter twice for the one seed tab → the first `+` skipped to
 * "Terminal 3". The FIX makes the seed PURE: the counter starts AT the seed index
 * (`seedTerminalIndex()` = 1) and the seed labels directly from it WITHOUT advancing
 * — only `mintTab()` (called from event handlers / effects) advances.
 *
 * These tests model the panel's counter discipline with plain helpers (node env, no
 * DOM) and assert the seed is idempotent under double-evaluation.
 */
describe('terminal panel seeding is StrictMode-idempotent (terminal-tab-index-skip-v1)', () => {
  /** A counter cell mirroring the panel's `everOpened` ref. */
  interface Counter {
    value: number
  }

  /** Mirror of `TerminalPanel.mintTab`: advances the counter, returns the label. */
  const mintLabel = (counter: Counter): string => {
    const index = nextTerminalIndex(counter.value)
    counter.value = index
    return terminalLabel(index)
  }

  /**
   * Mirror of the FIXED render-phase seed: PURE — initialize the counter to the seed
   * index and label directly from it, with NO advance.
   */
  const seed = (): { counter: Counter; label: string } => {
    const counter: Counter = { value: seedTerminalIndex() }
    const label = terminalLabel(seedTerminalIndex())
    return { counter, label }
  }

  it('the seed reads "Terminal" and leaves the counter at 1', () => {
    const { counter, label } = seed()
    expect(label).toBe('Terminal')
    expect(counter.value).toBe(1)
  })

  it('double-evaluating the seed (StrictMode) does NOT double-advance — next `+` is "Terminal 2"', () => {
    // StrictMode runs the lazy initializer twice; the second result is discarded.
    const first = seed()
    const second = seed()
    // Both invokes are idempotent — neither moves the counter past the seed index.
    expect(first.label).toBe('Terminal')
    expect(second.label).toBe('Terminal')
    expect(second.counter.value).toBe(1)

    // The kept counter is from a single seed; the first `+` mints index 2, not 3.
    const kept = first.counter
    expect(mintLabel(kept)).toBe('Terminal 2')
  })

  it('after the seed, minting two more tabs yields "Terminal 2" then "Terminal 3"', () => {
    const { counter } = seed()
    expect(mintLabel(counter)).toBe('Terminal 2')
    expect(mintLabel(counter)).toBe('Terminal 3')
  })
})

describe('isFolderOpen (welcome view ↔ 3-pane split gate)', () => {
  it('is true ONLY for the live phase (a folder is open → render the 3-pane split)', () => {
    expect(isFolderOpen('live')).toBe(true)
  })

  it('is false while awaiting a directory (→ render the welcome view, no split)', () => {
    expect(isFolderOpen('awaiting')).toBe(false)
  })

  it('degrades a missing/garbage phase to false (the welcome view is the safe fallback)', () => {
    expect(isFolderOpen(null)).toBe(false)
    expect(isFolderOpen(undefined)).toBe(false)
    // @ts-expect-error — guard against a non-phase value reaching the predicate at runtime.
    expect(isFolderOpen('bogus')).toBe(false)
  })
})
