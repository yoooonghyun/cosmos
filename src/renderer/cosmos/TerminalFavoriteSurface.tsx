/**
 * TerminalFavoriteSurface — a Home terminal favorite's content (cosmos-terminal-favorite-multiplex-v1,
 * FR-004/FR-013/FR-014). A terminal favorite is a SECOND live `xterm` bound to the SAME PTY as the
 * source Terminal tab (Approach A: renderer-side xterm multiplex — no new session, no second PTY). It
 * REUSES the existing {@link TerminalView} in its `mirror` (non-owning) mode: the mirror NEVER calls
 * `pty:start`/`dispose`/`restart` (the source view owns the PTY lifecycle), seeds from the source
 * pane's live scrollback, fans in on the existing per-paneId `pty:data` stream, and renders the
 * terminal pane ONLY (no file-explorer split).
 *
 * Three states, mirroring the A2UI `FavoriteSurface` idiom:
 *  - GONE (`!live`): the source pane is not published (closed / absent on relaunch) → the SAME calm
 *    "no longer open" + Unpin block as A2UI favorites (FR-013). Never auto-dropped.
 *  - WAITING (`live && !live.serialize`): the source pane is published but its PTY is not yet live (a
 *    fresh `[Open a folder]` tab) → a calm "waiting" placeholder that flips to the mirror once live
 *    (terminal liveness is encoded by the PRESENCE of `serialize`) (FR-014).
 *  - POPULATED (`live.serialize`): the live mirror — `TerminalView mirror`, seeded with the source's
 *    current scrollback (`initialScrollback={live.serialize()}`).
 *
 * This is co-located with `FavoriteSurface` (which branches here on `source.panelId === 'terminal'`
 * BEFORE the A2UI catalog path) so the terminal/Monaco import stays isolated to the terminal branch.
 */

import { lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import { useAllPanelTabs } from '../panelTabs'
import { SURFACE_ICON } from '../app/surfaceIcons'
import { findLiveTab } from './homeFavorites'

/**
 * LAZY-load the reused TerminalView. `TerminalPanel.tsx` statically imports the Monaco-backed file
 * explorer (it crashes jsdom on import, and Monaco is heavy), so importing it EAGERLY here would drag
 * Monaco into the whole `FavoriteSurface` module graph (every favorites surface, even a non-terminal
 * one). The lazy boundary keeps that import out of the graph until a terminal favorite actually
 * renders POPULATED — reuse-in-place (the SAME component, per the coordinator's steer), without the
 * import coupling. The mirror never mounts Monaco at runtime anyway (FR-017: the explorer hook is
 * inert in mirror mode).
 */
const TerminalView = lazy(() =>
  import('../terminal/TerminalPanel').then((m) => ({ default: m.TerminalView }))
)

/** Mirror passes these no-op panel callbacks — it is not part of the Terminal panel's bookkeeping. */
const noopReport = (): void => {}
const noopRegister = (): (() => void) => () => {}

export function TerminalFavoriteSurface({
  source,
  onUnpin
}: {
  source: { tabId: string }
  /** Unpin this favorite (the gone-source empty state's only action; same path as the strip `X`). */
  onUnpin: () => void
}): React.JSX.Element {
  const registry = useAllPanelTabs()
  const live = findLiveTab(registry, 'terminal', source.tabId)
  const Glyph = SURFACE_ICON.terminal

  // GONE: the source terminal tab is not currently published. Calm empty state; never auto-dropped.
  if (!live) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-3 text-center text-card-foreground"
        role="tabpanel"
      >
        <Glyph className="size-6 text-muted-foreground" />
        <p className="text-body text-foreground">This tab is no longer open</p>
        <p className="max-w-xs text-caption text-muted-foreground">
          The source terminal was closed. Its shortcut stays here until you unpin it.
        </p>
        <Button variant="secondary" size="sm" onClick={onUnpin}>
          Unpin
        </Button>
      </div>
    )
  }

  // WAITING: the source pane is published but its PTY is not live yet (a fresh awaiting tab). Flips to
  // the live mirror the instant the pane goes live (when `serialize` is published).
  if (!live.serialize) {
    return (
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-3 text-center text-card-foreground"
        role="tabpanel"
      >
        <Glyph className="size-6 text-muted-foreground" />
        <p className="text-caption text-muted-foreground">Waiting for this terminal…</p>
      </div>
    )
  }

  // POPULATED (live mirror): a SECOND xterm bound to the source `paneId`, seeded from its current
  // scrollback then fanned in live. `mirror` keeps it non-owning (no start/dispose/restart). The seed
  // is read ONCE here (the lazy view mounts with it as `initialScrollback`).
  const seed = live.serialize()
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col text-card-foreground" role="tabpanel">
      <Suspense
        fallback={
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
            <Glyph className="size-6 text-muted-foreground" />
            <p className="text-caption text-muted-foreground">Opening terminal…</p>
          </div>
        }
      >
        <TerminalView
          paneId={source.tabId}
          mirror
          active
          autoStart={false}
          initialScrollback={seed}
          onOpenFilesChange={noopReport}
          onViewerStateChange={noopReport}
          registerSerializer={noopRegister}
        />
      </Suspense>
    </div>
  )
}
