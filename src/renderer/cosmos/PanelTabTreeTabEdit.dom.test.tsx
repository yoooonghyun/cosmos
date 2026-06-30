/**
 * DOM test (jsdom) for the PanelTabTree row Rename + Delete affordances
 * (cosmos-tree-tab-rename-delete-v1, FR-001/FR-005/FR-006/FR-007/FR-011). Scenario TREE-TAB-EDIT-01
 * (tree layer): the row ContextMenu shows Pin/Unpin → separator → Rename → Delete; Rename inline-
 * edits a row and routes the TRIMMED label to the source panel's command (empty/whitespace + Escape
 * → no call); Delete fires the source close immediately; a terminal row carries both; a tab that
 * vanishes mid-rename is safe. Renderer-only — no IPC.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelTabTree } from './PanelTabTree'
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

type Spy<T extends (...args: never[]) => void> = ReturnType<typeof vi.fn<T>>

function renderEditable(opts?: { groups?: PanelTabGroup[] }): {
  onRenameTab: Spy<(g: PanelTabGroup, t: LivePanelTab, label: string) => void>
  onDeleteTab: Spy<(g: PanelTabGroup, t: LivePanelTab) => void>
  rerender: (g: PanelTabGroup[]) => void
} {
  const onRenameTab = vi.fn<(g: PanelTabGroup, t: LivePanelTab, label: string) => void>()
  const onDeleteTab = vi.fn<(g: PanelTabGroup, t: LivePanelTab) => void>()
  const tree = (g: PanelTabGroup[]): React.JSX.Element => (
    <TooltipProvider>
      <PanelTabTree
        groups={g}
        selected={null}
        onActivate={() => {}}
        isPinned={() => false}
        onPin={() => {}}
        onUnpin={() => {}}
        canEditTab={(panelId: CrossPanelId) => panelId === 'jira' || panelId === 'terminal'}
        onRenameTab={onRenameTab}
        onDeleteTab={onDeleteTab}
      />
    </TooltipProvider>
  )
  const view = render(tree(opts?.groups ?? groups))
  return { onRenameTab, onDeleteTab, rerender: (g) => view.rerender(tree(g)) }
}

function tabRow(label: string): HTMLElement {
  return within(screen.getByRole('tree'))
    .getAllByRole('treeitem')
    .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes(label))!
}

function rightClick(label: string): void {
  fireEvent.contextMenu(tabRow(label), { clientX: 5, clientY: 5 })
}

describe('PanelTabTree Rename + Delete (TREE-TAB-EDIT-01)', () => {
  beforeEach(() => {
    // Radix Menu touches these jsdom-missing APIs.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never
    Element.prototype.setPointerCapture = vi.fn() as never
    Element.prototype.releasePointerCapture = vi.fn() as never
  })

  it('a row menu offers Pin + a separator + Rename + Delete (FR-001/FR-012)', async () => {
    renderEditable()
    rightClick('Sprint board')
    expect(await screen.findByRole('menuitem', { name: /Pin/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    // The Rename/Delete pair sits behind a separator from the Pin/Unpin toggle.
    const menu = screen.getByRole('menu')
    expect(menu.querySelector('[data-slot="context-menu-separator"]')).toBeInTheDocument()
    // Delete is benign (default variant), NOT destructive.
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'default'
    )
  })

  it('Rename → inline edit; type + Enter routes the TRIMMED label to the source (FR-006)', async () => {
    const { onRenameTab } = renderEditable()
    rightClick('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByRole('textbox', { name: 'Rename Sprint board' })
    fireEvent.change(input, { target: { value: '  Renamed board  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameTab).toHaveBeenCalledTimes(1)
    expect(onRenameTab).toHaveBeenCalledWith(groups[1], { id: 'j1', label: 'Sprint board' }, 'Renamed board')
  })

  it('an empty/whitespace commit reverts silently — no rename (FR-006)', async () => {
    const { onRenameTab } = renderEditable()
    rightClick('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByRole('textbox', { name: 'Rename Sprint board' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameTab).not.toHaveBeenCalled()
  })

  it('Escape cancels the edit — no rename (FR-006)', async () => {
    const { onRenameTab } = renderEditable()
    rightClick('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByRole('textbox', { name: 'Rename Sprint board' })
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRenameTab).not.toHaveBeenCalled()
    // The input is gone (back to the label span).
    expect(screen.queryByRole('textbox', { name: 'Rename Sprint board' })).not.toBeInTheDocument()
  })

  it('Delete fires the source close immediately with the right group/tab (FR-005/FR-008)', async () => {
    const { onDeleteTab } = renderEditable()
    rightClick('PROJ-9')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(onDeleteTab).toHaveBeenCalledTimes(1)
    expect(onDeleteTab).toHaveBeenCalledWith(groups[1], { id: 'j2', label: 'PROJ-9' })
  })

  it('a TERMINAL row offers both Rename and Delete (P2)', async () => {
    renderEditable()
    rightClick('Terminal')
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('F2 on a focused tab row begins inline rename (keyboard parity)', () => {
    const { onRenameTab } = renderEditable()
    const tree = screen.getByRole('tree')
    // First visible row is the Terminal group header → ArrowDown to its tab row, F2 to rename.
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    fireEvent.keyDown(tree, { key: 'F2' })
    const input = screen.getByRole('textbox', { name: 'Rename Terminal' })
    fireEvent.change(input, { target: { value: 'shell' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameTab).toHaveBeenCalledWith(groups[0], { id: 't1', label: 'Terminal' }, 'shell')
  })

  it('a tab that VANISHES mid-rename ends the edit with no throw, no call (FR-007/FR-011)', async () => {
    const { onRenameTab, rerender } = renderEditable()
    rightClick('PROJ-9')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await screen.findByRole('textbox', { name: 'Rename PROJ-9' })
    // The source closes the tab elsewhere → the row vanishes from the tree.
    rerender([
      { panelId: 'terminal', label: 'Terminal', tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' },
      { panelId: 'jira', label: 'Jira', tabs: [{ id: 'j1', label: 'Sprint board' }], activeTabId: 'j1' }
    ])
    expect(screen.queryByRole('textbox', { name: 'Rename PROJ-9' })).not.toBeInTheDocument()
    expect(onRenameTab).not.toHaveBeenCalled()
  })

  it('a panel WITHOUT edit commands shows only Pin/Unpin (FR-011 degrade)', async () => {
    render(
      <TooltipProvider>
        <PanelTabTree
          groups={[{ panelId: 'slack', label: 'Slack', tabs: [{ id: 's1', label: 'general' }], activeTabId: 's1' }]}
          selected={null}
          onActivate={() => {}}
          isPinned={() => false}
          onPin={() => {}}
          onUnpin={() => {}}
          canEditTab={() => false}
          onRenameTab={() => {}}
          onDeleteTab={() => {}}
        />
      </TooltipProvider>
    )
    rightClick('general')
    expect(await screen.findByRole('menuitem', { name: /Pin/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
