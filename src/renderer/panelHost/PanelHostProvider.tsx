/**
 * PanelHostProvider — the App-root host for the live-panel reparenting portal
 * (cosmos-favorite-live-panel-portal-v1). Sibling to `PanelTabsProvider`/`ActiveComposerProvider`.
 *
 * Owns:
 *  - FOUR stable detached portal nodes, one per generative panel (`createHtmlPortalNode`), created
 *    ONCE via a lazy `useState` init so a StrictMode double-invoke / Fast-Refresh remount never
 *    orphans or duplicates a node. Each panel renders ONCE into its node via `<InPortal>` (App root,
 *    off-DOM) and is mounted by exactly ONE `<OutPortal>` at a time — its rail slot or the Home
 *    favorite slot. Relocating the OutPortal reparents the DOM node WITHOUT remounting the panel, so
 *    all state survives the move (FR-003).
 *  - Two synchronous React-state host signals (NOT effect-published refs, so both render sites read
 *    ONE consistent value per render): `visibleSurface` (lifted from `AppShell`) + `activeFavoriteSource`
 *    (set by `CosmosPanel` in the active-Home-tab path).
 *  - The PURE `hostFor`/`panelVisible` selectors bound to those signals (the ONE-CLAIMER invariant).
 *  - A one-shot `focusSourceTab`/`onFocusTab` channel (renderer-only ref + no IPC): on favorite
 *    activation `CosmosPanel` fires `focusSourceTab(panelId, tabId)` once → the panel's registered
 *    handler calls `setActive(tabId)` (FR-006, initial-focus-then-free).
 *
 * Renderer-only DOM movement (FR-005): NO new IPC channel, cross-process payload, persisted field, or
 * secret — the panels already render these surfaces legitimately in the renderer.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createHtmlPortalNode, type HtmlPortalNode } from 'react-reverse-portal'
import type { SurfaceId } from '../app/railVisibility'
import {
  hostFor as hostForPure,
  panelVisible as panelVisiblePure,
  type ActiveFavoriteSource,
  type GenerativePanelId,
  type PanelHost
} from './panelHostLogic'

/** A handler that focuses a panel onto a specific tab id (the panel's own `setActive`). */
type FocusHandler = (tabId: string) => void

type NodeRecord = Record<GenerativePanelId, HtmlPortalNode>

/**
 * Create the four stable nodes. Each wrapper element fills its mount point (flex column, full height
 * + width) so the relocated panel `<section className="h-full …">` lays out identically in the rail
 * slot (a flex-column `app__ui`) and the Home favorite slot (a flex-row split row).
 */
function createNodes(): NodeRecord {
  const make = (): HtmlPortalNode =>
    createHtmlPortalNode({ attributes: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' } })
  return { slack: make(), jira: make(), confluence: make(), 'google-calendar': make() }
}

interface PanelHostContextValue {
  /** The currently visible rail surface (mirrors `AppShell`'s former `surface` state). */
  visibleSurface: SurfaceId
  /** Set the visible rail surface (the `AppShell` Tabs `value`; supports functional updates). */
  setVisibleSurface: React.Dispatch<React.SetStateAction<SurfaceId>>
  /** The active Home favorite's source `{panelId, tabId}` (published by `CosmosPanel`), or null. */
  activeFavoriteSource: ActiveFavoriteSource | null
  /** Publish the active Home favorite source (null when the active Home tab is not a favorite). */
  setActiveFavoriteSource: (source: ActiveFavoriteSource | null) => void
  /** The stable detached portal node for a generative panel. */
  node: (panelId: GenerativePanelId) => HtmlPortalNode
  /** Where this generative panel's instance is hosted right now (the ONE-CLAIMER selector). */
  hostFor: (panelId: GenerativePanelId) => PanelHost
  /** Whether this generative panel is on screen (rail-active OR hosted in the active favorite). */
  panelVisible: (panelId: GenerativePanelId) => boolean
  /** Fire the one-shot focus (called by `CosmosPanel` on favorite activation). No-op if unregistered. */
  focusSourceTab: (panelId: GenerativePanelId, tabId: string) => void
  /** Register a panel's focus handler (its `setActive`); returns an unsubscribe. */
  onFocusTab: (panelId: GenerativePanelId, handler: FocusHandler) => () => void
}

const PanelHostContext = createContext<PanelHostContextValue | null>(null)

export function PanelHostProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [visibleSurface, setVisibleSurface] = useState<SurfaceId>('cosmos')
  const [activeFavoriteSource, setActiveFavoriteSourceState] =
    useState<ActiveFavoriteSource | null>(null)
  // Lazy init: the nodes are created exactly once (a StrictMode double-invoke / Fast-Refresh remount
  // takes the first result via useState, so a node is never orphaned or duplicated).
  const [nodes] = useState<NodeRecord>(createNodes)
  const focusHandlersRef = useRef<Map<GenerativePanelId, FocusHandler>>(new Map())

  const node = useCallback((panelId: GenerativePanelId) => nodes[panelId], [nodes])

  const hostFor = useCallback(
    (panelId: GenerativePanelId): PanelHost =>
      hostForPure(panelId, visibleSurface, activeFavoriteSource),
    [visibleSurface, activeFavoriteSource]
  )

  const panelVisible = useCallback(
    (panelId: GenerativePanelId): boolean =>
      panelVisiblePure(visibleSurface, activeFavoriteSource, panelId),
    [visibleSurface, activeFavoriteSource]
  )

  // Set the active favorite source only when it actually changes (identity by panelId+tabId) so a
  // CosmosPanel re-render does not churn the provider (and its OutPortals) on every render.
  const setActiveFavoriteSource = useCallback((source: ActiveFavoriteSource | null): void => {
    setActiveFavoriteSourceState((prev) => {
      if (prev === source) {
        return prev
      }
      if (
        prev &&
        source &&
        prev.panelId === source.panelId &&
        prev.tabId === source.tabId
      ) {
        return prev
      }
      return source
    })
  }, [])

  const focusSourceTab = useCallback((panelId: GenerativePanelId, tabId: string): void => {
    focusHandlersRef.current.get(panelId)?.(tabId)
  }, [])

  const onFocusTab = useCallback(
    (panelId: GenerativePanelId, handler: FocusHandler): (() => void) => {
      focusHandlersRef.current.set(panelId, handler)
      return () => {
        if (focusHandlersRef.current.get(panelId) === handler) {
          focusHandlersRef.current.delete(panelId)
        }
      }
    },
    []
  )

  const value = useMemo<PanelHostContextValue>(
    () => ({
      visibleSurface,
      setVisibleSurface,
      activeFavoriteSource,
      setActiveFavoriteSource,
      node,
      hostFor,
      panelVisible,
      focusSourceTab,
      onFocusTab
    }),
    [
      visibleSurface,
      activeFavoriteSource,
      setActiveFavoriteSource,
      node,
      hostFor,
      panelVisible,
      focusSourceTab,
      onFocusTab
    ]
  )

  return <PanelHostContext.Provider value={value}>{children}</PanelHostContext.Provider>
}

/** Read the panel-host context. Throws if used outside `PanelHostProvider`. */
export function usePanelHost(): PanelHostContextValue {
  const ctx = useContext(PanelHostContext)
  if (!ctx) {
    throw new Error('usePanelHost must be used within a PanelHostProvider')
  }
  return ctx
}
