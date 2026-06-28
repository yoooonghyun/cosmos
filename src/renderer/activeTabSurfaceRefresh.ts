/**
 * activeTabSurfaceRefresh — PURE, React-free, target-AGNOSTIC trigger/dispatch logic for
 * the tab-switch auto-refresh of a bound generative surface (jira-tab-switch-auto-refresh-v1).
 *
 * WHY a parent-driven predicate. Only the ACTIVE generative tab's `<A2UIProvider
 * key={activeTab.id}>` is mounted, so switching away and back REMOUNTS `ActiveTabSurface`
 * and discards the live A2UI SDK data-model of a BOUND surface (a kanban's rows live only
 * in that SDK state, never on `surface.dataModel`). The remounted surface repaints its
 * stored spec with empty `{path}` bindings → a blank board until a manual refresh. This
 * feature makes that refresh fire automatically on re-activation, reusing the existing
 * `adapter.refresh` dispatch + in-place `updateDataModel` repaint (no new IPC, no main
 * change, no view re-compose).
 *
 * The "was this surface already painted once?" decision must live ABOVE the keyed remount
 * boundary, so the surviving PARENT (`JiraPanel`, effect keyed on `activeTabId`) drives the
 * trigger and keeps the last-handled `requestId`. This module holds the two PURE decisions
 * it consults so they are unit-testable in the vitest NODE env (no `.tsx`/DOM import, per the
 * `.ts`/`.test.ts` split convention):
 *
 *   - {@link shouldAutoRefreshOnActivation} — fire iff the activated tab has a non-errored
 *     BOUND surface AND this is a RE-activation (its `requestId` was already painted before),
 *     NOT the surface's first live paint (avoids a redundant first-page re-fetch on a fresh
 *     compose / default read).
 *   - {@link autoRefreshValues} — the secret-free `adapter.refresh` `values` to dispatch
 *     (`{ surfaceId, bindings }` for a multi-region board, `{ surfaceId, descriptor }` for a
 *     single-region list), or `null` for a non-bound surface.
 *
 * Both key on BOUND-ness, never on `target === 'jira'` — the mechanism is target-agnostic in
 * shape (FR-015); only Jira wires it in v1. No value carries a token or secret — only the
 * already-secret-free `descriptor`/`bindings` the manual refresh already sends (FR-013).
 */

import type { AdapterBinding, AdapterDescriptor } from '../shared/types/adapter'

/** The minimal surface slice the auto-refresh decision reads (no React types). */
export interface SurfaceForAutoRefresh {
  /** The active surface's requestId — identifies one painted surface instance. */
  requestId: string
  /** The A2UI spec — its `surfaceId` keys the data model the refresh re-paints. */
  spec: { surfaceId: string }
  /** The secret-free descriptor; present only for a SINGLE-region bound surface. */
  descriptor?: AdapterDescriptor
  /** The secret-free per-container bindings; present only for a MULTI-region bound surface. */
  bindings?: AdapterBinding[]
  /** Set when the surface could not be rendered — never auto-refreshed (safe fallback). */
  error?: string
}

/** The inputs the parent-driven auto-refresh predicate consults on a tab (re)activation. */
export interface AutoRefreshActivationInput {
  /** The now-active tab's surface, or `null` for an empty / not-yet-composed tab. */
  surface: SurfaceForAutoRefresh | null
  /**
   * True when the parent has ALREADY painted (handled the activation of) this surface's
   * `requestId` before — i.e. the surface is being RE-activated, not first-painted. The
   * parent owns a set of seen requestIds ABOVE the keyed remount boundary: a surface's FIRST
   * activation is recorded + skipped (so a fresh compose / default read does not redundantly
   * re-fetch its first page), and a later switch-back re-presents the SAME requestId (the
   * keyed `<A2UIProvider key={tab.id}>` remounted the child, but the surface record is
   * unchanged) → `true`, which lets the one-shot auto-refresh fire. A set (not a single slot)
   * so re-activating tab A after visiting B still recognises A as already-painted (FR-011).
   */
  hasPaintedBefore: boolean
}

/** The secret-free `adapter.refresh` `values` for the auto-refresh dispatch. */
export type AutoRefreshValues =
  | { surfaceId: string; bindings: AdapterBinding[] }
  | { surfaceId: string; descriptor: AdapterDescriptor }

/** True when a surface carries a (non-empty) re-fetch intent — descriptor or bindings. */
function isBound(surface: SurfaceForAutoRefresh): boolean {
  return (
    (Array.isArray(surface.bindings) && surface.bindings.length > 0) ||
    surface.descriptor !== undefined
  )
}

/**
 * The secret-free `adapter.refresh` `values` for a surface, or `null` when it is non-bound.
 * A MULTI-region surface re-registers EVERY region via its `bindings`; a single-region
 * surface via its `descriptor` (the two are mutually exclusive — bindings preferred when both
 * are somehow present). Mirrors `ActiveTabSurface`'s manual selection, extracted for reuse +
 * test. Carries ONLY the already-secret-free descriptor/bindings — no token (FR-013).
 */
export function autoRefreshValues(
  surface: SurfaceForAutoRefresh | null
): AutoRefreshValues | null {
  if (!surface || surface.error) {
    return null
  }
  const surfaceId = surface.spec?.surfaceId
  if (typeof surfaceId !== 'string' || surfaceId.length === 0) {
    return null
  }
  if (Array.isArray(surface.bindings) && surface.bindings.length > 0) {
    return { surfaceId, bindings: surface.bindings }
  }
  if (surface.descriptor) {
    return { surfaceId, descriptor: surface.descriptor }
  }
  return null
}

/**
 * Decide whether a tab (re)activation should fire the one-shot auto-refresh. True iff ALL:
 *  - the now-active tab HAS a surface (an empty / not-yet-composed tab fires nothing — FR-006);
 *  - that surface is NOT in error (a failed surface keeps its failure presentation — FR-006);
 *  - it is BOUND — carries a `descriptor` or non-empty `bindings` (a static, non-bound surface
 *    repaints from its stored spec verbatim, no auto-refresh — FR-005); AND
 *  - this is a RE-activation, not the surface's FIRST live paint: the parent has already
 *    painted this surface's requestId (`hasPaintedBefore`). The parent records a surface's
 *    requestId on its first activation and skips it, so a fresh compose / default read does
 *    NOT double-refresh (FR-004/FR-012); a switch-back re-presents that requestId → fires once
 *    per remount.
 *
 * PURE + total: never throws; a malformed/partial surface returns false. Keys on bound-ness,
 * never on the panel target (FR-015 target-agnostic shape).
 */
export function shouldAutoRefreshOnActivation(input: AutoRefreshActivationInput): boolean {
  const { surface, hasPaintedBefore } = input
  if (!surface || surface.error) {
    return false
  }
  if (typeof surface.requestId !== 'string' || surface.requestId.length === 0) {
    return false
  }
  if (!isBound(surface)) {
    return false
  }
  // First live paint of THIS surface (parent has not recorded it) → skip; the parent records
  // it and a later re-activation (same requestId, hasPaintedBefore true) fires.
  return hasPaintedBefore
}
