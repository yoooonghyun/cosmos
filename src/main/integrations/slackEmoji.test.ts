import { describe, it, expect } from 'vitest'
import { glyphFor } from './slackEmoji'

describe('glyphFor (slack-rich-message-render-v1 FR-005, node-emoji adapter)', () => {
  it('resolves common standard shortcodes to glyphs', () => {
    expect(glyphFor('tada')).toBe('\u{1F389}')
    expect(glyphFor('fire')).toBe('\u{1F525}')
    expect(glyphFor('rocket')).toBe('\u{1F680}')
  })

  it('resolves Slack-specific spellings via the alias supplement', () => {
    expect(glyphFor('thumbsup')).toBe(glyphFor('+1'))
    expect(glyphFor('thumbsdown')).toBe(glyphFor('-1'))
    expect(glyphFor('thumbsup')).not.toBeNull()
  })

  it('returns null for an unknown shortcode (renderer keeps it literal — FR-008)', () => {
    expect(glyphFor('not_a_real_emoji_xyz')).toBeNull()
  })

  it('returns null for empty / non-string input (never throws)', () => {
    expect(glyphFor('')).toBeNull()
    expect(glyphFor(undefined)).toBeNull()
    expect(glyphFor(42)).toBeNull()
  })
})
