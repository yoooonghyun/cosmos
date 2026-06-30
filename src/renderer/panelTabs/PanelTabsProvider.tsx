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
import type {
  CrossPanelId,
  LivePanelTabs,
  PanelTabsRegistry,
  TabCommands,
  TabCommandsRegistry
} from './panelTabs'

interface PanelTabsContextValue {
  /** Publish (or clear with `null`) a panel's live tab list; bumps the read version. */
  publish: (panelId: CrossPanelId, tabs: LivePanelTabs | null) => void
  /** The live registry (read by the Cosmos tree consumer). */
  registryRef: React.MutableRefObject<PanelTabsRegistry>
  /**
   * cosmos-tree-tab-rename-delete-v1 (FR-002): publish (or clear with `null`) a panel's REVERSE
   * tab commands; bumps the SAME read version as the forward seam.
   */
  publishTabCommands: (panelId: CrossPanelId, commands: TabCommands | null) => void
  /** The live reverse-command registry (read by the Cosmos tree consumer). */
  commandsRef: React.MutableRefObject<TabCommandsRegistry>
  /** Bumped on every publish (forward OR reverse) so consumers re-read their registry. */
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
  // cosmos-tree-tab-rename-delete-v1: the SIBLING reverse-command registry. Shares the ONE `version`
  // counter with the forward seam — a command publish bumps it, but `useAllPanelTabs` returns the
  // unchanged `registryRef.current` (same object identity) so it never churns the tree's groups.
  const commandsRef = useRef<TabCommandsRegistry>({})
  const [version, setVersion] = useState(0)

  const publish = useCallback((panelId: CrossPanelId, tabs: LivePanelTabs | null): void => {
    registryRef.current = { ...registryRef.current, [panelId]: tabs }
    setVersion((v) => v + 1)
  }, [])

  const publishTabCommands = useCallback(
    (panelId: CrossPanelId, commands: TabCommands | null): void => {
      commandsRef.current = { ...commandsRef.current, [panelId]: commands }
      setVersion((v) => v + 1)
    },
    []
  )

  const value = useMemo<PanelTabsContextValue>(
    () => ({ publish, registryRef, publishTabCommands, commandsRef, version }),
    [publish, publishTabCommands, version]
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
 * cosmos-tree-tab-rename-delete-v1 (FR-002/FR-003): publish a panel's REVERSE tab commands (or
 * `null` to clear). Mirrors {@link usePublishPanelTabs} EXACTLY: re-publishes whenever the memoized
 * `commands` change, clears the entry on unmount, and a `null` panelId publishes nothing (so the
 * hook can be called UNCONDITIONALLY from a site whose surface is the wire `'generated-ui'` Cosmos
 * target — excluded from its own tree). Callers MUST pass a `useMemo`'d commands object so a bare
 * re-render does not churn the registry.
 */
export function usePublishTabCommands(
  panelId: CrossPanelId | null,
  commands: TabCommands | null
): void {
  const { publishTabCommands } = usePanelTabsContext()
  useEffect(() => {
    if (panelId === null) {
      return
    }
    publishTabCommands(panelId, commands)
    return () => publishTabCommands(panelId, null)
  }, [publishTabCommands, panelId, commands])
}

/**
 * cosmos-tree-tab-rename-delete-v1 (FR-002): read the WHOLE reverse-command registry, re-reading on
 * every publish (the registry is a ref; `version` drives the re-read). The Cosmos tree consumer
 * looks commands up by `CrossPanelId` across its VARIABLE-length group order, so this returns the
 * whole map at once (a per-panel hook could not be called in a loop — rules of hooks); the PUBLISHER
 * stays per-panel ({@link usePublishTabCommands}).
 */
export function useAllTabCommands(): TabCommandsRegistry {
  const { commandsRef, version } = usePanelTabsContext()
  // `version` drives the re-read (the registry itself is a ref, swapped on each publish).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => commandsRef.current, [commandsRef, version])
}
