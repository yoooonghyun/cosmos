/**
 * SharedComposer — the ONE hoisted Open-Prompt composer (open-prompt-hoist-v1).
 *
 * Reads the ACTIVE surface's published composer wiring from the registry
 * (`useActiveComposerConfig`) and renders a SINGLE `PromptComposer` for the surface region —
 * one floating button + one shared draft + one shared drag/position, mounted once at the App
 * level. The submit routes to whichever panel is active (its published `onSubmit`); a surface
 * with no published composer (Terminal, or a disconnected integration) renders nothing.
 *
 * Per-surface MODE (cosmos-open-prompt-pinned-v1, OQ-1 Option A): Cosmos ⇒ docked (an in-flow
 * `shrink-0` bottom slot), everything else ⇒ floating (`absolute inset-0` overlay,
 * pointer-events-none so the panel behind stays clickable). The docked branch additionally
 * renders the Cosmos name+status footer BELOW the composer band
 * (footer-placement-cosmos-terminal-v1) so the column order is timeline → composer → footer.
 *
 * Footer DECOUPLED from the composer config (home-favorite-missing-footer-v1): the "Home"
 * name+status footer is part of the docked surface CHROME, not the composer, so it renders on the
 * cosmos/docked surface REGARDLESS of whether a composer config is published. When a Home FAVORITE
 * tab is active, `CosmosPanel` publishes a NULL `'cosmos'` config (it hides the docked Cosmos
 * composer and overlays the SOURCE panel's floating Open-Prompt instead) — so the early
 * `if (!config) return null` would also drop the footer. The docked branch therefore renders the
 * footer ALWAYS and the composer BAND only when a config is present (footer is idle "Home" when
 * config is null; `config.busy` drives it otherwise). The floating branch (every other surface)
 * still renders nothing when its config is null (a disconnected integration shows no chrome).
 *
 * Extracted from `App.tsx` into its own module so it can be rendered in a jsdom test WITHOUT
 * pulling in App's heavy panel imports (Monaco etc., which crash under jsdom).
 */
import type { SurfaceId } from './railVisibility'
import { SURFACE_ICON } from './surfaceIcons'
import { PanelFooter } from './PanelFooter'
import type { PanelTab } from '../tabs/PanelTabStrip'
import { useActiveComposerConfig } from '../composer/ActiveComposerProvider'
import { composerModeForSurface } from '../composer/activeComposer'
import { PromptComposer } from '../composer/PromptComposer'

export function SharedComposer({
  surface,
  surfaceRef
}: {
  surface: SurfaceId
  surfaceRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const config = useActiveComposerConfig(surface)
  // The per-surface render mode is a pure function of the ACTIVE surface — computed BEFORE the
  // early return so the hook order is identical regardless of `config`; the single
  // `PromptComposer` instance stays mounted (no `key={surface}`) so its draft never resets on a
  // panel switch.
  const mode = composerModeForSurface(surface)
  // The composer BAND only exists when this surface published a config; a null config (Terminal,
  // a disconnected integration, or a Home favorite tab that suppressed the docked Cosmos composer)
  // yields no band. The docked footer below is rendered independently of this (see the comment on
  // the docked branch — home-favorite-missing-footer-v1).
  const composer = config ? (
    <PromptComposer
      // NO `key={surface}`: the single instance MUST stay mounted across panel switches so it
      // never re-measures (the whole point of the hoist — no flicker). The submit routes to the
      // active surface via the published `onSubmit` (open-prompt-hoist-v1).
      panelRef={surfaceRef}
      mode={mode}
      // OQ-2: auto-focus the docked Cosmos input on activation (only relevant when docked).
      autoFocusActive={mode === 'docked' && surface === 'cosmos'}
      onSubmit={config.onSubmit}
      placeholder={config.placeholder}
      ariaLabel={config.ariaLabel}
      {...(config.contextChip ? { contextChip: config.contextChip } : {})}
      busy={config.busy ?? false}
    />
  ) : null
  // docked (Cosmos): an in-flow `shrink-0` bottom slot — the LAST flex children of the
  // `surfaceRef` column. The composer body inside is an INSET, rounded `max-w-2xl` card centered
  // by the wrapper; `bg-card border-l border-border` continues the panel surface to the bottom
  // edge (color-seam fix). The Cosmos name+status footer renders BELOW the composer band so the
  // column order is timeline → composer → footer (footer-placement-cosmos-terminal-v1); its
  // in-flight spinner is driven by the active surface's `config.busy`.
  //
  // The footer renders ALWAYS on the docked surface — even when `config` is null (a Home favorite
  // tab suppressed the docked Cosmos composer): it is idle "Home" then, and the composer band is
  // simply omitted (home-favorite-missing-footer-v1). When a config IS present the band renders
  // and `config.busy` drives the footer spinner.
  if (mode === 'docked') {
    const footerTab: PanelTab = {
      id: 'cosmos',
      label: 'Home',
      status: config?.busy ? 'in-flight' : 'idle'
    }
    return (
      <>
        {composer && (
          <div className="flex shrink-0 justify-center border-l border-border bg-card px-3 pt-3 pb-8">
            {composer}
          </div>
        )}
        <div className="shrink-0 border-l border-border">
          <PanelFooter surfaceName="Home" icon={SURFACE_ICON.cosmos} activeTab={footerTab} />
        </div>
      </>
    )
  }
  // floating (every other surface): the `pointer-events-none absolute inset-0` overlay. A null
  // config ⇒ no composer ⇒ render nothing (a disconnected integration shows no chrome).
  if (!composer) {
    return null
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">{composer}</div>
  )
}
