/**
 * DOM test (jsdom) for the PanelTabsProvider publish/subscribe registry (cosmos-panel-tab-list-v1).
 * Scenario: PANEL-TABS-PROVIDER-01 — a panel's published live tabs reach a subscriber, update on
 * change, and clear on the publisher's unmount (the cross-panel read seam, FR-008/FR-009).
 */
import '@testing-library/jest-dom/vitest'
import { useMemo } from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  PanelTabsProvider,
  usePublishPanelTabs,
  useAllPanelTabs,
  toPanelTabGroups,
  type CrossPanelId,
  type LivePanelTabs,
  type PanelTabGroup
} from './index'

const ORDER: CrossPanelId[] = ['terminal', 'slack', 'jira', 'confluence', 'google-calendar']
const LABELS: Record<CrossPanelId, string> = {
  terminal: 'Terminal',
  slack: 'Slack',
  jira: 'Jira',
  confluence: 'Confluence',
  'google-calendar': 'Google Calendar'
}

function Publisher({ panelId, tabs }: { panelId: CrossPanelId; tabs: LivePanelTabs }): null {
  usePublishPanelTabs(
    panelId,
    useMemo(() => tabs, [tabs])
  )
  return null
}

let lastGroups: PanelTabGroup[] = []
function Consumer(): null {
  const registry = useAllPanelTabs()
  lastGroups = toPanelTabGroups(registry, ORDER, LABELS)
  return null
}

describe('PanelTabsProvider (PANEL-TABS-PROVIDER-01)', () => {
  it('a published panel reaches the subscriber as a group', () => {
    render(
      <PanelTabsProvider>
        <Publisher panelId="jira" tabs={{ tabs: [{ id: 'j1', label: 'Sprint board' }], activeTabId: 'j1' }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastGroups.map((g) => g.panelId)).toEqual(['jira'])
    expect(lastGroups[0].tabs).toEqual([{ id: 'j1', label: 'Sprint board' }])
    expect(lastGroups[0].activeTabId).toBe('j1')
  })

  it('a tab-state change RE-PUBLISHES (the read is reactive, not stale)', () => {
    const { rerender } = render(
      <PanelTabsProvider>
        <Publisher panelId="jira" tabs={{ tabs: [{ id: 'j1', label: 'Board' }], activeTabId: 'j1' }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastGroups[0].tabs).toHaveLength(1)

    rerender(
      <PanelTabsProvider>
        <Publisher
          panelId="jira"
          tabs={{
            tabs: [
              { id: 'j1', label: 'Board' },
              { id: 'j2', label: 'PROJ-9' }
            ],
            activeTabId: 'j2'
          }}
        />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastGroups[0].tabs.map((t) => t.id)).toEqual(['j1', 'j2'])
    expect(lastGroups[0].activeTabId).toBe('j2')
  })

  it('two panels publish independently; a panel CLEARS when its publisher unmounts', () => {
    const { rerender } = render(
      <PanelTabsProvider>
        <Publisher panelId="terminal" tabs={{ tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' }} />
        <Publisher panelId="jira" tabs={{ tabs: [{ id: 'j1', label: 'Board' }], activeTabId: 'j1' }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastGroups.map((g) => g.panelId)).toEqual(['terminal', 'jira'])

    // Drop the Jira publisher — its unmount cleanup publishes null → the group disappears (FR-006).
    rerender(
      <PanelTabsProvider>
        <Publisher panelId="terminal" tabs={{ tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastGroups.map((g) => g.panelId)).toEqual(['terminal'])
  })
})
