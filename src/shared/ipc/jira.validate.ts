/**
 * Atlassian Jira — IPC payload + bridge-frame + write-boundary validators (FR-X04).
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group J, Group X) + Jira generative-UI v1.
 * Re-exported (unchanged) through the `src/shared/validate.ts` barrel.
 *
 * Every inbound Jira IPC payload (renderer->main) and every inbound Jira bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is warned
 * and returned as null so the caller ignores it (never crashes, never resolves the
 * wrong call). No payload carries a token (FR-A11).
 */

import type {
  JiraRequestDefaultViewPayload,
  JiraRequestIssueDetailPayload,
  JiraRequestSearchViewPayload
} from './jira'
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
} from '../jira'
import { JiraBoundAction, JiraOp } from '../jira'
import {
  defaultWarn,
  isNonEmptyString,
  isObject,
  optionalCursorOk,
  type WarnFn
} from './common.validate'

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
  // jira-create-parent-v1 (FR-003): optional `parentKey`. When PRESENT it MUST be a
  // non-empty (post-trim) string — a present-but-empty/whitespace value warns + ignores
  // the WHOLE create (per the required-field convention). It is TRIMMED before use; when
  // absent the result OMITS it entirely (no empty-string default). Non-secret (FR-010).
  if (
    raw.parentKey !== undefined &&
    (typeof raw.parentKey !== 'string' || raw.parentKey.trim().length === 0)
  ) {
    warn('[jira] ignoring create — optional "parentKey" must be a non-empty, non-whitespace string when present:', raw)
    return null
  }
  return {
    projectKey: raw.projectKey,
    issueType: raw.issueType,
    summary: raw.summary,
    description: typeof raw.description === 'string' ? raw.description : '',
    ...(typeof raw.parentKey === 'string' ? { parentKey: raw.parentKey.trim() } : {})
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
