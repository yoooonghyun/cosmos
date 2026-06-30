/**
 * tabIconRegistry — the renderer-only map from a per-tab `iconId` to its lucide component
 * (cosmos-random-tab-icons-v1, FR-001).
 *
 * This is the ONLY place that imports the 14 lucide glyphs. The id VOCABULARY + the pure
 * helpers (random / deterministic-fallback / membership) live in the framework-free
 * `src/shared/tabIcons.ts` so the main-process validator can share the set without importing
 * React/lucide. A test asserts every {@link TabIconId} has a component here (no missing/extra).
 *
 * DESIGN: this is a SECOND, sanctioned tab-glyph source DISTINCT from D-10's rail/footer
 * `SURFACE_ICON` (which identifies a rail surface). These glyphs are per-tab distinguishers,
 * bounded to the panel tab strips + the Cosmos Home tree; they never touch the rail/footer and
 * never replace `SURFACE_ICON`. They render at the existing `size-3.5` muted→foreground tab-glyph
 * treatment (currentColor) — no new tokens.
 */
import {
  Atom,
  Earth,
  Moon,
  MoonStar,
  Orbit,
  Rocket,
  Satellite,
  SatelliteDish,
  Sparkle,
  Sparkles,
  Star,
  Sun,
  SunMoon,
  Telescope
} from 'lucide-react'
import type { RailIcon } from '../app/surfaceIcons'
import { type TabIconId, isTabIconId } from '../../shared/tabIcons'

/**
 * Every {@link TabIconId} → its lucide component. A lucide icon satisfies {@link RailIcon}
 * (`{ className? }` + currentColor), so it renders in the SAME slot/treatment the existing
 * terminal/favorite tab glyph uses. Exhaustive over the union (a missing id is a TS error).
 */
export const TAB_ICON_BY_ID: Record<TabIconId, RailIcon> = {
  rocket: Rocket,
  orbit: Orbit,
  satellite: Satellite,
  'satellite-dish': SatelliteDish,
  telescope: Telescope,
  atom: Atom,
  star: Star,
  'moon-star': MoonStar,
  moon: Moon,
  sun: Sun,
  'sun-moon': SunMoon,
  sparkle: Sparkle,
  sparkles: Sparkles,
  earth: Earth
}

/**
 * Resolve an `iconId` to its lucide component, or `undefined` when the id is absent/unknown —
 * so each call site supplies its OWN fallback (the strip falls back to `SquareTerminal` for a
 * terminal tab; the Home tree falls back to `AppWindow`). FR-007/FR-010.
 */
export function tabIconComponent(id: string | undefined): RailIcon | undefined {
  return isTabIconId(id) ? TAB_ICON_BY_ID[id] : undefined
}
