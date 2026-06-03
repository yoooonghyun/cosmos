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
  PtyInputPayload,
  PtyResizePayload,
  UiActionPayload
} from './ipc'

/** Logger shape used for warnings. Injectable for tests. */
export type WarnFn = (message: string, ...args: unknown[]) => void

const defaultWarn: WarnFn = (message, ...args) => console.warn(message, ...args)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validate a `pty:input` payload (FR-004, FR-010).
 *
 * Required: `data` is a string.
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
  if (typeof raw.data !== 'string') {
    warn('[pty] ignoring pty:input — required field "data" must be a string:', raw)
    return null
  }
  return { data: raw.data }
}

/**
 * Validate a `pty:resize` payload (FR-005, FR-010).
 *
 * Required: `cols` and `rows` are positive, finite integers.
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
  if (!isPositiveInt(raw.cols)) {
    warn('[pty] ignoring pty:resize — required field "cols" must be a positive integer:', raw)
    return null
  }
  if (!isPositiveInt(raw.rows)) {
    warn('[pty] ignoring pty:resize — required field "rows" must be a positive integer:', raw)
    return null
  }
  return { cols: raw.cols, rows: raw.rows }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
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
 * Validate that a `render_ui` argument is a well-formed A2UI `surfaceUpdate`
 * (FR-003, SC-005). Checked at the MCP boundary before pushing to the renderer.
 *
 * Required (minimal structural check against the SDK's `SurfaceUpdatePayload`):
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
