/**
 * FavoriteSurface — renders a Home favorite's source tab INLINE as a true LIVE MIRROR
 * (cosmos-home-favorite-tabs-v1, FR-020/FR-022/FR-024/FR-031, design §4). It reads the source tab's
 * CURRENT live `TabSurface` out of the cross-panel registry (`findLiveTab`) and mounts it through the
 * SAME `ActiveTabSurface` host the source panel uses — under the source panel's OWN catalog
 * (`favoriteCatalogHosts`) and sharing the live `requestId`/`surfaceId`. Because two instances of the
 * same surfaceId both receive `updateDataModel` pushes and round-trip bound/deterministic actions
 * through `UiBridge` (which warn-ignores a duplicate resolve), the favorite reflects the source in
 * real time and bound controls work — with NO new cross-panel contract.
 *
 * Four states (design §4.2): POPULATED (source + surface) → the live surface; WAITING (source open,
 * `surface == null`) → a calm placeholder that flips live on the next publish; GONE (source closed /
 * absent on relaunch) → a calm "no longer open" empty state with an Unpin affordance (the favorite is
 * NEVER auto-dropped, FR-031); ERROR → the existing `ActiveTabSurface` boundary, per-body.
 *
 * v1 swallows the source panel's renderer-LOCAL navigation actions in Home (`favoriteOnAction`) — see
 * favoriteCatalogHosts.
 */

import { PanelsTopLeft } from 'lucide-react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { Button } from '@/components/ui/button'
import { ActiveTabSurface } from '../generative/ActiveTabSurface'
import { useAllPanelTabs } from '../panelTabs'
import { SURFACE_ICON, type RailIcon } from '../app/surfaceIcons'
import { findLiveTab } from './homeFavorites'
import { favoriteCatalogHosts, favoriteOnAction } from './favoriteCatalogHosts'
import { TerminalFavoriteSurface } from './TerminalFavoriteSurface'
import type { FavoritePanelId } from './cosmosTabs'

export function FavoriteSurface({
  source,
  onUnpin
}: {
  source: { panelId: FavoritePanelId; tabId: string }
  /** Unpin this favorite (the gone-source empty state's only action; same path as the strip `X`). */
  onUnpin: () => void
}): React.JSX.Element {
  // Hook called UNCONDITIONALLY before any branch (rules of hooks — this instance is reused across
  // favorite switches, so the hook count must not vary).
  const registry = useAllPanelTabs()

  // cosmos-terminal-favorite-multiplex-v1 (FR-004): a terminal favorite is an xterm-multiplex mirror,
  // NOT an A2UI surface — branch to it BEFORE the `favoriteCatalogHosts` lookup (which has no terminal
  // entry). Its own GONE/WAITING/POPULATED states live in TerminalFavoriteSurface.
  if (source.panelId === 'terminal') {
    return <TerminalFavoriteSurface source={source} onUnpin={onUnpin} />
  }

  const live = findLiveTab(registry, source.panelId, source.tabId)
  const host = favoriteCatalogHosts[source.panelId]
  const Glyph: RailIcon = SURFACE_ICON[source.panelId] ?? PanelsTopLeft

  // GONE: the source tab/panel is not currently published. Calm empty state; never auto-dropped.
  if (!live || !host) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-3 text-center text-card-foreground"
        role="tabpanel"
      >
        <Glyph className="size-6 text-muted-foreground" />
        <p className="text-body text-foreground">This tab is no longer open</p>
        <p className="max-w-xs text-caption text-muted-foreground">
          The source view was closed. Its shortcut stays here until you unpin it.
        </p>
        <Button variant="secondary" size="sm" onClick={onUnpin}>
          Unpin
        </Button>
      </div>
    )
  }

  // WAITING: the source tab is open but has not composed a surface yet (untitled / in-flight). Flips
  // to the live surface the instant one is published.
  if (!live.surface) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-3 text-center text-card-foreground"
        role="tabpanel"
      >
        <Glyph className="size-6 text-muted-foreground" />
        <p className="text-caption text-muted-foreground">Waiting for this tab&apos;s view…</p>
      </div>
    )
  }

  // POPULATED (live mirror): mount the source's live surface under its OWN catalog, sharing the live
  // requestId/surfaceId so it tracks the source in real time (FR-020/FR-022/FR-024).
  return (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-auto p-3 text-card-foreground"
      role="tabpanel"
    >
      <A2UIProvider catalog={host.catalog} key={source.tabId}>
        <ActiveTabSurface
          surface={live.surface}
          catalogId={host.catalogId}
          panelName={`Favorite:${host.panelName}`}
          onAction={favoriteOnAction}
        />
      </A2UIProvider>
    </div>
  )
}
