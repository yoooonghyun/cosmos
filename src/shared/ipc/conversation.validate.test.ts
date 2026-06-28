import { describe, it, expect, vi } from 'vitest'
import {
  validateConversationResult,
  validateConversationTurn
} from './conversation.validate'
import {
  serializePromptContextMarker,
  parsePromptContextMarker,
  validatePromptContext
} from '../promptContext/promptContextMarker'
import type { PromptContext } from '../promptContext/promptContext'

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

/* ------------------------------------------------------------------------ *
 * CONV-VALIDATE-CTX-01 — the boundary PRESERVES a user-prompt PromptContext
 * (cosmos-context-chip-historical-not-showing-v2). The validator used to rebuild a
 * user-prompt as {kind,id,ts,text} and DROP `context`, so the historical (transcript-sourced)
 * chip never reached the renderer (the live chip works because the live seed never crosses this
 * boundary). The context is built via the REAL serialize → parse → validatePromptContext
 * round-trip so the test can never drift from the production schema.
 * ------------------------------------------------------------------------ */

/** A non-cosmos (jira) context with a dock — unmistakable when it survives the boundary. */
const jiraCtx: PromptContext = {
  panel: { id: 'jira', label: 'Jira' },
  tab: { id: 't1', label: 'Sprint board' },
  dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
}

/** Rebuild the EXACT context the parser attaches (real codec round-trip, never hand-built). */
function realRoundTripContext(ctx: PromptContext): PromptContext {
  const parsed = parsePromptContextMarker(
    'summarize this ticket' + serializePromptContextMarker(ctx)
  )
  if (!parsed.context) {
    throw new Error('round-trip produced no context — test fixture is wrong')
  }
  return parsed.context
}

describe('validateConversationTurn — user-prompt context carry-through (CONV-VALIDATE-CTX-01)', () => {
  it('PRESERVES a well-formed context on a user-prompt turn end-to-end', () => {
    const context = realRoundTripContext(jiraCtx)
    const cleaned = validateConversationTurn({
      kind: 'user-prompt',
      id: 'u1',
      ts: '2026-06-28T00:00:00.000Z',
      text: 'summarize this ticket',
      context
    })
    expect(cleaned).not.toBeNull()
    expect(cleaned?.kind).toBe('user-prompt')
    expect(cleaned).toMatchObject({ context: jiraCtx })
  })

  it('a panel-only context (no tab/dock) is preserved', () => {
    const cleaned = validateConversationTurn({
      kind: 'user-prompt',
      id: 'u2',
      ts: 't',
      text: 'hi',
      context: { panel: { id: 'cosmos', label: 'Cosmos' } }
    })
    expect(cleaned).toMatchObject({ context: { panel: { id: 'cosmos', label: 'Cosmos' } } })
  })

  it('a MALFORMED context is dropped to no-context, the turn is still returned (FR-118)', () => {
    const cleaned = validateConversationTurn({
      kind: 'user-prompt',
      id: 'u3',
      ts: 't',
      text: 'still a valid turn',
      // unknown panel id → validatePromptContext returns null → context omitted
      context: { panel: { id: 'nope', label: 'X' } }
    })
    expect(cleaned).not.toBeNull()
    expect(cleaned).toEqual({ kind: 'user-prompt', id: 'u3', ts: 't', text: 'still a valid turn' })
    expect('context' in (cleaned as object)).toBe(false)
  })

  it('an assistant-text turn never carries a context (only user-prompt does)', () => {
    const cleaned = validateConversationTurn({
      kind: 'assistant-text',
      id: 'a1',
      ts: 't',
      text: 'sure',
      context: { panel: { id: 'jira', label: 'Jira' } }
    })
    expect(cleaned).toEqual({ kind: 'assistant-text', id: 'a1', ts: 't', text: 'sure' })
  })
})

describe('validateConversationResult — context survives over a populated conversation', () => {
  it('keeps context on each user-prompt turn of a populated result', () => {
    const context = realRoundTripContext(jiraCtx)
    const result = validateConversationResult({
      ok: true,
      conversation: {
        sessionId: '25023be8',
        state: 'populated',
        turns: [
          { kind: 'user-prompt', id: 'u1', ts: 't1', text: 'summarize this ticket', context },
          { kind: 'assistant-text', id: 'a1', ts: 't2', text: 'here is a summary' },
          { kind: 'user-prompt', id: 'u2', ts: 't3', text: 'no context here' }
        ]
      }
    })
    expect(result?.ok).toBe(true)
    if (!result || !result.ok) {
      throw new Error('expected ok result')
    }
    const turns = result.conversation.turns
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ kind: 'user-prompt', context: jiraCtx })
    expect('context' in (turns[1] as object)).toBe(false)
    expect('context' in (turns[2] as object)).toBe(false)
  })
})

describe('validatePromptContext — the shared boundary/marker schema', () => {
  it('accepts panel-only', () => {
    expect(validatePromptContext({ panel: { id: 'cosmos', label: 'Cosmos' } })).toEqual({
      panel: { id: 'cosmos', label: 'Cosmos' }
    })
  })

  it('accepts panel + tab', () => {
    const ctx = { panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Board' } }
    expect(validatePromptContext(ctx)).toEqual(ctx)
  })

  it('accepts panel + tab + dock, keeping only whitelisted view fields', () => {
    const ctx = {
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 't1', label: 'Board' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-9', bogus: 'dropped' }
    }
    expect(validatePromptContext(ctx)).toEqual({
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 't1', label: 'Board' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-9' }
    })
  })

  it('accepts a terminal panel+tab context (cosmos-panel-tab-list-v1 T1)', () => {
    const ctx = { panel: { id: 'terminal', label: 'Terminal' }, tab: { id: 'p1', label: 'Terminal 2' } }
    expect(validatePromptContext(ctx)).toEqual(ctx)
  })

  it('rejects an unknown panel id', () => {
    expect(validatePromptContext({ panel: { id: 'weird', label: 'W' } })).toBeNull()
  })

  it('rejects an empty panel label', () => {
    expect(validatePromptContext({ panel: { id: 'jira', label: '  ' } })).toBeNull()
  })

  it('rejects a partial tab (id without label)', () => {
    expect(
      validatePromptContext({ panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1' } })
    ).toBeNull()
  })

  it('rejects a dock with no populated item field', () => {
    expect(
      validatePromptContext({ panel: { id: 'jira', label: 'Jira' }, dock: { kind: 'jira-issue' } })
    ).toBeNull()
  })

  it('never throws on junk', () => {
    expect(validatePromptContext(null)).toBeNull()
    expect(validatePromptContext('string')).toBeNull()
    expect(validatePromptContext(42)).toBeNull()
    expect(validatePromptContext({})).toBeNull()
  })
})
