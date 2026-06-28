import { describe, it, expect } from 'vitest'
import {
  buildBoundIssueDetailSurface,
  buildBoundIssueListSurface,
  buildCreateIssueSurface,
  buildDefaultViewSurface,
  buildEditIssueSurface,
  buildIssueDetailSurface,
  buildIssueListSurface,
  buildNoticeSurface,
  formatCommentTime
} from './jiraSurfaceBuilder'
import { JIRA_DETAIL_PATH, JIRA_LIST_PATH, jiraIssueRow } from './jiraAdapter'
import { JiraAdapterSource } from '../shared/types/jira'
import type { JiraIssueDetail, JiraIssueSummary, JiraPage } from '../shared/types/jira'

/* Jira generative-UI v2 — pure surface builder emitting the JIRA CUSTOM catalog. */

type Component = { id: string; component: string } & Record<string, unknown>

function find(components: Component[], predicate: (c: Component) => boolean): Component | undefined {
  return components.find(predicate)
}

function byComponent(components: Component[], kind: string): Component[] {
  return components.filter((c) => c.component === kind)
}

/** The Jira custom-catalog component vocabulary (+ permitted Column/Text passthroughs). */
const JIRA_CATALOG_TYPES = new Set([
  'StatusBadge',
  'TicketCard',
  'IssueList',
  'TransitionPicker',
  'CommentRow',
  'CommentList',
  'AddCommentControl',
  'CreateIssueForm',
  'EditIssueForm',
  'Notice',
  'Column',
  'Text'
])

const detailBase: JiraIssueDetail = {
  key: 'PROJ-1',
  summary: 'Fix the widget',
  statusName: 'In Progress',
  statusCategory: 'in_progress',
  assignee: { accountId: 'a1', displayName: 'Ada Lovelace' },
  reporter: { accountId: 'r1', displayName: 'Grace Hopper' },
  description: 'A longer description.',
  comments: [
    { id: 'c1', author: { accountId: 'a2', displayName: 'Cy' }, body: 'first', created: '2026-01-01T10:00:00.000Z' }
  ],
  availableTransitions: [
    { id: '11', name: 'Start Progress' },
    { id: '31', name: 'Done' }
  ]
}

describe('buildIssueListSurface (v2 FR-006 — jira catalog)', () => {
  it('emits a single IssueList root carrying the page issues as static props', () => {
    const page: JiraPage<JiraIssueSummary> = {
      items: [
        { key: 'PROJ-1', summary: 'A', statusName: 'To Do', statusCategory: 'todo' },
        { key: 'PROJ-2', summary: 'B', statusName: 'Done', statusCategory: 'done', assignee: { accountId: 'a', displayName: 'Ada' } }
      ]
    }
    const surface = buildIssueListSurface(page)
    const comps = surface.components as Component[]
    const list = find(comps, (c) => c.component === 'IssueList')
    expect(list).toBeDefined()
    const issues = list!.issues as Record<string, unknown>[]
    expect(issues).toHaveLength(2)
    expect(issues[0].issueKey).toBe('PROJ-1')
    expect(issues[1].issueKey).toBe('PROJ-2')
    // status category carried through for the color win
    expect(issues[0].statusCategory).toBe('todo')
    expect(issues[1].assignee).toEqual({ accountId: 'a', displayName: 'Ada' })
  })

  it('omits assignee for an unassigned issue (missing optional field, no error)', () => {
    const page: JiraPage<JiraIssueSummary> = {
      items: [{ key: 'PROJ-9', summary: 'X', statusName: 'To Do', statusCategory: 'todo' }]
    }
    const list = find(buildIssueListSurface(page).components as Component[], (c) => c.component === 'IssueList')!
    const issues = list.issues as Record<string, unknown>[]
    expect('assignee' in issues[0]).toBe(false)
  })

  it('emits an IssueList with an empty issues array for a 0-item page (calm empty state is the component\'s job)', () => {
    const list = find(buildIssueListSurface({ items: [] }).components as Component[], (c) => c.component === 'IssueList')!
    expect(list.issues).toEqual([])
  })

  it('uses only jira-catalog component types', () => {
    const comps = buildIssueListSurface({ items: [{ key: 'P-1', summary: 'A', statusName: 'To Do', statusCategory: 'todo' }] }).components as Component[]
    for (const c of comps) {
      expect(JIRA_CATALOG_TYPES.has(c.component)).toBe(true)
    }
  })
})

describe('buildDefaultViewSurface (v2 D4 / FR-019)', () => {
  it('emits an IssueList with a distinct default-view surfaceId', () => {
    const page: JiraPage<JiraIssueSummary> = {
      items: [{ key: 'PROJ-1', summary: 'A', statusName: 'To Do', statusCategory: 'todo' }]
    }
    const surface = buildDefaultViewSurface(page)
    expect(surface.surfaceId).toBe('jira-default-view')
    const list = find(surface.components as Component[], (c) => c.component === 'IssueList')
    expect(list).toBeDefined()
    expect((list!.issues as unknown[])).toHaveLength(1)
  })

  it('emits an empty IssueList for an empty default page (no crash, no pagination)', () => {
    const surface = buildDefaultViewSurface({ items: [] })
    const list = find(surface.components as Component[], (c) => c.component === 'IssueList')!
    expect(list.issues).toEqual([])
  })
})

describe('buildIssueDetailSurface (v2 — jira catalog, child order §9.4)', () => {
  it('emits the header TicketCard, CommentList, TransitionPicker, and AddCommentControl', () => {
    const comps = buildIssueDetailSurface(detailBase).components as Component[]
    const card = find(comps, (c) => c.component === 'TicketCard')
    expect(card?.issueKey).toBe('PROJ-1')
    expect(card?.statusCategory).toBe('in_progress')

    const picker = find(comps, (c) => c.component === 'TransitionPicker')
    expect(picker?.issueKey).toBe('PROJ-1')
    expect(picker?.availableTransitions).toEqual([
      { id: '11', name: 'Start Progress' },
      { id: '31', name: 'Done' }
    ])

    const comments = find(comps, (c) => c.component === 'CommentList')
    expect((comments?.comments as unknown[])).toHaveLength(1)

    const addComment = find(comps, (c) => c.component === 'AddCommentControl')
    expect(addComment?.issueKey).toBe('PROJ-1')
  })

  it('passes an empty availableTransitions through to the component (it renders the empty state)', () => {
    const comps = buildIssueDetailSurface({ ...detailBase, availableTransitions: [] }).components as Component[]
    const picker = find(comps, (c) => c.component === 'TransitionPicker')!
    expect(picker.availableTransitions).toEqual([])
  })

  it('renders the description body, with a placeholder for an empty description (no error)', () => {
    const withDesc = buildIssueDetailSurface(detailBase).components as Component[]
    expect(byComponent(withDesc, 'Text').some((t) => t.text === 'A longer description.')).toBe(true)
    const empty = buildIssueDetailSurface({ ...detailBase, description: '' }).components as Component[]
    expect(byComponent(empty, 'Text').some((t) => t.text === 'No description.')).toBe(true)
  })

  it('handles missing assignee without error (TicketCard omits the prop)', () => {
    const { assignee: _a, ...rest } = detailBase
    const comps = buildIssueDetailSurface(rest as JiraIssueDetail).components as Component[]
    const card = find(comps, (c) => c.component === 'TicketCard')!
    expect('assignee' in card).toBe(false)
  })

  it('prepends a colored Notice as the first child when opts.notice is set (FR-007, §9.5)', () => {
    for (const kind of ['success', 'error', 'write_not_authorized'] as const) {
      const comps = buildIssueDetailSurface(detailBase, { notice: { kind, message: `m-${kind}` } }).components as Component[]
      const notice = find(comps, (c) => c.component === 'Notice')
      expect(notice).toBeDefined()
      expect(notice!.noticeKind).toBe(kind)
      expect(notice!.message).toBe(`m-${kind}`)
      // the notice id is the FIRST child of the root column
      const root = find(comps, (c) => c.component === 'Column')!
      expect((root.children as string[])[0]).toBe(notice!.id)
    }
  })

  it('uses only jira-catalog component types (incl. permitted Column/Text passthroughs)', () => {
    const comps = buildIssueDetailSurface(detailBase, { notice: { kind: 'success', message: 'ok' } }).components as Component[]
    for (const c of comps) {
      expect(JIRA_CATALOG_TYPES.has(c.component)).toBe(true)
    }
  })

  it('carries no token/secret in the surface (FR-017)', () => {
    const json = JSON.stringify(buildIssueDetailSurface(detailBase))
    expect(json).not.toMatch(/Bearer|accessToken|refreshToken/)
  })
})

describe('buildNoticeSurface (v2 default-view recoverable error)', () => {
  it('emits a single Notice root on the default-view surface', () => {
    const surface = buildNoticeSurface({ kind: 'error', message: 'busy' })
    expect(surface.surfaceId).toBe('jira-default-view')
    const comps = surface.components as Component[]
    expect(comps).toHaveLength(1)
    expect(comps[0].component).toBe('Notice')
    expect(comps[0].noticeKind).toBe('error')
    expect(comps[0].message).toBe('busy')
  })
})

describe('buildCreateIssueSurface (Jira write-extend v1, FR-018, design §3)', () => {
  it('emits a single CreateIssueForm root on the create surface (no notice by default)', () => {
    const surface = buildCreateIssueSurface()
    expect(surface.surfaceId).toBe('jira-create-issue')
    const comps = surface.components as Component[]
    const form = find(comps, (c) => c.component === 'CreateIssueForm')
    expect(form).toBeDefined()
    expect(byComponent(comps, 'Notice')).toHaveLength(0)
    // every emitted component is in the Jira custom-catalog vocabulary
    for (const c of comps) {
      expect(JIRA_CATALOG_TYPES.has(c.component)).toBe(true)
    }
  })

  it('renders a Notice as the FIRST child of the root when present (failed re-push, §5)', () => {
    const surface = buildCreateIssueSurface({
      notice: { kind: 'error', message: 'This project requires additional fields.' },
      seed: { projectKey: 'PROJ', issueType: 'Task', summary: 'kept', description: 'd' }
    })
    const comps = surface.components as Component[]
    const root = find(comps, (c) => c.component === 'Column')!
    const children = root.children as string[]
    const notice = find(comps, (c) => c.component === 'Notice')!
    expect(children[0]).toBe(notice.id) // notice first
    expect(notice.noticeKind).toBe('error')
    // the seeded entered values are carried so the form re-appears pre-filled (§5)
    const form = find(comps, (c) => c.component === 'CreateIssueForm')!
    expect(form.seededSummary).toBe('kept')
  })

  it('passes issue-type / project-key option lists through to the form (Select variant, §2 note A)', () => {
    const surface = buildCreateIssueSurface({
      issueTypes: ['Task', 'Bug'],
      projectKeys: ['PROJ', 'OPS'],
      defaultProjectKey: 'PROJ'
    })
    const form = find(surface.components as Component[], (c) => c.component === 'CreateIssueForm')!
    expect(form.issueTypes).toEqual(['Task', 'Bug'])
    expect(form.projectKeys).toEqual(['PROJ', 'OPS'])
    expect(form.defaultProjectKey).toBe('PROJ')
  })
})

describe('buildEditIssueSurface (Jira write-extend v1, FR-018, design §4)', () => {
  it('emits an EditIssueForm seeded from the issue\'s current summary/description + key', () => {
    const surface = buildEditIssueSurface(detailBase)
    expect(surface.surfaceId).toBe('jira-edit-issue')
    const comps = surface.components as Component[]
    const form = find(comps, (c) => c.component === 'EditIssueForm')!
    expect(form.issueKey).toBe('PROJ-1')
    expect(form.seededSummary).toBe('Fix the widget')
    expect(form.seededDescription).toBe('A longer description.')
    for (const c of comps) {
      expect(JIRA_CATALOG_TYPES.has(c.component)).toBe(true)
    }
  })

  it('renders a Notice as the FIRST child on a failed-update re-push (§5)', () => {
    const surface = buildEditIssueSurface(detailBase, {
      notice: { kind: 'write_not_authorized', message: 'Reconnect Jira to enable actions.' }
    })
    const comps = surface.components as Component[]
    const root = find(comps, (c) => c.component === 'Column')!
    const children = root.children as string[]
    const notice = find(comps, (c) => c.component === 'Notice')!
    expect(children[0]).toBe(notice.id)
    expect(notice.noticeKind).toBe('write_not_authorized')
  })
})

/* jira-generative-adapter-v1 — BOUND surfaces: `{path}`-bound (data-free) spec + an
 * initial data-model seed + a secret-free descriptor. Pattern per FR: happy path; the
 * missing-optional (no nextCursor → hasMore:false); the no-secret invariant (FR-017). */

function isBinding(v: unknown): v is { path: string } {
  return typeof v === 'object' && v !== null && typeof (v as { path?: unknown }).path === 'string'
}

describe('buildBoundIssueListSurface (FR-001/FR-004/FR-008)', () => {
  const page: JiraPage<JiraIssueSummary> = {
    items: [{ key: 'PROJ-1', summary: 'A', statusName: 'To Do', statusCategory: 'todo' }],
    nextCursor: 'c2'
  }

  it('emits an IssueList root whose rows + flags are {path} bindings (data-free spec)', () => {
    const { spec } = buildBoundIssueListSurface('jira-default-view', 'assignee = currentUser()', page)
    expect(spec.surfaceId).toBe('jira-default-view')
    const list = find(spec.components as Component[], (c) => c.component === 'IssueList')!
    expect(list.issues).toEqual({ path: JIRA_LIST_PATH })
    expect(list.loading).toEqual({ path: '/loading' })
    expect(list.hasMore).toEqual({ path: '/hasMore' })
    // No literal row data leaked into the spec (it lives only in the data model).
    expect(isBinding(list.issues)).toBe(true)
  })

  it('seeds the initial data model: first page rows + /loading=false + /hasMore (FR-003)', () => {
    const { dataModel } = buildBoundIssueListSurface('jira-default-view', 'x', page)
    expect(dataModel).toEqual([
      { surfaceId: 'jira-default-view', path: JIRA_LIST_PATH, value: [jiraIssueRow(page.items[0])] },
      { surfaceId: 'jira-default-view', path: '/loading', value: false },
      { surfaceId: 'jira-default-view', path: '/hasMore', value: true }
    ])
  })

  it('seeds hasMore:false when the page has no nextCursor (missing optional, no error)', () => {
    const { dataModel } = buildBoundIssueListSurface('jira-default-view', 'x', { items: [] })
    const hasMore = dataModel.find((d) => d.path === '/hasMore')!
    expect(hasMore.value).toBe(false)
  })

  it('carries the searchIssues descriptor (secret-free) for re-execution (FR-006/FR-008)', () => {
    const { descriptor } = buildBoundIssueListSurface('jira-default-view', 'project = PROJ', page)
    expect(descriptor.dataSource).toBe(JiraAdapterSource.SearchIssues)
    expect((descriptor.query as Record<string, unknown>).jql).toBe('project = PROJ')
    expect(JSON.stringify(descriptor)).not.toMatch(/Bearer|accessToken|refreshToken|token/i)
  })
})

describe('buildBoundIssueDetailSurface (FR-009/FR-013/FR-014/FR-020)', () => {
  it('binds EVERY display value to a sub-path of the single bound issue value', () => {
    const { spec } = buildBoundIssueDetailSurface('jira-issue-detail', detailBase)
    expect(spec.surfaceId).toBe('jira-issue-detail')
    const comps = spec.components as Component[]

    const card = find(comps, (c) => c.component === 'TicketCard')!
    expect(card.issue).toEqual({ path: JIRA_DETAIL_PATH })
    // panel-refresh-v1 (FR-006): refresh moved to the panel chrome — the detail card no
    // longer emits an in-card `refreshable`/`loading` RefreshButton.
    expect(card.refreshable).toBeUndefined()
    expect(card.loading).toBeUndefined()

    const body = byComponent(comps, 'Text').find((t) => isBinding(t.text))!
    expect(body.text).toEqual({ path: `${JIRA_DETAIL_PATH}/description` })

    const comments = find(comps, (c) => c.component === 'CommentList')!
    expect(comments.comments).toEqual({ path: `${JIRA_DETAIL_PATH}/comments` })

    const picker = find(comps, (c) => c.component === 'TransitionPicker')!
    expect(picker.issueKey).toEqual({ path: `${JIRA_DETAIL_PATH}/key` })
    expect(picker.availableTransitions).toEqual({ path: `${JIRA_DETAIL_PATH}/availableTransitions` })

    const addComment = find(comps, (c) => c.component === 'AddCommentControl')!
    expect(addComment.issueKey).toEqual({ path: `${JIRA_DETAIL_PATH}/key` })
  })

  it('seeds the whole issue at /issue + /loading=false (FR-003)', () => {
    const { dataModel } = buildBoundIssueDetailSurface('jira-issue-detail', detailBase)
    expect(dataModel).toEqual([
      { surfaceId: 'jira-issue-detail', path: JIRA_DETAIL_PATH, value: detailBase },
      { surfaceId: 'jira-issue-detail', path: '/loading', value: false }
    ])
  })

  it('carries the getIssue descriptor (secret-free) keyed on the issue (FR-006/FR-008)', () => {
    const { descriptor } = buildBoundIssueDetailSurface('jira-issue-detail', detailBase)
    expect(descriptor.dataSource).toBe(JiraAdapterSource.GetIssue)
    expect((descriptor.query as Record<string, unknown>).issueKey).toBe('PROJ-1')
  })

  it('carries no token/secret in the bound spec or descriptor (FR-017)', () => {
    const bound = buildBoundIssueDetailSurface('jira-issue-detail', detailBase)
    expect(JSON.stringify(bound)).not.toMatch(/Bearer|accessToken|refreshToken/)
  })

  // jira-dock-autoapply-weblink-v1 (FR-022): the non-secret browse `webUrl` rides the whole
  // bound issue value seeded at JIRA_DETAIL_PATH, so the header TicketCard (bound to the whole
  // issue) reads it and the link survives the post-write re-push (a fresh detail frame carries
  // the re-read DTO, including its `webUrl`).
  it('carries webUrl on the seeded bound issue value when present (FR-022)', () => {
    const withUrl: JiraIssueDetail = {
      ...detailBase,
      webUrl: 'https://acme.atlassian.net/browse/PROJ-1'
    }
    const { dataModel } = buildBoundIssueDetailSurface('jira-issue-detail', withUrl)
    const seed = dataModel.find((d) => d.path === JIRA_DETAIL_PATH)!
    expect((seed.value as JiraIssueDetail).webUrl).toBe('https://acme.atlassian.net/browse/PROJ-1')
  })

  it('omits webUrl from the seeded value when absent (degrade-to-omit — FR-011)', () => {
    const { dataModel } = buildBoundIssueDetailSurface('jira-issue-detail', detailBase)
    const seed = dataModel.find((d) => d.path === JIRA_DETAIL_PATH)!
    expect('webUrl' in (seed.value as object)).toBe(false)
  })

  it('uses only jira-catalog component types (incl. Column/Text passthroughs)', () => {
    const comps = buildBoundIssueDetailSurface('jira-issue-detail', detailBase).spec.components as Component[]
    for (const c of comps) {
      expect(JIRA_CATALOG_TYPES.has(c.component)).toBe(true)
    }
  })
})

describe('formatCommentTime', () => {
  it('formats a valid ISO timestamp and returns "" for absent/invalid input', () => {
    expect(formatCommentTime('2026-01-01T10:00:00.000Z')).not.toBe('')
    expect(formatCommentTime(undefined)).toBe('')
    expect(formatCommentTime('not-a-date')).toBe('')
  })
})
