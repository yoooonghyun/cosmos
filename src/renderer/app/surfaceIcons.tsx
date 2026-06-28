/**
 * surfaceIcons — the SINGLE SOURCE OF TRUTH for every rail surface's icon.
 *
 * cosmos-footer-and-icon-unify-v1: the left rail (`RAIL_ITEM` in `App.tsx`) and each
 * panel's `PanelFooter` previously picked their icon independently, so the footer icon
 * drifted from the rail icon (e.g. Slack footer showed lucide `MessageSquare` while the
 * rail showed the `SiSlack` brand mark). Both now consume `SURFACE_ICON`, so the footer
 * icon == the rail icon BY CONSTRUCTION — there is no second place to drift.
 *
 * Icons mix the inline `ClaudeCodeIcon`/`CosmosGlyphIcon` (custom currentColor SVGs), the
 * react-icons/si brand logos (Jira/Confluence/Slack/Google Calendar), and the Claude Code
 * mark from simple-icons. All render an SVG that accepts `className` and inherits
 * `currentColor`, so the rail's active/idle color cascade is identical and they render fine
 * at the footer's `size-3` (DESIGN.md rule D-10).
 */
import { SiConfluence, SiGooglecalendar, SiJira, SiSlack } from 'react-icons/si'
import { siClaudecode } from 'simple-icons'
import type { SurfaceId } from './railVisibility'

/** A rail/footer icon: any component that accepts `className` and inherits `currentColor`. */
export type RailIcon = React.ComponentType<{ className?: string }>

// simple-icons ships raw SVG path data (no React component), so wrap the Claude Code mark in
// a currentColor SVG matching the react-icons/lucide contract.
export const ClaudeCodeIcon: RailIcon = ({ className }) => (
  <svg role="img" viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d={siClaudecode.path} />
  </svg>
)

// Cosmos rail glyph: the `cosmos-small-white.svg` four-point sparkle, MONOCHROME — the colored
// background rect + radial gradient are dropped and the mark is `fill="currentColor"` so it tracks
// the rail's active/idle color cascade exactly like the other rail icons (not the pastel brand mark).
export const CosmosGlyphIcon: RailIcon = ({ className }) => (
  <svg role="img" viewBox="80 80 352 352" className={className} fill="currentColor" aria-hidden>
    <g transform="translate(256,256) scale(2.78)">
      <path d="M 0.00 -60.00 Q 9.55 -47.99 9.18 -22.17 Q 27.18 -40.68 42.43 -42.43 Q 40.68 -27.18 22.17 -9.18 Q 47.99 -9.55 60.00 0.00 Q 47.99 9.55 22.17 9.18 Q 40.68 27.18 42.43 42.43 Q 27.18 40.68 9.18 22.17 Q 9.55 47.99 0.00 60.00 Q -9.55 47.99 -9.18 22.17 Q -27.18 40.68 -42.43 42.43 Q -40.68 27.18 -22.17 9.18 Q -47.99 9.55 -60.00 0.00 Q -47.99 -9.55 -22.17 -9.18 Q -40.68 -27.18 -42.43 -42.43 Q -27.18 -40.68 -9.18 -22.17 Q -9.55 -47.99 0.00 -60.00 Z" />
    </g>
  </svg>
)

/**
 * The icon for every rail surface, keyed by `SurfaceId`. Consumed by BOTH `RAIL_ITEM`
 * (App.tsx) and every `PanelFooter` so the two never diverge (DESIGN.md rule D-10).
 */
export const SURFACE_ICON: Record<SurfaceId, RailIcon> = {
  terminal: ClaudeCodeIcon,
  cosmos: CosmosGlyphIcon,
  slack: SiSlack,
  jira: SiJira,
  confluence: SiConfluence,
  'google-calendar': SiGooglecalendar
}
