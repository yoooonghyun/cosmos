import { describe, it, expect, vi } from 'vitest'
import { JiraBridge, type JiraBridgeManager } from './jiraBridge'
import { JiraOp, type JiraResult } from '../../shared/types/jira'

function makeManager(overrides?: Partial<JiraBridgeManager>): JiraBridgeManager {
  const ok = async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    searchIssues: vi.fn(ok),
    getIssue: vi.fn(ok),
    transitionIssue: vi.fn(
      async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { transitionId: '31' } })
    ),
    addComment: vi.fn(
      async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { id: 'c1', body: 'hi' } })
    ),
    createIssue: vi.fn(
      async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { key: 'ABC-99' } })
    ),
    updateIssue: vi.fn(
      async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { issueKey: 'ABC-1' } })
    ),
    ...overrides
  }
}

function makeBridge(manager: JiraBridgeManager) {
  const warn = vi.fn()
  return new JiraBridge({ socketPath: '/tmp/never.sock', manager, warn })
}

describe('JiraBridge.handleCall (FR-X01, FR-X04, FR-X05, SC-009)', () => {
  it('routes a valid searchIssues op to the manager (happy path)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(JiraOp.SearchIssues, { jql: 'x' })
    expect(result.ok).toBe(true)
    expect(manager.searchIssues).toHaveBeenCalledWith({ jql: 'x' })
  })

  it('threads required params through (getIssue)', async () => {
    const manager = makeManager()
    await makeBridge(manager).handleCall(JiraOp.GetIssue, { issueKey: 'ABC-1' })
    expect(manager.getIssue).toHaveBeenCalledWith({ issueKey: 'ABC-1' })
  })

  it('forwards a not_connected structured result (no hang)', async () => {
    const manager = makeManager({
      searchIssues: vi.fn(
        async (): Promise<JiraResult<unknown>> => ({
          ok: false,
          kind: 'not_connected',
          message: 'Connect Jira in cosmos first.'
        })
      )
    })
    const result = await makeBridge(manager).handleCall(JiraOp.SearchIssues, { jql: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
  })

  it('returns a structured error (no crash) when required params are invalid (FR-X04)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(JiraOp.GetIssue, {}) // missing issueKey
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
    expect(manager.getIssue).not.toHaveBeenCalled()
  })

  it('returns a structured error for an unknown op (cannot mis-route)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall('deleteIssue', {})
    expect(result.ok).toBe(false)
    expect(manager.searchIssues).not.toHaveBeenCalled()
  })

  it('routes a valid transitionIssue write op to the manager (FR-008)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(JiraOp.TransitionIssue, {
      issueKey: 'ABC-1',
      transitionId: '31'
    })
    expect(result.ok).toBe(true)
    expect(manager.transitionIssue).toHaveBeenCalledWith({ issueKey: 'ABC-1', transitionId: '31' })
  })

  it('routes a valid addComment write op to the manager (FR-008)', async () => {
    const manager = makeManager()
    await makeBridge(manager).handleCall(JiraOp.AddComment, { issueKey: 'ABC-1', body: 'hello' })
    expect(manager.addComment).toHaveBeenCalledWith({ issueKey: 'ABC-1', body: 'hello' })
  })

  it('returns a structured error (no crash) for invalid write params (FR-006)', async () => {
    const manager = makeManager()
    // missing transitionId
    const r1 = await makeBridge(manager).handleCall(JiraOp.TransitionIssue, { issueKey: 'ABC-1' })
    expect(r1.ok).toBe(false)
    expect(manager.transitionIssue).not.toHaveBeenCalled()
    // whitespace-only body
    const r2 = await makeBridge(manager).handleCall(JiraOp.AddComment, {
      issueKey: 'ABC-1',
      body: '   '
    })
    expect(r2.ok).toBe(false)
    expect(manager.addComment).not.toHaveBeenCalled()
  })

  it('routes a valid createIssue write op to the manager (Jira write-extend v1, FR-008)', async () => {
    const manager = makeManager()
    const params = { projectKey: 'ABC', issueType: 'Task', summary: 'New', description: 'd' }
    const result = await makeBridge(manager).handleCall(JiraOp.CreateIssue, params)
    expect(result.ok).toBe(true)
    expect(manager.createIssue).toHaveBeenCalledWith(params)
  })

  it('routes a valid updateIssue write op to the manager (Jira write-extend v1, FR-008)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(JiraOp.UpdateIssue, {
      issueKey: 'ABC-1',
      fields: { summary: 'Edited' }
    })
    expect(result.ok).toBe(true)
    expect(manager.updateIssue).toHaveBeenCalledWith({
      issueKey: 'ABC-1',
      fields: { summary: 'Edited' }
    })
  })

  it('returns a structured error (no crash) for invalid create/update params (FR-006)', async () => {
    const manager = makeManager()
    // create missing the required summary
    const r1 = await makeBridge(manager).handleCall(JiraOp.CreateIssue, {
      projectKey: 'ABC',
      issueType: 'Task'
    })
    expect(r1.ok).toBe(false)
    expect(manager.createIssue).not.toHaveBeenCalled()
    // update with an empty fields object (no changed field)
    const r2 = await makeBridge(manager).handleCall(JiraOp.UpdateIssue, {
      issueKey: 'ABC-1',
      fields: {}
    })
    expect(r2.ok).toBe(false)
    expect(manager.updateIssue).not.toHaveBeenCalled()
  })

  it('a successful result carries data but no token field (SC-009)', async () => {
    const manager = makeManager({
      getIssue: vi.fn(
        async (): Promise<JiraResult<unknown>> => ({ ok: true, data: { key: 'ABC-1' } })
      )
    })
    const result = await makeBridge(manager).handleCall(JiraOp.GetIssue, { issueKey: 'ABC-1' })
    expect(JSON.stringify(result)).not.toMatch(/at-|Bearer/)
  })
})
