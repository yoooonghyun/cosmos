/**
 * Node-unit tests for the pure cross-panel tab-tree derivations (cosmos-panel-tab-list-v1).
 * Covers `toPanelTabGroups` (order / absent-panel / empty-group / malformed-skip) and
 * `reconcileSelectedContext` (close → clear, rename → relabel, unchanged → same ref).
 * Scenario: PANEL-TABS-TREE-01.
 */
import { describe, it, expect, vi } from 'vitest'
import { toPanelTabGroups, reconcileSelectedContext } from './panelTabsTree'
import type { CrossPanelId, PanelTabsRegistry } from './panelTabs'
import type { PromptContext } from '../../shared/promptContext/promptContext'

const ORDER: readonly CrossPanelId[] = [
  'terminal',
  'slack',
  'jira',
  'confluence',
  'google-calendar'
]
const LABELS: Record<CrossPanelId, string> = {
  terminal: 'Terminal',
  slack: 'Slack',
  jira: 'Jira',
  confluence: 'Confluence',
  'google-calendar': 'Google Calendar'
}

describe('toPanelTabGroups (PANEL-TABS-TREE-01)', () => {
  it('returns groups in the fixed order, only for PUBLISHED panels (FR-005/FR-006)', () => {
    const registry: PanelTabsRegistry = {
      jira: { tabs: [{ id: 'j1', label: 'Sprint board' }], activeTabId: 'j1' },
      terminal: { tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' }
    }
    const groups = toPanelTabGroups(registry, ORDER, LABELS)
    // slack/confluence/calendar never published → absent; order follows ORDER (terminal before jira).
    expect(groups.map((g) => g.panelId)).toEqual(['terminal', 'jira'])
    expect(groups[0]).toMatchObject({ panelId: 'terminal', label: 'Terminal', activeTabId: 't1' })
    expect(groups[1].tabs).toEqual([{ id: 'j1', label: 'Sprint board' }])
  })

  it('OMITS a panel whose entry is explicitly null (cleared on unmount, FR-006)', () => {
    const registry: PanelTabsRegistry = {
      slack: null,
      jira: { tabs: [{ id: 'j1', label: 'Board' }], activeTabId: 'j1' }
    }
    expect(toPanelTabGroups(registry, ORDER, LABELS).map((g) => g.panelId)).toEqual(['jira'])
  })

  it('a published panel with ZERO tabs yields an EMPTY group (FR-020)', () => {
    const registry: PanelTabsRegistry = { slack: { tabs: [], activeTabId: null } }
    const groups = toPanelTabGroups(registry, ORDER, LABELS)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ panelId: 'slack', tabs: [], activeTabId: null })
  })

  it('WARNS + SKIPS a malformed entry (tabs not an array) without crashing (FR-022)', () => {
    const warn = vi.fn()
    const registry = {
      jira: { tabs: 'nope', activeTabId: 'x' },
      terminal: { tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' }
    } as unknown as PanelTabsRegistry
    const groups = toPanelTabGroups(registry, ORDER, LABELS, warn)
    expect(groups.map((g) => g.panelId)).toEqual(['terminal'])
    expect(warn).toHaveBeenCalled()
  })

  it('WARNS + SKIPS a malformed tab within a group, keeping the valid ones (FR-022)', () => {
    const warn = vi.fn()
    const registry = {
      jira: {
        tabs: [{ id: 'j1', label: 'Board' }, { id: '', label: 'bad' }, { nope: true }],
        activeTabId: 'j1'
      }
    } as unknown as PanelTabsRegistry
    const groups = toPanelTabGroups(registry, ORDER, LABELS, warn)
    expect(groups[0].tabs).toEqual([{ id: 'j1', label: 'Board' }])
    expect(warn).toHaveBeenCalled()
  })

  it('a non-string activeTabId degrades to null (safe fallback)', () => {
    const registry = {
      jira: { tabs: [{ id: 'j1', label: 'Board' }], activeTabId: 123 }
    } as unknown as PanelTabsRegistry
    expect(toPanelTabGroups(registry, ORDER, LABELS).at(0)?.activeTabId).toBeNull()
  })

  it('a missing registry warns + returns no groups (safe fallback)', () => {
    const warn = vi.fn()
    expect(toPanelTabGroups(null, ORDER, LABELS, warn)).toEqual([])
    expect(warn).toHaveBeenCalled()
  })
})

describe('reconcileSelectedContext (PANEL-TABS-TREE-01, FR-017)', () => {
  const jiraSel: PromptContext = {
    panel: { id: 'jira', label: 'Jira' },
    tab: { id: 'j1', label: 'Sprint board' }
  }
  const groupsWith = (label: string) =>
    toPanelTabGroups({ jira: { tabs: [{ id: 'j1', label }], activeTabId: 'j1' } }, ORDER, LABELS)

  it('returns null/unchanged for no selection or a tab-less selection', () => {
    expect(reconcileSelectedContext(null, [])).toBeNull()
    const panelOnly: PromptContext = { panel: { id: 'cosmos', label: 'Cosmos' } }
    expect(reconcileSelectedContext(panelOnly, [])).toBe(panelOnly)
  })

  it('preserves the SAME reference when the selected tab is unchanged', () => {
    const out = reconcileSelectedContext(jiraSel, groupsWith('Sprint board'))
    expect(out).toBe(jiraSel)
  })

  it('relabels the tab segment when the source tab was RENAMED (FR-017)', () => {
    const out = reconcileSelectedContext(jiraSel, groupsWith('Renamed board'))
    expect(out).not.toBe(jiraSel)
    expect(out).toEqual({
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 'j1', label: 'Renamed board' }
    })
  })

  it('CLEARS the selection when the selected tab was CLOSED (FR-017)', () => {
    const groups = toPanelTabGroups(
      { jira: { tabs: [{ id: 'j2', label: 'Other' }], activeTabId: 'j2' } },
      ORDER,
      LABELS
    )
    expect(reconcileSelectedContext(jiraSel, groups)).toBeNull()
  })

  it('CLEARS the selection when the source PANEL is gone (disabled/unmounted, FR-017)', () => {
    expect(reconcileSelectedContext(jiraSel, [])).toBeNull()
  })
})
