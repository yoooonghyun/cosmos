import { describe, it, expect } from 'vitest'
import {
  COSMOS_SLACK_IMG_SCHEME,
  isAllowedSlackImageHost,
  encodeBase64Url,
  decodeBase64Url,
  safeSlackPath,
  encodeImageRef,
  decodeImageRef,
  buildSlackImageUrl
} from './slackImageRef'

describe('slackImageRef — host allowlist (SSRF boundary, FR-011)', () => {
  it('accepts files.slack.com and the *.slack-edge.com emoji CDN', () => {
    expect(isAllowedSlackImageHost('files.slack.com')).toBe(true)
    expect(isAllowedSlackImageHost('emoji.slack-edge.com')).toBe(true)
    expect(isAllowedSlackImageHost('a.slack-edge.com')).toBe(true)
    expect(isAllowedSlackImageHost('slack-edge.com')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAllowedSlackImageHost('FILES.SLACK.COM'.toLowerCase())).toBe(true)
  })

  it('rejects any other host, including look-alikes', () => {
    expect(isAllowedSlackImageHost('evil.com')).toBe(false)
    expect(isAllowedSlackImageHost('files.slack.com.evil.com')).toBe(false)
    expect(isAllowedSlackImageHost('notslack-edge.com')).toBe(false)
    expect(isAllowedSlackImageHost('')).toBe(false)
  })
})

describe('slackImageRef — base64url codec round-trips', () => {
  it('encodes/decodes a UTF-8 payload', () => {
    const v = 'files.slack.com\n/files-pri/T1-F2/image.png?x=1'
    expect(decodeBase64Url(encodeBase64Url(v))).toBe(v)
  })

  it('decodeBase64Url returns null on wrong alphabet / empty', () => {
    expect(decodeBase64Url('not base64!')).toBeNull()
    expect(decodeBase64Url('')).toBeNull()
  })
})

describe('slackImageRef — safeSlackPath rejects traversal / smuggling', () => {
  it('accepts a root-anchored path with query', () => {
    expect(safeSlackPath('/files-pri/T1/x.png?t=abc')).toBe('/files-pri/T1/x.png?t=abc')
  })

  it('rejects non-root, protocol-relative, backslash, control chars, and traversal', () => {
    expect(safeSlackPath('files/x.png')).toBeNull()
    expect(safeSlackPath('//evil.com/x.png')).toBeNull()
    expect(safeSlackPath('/a\\b')).toBeNull()
    expect(safeSlackPath('/a\nb')).toBeNull()
    expect(safeSlackPath('/a/../../etc/passwd')).toBeNull()
    expect(safeSlackPath('/a/%2e%2e/secret')).toBeNull()
    expect(safeSlackPath('')).toBeNull()
    expect(safeSlackPath(undefined)).toBeNull()
  })
})

describe('slackImageRef — encode/decode happy path (FR-010)', () => {
  it('encodes an allowlisted https URL to a cosmos-slack-img ref and decodes it back', () => {
    const url = 'https://files.slack.com/files-pri/T1-F2/photo.png?pub_secret=x'
    const ref = encodeImageRef(url)
    expect(ref).not.toBeNull()
    expect(ref!.startsWith(`${COSMOS_SLACK_IMG_SCHEME}://slack/`)).toBe(true)
    // The opaque ref never contains the host or path in plaintext (it is base64url).
    expect(ref).not.toContain('files.slack.com')
    expect(ref).not.toContain('pub_secret')

    const target = decodeImageRef(ref!)
    expect(target).toEqual({
      host: 'files.slack.com',
      path: '/files-pri/T1-F2/photo.png?pub_secret=x'
    })
    expect(buildSlackImageUrl(target!)).toBe(url)
  })

  it('encodes an emoji CDN URL', () => {
    const url = 'https://emoji.slack-edge.com/T1/parrot/abc.gif'
    const ref = encodeImageRef(url)
    expect(decodeImageRef(ref!)).toEqual({
      host: 'emoji.slack-edge.com',
      path: '/T1/parrot/abc.gif'
    })
  })

  it('decodes a bare segment too (not only the full scheme URL)', () => {
    const ref = encodeImageRef('https://files.slack.com/a/b.png')!
    const seg = ref.slice(`${COSMOS_SLACK_IMG_SCHEME}://slack/`.length)
    expect(decodeImageRef(seg)).toEqual({ host: 'files.slack.com', path: '/a/b.png' })
  })
})

describe('slackImageRef — encode rejects off-policy URLs (no dead/forged ref)', () => {
  it('rejects non-https, off-allowlist host, and malformed input', () => {
    expect(encodeImageRef('http://files.slack.com/a.png')).toBeNull()
    expect(encodeImageRef('https://evil.com/a.png')).toBeNull()
    expect(encodeImageRef('https://files.slack.com.evil.com/a.png')).toBeNull()
    expect(encodeImageRef('not a url')).toBeNull()
    expect(encodeImageRef('')).toBeNull()
    expect(encodeImageRef(undefined)).toBeNull()
  })
})

describe('slackImageRef — decode rejects forged / origin-escaping refs (FR-011)', () => {
  it('rejects a forged host inside the payload', () => {
    const forged = `${COSMOS_SLACK_IMG_SCHEME}://slack/${encodeBase64Url('evil.com\n/x.png')}`
    expect(decodeImageRef(forged)).toBeNull()
  })

  it('rejects a traversal path inside an allowlisted host', () => {
    const forged = `${COSMOS_SLACK_IMG_SCHEME}://slack/${encodeBase64Url(
      'files.slack.com\n/a/../../../etc/passwd'
    )}`
    expect(decodeImageRef(forged)).toBeNull()
  })

  it('rejects a wrong scheme / wrong authority / empty / non-string', () => {
    expect(decodeImageRef('cosmos-confluence-img://confluence/abc')).toBeNull()
    expect(decodeImageRef(`${COSMOS_SLACK_IMG_SCHEME}://evil/${encodeBase64Url('files.slack.com\n/x')}`)).toBeNull()
    expect(decodeImageRef('')).toBeNull()
    expect(decodeImageRef(undefined)).toBeNull()
    expect(decodeImageRef(42)).toBeNull()
  })

  it('rejects a payload with no host/path separator', () => {
    const bad = `${COSMOS_SLACK_IMG_SCHEME}://slack/${encodeBase64Url('files.slack.com-no-newline')}`
    expect(decodeImageRef(bad)).toBeNull()
  })
})
