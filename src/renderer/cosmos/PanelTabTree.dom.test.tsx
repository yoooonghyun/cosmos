/**
 * DOM test (jsdom) for the PanelTabTree (cosmos-panel-tab-list-v1, design §2 / D-15).
 * Scenario: PANEL-TABS-TREE-UI-01 — grouped rows, empty/all-empty states, the FileTree roving
 * keymap (Arrow/Enter activate), per-row states (context-selected aria-selected, active-source dot),
 * and group expand/collapse.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelTabTree, type PanelTabSelection } from './PanelTabTree'
import type { PanelTabGroup, CrossPanelId, LivePanelTab } from '../panelTabs'

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

describe('PanelTabTree right-click Pin/Unpin menu (cosmos-home-favorite-tabs-v1)', () => {
  beforeEach(() => {
    // Radix Menu touches these jsdom-missing APIs.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never
    Element.prototype.setPointerCapture = vi.fn() as never
    Element.prototype.releasePointerCapture = vi.fn() as never
  })

  function renderWithMenu(opts?: { pinned?: ReadonlySet<string> }): {
    onPin: ReturnType<typeof vi.fn<(g: PanelTabGroup, t: LivePanelTab) => void>>
    onUnpin: ReturnType<typeof vi.fn<(g: PanelTabGroup, t: LivePanelTab) => void>>
  } {
    const onPin = vi.fn<(g: PanelTabGroup, t: LivePanelTab) => void>()
    const onUnpin = vi.fn<(g: PanelTabGroup, t: LivePanelTab) => void>()
    const pinned = opts?.pinned ?? new Set<string>()
    render(
      <TooltipProvider>
        <PanelTabTree
          groups={groups}
          selected={null}
          onActivate={() => {}}
          isPinned={(panelId: CrossPanelId, tabId: string) => pinned.has(`${panelId}:${tabId}`)}
          onPin={onPin}
          onUnpin={onUnpin}
        />
      </TooltipProvider>
    )
    return { onPin, onUnpin }
  }

  function rightClick(label: string): void {
    // The level-2 TAB row (not the level-1 group header — both can carry "Terminal").
    const row = within(screen.getByRole('tree'))
      .getAllByRole('treeitem')
      .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes(label))!
    fireEvent.contextMenu(row, { clientX: 5, clientY: 5 })
  }

  it('an unpinned generative row offers Pin → fires onPin (FR-001/FR-002)', async () => {
    const { onPin } = renderWithMenu()
    rightClick('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onPin).toHaveBeenCalledWith(groups[1], { id: 'j1', label: 'Sprint board' })
  })

  it('a pinned generative row offers Unpin → fires onUnpin (FR-002/FR-004)', async () => {
    const { onUnpin } = renderWithMenu({ pinned: new Set(['jira:j1']) })
    rightClick('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Unpin/ }))
    expect(onUnpin).toHaveBeenCalledTimes(1)
  })

  it("a terminal row's Pin is DISABLED with a discoverable reason (FR-040)", async () => {
    renderWithMenu()
    rightClick('Terminal')
    const pin = await screen.findByRole('menuitem', { name: /Pin/ })
    expect(pin).toHaveAttribute('data-disabled')
    expect(screen.getByText(/Terminal tabs can't be pinned/)).toBeInTheDocument()
  })
})
