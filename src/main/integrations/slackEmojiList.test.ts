import { describe, it, expect } from 'vitest'
import {
  resolveCustomEmojiUrl,
  isCustomEmojiImageUrl,
  SlackCustomEmojiResolver,
  type EmojiListMap
} from './slackEmojiList'
import { decodeImageRef } from '../slackImageRef'

const IMG = 'https://emoji.slack-edge.com/T1/parrot/abc.gif'
const IMG2 = 'https://emoji.slack-edge.com/T1/cat/def.png'

describe('resolveCustomEmojiUrl (FR-007, OQ-1 one-hop alias)', () => {
  it('resolves a direct image URL', () => {
    expect(resolveCustomEmojiUrl({ parrot: IMG }, 'parrot')).toBe(IMG)
  })

  it('resolves a one-hop alias to the target image', () => {
    const map: EmojiListMap = { party_parrot: 'alias:parrot', parrot: IMG }
    expect(resolveCustomEmojiUrl(map, 'party_parrot')).toBe(IMG)
  })

  it('returns null for an alias to another alias (no second hop)', () => {
    const map: EmojiListMap = { a: 'alias:b', b: 'alias:c', c: IMG }
    expect(resolveCustomEmojiUrl(map, 'a')).toBeNull()
  })

  it('returns null for an unknown shortcode and for a standard (non-image) entry', () => {
    expect(resolveCustomEmojiUrl({}, 'nope')).toBeNull()
    expect(resolveCustomEmojiUrl({ smile: '😄' }, 'smile')).toBeNull()
  })

  it('returns null for an off-allowlist image host (FR-011)', () => {
    expect(resolveCustomEmojiUrl({ x: 'https://evil.com/a.png' }, 'x')).toBeNull()
  })
})

describe('isCustomEmojiImageUrl', () => {
  it('true only for allowlisted https image hosts', () => {
    expect(isCustomEmojiImageUrl(IMG)).toBe(true)
    expect(isCustomEmojiImageUrl('https://files.slack.com/x.png')).toBe(true)
    expect(isCustomEmojiImageUrl('https://evil.com/x.png')).toBe(false)
    expect(isCustomEmojiImageUrl('alias:other')).toBe(false)
    expect(isCustomEmojiImageUrl('😄')).toBe(false)
  })
})

describe('SlackCustomEmojiResolver (cached, FR-016 degrade-never-throw)', () => {
  it('returns an opaque ref for a custom emoji and null for unknown', async () => {
    const r = new SlackCustomEmojiResolver(async () => ({ parrot: IMG }))
    const ref = await r.forShortcode('parrot')
    expect(ref).not.toBeNull()
    expect(decodeImageRef(ref!)?.host).toBe('emoji.slack-edge.com')
    expect(await r.forShortcode('nope')).toBeNull()
  })

  it('fetches the map at most once (cached)', async () => {
    let calls = 0
    const r = new SlackCustomEmojiResolver(async () => {
      calls++
      return { parrot: IMG, cat: IMG2 }
    })
    await r.forShortcode('parrot')
    await r.forShortcode('cat')
    expect(calls).toBe(1)
  })

  it('a failed/null fetch caches empty so every shortcode degrades to null (FR-016)', async () => {
    let calls = 0
    const r = new SlackCustomEmojiResolver(async () => {
      calls++
      return null
    })
    expect(await r.forShortcode('parrot')).toBeNull()
    expect(await r.forShortcode('cat')).toBeNull()
    expect(calls).toBe(1)
  })

  it('a throwing fetch never throws — degrades to null', async () => {
    const r = new SlackCustomEmojiResolver(async () => {
      throw new Error('network')
    })
    await expect(r.forShortcode('parrot')).resolves.toBeNull()
  })
})
