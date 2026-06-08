/**
 * TerminalPanel — multiple live terminal tabs (panel-tabs v1, Track B / Phase 5).
 *
 * Each tab is a DISTINCT PTY session (its own live `claude` process), keyed by a
 * renderer-minted `paneId`. The panel hosts a `PanelTabStrip` above a stack of
 * `TerminalView`s — ONE xterm.js `Terminal` per tab, each with its own FitAddon and
 * `paneId`-scoped data/exit subscription and input/resize/restart/dispose. ALL views
 * stay mounted (only hidden when inactive) so each tab's live session + scrollback
 * survive both tab switches and rail switches (FR-025). There is always ≥1 terminal
 * (FR-024) — closing the last opens a fresh default. No composer, no native base.
 *
 * Spec trace (panel-tabs v1):
 *   FR-021 a terminal tab IS the xterm; its content is one live PTY session.
 *   FR-022 `+` spawns a new PTY session in a new tab (pty:start).
 *   FR-023 `X` disposes that tab's PTY (pty:dispose); others unaffected.
 *   FR-024 always ≥1 terminal; closing the last opens a fresh default.
 *   FR-025 each tab's live session + scrollback survive tab/rail switches (kept mounted).
 *   FR-026 per-tab restart (pty:restart scoped to that paneId).
 *
 * Carries forward terminal-panel-v1: FR-003 render output, FR-004 forward input,
 * FR-005 debounced resize, FR-007 exit indication, FR-008 restart control.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { SquareTerminal } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import type { PtyExitPayload } from '../shared/ipc'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { usePanelTabs } from './usePanelTabs'
import { useTabShortcuts } from './useTabShortcuts'
import { nextTerminalIndex, seedEverOpenedFrom, seedTerminalIndex, terminalLabel } from './panelTabs'
import { useReportPanel, useRestoredTerminalPanel } from './SessionProvider'
import { buildTerminalDraft, capScrollback, hydrateTerminalTabs } from './sessionSnapshot'
import './TerminalPanel.css'

type ExitState = { kind: 'running' } | { kind: 'exited'; payload: PtyExitPayload }

/** A terminal tab record: id is the paneId; label is "Terminal N". */
interface TerminalTab {
  id: string
  label: string
  /**
   * True once the user manually renamed this tab (tab-rename-v1 FR-007). Terminal
   * labels are static today (no runtime relabel), so this is forward-protection
   * (FR-009): the field exists so any future terminal-relabel path can respect it.
   */
  renamed?: boolean
}

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
  return parts.length > 0 ? `claude exited (${parts.join(', ')})` : 'claude exited'
}

/**
 * One terminal tab's view: a single xterm bound to its `paneId`. Mounted once and
 * kept mounted for the tab's lifetime (FR-025). `active` only toggles visibility +
 * triggers a re-fit/focus when it becomes visible (a hidden container can't measure).
 */
function TerminalView({
  paneId,
  active,
  initialScrollback,
  registerSerializer
}: {
  paneId: string
  active: boolean
  /** Restored scrollback to pre-write as on-screen history before pty:start (FR-021). */
  initialScrollback?: string
  /** Register this pane's scrollback serializer with the panel; returns an unregister fn. */
  registerSerializer: (paneId: string, serialize: () => string) => () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [exitState, setExitState] = useState<ExitState>({ kind: 'running' })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
      fontSize: 13,
      theme: { background: '#1e1e1e', foreground: '#e0e0e0' },
      allowProposedApi: true
    })
    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(serializeAddon)
    term.open(container)
    termRef.current = term
    fitRef.current = fitAddon

    // session-persistence-v1 FR-021: pre-write the restored scrollback as on-screen
    // history BEFORE the live session attaches, so a resumed (or fresh-after-failed-
    // resume) tab shows what was there at quit. It is plain history — the live PTY's
    // own output follows it.
    if (initialScrollback) {
      term.write(initialScrollback)
    }

    // Register this pane's serializer so the panel can capture bounded scrollback on
    // demand (at report/teardown) rather than on every keystroke (FR-021/FR-007).
    const unregister = registerSerializer(paneId, () => capScrollback(serializeAddon.serialize()))

    const safeFit = (): void => {
      try {
        fitAddon.fit()
      } catch {
        // Container not measurable yet (e.g. tab hidden); ignore.
      }
    }
    safeFit()

    // FR-021/FR-025: render streamed output for THIS pane only.
    const offData = window.cosmos.pty.onData((payload) => {
      if (payload.paneId !== paneId) {
        return
      }
      term.write(payload.data)
    })

    // FR-007: surface this pane's exit instead of freezing.
    const offExit = window.cosmos.pty.onExit((payload) => {
      if (payload.paneId !== paneId) {
        return
      }
      setExitState({ kind: 'exited', payload })
    })

    // FR-004: forward keyboard input to THIS pane's PTY.
    const inputDisposable = term.onData((data) => {
      window.cosmos.pty.sendInput({ paneId, data })
    })

    // FR-005: propagate resize, debounced.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const pushResize = (): void => {
      safeFit()
      window.cosmos.pty.resize({ paneId, cols: term.cols, rows: term.rows })
    }
    const onWindowResize = (): void => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(pushResize, 75)
    }
    window.addEventListener('resize', onWindowResize)
    const resizeObserver = new ResizeObserver(onWindowResize)
    resizeObserver.observe(container)

    // FR-022: spawn THIS pane's PTY session now that subscriptions are wired.
    window.cosmos.pty.start(paneId)

    pushResize()

    return () => {
      offData()
      offExit()
      inputDisposable.dispose()
      unregister()
      window.removeEventListener('resize', onWindowResize)
      resizeObserver.disconnect()
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      // FR-023: dispose this pane's PTY when its tab unmounts (tab closed).
      window.cosmos.pty.dispose(paneId)
    }
    // paneId is stable for this view's lifetime; mount/unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When this tab becomes active it was just un-hidden — a hidden container can't
  // measure, so re-fit + focus now that it has real dimensions (FR-025: scrollback
  // is intact, we only re-fit the viewport).
  useEffect(() => {
    if (!active) {
      return
    }
    const id = requestAnimationFrame(() => {
      const term = termRef.current
      const fit = fitRef.current
      if (!term || !fit) {
        return
      }
      try {
        fit.fit()
      } catch {
        // ignore
      }
      window.cosmos.pty.resize({ paneId, cols: term.cols, rows: term.rows })
      term.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active, paneId])

  const handleRestart = (): void => {
    // FR-026: restart only THIS pane's session; clear the exit banner.
    window.cosmos.pty.restart(paneId)
    setExitState({ kind: 'running' })
  }

  return (
    // Inline `display` (not a Tailwind hidden util) so it beats the unlayered
    // `.terminal-panel { display: flex }` rule (CLAUDE.md gotcha). Kept mounted so
    // the live PTY + scrollback survive (FR-025).
    <div className="terminal-panel" style={{ display: active ? 'flex' : 'none' }}>
      {exitState.kind === 'exited' && (
        <div className="terminal-panel__exit" role="status">
          <span className="terminal-panel__exit-msg">{formatExit(exitState.payload)}</span>
          <button type="button" className="terminal-panel__restart" onClick={handleRestart}>
            Restart claude
          </button>
        </div>
      )}
      <div ref={containerRef} className="terminal-panel__xterm" />
    </div>
  )
}

export function TerminalPanel({ active }: { active: boolean }): React.JSX.Element {
  // session-persistence-v1: the restored terminal slice (or undefined for a clean
  // session). Read once; the lazy initializers below seed from it.
  const restored = useRestoredTerminalPanel()
  const report = useReportPanel()

  // Restored scrollback by paneId, so each TerminalView pre-writes its history. Read
  // once into a ref; consumed by render and never re-seeded (a re-render must not
  // re-write history into a live terminal).
  const restoredScrollbackRef = useRef<Map<string, string>>(
    new Map((restored?.tabs ?? []).flatMap((t) => (t.scrollback ? [[t.id, t.scrollback] as const] : [])))
  )

  // Each pane's scrollback serializer, registered by its TerminalView on mount. Read
  // at report/teardown to capture bounded scrollback on demand (not per keystroke).
  const serializersRef = useRef<Map<string, () => string>>(new Map())
  const registerSerializer = useCallback((paneId: string, serialize: () => string) => {
    serializersRef.current.set(paneId, serialize)
    return () => {
      serializersRef.current.delete(paneId)
    }
  }, [])

  // FR-024: always ≥1 terminal. Seed from the restored snapshot, else one default tab.
  // The counter starts AT the seed index — the seed must NOT advance it (StrictMode
  // double-invokes a `useState`/`useRef` initializer; a ref mutation there would skip
  // the first `+`, terminal-tab-index-skip-v1). seedEverOpenedFrom is PURE.
  const everOpened = useRef(
    restored
      ? seedEverOpenedFrom(restored.everOpened, restored.tabs.length)
      : seedTerminalIndex()
  )
  const mintTab = (): TerminalTab => {
    const index = nextTerminalIndex(everOpened.current)
    everOpened.current = index
    return { id: crypto.randomUUID(), label: terminalLabel(index) }
  }
  // Lazy initial state — PURE: hydrate the restored tabs, or derive the single seed
  // tab's label directly from its index. No `mintTab()`, no ref mutation, so a
  // StrictMode double-invoke is idempotent. A restored zero-tab/absent panel falls
  // back to the default tab (FR-011/FR-024).
  const [initial] = useState(() => {
    const hydrated = hydrateTerminalTabs(restored)
    if (hydrated.tabs.length > 0) {
      return hydrated
    }
    const first: TerminalTab = {
      id: crypto.randomUUID(),
      label: terminalLabel(seedTerminalIndex())
    }
    return { tabs: [first], activeTabId: first.id }
  })
  const { tabs, activeTabId, open, close, setActive, update } = usePanelTabs<TerminalTab>(initial)

  // Report the terminal contribution on any tab-state change (FR-007). Scrollback is
  // captured lazily here via each pane's registered serializer; main enriches each
  // tab with its sessionId/cwd at the save boundary (D2).
  useEffect(() => {
    const scrollbackByPane = new Map<string, string>()
    for (const [paneId, serialize] of serializersRef.current) {
      try {
        scrollbackByPane.set(paneId, serialize())
      } catch {
        // a disposing terminal can throw mid-serialize; skip it
      }
    }
    report('terminal', buildTerminalDraft({ tabs, activeTabId }, everOpened.current, scrollbackByPane))
  }, [tabs, activeTabId, report])

  const handleNewTab = (): void => {
    // FR-022: mint a new pane + open a tab (its TerminalView issues pty:start).
    open(mintTab())
  }

  const handleClose = (tabId: string): void => {
    close(tabId)
  }

  // FR-024: if the collection ever empties (closed the last terminal), open a fresh
  // default so the panel is never a "zero terminals" empty state.
  useEffect(() => {
    if (tabs.length === 0) {
      open(mintTab())
    }
    // mintTab/open are stable enough for this guard; only react to count reaching 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

  const stripTabs: PanelTab[] = useMemo(
    () => tabs.map((t) => ({ id: t.id, label: t.label, kind: 'terminal' as const })),
    [tabs]
  )

  const activeStripTab = stripTabs.find((t) => t.id === activeTabId) ?? null

  // Tab keyboard shortcuts act on THIS strip only while the Terminal surface is active.
  useTabShortcuts({
    active,
    tabs,
    activeTabId,
    onActivate: setActive,
    onNewTab: handleNewTab,
    onCloseTab: handleClose
  })

  return (
    <section
      className="flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label="Terminal"
    >
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={activeTabId}
        onActivate={setActive}
        onClose={handleClose}
        onNewTab={handleNewTab}
        onRename={(id, label) => update(id, { label, renamed: true })}
        ariaLabel="Terminal tabs"
      />
      {/* The terminal stack. Every view stays mounted; only the active one is shown
          (FR-025). Plain flex container so the active `.terminal-panel` fills it. */}
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label="Terminal session">
        {tabs.map((t) => (
          <TerminalView
            key={t.id}
            paneId={t.id}
            active={t.id === activeTabId}
            initialScrollback={restoredScrollbackRef.current.get(t.id)}
            registerSerializer={registerSerializer}
          />
        ))}
      </div>
      <PanelFooter surfaceName="Terminal" icon={SquareTerminal} activeTab={activeStripTab} />
    </section>
  )
}
