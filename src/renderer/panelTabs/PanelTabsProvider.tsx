/**
 * PanelTabsProvider — the App-root publish/subscribe registry of every panel's LIVE open tabs
 * (cosmos-panel-tab-list-v1, the crux). Modeled EXACTLY on `ActiveComposerProvider`: a ref-backed
 * registry + a `version` counter, so a publish bumps the version (the Cosmos tree re-reads) without
 * re-rendering every panel.
 *
 * Each in-scope panel (the four generative panels via `useGenerativePanelTabs`, and the Terminal
 * panel) calls {@link usePublishPanelTabs} to publish its FULL live tab list (id + label per tab +
 * the active id, all NON-SECRET — FR-011); it publishes `null` on unmount. The Cosmos panel reads
 * the whole registry via {@link useAllPanelTabs} and shapes it with the pure `toPanelTabGroups`.
 *
 * This is a SIBLING seam to the other two cross-panel registries, deliberately distinct:
 *  - `SessionRegistry` = debounced, write-only PERSISTENCE (lossy — only composed surfaces).
 *  - `ActiveComposerProvider` = live composer ROUTING.
 *  - `PanelTabsProvider` (here) = live, full, read-only cross-panel TAB-LIST read.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CrossPanelId, LivePanelTabs, PanelTabsRegistry } from './panelTabs'

interface PanelTabsContextValue {
  /** Publish (or clear with `null`) a panel's live tab list; bumps the read version. */
  publish: (panelId: CrossPanelId, tabs: LivePanelTabs | null) => void
  /** The live registry (read by the Cosmos tree consumer). */
  registryRef: React.MutableRefObject<PanelTabsRegistry>
  /** Bumped on every publish so the consumer re-reads the registry. */
  version: number
}

const PanelTabsContext = createContext<PanelTabsContextValue | null>(null)

/**
 * Provide the panel-tabs registry to the App shell + every in-scope panel. Render high enough to
 * wrap BOTH the publishers (the panels) and the consumer (the Cosmos panel-tab tree).
 */
export function PanelTabsProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const registryRef = useRef<PanelTabsRegistry>({})
  const [version, setVersion] = useState(0)

  const publish = useCallback((panelId: CrossPanelId, tabs: LivePanelTabs | null): void => {
    registryRef.current = { ...registryRef.current, [panelId]: tabs }
    setVersion((v) => v + 1)
  }, [])

  const value = useMemo<PanelTabsContextValue>(
    () => ({ publish, registryRef, version }),
    [publish, version]
  )
  return <PanelTabsContext.Provider value={value}>{children}</PanelTabsContext.Provider>
}

function usePanelTabsContext(): PanelTabsContextValue {
  const ctx = useContext(PanelTabsContext)
  if (!ctx) {
    throw new Error('usePanelTabs* must be used within a PanelTabsProvider')
  }
  return ctx
}

/**
 * Publish a panel's live tab list (or `null` to clear it). Re-publishes whenever the memoized
 * `tabs` object changes; clears the entry on unmount. Callers MUST pass a `useMemo`'d snapshot so a
 * tab-state change re-publishes but a bare re-render does not (mirrors `usePublishComposer`).
 *
 * `panelId` may be `null` so the hook can be called UNCONDITIONALLY (rules of hooks) from a site
 * whose surface is not always a cross-panel id — e.g. `useGenerativePanelTabs` whose `target` is
 * the wire `'generated-ui'` for the Cosmos surface (which is excluded from its own tree). A `null`
 * id publishes nothing.
 */
export function usePublishPanelTabs(panelId: CrossPanelId | null, tabs: LivePanelTabs | null): void {
  const { publish } = usePanelTabsContext()
  useEffect(() => {
    if (panelId === null) {
      return
    }
    publish(panelId, tabs)
    return () => publish(panelId, null)
  }, [publish, panelId, tabs])
}

/**
 * Read the WHOLE live registry, re-reading on every publish (the registry is a ref; `version` is
 * referenced so the read re-runs). The Cosmos tree feeds the result to the pure `toPanelTabGroups`.
 * Returns the registry object identity that is stable between publishes.
 */
export function useAllPanelTabs(): PanelTabsRegistry {
  const { registryRef, version } = usePanelTabsContext()
  // `version` drives the re-read (the registry itself is a ref, swapped on each publish).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => registryRef.current, [registryRef, version])
}
