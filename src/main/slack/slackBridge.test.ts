import { describe, it, expect, vi } from 'vitest'
import { SlackBridge, type SlackBridgeManager } from './slackBridge'
import { SlackOp, type SlackResult } from '../../shared/types/slack'

function makeManager(overrides?: Partial<SlackBridgeManager>): SlackBridgeManager {
  const ok = async (): Promise<SlackResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    listChannels: vi.fn(ok),
    getHistory: vi.fn(ok),
    getReplies: vi.fn(ok),
    search: vi.fn(ok),
    getUser: vi.fn(ok),
    ...overrides
  }
}

function makeBridge(manager: SlackBridgeManager) {
  const warn = vi.fn()
  return new SlackBridge({ socketPath: '/tmp/never.sock', manager, warn })
}

describe('SlackBridge.handleCall (FR-018, FR-020, FR-021, SC-006, SC-007)', () => {
  it('routes a valid listChannels op to the manager (happy path)', async () => {
    const manager = makeManager()
    const bridge = makeBridge(manager)
    const result = await bridge.handleCall(SlackOp.ListChannels, {})
    expect(result.ok).toBe(true)
    expect(manager.listChannels).toHaveBeenCalledWith({})
  })

  it('forwards a not_connected structured result from the manager (no hang — FR-020)', async () => {
    const manager = makeManager({
      listChannels: vi.fn(
        async (): Promise<SlackResult<unknown>> => ({
          ok: false,
          kind: 'not_connected',
          message: 'Connect Slack in cosmos first.'
        })
      )
    })
    const bridge = makeBridge(manager)
    const result = await bridge.handleCall(SlackOp.ListChannels, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
      expect(result.message).toMatch(/connect slack/i)
    }
  })

  it('threads required params through to the manager (getHistory)', async () => {
    const manager = makeManager()
    const bridge = makeBridge(manager)
    await bridge.handleCall(SlackOp.GetHistory, { channelId: 'C1', cursor: 'k' })
    expect(manager.getHistory).toHaveBeenCalledWith({ channelId: 'C1', cursor: 'k' })
  })

  it('returns a structured error (no crash) when required params are invalid (FR-023)', async () => {
    const manager = makeManager()
    const bridge = makeBridge(manager)
    const result = await bridge.handleCall(SlackOp.GetHistory, {}) // missing channelId
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
    expect(manager.getHistory).not.toHaveBeenCalled()
  })

  it('returns a structured error for an unknown op (cannot mis-route)', async () => {
    const manager = makeManager()
    const bridge = makeBridge(manager)
    const result = await bridge.handleCall('deleteEverything', {})
    expect(result.ok).toBe(false)
    expect(manager.listChannels).not.toHaveBeenCalled()
  })

  it('a successful result carries data but no token field (FR-021, SC-008)', async () => {
    const manager = makeManager({
      getUser: vi.fn(
        async (): Promise<SlackResult<unknown>> => ({
          ok: true,
          data: { id: 'U1', displayName: 'Ada' }
        })
      )
    })
    const bridge = makeBridge(manager)
    const result = await bridge.handleCall(SlackOp.GetUser, { userId: 'U1' })
    expect(JSON.stringify(result)).not.toMatch(/xox[bp]-/)
  })
})
