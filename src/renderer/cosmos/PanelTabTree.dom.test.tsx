/**
 * DOM test (jsdom) for the PanelTabTree (cosmos-panel-tab-list-v1, design §2 / D-15).
 * Scenario: PANEL-TABS-TREE-UI-01 — grouped rows, empty/all-empty states, the FileTree roving
 * keymap (Arrow/Enter activate), per-row states (context-selected aria-selected, active-source dot),
 * and group expand/collapse.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelTabTree, type PanelTabSelection } from './PanelTabTree'
import type { PanelTabGroup } from '../panelTabs'

const groups: PanelTabGroup[] = [
  { panelId: 'terminal', label: 'Terminal', tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' },
  {
    panelId: 'jira',
    label: 'Jira',
    tabs: [
      { id: 'j1', label: 'Sprint board' },
      { id: 'j2', label: 'PROJ-9' }
    ],
    activeTabId: 'j1'
  }
]

function renderTree(opts?: {
  groups?: PanelTabGroup[]
  selected?: PanelTabSelection | null
  onActivate?: (g: PanelTabGroup, t: { id: string; label: string }) => void
}): { onActivate: ReturnType<typeof vi.fn> } {
  const onActivate = vi.fn(opts?.onActivate)
  render(
    <TooltipProvider>
      <PanelTabTree
        groups={opts?.groups ?? groups}
        selected={opts?.selected ?? null}
        onActivate={onActivate}
      />
    </TooltipProvider>
  )
  return { onActivate }
}

describe('PanelTabTree (PANEL-TABS-TREE-UI-01)', () => {
  it('renders a group per panel with its tab rows (FR-005/FR-007)', () => {
    renderTree()
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByText('Sprint board')).toBeInTheDocument()
    expect(screen.getByText('PROJ-9')).toBeInTheDocument()
    // The tree is one ARIA tree with treeitems.
    expect(screen.getByRole('tree', { name: 'Open panel tabs' })).toBeInTheDocument()
  })

  it('a published panel with ZERO tabs shows a quiet "No open tabs" line (FR-020)', () => {
    renderTree({ groups: [{ panelId: 'slack', label: 'Slack', tabs: [], activeTabId: null }] })
    expect(screen.getByText('No open tabs')).toBeInTheDocument()
  })

  it('NO in-scope panels → one calm centered empty state (FR-021)', () => {
    renderTree({ groups: [] })
    expect(screen.getByText('No open tabs in other panels')).toBeInTheDocument()
  })

  it('clicking a tab row activates it as context (FR-012), without navigating', () => {
    const { onActivate } = renderTree()
    fireEvent.click(screen.getByText('Sprint board'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith(groups[1], { id: 'j1', label: 'Sprint board' })
  })

  it('the roving keymap activates a tab via ArrowDown + Enter (FR-003)', () => {
    const { onActivate } = renderTree()
    const tree = screen.getByRole('tree')
    // First visible row is the Terminal group header → ArrowDown moves to its tab row.
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith(groups[0], { id: 't1', label: 'Terminal' })
  })

  it('clicking a group header collapses it (its tab rows disappear)', () => {
    renderTree()
    expect(screen.getByText('Sprint board')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Jira'))
    expect(screen.queryByText('Sprint board')).not.toBeInTheDocument()
  })

  it('the selected tab reflects in aria-selected for a11y, with NO visual highlight (user request)', () => {
    renderTree({ selected: { panelId: 'jira', tabId: 'j1' } })
    const row = screen.getByText('Sprint board').closest('[role="treeitem"]')
    expect(row).toHaveAttribute('aria-selected', 'true')
    // The tree is a pure picker now — no persistent in-tree highlight bar / data attr.
    expect(row).not.toHaveAttribute('data-context-selected')
    expect(row?.className).not.toContain('before:bg-brand-accent')
    const other = screen.getByText('PROJ-9').closest('[role="treeitem"]')
    expect(other).toHaveAttribute('aria-selected', 'false')
  })

  it('renders NO active-source dot (the focused-tab indicator was removed per user request)', () => {
    const { container } = render(
      <TooltipProvider>
        <PanelTabTree groups={groups} selected={null} onActivate={() => {}} />
      </TooltipProvider>
    )
    expect(container.querySelector('.bg-brand-accent')).toBeNull()
  })
})
