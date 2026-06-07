import { describe, it, expect, vi } from 'vitest'
import {
  validateSlackBridgeCall,
  validateSlackGetUser,
  validateSlackHistory,
  validateSlackListChannels,
  validateSlackReplies,
  validateSlackSearch
} from './validate'
import { SlackOp } from './slack'

describe('Slack IPC validators (FR-023, SC-007)', () => {
  describe('validateSlackListChannels', () => {
    it('accepts an empty object (no cursor — happy path)', () => {
      const warn = vi.fn()
      expect(validateSlackListChannels({}, warn)).toEqual({})
      expect(warn).not.toHaveBeenCalled()
    })
    it('accepts an optional cursor (missing optional must not error)', () => {
      const warn = vi.fn()
      expect(validateSlackListChannels({ cursor: 'C' }, warn)).toEqual({ cursor: 'C' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null on a non-string cursor (invalid optional)', () => {
      const warn = vi.fn()
      expect(validateSlackListChannels({ cursor: 5 }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it.each([null, undefined, 'x', 7])('warns + null on non-object %p', (raw) => {
      const warn = vi.fn()
      expect(validateSlackListChannels(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateSlackHistory', () => {
    it('accepts a valid channelId (+ optional cursor)', () => {
      const warn = vi.fn()
      expect(validateSlackHistory({ channelId: 'C1', cursor: 'k' }, warn)).toEqual({
        channelId: 'C1',
        cursor: 'k'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required channelId is missing (SC-007)', () => {
      const warn = vi.fn()
      expect(validateSlackHistory({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateSlackReplies', () => {
    it('accepts valid channelId + threadTs', () => {
      const warn = vi.fn()
      expect(validateSlackReplies({ channelId: 'C1', threadTs: '1.2' }, warn)).toEqual({
        channelId: 'C1',
        threadTs: '1.2'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when threadTs is missing', () => {
      const warn = vi.fn()
      expect(validateSlackReplies({ channelId: 'C1' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateSlackSearch', () => {
    it('accepts a non-empty query', () => {
      const warn = vi.fn()
      expect(validateSlackSearch({ query: 'hi' }, warn)).toEqual({ query: 'hi' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null on an empty query', () => {
      const warn = vi.fn()
      expect(validateSlackSearch({ query: '' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateSlackGetUser', () => {
    it('accepts a userId', () => {
      const warn = vi.fn()
      expect(validateSlackGetUser({ userId: 'U1' }, warn)).toEqual({ userId: 'U1' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when userId is missing', () => {
      const warn = vi.fn()
      expect(validateSlackGetUser({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  it('no IPC validator surfaces a token field (no token leakage — SC-008)', () => {
    // Even if a malicious payload carries a token field, validators strip it:
    const out = validateSlackHistory({ channelId: 'C1', token: 'xoxb-secret' } as unknown)
    expect(out).toEqual({ channelId: 'C1' })
    expect(JSON.stringify(out)).not.toContain('xoxb-secret')
  })
})

describe('validateSlackBridgeCall (FR-018, FR-023)', () => {
  it('accepts a well-formed slack_call frame (happy path)', () => {
    const warn = vi.fn()
    const out = validateSlackBridgeCall(
      { kind: 'slack_call', callId: 'c1', op: SlackOp.ListChannels, params: {} },
      warn
    )
    expect(out).toEqual({ callId: 'c1', op: SlackOp.ListChannels, params: {} })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns + null on an unknown kind (malformed frame ignored)', () => {
    const warn = vi.fn()
    expect(
      validateSlackBridgeCall({ kind: 'render', callId: 'c', op: 'listChannels', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null on an unknown op (cannot mis-route)', () => {
    const warn = vi.fn()
    expect(
      validateSlackBridgeCall({ kind: 'slack_call', callId: 'c', op: 'deleteEverything', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null when callId is missing (cannot correlate / mis-resolve)', () => {
    const warn = vi.fn()
    expect(
      validateSlackBridgeCall({ kind: 'slack_call', op: 'getUser', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + null when params is not an object', () => {
    const warn = vi.fn()
    expect(
      validateSlackBridgeCall({ kind: 'slack_call', callId: 'c', op: 'getUser', params: 'x' }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})
