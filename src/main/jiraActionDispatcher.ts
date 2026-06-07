/**
 * JiraActionDispatcher — the deterministic `jira.*` bound-action path (Jira
 * generative-UI v1, D1 / FR-004). Main intercepts a `jira.*` action at the
 * `ui:action` boundary and hands it here INSTEAD of resolving it back to Claude.
 *
 * The dispatcher, for a valid bound action (FR-006):
 *   1. Executes the write via JiraManager (transition / comment) — WITHOUT spawning
 *      or re-invoking `claude` (FR-004, FR-019).
 *   2. Settles the pending `render_ui` call as `cancel` so the composing headless
 *      run does NOT block and Claude is NOT re-invoked (FR-016).
 *   3. Re-reads the issue via JiraManager.getIssue (real post-write status) and
 *      re-composes the detail surface via JiraSurfaceBuilder, then re-pushes it with
 *      a FRESH requestId (design Q2) so the updated surface is freshly actionable.
 *   4. On a write failure / scope gap, re-pushes the surface with an error/notice
 *      block (best-effort prior data) — never a crash, hang, or leak (FR-007/017).
 *
 * Channel independence (FR-019): this class is constructed with ONLY the JiraManager
 * subset, a `cancelActive` hook, and a `pushRender` sink — there is NO ptyManager or
 * AgentRunner dependency, so a bound action can never disturb them BY CONSTRUCTION.
 *
 * Pure of Electron: deps are injected so it is unit-testable without a window.
 */

import { randomUUID } from 'node:crypto'
import type { UiRenderPayload } from '../shared/ipc'
import type {
  JiraAddCommentResult,
  JiraCommentParams,
  JiraCreateParams,
  JiraCreateResult,
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraResult,
  JiraTransitionParams,
  JiraTransitionResult,
  JiraUpdateParams,
  JiraUpdateResult
} from '../shared/jira'
import {
  JIRA_WRITE_NOT_AUTHORIZED_MESSAGE,
  JiraBoundAction,
  isJiraBoundActionId,
  type JiraBoundActionName
} from '../shared/jira'
import {
  buildIssueDetailSurface,
  type JiraSurfaceNotice
} from './jiraSurfaceBuilder'
import { validateJiraBoundAction, type WarnFn } from '../shared/validate'

/** The success notice copy per bound action (FR-007; create/update — Jira write-extend v1). */
const SUCCESS_MESSAGE: Record<JiraBoundActionName, string> = {
  [JiraBoundAction.Transition]: 'Transition applied.',
  [JiraBoundAction.Comment]: 'Comment added.',
  [JiraBoundAction.Create]: 'Issue created.',
  [JiraBoundAction.Update]: 'Issue updated.'
}

/** The JiraManager subset the dispatcher needs (write methods + the re-read). */
export interface JiraActionManager {
  transitionIssue(params: JiraTransitionParams): Promise<JiraResult<JiraTransitionResult>>
  addComment(params: JiraCommentParams): Promise<JiraResult<JiraAddCommentResult>>
  createIssue(params: JiraCreateParams): Promise<JiraResult<JiraCreateResult>>
  updateIssue(params: JiraUpdateParams): Promise<JiraResult<JiraUpdateResult>>
  getIssue(params: JiraGetIssueParams): Promise<JiraResult<JiraIssueDetail>>
}

export interface JiraActionDispatcherDeps {
  /** Executes the writes + the post-write re-read (FR-004, FR-010). */
  manager: JiraActionManager
  /** Settle the pending `render_ui` call as `cancel` (FR-016) — UiBridge.cancelActive. */
  cancelActive: () => void
  /** Push a (re-composed) surface to the renderer (FR-007) — pushRenderToRenderer. */
  pushRender: (payload: UiRenderPayload) => void
  /** Optional warning logger. Defaults to console.warn. */
  warn?: WarnFn
}

export class JiraActionDispatcher {
  private readonly manager: JiraActionManager
  private readonly cancelActive: () => void
  private readonly pushRender: (payload: UiRenderPayload) => void
  private readonly warn: WarnFn

  constructor(deps: JiraActionDispatcherDeps) {
    this.manager = deps.manager
    this.cancelActive = deps.cancelActive
    this.pushRender = deps.pushRender
    this.warn = deps.warn ?? ((m, ...a) => console.warn(m, ...a))
  }

  /** True when the action belongs to the reserved `jira.*` namespace (FR-004). */
  handles(actionId: string | undefined): boolean {
    return isJiraBoundActionId(actionId)
  }

  /**
   * Dispatch a validated `ui:action` whose `actionId` is in the `jira.*` namespace
   * (FR-004). Validates the bound action (FR-006); an invalid/unknown one is warned
   * and IGNORED (no write, no surface change — the pending call is left for the
   * caller's normal handling). Otherwise: execute the write, settle the pending call
   * `cancel`, and re-push the updated surface. Never throws (FR-017).
   *
   * @returns true if the action was a recognized bound action (handled here); false
   *   if it was not a valid bound action (caller may warn-and-ignore).
   */
  async dispatch(
    actionId: string | undefined,
    values: Record<string, unknown> | undefined
  ): Promise<boolean> {
    const action = validateJiraBoundAction(actionId, values, this.warn)
    if (!action) {
      // Unknown/invalid jira.* action: warned in the validator. No dispatch (FR-006).
      return false
    }

    // Execute the write. `issueKey` is the key to re-read for the post-write detail:
    // for transition/comment/update it's the action's issueKey; for CREATE it is the
    // NEW key from the POST response (OQ1) — resolved from the result below.
    let issueKey: string
    let result: JiraResult<unknown>
    if (action.name === JiraBoundAction.Transition) {
      issueKey = action.params.issueKey
      result = await this.manager.transitionIssue(action.params)
    } else if (action.name === JiraBoundAction.Comment) {
      issueKey = action.params.issueKey
      result = await this.manager.addComment(action.params)
    } else if (action.name === JiraBoundAction.Update) {
      issueKey = action.params.issueKey
      result = await this.manager.updateIssue(action.params)
    } else {
      // jira.create: the issue does not exist yet — its key comes from the result (OQ1).
      const created = await this.manager.createIssue(action.params)
      result = created
      issueKey = created.ok ? created.data.key : ''
    }

    // FR-016: settle the pending render_ui call as cancel — Claude is NOT re-invoked.
    this.cancelActive()

    // FR-007: re-compose + re-push the surface reflecting the write's outcome.
    await this.repushSurface(issueKey, action.name, result)
    return true
  }

  /**
   * Re-read the issue and re-push the detail surface with a fresh requestId
   * (design Q2), prepending a success/error/scope-gap notice (FR-007). A re-read
   * failure after a successful write still renders a success notice — but without
   * fresh data we cannot compose the full detail, so we surface the success notice
   * over the best available state. Never throws (FR-017).
   */
  private async repushSurface(
    issueKey: string,
    name: JiraBoundActionName,
    result: JiraResult<unknown>
  ): Promise<void> {
    const notice = this.noticeFor(name, result)

    // Re-read for the real post-write data (status / appended comment / created or
    // updated issue) — D1 / OQ1. A create whose write failed has no key to re-read
    // (issueKey === ''); we skip the read and render the notice-bearing fallback.
    let detail: JiraIssueDetail | null = null
    if (issueKey) {
      try {
        const read = await this.manager.getIssue({ issueKey })
        if (read.ok) {
          detail = read.data
        }
      } catch (err) {
        this.warn('[jira] post-write re-read threw (handled):', err instanceof Error ? err.message : err)
      }
    }

    if (!detail) {
      // No fresh data: render a minimal detail carrying just the notice + key so the
      // user still sees the outcome (best-effort, FR-007/017). The surface stays a
      // valid detail surface (no crash).
      detail = {
        key: issueKey,
        summary: '',
        statusName: '',
        statusCategory: 'unknown',
        description: '',
        comments: [],
        availableTransitions: []
      }
    }

    const spec = buildIssueDetailSurface(detail, { notice })
    // design Q2: a FRESH requestId so the renderer remounts a fresh, actionable
    // surface (a same-id re-push would leave it inert/already-submitted). v2 (D1):
    // tag `target: 'jira'` so the post-write surface lands back in the Jira panel.
    this.pushRender({ requestId: randomUUID(), spec, target: 'jira' })
  }

  /** Map a write result to the surface notice (success / error / scope-gap) (FR-007). */
  private noticeFor(
    name: JiraBoundActionName,
    result: JiraResult<unknown>
  ): JiraSurfaceNotice {
    if (result.ok) {
      return { kind: 'success', message: SUCCESS_MESSAGE[name] }
    }
    if (result.kind === 'write_not_authorized') {
      return { kind: 'write_not_authorized', message: JIRA_WRITE_NOT_AUTHORIZED_MESSAGE }
    }
    // All other failures (network / rate_limited / reconnect_needed) → recoverable
    // error notice carrying the non-secret, non-alarming message (FR-017).
    return { kind: 'error', message: result.message }
  }
}
