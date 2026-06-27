/**
 * Cosmos conversation timeline (cosmos-conversation-panel-v2, step 3) payload validator.
 * Spec: FR-118. Re-exported (unchanged) through the `src/shared/validate.ts` barrel.
 *
 * The `conversation:*` contract has no renderer-supplied payload (`Fetch` is a no-arg
 * invoke; `Update` is M->R), so there is no inbound-from-renderer shape to police. This
 * validator instead guards the OUTBOUND {@link ConversationResult} main builds before it
 * crosses to the renderer — the SAME validate-before-send discipline as
 * `validateAgentStatusPayload` — so a programming error in the reader can never push a
 * malformed/secret-bearing frame. A non-conforming result is WARNED and dropped (`null`),
 * never sent; the renderer keeps its prior state (no crash, FR-118).
 */

import type { Conversation, ConversationTurn, SurfaceTurn } from '../conversation'
import { PREVIEW_MAX_LEN } from '../conversation'
import type { ConversationResult } from './conversation'
import { defaultWarn, isObject, type WarnFn } from './common.validate'

/** The known turn kinds (mirrors {@link ConversationTurn}). */
const TURN_KINDS = ['user-prompt', 'assistant-text', 'tool-call', 'surface'] as const

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

/**
 * Validate ONE conversation turn (FR-101/FR-104). Each kind's required string fields must
 * be strings; a `surface` turn must carry an object `spec`. Preview strings are clamped to
 * {@link PREVIEW_MAX_LEN} defensively (the parser already bounds them). Returns a CLEANED
 * turn, or `null` when malformed (the caller drops a single bad turn, keeps the rest).
 */
export function validateConversationTurn(
  raw: unknown,
  _warn: WarnFn = defaultWarn
): ConversationTurn | null {
  if (!isObject(raw)) {
    return null
  }
  const { kind, id, ts } = raw
  if (!isString(kind) || !(TURN_KINDS as readonly string[]).includes(kind)) {
    return null
  }
  if (!isString(id) || !isString(ts)) {
    return null
  }
  switch (kind) {
    case 'user-prompt':
    case 'assistant-text': {
      if (!isString(raw.text)) {
        return null
      }
      return { kind, id, ts, text: raw.text }
    }
    case 'tool-call': {
      if (!isString(raw.toolName) || !isString(raw.argPreview)) {
        return null
      }
      const turn: ConversationTurn = {
        kind: 'tool-call',
        id,
        ts,
        toolName: raw.toolName,
        argPreview: raw.argPreview.slice(0, PREVIEW_MAX_LEN)
      }
      if (isString(raw.resultPreview)) {
        turn.resultPreview = raw.resultPreview.slice(0, PREVIEW_MAX_LEN)
      }
      return turn
    }
    case 'surface': {
      // The A2UI spec is an object (`{ surfaceId, components }`) by the render contract.
      if (!isObject(raw.spec)) {
        return null
      }
      // Trusted non-secret spec; passed through as the SDK shape (validated structurally
      // at render time by the A2UI host's error boundary — FR-110).
      return { kind: 'surface', id, ts, spec: raw.spec as unknown as SurfaceTurn['spec'] }
    }
    default:
      return null
  }
}

/**
 * Validate the OUTBOUND {@link ConversationResult} before main sends it (FR-118). An
 * `ok:false` result must carry a known `reason`; an `ok:true` result must carry a
 * `Conversation` whose `turns` are an array (each turn re-validated, a bad one dropped)
 * and whose `state` is `'empty' | 'populated'`. Returns a CLEANED result, or `null` when
 * the shape is unusable (the caller does not send — the renderer keeps its prior state).
 */
export function validateConversationResult(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConversationResult | null {
  if (!isObject(raw)) {
    warn('[conversation] dropping result — not an object:', raw)
    return null
  }
  if (raw.ok === false) {
    if (raw.reason === 'empty' || raw.reason === 'unreadable') {
      return { ok: false, reason: raw.reason }
    }
    warn('[conversation] dropping ok:false result — unknown reason:', raw)
    return null
  }
  if (raw.ok !== true || !isObject(raw.conversation)) {
    warn('[conversation] dropping result — missing/!ok conversation:', raw)
    return null
  }
  const conv = raw.conversation
  if (!Array.isArray(conv.turns)) {
    warn('[conversation] dropping result — turns is not an array:', raw)
    return null
  }
  const turns: ConversationTurn[] = []
  for (const t of conv.turns) {
    const cleaned = validateConversationTurn(t, warn)
    if (cleaned) {
      turns.push(cleaned)
    }
  }
  const state: Conversation['state'] = turns.length > 0 ? 'populated' : 'empty'
  const conversation: Conversation = { turns, state }
  if (isString(conv.sessionId)) {
    conversation.sessionId = conv.sessionId
  }
  return { ok: true, conversation }
}
