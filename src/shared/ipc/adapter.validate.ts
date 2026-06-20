/**
 * API→UI generative adapter — boundary validators (jira-generative-adapter-v1).
 * Spec: .sdd/specs/jira-generative-adapter-v1.md (FR-007/FR-009/FR-010/FR-019/FR-022).
 * Re-exported (unchanged) through the `src/shared/validate.ts` barrel.
 *
 * SHARED (panel-agnostic) validators for the cross-process adapter payloads: a
 * reserved `adapter.*` action (R->M, intercepted at the `ui:action` boundary), the
 * multi-region bindings array, and the persisted secret-free descriptor. Every one is
 * pure with an injectable `warn`; an invalid/malformed payload is warned and returned
 * null so the caller IGNORES it — never a crash (FR-022/FR-023). The descriptor
 * validator additionally STRIPS to the known non-secret shape so no token can ride
 * along into the snapshot (FR-007/FR-021).
 */

import type { AdapterActionRequest, AdapterBinding, AdapterDescriptor, AdapterQuery } from '../adapter'
import { AdapterAction, isAdapterActionId } from '../adapter'
import type { UiRenderTarget } from './common'
import { JiraAdapterSource } from '../jira'
import { SlackAdapterSource } from '../slack'
import { ConfluenceAdapterSource } from '../confluence'
import { GoogleCalendarAdapterSource } from '../googleCalendar'
import { defaultWarn, isNonEmptyString, isObject, type WarnFn } from './common.validate'

/**
 * Map a validated `ui:action` whose `actionId` is in the reserved `adapter.*`
 * namespace to a discriminated {@link AdapterActionRequest} for the dispatcher
 * (FR-019). Required context: a non-empty `surfaceId` (which bound surface the action
 * targets — FR-010); `adapter.page` additionally requires a `direction` of
 * `'next'`/`'prev'` (FR-016). An unknown `adapter.*` name or a missing/invalid
 * required field → null + warn (no dispatch). NOTE: the caller checks the namespace
 * first via `isAdapterActionId`; a non-`adapter.*` actionId here returns null.
 */
export function validateAdapterAction(
  actionId: string | undefined,
  values: Record<string, unknown> | undefined,
  warn: WarnFn = defaultWarn
): AdapterActionRequest | null {
  if (!isAdapterActionId(actionId)) {
    warn('[adapter] ignoring action — not in the reserved adapter.* namespace:', actionId)
    return null
  }
  const raw = values ?? {}
  if (!isNonEmptyString(raw.surfaceId)) {
    warn('[adapter] ignoring action — required "surfaceId" must be a non-empty string:', actionId)
    return null
  }
  const surfaceId = raw.surfaceId
  // Optional region (componentId) on every adapter.* action (multi-region surfaces). A
  // non-string is warned + dropped (the action proceeds surface-wide). Refresh with no
  // region fans out to every region; loadMore/page with no region target the lone region.
  const region = isNonEmptyString(raw.region) ? raw.region : undefined
  if (raw.region !== undefined && region === undefined) {
    warn('[adapter] ignoring "region" — must be a non-empty string (proceeding surface-wide):', raw)
  }
  switch (actionId) {
    case AdapterAction.Refresh: {
      // FR-013: a restore/re-activation refresh MAY carry the persisted descriptor so
      // main lazily (re-)registers a surface it never freshly composed. Validated +
      // secret-screened by validateAdapterDescriptor; an invalid one is dropped (warn)
      // and the refresh proceeds without re-registration (a manual refresh has none).
      const descriptor =
        raw.descriptor !== undefined ? validateAdapterDescriptor(raw.descriptor, warn) : null
      // A restored MULTI-region surface carries its persisted bindings for lazy re-registration
      // of every region; target-agnostic on this path (restore), so no target screen.
      const bindings =
        raw.bindings !== undefined ? validateAdapterBindings(raw.bindings, warn) : null
      return {
        name: AdapterAction.Refresh,
        surfaceId,
        ...(descriptor ? { descriptor } : {}),
        ...(bindings ? { bindings } : {}),
        ...(region ? { region } : {})
      }
    }
    case AdapterAction.LoadMore:
      return { name: AdapterAction.LoadMore, surfaceId, ...(region ? { region } : {}) }
    case AdapterAction.Page: {
      if (raw.direction !== 'next' && raw.direction !== 'prev') {
        warn('[adapter] ignoring adapter.page — "direction" must be "next" or "prev":', raw)
        return null
      }
      return { name: AdapterAction.Page, surfaceId, direction: raw.direction, ...(region ? { region } : {}) }
    }
    default:
      warn('[adapter] ignoring action — unknown adapter.* action name:', actionId)
      return null
  }
}

/**
 * Validate + STRIP an array of {@link AdapterBinding}s attached to a `render_*_ui` frame
 * (refreshable-custom-generative-ui multi-region). Each entry must have a non-empty
 * `componentId` (the container to rebind) and a valid secret-free `descriptor` (screened by
 * {@link validateAdapterDescriptor} — cross-target + secret-stripped against `target`). A
 * malformed entry is warned and DROPPED individually (the rest still bind); a non-array, or
 * an array that yields zero valid entries, returns null so the caller falls back to the
 * single-region `descriptor` path. Duplicate `componentId`s keep the FIRST (a container can
 * bind only one region); later collisions are warned + dropped.
 */
export function validateAdapterBindings(
  raw: unknown,
  warn: WarnFn = defaultWarn,
  target?: UiRenderTarget
): AdapterBinding[] | null {
  if (!Array.isArray(raw)) {
    warn('[adapter] ignoring bindings — not an array:', raw)
    return null
  }
  const seen = new Set<string>()
  const bindings: AdapterBinding[] = []
  for (const entry of raw) {
    if (!isObject(entry)) {
      warn('[adapter] dropping binding — not an object:', entry)
      continue
    }
    if (!isNonEmptyString(entry.componentId)) {
      warn('[adapter] dropping binding — "componentId" must be a non-empty string:', entry)
      continue
    }
    if (seen.has(entry.componentId)) {
      warn('[adapter] dropping binding — duplicate componentId (a container binds one region):', entry.componentId)
      continue
    }
    const descriptor = validateAdapterDescriptor(entry.descriptor, warn, target)
    if (!descriptor) {
      continue
    }
    seen.add(entry.componentId)
    bindings.push({ componentId: entry.componentId, descriptor })
  }
  if (bindings.length === 0) {
    return null
  }
  return bindings
}

/** A token-bearing key NEVER allowed in a descriptor's `query` (FR-007/FR-021). */
const SECRET_QUERY_KEYS = new Set<string>([
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'clientSecret',
  'client_secret',
  'authorization',
  'auth',
  'bearer',
  'secret',
  'password'
])

/**
 * The set of adapter `dataSource` ids each render target's integration owns
 * (panel-refresh-v1 OQ-4 / FR-012). A descriptor attached to a `render_*_ui` frame must
 * name a source belonging to THAT frame's target — a cross-target descriptor (e.g. a Jira
 * `dataSource` on a `target:'slack'` frame) is rejected. `'generated-ui'` is permissive:
 * the generic render tool may emit a descriptor for ANY integration source (its catalog
 * is generic), so it accepts the union. Reuses the per-integration `*AdapterSource`
 * constants so this membership never drifts from the resolvers/bind options.
 */
const TARGET_ADAPTER_SOURCES: Record<UiRenderTarget, ReadonlySet<string>> = {
  slack: new Set(Object.values(SlackAdapterSource)),
  jira: new Set(Object.values(JiraAdapterSource)),
  confluence: new Set(Object.values(ConfluenceAdapterSource)),
  'google-calendar': new Set(Object.values(GoogleCalendarAdapterSource)),
  'generated-ui': new Set([
    ...Object.values(SlackAdapterSource),
    ...Object.values(JiraAdapterSource),
    ...Object.values(ConfluenceAdapterSource),
    ...Object.values(GoogleCalendarAdapterSource)
  ])
}

/**
 * True when `dataSource` belongs to `target`'s integration (panel-refresh-v1 OQ-4). The
 * generic `'generated-ui'` target accepts any known source.
 */
export function adapterSourceMatchesTarget(dataSource: string, target: UiRenderTarget): boolean {
  return TARGET_ADAPTER_SOURCES[target]?.has(dataSource) ?? false
}

/**
 * Validate + STRIP a persisted adapter descriptor (FR-005/FR-007). Required: a
 * non-empty `dataSource` and an object `query`. The query is COPIED key-by-key,
 * DROPPING any key whose name matches a known secret token (`token`,
 * `access_token`, `client_secret`, … — FR-007/FR-021) so a secret can never be
 * persisted/round-tripped even if a caller mistakenly attached one. A malformed
 * descriptor is warned and IGNORED (returns null) so a restore re-fetch is simply
 * skipped (FR-022). The returned descriptor is the same `{ dataSource, query }`
 * shape, guaranteed secret-free.
 *
 * panel-refresh-v1 (OQ-4 / FR-012): when a `target` is supplied (the render-frame path),
 * the `dataSource` MUST belong to that target's integration; a cross-target descriptor is
 * warned + ignored (returns null). When `target` is omitted (the restore/re-activation
 * refresh path, which is target-agnostic) the membership check is skipped.
 */
export function validateAdapterDescriptor(
  raw: unknown,
  warn: WarnFn = defaultWarn,
  target?: UiRenderTarget
): AdapterDescriptor | null {
  if (!isObject(raw)) {
    warn('[adapter] ignoring descriptor — not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.dataSource)) {
    warn('[adapter] ignoring descriptor — required "dataSource" must be a non-empty string:', raw)
    return null
  }
  if (!isObject(raw.query)) {
    warn('[adapter] ignoring descriptor — required "query" must be an object:', raw)
    return null
  }
  if (target !== undefined && !adapterSourceMatchesTarget(raw.dataSource, target)) {
    warn(
      '[adapter] ignoring descriptor — dataSource does not belong to the frame target (cross-target):',
      raw.dataSource,
      target
    )
    return null
  }
  const query: AdapterQuery = {}
  for (const [key, value] of Object.entries(raw.query)) {
    if (SECRET_QUERY_KEYS.has(key)) {
      warn('[adapter] stripping secret-looking key from descriptor query (FR-007):', key)
      continue
    }
    query[key] = value
  }
  return { dataSource: raw.dataSource, query }
}
