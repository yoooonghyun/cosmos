import { describe, it, expect, vi } from 'vitest'
import {
  JiraActionDispatcher,
  type JiraActionDispatcherDeps,
  type JiraActionManager
} from './jiraActionDispatcher'
import type { JiraIssueDetail, JiraResult } from '../shared/types/jira'
import type { UiRenderPayload } from '../shared/ipc'

/* Jira generative-UI v1/v2 — deterministic dispatcher (FR-004/006/007/016/017/019).
 * v2 (D1): the re-pushed surface is composed via the JIRA CUSTOM catalog, so the
 * outcome is carried on a single `Notice` component (props `noticeKind` + `message`)
 * rather than v1's separate Icon/Text blocks. */

const detail: JiraIssueDetail = {
  key: 'PROJ-1',
  summary: 'Fix it',
  statusName: 'Done',
  statusCategory: 'done',
  description: '',
  comments: [],
  availableTransitions: []
}

function makeManager(overrides?: Partial<JiraActionManager>): JiraActionManager {
  return {
    transitionIssue: vi.fn(async (): Promise<JiraResult<{ transitionId: string }>> => ({ ok: true, data: { transitionId: '31' } })),
    addComment: vi.fn(async (): Promise<JiraResult<never>> => ({ ok: true, data: undefined as never })),
    createIssue: vi.fn(async (): Promise<JiraResult<{ key: string }>> => ({ ok: true, data: { key: 'PROJ-9' } })),
    updateIssue: vi.fn(async (): Promise<JiraResult<{ issueKey: string }>> => ({ ok: true, data: { issueKey: 'PROJ-1' } })),
    getIssue: vi.fn(async (): Promise<JiraResult<JiraIssueDetail>> => ({ ok: true, data: detail })),
    ...overrides
  }
}

function makeDispatcher(overrides?: Partial<JiraActionDispatcherDeps>) {
  const pushes: UiRenderPayload[] = []
  const cancelActive = vi.fn()
  const pushRender = vi.fn((p: UiRenderPayload) => pushes.push(p))
  const warn = vi.fn()
  const manager = overrides?.manager ?? makeManager()
  const dispatcher = new JiraActionDispatcher({
    manager,
    cancelActive,
    pushRender,
    warn,
    ...overrides
  })
  return { dispatcher, manager, cancelActive, pushRender, pushes, warn }
}

/** Extract the surface's component list from a captured push. */
function comps(p: UiRenderPayload): ({ component: string } & Record<string, unknown>)[] {
  return p.spec.components as ({ component: string } & Record<string, unknown>)[]
}

/** The single `Notice` component the v2 catalog uses to carry the write outcome. */
function notice(p: UiRenderPayload): ({ component: string } & Record<string, unknown>) | undefined {
  return comps(p).find((c) => c.component === 'Notice')
}

describe('JiraActionDispatcher.dispatch (happy path)', () => {
  it('a valid jira.transition executes the write, cancels the pending call, re-reads + re-pushes (FR-004/007/016)', async () => {
    const { dispatcher, manager, cancelActive, pushes } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })

    expect(handled).toBe(true)
    expect(manager.transitionIssue).toHaveBeenCalledWith({ issueKey: 'PROJ-1', transitionId: '31' })
    expect(cancelActive).toHaveBeenCalledOnce() // FR-016: pending render_ui settled cancel
    expect(manager.getIssue).toHaveBeenCalledWith({ issueKey: 'PROJ-1' }) // re-read for fresh data
    expect(pushes).toHaveLength(1)
    // success notice present (v2: a single Notice with kind 'success')
    const n = notice(pushes[0])
    expect(n?.noticeKind).toBe('success')
    expect(n?.message).toBe('Transition applied.')
  })

  it('a valid jira.comment executes addComment and re-pushes a success surface (FR-007)', async () => {
    const { dispatcher, manager, pushes } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.comment', { issueKey: 'PROJ-1', body: 'nice' })
    expect(handled).toBe(true)
    expect(manager.addComment).toHaveBeenCalledWith({ issueKey: 'PROJ-1', body: 'nice' })
    const n = notice(pushes[0])
    expect(n?.noticeKind).toBe('success')
    expect(n?.message).toBe('Comment added.')
  })

  it('a valid jira.update executes updateIssue, re-reads the issueKey, and re-pushes a success surface (FR-007)', async () => {
    const { dispatcher, manager, pushes } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.update', {
      issueKey: 'PROJ-1',
      fields: { summary: 'New title' }
    })
    expect(handled).toBe(true)
    expect(manager.updateIssue).toHaveBeenCalledWith({
      issueKey: 'PROJ-1',
      fields: { summary: 'New title' }
    })
    expect(manager.getIssue).toHaveBeenCalledWith({ issueKey: 'PROJ-1' })
    const n = notice(pushes[0])
    expect(n?.noticeKind).toBe('success')
    expect(n?.message).toBe('Issue updated.')
  })

  it('a valid jira.create re-reads the NEW key from the create result and re-pushes a success surface (OQ1)', async () => {
    const detail9: JiraIssueDetail = { ...detail, key: 'PROJ-9' }
    const manager = makeManager({
      getIssue: vi.fn(async (): Promise<JiraResult<JiraIssueDetail>> => ({ ok: true, data: detail9 }))
    })
    const { dispatcher, pushes } = makeDispatcher({ manager })
    const handled = await dispatcher.dispatch('jira.create', {
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 'Brand new',
      description: ''
    })
    expect(handled).toBe(true)
    expect(manager.createIssue).toHaveBeenCalledWith({
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 'Brand new',
      description: ''
    })
    // OQ1: re-read uses the NEW key returned by the create, not an action param.
    expect(manager.getIssue).toHaveBeenCalledWith({ issueKey: 'PROJ-9' })
    const n = notice(pushes[0])
    expect(n?.noticeKind).toBe('success')
    expect(n?.message).toBe('Issue created.')
  })

  it('a failed jira.create (no new key) skips the re-read and pushes the error notice (FR-017)', async () => {
    const manager = makeManager({
      createIssue: vi.fn(async (): Promise<JiraResult<never>> => ({
        ok: false,
        kind: 'network',
        message: 'This project requires additional fields.'
      }))
    })
    const { dispatcher, cancelActive, pushes } = makeDispatcher({ manager })
    const handled = await dispatcher.dispatch('jira.create', {
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 'Brand new',
      description: ''
    })
    expect(handled).toBe(true)
    expect(cancelActive).toHaveBeenCalledOnce()
    // No key to re-read: getIssue is NOT called; an error notice is still pushed.
    expect(manager.getIssue).not.toHaveBeenCalled()
    expect(notice(pushes[0])?.noticeKind).toBe('error')
  })

  it('re-pushes the post-write surface tagged target:"jira" (D1)', async () => {
    const { dispatcher, pushes } = makeDispatcher()
    await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    expect(pushes[0].target).toBe('jira')
  })

  it('mints a FRESH requestId on the re-push (design Q2)', async () => {
    const { dispatcher, pushes } = makeDispatcher()
    await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    expect(pushes).toHaveLength(2)
    expect(pushes[0].requestId).toBeTruthy()
    expect(pushes[1].requestId).toBeTruthy()
    expect(pushes[0].requestId).not.toBe(pushes[1].requestId)
  })
})

describe('JiraActionDispatcher.dispatch (failures, never crash/hang — FR-017)', () => {
  it('a write failure still cancels the pending call and pushes an error-noticed surface', async () => {
    const manager = makeManager({
      transitionIssue: vi.fn(async (): Promise<JiraResult<never>> => ({
        ok: false,
        kind: 'network',
        message: 'Jira request failed (HTTP 404).'
      }))
    })
    const { dispatcher, cancelActive, pushes } = makeDispatcher({ manager })
    const handled = await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '99' })

    expect(handled).toBe(true)
    expect(cancelActive).toHaveBeenCalledOnce() // no hang
    // v2: an error notice (kind 'error') carries the recoverable failure message.
    expect(notice(pushes[0])?.noticeKind).toBe('error')
  })

  it('a write_not_authorized pushes the reconnect notice (write_not_authorized kind) (D4/FR-013)', async () => {
    const manager = makeManager({
      transitionIssue: vi.fn(async (): Promise<JiraResult<never>> => ({
        ok: false,
        kind: 'write_not_authorized',
        message: 'Reconnect Jira to enable actions. Open the Jira panel and choose Reconnect.'
      }))
    })
    const { dispatcher, pushes } = makeDispatcher({ manager })
    await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    // v2: the scope-gap notice is the dedicated 'write_not_authorized' kind.
    expect(notice(pushes[0])?.noticeKind).toBe('write_not_authorized')
  })

  it('a successful write whose re-read fails still pushes a success notice (best-effort)', async () => {
    const manager = makeManager({
      getIssue: vi.fn(async (): Promise<JiraResult<never>> => ({
        ok: false,
        kind: 'network',
        message: 'read failed'
      }))
    })
    const { dispatcher, pushes } = makeDispatcher({ manager })
    await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    expect(pushes).toHaveLength(1)
    const n = notice(pushes[0])
    expect(n?.noticeKind).toBe('success')
    expect(n?.message).toBe('Transition applied.')
  })

  it('a re-read that throws is caught (never crashes — FR-017)', async () => {
    const manager = makeManager({
      getIssue: vi.fn(async () => {
        throw new Error('boom')
      })
    })
    const { dispatcher, pushes } = makeDispatcher({ manager })
    await expect(
      dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1', transitionId: '31' })
    ).resolves.toBe(true)
    expect(pushes).toHaveLength(1)
  })
})

describe('JiraActionDispatcher.dispatch (invalid / unknown — FR-006)', () => {
  it('an unknown jira.* action does NOT dispatch, cancel, or push (warn + ignore)', async () => {
    const { dispatcher, manager, cancelActive, pushRender } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.frobnicate', { issueKey: 'PROJ-1' })
    expect(handled).toBe(false)
    expect(manager.transitionIssue).not.toHaveBeenCalled()
    expect(cancelActive).not.toHaveBeenCalled()
    expect(pushRender).not.toHaveBeenCalled()
  })

  it('a jira.transition missing transitionId does NOT dispatch (FR-006)', async () => {
    const { dispatcher, manager } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.transition', { issueKey: 'PROJ-1' })
    expect(handled).toBe(false)
    expect(manager.transitionIssue).not.toHaveBeenCalled()
  })

  it('a jira.comment with a whitespace-only body does NOT dispatch (FR-006)', async () => {
    const { dispatcher, manager } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.comment', { issueKey: 'PROJ-1', body: '   ' })
    expect(handled).toBe(false)
    expect(manager.addComment).not.toHaveBeenCalled()
  })

  it('a jira.create missing the required summary does NOT dispatch (FR-006)', async () => {
    const { dispatcher, manager } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.create', { projectKey: 'PROJ', issueType: 'Task' })
    expect(handled).toBe(false)
    expect(manager.createIssue).not.toHaveBeenCalled()
  })

  it('a jira.update with an empty fields object does NOT dispatch (OQ2, FR-006)', async () => {
    const { dispatcher, manager } = makeDispatcher()
    const handled = await dispatcher.dispatch('jira.update', { issueKey: 'PROJ-1', fields: {} })
    expect(handled).toBe(false)
    expect(manager.updateIssue).not.toHaveBeenCalled()
  })

  it('handles() recognizes the jira.* namespace (FR-004)', () => {
    const { dispatcher } = makeDispatcher()
    expect(dispatcher.handles('jira.transition')).toBe(true)
    expect(dispatcher.handles('submit')).toBe(false)
    expect(dispatcher.handles(undefined)).toBe(false)
  })
})

describe('channel independence (FR-019)', () => {
  it('the dispatcher exposes no PTY/AgentRunner dependency (by construction)', () => {
    // The deps interface carries only manager + cancelActive + pushRender + warn.
    // A bound action therefore cannot reach a PTY or the AgentRunner. This test
    // documents the invariant; the type system enforces it.
    const { dispatcher } = makeDispatcher()
    expect(dispatcher).toBeInstanceOf(JiraActionDispatcher)
  })
})
