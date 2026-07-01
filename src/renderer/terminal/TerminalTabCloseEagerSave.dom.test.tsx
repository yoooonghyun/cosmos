/**
 * DOM test (jsdom) — TERM-CLOSE-EAGER-SAVE-01 (terminal-tab-delete-persists-restart-v1).
 *
 * Closing a terminal tab must persist the deletion EAGERLY — `registry.flush()` is called
 * SYNCHRONOUSLY on close, WITHOUT waiting for the 600ms trailing debounce to fire. The save
 * that reaches `window.cosmos.session.save` must carry a terminal draft that OMITS the closed
 * tab, so a prompt quit immediately after close does not resurrect it on the next launch.
 *
 * Same failure class + fix pattern as favorites-lost-on-restart-v1 (whose eager save is
 * locked by `sessionRegistry.test.ts:124-161`). This test covers the TerminalPanel WIRING:
 * that `handleClose` sets `pendingCloseFlushRef.current` and the close-flush effect (declared
 * AFTER the report effect) calls `registry.flush()` once the post-close draft is in the
 * registry's contributions.
 *
 * RED-before-green reasoning:
 *   Without the close-flush effect (`pendingCloseFlushRef → registry.flush()`), closing a
 *   tab only sets the flag and schedules the 600ms trailing debounce via the report effect.
 *   `saveSpy` is never reached until `sched.run()` is called. The tests assert `saveSpy`
 *   fired WITHOUT `sched.run()` → RED against pre-fix code, GREEN with the close-flush
 *   effect.
 *
 * Negative guard: opening a new tab or switching active tabs does NOT call flush eagerly —
 * `pendingCloseFlushRef.current` is only set by `handleClose`, so those paths keep their
 * debounce. Confirmed by asserting `saveSpy` is not called before `sched.run()`.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SessionRegistry, type Scheduler, type SaveFn } from '../session/sessionRegistry'
import type { PanelKey } from '../session/sessionRegistry'
import type { TerminalPanelDraft } from '../session/sessionSnapshot'
import type { GenerativePanelSnapshot } from '../../shared/ipc'

// ---------------------------------------------------------------------------
// Heavy deps irrelevant to save-timing — mocked to keep the test focused
// ---------------------------------------------------------------------------

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
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize(): string {
      return ''
    }
  }
}))
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
vi.mock('../app/PanelFooter', () => ({ PanelFooter: () => null }))
vi.mock('../tabs/useTabShortcuts', () => ({ useTabShortcuts: () => {} }))
vi.mock('../panelTabs', () => ({
  usePublishPanelTabs: () => {},
  usePublishTabCommands: () => {}
}))

/**
 * Tab strip mock: exposes close + new-tab + activate buttons so tests can drive every
 * genuine-close entry point (the strip × button) as well as the non-close ops (open /
 * switch) that MUST keep their debounce.
 */
vi.mock('../tabs/PanelTabStrip', () => ({
  PanelTabStrip: ({
    tabs,
    activeTabId,
    onClose,
    onNewTab,
    onActivate
  }: {
    tabs: Array<{ id: string; label: string }>
    activeTabId: string | null
    onClose: (id: string) => void
    onNewTab: () => void
    onActivate: (id: string) => void
  }) => (
    <div data-testid="strip">
      {tabs.map((t) => (
        <span key={t.id}>
          <button
            role="tab"
            aria-selected={t.id === activeTabId}
            data-testid={`tab-${t.id}`}
            onClick={() => onActivate(t.id)}
          >
            {t.label}
          </button>
          <button data-testid={`close-${t.id}`} onClick={() => onClose(t.id)}>
            ×
          </button>
        </span>
      ))}
      <button data-testid="new-tab" onClick={onNewTab}>
        +
      </button>
    </div>
  )
}))

// ---------------------------------------------------------------------------
// Controllable scheduler — the 600ms debounce NEVER fires unless .run() is called.
// This is the key assertion seam: if flush() is not called eagerly, saveSpy is
// unreachable without sched.run(), making the positive tests RED pre-fix.
// ---------------------------------------------------------------------------

function makeScheduler(): Scheduler & { run: () => void } {
  let pending: (() => void) | null = null
  let handle = 0
  return {
    setTimeout(f): ReturnType<typeof setTimeout> {
      pending = f
      return ++handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(): void {
      pending = null
    },
    run(): void {
      const f = pending
      pending = null
      f?.()
    }
  }
}

// ---------------------------------------------------------------------------
// Two-tab restored snapshot — closing one leaves ≥1 (FR-024 guard), so the
// "always ≥1 terminal" auto-reopen path never fires and pollutes the save count.
// ---------------------------------------------------------------------------

const restoredTwoTabs = {
  tabs: [
    { id: 'pane-a', label: 'Terminal 1' },
    { id: 'pane-b', label: 'Terminal 2' }
  ],
  activeTabId: 'pane-a',
  everOpened: 2
}

// ---------------------------------------------------------------------------
// Mutable holder — mock closures capture `ctx` by reference; beforeEach writes
// `.registry` so each test gets a fresh registry + scheduler without re-importing.
// ---------------------------------------------------------------------------

const ctx: { registry: SessionRegistry | null } = { registry: null }

vi.mock('../session/SessionProvider', () => ({
  useRestoredTerminalPanel: () => restoredTwoTabs,
  // Forward panel reports into the real (controllable) registry so flush() assembles
  // the correct contribution — the post-close draft that omits the closed tab.
  useReportPanel:
    () =>
    (key: unknown, contribution: unknown): void => {
      ctx.registry?.report(
        key as PanelKey,
        contribution as TerminalPanelDraft & GenerativePanelSnapshot
      )
    },
  useSessionRegistry: () => ctx.registry!
}))

import { TerminalPanel } from './TerminalPanel'

let saveSpy: ReturnType<typeof vi.fn>
let sched: ReturnType<typeof makeScheduler>

beforeEach(() => {
  saveSpy = vi.fn()
  sched = makeScheduler()
  ctx.registry = new SessionRegistry(saveSpy as unknown as SaveFn, sched, 600)

  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        start: vi.fn(),
        dispose: vi.fn(),
        restart: vi.fn(),
        resize: vi.fn(),
        sendInput: vi.fn(),
        onData: () => () => {},
        onExit: () => () => {},
        listLive: () => Promise.resolve({ paneIds: [] })
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalPanel close-flush eager save (TERM-CLOSE-EAGER-SAVE-01 / terminal-tab-delete-persists-restart-v1)', () => {
  it('closing a tab calls registry.flush() IMMEDIATELY without advancing the debounce timer', () => {
    render(<TerminalPanel active />)

    // Sanity: both restored tabs rendered; no save has fired yet (all debounced on mount).
    expect(screen.getByTestId('tab-pane-a')).toBeInTheDocument()
    expect(screen.getByTestId('tab-pane-b')).toBeInTheDocument()
    expect(saveSpy).not.toHaveBeenCalled()

    // Close pane-b via the strip × — the same handleClose path as tree Delete and Ctrl/Cmd+W.
    // sched.run() is NOT called before or after; an eager flush must fire independently.
    act(() => {
      fireEvent.click(screen.getByTestId('close-pane-b'))
    })

    // EAGER save fired — the debounce timer was never advanced (sched.run() not called).
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('the eager-save snapshot OMITS the closed tab and retains the surviving tab', () => {
    render(<TerminalPanel active />)
    act(() => {
      fireEvent.click(screen.getByTestId('close-pane-b'))
    })

    const snap = saveSpy.mock.calls[0][0]
    const termTabIds: string[] = snap.panels.terminal.tabs.map((t: { id: string }) => t.id)
    // Closed tab must be absent — the pre-delete snapshot would still carry it (the bug).
    expect(termTabIds).not.toContain('pane-b')
    // Surviving tab must still be there.
    expect(termTabIds).toContain('pane-a')
  })

  it('opening a new tab does NOT trigger an eager flush (still debounced)', () => {
    render(<TerminalPanel active />)
    saveSpy.mockClear()

    // Open a new tab — only schedules a debounced save, never calls flush().
    act(() => {
      fireEvent.click(screen.getByTestId('new-tab'))
    })

    expect(saveSpy).not.toHaveBeenCalled()
    // Advancing the debounce DOES fire the save — confirming the debounce path is intact,
    // not that the save is broken.
    act(() => {
      sched.run()
    })
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('switching the active tab does NOT trigger an eager flush (still debounced)', () => {
    render(<TerminalPanel active />)
    saveSpy.mockClear()

    // Activate the other tab — only schedules a debounced save.
    act(() => {
      fireEvent.click(screen.getByTestId('tab-pane-b'))
    })

    expect(saveSpy).not.toHaveBeenCalled()
    act(() => {
      sched.run()
    })
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})
