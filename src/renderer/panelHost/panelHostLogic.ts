/**
 * panelHostLogic — the PURE host-selection logic for the live-panel reparenting portal
 * (cosmos-favorite-live-panel-portal-v1). Framework-free + node-testable (no React/DOM import —
 * only erased `import type`s), per the `.ts`/`.test.ts` split.
 *
 * A Home favorite of a generative panel renders the LIVE source panel itself by RELOCATING its
 * single force-mounted instance between two mount points: the panel's RAIL slot (default) and the
 * Home FAVORITE slot (when a favorite of it is the active Home tab). `hostFor` is the deterministic,
 * total function of `(visibleSurface, activeFavoriteSource)` that picks the single host — guaranteeing
 * exactly one OutPortal claims each node (the ONE-CLAIMER invariant). `panelVisible` is the redefined
 * "is this panel on screen" signal that feeds the panel's `active` prop (rail-active OR hosted in the
 * active favorite).
 */

import type { SurfaceId } from '../app/railVisibility'
import type { CrossPanelId } from '../panelTabs'

/** The four generative panels that get a relocatable portal node (terminal + cosmos do NOT). */
export type GenerativePanelId = 'jira' | 'slack' | 'confluence' | 'google-calendar'

/** The relocatable generative panel ids, in rail order. */
export const GENERATIVE_PANEL_IDS: readonly GenerativePanelId[] = [
  'slack',
  'jira',
  'confluence',
  'google-calendar'
]

/** True for one of the four relocatable generative panel ids (terminal is excluded). */
export function isGenerativePanelId(id: CrossPanelId): id is GenerativePanelId {
  return id !== 'terminal'
}

/** Where a generative panel's single instance is currently hosted. */
export type PanelHost = 'rail' | 'favorite'

/** The source tab a Home favorite points at (the active Home favorite, or null). */
export interface ActiveFavoriteSource {
  panelId: CrossPanelId
  tabId: string
}

/**
 * The ONE-CLAIMER selector: pick the single mount point for `panelId`'s instance. The Home FAVORITE
 * slot claims it iff Home is the visible surface AND the active Home favorite points at this panel;
 * otherwise the RAIL slot claims it. Because both render sites read the SAME `(visibleSurface,
 * activeFavoriteSource)` they always agree — never both, never neither (in steady state). Pure.
 */
export function hostFor(
  panelId: GenerativePanelId,
  visibleSurface: SurfaceId,
  activeFavoriteSource: ActiveFavoriteSource | null
): PanelHost {
  return visibleSurface === 'cosmos' && activeFavoriteSource?.panelId === panelId
    ? 'favorite'
    : 'rail'
}

/**
 * The redefined "visible" signal feeding a generative panel's `active` prop: true when the panel is
 * the visible rail surface OR is hosted in the active Home favorite. Drives render/auto-scroll/resize,
 * the default-view fetch gate, and the panel's own `useTabShortcuts`. Pure.
 */
export function panelVisible(
  visibleSurface: SurfaceId,
  activeFavoriteSource: ActiveFavoriteSource | null,
  panelId: GenerativePanelId
): boolean {
  return (
    visibleSurface === panelId ||
    (visibleSurface === 'cosmos' && activeFavoriteSource?.panelId === panelId)
  )
}
