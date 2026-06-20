import { describe, it, expect } from 'vitest'
import { decodeSlackText, extractMentionIds, extractEmojiShortcodes } from './slackText'

describe('decodeSlackText (slack-text-rendering-v1)', () => {
  describe('line breaks — multi-line text is preserved (symptom 1)', () => {
    it('keeps real newlines so whitespace-pre-wrap rows render separate lines', () => {
      expect(decodeSlackText('line one\nline two\nline three')).toBe(
        'line one\nline two\nline three'
      )
    })

    it('does not collapse a blank line between paragraphs', () => {
      expect(decodeSlackText('para one\n\npara two')).toBe('para one\n\npara two')
    })

    it('preserves newlines alongside decoded emoji and entities', () => {
      expect(decodeSlackText('hi :tada:\nthanks &amp; bye')).toBe('hi \u{1F389}\nthanks & bye')
    })
  })

  describe('emoji — :shortcode: maps to the Unicode glyph (symptom 2)', () => {
    it('decodes a common shortcode to its glyph', () => {
      expect(decodeSlackText(':tada:')).toBe('\u{1F389}')
      expect(decodeSlackText('great work :+1:')).toBe('great work \u{1F44D}')
    })

    it('decodes multiple shortcodes in one message', () => {
      expect(decodeSlackText(':fire: :rocket: :heart:')).toBe(
        '\u{1F525} \u{1F680} \u{2764}\u{FE0F}'
      )
    })

    it('drops a skin-tone modifier to the base glyph', () => {
      expect(decodeSlackText(':wave::skin-tone-3:')).toBe('\u{1F44B}')
    })

    it('leaves an unknown shortcode verbatim (degrade, do not blank)', () => {
      expect(decodeSlackText(':not_a_real_emoji_xyz:')).toBe(':not_a_real_emoji_xyz:')
    })

    it('does not treat a lone colon-word as an emoji', () => {
      expect(decodeSlackText('ratio 3:1 today')).toBe('ratio 3:1 today')
    })
  })

  describe('HTML entities — Slack-escaped entities are unescaped', () => {
    it('unescapes &amp; &lt; &gt;', () => {
      expect(decodeSlackText('a &amp; b &lt; c &gt; d')).toBe('a & b < c > d')
    })

    it('unescapes &#39; and &quot;', () => {
      expect(decodeSlackText('it&#39;s &quot;quoted&quot;')).toBe('it\'s "quoted"')
    })

    it('leaves an unrelated &foo; entity-like run intact', () => {
      expect(decodeSlackText('rights &copy; 2026')).toBe('rights &copy; 2026')
    })
  })

  describe('mention / channel / link tokens — readable labels', () => {
    it('renders a user mention with its label', () => {
      expect(decodeSlackText('hey <@U123ABC|alice>!')).toBe('hey @alice!')
    })

    it('renders a user mention without a label using the id', () => {
      expect(decodeSlackText('hey <@U123ABC>')).toBe('hey @U123ABC')
    })

    it('renders a channel mention with its name', () => {
      expect(decodeSlackText('see <#C0420|general>')).toBe('see #general')
    })

    it('renders a link with its human label, not the raw URL markup', () => {
      expect(decodeSlackText('docs at <https://example.com/x|the docs>')).toBe(
        'docs at the docs'
      )
    })

    it('renders a bare link as the URL', () => {
      expect(decodeSlackText('<https://example.com/x>')).toBe('https://example.com/x')
    })

    it('renders a broadcast mention readably', () => {
      expect(decodeSlackText('<!here> ping')).toBe('@here ping')
    })

    it('renders a subteam mention with its label', () => {
      expect(decodeSlackText('<!subteam^S123|@frontend> review')).toBe('@frontend review')
    })

    it('strips a mailto: link to the address', () => {
      expect(decodeSlackText('<mailto:bob@example.com>')).toBe('bob@example.com')
    })
  })

  describe('safe fallbacks — never throws on empty/undefined/non-string', () => {
    it('returns "" for empty string', () => {
      expect(decodeSlackText('')).toBe('')
    })

    it('returns "" for undefined', () => {
      expect(decodeSlackText(undefined)).toBe('')
    })

    it('returns "" for null', () => {
      expect(decodeSlackText(null)).toBe('')
    })

    it('returns "" for a non-string (number/object)', () => {
      expect(decodeSlackText(42)).toBe('')
      expect(decodeSlackText({ text: 'x' })).toBe('')
    })

    it('does not throw on an unterminated token', () => {
      expect(() => decodeSlackText('a < b > c')).not.toThrow()
    })
  })

  describe('mention resolution via idToName (slack-rich-message-render-v1 FR-002/004)', () => {
    it('resolves an unlabeled mention id to its display name', () => {
      expect(decodeSlackText('hi <@U1>', { idToName: { U1: 'Alice' } })).toBe('hi @Alice')
    })

    it('falls back to the raw id when the map lacks the id (FR-004)', () => {
      expect(decodeSlackText('hi <@U9>', { idToName: { U1: 'Alice' } })).toBe('hi @U9')
    })

    it('a labeled mention uses its inline label, never the map (FR-003)', () => {
      expect(decodeSlackText('hi <@U1|bob>', { idToName: { U1: 'Alice' } })).toBe('hi @bob')
    })

    it('falls back to the raw id when no map is provided', () => {
      expect(decodeSlackText('hi <@U1>')).toBe('hi @U1')
    })
  })

  describe('custom-emoji markers are left literal (FR-006/008)', () => {
    it('keeps a custom shortcode literal so the renderer can swap an image', () => {
      const out = decodeSlackText(':parrot: hi', { customEmoji: new Set(['parrot']) })
      expect(out).toBe(':parrot: hi')
    })

    it('still glyph-substitutes standard shortcodes not in the custom set', () => {
      const out = decodeSlackText(':tada: :parrot:', { customEmoji: new Set(['parrot']) })
      expect(out).toBe('\u{1F389} :parrot:')
    })
  })

  describe('extractMentionIds — unlabeled ids only', () => {
    it('returns unlabeled mention ids, skipping labeled ones', () => {
      expect(extractMentionIds('<@U1> <@U2|bob> <@U3>')).toEqual(['U1', 'U3'])
    })

    it('dedupes repeated ids', () => {
      expect(extractMentionIds('<@U1> <@U1>')).toEqual(['U1'])
    })

    it('returns [] for empty / non-string input', () => {
      expect(extractMentionIds('')).toEqual([])
      expect(extractMentionIds(undefined)).toEqual([])
      expect(extractMentionIds(42)).toEqual([])
    })
  })

  describe('extractEmojiShortcodes — names excluding skin tones', () => {
    it('returns shortcode names, skipping skin-tone modifiers', () => {
      expect(extractEmojiShortcodes(':tada: :wave::skin-tone-3:')).toEqual(['tada', 'wave'])
    })

    it('dedupes repeats and returns [] for empty/non-string', () => {
      expect(extractEmojiShortcodes(':a: :a:')).toEqual(['a'])
      expect(extractEmojiShortcodes('')).toEqual([])
      expect(extractEmojiShortcodes(null)).toEqual([])
    })
  })

  describe('combined realistic message', () => {
    it('decodes mention + channel + emoji + entity + newlines together', () => {
      const wire = 'Hey <@U1|sam> &amp; <@U2|kim> :wave:\nMoving to <#C9|dev> &lt;3'
      expect(decodeSlackText(wire)).toBe('Hey @sam & @kim \u{1F44B}\nMoving to #dev <3')
    })
  })
})
