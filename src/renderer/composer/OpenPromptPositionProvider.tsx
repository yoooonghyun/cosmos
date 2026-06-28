/**
 * OpenPromptPositionProvider — the app-root context store holding the ONE globally-shared
 * Open-Prompt button position (draggable-open-prompt-button-v1, FR-003/FR-004). Every
 * panel's `PromptComposer` reads it via {@link useOpenPromptPosition} and writes back on
 * drag, so the value is a single shared React state: a drag in any panel re-renders every
 * mounted `PromptComposer` with the new fraction (live cross-panel sync — FR-004).
 *
 * Mounted INSIDE `SessionProvider` (so it can seed from the restored snapshot and report
 * through the shared `SessionRegistry`). It seeds its initial value from
 * `snapshot.openPromptPosition ?? DEFAULT_OPEN_PROMPT_POSITION` (FR-011) and, on each
 * `setPosition`, updates state AND reports the new value to the registry's NON-panel
 * `setOpenPromptPosition` path (debounce-saved like any change — FR-007). No new IPC
 * channel: persistence rides the existing session save.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_OPEN_PROMPT_POSITION, type OpenPromptPosition } from './openPromptPosition'
import { useRestoredOpenPromptPosition, useSessionRegistry } from '../session/SessionProvider'

interface OpenPromptPositionContextValue {
  /** The live, globally-shared normalized button position. */
  position: OpenPromptPosition
  /** Update the shared position (live for all panels) AND report it for debounced save. */
  setPosition: (position: OpenPromptPosition) => void
}

const OpenPromptPositionContext = createContext<OpenPromptPositionContextValue | null>(null)

/**
 * Provide the global Open-Prompt button position to every panel's `PromptComposer`. Seeds
 * from the restored snapshot (default centered-bottom when absent — FR-011) and reports
 * each change to the shared registry (FR-007). Render inside `SessionProvider`.
 */
export function OpenPromptPositionProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const restored = useRestoredOpenPromptPosition()
  const registry = useSessionRegistry()

  // Seed once from the restored snapshot; the snapshot is fixed for the provider's life.
  const [position, setPositionState] = useState<OpenPromptPosition>(
    () => restored ?? DEFAULT_OPEN_PROMPT_POSITION
  )

  // Seed the registry with the restored position once on mount so a save triggered by
  // another contribution (e.g. a panel tab change) before the user ever drags still
  // persists the restored position rather than dropping the field. Mirrors how
  // `useEnabledIntegrations` re-seeds the restored `enabled` map.
  useEffect(() => {
    if (restored) {
      registry.setOpenPromptPosition(restored)
    }
    // Restoring once at mount; restored/registry are stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry])

  const setPosition = useCallback(
    (next: OpenPromptPosition): void => {
      setPositionState(next)
      registry.setOpenPromptPosition(next)
    },
    [registry]
  )

  const value = useMemo(() => ({ position, setPosition }), [position, setPosition])
  return (
    <OpenPromptPositionContext.Provider value={value}>
      {children}
    </OpenPromptPositionContext.Provider>
  )
}

/**
 * Read the globally-shared Open-Prompt button position + its setter. Every panel's
 * `PromptComposer` calls this; because the value is one shared state, a drag in any panel
 * re-renders all of them with the new fraction (FR-003/FR-004).
 */
export function useOpenPromptPosition(): OpenPromptPositionContextValue {
  const ctx = useContext(OpenPromptPositionContext)
  if (!ctx) {
    throw new Error('useOpenPromptPosition must be used within an OpenPromptPositionProvider')
  }
  return ctx
}
