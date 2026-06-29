/**
 * Pure rail-visibility logic (settings-redesign-v1, FR-004/FR-005/FR-014).
 *
 * No React/DOM imports — just the rules that turn the per-integration `enabled`
 * preference into the ordered set of visible rail surfaces, and the disable-active
 * refocus fallback. Kept node-testable (.ts) so App.tsx can stay a thin shell over
 * these rules (railVisibility.test.ts exercises them without a renderer).
 */

import type { EnabledIntegrations, GateableIntegration } from '../../shared/ipc'

/**
 * Every rail surface id (Terminal + Cosmos are NOT integrations — FR-005).
 *
 * NOTE (cosmos-conversation-panel-v1): the rail surface id `'cosmos'` is DISTINCT from the
 * wire `UiRenderTarget` `'generated-ui'` (`src/shared/ipc/common.ts`). The Cosmos panel renders
 * the general-purpose agent's render frames, which still target the WIRE `'generated-ui'`; only
 * the rail id was renamed. Do NOT "finish the rename" into the wire target or the persisted
 * snapshot key — that would break render routing + session restore.
 */
export type SurfaceId = 'terminal' | 'cosmos' | GateableIntegration

/**
 * The display label for every rail surface, keyed by `SurfaceId`. The SINGLE source consumed by
 * the rail (App.tsx `RAIL_ITEM`), every `PanelFooter`, AND the Cosmos panel-tab tree's group
 * headers (cosmos-panel-tab-list-v1) — so a surface's label can never drift between them. Pure
 * (no React/DOM), so node-testable + importable by the renderer tree + App alike.
 *
 * cosmos-conversation-panel-v1: the rail id is `'cosmos'` (the WIRE render target stays
 * `'generated-ui'`); the Cosmos brand mark is `CosmosGlyphIcon` (see `surfaceIcons.tsx`).
 */
export const RAIL_LABEL: Record<SurfaceId, string> = {
  terminal: 'Terminal',
  cosmos: 'Home',
  slack: 'Slack',
  jira: 'Jira',
  confluence: 'Confluence',
  'google-calendar': 'Google Calendar'
}

/** The always-present surfaces — never gated, never have an Enable toggle (FR-005). Cosmos sits
 *  ABOVE Terminal in the rail (order = rail order); Terminal remains the default/fallback surface. */
export const ALWAYS_PRESENT: SurfaceId[] = ['cosmos', 'terminal']

/** The gateable integration surfaces, in canonical rail order (FR-004). */
export const GATEABLE_SURFACES: GateableIntegration[] = [
  'slack',
  'jira',
  'confluence',
  'google-calendar'
]

/** The full rail order when every integration is enabled (always-present, then gateable). */
export const ALL_SURFACE_IDS: SurfaceId[] = [...ALWAYS_PRESENT, ...GATEABLE_SURFACES]

/**
 * The ordered visible rail surfaces: the always-present items, then each gateable
 * integration that is `enabled`, in the fixed canonical order so an integration's
 * rail position is stable across toggles (FR-004; design §8.3).
 */
export function visibleSurfaceIds(enabled: EnabledIntegrations): SurfaceId[] {
  return ALL_SURFACE_IDS.filter(
    (id) => ALWAYS_PRESENT.includes(id) || enabled[id as GateableIntegration]
  )
}

/**
 * Resolve where focus lands given the current active surface and `enabled` map.
 *
 * If the active surface is still visible, it stays active. Otherwise (it was just
 * disabled) focus falls back to `terminal` — or, defensively, the first remaining
 * visible item if terminal were ever absent (FR-014/SC-007; design §8.4).
 *
 * `visible` is injectable for the defensive test; it defaults to the computed set.
 */
export function resolveFallbackSurface(
  active: SurfaceId,
  enabled: EnabledIntegrations,
  visible: SurfaceId[] = visibleSurfaceIds(enabled)
): SurfaceId {
  if (visible.includes(active)) {
    return active
  }
  if (visible.includes('terminal')) {
    return 'terminal'
  }
  return visible[0] ?? 'terminal'
}
