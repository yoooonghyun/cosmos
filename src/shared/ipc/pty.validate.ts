/**
 * Terminal Panel (`pty:*`) inbound-payload validators (FR-010, SC-005).
 * Spec: .sdd/specs/terminal-panel-v1.md. Re-exported (unchanged) through the
 * `src/shared/validate.ts` barrel.
 *
 * The main process MUST validate inbound IPC payloads (input/resize); an invalid
 * or missing required field MUST log a warning and be safely ignored (no crash).
 */

import type {
  PtyDisposePayload,
  PtyInputPayload,
  PtyResizePayload,
  PtyRestartPayload,
  PtyStartPayload
} from './pty'
import { defaultWarn, isNonEmptyString, isObject, isPositiveInt, type WarnFn } from './common.validate'

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

/**
 * Validate a `pty:start` payload (panel-tabs v1, FR-021/FR-022;
 * terminal-open-directory-picker-v1, FR-004/FR-008).
 *
 * Required: `paneId` is a non-empty string. Optional: `cwd` — present only when
 * spawning a freshly-picked tab; when present it MUST be a non-empty string (else the
 * WHOLE payload is warned + ignored, never crash — SC-005). An absent `cwd` is valid
 * (the normal/restore path). Returns `{ paneId, cwd? }`.
 */
export function validateStart(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyStartPayload | null {
  const base = validatePaneId(raw, 'pty:start', warn)
  if (!base) {
    return null
  }
  // validatePaneId already confirmed `raw` is an object; narrow for the optional field.
  const cwd = (raw as { cwd?: unknown }).cwd
  if (cwd === undefined) {
    return base // normal/restore path — no override.
  }
  if (!isNonEmptyString(cwd)) {
    warn('[pty] ignoring pty:start — optional field "cwd", when present, must be a non-empty string:', raw)
    return null
  }
  return { paneId: base.paneId, cwd }
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
