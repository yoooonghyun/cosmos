/**
 * FavoriteSurface — renders a Home favorite by RELOCATING the LIVE source panel into it
 * (cosmos-favorite-live-panel-portal-v1, FR-001/FR-002/FR-003). A favorite of a generative panel
 * (Jira/Slack/Confluence/Google Calendar) shows that panel's source tab "그대로" (as-is) — the SAME
 * component instance with its full interactive chrome (search box, date/month nav, legend toggle, tab
 * strip, footer) and live state — by mounting the panel's stable reverse-portal node here via
 * `<OutPortal>`. The panel is force-mounted ONCE at App root (`<InPortal>`); only its DOM parent moves
 * between the rail slot and this favorite slot, so NOTHING remounts and all state survives the move.
 *
 * The ONE-CLAIMER guard: render the OutPortal ONLY when `hostFor(panelId) === 'favorite'` (in steady
 * state always true while this favorite is the active Home tab — both render sites read the SAME
 * synchronous `(visibleSurface, activeFavoriteSource)`). During the one-render handoff transient the
 * rail slot still claims the node, so render an empty placeholder rather than double-claim.
 *
 * Three states: LIVE (the source tab exists in the registry) → the reparented panel via OutPortal;
 * GONE (the panel has no tab with the pinned id — closed / absent on relaunch) → a calm "no longer
 * open" + Unpin (never auto-dropped, FR-016). The TERMINAL favorite KEEPS its xterm-multiplex mirror
 * (`TerminalFavoriteSurface`, FR-015) — it is a terminal-pane-only sub-view, not the whole panel, so
 * the reparenting portal does not fit it.
 */

import { PanelsTopLeft } from 'lucide-react'
import { OutPortal } from 'react-reverse-portal'
import { Button } from '@/components/ui/button'
import { useAllPanelTabs } from '../panelTabs'
import { usePanelHost, isGenerativePanelId } from '../panelHost'
import { SURFACE_ICON, type RailIcon } from '../app/surfaceIcons'
import { findLiveTab } from './homeFavorites'
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
  // cosmos-terminal-favorite-multiplex-v1 (FR-015): a terminal favorite is an xterm-multiplex mirror,
  // NOT a reparented panel — branch to it BEFORE the portal path (terminal has no portal node). Split
  // out so the terminal branch does not depend on `PanelHostProvider` (the generative path does).
  if (source.panelId === 'terminal') {
    return <TerminalFavoriteSurface source={source} onUnpin={onUnpin} />
  }
  return <GenerativeFavorite source={source} onUnpin={onUnpin} />
}

/** The generative-panel favorite: the reparented LIVE panel via the panel-host portal (FR-001..FR-004). */
function GenerativeFavorite({
  source,
  onUnpin
}: {
  source: { panelId: FavoritePanelId; tabId: string }
  onUnpin: () => void
}): React.JSX.Element {
  const registry = useAllPanelTabs()
  const { node, hostFor } = usePanelHost()

  const live = findLiveTab(registry, source.panelId, source.tabId)
  const Glyph: RailIcon = SURFACE_ICON[source.panelId] ?? PanelsTopLeft

  // GONE: the panel has no tab with the pinned id (closed / absent on relaunch). Calm empty state;
  // never auto-dropped (FR-016). Detected by tab EXISTENCE in the registry (the published tab list is
  // label-only now — the live view comes from the reparented panel, not a published surface).
  if (!live || !isGenerativePanelId(source.panelId)) {
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

  // ONE-CLAIMER guard: only claim the node when this favorite is the chosen host. In steady state this
  // is always true (this favorite is the active Home tab); during the single-render rail↔favorite
  // handoff the rail slot still holds the node, so render an empty placeholder (no double-claim).
  if (hostFor(source.panelId) !== 'favorite') {
    return <div className="min-h-0 min-w-0 flex-1" role="tabpanel" />
  }

  // LIVE: relocate the source panel's force-mounted instance into the favorite. It IS the same
  // component the rail shows (full chrome + interactivity + shared state) — no remount, no surface copy.
  return <OutPortal node={node(source.panelId)} />
}
