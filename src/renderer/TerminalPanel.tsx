/**
 * TerminalPanel — cosmos PoC milestone 1.
 *
 * Renders the live `claude` TUI using xterm.js bound to the PTY IPC channels.
 *
 * Spec trace:
 *   FR-003 render streamed output in an xterm.js instance
 *   FR-004 forward keyboard input to the PTY
 *   FR-005 propagate resize (cols, rows), debounced (edge case: SHOULD coalesce)
 *   FR-007 show an exit indication rather than freezing
 *   FR-008 offer a restart control
 *   Edge case: `claude` not found -> show the error in the panel, no crash
 */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { PtyExitPayload } from '../shared/ipc'
import './TerminalPanel.css'

type ExitState = { kind: 'running' } | { kind: 'exited'; payload: PtyExitPayload }

function formatExit(payload: PtyExitPayload): string {
  if (payload.error) {
    return payload.error
  }
  const parts: string[] = []
  if (typeof payload.exitCode === 'number') {
    parts.push(`exit code ${payload.exitCode}`)
  }
  if (typeof payload.signal === 'number') {
    parts.push(`signal ${payload.signal}`)
  }
  return parts.length > 0
    ? `claude exited (${parts.join(', ')})`
    : 'claude exited'
}

export function TerminalPanel(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [exitState, setExitState] = useState<ExitState>({ kind: 'running' })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'Menlo, Monaco, "SF Mono", "Courier New", monospace',
      fontSize: 13,
      theme: { background: '#1e1e1e', foreground: '#e0e0e0' },
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    const safeFit = (): void => {
      try {
        fitAddon.fit()
      } catch {
        // Container not measurable yet; ignore.
      }
    }
    safeFit()

    // FR-002/FR-003: render streamed PTY output.
    const offData = window.cosmos.pty.onData(({ data }) => {
      term.write(data)
    })

    // FR-007: surface exit state instead of freezing silently.
    const offExit = window.cosmos.pty.onExit((payload) => {
      setExitState({ kind: 'exited', payload })
    })

    // FR-004: forward keyboard input to the PTY.
    const inputDisposable = term.onData((data) => {
      window.cosmos.pty.sendInput({ data })
    })

    // FR-005: propagate resize, debounced to avoid flooding the PTY.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const pushResize = (): void => {
      safeFit()
      window.cosmos.pty.resize({ cols: term.cols, rows: term.rows })
    }
    const onWindowResize = (): void => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(pushResize, 75)
    }
    window.addEventListener('resize', onWindowResize)

    // Observe the container directly (covers layout changes, not just window).
    const resizeObserver = new ResizeObserver(onWindowResize)
    resizeObserver.observe(container)

    // Send the initial size once the terminal has measured itself.
    pushResize()
    term.focus()

    return () => {
      offData()
      offExit()
      inputDisposable.dispose()
      window.removeEventListener('resize', onWindowResize)
      resizeObserver.disconnect()
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      term.dispose()
    }
  }, [])

  const handleRestart = (): void => {
    // FR-008: request a fresh session; clear the exit banner.
    window.cosmos.pty.restart()
    setExitState({ kind: 'running' })
  }

  return (
    <div className="terminal-panel">
      {exitState.kind === 'exited' && (
        <div className="terminal-panel__exit" role="status">
          <span className="terminal-panel__exit-msg">
            {formatExit(exitState.payload)}
          </span>
          <button
            type="button"
            className="terminal-panel__restart"
            onClick={handleRestart}
          >
            Restart claude
          </button>
        </div>
      )}
      <div ref={containerRef} className="terminal-panel__xterm" />
    </div>
  )
}
