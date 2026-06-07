import { describe, it, expect, vi } from 'vitest'
import { ConfluenceBridge, type ConfluenceBridgeManager } from './confluenceBridge'
import { ConfluenceOp, type ConfluenceResult } from '../shared/confluence'

function makeManager(overrides?: Partial<ConfluenceBridgeManager>): ConfluenceBridgeManager {
  const ok = async (): Promise<ConfluenceResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    searchContent: vi.fn(ok),
    getPage: vi.fn(ok),
    createPage: vi.fn(ok),
    ...overrides
  }
}

function makeBridge(manager: ConfluenceBridgeManager) {
  const warn = vi.fn()
  return new ConfluenceBridge({ socketPath: '/tmp/never.sock', manager, warn })
}

describe('ConfluenceBridge.handleCall (FR-X01, FR-X04, FR-X05, SC-009)', () => {
  it('routes a valid searchContent op to the manager (happy path)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(ConfluenceOp.SearchContent, { query: 'x' })
    expect(result.ok).toBe(true)
    expect(manager.searchContent).toHaveBeenCalledWith({ query: 'x' })
  })

  it('threads required params through (getPage)', async () => {
    const manager = makeManager()
    await makeBridge(manager).handleCall(ConfluenceOp.GetPage, { pageId: '12345' })
    expect(manager.getPage).toHaveBeenCalledWith({ pageId: '12345' })
  })

  it('routes a valid createPage op to the manager (happy path)', async () => {
    const manager = makeManager()
    await makeBridge(manager).handleCall(ConfluenceOp.CreatePage, {
      spaceKey: 'ENG',
      title: 'Notes',
      body: 'hello'
    })
    expect(manager.createPage).toHaveBeenCalledWith({
      spaceKey: 'ENG',
      title: 'Notes',
      body: 'hello'
    })
  })

  it('returns a structured error for an invalid create (missing title) without calling the manager', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(ConfluenceOp.CreatePage, {
      spaceKey: 'ENG',
      body: 'hello'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
    expect(manager.createPage).not.toHaveBeenCalled()
  })

  it('forwards a not_connected structured result (no hang)', async () => {
    const manager = makeManager({
      searchContent: vi.fn(
        async (): Promise<ConfluenceResult<unknown>> => ({
          ok: false,
          kind: 'not_connected',
          message: 'Connect Confluence in cosmos first.'
        })
      )
    })
    const result = await makeBridge(manager).handleCall(ConfluenceOp.SearchContent, { query: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
  })

  it('returns a structured error when required params are invalid (FR-X04)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(ConfluenceOp.GetPage, {}) // missing pageId
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
    expect(manager.getPage).not.toHaveBeenCalled()
  })

  it('returns a structured error for an unknown op (cannot mis-route)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall('deletePage', {})
    expect(result.ok).toBe(false)
    expect(manager.searchContent).not.toHaveBeenCalled()
  })
})
