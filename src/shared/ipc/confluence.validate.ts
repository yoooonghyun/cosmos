/**
 * Atlassian Confluence — IPC payload + bridge-frame validators (FR-X04).
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group C, Group X). Re-exported
 * (unchanged) through the `src/shared/validate.ts` barrel.
 */

import type {
  ConfluenceCreateParams,
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluenceOpName,
  ConfluencePageDetail,
  ConfluenceSearchParams
} from '../confluence'
import { ConfluenceOp } from '../confluence'
import {
  defaultWarn,
  isNonEmptyString,
  isObject,
  optionalCursorOk,
  type WarnFn
} from './common.validate'

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
 * Validate a `ConfluencePageDetail` result payload at the main-process boundary
 * (confluence-detail-rich-render-v1, FR-009). The detail crosses to the renderer both as
 * the `confluence:getPage` invoke result and as the bound `/page` data-model value; an
 * invalid payload is warned-and-ignored (null), never crashes the panel (FR-012/SC-007).
 *
 * Required: `id` + `title` are strings and `body` is a STRING (the raw `body-format=view`
 * HTML — `''` is a valid empty body, so emptiness is NOT rejected here; the renderer shows
 * the safe "no readable body" state). Optional: `space` is a string when present (a missing
 * `space` must NOT error — it is legitimately absent). Carries NO secret (FR-011): a token
 * never appears in a page detail, so none is screened here. Pure; never throws.
 */
export function validateConfluencePageDetail(
  raw: unknown,
  warn: WarnFn = defaultWarn
): ConfluencePageDetail | null {
  if (!isObject(raw)) {
    warn('[confluence] ignoring page detail — payload is not an object:', raw)
    return null
  }
  if (typeof raw.id !== 'string') {
    warn('[confluence] ignoring page detail — required "id" must be a string:', raw)
    return null
  }
  if (typeof raw.title !== 'string') {
    warn('[confluence] ignoring page detail — required "title" must be a string:', raw)
    return null
  }
  if (typeof raw.body !== 'string') {
    warn('[confluence] ignoring page detail — required "body" must be a string (the body-format=view HTML):', raw)
    return null
  }
  if (raw.space !== undefined && typeof raw.space !== 'string') {
    warn('[confluence] ignoring page detail — optional "space" must be a string when present:', raw)
    return null
  }
  return {
    id: raw.id,
    title: raw.title,
    body: raw.body,
    ...(typeof raw.space === 'string' ? { space: raw.space } : {})
  }
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
