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
import { FolderOpen, Loader2, SquareTerminal } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import type { PtyExitPayload } from '../shared/ipc'
import { Button } from '@/components/ui/button'
import { useExplorerPanes, ResizeDivider, type RestoredOpenFiles } from './fileExplorer'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { usePanelTabs } from './usePanelTabs'
import { useTabShortcuts } from './useTabShortcuts'
import { resolveCloseTarget } from './closeTabRouting'
import { mapTerminalKey } from './terminalKeymap'
import {
  isFolderOpen,
  nextTerminalIndex,
  seedEverOpenedFrom,
  seedTerminalIndex,
  terminalLabel
} from './panelTabs'
import { useReportPanel, useRestoredTerminalPanel } from './SessionProvider'
import { buildTerminalDraft, capScrollback, hydrateTerminalTabs } from './sessionSnapshot'
import { terminalThemeFromTokens } from './terminalTheme'
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
  autoStart,
  initialScrollback,
  restoredOpenFiles,
  onOpenFilesChange,
  onViewerStateChange,
  registerSerializer
}: {
  paneId: string
  active: boolean
  /**
   * True for a RESTORED/resumed tab — it auto-spawns its PTY on mount and skips the
   * [Open] empty state (terminal-open-directory-picker-v1, OQ-2). False for a freshly
   * minted tab — it DEFERS the spawn and shows the [Open] affordance until the user
   * picks a directory (FR-001/FR-009).
   */
  autoStart: boolean
  /** Restored scrollback to pre-write as on-screen history before pty:start (FR-021). */
  initialScrollback?: string
  /**
   * The persisted open-files slice for this pane (persist-workdir-open-files-v1, FR-004);
   * the explorer seeds its open-files strip from it on go-live (content re-read from disk).
   */
  restoredOpenFiles?: RestoredOpenFiles
  /** Report this pane's open-files change to the panel so the session save captures it (FR-013). */
  onOpenFilesChange: (paneId: string, slice: RestoredOpenFiles) => void
  /**
   * terminal-focus-aware-close-tab-v1: report this pane's viewer-focus + open-file count +
   * close-active-file callback to the panel so the (active pane's) state can drive the focus-aware
   * `Ctrl/Cmd+W` routing. Only the ACTIVE pane's report is used by the panel (FR-012).
   */
  onViewerStateChange: (
    paneId: string,
    state: { viewerFocused: boolean; openFileCount: number; closeActiveFile: () => void }
  ) => void
  /** Register this pane's scrollback serializer with the panel; returns an unregister fn. */
  registerSerializer: (paneId: string, serialize: () => string) => () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // terminal-file-explorer-v1 3-pane: the LEFT terminal column's controlled flex-basis (px) and
  // the RIGHT tree-dock column's controlled flex-basis (px). null = the CSS default; a number is an
  // absolute px width set by a divider drag/keyboard, clamped to the §1.2 mins. The MIDDLE viewer
  // column takes the remaining width (flex: 1 1 0). Two dividers: terminal|viewer drives termWidth,
  // viewer|tree drives treeWidth. Both renderer-local, NOT persisted.
  const [termWidth, setTermWidth] = useState<number | null>(null)
  const [treeWidth, setTreeWidth] = useState<number | null>(null)
  const [exitState, setExitState] = useState<ExitState>({ kind: 'running' })
  // terminal-open-directory-picker-v1 FR-001: a fresh tab waits for a directory; a
  // restored/resumed tab is live immediately (autoStart). 'awaiting' renders the [Open]
  // empty state; 'live' shows the xterm.
  const [phase, setPhase] = useState<'awaiting' | 'live'>(autoStart ? 'live' : 'awaiting')
  // True while the native directory picker is open — disables the button (no double-open).
  const [pending, setPending] = useState(false)
  // OQ-3: a selection returned after the tab unmounted must NOT spawn. Cleared in the
  // mount-effect cleanup so a late `pickDirectory` resolution is ignored (no orphan spawn).
  const isMountedRef = useRef(true)
  // terminal-file-explorer-v1 §10.4: the live re-fit path, set by the mount effect so the
  // divider drag re-fits the xterm + pushes pty.resize when the terminal pane width changes
  // (same `safeFit()` + `pty.resize` path the window-resize observer uses).
  const pushResizeRef = useRef<() => void>(() => {})

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    // OQ-3 / StrictMode: (re)assert mounted at the START of every effect run. The cleanup
    // below flips this to false; React StrictMode (dev) mounts→cleans up→remounts, so
    // WITHOUT this reset the ref stays false after the dev double-invoke and a later
    // pickDirectory resolution is wrongly treated as "unmounted" — the spawn + the
    // pending-spinner clear are both skipped and [Open] spins "Opening…" forever
    // (bug terminal-picker-spinner-hang-v1). Resetting here keeps the guard honest.
    isMountedRef.current = true

    // Track the cosmos surface tokens so the terminal screen matches every other
    // `bg-card` panel (bug terminal-panel-tone-mismatch-v1). xterm can't consume a CSS
    // var, so read the computed `--card` / `--card-foreground` values once here. cosmos
    // forces `.dark` at startup with no runtime theme switch — see `terminalTheme.ts`.
    const rootStyle = getComputedStyle(document.documentElement)
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "SF Mono", "Courier New", monospace',
      fontSize: 13,
      theme: terminalThemeFromTokens((name) => rootStyle.getPropertyValue(name)),
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

    // macOS readline chords (Cmd/Option+Arrow line/word motion, Shift/Option+Enter soft
    // newline) that xterm doesn't translate. mapTerminalKey returns the bytes to send (we
    // suppress xterm's default by returning false), or null to let xterm handle the key
    // unchanged — so plain typing, Enter-submit, Ctrl-C and paste are untouched.
    term.attachCustomKeyEventHandler((e) => {
      // NB: pass explicit fields — spreading a DOM KeyboardEvent (`{...e}`) drops key/altKey/
      // metaKey/etc (they're prototype getters, not own enumerable props), which would make
      // mapTerminalKey see undefined for every field and intercept nothing.
      const seq = mapTerminalKey({
        key: e.key,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        type: e.type,
        isComposing: e.isComposing,
        keyCode: e.keyCode
      })
      if (seq === null) {
        return true
      }
      // seq === '' means "suppress xterm's default but send nothing" (used to block
      // the keypress-leak \r for Shift/Alt+Enter — see terminalKeymap.ts module doc).
      if (seq !== '') {
        window.cosmos.pty.sendInput({ paneId, data: seq })
      }
      return false
    })

    // FR-005: propagate resize, debounced.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const pushResize = (): void => {
      safeFit()
      window.cosmos.pty.resize({ paneId, cols: term.cols, rows: term.rows })
    }
    // Expose the immediate re-fit for the divider drag (§10.4) — un-debounced so the
    // terminal tracks the seam live.
    pushResizeRef.current = pushResize
    const onWindowResize = (): void => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(pushResize, 75)
    }
    window.addEventListener('resize', onWindowResize)
    const resizeObserver = new ResizeObserver(onWindowResize)
    resizeObserver.observe(container)

    // FR-022: spawn THIS pane's PTY session now that subscriptions are wired — BUT only
    // for a restored/resumed tab (autoStart). A freshly minted tab DEFERS the spawn until
    // the user picks a directory via the [Open] affordance (terminal-open-directory-picker
    // v1, FR-001/FR-009); the subscriptions above are wired and ready for when it spawns.
    if (autoStart) {
      window.cosmos.pty.start(paneId)
    }

    pushResize()

    return () => {
      // OQ-3: mark unmounted so a directory selection returned after tab close is ignored.
      isMountedRef.current = false
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
    // paneId/autoStart are stable for this view's lifetime; mount/unmount only.
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

  // terminal-open-directory-picker-v1 FR-002/FR-004/FR-006: open the native picker;
  // on a chosen directory spawn `claude` there and go live; on cancel stay awaiting,
  // no error. Guarded so a selection returned after the tab unmounted spawns nothing
  // (OQ-3). `pending` disables the button while the dialog is open (no double-open).
  const handleOpen = async (): Promise<void> => {
    setPending(true)
    try {
      const res = await window.cosmos.pty.pickDirectory()
      if (res.path && isMountedRef.current) {
        window.cosmos.pty.start(paneId, { cwd: res.path })
        setPhase('live')
      }
    } finally {
      if (isMountedRef.current) {
        setPending(false)
      }
    }
  }

  // terminal-file-explorer-v1 3-pane §1.2/§1.3: column minimums. Terminal ~20rem, tree dock 16rem
  // (as before), and the MIDDLE viewer must keep a sane minimum so it never collapses to nothing.
  const TERM_MIN = 320
  const TREE_MIN = 256
  const VIEWER_MIN = 240

  // Divider A (terminal | viewer): apply a signed px delta to the LEFT terminal width, clamped so
  // neither the terminal nor the remaining (viewer + tree) drops below its min. Re-fit the xterm
  // (§10.4) on the next frame — this divider changes the terminal's width so the re-fit is required.
  const handleTermResize = (deltaPx: number): void => {
    const row = rowRef.current
    if (!row) {
      return
    }
    const total = row.clientWidth
    const tree = treeWidth ?? total * 0.25
    const current = termWidth ?? total * 0.5
    const max = total - tree - VIEWER_MIN
    const next = Math.max(TERM_MIN, Math.min(max, current + deltaPx))
    setTermWidth(next)
    requestAnimationFrame(() => pushResizeRef.current())
  }

  // Divider B (viewer | tree): apply a signed px delta to the RIGHT tree-dock width. A POSITIVE drag
  // (rightward) shrinks the dock, so the delta is subtracted. Clamped so neither the dock nor the
  // viewer drops below its min. The terminal's width is unchanged by this divider, so a re-fit is not
  // strictly needed — but the viewer's width changes, so we still re-fit (cheap + idempotent) in case
  // the terminal column is layout-coupled.
  const handleTreeResize = (deltaPx: number): void => {
    const row = rowRef.current
    if (!row) {
      return
    }
    const total = row.clientWidth
    const term = termWidth ?? total * 0.5
    const current = treeWidth ?? total * 0.25
    const max = total - term - VIEWER_MIN
    const next = Math.max(TREE_MIN, Math.min(max, current - deltaPx))
    setTreeWidth(next)
    requestAnimationFrame(() => pushResizeRef.current())
  }

  const live = isFolderOpen(phase)
  // persist-workdir-open-files-v1 FR-013: a stable per-pane reporter so an open-files change flows
  // up to the panel (and into the debounced session save) without re-firing the explorer's effects.
  const reportOpenFiles = useCallback(
    (slice: RestoredOpenFiles) => onOpenFilesChange(paneId, slice),
    [onOpenFilesChange, paneId]
  )
  // terminal-focus-aware-close-tab-v1 (OQ-1): track whether THIS pane's file viewer holds focus
  // (focus-within), set by the viewer's onFocus/onBlur. Drives the focus-aware Ctrl/Cmd+W route.
  const [viewerFocused, setViewerFocused] = useState(false)
  // The MIDDLE viewer column + RIGHT tree dock, both backed by ONE explorer hook instance (a click
  // in the dock retargets the viewer). Hooks run unconditionally; while !live the hook is inert.
  // The restored open-files slice seeds the strip on go-live (FR-004).
  const { viewer, tree, openFileCount, closeActiveFile } = useExplorerPanes(
    paneId,
    live,
    restoredOpenFiles,
    reportOpenFiles,
    setViewerFocused
  )
  // terminal-focus-aware-close-tab-v1: report this pane's viewer-focus + open-file count + the
  // close-active-file callback up to the panel. The panel ignores all but the ACTIVE pane (FR-012);
  // when a pane goes inactive it reports `viewerFocused: false` so a stale focus never routes.
  useEffect(() => {
    onViewerStateChange(paneId, {
      viewerFocused: active && viewerFocused,
      openFileCount,
      closeActiveFile
    })
  }, [paneId, active, viewerFocused, openFileCount, closeActiveFile, onViewerStateChange])
  return (
    // terminal-file-explorer-v1 3-pane §1.1: the tab body is a horizontal flex ROW. BEFORE a folder
    // is opened we render ONLY the VS-Code-style WELCOME view (the [Open a folder] CTA) — no split,
    // no dividers, no tree dock. The 3-pane split (terminal LEFT | viewer MIDDLE | tree dock RIGHT)
    // appears ONLY once a folder is open (`live`). `.terminal-panel` is flex via CSS; force `row`
    // inline (beats the unlayered `.terminal-panel { display:flex }` column default, CLAUDE.md gotcha).
    // `@container/termtab` so the explorer gates narrow behavior on the tab's width, not the window.
    //
    // The xterm container is ALWAYS mounted (its mount effect attaches xterm to `containerRef` once,
    // FR-025) — while awaiting it is hidden behind the welcome view, never unmounted. So the welcome
    // view and the live split share this one row; only their visibility flips on `live`.
    <div
      ref={rowRef}
      className="terminal-panel @container/termtab"
      style={{ display: active ? 'flex' : 'none', flexDirection: 'row' }}
    >
      {/* Terminal column (LEFT): full width while awaiting (the welcome view fills it), then a
          controlled flex-basis once live (the §1.2 resize state). Never unmounted (FR-013). */}
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={live ? (termWidth !== null ? { flex: `0 0 ${termWidth}px` } : { flex: '0 0 45%' }) : { flex: '1 1 0%' }}
      >
        {!live ? (
          // VS-Code-style WELCOME view (FR-001/FR-009): the ONLY thing shown before a folder is open.
          // Reuses the #75 directory-picker [Open] flow (`handleOpen`) — no new IPC channel.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center select-none">
            <FolderOpen className="size-7 text-muted-foreground" aria-hidden="true" />
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-medium text-foreground">Open a folder to start</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Claude Code will run in the folder you choose, and its files appear beside the terminal.
              </p>
            </div>
            <Button variant="cosmos" size="sm" disabled={pending} onClick={() => void handleOpen()}>
              {pending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Opening…
                </>
              ) : (
                <>
                  <FolderOpen /> Open a folder
                </>
              )}
            </Button>
          </div>
        ) : (
          exitState.kind === 'exited' && (
            <div className="terminal-panel__exit" role="status">
              <span className="terminal-panel__exit-msg">{formatExit(exitState.payload)}</span>
              <button type="button" className="terminal-panel__restart" onClick={handleRestart}>
                Restart claude
              </button>
            </div>
          )
        )}
        {/* Kept mounted always; hidden while awaiting so the welcome view shows instead. */}
        <div
          ref={containerRef}
          className="terminal-panel__xterm"
          style={!live ? { display: 'none' } : undefined}
        />
      </div>

      {/* The 3-pane split chrome (dividers + viewer + tree dock) exists ONLY once a folder is open —
          before that the welcome view is the whole tab. */}
      {live ? (
        <>
          {/* §1.3 divider A (terminal | viewer). */}
          <ResizeDivider onResize={handleTermResize} ariaLabel="Resize terminal and file viewer" />

          {/* File viewer column (MIDDLE): takes the remaining width (flex 1 1 0). ponytail: the
              viewer column is ALWAYS reserved (never collapsed) — even with no file selected it shows
              a calm "Select a file" placeholder. Simpler than a collapse/expand animation and reads
              as intentional dark chrome; revisit only if users want the viewer hidden until first click. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-card">
            {viewer}
          </div>

          {/* §1.3 divider B (viewer | tree dock). */}
          <ResizeDivider onResize={handleTreeResize} ariaLabel="Resize file viewer and file tree" />

          {/* File tree dock (RIGHT): ALWAYS visible once live; controlled flex-basis (the resize
              state). The established panel divider line sits on its left edge. */}
          <div
            className="flex min-h-0 min-w-0 flex-col border-l border-border bg-card"
            style={treeWidth !== null ? { flex: `0 0 ${treeWidth}px` } : { flex: '0 0 18%' }}
          >
            {tree}
          </div>
        </>
      ) : null}
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

  // terminal-open-directory-picker-v1 OQ-2: the set of RESTORED tab ids. Captured once
  // from the snapshot. A view for one of these auto-spawns (resumes its persisted
  // session); a freshly minted tab (not in this set) defers to the [Open] picker.
  const restoredTabIdsRef = useRef<Set<string>>(new Set((restored?.tabs ?? []).map((t) => t.id)))

  // persist-workdir-open-files-v1 FR-004: each restored tab's persisted open-files slice, keyed by
  // paneId. Captured once; each TerminalView reads its slice to seed the explorer on go-live.
  const restoredOpenFilesRef = useRef<Map<string, RestoredOpenFiles>>(
    new Map(
      (restored?.tabs ?? []).flatMap((t) =>
        t.openFiles && t.openFiles.files.length > 0 ? [[t.id, t.openFiles] as const] : []
      )
    )
  )

  // persist-workdir-open-files-v1 FR-003: each pane's CURRENT open-files slice, kept live by the
  // per-pane reporter (`handleOpenFilesChange`) and read at draft-build time so the save persists
  // the latest set + active path. Held in a ref (not state) so an open-files change doesn't
  // re-render the whole panel; the reporter re-reports the terminal draft explicitly.
  const openFilesByPaneRef = useRef<Map<string, RestoredOpenFiles>>(new Map())

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

  // Build + report the terminal draft (FR-007; persist-workdir-open-files-v1 FR-003). Scrollback
  // is captured lazily via each pane's registered serializer; the per-pane open-files map supplies
  // each tab's persisted open-files slice. main enriches each tab with its sessionId/cwd at the
  // save boundary (D2). The live tab list/active id are passed in so this is stable across calls.
  const reportTerminal = useCallback(
    (tabState: { tabs: TerminalTab[]; activeTabId: string | null }) => {
      const scrollbackByPane = new Map<string, string>()
      for (const [paneId, serialize] of serializersRef.current) {
        try {
          scrollbackByPane.set(paneId, serialize())
        } catch {
          // a disposing terminal can throw mid-serialize; skip it
        }
      }
      report(
        'terminal',
        buildTerminalDraft(tabState, everOpened.current, scrollbackByPane, openFilesByPaneRef.current)
      )
    },
    [report]
  )

  // persist-workdir-open-files-v1 FR-013: a pane's open-files change updates the map and re-reports
  // the terminal draft so the debounced save captures the latest open-files state. A dropped/closed
  // empty slice is kept in the map as an empty entry (buildTerminalDraft omits an empty `openFiles`).
  const handleOpenFilesChange = useCallback(
    (paneId: string, slice: RestoredOpenFiles): void => {
      openFilesByPaneRef.current.set(paneId, slice)
      reportTerminal({ tabs, activeTabId })
    },
    [reportTerminal, tabs, activeTabId]
  )

  // Report the terminal contribution on any tab-state change (FR-007).
  useEffect(() => {
    reportTerminal({ tabs, activeTabId })
  }, [tabs, activeTabId, reportTerminal])

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

  // terminal-focus-aware-close-tab-v1: the ACTIVE pane's viewer-focus + open-file count + close-
  // active-file callback, lifted from its TerminalView. Held in a ref (not state) so a focus/open
  // change does not re-render the whole panel; the shortcut handler reads it at keystroke time.
  // Each pane reports here; only the entry matching `activeTabId` is consulted for routing (FR-012).
  const viewerStateByPaneRef = useRef<
    Map<string, { viewerFocused: boolean; openFileCount: number; closeActiveFile: () => void }>
  >(new Map())
  const handleViewerStateChange = useCallback(
    (paneId: string, state: { viewerFocused: boolean; openFileCount: number; closeActiveFile: () => void }): void => {
      viewerStateByPaneRef.current.set(paneId, state)
    },
    []
  )

  // Tab keyboard shortcuts act on THIS strip only while the Terminal surface is active. `tab:close`
  // is focus-aware (terminal-focus-aware-close-tab-v1): the active pane's lifted viewer state decides
  // whether Ctrl/Cmd+W closes the file tab or the panel tab. `resolveClose`/`onCloseFileTab` read the
  // active pane's report at call time so they always reflect the pane the user is looking at.
  useTabShortcuts({
    active,
    tabs,
    activeTabId,
    onActivate: setActive,
    onNewTab: handleNewTab,
    onCloseTab: handleClose,
    resolveClose: () => {
      const state = activeTabId ? viewerStateByPaneRef.current.get(activeTabId) : undefined
      return resolveCloseTarget({
        viewerFocused: state?.viewerFocused ?? false,
        openFileCount: state?.openFileCount ?? 0
      })
    },
    onCloseFileTab: () => {
      if (activeTabId) {
        viewerStateByPaneRef.current.get(activeTabId)?.closeActiveFile()
      }
    }
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
            autoStart={restoredTabIdsRef.current.has(t.id)}
            initialScrollback={restoredScrollbackRef.current.get(t.id)}
            restoredOpenFiles={restoredOpenFilesRef.current.get(t.id)}
            onOpenFilesChange={handleOpenFilesChange}
            onViewerStateChange={handleViewerStateChange}
            registerSerializer={registerSerializer}
          />
        ))}
      </div>
      <PanelFooter surfaceName="Terminal" icon={SquareTerminal} activeTab={activeStripTab} />
    </section>
  )
}
