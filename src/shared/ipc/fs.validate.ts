/**
 * Terminal File Explorer (`fs:*`) inbound-payload validators (FR-023, SC-005).
 * Spec: .sdd/specs/terminal-file-explorer-v1.md. Re-exported (unchanged) through the
 * `src/shared/validate.ts` barrel.
 *
 * The main process MUST validate every inbound `fs:*` payload at the boundary; an
 * invalid/missing required field MUST log a warning and be safely ignored (return
 * `null` — the caller returns a denied result / issues no watcher), never crash and
 * never read an out-of-root file (FR-023).
 *
 * These validators only check the SHAPE (a non-empty `paneId`, a string `relPath`).
 * The security CONFINEMENT (root lookup, real-path canonicalization, `..`/absolute/
 * symlink-escape refusal) is a SEPARATE main-side gate (`pathConfine`), applied after
 * the root is looked up by `paneId` — a shape-valid `relPath` is still confined.
 */

import type { FsPathPayload, FsWatchPayload } from './fs'
import { defaultWarn, isNonEmptyString, isObject, type WarnFn } from './common.validate'

/**
 * Validate an `fs:list` / `fs:read` payload (FR-022/FR-023/FR-025).
 *
 * Required: `paneId` is a non-empty string (routes to the right terminal tab's root)
 * and `relPath` is a string (root-relative; `''` addresses the root itself). An empty
 * `relPath` is VALID; only a non-string `relPath` (or a non-object / missing `paneId`)
 * is rejected.
 *
 * @returns the validated payload, or `null` if invalid (caller returns a denied result).
 */
export function validateFsPath(
  raw: unknown,
  channel: string,
  warn: WarnFn = defaultWarn
): FsPathPayload | null {
  if (!isObject(raw)) {
    warn(`[fs] ignoring ${channel} — payload is not an object:`, raw)
    return null
  }
  if (!isNonEmptyString(raw.paneId)) {
    warn(`[fs] ignoring ${channel} — required field "paneId" must be a non-empty string:`, raw)
    return null
  }
  if (typeof raw.relPath !== 'string') {
    warn(`[fs] ignoring ${channel} — required field "relPath" must be a string:`, raw)
    return null
  }
  return { paneId: raw.paneId, relPath: raw.relPath }
}

/**
 * Validate an `fs:watchStart` / `fs:watchStop` payload (FR-016/FR-023).
 *
 * Required: `paneId` is a non-empty string. Invalid → warn + ignore (return null) so a
 * malformed frame starts/stops no watcher.
 *
 * @returns the validated payload, or `null` if invalid (caller ignores null).
 */
export function validateFsWatch(
  raw: unknown,
  channel: string,
  warn: WarnFn = defaultWarn
): FsWatchPayload | null {
  if (!isObject(raw)) {
    warn(`[fs] ignoring ${channel} — payload is not an object:`, raw)
    return null
  }
  if (!isNonEmptyString(raw.paneId)) {
    warn(`[fs] ignoring ${channel} — required field "paneId" must be a non-empty string:`, raw)
    return null
  }
  return { paneId: raw.paneId }
}
