/**
 * DOM test (jsdom) for the PanelTabsProvider REVERSE command channel
 * (cosmos-tree-tab-rename-delete-v1, FR-002/FR-003). Scenario TREE-TAB-EDIT-01 (provider layer):
 * a panel's published `{ onRename, onClose }` reach a subscriber via `useAllTabCommands()`, clear
 * on the publisher's unmount, and a `null` panelId publishes nothing. Mirrors the forward seam's
 * PanelTabsProvider.dom.test (PANEL-TABS-PROVIDER-01) — renderer-only, no IPC.
 */
import '@testing-library/jest-dom/vitest'
import { useMemo } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  PanelTabsProvider,
  usePublishTabCommands,
  useAllTabCommands,
  type CrossPanelId,
  type TabCommands,
  type TabCommandsRegistry
} from './index'

function Publisher({
  panelId,
  commands
}: {
  panelId: CrossPanelId | null
  commands: TabCommands
}): null {
  usePublishTabCommands(
    panelId,
    useMemo(() => commands, [commands])
  )
  return null
}

let lastRegistry: TabCommandsRegistry = {}
function Consumer(): null {
  lastRegistry = useAllTabCommands()
  return null
}

describe('PanelTabsProvider reverse command channel (TREE-TAB-EDIT-01)', () => {
  it('a published panel exposes its onRename/onClose to the subscriber', () => {
    const onRename = vi.fn()
    const onClose = vi.fn()
    render(
      <PanelTabsProvider>
        <Publisher panelId="jira" commands={{ onRename, onClose }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(Object.keys(lastRegistry)).toEqual(['jira'])
    lastRegistry.jira?.onRename('j1', 'New name')
    lastRegistry.jira?.onClose('j1')
    expect(onRename).toHaveBeenCalledWith('j1', 'New name')
    expect(onClose).toHaveBeenCalledWith('j1')
  })

  it('the entry CLEARS when its publisher unmounts (FR-003)', () => {
    const commands: TabCommands = { onRename: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(
      <PanelTabsProvider>
        <Publisher panelId="slack" commands={commands} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(lastRegistry.slack).toBeTruthy()

    rerender(
      <PanelTabsProvider>
        <Consumer />
      </PanelTabsProvider>
    )
    // The unmount cleanup published null → absent/null (FR-003: treated as not registered).
    expect(lastRegistry.slack ?? null).toBeNull()
  })

  it('a NULL panelId publishes nothing (the cosmos wire target is excluded)', () => {
    render(
      <PanelTabsProvider>
        <Publisher panelId={null} commands={{ onRename: vi.fn(), onClose: vi.fn() }} />
        <Consumer />
      </PanelTabsProvider>
    )
    expect(Object.keys(lastRegistry)).toHaveLength(0)
  })
})
