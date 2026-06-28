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
import type { SurfaceId } from '../app/railVisibility'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import type { ComposerConfig, ComposerRegistry } from './activeComposer'
import { selectActiveComposerConfig } from './activeComposer'

interface ActiveComposerContextValue {
  /** Publish (or clear with `null`) a surface's composer config; bumps the read version. */
  publish: (surface: SurfaceId, config: ComposerConfig | null) => void
  /** The live registry (read by the App-level consumer). */
  registryRef: React.MutableRefObject<ComposerRegistry>
  /** Bumped on every publish so the App consumer re-reads the active config. */
  version: number
  /**
   * cosmos-context-chip-crosspanel-and-historical-v1 (#2): the LAST submitted prompt's captured
   * {@link PromptContext}, shared across publishers. Written at SEND time by BOTH Open-Prompt
   * submit sites (`useGenerativePanelTabs.submit` for Jira/Slack/Confluence/Calendar AND
   * `CosmosPanel.onSubmit` for the cosmos panel). The Cosmos timeline's `agent:status 'started'`
   * live seed reads it so the in-flight chip reflects the ACTUAL submitting panel — not a stale
   * cosmos-only default. Ref-backed (no re-render): the live seed reads it once when 'started'
   * arrives, right after the synchronous submit that wrote it.
   */
  lastSubmitContextRef: React.MutableRefObject<PromptContext | undefined>
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
  // #2: the cross-panel "last submitted PromptContext" (see the context-value field doc).
  const lastSubmitContextRef = useRef<PromptContext | undefined>(undefined)

  const publish = useCallback((surface: SurfaceId, config: ComposerConfig | null): void => {
    registryRef.current = { ...registryRef.current, [surface]: config }
    setVersion((v) => v + 1)
  }, [])

  const value = useMemo<ActiveComposerContextValue>(
    () => ({ publish, registryRef, version, lastSubmitContextRef }),
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
 * cosmos-context-chip-crosspanel-and-historical-v1 (#2): record the PromptContext captured for the
 * prompt being submitted RIGHT NOW. Both Open-Prompt submit sites call this synchronously at SEND
 * time so the Cosmos timeline's `agent:status 'started'` live seed (which reads
 * {@link useLastSubmitContextRef}) reflects the ACTUAL submitting panel — Jira/Slack/etc — not a
 * stale cosmos-only default. Stable setter (writes a ref; no re-render).
 */
export function useRecordSubmitContext(): (context: PromptContext | undefined) => void {
  const { lastSubmitContextRef } = useActiveComposerContext()
  return useCallback(
    (context: PromptContext | undefined) => {
      lastSubmitContextRef.current = context
    },
    [lastSubmitContextRef]
  )
}

/**
 * cosmos-context-chip-crosspanel-and-historical-v1 (#2): the ref holding the last submitted
 * PromptContext (written by {@link useRecordSubmitContext}). The Cosmos timeline reads
 * `.current` inside its `agent:status 'started'` subscription so the in-flight chip names the
 * panel the prompt was actually sent from. Returning the ref (not the value) keeps the long-lived
 * status subscription from re-subscribing.
 */
export function useLastSubmitContextRef(): React.MutableRefObject<PromptContext | undefined> {
  return useActiveComposerContext().lastSubmitContextRef
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
