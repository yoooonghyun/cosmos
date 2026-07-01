/**
 * DOM test (jsdom) — TERM-RELOAD-SURVIVAL-01 (panel reconcile) for
 * cosmos-dev-wake-reload-session-survival-v1 (D4/FR-005/FR-011/OQ-2).
 *
 * After a reload main keeps the live PTY sessions alive; on mount `TerminalPanel` queries
 * `pty:listLive` and reconciles its rehydrated tabs against main's live set:
 *   - a hydrated tab that IS live is a SURVIVOR → it autoStarts and reattaches (main's idempotent
 *     `pty:start`), NOT respawns;
 *   - a live paneId with NO hydrated tab (minted after the debounced snapshot) is ADOPTED as a new
 *     tab so its surviving session is never orphaned (FR-011);
 *   - a hydrated tab that is NOT live resumes via the existing autoStart path (regression guard).
 *
 * Heavy deps (xterm, the Monaco fileExplorer barrel, the tab strip / footer chrome, the shortcut hook,
 * the panelTabs/session publish hooks) are mocked — the behavior under test is the panel's mount-time
 * reconcile + per-tab autoStart, observed through `window.cosmos.pty.start` / the rendered tab count.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('@xterm/xterm', () => {
  class Terminal {
    textarea: HTMLTextAreaElement | null = null
    cols = 80
    rows = 24
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    focus(): void {}
    dispose(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    attachCustomKeyEventHandler(): void {}
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/addon-serialize', () => ({ SerializeAddon: class { serialize(): string { return '' } } }))
vi.mock('../fileExplorer', () => ({
  useExplorerPanes: () => ({
    viewer: null,
    tree: null,
    openFileCount: 0,
    closeActiveFile: () => {},
    navFileTab: () => {}
  }),
  ResizeDivider: () => null
}))
// The tab strip renders each tab's label so the rendered tab set is assertable; footer + shortcut
// hook + publish hooks are inert.
vi.mock('../tabs/PanelTabStrip', () => ({
  PanelTabStrip: ({ tabs }: { tabs: Array<{ id: string; label: string }> }) => (
    <div data-testid="strip">{tabs.map((t) => (
      <span key={t.id} data-tab-id={t.id}>{t.label}</span>
    ))}</div>
  )
}))
vi.mock('../app/PanelFooter', () => ({ PanelFooter: () => null }))
vi.mock('../tabs/useTabShortcuts', () => ({ useTabShortcuts: () => {} }))
vi.mock('../panelTabs', () => ({
  usePublishPanelTabs: () => {},
  usePublishTabCommands: () => {}
}))

// The restored terminal snapshot (one survivor tab, pane-A) + a noop report.
const restored: { tabs: Array<{ id: string; label: string }>; activeTabId: string; everOpened: number } = {
  tabs: [{ id: 'pane-A', label: 'Terminal 1' }],
  activeTabId: 'pane-A',
  everOpened: 1
}
vi.mock('../session/SessionProvider', () => ({
  useRestoredTerminalPanel: () => restored,
  useReportPanel: () => () => {},
  // terminal-tab-delete-persists-restart-v1: TerminalPanel now calls useSessionRegistry()
  // for the close-flush effect. No tabs are closed in these tests so flush() is never
  // invoked, but the call itself must not throw (undefined is not a function).
  useSessionRegistry: () => ({ flush: vi.fn() })
}))

import { TerminalPanel } from './TerminalPanel'

let startSpy: ReturnType<typeof vi.fn>
let listLiveResult: { paneIds: string[] }

beforeEach(() => {
  startSpy = vi.fn()
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        start: startSpy,
        dispose: vi.fn(),
        restart: vi.fn(),
        resize: vi.fn(),
        sendInput: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
        listLive: () => Promise.resolve(listLiveResult)
      }
    }
  })
})

describe('TerminalPanel reload reconcile (TERM-RELOAD-SURVIVAL-01, D4/FR-011/OQ-2)', () => {
  it('reattaches the survivor tab AND adopts a live pane missing from the snapshot', async () => {
    // main reports two live sessions: pane-A (the survivor, has a hydrated tab) and pane-B (minted
    // after the last snapshot, so it has NO hydrated tab).
    listLiveResult = { paneIds: ['pane-A', 'pane-B'] }
    const { container } = render(<TerminalPanel active />)

    // The survivor reattaches immediately (its restored tab autoStarts → idempotent pty:start).
    expect(startSpy).toHaveBeenCalledWith('pane-A')

    // After the async listLive resolves, pane-B is ADOPTED as a new tab and its view reattaches too.
    await waitFor(() => {
      expect(container.querySelector('[data-tab-id="pane-B"]')).not.toBeNull()
    })
    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith('pane-B')
    })
    // No respawn-over-a-survivor: pane-A started exactly once (reattach, not a duplicate spawn).
    expect(startSpy.mock.calls.filter(([id]) => id === 'pane-A')).toHaveLength(1)
  })

  it('a restored tab that is NOT live still resumes via autoStart (no adoption, regression guard)', async () => {
    // main reports NO live sessions (first launch after a real quit): pane-A is restored-but-dead.
    listLiveResult = { paneIds: [] }
    const { container } = render(<TerminalPanel active />)

    // The restored tab still autoStarts (resume / exit-banner path) — main will spawn since it is dead.
    expect(startSpy).toHaveBeenCalledWith('pane-A')

    // No extra tab is adopted (nothing live to adopt).
    await waitFor(() => {
      expect(container.querySelectorAll('[data-tab-id]')).toHaveLength(1)
    })
    expect(container.querySelector('[data-tab-id="pane-A"]')).not.toBeNull()
  })
})
