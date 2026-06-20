/**
 * render_ui (`ui:*`) inbound-payload validators (Milestone 2 / Jira generative-UI v2).
 * Spec: .sdd/specs/render-ui-v1.md. Re-exported (unchanged) through the
 * `src/shared/validate.ts` barrel.
 */

import type { A2uiSurfaceUpdate, UiActionPayload, UiDataModelPayload } from './ui'
import type { UiRenderTarget } from './common'
import { DEFAULT_UI_RENDER_TARGET } from './common'
import { defaultWarn, isNonEmptyString, isObject, type WarnFn } from './common.validate'

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
  if (
    raw === 'jira' ||
    raw === 'generated-ui' ||
    raw === 'slack' ||
    raw === 'confluence' ||
    raw === 'google-calendar'
  ) {
    return raw
  }
  warn('[ui] invalid render target — defaulting to "generated-ui":', raw)
  return DEFAULT_UI_RENDER_TARGET
}

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
