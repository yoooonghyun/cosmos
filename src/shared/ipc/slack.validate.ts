/**
 * Slack integration — IPC payload + bridge-frame validators (FR-023).
 * Spec: .sdd/specs/slack-integration-v1.md. Re-exported (unchanged) through the
 * `src/shared/validate.ts` barrel.
 *
 * Every inbound Slack IPC payload (renderer->main) and every inbound Slack bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is
 * warned and the payload returned as null so the caller ignores it (never
 * crashes, never resolves the wrong call). No payload carries a token (FR-006).
 */

import type {
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackOpName,
  SlackRepliesParams,
  SlackSearchParams,
  SlackSendParams
} from '../slack'
import { SlackOp } from '../slack'
import {
  defaultWarn,
  isNonEmptyString,
  isObject,
  optionalCursorOk,
  type WarnFn
} from './common.validate'

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

/**
 * Validate a `slack:sendMessage` params payload (slack-send-message-v1, FR-005).
 * Required: `channelId` non-empty string + `text` non-empty after trim. Optional:
 * `threadTs` string when present (a present value ⇒ thread reply). Invalid → warn +
 * null so main ignores it (never crashes). No token field is ever propagated (FR-006).
 */
export function validateSlackSend(
  raw: unknown,
  warn: WarnFn = defaultWarn
): SlackSendParams | null {
  if (!isObject(raw)) {
    warn('[slack] ignoring slack:sendMessage — payload is not an object:', raw)
    return null
  }
  if (!isNonEmptyString(raw.channelId)) {
    warn('[slack] ignoring slack:sendMessage — required "channelId" must be a non-empty string:', raw)
    return null
  }
  if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
    warn('[slack] ignoring slack:sendMessage — required "text" must be non-empty (non-whitespace):', raw)
    return null
  }
  if (raw.threadTs !== undefined && typeof raw.threadTs !== 'string') {
    warn('[slack] ignoring slack:sendMessage — optional "threadTs" must be a string:', raw)
    return null
  }
  return {
    channelId: raw.channelId,
    text: raw.text,
    ...(typeof raw.threadTs === 'string' ? { threadTs: raw.threadTs } : {})
  }
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
