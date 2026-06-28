/**
 * panelRefreshLogic — PURE derivation of the panel-level refresh control's state from the
 * active tab (panel-refresh-v1, Goal 1 / FR-003/FR-004). No React, no DOM, no IPC — so it
 * is unit-testable in the vitest node env (the `.tsx` button is a thin shell over this).
 *
 * The control acts on the ACTIVE tab's surface. It is REFRESHABLE only when that surface is
 * a registered/bound surface — i.e. it carries a secret-free `descriptor` (the refetch
 * intent main registered with the AdapterDispatcher). An empty/Untitled tab, a surface
 * composed without a descriptor, or an errored surface is NOT refreshable ⇒ the control is
 * disabled (design §3.3/§3.4). While the active tab has a refresh/run in flight the control
 * is BUSY (spinner, click guarded — design §3.2).
 *
 * The dispatch payload mirrors ActiveTabSurface's manual refresh (FR-008): a repeatable
 * `adapter.refresh` `submit` for the active `surfaceId`, carrying the descriptor so main can
 * lazily (re-)register a surface it never freshly composed (e.g. a restored tab) before
 * re-executing. NO token crosses — the descriptor is secret-free by contract.
 */

import type { AdapterBinding, AdapterDescriptor } from '../../shared/types/adapter'

/** The active tab's surface slice the refresh derivation needs (no React types). */
export interface ActiveSurfaceForRefresh {
  /** The active surface's surfaceId — the data-model key the refresh re-paints. */
  surfaceId: string
  /** The secret-free descriptor; present only for a registered/bound SINGLE-region surface. */
  descriptor?: AdapterDescriptor
  /**
   * The secret-free per-container bindings; present only for a registered/bound MULTI-region
   * surface (a kanban). A surface is refreshable when it carries EITHER `descriptor` (single)
   * OR `bindings` (multi) — without this the refresh control wrongly disables a partitioned
   * board, which has no surface-wide descriptor.
   */
  bindings?: AdapterBinding[]
  /** True when the surface failed to render — never refreshable (safe fallback). */
  error?: boolean
}

/** The active tab's relevant slice (its surface + whether a run/refresh is in flight). */
export interface ActiveTabForRefresh {
  surface: ActiveSurfaceForRefresh | null
  /** True while a compose/refresh run is outstanding for this tab (busy state). */
  busy?: boolean
}

/** The control's derived presentation state (consumed by `PanelRefreshButton`). */
export interface PanelRefreshState {
  /** False ⇒ the control is rendered `disabled` (no refreshable surface). */
  enabled: boolean
  /** True ⇒ the control shows the spinner + guards its click (design §3.2). */
  busy: boolean
  /** The surfaceId + descriptor/bindings to dispatch on click; null when not refreshable. */
  refresh: { surfaceId: string; descriptor?: AdapterDescriptor; bindings?: AdapterBinding[] } | null
}

/**
 * Derive the refresh control's state from the active tab (or `null` for an empty panel).
 * A tab is refreshable iff it has a non-errored surface with a `surfaceId` AND a refetch
 * intent — EITHER a single-region `descriptor` OR multi-region `bindings` (a kanban has no
 * surface-wide descriptor, only per-container bindings). Busy reflects an in-flight run on
 * that tab. A refreshable-but-busy tab stays enabled (the click is guarded in the component,
 * design §3.2) but exposes `busy: true`.
 */
export function derivePanelRefreshState(
  activeTab: ActiveTabForRefresh | null
): PanelRefreshState {
  const busy = activeTab?.busy === true
  const surface = activeTab?.surface ?? null
  const hasBindings = Array.isArray(surface?.bindings) && surface.bindings.length > 0
  if (
    !surface ||
    surface.error === true ||
    typeof surface.surfaceId !== 'string' ||
    surface.surfaceId.length === 0 ||
    (!surface.descriptor && !hasBindings)
  ) {
    return { enabled: false, busy, refresh: null }
  }
  return {
    enabled: true,
    busy,
    refresh: {
      surfaceId: surface.surfaceId,
      ...(surface.descriptor ? { descriptor: surface.descriptor } : {}),
      ...(hasBindings ? { bindings: surface.bindings } : {})
    }
  }
}

/**
 * The minimal `GenerativeTab` shape the panel-refresh mapper reads (a structural subset of
 * `useGenerativePanelTabs.GenerativeTab`, declared here so this pure module stays free of
 * React/renderer imports). A panel passes its active tab; the mapper projects the slice the
 * refresh control needs.
 */
export interface GenerativeTabForRefresh {
  surface: {
    requestId: string
    /** The A2UI spec — its `surfaceId` keys the data model the refresh re-paints. */
    spec?: { surfaceId?: string }
    descriptor?: AdapterDescriptor
    /** Per-container bindings for a MULTI-region (partitioned) surface — makes it refreshable. */
    bindings?: AdapterBinding[]
    error?: string
  } | null
  inFlight?: boolean
  loadingDefault?: boolean
}

/**
 * The active surface's `requestId` + the refresh-relevant tab slice, projected from a tab.
 * `activeTab` is ALWAYS a concrete slice (never null): a `null` panel tab projects to a slice
 * whose `surface` is null (an empty/non-refreshable tab), so `derivePanelRefreshState` reads a
 * uniform shape and the button always has inputs.
 */
export interface PanelRefreshInputs {
  activeTab: ActiveTabForRefresh
  requestId: string | null
}

/**
 * Project a panel's active `GenerativeTab` (or `null`) to the `PanelRefreshButton` inputs
 * (the busy flag = an in-flight compose OR a default-view load; the refresh surface slice +
 * its requestId). Shared by all four panels so the projection never drifts. A tab whose
 * surface has no `surfaceId` (a freshly-`updateComponents` surface always carries one via
 * `spec.surfaceId`, threaded by the panel) yields a non-refreshable slice.
 */
export function panelRefreshInputsFor(
  activeTab: GenerativeTabForRefresh | null
): PanelRefreshInputs {
  const surface = activeTab?.surface ?? null
  const busy = activeTab?.inFlight === true || activeTab?.loadingDefault === true
  if (!surface) {
    return { activeTab: { surface: null, busy }, requestId: null }
  }
  const surfaceId = surface.spec?.surfaceId
  return {
    activeTab: {
      surface:
        typeof surfaceId === 'string' && surfaceId.length > 0
          ? {
              surfaceId,
              ...(surface.descriptor ? { descriptor: surface.descriptor } : {}),
              ...(surface.bindings ? { bindings: surface.bindings } : {}),
              ...(surface.error !== undefined ? { error: true } : {})
            }
          : null,
      busy
    },
    requestId: surface.requestId
  }
}

/**
 * Whether a refresh click should actually dispatch (FR-016 / design §3.2): only when the
 * control is enabled AND not busy AND has a refresh target. A busy or disabled click is a
 * guarded no-op (a double click can't stack two refreshes).
 */
export function shouldDispatchRefresh(state: PanelRefreshState): boolean {
  return state.enabled && !state.busy && state.refresh !== null
}
