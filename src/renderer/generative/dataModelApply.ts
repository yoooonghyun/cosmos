/**
 * dataModelApply — pure helper that applies a single `updateDataModel` payload to the
 * A2UI SDK message handler (jira-generative-adapter-v1, FR-002/FR-010/FR-023).
 *
 * React-free + DOM-free so it is unit-testable in vitest's node env (the catalog
 * convention: testable logic in a plain `.ts`, never imported from a `.test.ts` as a
 * `.tsx`). `ActiveTabSurface` calls this for the initial bound-surface seed and for
 * each in-place `ui:dataModel` push.
 *
 * SAFE FALLBACK (FR-023): a malformed payload (non-object, missing/blank surfaceId,
 * or a surfaceId that disagrees with the active surface) is IGNORED — `warn` is
 * called and nothing is forwarded to the SDK, so a bad push never crashes the panel
 * and never corrupts a sibling surface. The surfaceId is re-stamped to the active
 * surface before forwarding so a payload can only ever touch the surface it belongs to.
 */

import type { UiDataModelPayload } from '../../shared/ipc'

/** A function that processes one A2UI message (the SDK's `processMessage`). */
export type ProcessMessage = (message: { updateDataModel: UiDataModelPayload }) => void

/** Logger shape — injectable for tests; defaults to console.warn. */
export type WarnFn = (message: string, ...rest: unknown[]) => void
const defaultWarn: WarnFn = (message, ...rest) => console.warn(message, ...rest)

/**
 * Apply `payload` to `surfaceId` via `processMessage`. Returns true when applied,
 * false when it was ignored as malformed/mismatched (warn + no-op). Never throws.
 */
export function applyDataModel(
  processMessage: ProcessMessage,
  surfaceId: string,
  payload: unknown,
  warn: WarnFn = defaultWarn
): boolean {
  if (typeof payload !== 'object' || payload === null) {
    warn('[adapter] ignoring data-model push — not an object')
    return false
  }
  const p = payload as Partial<UiDataModelPayload>
  if (typeof p.surfaceId !== 'string' || p.surfaceId.length === 0) {
    warn('[adapter] ignoring data-model push — missing surfaceId')
    return false
  }
  if (p.surfaceId !== surfaceId) {
    // Not for this surface — silently ignore (a sibling tab owns it).
    return false
  }
  if (p.path !== undefined && typeof p.path !== 'string') {
    warn('[adapter] ignoring data-model push — non-string path')
    return false
  }
  // Re-stamp surfaceId to the active surface (defensive — it already matches) and
  // preserve `value` presence (an omitted value means "remove" per SDK semantics).
  const message: { updateDataModel: UiDataModelPayload } = {
    updateDataModel: {
      surfaceId,
      ...(p.path !== undefined ? { path: p.path } : {}),
      ...('value' in p ? { value: p.value } : {})
    }
  }
  try {
    processMessage(message)
    return true
  } catch (err) {
    warn('[adapter] data-model apply threw (handled):', err instanceof Error ? err.message : err)
    return false
  }
}
