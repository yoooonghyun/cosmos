import { describe, it, expect, vi } from 'vitest'
import {
  validateConfluenceBridgeCall,
  validateConfluenceComment,
  validateConfluenceCreate,
  validateConfluenceGetPage,
  validateConfluenceSearch,
  validateConfluenceUpdate,
  validateJiraBridgeCall,
  validateJiraGetIssue,
  validateJiraSearch
} from './validate'
import { JiraOp } from './types/jira'
import { ConfluenceOp } from './types/confluence'

describe('Jira IPC validators (FR-J04, FR-X04, SC-009)', () => {
  describe('validateJiraSearch', () => {
    it('accepts a non-empty jql (no cursor — happy path)', () => {
      const warn = vi.fn()
      expect(validateJiraSearch({ jql: 'project = ABC' }, warn)).toEqual({ jql: 'project = ABC' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('accepts an optional cursor (missing optional must not error)', () => {
      const warn = vi.fn()
      expect(validateJiraSearch({ jql: 'order by created', cursor: 'tok' }, warn)).toEqual({
        jql: 'order by created',
        cursor: 'tok'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required jql is missing', () => {
      const warn = vi.fn()
      expect(validateJiraSearch({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on an empty jql', () => {
      const warn = vi.fn()
      expect(validateJiraSearch({ jql: '' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-string cursor (invalid optional)', () => {
      const warn = vi.fn()
      expect(validateJiraSearch({ jql: 'x', cursor: 5 }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it.each([null, undefined, 'x', 7])('warns + null on non-object %p', (raw) => {
      const warn = vi.fn()
      expect(validateJiraSearch(raw as unknown, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateJiraGetIssue', () => {
    it('accepts a valid issueKey (happy path)', () => {
      const warn = vi.fn()
      expect(validateJiraGetIssue({ issueKey: 'ABC-1' }, warn)).toEqual({ issueKey: 'ABC-1' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required issueKey is missing', () => {
      const warn = vi.fn()
      expect(validateJiraGetIssue({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })
})

describe('validateJiraBridgeCall (FR-X01, FR-X04)', () => {
  it('accepts a well-formed jira_call frame (happy path)', () => {
    const warn = vi.fn()
    const out = validateJiraBridgeCall(
      { kind: 'jira_call', callId: 'c1', op: JiraOp.SearchIssues, params: { jql: 'x' } },
      warn
    )
    expect(out).toEqual({ callId: 'c1', op: JiraOp.SearchIssues, params: { jql: 'x' } })
    expect(warn).not.toHaveBeenCalled()
  })
  it('warns + null on an unknown kind (malformed frame ignored)', () => {
    const warn = vi.fn()
    expect(
      validateJiraBridgeCall({ kind: 'slack_call', callId: 'c', op: 'searchIssues', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
  it('warns + null on an unknown op (cannot mis-route)', () => {
    const warn = vi.fn()
    expect(
      validateJiraBridgeCall({ kind: 'jira_call', callId: 'c', op: 'deleteIssue', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
  it('warns + null when callId is missing (cannot correlate)', () => {
    const warn = vi.fn()
    expect(
      validateJiraBridgeCall({ kind: 'jira_call', op: 'getIssue', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
  it('warns + null when params is not an object', () => {
    const warn = vi.fn()
    expect(
      validateJiraBridgeCall({ kind: 'jira_call', callId: 'c', op: 'getIssue', params: 'x' }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('Confluence IPC validators (FR-C04, FR-X04, SC-009)', () => {
  describe('validateConfluenceSearch', () => {
    it('accepts a non-empty query (no cursor — happy path)', () => {
      const warn = vi.fn()
      expect(validateConfluenceSearch({ query: 'onboarding' }, warn)).toEqual({
        query: 'onboarding'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('accepts an optional cursor (missing optional must not error)', () => {
      const warn = vi.fn()
      expect(validateConfluenceSearch({ query: 'q', cursor: 'next' }, warn)).toEqual({
        query: 'q',
        cursor: 'next'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required query is missing', () => {
      const warn = vi.fn()
      expect(validateConfluenceSearch({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on an empty query', () => {
      const warn = vi.fn()
      expect(validateConfluenceSearch({ query: '' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-string cursor (invalid optional)', () => {
      const warn = vi.fn()
      expect(validateConfluenceSearch({ query: 'q', cursor: 9 }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateConfluenceGetPage', () => {
    it('accepts a valid pageId (happy path)', () => {
      const warn = vi.fn()
      expect(validateConfluenceGetPage({ pageId: '12345' }, warn)).toEqual({ pageId: '12345' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required pageId is missing', () => {
      const warn = vi.fn()
      expect(validateConfluenceGetPage({}, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateConfluenceCreate', () => {
    it('accepts the required fields without a parent (happy path)', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceCreate({ spaceKey: 'ENG', title: 'Notes', body: 'hello' }, warn)
      ).toEqual({ spaceKey: 'ENG', title: 'Notes', body: 'hello' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('passes an optional parentId through (missing optional must not error)', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceCreate(
          { spaceKey: 'ENG', title: 'Notes', body: 'hello', parentId: '99' },
          warn
        )
      ).toEqual({ spaceKey: 'ENG', title: 'Notes', body: 'hello', parentId: '99' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('preserves the exact body text (only the blank-check trims)', () => {
      const warn = vi.fn()
      const out = validateConfluenceCreate(
        { spaceKey: 'ENG', title: 'T', body: ' line one\nline two ' },
        warn
      )
      expect(out?.body).toBe(' line one\nline two ')
    })
    it('warns + null when required spaceKey is missing', () => {
      const warn = vi.fn()
      expect(validateConfluenceCreate({ title: 'T', body: 'b' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a whitespace-only title', () => {
      const warn = vi.fn()
      expect(validateConfluenceCreate({ spaceKey: 'ENG', title: '   ', body: 'b' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a whitespace-only body', () => {
      const warn = vi.fn()
      expect(validateConfluenceCreate({ spaceKey: 'ENG', title: 'T', body: '  ' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-string parentId (invalid optional)', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceCreate({ spaceKey: 'ENG', title: 'T', body: 'b', parentId: 5 }, warn)
      ).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-object payload', () => {
      const warn = vi.fn()
      expect(validateConfluenceCreate(null, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateConfluenceUpdate (confluence-mcp-write-v1, FR-006)', () => {
    it('accepts the required pageId+title with an optional body+versionMessage (happy path)', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceUpdate(
          { pageId: '123', title: 'Revised', body: 'new', versionMessage: 'fix' },
          warn
        )
      ).toEqual({ pageId: '123', title: 'Revised', body: 'new', versionMessage: 'fix' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('accepts a title-only update (no body — missing optional must not error)', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate({ pageId: '123', title: 'Renamed' }, warn)).toEqual({
        pageId: '123',
        title: 'Renamed'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('accepts an empty-string body (preserve-semantics live in the manager, not the validator)', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate({ pageId: '1', title: 'T', body: '' }, warn)).toEqual({
        pageId: '1',
        title: 'T',
        body: ''
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required pageId is missing', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate({ title: 'T' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a whitespace-only title', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate({ pageId: '1', title: '   ' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-string body (invalid optional)', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate({ pageId: '1', title: 'T', body: 42 }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-string versionMessage (invalid optional)', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceUpdate({ pageId: '1', title: 'T', versionMessage: 5 }, warn)
      ).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('ignores unknown/extra fields', () => {
      const warn = vi.fn()
      expect(
        validateConfluenceUpdate({ pageId: '1', title: 'T', spaceKey: 'ENG', evil: true }, warn)
      ).toEqual({ pageId: '1', title: 'T' })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null on a non-object payload (never throws)', () => {
      const warn = vi.fn()
      expect(validateConfluenceUpdate(null, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })

  describe('validateConfluenceComment (confluence-mcp-write-v1, comment FR)', () => {
    it('accepts the required pageId+body (happy path)', () => {
      const warn = vi.fn()
      expect(validateConfluenceComment({ pageId: '123', body: 'looks good' }, warn)).toEqual({
        pageId: '123',
        body: 'looks good'
      })
      expect(warn).not.toHaveBeenCalled()
    })
    it('warns + null when required pageId is missing', () => {
      const warn = vi.fn()
      expect(validateConfluenceComment({ body: 'x' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a whitespace-only body', () => {
      const warn = vi.fn()
      expect(validateConfluenceComment({ pageId: '1', body: '   ' }, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
    it('warns + null on a non-object payload (never throws)', () => {
      const warn = vi.fn()
      expect(validateConfluenceComment(undefined, warn)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
  })
})

describe('validateConfluenceBridgeCall (FR-X01, FR-X04)', () => {
  it('accepts a well-formed confluence_call frame (happy path)', () => {
    const warn = vi.fn()
    const out = validateConfluenceBridgeCall(
      { kind: 'confluence_call', callId: 'c1', op: ConfluenceOp.SearchContent, params: { query: 'x' } },
      warn
    )
    expect(out).toEqual({ callId: 'c1', op: ConfluenceOp.SearchContent, params: { query: 'x' } })
    expect(warn).not.toHaveBeenCalled()
  })
  it('warns + null on an unknown kind (malformed frame ignored)', () => {
    const warn = vi.fn()
    expect(
      validateConfluenceBridgeCall({ kind: 'jira_call', callId: 'c', op: 'searchContent', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
  it('warns + null on an unknown op (cannot mis-route)', () => {
    const warn = vi.fn()
    expect(
      validateConfluenceBridgeCall({ kind: 'confluence_call', callId: 'c', op: 'deletePage', params: {} }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
  it('warns + null when params is not an object', () => {
    const warn = vi.fn()
    expect(
      validateConfluenceBridgeCall({ kind: 'confluence_call', callId: 'c', op: 'getPage', params: 1 }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})
