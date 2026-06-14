import { describe, it, expect, vi } from 'vitest'
import {
  validateUiDataModel,
  validateAdapterAction,
  validateAdapterDescriptor,
  adapterSourceMatchesTarget
} from './validate'
import { AdapterAction } from './adapter'

/* jira-generative-adapter-v1 — SHARED boundary validators (FR-007/009/010/019/022/023).
 * Pattern per FR: happy path; missing optional (no error); invalid/missing required
 * (warn + safe null); plus the secret-free invariant for the descriptor (FR-007). */

describe('validateUiDataModel (FR-009/FR-010/FR-022/FR-023)', () => {
  it('accepts a full payload { surfaceId, path, value } (happy path)', () => {
    const warn = vi.fn()
    const out = validateUiDataModel(
      { surfaceId: 's1', path: '/items', value: [{ key: 'PROJ-1' }] },
      warn
    )
    expect(out).toEqual({ surfaceId: 's1', path: '/items', value: [{ key: 'PROJ-1' }] })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a payload with optional path/value omitted (missing optional must not error)', () => {
    const warn = vi.fn()
    const out = validateUiDataModel({ surfaceId: 's1' }, warn)
    expect(out).toEqual({ surfaceId: 's1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves an explicit undefined value (remove semantics) when the key is present', () => {
    const warn = vi.fn()
    const out = validateUiDataModel({ surfaceId: 's1', path: '/error', value: undefined }, warn)
    expect(out).toEqual({ surfaceId: 's1', path: '/error', value: undefined })
    expect(out && 'value' in out).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns + ignores a missing surfaceId (invalid required → safe null)', () => {
    const warn = vi.fn()
    expect(validateUiDataModel({ path: '/items', value: [] }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a non-object payload', () => {
    const warn = vi.fn()
    expect(validateUiDataModel('nope', warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a non-string path', () => {
    const warn = vi.fn()
    expect(validateUiDataModel({ surfaceId: 's1', path: 7 }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('validateAdapterAction (FR-010/FR-016/FR-019)', () => {
  it('accepts adapter.refresh with a surfaceId (happy path)', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(AdapterAction.Refresh, { surfaceId: 's1' }, warn)
    expect(out).toEqual({ name: 'adapter.refresh', surfaceId: 's1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts adapter.loadMore with a surfaceId', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(AdapterAction.LoadMore, { surfaceId: 's1' }, warn)
    expect(out).toEqual({ name: 'adapter.loadMore', surfaceId: 's1' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts adapter.page with a direction', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(AdapterAction.Page, { surfaceId: 's1', direction: 'next' }, warn)
    expect(out).toEqual({ name: 'adapter.page', surfaceId: 's1', direction: 'next' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns + ignores an action outside the adapter.* namespace', () => {
    const warn = vi.fn()
    expect(validateAdapterAction('jira.transition', { surfaceId: 's1' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a missing surfaceId (invalid required → safe null)', () => {
    const warn = vi.fn()
    expect(validateAdapterAction(AdapterAction.Refresh, {}, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores adapter.page with an invalid direction', () => {
    const warn = vi.fn()
    expect(
      validateAdapterAction(AdapterAction.Page, { surfaceId: 's1', direction: 'sideways' }, warn)
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores an unknown adapter.* name', () => {
    const warn = vi.fn()
    expect(validateAdapterAction('adapter.teleport', { surfaceId: 's1' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('carries a valid descriptor on adapter.refresh for lazy re-registration (FR-013)', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(
      AdapterAction.Refresh,
      { surfaceId: 's1', descriptor: { dataSource: 'getIssue', query: { issueKey: 'PROJ-1' } } },
      warn
    )
    expect(out).toEqual({
      name: 'adapter.refresh',
      surfaceId: 's1',
      descriptor: { dataSource: 'getIssue', query: { issueKey: 'PROJ-1' } }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('strips a secret-bearing descriptor query but still re-registers (FR-007/FR-021)', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(
      AdapterAction.Refresh,
      { surfaceId: 's1', descriptor: { dataSource: 'searchIssues', query: { jql: 'x', token: 'SECRET' } } },
      warn
    )
    expect(out).toEqual({
      name: 'adapter.refresh',
      surfaceId: 's1',
      descriptor: { dataSource: 'searchIssues', query: { jql: 'x' } }
    })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })

  it('drops an INVALID descriptor but the refresh still proceeds (no descriptor)', () => {
    const warn = vi.fn()
    const out = validateAdapterAction(
      AdapterAction.Refresh,
      { surfaceId: 's1', descriptor: { query: { jql: 'x' } } },
      warn
    )
    expect(out).toEqual({ name: 'adapter.refresh', surfaceId: 's1' })
    expect(out && 'descriptor' in out).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})

describe('validateAdapterDescriptor (FR-005/FR-007 secret-free invariant)', () => {
  it('accepts a valid secret-free descriptor (happy path)', () => {
    const warn = vi.fn()
    const out = validateAdapterDescriptor(
      { dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()', cursor: 'abc' } },
      warn
    )
    expect(out).toEqual({
      dataSource: 'searchIssues',
      query: { jql: 'assignee = currentUser()', cursor: 'abc' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a descriptor with an empty query (missing optional cursor must not error)', () => {
    const warn = vi.fn()
    const out = validateAdapterDescriptor({ dataSource: 'getIssue', query: { issueKey: 'PROJ-1' } }, warn)
    expect(out).toEqual({ dataSource: 'getIssue', query: { issueKey: 'PROJ-1' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('STRIPS secret-looking keys from the query, warning (FR-007/FR-021)', () => {
    const warn = vi.fn()
    const out = validateAdapterDescriptor(
      {
        dataSource: 'searchIssues',
        query: { jql: 'x', token: 'SECRET', access_token: 'SECRET', client_secret: 'SECRET' }
      },
      warn
    )
    expect(out).toEqual({ dataSource: 'searchIssues', query: { jql: 'x' } })
    // No secret survives in the persisted descriptor.
    expect(JSON.stringify(out)).not.toContain('SECRET')
    expect(warn).toHaveBeenCalled()
  })

  it('warns + ignores a missing dataSource (invalid required → safe null)', () => {
    const warn = vi.fn()
    expect(validateAdapterDescriptor({ query: { jql: 'x' } }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a non-object query', () => {
    const warn = vi.fn()
    expect(validateAdapterDescriptor({ dataSource: 'searchIssues', query: 'x' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a non-object descriptor', () => {
    const warn = vi.fn()
    expect(validateAdapterDescriptor(null, warn)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

/* panel-refresh-v1 (OQ-4 / FR-012): a render-frame descriptor's `dataSource` must belong
 * to the frame's target integration; a cross-target descriptor is warned + ignored. When
 * `target` is omitted (the restore/re-activation path) the membership check is skipped. */
describe('validateAdapterDescriptor — cross-target gate (OQ-4 / FR-012)', () => {
  it('accepts a same-target descriptor (jira source on a jira frame)', () => {
    const warn = vi.fn()
    const out = validateAdapterDescriptor(
      { dataSource: 'searchIssues', query: { jql: 'x' } },
      warn,
      'jira'
    )
    expect(out).toEqual({ dataSource: 'searchIssues', query: { jql: 'x' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects a cross-target descriptor (jira source on a slack frame) → warn + null', () => {
    const warn = vi.fn()
    expect(
      validateAdapterDescriptor({ dataSource: 'searchIssues', query: { jql: 'x' } }, warn, 'slack')
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('rejects an unknown dataSource on any concrete target → warn + null', () => {
    const warn = vi.fn()
    expect(
      validateAdapterDescriptor({ dataSource: 'bogusSource', query: {} }, warn, 'jira')
    ).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it("the generic 'generated-ui' target accepts ANY known integration source", () => {
    const warn = vi.fn()
    for (const dataSource of ['searchIssues', 'listChannels', 'defaultFeed']) {
      const out = validateAdapterDescriptor({ dataSource, query: {} }, warn, 'generated-ui')
      expect(out).toEqual({ dataSource, query: {} })
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('still STRIPS secrets on the target path (secret-free invariant holds with a target)', () => {
    const warn = vi.fn()
    const out = validateAdapterDescriptor(
      { dataSource: 'listChannels', query: { token: 'SECRET', cursor: 'c1' } },
      warn,
      'slack'
    )
    expect(out).toEqual({ dataSource: 'listChannels', query: { cursor: 'c1' } })
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
})

describe('adapterSourceMatchesTarget (OQ-4 membership)', () => {
  it('maps each concrete source to its own target only', () => {
    expect(adapterSourceMatchesTarget('searchIssues', 'jira')).toBe(true)
    expect(adapterSourceMatchesTarget('searchIssues', 'slack')).toBe(false)
    expect(adapterSourceMatchesTarget('listChannels', 'slack')).toBe(true)
    expect(adapterSourceMatchesTarget('getPage', 'confluence')).toBe(true)
  })
  it("'generated-ui' is the permissive union; an unknown source matches nothing", () => {
    expect(adapterSourceMatchesTarget('searchIssues', 'generated-ui')).toBe(true)
    expect(adapterSourceMatchesTarget('listChannels', 'generated-ui')).toBe(true)
    expect(adapterSourceMatchesTarget('bogus', 'generated-ui')).toBe(false)
    expect(adapterSourceMatchesTarget('bogus', 'jira')).toBe(false)
  })

  // bindings-first v3: the model previously sent the MCP READ-TOOL name as dataSource. The render
  // servers' DESCRIPTOR_SCHEMA `.refine` rejects via the SAME membership the renderer enforces here
  // — a read-tool name (jira_search_issues / slack_* / confluence_*) belongs to NO target.
  it('a read-tool name is NOT a valid adapter source on any target (v3 reject)', () => {
    expect(adapterSourceMatchesTarget('jira_search_issues', 'jira')).toBe(false)
    expect(adapterSourceMatchesTarget('jira_search_issues', 'generated-ui')).toBe(false)
    expect(adapterSourceMatchesTarget('slack_read_history', 'slack')).toBe(false)
    expect(adapterSourceMatchesTarget('confluence_search_content', 'confluence')).toBe(false)
    // …while the matching adapter source id IS accepted (the value the model must send instead).
    expect(adapterSourceMatchesTarget('searchIssues', 'jira')).toBe(true)
    expect(adapterSourceMatchesTarget('getHistory', 'slack')).toBe(true)
    expect(adapterSourceMatchesTarget('searchContent', 'confluence')).toBe(true)
  })
})
