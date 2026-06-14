/**
 * descriptorRegistration + resolveBindOptionsForSource — pure decision tests
 * (refreshable-custom-generative-ui-v1, FR-001/FR-002/FR-006/FR-015).
 *
 * `.test.ts` (node env) over the PURE main-side resolvers — they pull in the surface
 * builders + bind-options (all node-safe, no DOM/.tsx). These prove the CORE rule with the
 * REAL resolvers (not a spy): a descriptor + usable custom spec registers the AGENT's own
 * surfaceId + pushes the agent's spec; a descriptor + unusable spec falls back to the generic
 * shell; an unknown dataSource registers nothing.
 */

import { describe, it, expect } from 'vitest'
import { planAgentSurfaceRegistration } from './descriptorRegistration'
import { resolveBindOptionsForSource } from './descriptorShell'
import { JiraAdapterSource } from '../shared/jira'
import { SlackAdapterSource } from '../shared/slack'
import { ConfluenceAdapterSource } from '../shared/confluence'
import { SURFACE_DEFAULT_VIEW, SURFACE_ISSUE_DETAIL } from './jiraSurfaceBuilder'
import { AdapterSourcePath } from '../shared/adapter'
import type { A2uiSurfaceUpdate } from '../shared/ipc'

const desc = (dataSource: string) => ({ dataSource, query: {} })

/** A USABLE custom agent spec: a non-empty surfaceId + a components array (FR-001). */
const usableSpec: A2uiSurfaceUpdate = {
  surfaceId: 'agent-kanban-7',
  components: [{ id: 'root', component: 'Column', children: [] }]
} as unknown as A2uiSurfaceUpdate

describe('resolveBindOptionsForSource (FR-002/FR-015)', () => {
  it.each([
    [JiraAdapterSource.SearchIssues, AdapterSourcePath.searchIssues, 'append'],
    [JiraAdapterSource.GetIssue, AdapterSourcePath.getIssue, 'none'],
    [SlackAdapterSource.ListChannels, AdapterSourcePath.listChannels, 'append'],
    [SlackAdapterSource.GetHistory, AdapterSourcePath.getHistory, 'append'],
    [SlackAdapterSource.Search, AdapterSourcePath.search, 'append'],
    [ConfluenceAdapterSource.DefaultFeed, AdapterSourcePath.defaultFeed, 'append'],
    [ConfluenceAdapterSource.SearchContent, AdapterSourcePath.searchContent, 'append'],
    [ConfluenceAdapterSource.GetPage, AdapterSourcePath.getPage, 'none']
  ])('%s → listPath %s (pagination %s)', (source, listPath, pagination) => {
    const opts = resolveBindOptionsForSource(source)
    expect(opts).not.toBeNull()
    expect(opts!.listPath).toBe(listPath)
    expect(opts!.pagination).toBe(pagination)
  })

  it('returns null for an unknown source (FR-015)', () => {
    expect(resolveBindOptionsForSource('bogusSource')).toBeNull()
  })

  it('the documented path equals the dispatcher-registered path (no drift — FR-002)', () => {
    // The SAME constant feeds both the tool-description text and the bind options.
    expect(resolveBindOptionsForSource(JiraAdapterSource.SearchIssues)!.listPath).toBe(
      AdapterSourcePath.searchIssues
    )
  })
})

describe('planAgentSurfaceRegistration — register the agent surface (FR-001)', () => {
  it('a usable spec + registerable source → registers under the AGENT surfaceId, pushes the agent spec', () => {
    const plan = planAgentSurfaceRegistration(desc(JiraAdapterSource.SearchIssues), usableSpec)
    expect(plan.register).toBe(true)
    if (!plan.register) throw new Error('expected register')
    // Registered under the AGENT's own surfaceId — NOT the generic shell's.
    expect(plan.surfaceId).toBe('agent-kanban-7')
    expect(plan.surfaceId).not.toBe(SURFACE_DEFAULT_VIEW)
    // The pushed spec IS the agent's spec, unchanged.
    expect(plan.spec).toBe(usableSpec)
    // The bind options come from the dataSource (FR-002).
    expect(plan.options.listPath).toBe(AdapterSourcePath.searchIssues)
  })

  it('a usable detail spec + getIssue → none-pagination bind options at the detail path', () => {
    const plan = planAgentSurfaceRegistration(desc(JiraAdapterSource.GetIssue), usableSpec)
    if (!plan.register) throw new Error('expected register')
    expect(plan.surfaceId).toBe('agent-kanban-7')
    expect(plan.options.listPath).toBe(AdapterSourcePath.getIssue)
    expect(plan.options.pagination).toBe('none')
  })
})

describe('planAgentSurfaceRegistration — fallback to the generic shell (FR-006)', () => {
  it('a registerable source but a spec with NO components → the generic shell', () => {
    const noComponents = { surfaceId: 'agent-x' } as unknown as A2uiSurfaceUpdate
    const plan = planAgentSurfaceRegistration(desc(JiraAdapterSource.SearchIssues), noComponents)
    if (!plan.register) throw new Error('expected register')
    // The pushed surfaceId is the SHELL's, not the agent's unusable id.
    expect(plan.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
    expect(plan.spec.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
  })

  it('a registerable source but an EMPTY surfaceId → the generic shell', () => {
    const emptyId = { surfaceId: '', components: [] } as unknown as A2uiSurfaceUpdate
    const plan = planAgentSurfaceRegistration(desc(JiraAdapterSource.GetIssue), emptyId)
    if (!plan.register) throw new Error('expected register')
    expect(plan.surfaceId).toBe(SURFACE_ISSUE_DETAIL)
  })
})

describe('planAgentSurfaceRegistration — unknown source (FR-015)', () => {
  it('registers nothing; pushes the agent spec unchanged', () => {
    const plan = planAgentSurfaceRegistration(desc('bogusSource'), usableSpec)
    expect(plan.register).toBe(false)
    expect(plan.spec).toBe(usableSpec)
  })
})
