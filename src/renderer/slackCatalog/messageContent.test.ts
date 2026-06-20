import { describe, it, expect } from 'vitest'
import { parseMessageRuns } from './messageContent'

const REF = 'cosmos-slack-img://slack/abc'

describe('parseMessageRuns (slack-rich-message-render-v1 Track E)', () => {
  it('returns a single text run when there are no custom emoji', () => {
    expect(parseMessageRuns('hello world')).toEqual([{ kind: 'text', text: 'hello world' }])
  })

  it('emits a custom-emoji run for a mapped shortcode, coalescing surrounding text', () => {
    const runs = parseMessageRuns('hi :parrot: there', { parrot: REF })
    expect(runs).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'custom-emoji', shortcode: 'parrot', ref: REF },
      { kind: 'text', text: ' there' }
    ])
  })

  it('leaves an unmapped :name: literal inside a text run (FR-008)', () => {
    expect(parseMessageRuns('hi :unknown: ok', { parrot: REF })).toEqual([
      { kind: 'text', text: 'hi :unknown: ok' }
    ])
  })

  it('handles adjacent custom emoji', () => {
    const runs = parseMessageRuns(':parrot::cat:', { parrot: REF, cat: REF })
    expect(runs).toEqual([
      { kind: 'custom-emoji', shortcode: 'parrot', ref: REF },
      { kind: 'custom-emoji', shortcode: 'cat', ref: REF }
    ])
  })

  it('preserves newlines in text runs', () => {
    expect(parseMessageRuns('a\nb')).toEqual([{ kind: 'text', text: 'a\nb' }])
  })

  it('treats an empty-string ref as not custom (stays literal)', () => {
    expect(parseMessageRuns(':parrot:', { parrot: '' })).toEqual([
      { kind: 'text', text: ':parrot:' }
    ])
  })

  it('returns [] for empty / non-string text; tolerates a non-object map', () => {
    expect(parseMessageRuns('')).toEqual([])
    expect(parseMessageRuns(undefined)).toEqual([])
    expect(parseMessageRuns(42)).toEqual([])
    // @ts-expect-error — exercising the runtime guard with a bad map type.
    expect(parseMessageRuns(':parrot:', [])).toEqual([{ kind: 'text', text: ':parrot:' }])
  })
})
