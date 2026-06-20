import { describe, it, expect } from 'vitest'
import { extractImageRefs } from './slackImageExtract'
import { decodeImageRef } from '../slackImageRef'

describe('extractImageRefs (slack-rich-message-render-v1 FR-009/010)', () => {
  it('extracts an image file as an opaque ref, dropping the token-bearing URL', () => {
    const refs = extractImageRefs({
      files: [
        {
          mimetype: 'image/png',
          url_private: 'https://files.slack.com/files-pri/T1-F2/pic.png',
          title: 'pic.png',
          original_w: 800,
          original_h: 600
        }
      ]
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].alt).toBe('pic.png')
    expect(refs[0].w).toBe(800)
    expect(refs[0].h).toBe(600)
    expect(refs[0].ref).not.toContain('files.slack.com')
    expect(decodeImageRef(refs[0].ref)).toEqual({
      host: 'files.slack.com',
      path: '/files-pri/T1-F2/pic.png'
    })
  })

  it('prefers a thumb URL over url_private', () => {
    const refs = extractImageRefs({
      files: [
        {
          mimetype: 'image/jpeg',
          thumb_480: 'https://files.slack.com/files-tmb/T1/thumb_480.jpg',
          url_private: 'https://files.slack.com/files-pri/T1/full.jpg'
        }
      ]
    })
    expect(decodeImageRef(refs[0].ref)?.path).toBe('/files-tmb/T1/thumb_480.jpg')
  })

  it('extracts a Block Kit image block', () => {
    const refs = extractImageRefs({
      blocks: [
        { type: 'image', image_url: 'https://files.slack.com/x/y.png', alt_text: 'diagram' }
      ]
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].alt).toBe('diagram')
  })

  it('skips non-image files and off-allowlist URLs (drops dead refs)', () => {
    const refs = extractImageRefs({
      files: [
        { mimetype: 'application/pdf', url_private: 'https://files.slack.com/a.pdf' },
        { mimetype: 'image/png', url_private: 'https://evil.com/a.png' }
      ]
    })
    expect(refs).toEqual([])
  })

  it('returns [] for non-object / no-image input (never throws)', () => {
    expect(extractImageRefs(undefined)).toEqual([])
    expect(extractImageRefs(null)).toEqual([])
    expect(extractImageRefs(42)).toEqual([])
    expect(extractImageRefs({ text: 'hi' })).toEqual([])
  })
})
