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
  AgentSubmitPayload,
  JiraRequestDefaultViewPayload,
  PtyDisposePayload,
  PtyInputPayload,
  PtyResizePayload,
  PtyRestartPayload,
  PtyStartPayload,
  UiActionPayload,
  UiRenderTarget
} from './ipc'
import { DEFAULT_UI_RENDER_TARGET } from './ipc'
import type {
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackOpName,
  SlackRepliesParams,
  SlackSearchParams
} from './slack'
import { SlackOp } from './slack'
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
} from './jira'
import { JiraBoundAction, JiraOp } from './jira'
import type {
  ConfluenceCreateParams,
  ConfluenceGetPageParams,
  ConfluenceOpName,
  ConfluenceSearchParams
} from './confluence'
import { ConfluenceOp } from './confluence'

/** Logger shape used for warnings. Injectable for tests. */
export type WarnFn = (message: string, ...args: unknown[]) => void

const defaultWarn: WarnFn = (message, ...args) => console.warn(message, ...args)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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

/** Validate a `pty:start` payload (panel-tabs v1, FR-021/FR-022). */
export function validateStart(
  raw: unknown,
  warn: WarnFn = defaultWarn
): PtyStartPayload | null {
  return validatePaneId(raw, 'pty:start', warn)
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

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/* ------------------------------------------------------------------------- *
 * Generative UI foundation — headless agent runner
 * Spec: .sdd/specs/generative-ui-foundation-v1.md
 * ------------------------------------------------------------------------- */

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
  if (raw === 'jira' || raw === 'generated-ui' || raw === 'slack' || raw === 'confluence') {
    return raw
  }
  warn('[ui] invalid render target — defaulting to "generated-ui":', raw)
  return DEFAULT_UI_RENDER_TARGET
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
  return { utterance: raw.utterance, target: validateUiRenderTarget(raw.target, warn) }
}

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

/* ------------------------------------------------------------------------- *
 * Slack integration — IPC payload + bridge-frame validators (FR-023)
 * Spec: .sdd/specs/slack-integration-v1.md
 *
 * Every inbound Slack IPC payload (renderer->main) and every inbound Slack bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is
 * warned and the payload returned as null so the caller ignores it (never
 * crashes, never resolves the wrong call). No payload carries a token (FR-006).
 * ------------------------------------------------------------------------- */

function optionalCursorOk(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

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

/* ------------------------------------------------------------------------- *
 * Atlassian Jira — IPC payload + bridge-frame validators (FR-X04)
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group J, Group X)
 *
 * Every inbound Jira IPC payload (renderer->main) and every inbound Jira bridge
 * frame (MCP->main) is validated here; an invalid/missing required field is warned
 * and returned as null so the caller ignores it (never crashes, never resolves the
 * wrong call). No payload carries a token (FR-A11).
 * ------------------------------------------------------------------------- */

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

/* ------------------------------------------------------------------------- *
 * Jira write boundary validators (Jira generative-UI v1, FR-006)
 *
 * Shared by BOTH write callers: the deterministic `jira.*` dispatcher (renderer
 * `ui:action` → main) and the write MCP tools (entry script → bridge → manager).
 * An invalid/missing required field is warned and returned as null so the caller
 * dispatches NO write (no crash). Carry only non-secret identifiers/content.
 * ------------------------------------------------------------------------- */

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
  return {
    projectKey: raw.projectKey,
    issueType: raw.issueType,
    summary: raw.summary,
    description: typeof raw.description === 'string' ? raw.description : ''
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

/* ------------------------------------------------------------------------- *
 * Atlassian Confluence — IPC payload + bridge-frame validators (FR-X04)
 * Spec: .sdd/specs/atlassian-integration-v1.md (Group C, Group X)
 * ------------------------------------------------------------------------- */

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
