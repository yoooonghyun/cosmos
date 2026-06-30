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

/** A pinned source key (cosmos-native-view-mirror-surface-v1, D6): `"panelId:tabId"`. */
export type PinnedSourceKey = string

/** Build the canonical pinned-source key for a `(panelId, tabId)` pair. */
export function pinnedSourceKey(panelId: CrossPanelId, tabId: string): PinnedSourceKey {
  return `${panelId}:${tabId}`
}

interface PanelTabsContextValue {
  /** Publish (or clear with `null`) a panel's live tab list; bumps the read version. */
  publish: (panelId: CrossPanelId, tabs: LivePanelTabs | null) => void
  /** The live registry (read by the Cosmos tree consumer). */
  registryRef: React.MutableRefObject<PanelTabsRegistry>
  /** Bumped on every publish so the consumer re-reads the registry. */
  version: number
  /**
   * The REVERSE channel (cosmos-native-view-mirror-surface-v1, D6 — the OQ-3 gate): the set of
   * `"panelId:tabId"` keys the Cosmos panel has pinned as Home favorites, published BACK to the
   * source panels so a native-first panel only builds a mirror for a tab a favorite points at.
   */
  pinnedSourcesRef: React.MutableRefObject<Set<PinnedSourceKey>>
  /** Publish the pinned-source set (Cosmos → panels); bumps the pins read version. */
  publishPins: (keys: Set<PinnedSourceKey>) => void
  /** Bumped only on a pins publish so a pin-reading panel re-reads without churning on tab publishes. */
  pinsVersion: number
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
  // cosmos-native-view-mirror-surface-v1 (D6): the reverse pinned-sources channel.
  const pinnedSourcesRef = useRef<Set<PinnedSourceKey>>(new Set())
  const [pinsVersion, setPinsVersion] = useState(0)

  const publish = useCallback((panelId: CrossPanelId, tabs: LivePanelTabs | null): void => {
    registryRef.current = { ...registryRef.current, [panelId]: tabs }
    setVersion((v) => v + 1)
  }, [])

  const publishPins = useCallback((keys: Set<PinnedSourceKey>): void => {
    pinnedSourcesRef.current = keys
    setPinsVersion((v) => v + 1)
  }, [])

  const value = useMemo<PanelTabsContextValue>(
    () => ({ publish, registryRef, version, pinnedSourcesRef, publishPins, pinsVersion }),
    [publish, version, publishPins, pinsVersion]
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

/**
 * Publish the set of pinned source keys (cosmos-native-view-mirror-surface-v1, D6). The Cosmos
 * panel calls this whenever its favorite set changes so the native-first panels know which of
 * their tabs a favorite points at (the OQ-3 gate). Returns the stable `publishPins` callback.
 */
export function usePublishPins(): (keys: Set<PinnedSourceKey>) => void {
  return usePanelTabsContext().publishPins
}

/**
 * Read the pinned-source set, re-reading only on a pins publish (`pinsVersion` drives the re-read;
 * the set itself is a ref, swapped on each `publishPins`). A native-first panel gates its mirror
 * build on `pins.has(pinnedSourceKey(panelId, tabId))` so it never builds a mirror nobody pinned.
 */
export function usePinnedSources(): Set<PinnedSourceKey> {
  const { pinnedSourcesRef, pinsVersion } = usePanelTabsContext()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pinnedSourcesRef.current, [pinnedSourcesRef, pinsVersion])
}
