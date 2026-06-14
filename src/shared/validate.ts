/**
 * Pure, side-effect-light validators for inbound IPC payloads (FR-010, SC-005).
 *
 * The main process MUST validate inbound IPC payloads (input/resize); an invalid
 * or missing required field MUST log a warning and be safely ignored (no crash).
 *
 * These functions are pure with respect to input -> result, and report problems
 * through an injectable `warn` callback so they can be unit-tested without
 * touching the real console. The default `warn` is `console.warn`.
 */

import type {
  A2uiSurfaceUpdate,
  AgentSubmitPayload,
  JiraRequestDefaultViewPayload,
  JiraRequestIssueDetailPayload,
  JiraRequestSearchViewPayload,
  PtyDisposePayload,
  PtyInputPayload,
  PtyResizePayload,
  PtyRestartPayload,
  PtyStartPayload,
  UiActionPayload,
  UiDataModelPayload,
  UiRenderTarget
} from './ipc'
import { DEFAULT_UI_RENDER_TARGET } from './ipc'
import type { AdapterActionRequest, AdapterBinding, AdapterDescriptor, AdapterQuery } from './adapter'
import { AdapterAction, isAdapterActionId } from './adapter'
import type {
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackOpName,
  SlackRepliesParams,
  SlackSearchParams
} from './slack'
import { SlackOp } from './slack'
import type {
  JiraBoundActionRequest,
  JiraCommentParams,
  JiraCreateParams,
  JiraGetIssueParams,
  JiraOpName,
  JiraSearchParams,
  JiraTransitionParams,
  JiraUpdateFields,
  JiraUpdateParams
} from './jira'
import { JiraAdapterSource, JiraBoundAction, JiraOp } from './jira'
import { SlackAdapterSource } from './slack'
import { ConfluenceAdapterSource } from './confluence'
import type {
  ConfluenceCreateParams,
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluenceOpName,
  ConfluenceSearchParams
} from './confluence'
import { ConfluenceOp } from './confluence'

/** Logger shape used for warnings. Injectable for tests. */
export type WarnFn = (message: string, ...args: unknown[]) => void

const defaultWarn: WarnFn = (message, ...args) => console.warn(message, ...args)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validate a `pty:input` payload (FR-004, FR-010; panel-tabs v1 FR-021).
 *
 * Required: `paneId` is a non-empty string (routes to the right terminal tab's
 * PTY) and `data` is a string.
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateInput(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyInputPayload | null {
  if (!isObject(raw)) {
    warn('[pty] ignoring pty:input — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.paneId)) {
    warn('[pty] ignoring pty:input — required field "paneId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.data !== 'string') {
    warn('[pty] ignoring pty:input — required field "data" must be a string:', raw)
    return null
  }
  return { paneId: raw.paneId, data: raw.data }
}

/**
 * Validate a `pty:resize` payload (FR-005, FR-010; panel-tabs v1 FR-021).
 *
 * Required: `paneId` is a non-empty string (routes to the right terminal tab's
 * PTY) and `cols`/`rows` are positive, finite integers.
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateResize(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyResizePayload | null {
  if (!isObject(raw)) {
    warn('[pty] ignoring pty:resize — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.paneId)) {
    warn('[pty] ignoring pty:resize — required field "paneId" must be a non-empty string:', raw)
    return null
  }
  if (!isPositiveInt(raw.cols)) {
    warn('[pty] ignoring pty:resize — required field "cols" must be a positive integer:', raw)
    return null
  }
  if (!isPositiveInt(raw.rows)) {
    warn('[pty] ignoring pty:resize — required field "rows" must be a positive integer:', raw)
    return null
  }
  return { paneId: raw.paneId, cols: raw.cols, rows: raw.rows }
}

/**
 * Validate a `paneId`-only `pty:*` payload (panel-tabs v1, FR-021). Shared by
 * `pty:start` (FR-022), `pty:restart` (FR-026), and `pty:dispose` (FR-023): each
 * carries ONLY the renderer-minted `paneId` that keys the terminal tab's PTY
 * session.
 *
 * Required: `paneId` is a non-empty string. Invalid → warn + ignore (return
 * null) so a malformed frame spawns/restarts/disposes no session.
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validatePaneId(
  raw: unknown,
  channel: string,
  warn: WarnFn = defaultWarn
): { paneId: string } | null {
  if (!isObject(raw)) {
    warn(`[pty] ignoring ${channel} — payload is not an object:`, raw)
    return null
  }
  if (!isNonEmptyString(raw.paneId)) {
    warn(`[pty] ignoring ${channel} — required field "paneId" must be a non-empty string:`, raw)
    return null
  }
  return { paneId: raw.paneId }
}

/** Validate a `pty:start` payload (panel-tabs v1, FR-021/FR-022). */
export function validateStart(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyStartPayload | null {
  return validatePaneId(raw, 'pty:start', warn)
}

/** Validate a `pty:restart` payload (panel-tabs v1, FR-021/FR-026). */
export function validateRestart(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyRestartPayload | null {
  return validatePaneId(raw, 'pty:restart', warn)
}

/** Validate a `pty:dispose` payload (panel-tabs v1, FR-021/FR-023). */
export function validateDispose(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyDisposePayload | null {
  return validatePaneId(raw, 'pty:dispose', warn)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/* ------------------------------------------------------------------------- *
 * Generative UI foundation — headless agent runner
 * Spec: .sdd/specs/generative-ui-foundation-v1.md
 * ------------------------------------------------------------------------- */

/**
 * Coerce an unknown to a valid {@link UiRenderTarget} (Jira generative-UI v2, D1 /
 * v2 FR-004, FR-013). The render `target` is OPTIONAL everywhere it appears:
 *  - ABSENT (`undefined`) → defaults to `'generated-ui'` SILENTLY (the
 *    backward-compatible case — the standard `render_ui` / generic composer omit it).
 *  - a valid `'jira'` / `'generated-ui'` / `'slack'` / `'confluence'` string →
 *    returned as-is (Slack + Confluence generative-UI v1, FR-001).
 *  - any OTHER value → WARNED and defaulted to `'generated-ui'` (a safe fallback
 *    — never crashes, never mis-routes to a custom panel; v2 FR-012, FR-017).
 *
 * Always returns a concrete target so callers need no further null-handling.
 */
export function validateUiRenderTarget(
  raw: unknown,
  warn: WarnFn = defaultWarn
): UiRenderTarget {
  if (raw === undefined) {
    return DEFAULT_UI_RENDER_TARGET
  }
  if (raw === 'jira' || raw === 'generated-ui' || raw === 'slack' || raw === 'confluence') {
    return raw
  }
  warn('[ui] invalid render target — defaulting to "generated-ui":', raw)
  return DEFAULT_UI_RENDER_TARGET
}

/**
 * Validate an `agent:submit` payload (FR-004, FR-010; Jira generative-UI v2 D2 /
 * v2 FR-013).
 *
 * Required: `utterance` is a string that is NOT empty or whitespace-only (an
 * empty/whitespace utterance MUST start no run — FR-004). The user's exact text
 * is preserved (not trimmed) so the run sees what they typed; only the
 * non-whitespace check uses a trimmed view.
 *
 * Optional: `target` selects the render target for the run (v2 D2 / FR-013).
 * Absent ⇒ `'generated-ui'`; an invalid value is warned and defaulted to
 * `'generated-ui'` (never mis-routes to Jira). The returned payload ALWAYS carries
 * a concrete `target` so the caller threads it into the run unconditionally.
 *
 * On invalid utterance: warn and return `null` so the caller ignores it (no run
 * started — FR-010, SC-005).
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateAgentPrompt(
  raw: unknown,
  warn: WarnFn = defaultWarn
): AgentSubmitPayload | null {
  if (!isObject(raw)) {
    warn('[agent] ignoring agent:submit — payload is not an object:', raw)
    return null
  }
  if (typeof raw.utterance !== 'string') {
    warn('[agent] ignoring agent:submit — required field "utterance" must be a string:', raw)
    return null
  }
  if (raw.utterance.trim().length === 0) {
    warn('[agent] ignoring agent:submit — "utterance" must not be empty or whitespace-only:', raw)
    return null
  }
  return { utterance: raw.utterance, target: validateUiRenderTarget(raw.target, warn) }
}

/**
 * Validate a `jira:requestDefaultView` payload (Jira generative-UI v2, D4 / v2
 * FR-002). The request carries NO field — any non-object is warned and ignored
 * (returns null) so a malformed frame never triggers the default-view read. An
 * object (the expected empty payload, or anything with extra keys) is accepted as
 * the empty trigger; main owns the JQL + bounded read.
 *
 * @returns the validated empty payload, or `null` if invalid (caller ignores null).
 */
export function validateRequestDefaultView(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraRequestDefaultViewPayload | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring jira:requestDefaultView — payload is not an object:', raw)
    return null
  }
  return {}
}

/**
 * Validate a `jira:requestSearchView` payload (jira-jql-search-v1, FR-012). The native
 * search box sends ONLY the raw `jql` string the user typed. Required: `jql` is a STRING
 * — the EMPTY string is ALLOWED (empty/whitespace is the valid "clear to default" case,
 * resolved in main, FR-005). A non-object or a non-string `jql` is warned and ignored
 * (returns null) so a malformed frame triggers no read. Carries no secret (FR-011).
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateRequestSearchView(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraRequestSearchViewPayload | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring jira:requestSearchView — payload is not an object:', raw)
    return null
  }
  if (typeof raw.jql !== 'string') {
    warn('[jira] ignoring jira:requestSearchView — required "jql" must be a string:', raw)
    return null
  }
  return { jql: raw.jql }
}

/**
 * Validate a `jira:requestIssueDetail` payload (jira-ticket-detail-v1, FR-011). The
 * clickable `TicketCard` sends ONLY the clicked `issueKey`. Required: `issueKey` is a
 * NON-EMPTY, non-whitespace string. Unlike `validateRequestSearchView` (where the empty
 * string is the valid "clear to default" case), an EMPTY/whitespace `issueKey` is INVALID
 * here — there is no "default detail" — so a non-object, a non-string `issueKey`, or an
 * empty/whitespace `issueKey` is warned and ignored (returns null) so a malformed frame
 * triggers no read. Carries no secret (FR-010).
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateRequestIssueDetail(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraRequestIssueDetailPayload | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring jira:requestIssueDetail — payload is not an object:', raw)
    return null
  }
  if (typeof raw.issueKey !== 'string' || raw.issueKey.trim().length === 0) {
    warn(
      '[jira] ignoring jira:requestIssueDetail — required "issueKey" must be a non-empty, non-whitespace string:',
      raw
    )
    return null
  }
  return { issueKey: raw.issueKey }
}

/* ------------------------------------------------------------------------- *
 * Milestone 2 — render_ui MCP server & Generated-UI panel
 * Spec: .sdd/specs/render-ui-v1.md
 * ------------------------------------------------------------------------- */

/**
 * Validate a `ui:action` payload returned by the renderer (FR-006, FR-010, SC-006).
 *
 * Required:
 *  - `requestId` is a non-empty string (correlates to a pending call — FR-012).
 *  - `action.type` is `'submit'` or `'cancel'`.
 * Optional (only meaningful for `submit`):
 *  - `action.actionId` is a string when present.
 *  - `action.values` is a plain object when present.
 *
 * An invalid or missing required field MUST be warned and the payload ignored
 * (the pending call is NOT resolved by a bad payload — SC-006).
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateUiAction(
  raw: unknown,
  warn: WarnFn = defaultWarn
): UiActionPayload | null {
  if (!isObject(raw)) {
    warn('[ui] ignoring ui:action — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.requestId)) {
    warn('[ui] ignoring ui:action — required field "requestId" must be a non-empty string:', raw)
    return null
  }
  if (!isObject(raw.action)) {
    warn('[ui] ignoring ui:action — required field "action" must be an object:', raw)
    return null
  }
  const action = raw.action
  if (action.type !== 'submit' && action.type !== 'cancel') {
    warn('[ui] ignoring ui:action — "action.type" must be "submit" or "cancel":', raw)
    return null
  }
  if (action.actionId !== undefined && typeof action.actionId !== 'string') {
    warn('[ui] ignoring ui:action — optional "action.actionId" must be a string when present:', raw)
    return null
  }
  if (action.values !== undefined && !isObject(action.values)) {
    warn('[ui] ignoring ui:action — optional "action.values" must be an object when present:', raw)
    return null
  }
  return {
    requestId: raw.requestId,
    action: {
      type: action.type,
      ...(typeof action.actionId === 'string' ? { actionId: action.actionId } : {}),
      ...(isObject(action.values) ? { values: action.values } : {})
    }
  }
}

/**
 * Validate that a `render_ui` argument is a well-formed A2UI 0.9 surface
 * (FR-003, SC-005). Checked at the MCP boundary before pushing to the renderer.
 *
 * Required (minimal structural check against the SDK's 0.9
 * `UpdateComponentsPayload`):
 *  - `surfaceId` is a non-empty string.
 *  - `components` is an array.
 *
 * An invalid spec MUST be rejected with a warning so the tool can return an
 * error result and the panel shows a safe fallback — never a crash (FR-003).
 *
 * @returns the validated spec, or `null` if invalid (caller returns an error
 *   tool result).
 */
export function validateSurfaceUpdate(
  raw: unknown,
  warn: WarnFn = defaultWarn
): A2uiSurfaceUpdate | null {
  if (!isObject(raw)) {
    warn('[ui] rejecting render_ui spec — not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.surfaceId)) {
    warn('[ui] rejecting render_ui spec — "surfaceId" must be a non-empty string:', raw)
    return null
  }
  if (!Array.isArray(raw.components)) {
    warn('[ui] rejecting render_ui spec — "components" must be an array:', raw)
    return null
  }
  return raw as unknown as A2uiSurfaceUpdate
}

/* ------------------------------------------------------------------------- *
 * API→UI generative adapter — boundary validators (jira-generative-adapter-v1)
 * Spec: .sdd/specs/jira-generative-adapter-v1.md (FR-007/FR-009/FR-010/FR-019/FR-022)
 *
 * SHARED (panel-agnostic) validators for the new cross-process payloads: the
 * `updateDataModel` push (M->R), a reserved `adapter.*` action (R->M, intercepted at
 * the `ui:action` boundary), and the persisted secret-free descriptor. Every one is
 * pure with an injectable `warn`; an invalid/malformed payload is warned and returned
 * null so the caller IGNORES it — never a crash (FR-022/FR-023). The descriptor
 * validator additionally STRIPS to the known non-secret shape so no token can ride
 * along into the snapshot (FR-007/FR-021).
 * ------------------------------------------------------------------------- */

/**
 * Validate a `ui:dataModel` push payload (FR-009/FR-010/FR-022). The SDK's
 * `UpdateDataModelPayload` shape: `surfaceId` (required, keys the surface — FR-010),
 * optional `path` (RFC 6901 string; defaults to `/` at the renderer) and optional
 * `value` (any JSON; omitted means "remove" per SDK semantics).
 *
 * A malformed payload (non-object, missing/empty `surfaceId`, non-string `path`) is
 * warned and IGNORED (returns null) so a bad push never applies to a surface or
 * crashes the panel (FR-022/FR-023). `value` is intentionally NOT type-constrained
 * (the data model is arbitrary non-secret JSON).
 */
export function validateUiDataModel(
  raw: unknown,
  warn: WarnFn = defaultWarn
): UiDataModelPayload | null {
  if (!isObject(raw)) {
    warn('[ui] ignoring ui:dataModel — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.surfaceId)) {
    warn('[ui] ignoring ui:dataModel — required "surfaceId" must be a non-empty string:', raw)
    return null
  }
  if (raw.path !== undefined && typeof raw.path !== 'string') {
    warn('[ui] ignoring ui:dataModel — optional "path" must be a string when present:', raw)
    return null
  }
  return {
    surfaceId: raw.surfaceId,
    ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
    // `value` is passed through verbatim; `undefined` (absent) means remove.
    ...('value' in raw ? { value: raw.value } : {})
  }
}

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
  'generated-ui': new Set([
    ...Object.values(SlackAdapterSource),
    ...Object.values(JiraAdapterSource),
    ...Object.values(ConfluenceAdapterSource)
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

/* ------------------------------------------------------------------------- *
 * Slack integration — IPC payload + bridge-frame validators (FR-023)
 * Spec: .sdd/specs/slack-integration-v1.md
 *
 * Every inbound Slack IPC payload (renderer->main) and every inbound Slack bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is
 * warned and the payload returned as null so the caller ignores it (never
 * crashes, never resolves the wrong call). No payload carries a token (FR-006).
 * ------------------------------------------------------------------------- */

function optionalCursorOk(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

/**
 * Validate a `slack:listChannels` params payload (FR-013, FR-023).
 * Required: none. Optional: `cursor` is a string when present.
 */
export function validateSlackListChannels(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackListChannelsParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:listChannels — payload is not an object:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[slack] ignoring slack:listChannels — optional "cursor" must be a string:', raw)
    return null
  }
  return typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {}
}

/**
 * Validate a `slack:getHistory` params payload (FR-013, FR-023).
 * Required: `channelId` non-empty string. Optional: `cursor` string.
 */
export function validateSlackHistory(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackHistoryParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:getHistory — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.channelId)) {
    warn('[slack] ignoring slack:getHistory — required "channelId" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[slack] ignoring slack:getHistory — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    channelId: raw.channelId,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/**
 * Validate a `slack:getReplies` params payload (FR-013, FR-023).
 * Required: `channelId` + `threadTs` non-empty strings. Optional: `cursor`.
 */
export function validateSlackReplies(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackRepliesParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:getReplies — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.channelId)) {
    warn('[slack] ignoring slack:getReplies — required "channelId" must be a non-empty string:', raw)
    return null
  }
  if (!isNonEmptyString(raw.threadTs)) {
    warn('[slack] ignoring slack:getReplies — required "threadTs" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[slack] ignoring slack:getReplies — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    channelId: raw.channelId,
    threadTs: raw.threadTs,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/**
 * Validate a `slack:search` params payload (FR-015, FR-023).
 * Required: `query` non-empty string. Optional: `cursor`.
 */
export function validateSlackSearch(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackSearchParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:search — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.query)) {
    warn('[slack] ignoring slack:search — required "query" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[slack] ignoring slack:search — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    query: raw.query,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/**
 * Validate a `slack:getUser` params payload (FR-014, FR-023).
 * Required: `userId` non-empty string.
 */
export function validateSlackGetUser(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackGetUserParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:getUser — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.userId)) {
    warn('[slack] ignoring slack:getUser — required "userId" must be a non-empty string:', raw)
    return null
  }
  return { userId: raw.userId }
}

/** A validated Slack bridge call: a known `op` plus its raw params object. */
export interface ValidatedSlackBridgeCall {
  callId: string
  op: SlackOpName
  params: Record<string, unknown>
}

const SLACK_OPS = new Set<string>(Object.values(SlackOp))

/**
 * Validate an inbound Slack bridge frame from the MCP entry script (FR-018,
 * FR-023). A malformed/unknown frame is warned and ignored (null) so the bridge
 * never crashes and never mis-resolves another call.
 *
 * Required: `kind === 'slack_call'`, a non-empty `callId`, a known `op`, and a
 * `params` object. The per-op param shape is validated separately by the
 * matching `validateSlack*` validator before the manager runs.
 */
export function validateSlackBridgeCall(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ValidatedSlackBridgeCall | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring bridge frame — not an object:', raw)
    return null
  }
  if (raw.kind !== 'slack_call') {
    warn('[slack] ignoring bridge frame — unknown "kind":', raw)
    return null
  }
  if (!isNonEmptyString(raw.callId)) {
    warn('[slack] ignoring bridge frame — "callId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.op !== 'string' || !SLACK_OPS.has(raw.op)) {
    warn('[slack] ignoring bridge frame — unknown "op":', raw)
    return null
  }
  if (!isObject(raw.params)) {
    warn('[slack] ignoring bridge frame — "params" must be an object:', raw)
    return null
  }
  return { callId: raw.callId, op: raw.op as SlackOpName, params: raw.params }
}

/* ------------------------------------------------------------------------- *
 * Atlassian Jira — IPC payload + bridge-frame validators (FR-X04)
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group J, Group X)
 *
 * Every inbound Jira IPC payload (renderer->main) and every inbound Jira bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is warned
 * and returned as null so the caller ignores it (never crashes, never resolves the
 * wrong call). No payload carries a token (FR-A11).
 * ------------------------------------------------------------------------- */

/**
 * Validate a `jira:searchIssues` params payload (FR-J04, FR-X04).
 * Required: `jql` non-empty string. Optional: `cursor` string.
 */
export function validateJiraSearch(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraSearchParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring jira:searchIssues — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.jql)) {
    warn('[jira] ignoring jira:searchIssues — required "jql" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[jira] ignoring jira:searchIssues — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    jql: raw.jql,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/**
 * Validate a `jira:getIssue` params payload (FR-J04, FR-X04).
 * Required: `issueKey` non-empty string.
 */
export function validateJiraGetIssue(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraGetIssueParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring jira:getIssue — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.issueKey)) {
    warn('[jira] ignoring jira:getIssue — required "issueKey" must be a non-empty string:', raw)
    return null
  }
  return { issueKey: raw.issueKey }
}

/* ------------------------------------------------------------------------- *
 * Jira write boundary validators (Jira generative-UI v1, FR-006)
 *
 * Shared by BOTH write callers: the deterministic `jira.*` dispatcher (renderer
 * `ui:action` → main) and the write MCP tools (entry script → bridge → manager).
 * An invalid/missing required field is warned and returned as null so the caller
 * dispatches NO write (no crash). Carry only non-secret identifiers/content.
 * ------------------------------------------------------------------------- */

/**
 * Validate `jira.transition` / `jira_transition_issue` params (FR-006, FR-020).
 * Required: `issueKey` and `transitionId` are both non-empty strings.
 */
export function validateJiraTransition(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraTransitionParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring transition — params is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.issueKey)) {
    warn('[jira] ignoring transition — required "issueKey" must be a non-empty string:', raw)
    return null
  }
  if (!isNonEmptyString(raw.transitionId)) {
    warn('[jira] ignoring transition — required "transitionId" must be a non-empty string:', raw)
    return null
  }
  return { issueKey: raw.issueKey, transitionId: raw.transitionId }
}

/**
 * Validate `jira.comment` / `jira_add_comment` params (FR-006). Required:
 * `issueKey` is a non-empty string and `body` is a string that is NOT empty or
 * whitespace-only (an empty/whitespace comment dispatches no write — FR-006). The
 * exact text is preserved (not trimmed); only the non-whitespace check trims.
 */
export function validateJiraComment(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraCommentParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring comment — params is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.issueKey)) {
    warn('[jira] ignoring comment — required "issueKey" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.body !== 'string' || raw.body.trim().length === 0) {
    warn('[jira] ignoring comment — required "body" must be a non-empty, non-whitespace string:', raw)
    return null
  }
  return { issueKey: raw.issueKey, body: raw.body }
}

/**
 * Validate `jira.create` / `jira_create_issue` params (Jira write-extend v1,
 * FR-002, FR-006). Required: `projectKey` and `issueType` are non-empty strings and
 * `summary` is a string that is NOT empty or whitespace-only (a missing required
 * minimal field dispatches no create — FR-002). Optional: `description` is a string,
 * defaulting to `''` when absent (FR-002). The summary's exact text is preserved
 * (not trimmed); only the non-whitespace check trims. Carries no secret (FR-016).
 */
export function validateJiraCreate(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraCreateParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring create — params is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.projectKey)) {
    warn('[jira] ignoring create — required "projectKey" must be a non-empty string:', raw)
    return null
  }
  if (!isNonEmptyString(raw.issueType)) {
    warn('[jira] ignoring create — required "issueType" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.summary !== 'string' || raw.summary.trim().length === 0) {
    warn('[jira] ignoring create — required "summary" must be a non-empty, non-whitespace string:', raw)
    return null
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    warn('[jira] ignoring create — optional "description" must be a string when present:', raw)
    return null
  }
  return {
    projectKey: raw.projectKey,
    issueType: raw.issueType,
    summary: raw.summary,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}

/**
 * Validate `jira.update` / `jira_update_issue` params (Jira write-extend v1,
 * FR-003, FR-006, OQ2). Required: `issueKey` is a non-empty string and `fields` is a
 * NON-EMPTY object containing only the allowed editable keys (`summary`,
 * `description`, `assignee`). An empty `fields` (no changed entry) is REJECTED so an
 * unchanged edit dispatches no write (FR-003, OQ2 belt-and-braces). Each present
 * field is type-checked: `summary` non-whitespace (a required field can't be
 * blanked), `description` a string, `assignee` an `{ accountId }` object. Only the
 * allowed keys are carried through; an unknown key alone does not make `fields`
 * non-empty. Carries no secret (FR-016).
 */
export function validateJiraUpdate(
  raw: unknown,
  warn: WarnFn = defaultWarn
): JiraUpdateParams | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring update — params is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.issueKey)) {
    warn('[jira] ignoring update — required "issueKey" must be a non-empty string:', raw)
    return null
  }
  if (!isObject(raw.fields)) {
    warn('[jira] ignoring update — required "fields" must be an object:', raw)
    return null
  }
  const rawFields = raw.fields
  const fields: JiraUpdateFields = {}
  if (rawFields.summary !== undefined) {
    if (typeof rawFields.summary !== 'string' || rawFields.summary.trim().length === 0) {
      warn('[jira] ignoring update — "fields.summary" must be a non-empty, non-whitespace string:', raw)
      return null
    }
    fields.summary = rawFields.summary
  }
  if (rawFields.description !== undefined) {
    if (typeof rawFields.description !== 'string') {
      warn('[jira] ignoring update — "fields.description" must be a string:', raw)
      return null
    }
    fields.description = rawFields.description
  }
  if (rawFields.assignee !== undefined) {
    if (!isObject(rawFields.assignee) || !isNonEmptyString(rawFields.assignee.accountId)) {
      warn('[jira] ignoring update — "fields.assignee" must be { accountId } with a non-empty id:', raw)
      return null
    }
    fields.assignee = { accountId: rawFields.assignee.accountId }
  }
  if (Object.keys(fields).length === 0) {
    warn('[jira] ignoring update — "fields" has no changed editable field (empty edit):', raw)
    return null
  }
  return { issueKey: raw.issueKey, fields }
}

/**
 * Map a validated `ui:action` (a `jira.*` `actionId` + its `values`) to a
 * discriminated {@link JiraBoundActionRequest} for the dispatcher (FR-005, FR-006).
 * An unknown `jira.*` name or missing/invalid required fields → null + warn (no
 * dispatch). NOTE: the caller is responsible for first checking the namespace via
 * `isJiraBoundActionId`; a non-`jira.*` actionId passed here returns null (warned).
 */
export function validateJiraBoundAction(
  actionId: string | undefined,
  values: Record<string, unknown> | undefined,
  warn: WarnFn = defaultWarn
): JiraBoundActionRequest | null {
  const raw = values ?? {}
  switch (actionId) {
    case JiraBoundAction.Transition: {
      const params = validateJiraTransition(raw, warn)
      return params ? { name: JiraBoundAction.Transition, params } : null
    }
    case JiraBoundAction.Comment: {
      const params = validateJiraComment(raw, warn)
      return params ? { name: JiraBoundAction.Comment, params } : null
    }
    case JiraBoundAction.Create: {
      const params = validateJiraCreate(raw, warn)
      return params ? { name: JiraBoundAction.Create, params } : null
    }
    case JiraBoundAction.Update: {
      const params = validateJiraUpdate(raw, warn)
      return params ? { name: JiraBoundAction.Update, params } : null
    }
    default:
      warn('[jira] ignoring bound action — unknown jira.* action name:', actionId)
      return null
  }
}

/** A validated Jira bridge call: a known `op` plus its raw params object. */
export interface ValidatedJiraBridgeCall {
  callId: string
  op: JiraOpName
  params: Record<string, unknown>
}

const JIRA_OPS = new Set<string>(Object.values(JiraOp))

/**
 * Validate an inbound Jira bridge frame from the MCP entry script (FR-X01, FR-X04).
 * A malformed/unknown frame is warned and ignored (null) so the bridge never
 * crashes and never mis-resolves another call.
 */
export function validateJiraBridgeCall(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ValidatedJiraBridgeCall | null {
  if (!isObject(raw)) {
    warn('[jira] ignoring bridge frame — not an object:', raw)
    return null
  }
  if (raw.kind !== 'jira_call') {
    warn('[jira] ignoring bridge frame — unknown "kind":', raw)
    return null
  }
  if (!isNonEmptyString(raw.callId)) {
    warn('[jira] ignoring bridge frame — "callId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.op !== 'string' || !JIRA_OPS.has(raw.op)) {
    warn('[jira] ignoring bridge frame — unknown "op":', raw)
    return null
  }
  if (!isObject(raw.params)) {
    warn('[jira] ignoring bridge frame — "params" must be an object:', raw)
    return null
  }
  return { callId: raw.callId, op: raw.op as JiraOpName, params: raw.params }
}

/* ------------------------------------------------------------------------- *
 * Atlassian Confluence — IPC payload + bridge-frame validators (FR-X04)
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group C, Group X)
 * ------------------------------------------------------------------------- */

/**
 * Validate a `confluence:searchContent` params payload (FR-C04, FR-X04).
 * Required: `query` non-empty string. Optional: `cursor` string.
 */
export function validateConfluenceSearch(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConfluenceSearchParams | null {
  if (!isObject(raw)) {
    warn('[confluence] ignoring confluence:searchContent — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.query)) {
    warn('[confluence] ignoring confluence:searchContent — required "query" must be a non-empty string:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[confluence] ignoring confluence:searchContent — optional "cursor" must be a string:', raw)
    return null
  }
  return {
    query: raw.query,
    ...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {})
  }
}

/**
 * Validate a `confluence:defaultFeed` params payload (confluence-default-feed v1,
 * FR-006, FR-016). Cursor-only: there is NO `query` and NO CQL/mode string (the fixed
 * personal CQL lives only in the client). Required: none — `{}`/`undefined` is accepted
 * (first page). Optional: `cursor` is a string when present; a non-object or a
 * non-string `cursor` is warned and ignored (returns null).
 */
export function validateConfluenceDefaultFeed(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConfluenceDefaultFeedParams | null {
  if (raw === undefined) {
    return {}
  }
  if (!isObject(raw)) {
    warn('[confluence] ignoring confluence:defaultFeed — payload is not an object:', raw)
    return null
  }
  if (!optionalCursorOk(raw.cursor)) {
    warn('[confluence] ignoring confluence:defaultFeed — optional "cursor" must be a string:', raw)
    return null
  }
  return typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {}
}

/**
 * Validate a `confluence:getPage` params payload (FR-C04, FR-X04).
 * Required: `pageId` non-empty string.
 */
export function validateConfluenceGetPage(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConfluenceGetPageParams | null {
  if (!isObject(raw)) {
    warn('[confluence] ignoring confluence:getPage — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.pageId)) {
    warn('[confluence] ignoring confluence:getPage — required "pageId" must be a non-empty string:', raw)
    return null
  }
  return { pageId: raw.pageId }
}

/**
 * Validate `confluence_create_page` params (FR-X04). Required: `spaceKey` and `title`
 * are non-empty strings and `body` is a string that is NOT empty or whitespace-only
 * (a missing required field creates nothing). Optional: `parentId` is a string when
 * present. The body's exact text is preserved (only the non-whitespace check trims).
 * Carries no secret.
 */
export function validateConfluenceCreate(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConfluenceCreateParams | null {
  if (!isObject(raw)) {
    warn('[confluence] ignoring create — params is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.spaceKey)) {
    warn('[confluence] ignoring create — required "spaceKey" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    warn('[confluence] ignoring create — required "title" must be a non-empty, non-whitespace string:', raw)
    return null
  }
  if (typeof raw.body !== 'string' || raw.body.trim().length === 0) {
    warn('[confluence] ignoring create — required "body" must be a non-empty, non-whitespace string:', raw)
    return null
  }
  if (raw.parentId !== undefined && typeof raw.parentId !== 'string') {
    warn('[confluence] ignoring create — optional "parentId" must be a string when present:', raw)
    return null
  }
  return {
    spaceKey: raw.spaceKey,
    title: raw.title,
    body: raw.body,
    ...(typeof raw.parentId === 'string' && raw.parentId !== '' ? { parentId: raw.parentId } : {})
  }
}

/** A validated Confluence bridge call: a known `op` plus its raw params object. */
export interface ValidatedConfluenceBridgeCall {
  callId: string
  op: ConfluenceOpName
  params: Record<string, unknown>
}

const CONFLUENCE_OPS = new Set<string>(Object.values(ConfluenceOp))

/**
 * Validate an inbound Confluence bridge frame from the MCP entry script (FR-X01,
 * FR-X04). A malformed/unknown frame is warned and ignored (null).
 */
export function validateConfluenceBridgeCall(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ValidatedConfluenceBridgeCall | null {
  if (!isObject(raw)) {
    warn('[confluence] ignoring bridge frame — not an object:', raw)
    return null
  }
  if (raw.kind !== 'confluence_call') {
    warn('[confluence] ignoring bridge frame — unknown "kind":', raw)
    return null
  }
  if (!isNonEmptyString(raw.callId)) {
    warn('[confluence] ignoring bridge frame — "callId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.op !== 'string' || !CONFLUENCE_OPS.has(raw.op)) {
    warn('[confluence] ignoring bridge frame — unknown "op":', raw)
    return null
  }
  if (!isObject(raw.params)) {
    warn('[confluence] ignoring bridge frame — "params" must be an object:', raw)
    return null
  }
  return { callId: raw.callId, op: raw.op as ConfluenceOpName, params: raw.params }
}
