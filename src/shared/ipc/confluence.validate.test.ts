import { describe, it, expect, vi } from 'vitest'
import {
  validateConfluenceGetComments,
  validateConfluenceAddComment
} from './confluence.validate'

/** A warn spy so we assert invalid payloads warn (and never throw). */
function spyWarn() {
  return vi.fn()
}

describe('validateConfluenceGetComments (confluence-dock-comments-v1, FR-003/FR-010)', () => {
  it('accepts a valid pageId (no cursor)', () => {
    expect(validateConfluenceGetComments({ pageId: '12345' })).toEqual({ pageId: '12345' })
  })

  it('accepts a valid pageId WITH a cursor', () => {
    expect(validateConfluenceGetComments({ pageId: '12345', cursor: 'CUR9' })).toEqual({
      pageId: '12345',
      cursor: 'CUR9'
    })
  })

  it('warns + ignores a missing pageId (returns null, never throws)', () => {
    const warn = spyWarn()
    expect(validateConfluenceGetComments({}, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns + ignores an empty pageId (matches validateConfluenceGetPage — non-empty, not trimmed)', () => {
    const warn = spyWarn()
    expect(validateConfluenceGetComments({ pageId: '' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('warns + ignores a non-object payload', () => {
    const warn = spyWarn()
    expect(validateConfluenceGetComments(null, warn)).toBeNull()
    expect(validateConfluenceGetComments('nope', warn)).toBeNull()
    expect(validateConfluenceGetComments(42, warn)).toBeNull()
  })

  it('warns + ignores a non-string cursor', () => {
    const warn = spyWarn()
    expect(validateConfluenceGetComments({ pageId: '1', cursor: 99 }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('validateConfluenceAddComment (confluence-dock-comments-v1, FR-006/FR-010)', () => {
  it('accepts a valid pageId + non-empty body', () => {
    expect(validateConfluenceAddComment({ pageId: '777', body: 'looks good' })).toEqual({
      pageId: '777',
      body: 'looks good'
    })
  })

  it('preserves the exact body text (only trims for the non-empty check)', () => {
    const params = validateConfluenceAddComment({ pageId: '1', body: '  spaced  ' })
    expect(params?.body).toBe('  spaced  ')
  })

  it('warns + ignores a missing/empty pageId', () => {
    const warn = spyWarn()
    expect(validateConfluenceAddComment({ body: 'x' }, warn)).toBeNull()
    expect(validateConfluenceAddComment({ pageId: '', body: 'x' }, warn)).toBeNull()
  })

  it('warns + ignores an empty / whitespace-only body (no request)', () => {
    const warn = spyWarn()
    expect(validateConfluenceAddComment({ pageId: '1', body: '' }, warn)).toBeNull()
    expect(validateConfluenceAddComment({ pageId: '1', body: '   \n\t ' }, warn)).toBeNull()
  })

  it('warns + ignores a non-object / non-string body (never throws)', () => {
    const warn = spyWarn()
    expect(validateConfluenceAddComment(undefined, warn)).toBeNull()
    expect(validateConfluenceAddComment({ pageId: '1', body: 5 }, warn)).toBeNull()
  })
})
