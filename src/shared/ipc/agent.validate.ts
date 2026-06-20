/**
 * Generative UI foundation — headless agent runner (`agent:*`) inbound-payload
 * validator. Spec: .sdd/specs/generative-ui-foundation-v1.md. Re-exported (unchanged)
 * through the `src/shared/validate.ts` barrel.
 */

import type { AgentRunState, AgentStatusPayload, AgentSubmitPayload, ViewContext } from './agent'
import { defaultWarn, isObject, type WarnFn } from './common.validate'
import { validateUiRenderTarget } from './ui.validate'

/** The known run-lifecycle states (mirrors {@link AgentRunState}). */
const AGENT_RUN_STATES: readonly AgentRunState[] = ['started', 'completed', 'error']

/** The known, validated `ViewContext` keys (open-prompt-view-context-v1). All optional strings. */
const VIEW_CONTEXT_KEYS: readonly (keyof ViewContext)[] = [
  'selectedIssueKey',
  'selectedChannelId',
  'selectedChannelName',
  'threadTs',
  'selectedPageId',
  'selectedPageTitle',
  'selectedEventId',
  'selectedEventTitle'
]

/**
 * Validate an optional `viewContext` (open-prompt-view-context-v1, FR-006). Each known
 * field must be a string when present; unknown/extra fields are dropped. An invalid
 * `viewContext` (not an object, or any known field of the wrong type) is WARNED and
 * dropped — the caller still starts the run with the valid utterance/target (never
 * crashes, never drops the run). Returns the cleaned context, or `undefined` when absent /
 * invalid / empty (no populated fields ⇒ equivalent to today's baseline — FR-005).
 */
export function validateViewContext(raw: unknown, warn: WarnFn = defaultWarn): ViewContext | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (!isObject(raw)) {
    warn('[agent] dropping invalid "viewContext" — not an object (run still starts):', raw)
    return undefined
  }
  const cleaned: ViewContext = {}
  for (const key of VIEW_CONTEXT_KEYS) {
    const value = raw[key]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string') {
      warn(`[agent] dropping invalid "viewContext" — field "${key}" must be a string (run still starts):`, raw)
      return undefined
    }
    if (value.trim().length > 0) {
      cleaned[key] = value
    }
  }
  // No populated fields ⇒ treat as absent (backward-compatible baseline, FR-005).
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
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
  const payload: AgentSubmitPayload = {
    utterance: raw.utterance,
    target: validateUiRenderTarget(raw.target, warn)
  }
  // open-prompt-view-context-v1 (FR-006): an invalid viewContext is warned + dropped, but
  // the run still starts — so it is attached only when it validates to a populated context.
  const viewContext = validateViewContext(raw.viewContext, warn)
  if (viewContext) {
    payload.viewContext = viewContext
  }
  return payload
}

/**
 * Validate an `agent:status` payload before main emits it to the renderer
 * (open-prompt-spinner-gating-v1, FR-008). `state` MUST be a known run state; an
 * unknown/missing state is WARNED and the payload is DROPPED (`null`) so a malformed
 * status never crashes or mis-drives the renderer.
 *
 * The optional `producedSurface` (the non-secret UI-intent signal) is warn-and-ignored
 * when present and NOT a boolean: the field is DROPPED while the status is KEPT (the run
 * lifecycle still flows; the renderer falls back to surface-presence — no regression).
 * `message` is preserved only when it is a string. Returns a CLEANED payload (never the
 * raw object), or `null` if the state itself is invalid.
 */
export function validateAgentStatusPayload(
  raw: unknown,
  warn: WarnFn = defaultWarn
): AgentStatusPayload | null {
  if (!isObject(raw)) {
    warn('[agent] ignoring agent:status — payload is not an object:', raw)
    return null
  }
  if (typeof raw.state !== 'string' || !AGENT_RUN_STATES.includes(raw.state as AgentRunState)) {
    warn('[agent] ignoring agent:status — unknown run state:', raw)
    return null
  }
  const payload: AgentStatusPayload = { state: raw.state as AgentRunState }
  if (typeof raw.message === 'string') {
    payload.message = raw.message
  }
  // open-prompt-spinner-gating-v1 (FR-008): a non-boolean producedSurface is warned +
  // dropped (status kept). Absent is valid (the renderer falls back to surface-presence).
  if (raw.producedSurface !== undefined) {
    if (typeof raw.producedSurface === 'boolean') {
      payload.producedSurface = raw.producedSurface
    } else {
      warn('[agent] dropping invalid "producedSurface" — must be a boolean (status kept):', raw)
    }
  }
  return payload
}
