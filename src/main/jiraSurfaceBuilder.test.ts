import { describe, it, expect } from 'vitest'
import {
  buildCreateIssueSurface,
  buildDefaultViewSurface,
  buildEditIssueSurface,
  buildIssueDetailSurface,
  buildIssueListSurface,
  buildNoticeSurface,
  formatCommentTime
} from './jiraSurfaceBuilder'
import type { JiraIssueDetail, JiraIssueSummary, JiraPage } from '../shared/jira'

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

describe('formatCommentTime', () => {
  it('formats a valid ISO timestamp and returns "" for absent/invalid input', () => {
    expect(formatCommentTime('2026-01-01T10:00:00.000Z')).not.toBe('')
    expect(formatCommentTime(undefined)).toBe('')
    expect(formatCommentTime('not-a-date')).toBe('')
  })
})
