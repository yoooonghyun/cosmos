/**
 * DOM test (jsdom) — TERM-RELOAD-SURVIVAL-01 (cosmos-dev-wake-reload-session-survival-v1, D4/C1).
 *
 * THE LOAD-BEARING DEV-SURVIVAL GUARD: `TerminalView`'s unmount cleanup disposes (kills) its PTY ONLY
 * on a GENUINE tab close (the panel marked the paneId as closing), NEVER on a plain unmount — React
 * StrictMode's mount→cleanup→remount double-invoke, a rail switch, or a renderer reload. Without this
 * guard the reload's fresh mount would mount→cleanup(dispose→kill)→remount and kill the very survivor
 * that main now keeps alive on reload (the whole point of the feature). A real close still disposes.
 *
 * Mirrors the TerminalViewMirror.dom.test.tsx harness: xterm + addons + the Monaco-backed fileExplorer
 * barrel are mocked (the behavior under test is the pty-lifecycle GATING in the mount/cleanup effect,
 * not xterm rendering).
 */
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'

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

import { TerminalView } from './TerminalPanel'

const noop = (): void => {}
const noopRegister = (): (() => void) => () => {}

type PtySpies = {
  start: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  restart: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  sendInput: ReturnType<typeof vi.fn>
}
let pty: PtySpies

beforeEach(() => {
  pty = {
    start: vi.fn(),
    dispose: vi.fn(),
    restart: vi.fn(),
    resize: vi.fn(),
    sendInput: vi.fn()
  }
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      pty: {
        ...pty,
        onData: () => () => {},
        onExit: () => () => {}
      }
    }
  })
})

describe('TerminalView dispose guard — reload/StrictMode survival (TERM-RELOAD-SURVIVAL-01)', () => {
  it('a PLAIN unmount (isClosing → false: reload / rail switch) does NOT dispose the PTY', () => {
    const { unmount } = render(
      <TerminalView
        paneId="pane-1"
        active
        autoStart
        isClosing={() => false}
        onOpenFilesChange={noop}
        onViewerStateChange={noop}
        registerSerializer={noopRegister}
      />
    )
    // Mount reattaches (idempotent start in main).
    expect(pty.start).toHaveBeenCalledWith('pane-1')
    unmount()
    // The survivor is NOT disposed — it stays alive for the fresh mount to reattach.
    expect(pty.dispose).not.toHaveBeenCalled()
  })

  it('a GENUINE close (isClosing → true) DOES dispose the PTY', () => {
    let closing = false
    const { unmount } = render(
      <TerminalView
        paneId="pane-1"
        active
        autoStart
        isClosing={() => closing}
        onOpenFilesChange={noop}
        onViewerStateChange={noop}
        registerSerializer={noopRegister}
      />
    )
    // The panel marks the paneId intentionally-closing just before removing the tab.
    closing = true
    unmount()
    expect(pty.dispose).toHaveBeenCalledWith('pane-1')
  })

  it('a StrictMode mount→cleanup→remount does NOT dispose (the survivor persists across the double-invoke)', () => {
    // StrictMode double-invokes the mount effect: mount → cleanup → mount. With isClosing→false the
    // intermediate cleanup must NOT dispose, so the PTY survives; the remount reattaches (idempotent).
    const { unmount } = render(
      <StrictMode>
        <TerminalView
          paneId="pane-1"
          active
          autoStart
          isClosing={() => false}
          onOpenFilesChange={noop}
          onViewerStateChange={noop}
          registerSerializer={noopRegister}
        />
      </StrictMode>
    )
    // Despite the StrictMode double mount/cleanup, no dispose ran (the guard held).
    expect(pty.dispose).not.toHaveBeenCalled()
    expect(pty.start).toHaveBeenCalledWith('pane-1')
    // A subsequent plain unmount (still not an intentional close) also does not dispose.
    unmount()
    expect(pty.dispose).not.toHaveBeenCalled()
  })

  it('with NO isClosing prop (standalone render) the legacy dispose-on-unmount still applies', () => {
    // Backward-compat: a caller that does not opt into the guard keeps the old behavior.
    const { unmount } = render(
      <TerminalView
        paneId="pane-1"
        active
        autoStart
        onOpenFilesChange={noop}
        onViewerStateChange={noop}
        registerSerializer={noopRegister}
      />
    )
    unmount()
    expect(pty.dispose).toHaveBeenCalledWith('pane-1')
  })
})
