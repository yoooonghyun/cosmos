/**
 * SessionProvider — restores the persisted snapshot once at startup and gives each
 * rail panel (a) its slice to seed initial tab state and (b) a `report` callback to
 * push its latest contribution to the debounced save coordinator (session-
 * persistence-v1, FR-001/FR-003/FR-007).
 *
 * App renders the provider; it performs the single `window.cosmos.session.load()`
 * read, holds `loading` until it resolves (App shows the restore spinner — D3), then
 * exposes the restored `SessionSnapshot | null` to the panels via context. A panel
 * reads `useRestoredPanel(key)` for its slice and calls `useReportPanel()` to report
 * changes. A flush-on-teardown (pagehide/beforeunload) forces a final save so the
 * latest state survives a quit.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EnabledIntegrations,
  GateableIntegration,
  GenerativePanelKey,
  GenerativePanelSnapshot,
  SessionSnapshot,
  TerminalPanelSnapshot
} from '../shared/ipc'
import { emptyEnabled, SessionRegistry, type PanelKey } from './sessionRegistry'
import type { TerminalPanelDraft } from './sessionSnapshot'

interface SessionContextValue {
  /** The restored snapshot, or null for a clean session (FR-005). */
  snapshot: SessionSnapshot | null
  /** The shared save coordinator. */
  registry: SessionRegistry
}

const SessionContext = createContext<SessionContextValue | null>(null)

/** What App renders around the rail panels once the snapshot has loaded. */
export function SessionProvider({
  snapshot,
  children
}: {
  snapshot: SessionSnapshot | null
  children: React.ReactNode
}): React.JSX.Element {
  // One registry for the app's lifetime; its save pushes to main.
  const registry = useMemo(
    () => new SessionRegistry((snap) => window.cosmos.session.save(snap)),
    []
  )

  // FR-007: force a final save on teardown (quit / reload) so the freshest state is
  // persisted even if it landed inside the debounce window.
  useEffect(() => {
    const flush = (): void => registry.flush()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [registry])

  const value = useMemo(() => ({ snapshot, registry }), [snapshot, registry])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSessionContext must be used within a SessionProvider')
  }
  return ctx
}

/** The restored generative-panel slice for `key`, or undefined for a clean session. */
export function useRestoredGenerativePanel(
  key: GenerativePanelKey
): GenerativePanelSnapshot | undefined {
  const { snapshot } = useSessionContext()
  return snapshot?.panels[key]
}

/** The restored terminal-panel slice, or undefined for a clean session. */
export function useRestoredTerminalPanel(): TerminalPanelSnapshot | undefined {
  const { snapshot } = useSessionContext()
  return snapshot?.panels.terminal
}

/**
 * The restored GLOBAL Open-Prompt button position, or undefined for a clean / pre-feature
 * session (draggable-open-prompt-button-v1). `OpenPromptPositionProvider` seeds its initial
 * value from this `?? DEFAULT_OPEN_PROMPT_POSITION` (FR-011).
 */
export function useRestoredOpenPromptPosition():
  | { xFrac: number; yFrac: number }
  | undefined {
  const { snapshot } = useSessionContext()
  return snapshot?.openPromptPosition
}

/**
 * The shared save coordinator (the live `SessionRegistry`). Exposed so the
 * `OpenPromptPositionProvider` can report the global Open-Prompt position through the
 * NON-panel `setOpenPromptPosition` path (mirrors how `useEnabledIntegrations` reports
 * `enabled`). Stable for the app's lifetime.
 */
export function useSessionRegistry(): SessionRegistry {
  return useSessionContext().registry
}

/**
 * Returns a stable `report` callback that pushes this panel's latest contribution to
 * the shared debounced save coordinator. Generative panels report a
 * `GenerativePanelSnapshot`; the terminal panel reports a `TerminalPanelDraft`.
 */
export function useReportPanel(): <K extends PanelKey>(
  key: K,
  contribution: K extends 'terminal' ? TerminalPanelDraft : GenerativePanelSnapshot
) => void {
  const { registry } = useSessionContext()
  const ref = useRef(registry)
  ref.current = registry
  // Stable across renders; the registry instance itself is stable for the app life.
  return useMemo(
    () =>
      <K extends PanelKey>(
        key: K,
        contribution: K extends 'terminal' ? TerminalPanelDraft : GenerativePanelSnapshot
      ): void => {
        ref.current.report(key, contribution)
      },
    []
  )
}

/**
 * The per-integration `enabled` rail-visibility preference, restored from the snapshot
 * and made live (settings-redesign-v1, FR-003/FR-004/FR-006).
 *
 * Returns the current `enabled` map plus a `setEnabled(id, on)` setter. The map seeds
 * from the restored snapshot (all-disabled for a clean session — FR-008); a clean
 * `enabled` was already normalized at the main boundary so missing keys arrive `false`.
 * Each toggle updates React state (so the rail re-renders live — FR-004) AND reports
 * the new map to the debounced save coordinator (D2 — no new IPC channel). The restored
 * map is also seeded into the registry on mount so a save triggered by another panel
 * before the user toggles anything preserves the restored enabled state.
 */
export function useEnabledIntegrations(): {
  enabled: EnabledIntegrations
  setEnabled: (id: GateableIntegration, on: boolean) => void
} {
  const { snapshot, registry } = useSessionContext()
  const [enabled, setEnabledState] = useState<EnabledIntegrations>(
    () => snapshot?.enabled ?? emptyEnabled()
  )

  // Seed the registry with the restored map once so a save that fires before any
  // user toggle still persists the restored enabled state (not all-disabled).
  useEffect(() => {
    registry.setEnabled(snapshot?.enabled ?? emptyEnabled())
    // Restoring once at mount; the snapshot is fixed for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry])

  const setEnabled = useCallback(
    (id: GateableIntegration, on: boolean): void => {
      setEnabledState((prev) => {
        if (prev[id] === on) {
          return prev
        }
        const next = { ...prev, [id]: on }
        registry.setEnabled(next)
        return next
      })
    },
    [registry]
  )

  return { enabled, setEnabled }
}

/**
 * Load the snapshot once at startup. Returns `{ loading, snapshot }`: App shows the
 * restore spinner while `loading`, then renders `SessionProvider` with the resolved
 * snapshot. A load failure degrades to a clean session (null) — never blocks startup.
 */
export function useLoadSession(): { loading: boolean; snapshot: SessionSnapshot | null } {
  const [loading, setLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    window.cosmos.session
      .load()
      .then((snap) => {
        if (!cancelled) {
          setSnapshot(snap)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(null)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { loading, snapshot }
}
