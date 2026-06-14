/**
 * descriptorShell — pure resolver tests (panel-refresh-v1, OQ-5 = main-composes / FR-010..012).
 *
 * The happy path: each integration's `dataSource` resolves to its BOUND, data-free shell
 * (a stable surfaceId) + the bind options the dispatcher registers it with. The
 * invalid/unknown case (an unrecognised source) → `null`, so the caller renders the agent's
 * literal spec un-refreshably (FR-012). Disjoint namespaces mean the source alone selects the
 * integration (Slack first, then Confluence, else Jira).
 *
 * `.test.ts` (node env) over the PURE `.ts` resolver — it pulls in the main-side surface
 * builders + bind-options (all node-safe, no DOM/`.tsx`).
 */

import { describe, it, expect } from 'vitest'
import { resolveDescriptorShell } from './descriptorShell'
import { SlackAdapterSource } from '../shared/slack'
import { ConfluenceAdapterSource } from '../shared/confluence'
import { JiraAdapterSource } from '../shared/jira'
import {
  SURFACE_SLACK_CHANNELS,
  SURFACE_SLACK_HISTORY,
  SURFACE_SLACK_SEARCH
} from './slackSurfaceBuilder'
import {
  SURFACE_CONFLUENCE_FEED,
  SURFACE_CONFLUENCE_SEARCH,
  SURFACE_CONFLUENCE_PAGE
} from './confluenceSurfaceBuilder'
import { SURFACE_DEFAULT_VIEW, SURFACE_ISSUE_DETAIL } from './jiraSurfaceBuilder'

const desc = (dataSource: string) => ({ dataSource, query: {} })

describe('resolveDescriptorShell — Slack sources', () => {
  it.each([
    [SlackAdapterSource.ListChannels, SURFACE_SLACK_CHANNELS],
    [SlackAdapterSource.GetHistory, SURFACE_SLACK_HISTORY],
    [SlackAdapterSource.Search, SURFACE_SLACK_SEARCH]
  ])('%s → its bound shell + options', (source, surfaceId) => {
    const out = resolveDescriptorShell(desc(source))
    expect(out).not.toBeNull()
    expect(out!.spec.surfaceId).toBe(surfaceId)
    expect(out!.options).toBeTruthy()
  })
})

describe('resolveDescriptorShell — Confluence sources', () => {
  it.each([
    [ConfluenceAdapterSource.DefaultFeed, SURFACE_CONFLUENCE_FEED],
    [ConfluenceAdapterSource.SearchContent, SURFACE_CONFLUENCE_SEARCH],
    [ConfluenceAdapterSource.GetPage, SURFACE_CONFLUENCE_PAGE]
  ])('%s → its bound shell + options', (source, surfaceId) => {
    const out = resolveDescriptorShell(desc(source))
    expect(out).not.toBeNull()
    expect(out!.spec.surfaceId).toBe(surfaceId)
    expect(out!.options).toBeTruthy()
  })
})

describe('resolveDescriptorShell — Jira sources', () => {
  it('searchIssues → the default-view list shell', () => {
    const out = resolveDescriptorShell(desc(JiraAdapterSource.SearchIssues))
    expect(out!.spec.surfaceId).toBe(SURFACE_DEFAULT_VIEW)
  })
  it('getIssue → the issue-detail shell (distinct detail bind options)', () => {
    const out = resolveDescriptorShell(desc(JiraAdapterSource.GetIssue))
    expect(out!.spec.surfaceId).toBe(SURFACE_ISSUE_DETAIL)
  })
})

describe('resolveDescriptorShell — unknown source', () => {
  it('returns null so the caller renders the literal spec un-refreshably (FR-012)', () => {
    expect(resolveDescriptorShell(desc('bogusSource'))).toBeNull()
  })
  it('the composed shell is DATA-FREE (no seeded values — the dispatcher paints on refresh)', () => {
    // A shell only declares components/bindings; it carries no `dataModel` seed (that comes
    // from the dispatcher's first refresh in main).
    const out = resolveDescriptorShell(desc(SlackAdapterSource.ListChannels))
    expect(out!.spec.surfaceId).toBe(SURFACE_SLACK_CHANNELS)
    expect((out!.spec as { dataModel?: unknown }).dataModel).toBeUndefined()
  })
})
