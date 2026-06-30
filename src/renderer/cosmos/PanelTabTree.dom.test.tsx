/**
 * DOM test (jsdom) for the PanelTabTree (cosmos-panel-tab-list-v1, design §2 / D-15).
 * Scenario: PANEL-TABS-TREE-UI-01 — grouped rows, empty/all-empty states, the FileTree roving
 * keymap (Arrow/Enter activate), per-row states (context-selected aria-selected, active-source dot),
 * and group expand/collapse.
 */
import '@testing-library/jest-dom/vitest'
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelTabTree, renderRowMenu, type PanelTabSelection } from './PanelTabTree'
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

  it('two tabs with different iconIds render two DIFFERENT leaf glyphs (FR-010/SC-007)', () => {
    const { container } = render(
      <TooltipProvider>
        <PanelTabTree
          groups={[
            {
              panelId: 'jira',
              label: 'Jira',
              tabs: [
                { id: 'j1', label: 'One', iconId: 'rocket' },
                { id: 'j2', label: 'Two', iconId: 'telescope' }
              ],
              activeTabId: 'j1'
            }
          ]}
          selected={null}
          onActivate={() => {}}
        />
      </TooltipProvider>
    )
    expect(container.querySelector('.lucide-rocket')).toBeInTheDocument()
    expect(container.querySelector('.lucide-telescope')).toBeInTheDocument()
  })

  it('a tab with NO resolvable iconId falls back to AppWindow (FR-010)', () => {
    const { container } = render(
      <TooltipProvider>
        <PanelTabTree
          groups={[
            {
              panelId: 'jira',
              label: 'Jira',
              tabs: [
                { id: 'j1', label: 'No icon' }, // pre-feature: no iconId
                { id: 'j2', label: 'Bad icon', iconId: 'bogus' } // unknown id
              ],
              activeTabId: 'j1'
            }
          ]}
          selected={null}
          onActivate={() => {}}
        />
      </TooltipProvider>
    )
    // Both fall back to AppWindow (two app-window glyphs).
    expect(container.querySelectorAll('.lucide-app-window')).toHaveLength(2)
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

  it("a terminal row's Pin is ENABLED and fires onPin (cosmos-terminal-favorite-multiplex-v1 relaxed FR-040)", async () => {
    const { onPin } = renderWithMenu()
    rightClick('Terminal')
    const pin = await screen.findByRole('menuitem', { name: /Pin/ })
    expect(pin).not.toHaveAttribute('data-disabled')
    expect(screen.queryByText(/Terminal tabs can't be pinned/)).not.toBeInTheDocument()
    fireEvent.click(pin)
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onPin).toHaveBeenCalledWith(groups[0], { id: 't1', label: 'Terminal' })
  })

  it('marks an ALREADY-PINNED row with text-primary on the per-tab glyph (D-15/FR-011)', () => {
    // The pinned row carries a per-tab iconId (rocket); the tint must apply to THAT glyph.
    render(
      <TooltipProvider>
        <PanelTabTree
          groups={[
            {
              panelId: 'jira',
              label: 'Jira',
              tabs: [{ id: 'j1', label: 'Sprint board', iconId: 'rocket' }],
              activeTabId: 'j1'
            }
          ]}
          selected={null}
          onActivate={() => {}}
          isPinned={(p, t) => p === 'jira' && t === 'j1'}
          onPin={() => {}}
          onUnpin={() => {}}
        />
      </TooltipProvider>
    )
    const row = screen.getByText('Sprint board').closest('[role="treeitem"]')!
    const glyph = row.querySelector('.lucide-rocket')!
    expect(glyph).toBeInTheDocument()
    expect(glyph.getAttribute('class') ?? '').toContain('text-primary')
  })

  it('marks an ALREADY-PINNED row with text-primary icon + bold label; a non-pinned sibling stays default (D-15)', () => {
    // j1 is pinned, its sibling j2 is not (same `isPinned` signal the Pin/Unpin menu uses).
    renderWithMenu({ pinned: new Set(['jira:j1']) })

    const pinnedLabel = screen.getByText('Sprint board')
    const pinnedRow = pinnedLabel.closest('[role="treeitem"]')!
    const pinnedIcon = pinnedRow.querySelector('svg')!
    expect(pinnedIcon.getAttribute('class') ?? '').toContain('text-primary')
    expect(pinnedIcon.getAttribute('class') ?? '').not.toContain('text-muted-foreground')
    expect(pinnedLabel.className).toContain('font-medium')

    const plainLabel = screen.getByText('PROJ-9')
    const plainRow = plainLabel.closest('[role="treeitem"]')!
    const plainIcon = plainRow.querySelector('svg')!
    expect(plainIcon.getAttribute('class') ?? '').not.toContain('text-primary')
    expect(plainIcon.getAttribute('class') ?? '').toContain('text-muted-foreground')
    expect(plainLabel.className).not.toContain('font-medium')
  })
})

describe('PanelTabTree inline rename via the row menu (TREE-TAB-EDIT-01, cosmos-tree-rename-not-working-v1)', () => {
  beforeEach(() => {
    // Radix Menu touches these jsdom-missing APIs.
    Element.prototype.scrollIntoView = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never
    Element.prototype.setPointerCapture = vi.fn() as never
    Element.prototype.releasePointerCapture = vi.fn() as never
  })

  // THE LOAD-BEARING (deterministic) assertion. The runtime break is timing-only: when the menu
  // closes, Radix's `onCloseAutoFocus` restores focus to the row trigger AFTER the deferred
  // `beginEdit` has mounted + auto-focused the inline-rename input, blurring it → onBlur commits →
  // the editor closes before the user can type. jsdom runs that focus-restore in the REVERSE order
  // (synchronously on click, before the `setTimeout(0)` input mount), so a plain behavioral jsdom
  // test stays GREEN even when the runtime is broken — it cannot see the bug. So we assert the
  // SOURCE-OF-TRUTH fix directly: the row menu wires `onCloseAutoFocus` to preventDefault, which is
  // what stops Radix yanking focus off the input. RED before the fix (no such prop → calling it
  // throws / preventDefault never runs), GREEN after.
  it('wires onCloseAutoFocus to preventDefault so the menu close does NOT steal focus from the editor', () => {
    const menu = renderRowMenu({
      pinnable: true,
      pinned: false,
      onPin: () => {},
      onUnpin: () => {},
      canEdit: true,
      onRename: () => {},
      onDelete: () => {}
    }) as ReactElement<{ onCloseAutoFocus?: (e: Event) => void }>
    expect(typeof menu.props.onCloseAutoFocus).toBe('function')
    const preventDefault = vi.fn()
    menu.props.onCloseAutoFocus?.({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  // A behavioral guard over the WHOLE menu→edit→commit route: right-click a renamable row → click
  // Rename → the inline input opens (the editor did not flash-and-close), typing a new label + Enter
  // routes a TRIMMED commit to the source panel's onRename(tabId, label). (In jsdom this passes even
  // without the focus fix — see the deterministic wiring test above for the actual regression guard;
  // this documents + locks the end-to-end commit route.)
  it('opens the inline editor from the menu and a typed Enter routes a trimmed rename to onRename', async () => {
    const onRenameTab = vi.fn<(g: PanelTabGroup, t: LivePanelTab, label: string) => void>()
    render(
      <TooltipProvider>
        <PanelTabTree
          groups={groups}
          selected={null}
          onActivate={() => {}}
          canEditTab={() => true}
          onRenameTab={onRenameTab}
          onDeleteTab={() => {}}
        />
      </TooltipProvider>
    )
    const row = within(screen.getByRole('tree'))
      .getAllByRole('treeitem')
      .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes('Sprint board'))!
    fireEvent.contextMenu(row, { clientX: 5, clientY: 5 })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    // The defer is a macrotask; let it flush so the input mounts.
    await new Promise((r) => setTimeout(r, 0))
    const input = await screen.findByLabelText('Rename Sprint board')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '  Renamed board  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameTab).toHaveBeenCalledTimes(1)
    expect(onRenameTab).toHaveBeenCalledWith(groups[1], { id: 'j1', label: 'Sprint board' }, 'Renamed board')
  })

  // A blank/whitespace-only commit reverts (the pure renameCommitDecision gates it): no onRename.
  it('a blank commit reverts without calling onRename (revert path)', async () => {
    const onRenameTab = vi.fn<(g: PanelTabGroup, t: LivePanelTab, label: string) => void>()
    render(
      <TooltipProvider>
        <PanelTabTree
          groups={groups}
          selected={null}
          onActivate={() => {}}
          canEditTab={() => true}
          onRenameTab={onRenameTab}
          onDeleteTab={() => {}}
        />
      </TooltipProvider>
    )
    const row = within(screen.getByRole('tree'))
      .getAllByRole('treeitem')
      .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes('Sprint board'))!
    fireEvent.contextMenu(row, { clientX: 5, clientY: 5 })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    await new Promise((r) => setTimeout(r, 0))
    const input = await screen.findByLabelText('Rename Sprint board')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRenameTab).not.toHaveBeenCalled()
  })
})
