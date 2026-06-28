import { describe, it, expect, vi } from 'vitest'
import {
  jiraAdapterResolver,
  jiraIssueRow,
  jiraListBindOptions,
  jiraDetailBindOptions,
  JIRA_LIST_PATH,
  JIRA_DETAIL_PATH,
  type JiraAdapterManager
} from './jiraAdapter'
import { JiraAdapterSource } from '../shared/types/jira'
import type {
  JiraGetIssueParams,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraResult,
  JiraSearchParams
} from '../shared/types/jira'

/* jira-generative-adapter-v1 — the Jira-specific resolver + bind options (FR-008/FR-009).
 * Maps a secret-free descriptor to a JiraManager read and normalizes the DTO into the
 * panel-agnostic AdapterFetchResult. Pattern per FR: happy path; missing optional (no
 * error); invalid/recoverable failure (safe ok:false notice, never throws). */

const SUMMARY: JiraIssueSummary = {
  key: 'PROJ-1',
  summary: 'A bug',
  statusName: 'To Do',
  statusCategory: 'todo'
}

const DETAIL: JiraIssueDetail = {
  key: 'PROJ-1',
  summary: 'A bug',
  statusName: 'To Do',
  statusCategory: 'todo',
  description: 'details',
  comments: [],
  availableTransitions: []
}

function manager(over: Partial<JiraAdapterManager> = {}): JiraAdapterManager {
  return {
    searchIssues: vi.fn(
      async (_p: JiraSearchParams): Promise<JiraResult<{ items: JiraIssueSummary[]; nextCursor?: string }>> => ({
        ok: true,
        data: { items: [SUMMARY] }
      })
    ),
    getIssue: vi.fn(
      async (_p: JiraGetIssueParams): Promise<JiraResult<JiraIssueDetail>> => ({ ok: true, data: DETAIL })
    ),
    ...over
  }
}

describe('jiraIssueRow (bound-row shape parity)', () => {
  it('maps a summary to the non-secret bound row (omits absent assignee)', () => {
    expect(jiraIssueRow(SUMMARY)).toEqual({
      issueKey: 'PROJ-1',
      summary: 'A bug',
      statusName: 'To Do',
      statusCategory: 'todo'
    })
  })

  it('includes the assignee when present (missing-optional path)', () => {
    const row = jiraIssueRow({ ...SUMMARY, assignee: { accountId: 'u1', displayName: 'Ada' } })
    expect(row.assignee).toEqual({ accountId: 'u1', displayName: 'Ada' })
  })
})

describe('bind options', () => {
  it('list = append at the list path; detail = none at the detail path (FR-020)', () => {
    expect(jiraListBindOptions).toEqual({ listPath: JIRA_LIST_PATH, pagination: 'append' })
    expect(jiraDetailBindOptions).toEqual({ listPath: JIRA_DETAIL_PATH, pagination: 'none' })
  })
})

describe('jiraAdapterResolver — searchIssues (FR-008/FR-009)', () => {
  it('maps a search descriptor to items + nextCursor (happy path)', async () => {
    const m = manager({
      searchIssues: vi.fn(
        async (): Promise<JiraResult<{ items: JiraIssueSummary[]; nextCursor?: string }>> => ({
          ok: true,
          data: { items: [SUMMARY], nextCursor: 'c2' }
        })
      )
    })
    const resolve = jiraAdapterResolver(m)
    const out = await resolve({ dataSource: JiraAdapterSource.SearchIssues, query: { jql: 'x', cursor: 'c1' } })
    expect(out).toEqual({ ok: true, items: [jiraIssueRow(SUMMARY)], nextCursor: 'c2' })
    expect(m.searchIssues).toHaveBeenCalledWith({ jql: 'x', cursor: 'c1' })
  })

  it('omits nextCursor when the page has none (missing optional must not error)', async () => {
    const resolve = jiraAdapterResolver(manager())
    const out = await resolve({ dataSource: JiraAdapterSource.SearchIssues, query: { jql: 'x' } })
    expect(out).toEqual({ ok: true, items: [jiraIssueRow(SUMMARY)] })
    expect(out.ok && 'nextCursor' in out).toBe(false)
  })

  it('surfaces a recoverable manager failure as ok:false (never throws — FR-022)', async () => {
    const m = manager({
      searchIssues: vi.fn(
        async (): Promise<JiraResult<{ items: JiraIssueSummary[]; nextCursor?: string }>> => ({
          ok: false,
          kind: 'reconnect_needed',
          message: 'Reconnect.'
        })
      )
    })
    const out = await jiraAdapterResolver(m)({ dataSource: JiraAdapterSource.SearchIssues, query: { jql: 'x' } })
    expect(out).toEqual({ ok: false, kind: 'reconnect_needed', message: 'Reconnect.' })
  })
})

describe('jiraAdapterResolver — getIssue (FR-008/FR-009)', () => {
  it('maps a getIssue descriptor to a single bound value (happy path)', async () => {
    const m = manager()
    const out = await jiraAdapterResolver(m)({ dataSource: JiraAdapterSource.GetIssue, query: { issueKey: 'PROJ-1' } })
    expect(out).toEqual({ ok: true, value: DETAIL })
    expect(m.getIssue).toHaveBeenCalledWith({ issueKey: 'PROJ-1' })
  })

  it('surfaces a gone/404 read as a recoverable notice (FR-022)', async () => {
    const m = manager({
      getIssue: vi.fn(
        async (): Promise<JiraResult<JiraIssueDetail>> => ({
          ok: false,
          kind: 'network',
          message: 'Not found.'
        })
      )
    })
    const out = await jiraAdapterResolver(m)({ dataSource: JiraAdapterSource.GetIssue, query: { issueKey: 'X' } })
    expect(out).toEqual({ ok: false, kind: 'network', message: 'Not found.' })
  })
})

describe('jiraAdapterResolver — unknown source (safe fallback FR-022)', () => {
  it('returns a recoverable notice for an unknown dataSource (never crash)', async () => {
    const out = await jiraAdapterResolver(manager())({ dataSource: 'bogus', query: {} })
    expect(out.ok).toBe(false)
    expect(out).toMatchObject({ kind: 'network' })
  })
})
