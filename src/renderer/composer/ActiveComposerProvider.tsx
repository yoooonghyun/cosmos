/**
 * ActiveComposerProvider — the App-root registry that lets the ONE hoisted
 * Open-Prompt composer route its submit to whichever panel is active
 * (open-prompt-hoist-v1).
 *
 * Each generative panel calls {@link usePublishComposer} to publish its current
 * composer wiring (submit handler, placeholder, aria label, context chip, busy gate)
 * keyed by its surface id — or `null` when it has no active composer (a disconnected
 * integration; Terminal never publishes). The App reads the active surface's published
 * entry via {@link useActiveComposerConfig} and feeds it to the single shared
 * `PromptComposer`. Because the composer is mounted ONCE at App level (not per panel),
 * switching panels no longer re-mounts/re-measures it — the floating button stops
 * flickering — while the submit still goes to the active surface.
 *
 * The registry is a ref-backed map plus a `version` counter: publishing bumps the
 * version so the App-level consumer re-reads, but a publish does NOT re-render every
 * panel (only the App shell that consumes the active config).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { SurfaceId } from '../railVisibility'
import type { ComposerConfig, ComposerRegistry } from './activeComposer'
import { selectActiveComposerConfig } from './activeComposer'

interface ActiveComposerContextValue {
  /** Publish (or clear with `null`) a surface's composer config; bumps the read version. */
  publish: (surface: SurfaceId, config: ComposerConfig | null) => void
  /** The live registry (read by the App-level consumer). */
  registryRef: React.MutableRefObject<ComposerRegistry>
  /** Bumped on every publish so the App consumer re-reads the active config. */
  version: number
}

const ActiveComposerContext = createContext<ActiveComposerContextValue | null>(null)

/**
 * Provide the active-composer registry to the App shell + every generative panel.
 * Render high enough to wrap BOTH the panels (publishers) and the single hoisted
 * composer (consumer).
 */
export function ActiveComposerProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const registryRef = useRef<ComposerRegistry>({})
  const [version, setVersion] = useState(0)

  const publish = useCallback((surface: SurfaceId, config: ComposerConfig | null): void => {
    registryRef.current = { ...registryRef.current, [surface]: config }
    setVersion((v) => v + 1)
  }, [])

  const value = useMemo<ActiveComposerContextValue>(
    () => ({ publish, registryRef, version }),
    [publish, version]
  )
  return <ActiveComposerContext.Provider value={value}>{children}</ActiveComposerContext.Provider>
}

function useActiveComposerContext(): ActiveComposerContextValue {
  const ctx = useContext(ActiveComposerContext)
  if (!ctx) {
    throw new Error('useActiveComposer* must be used within an ActiveComposerProvider')
  }
  return ctx
}

/**
 * Publish a panel's composer config (or `null` to clear it). Re-publishes whenever the
 * config object changes; clears the entry on unmount. A panel that has no composer right
 * now (e.g. an integration that is not connected) passes `null` and the shared composer
 * hides while that surface is active.
 *
 * Pass the SAME config object identity across renders (memoize it in the panel) to avoid
 * redundant version bumps; the dependency is the config reference.
 */
export function usePublishComposer(surface: SurfaceId, config: ComposerConfig | null): void {
  const { publish } = useActiveComposerContext()
  useEffect(() => {
    publish(surface, config)
    return () => publish(surface, null)
  }, [publish, surface, config])
}

/**
 * Read the composer config for the ACTIVE surface (or `null` when that surface has not
 * published one). Re-reads whenever a publish bumps the version, so a freshly-connected
 * panel's composer appears as soon as it publishes.
 */
export function useActiveComposerConfig(activeSurface: SurfaceId): ComposerConfig | null {
  const { registryRef, version } = useActiveComposerContext()
  // `version` is referenced so the read re-runs on every publish (the registry is a ref).
  return useMemo(
    () => selectActiveComposerConfig(registryRef.current, activeSurface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registryRef, activeSurface, version]
  )
}
