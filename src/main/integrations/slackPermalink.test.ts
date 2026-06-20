/**
 * Tests for slackPermalink — the openable-web-url guard + the chat.getPermalink response
 * reader backing the Slack thread dock's "Open in Slack" link (slack-thread-open-in-slack-v1).
 * Node env, no DOM, no network. Mirrors the Confluence weblink guard coverage: a spec-compliant
 * openable URL passes; a missing optional value omits cleanly; an invalid/non-http(s) value is
 * dropped (safe fallback, no crash).
 */

import { describe, it, expect } from 'vitest'
import { isOpenableWebUrl, permalinkFromResponse } from './slackPermalink'

describe('isOpenableWebUrl', () => {
  it('accepts an absolute http(s) URL (happy path)', () => {
    expect(isOpenableWebUrl('https://acme.slack.com/archives/C1/p1700000000000100')).toBe(true)
    expect(isOpenableWebUrl('http://example.com/x')).toBe(true)
  })

  it('rejects a missing / empty value without error (missing-optional)', () => {
    expect(isOpenableWebUrl(undefined)).toBe(false)
    expect(isOpenableWebUrl('')).toBe(false)
    expect(isOpenableWebUrl('   ')).toBe(false)
  })

  it('rejects a non-http(s) / malformed value (invalid → safe fallback)', () => {
    expect(isOpenableWebUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableWebUrl('ftp://example.com')).toBe(false)
    expect(isOpenableWebUrl('file:///etc/passwd')).toBe(false)
    expect(isOpenableWebUrl('not a url')).toBe(false)
    expect(isOpenableWebUrl('/archives/C1/p123')).toBe(false) // relative, no protocol
  })
})

describe('permalinkFromResponse (chat.getPermalink reader)', () => {
  it('returns the permalink from a well-formed body (happy path)', () => {
    const url = 'https://acme.slack.com/archives/C1/p1700000000000100'
    expect(permalinkFromResponse({ ok: true, permalink: url })).toBe(url)
  })

  it('returns undefined when permalink is absent (missing-optional, degrade-to-omit)', () => {
    expect(permalinkFromResponse({ ok: true })).toBeUndefined()
    expect(permalinkFromResponse({ ok: true, permalink: undefined })).toBeUndefined()
  })

  it('drops a non-http(s) / non-string permalink (invalid → safe fallback, no crash)', () => {
    expect(permalinkFromResponse({ permalink: 'javascript:alert(1)' })).toBeUndefined()
    expect(permalinkFromResponse({ permalink: 'slack://channel?team=T1' })).toBeUndefined()
    expect(permalinkFromResponse({ permalink: 42 })).toBeUndefined()
    expect(permalinkFromResponse({ permalink: '' })).toBeUndefined()
  })

  it('returns undefined for a non-object body without throwing (total)', () => {
    expect(permalinkFromResponse(undefined)).toBeUndefined()
    expect(permalinkFromResponse(null)).toBeUndefined()
    expect(permalinkFromResponse('https://x.test')).toBeUndefined()
    expect(permalinkFromResponse(123)).toBeUndefined()
  })
})
