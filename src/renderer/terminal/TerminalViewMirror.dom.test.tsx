/**
 * DOM test (jsdom) — TERM-MIRROR-NONOWNING-01 (cosmos-terminal-favorite-multiplex-v1, SC-004/FR-005).
 *
 * THE LOAD-BEARING GUARANTEE: a `mirror` (non-owning) TerminalView — a Home terminal favorite bound
 * to the SAME `paneId` as the source pane — NEVER drives the shared PTY's lifecycle. Mounting then
 * unmounting it MUST NOT call `pty.start`, `pty.dispose`, or `pty.restart` (a naive 2nd mount would
 * `pty.dispose` on every Home tab switch and kill the source terminal — the exact danger `mirror`
 * exists to prevent). The OWNING view (no `mirror`, `autoStart`) is the regression guard: it MUST
 * still `start` on mount and `dispose` on unmount.
 *
 * The heavy xterm + file-explorer/Monaco imports are mocked (Monaco crashes jsdom; the behavior under
 * test is the pty-lifecycle GATING in the mount/cleanup effect, not xterm's own rendering) — reuse-in-
 * place per the plan's steer, with the import mocked rather than extracting a separate xterm core.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'

// xterm + addons: construct + open + dispose are no-ops; `onData`/`textarea` shaped so the mount
// effect's wiring runs without a real terminal/canvas.
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

// The fileExplorer barrel re-exports the Monaco-backed viewer (crashes jsdom on import). Stub the two
// symbols TerminalView uses so importing TerminalPanel is safe under jsdom.
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

describe('mirror TerminalView is NON-OWNING (TERM-MIRROR-NONOWNING-01, SC-004/FR-005)', () => {
  it('mounting + unmounting a MIRROR never calls pty.start / dispose / restart', () => {
    const { unmount } = render(
      <TerminalView
        paneId="pane-1"
        mirror
        active
        autoStart={false}
        initialScrollback="hello world"
        onOpenFilesChange={noop}
        onViewerStateChange={noop}
        registerSerializer={noopRegister}
      />
    )
    expect(pty.start).not.toHaveBeenCalled()
    unmount()
    expect(pty.dispose).not.toHaveBeenCalled()
    expect(pty.restart).not.toHaveBeenCalled()
  })

  it('the OWNING view (no mirror, autoStart) DOES start on mount + dispose on unmount (regression guard)', () => {
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
    expect(pty.start).toHaveBeenCalledWith('pane-1')
    unmount()
    expect(pty.dispose).toHaveBeenCalledWith('pane-1')
  })
})
