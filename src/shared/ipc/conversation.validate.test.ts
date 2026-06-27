import { describe, it, expect, vi } from 'vitest'
import {
  validateConversationResult,
  validateConversationTurn
} from './conversation.validate'

describe('validateConversationTurn', () => {
  it('accepts a valid user-prompt turn', () => {
    const turn = { kind: 'user-prompt', id: 'u1', ts: 't', text: 'hi' }
    expect(validateConversationTurn(turn)).toEqual(turn)
  })

  it('accepts a surface turn with an object spec', () => {
    const turn = { kind: 'surface', id: 's1', ts: 't', spec: { surfaceId: 'x', components: [] } }
    expect(validateConversationTurn(turn)).toEqual(turn)
  })

  it('clamps an overlong tool-call argPreview', () => {
    const turn = {
      kind: 'tool-call',
      id: 'c1',
      ts: 't',
      toolName: 'Read',
      argPreview: 'x'.repeat(500)
    }
    const out = validateConversationTurn(turn)
    expect(out?.kind).toBe('tool-call')
    expect((out as { argPreview: string }).argPreview.length).toBeLessThanOrEqual(200)
  })

  it('rejects an unknown kind', () => {
    expect(validateConversationTurn({ kind: 'bogus', id: 'x', ts: 't' })).toBeNull()
  })

  it('rejects a turn missing its id/ts', () => {
    expect(validateConversationTurn({ kind: 'user-prompt', text: 'hi' })).toBeNull()
  })

  it('rejects a surface turn without an object spec', () => {
    expect(validateConversationTurn({ kind: 'surface', id: 's', ts: 't', spec: 'nope' })).toBeNull()
  })
})

describe('validateConversationResult', () => {
  it('passes a valid ok:false empty result', () => {
    expect(validateConversationResult({ ok: false, reason: 'empty' })).toEqual({
      ok: false,
      reason: 'empty'
    })
  })

  it('passes a valid ok:false unreadable result', () => {
    expect(validateConversationResult({ ok: false, reason: 'unreadable' })).toEqual({
      ok: false,
      reason: 'unreadable'
    })
  })

  it('warns + drops an ok:false with an unknown reason', () => {
    const warn = vi.fn()
    expect(validateConversationResult({ ok: false, reason: 'weird' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('passes an ok:true result and re-derives state, dropping a bad turn', () => {
    const out = validateConversationResult({
      ok: true,
      conversation: {
        sessionId: 'sess-1',
        state: 'populated',
        turns: [
          { kind: 'user-prompt', id: 'u1', ts: 't', text: 'hi' },
          { kind: 'bogus' } // dropped
        ]
      }
    })
    expect(out).toEqual({
      ok: true,
      conversation: {
        sessionId: 'sess-1',
        state: 'populated',
        turns: [{ kind: 'user-prompt', id: 'u1', ts: 't', text: 'hi' }]
      }
    })
  })

  it('derives empty state when all turns drop', () => {
    const out = validateConversationResult({
      ok: true,
      conversation: { state: 'populated', turns: [{ kind: 'bogus' }] }
    })
    expect(out).toEqual({ ok: true, conversation: { state: 'empty', turns: [] } })
  })

  it('warns + drops a non-object payload', () => {
    const warn = vi.fn()
    expect(validateConversationResult(null, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('warns + drops an ok:true with non-array turns', () => {
    const warn = vi.fn()
    expect(
      validateConversationResult({ ok: true, conversation: { turns: 'nope', state: 'empty' } }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})
