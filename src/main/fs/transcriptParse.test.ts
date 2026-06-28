import { describe, it, expect } from 'vitest'
import { parseTranscript, previewArgs, RENDER_UI_TOOL_NAME } from './transcriptParse'
import { PREVIEW_MAX_LEN } from '../../shared/types/conversation'

/** Build one transcript jsonl line (object → stringified). */
function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

describe('parseTranscript', () => {
  it('maps a string-content user line to a user-prompt turn (FR-102)', () => {
    const turns = parseTranscript([
      line({ type: 'user', uuid: 'u1', timestamp: 't1', message: { content: 'hello?' } })
    ])
    expect(turns).toEqual([{ kind: 'user-prompt', id: 'u1', ts: 't1', text: 'hello?' }])
  })

  it('maps a user line with a text block to a user-prompt turn (FR-102)', () => {
    const turns = parseTranscript([
      line({
        type: 'user',
        uuid: 'u2',
        timestamp: 't2',
        message: { content: [{ type: 'text', text: 'do the thing' }] }
      })
    ])
    expect(turns).toEqual([{ kind: 'user-prompt', id: 'u2', ts: 't2', text: 'do the thing' }])
  })

  it('maps assistant text blocks to assistant-text turns (FR-102)', () => {
    const turns = parseTranscript([
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't3',
        message: { content: [{ type: 'text', text: 'Here you go.' }] }
      })
    ])
    expect(turns).toEqual([{ kind: 'assistant-text', id: 'a1', ts: 't3', text: 'Here you go.' }])
  })

  it('maps a render_ui tool_use to a surface turn carrying input.spec (FR-102)', () => {
    const spec = { surfaceId: 's1', components: [{ id: 'btn' }] }
    const turns = parseTranscript([
      line({
        type: 'assistant',
        uuid: 'a2',
        timestamp: 't4',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_1', name: RENDER_UI_TOOL_NAME, input: { spec } }
          ]
        }
      })
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ kind: 'surface', ts: 't4', spec })
  })

  it('maps a non-render tool_use to a tool-call turn and correlates its tool_result (FR-102)', () => {
    const turns = parseTranscript([
      line({
        type: 'assistant',
        uuid: 'a3',
        timestamp: 't5',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_x', name: 'Read', input: { file: '/a.txt' } }]
        }
      }),
      line({
        type: 'user',
        uuid: 'u3',
        timestamp: 't6',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'file body' }]
        }
      })
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      kind: 'tool-call',
      toolName: 'Read',
      argPreview: expect.stringContaining('/a.txt'),
      resultPreview: 'file body'
    })
  })

  it('skips a malformed line but parses its siblings (FR-108)', () => {
    const turns = parseTranscript([
      '{ this is not valid json',
      line({ type: 'user', uuid: 'u4', timestamp: 't7', message: { content: 'still here' } })
    ])
    expect(turns).toEqual([{ kind: 'user-prompt', id: 'u4', ts: 't7', text: 'still here' }])
  })

  it('drops noise + sidechain lines (FR-103)', () => {
    const turns = parseTranscript([
      line({ type: 'permission-mode', uuid: 'n1', timestamp: 't' }),
      line({ type: 'file-history-snapshot', uuid: 'n2', timestamp: 't' }),
      line({ type: 'attachment', uuid: 'n3', timestamp: 't' }),
      line({ type: 'queue-operation', uuid: 'n4', timestamp: 't' }),
      line({
        type: 'assistant',
        uuid: 'side',
        timestamp: 't',
        isSidechain: true,
        message: { content: [{ type: 'text', text: 'subagent noise' }] }
      }),
      line({ type: 'user', uuid: 'ok', timestamp: 't', message: { content: 'real prompt' } })
    ])
    expect(turns).toEqual([{ kind: 'user-prompt', id: 'ok', ts: 't', text: 'real prompt' }])
  })

  it('redacts a secret-looking arg from the preview (FR-104)', () => {
    const turns = parseTranscript([
      line({
        type: 'assistant',
        uuid: 'a5',
        timestamp: 't',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_s',
              name: 'Bash',
              input: { cmd: 'export token=xoxb-1234567890-abcdefghijklmnop' }
            }
          ]
        }
      })
    ])
    expect(turns[0]).toMatchObject({ kind: 'tool-call', toolName: 'Bash' })
    expect((turns[0] as { argPreview: string }).argPreview).not.toContain('xoxb-1234567890')
    expect((turns[0] as { argPreview: string }).argPreview).toContain('[redacted]')
  })

  it('keeps the order of an interleaved conversation', () => {
    const turns = parseTranscript([
      line({ type: 'user', uuid: 'u', timestamp: '1', message: { content: 'q' } }),
      line({
        type: 'assistant',
        uuid: 'a',
        timestamp: '2',
        message: { content: [{ type: 'text', text: 'thinking' }] }
      })
    ])
    expect(turns.map((t) => t.kind)).toEqual(['user-prompt', 'assistant-text'])
  })

  it('skips a line without a uuid (no stable id — FR-101)', () => {
    const turns = parseTranscript([
      line({ type: 'user', timestamp: 't', message: { content: 'no id' } })
    ])
    expect(turns).toEqual([])
  })
})

describe('previewArgs', () => {
  it('clamps a long value to PREVIEW_MAX_LEN', () => {
    const out = previewArgs('x'.repeat(PREVIEW_MAX_LEN + 50))
    expect(out.length).toBeLessThanOrEqual(PREVIEW_MAX_LEN)
  })

  it('collapses whitespace to a single line', () => {
    expect(previewArgs('a\n\n  b\tc')).toBe('a b c')
  })

  it('returns empty for nullish', () => {
    expect(previewArgs(undefined)).toBe('')
    expect(previewArgs(null)).toBe('null')
  })
})
