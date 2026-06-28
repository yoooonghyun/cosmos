/**
 * jiraSurfaceBuilder — pure Jira → A2UI 0.9 JIRA-CUSTOM-catalog surface composition
 * (Jira generative-UI v2). The SINGLE composer for the default view, the initial
 * detail render, and the post-write update (FR-007).
 *
 * v2 change (vs v1): this builder now emits the Jira CUSTOM catalog (`catalogId:'jira'`)
 * component TYPE NAMES — `IssueList`/`TicketCard`/`StatusBadge`/`TransitionPicker`/
 * `CommentList`/`CommentRow`/`AddCommentControl`/`Notice` — NOT the standard catalog.
 * The display components carry their data as STATIC props (the `src/shared/jira.ts`
 * shapes); the two input components (TransitionPicker, AddCommentControl) own their
 * data-model binding + action internally, so the builder passes only their identifier
 * props (`issueKey`, `availableTransitions`). Status color comes back via the custom
 * catalog (the v2 win) — the builder no longer maps status to glyphs.
 *
 * Pure mapping: NO Jira API calls, no IPC, no secrets. Carries only non-secret
 * content/identifiers (issueKey, transitionId via the component, body) — never a
 * token (FR-015/FR-017).
 */

import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../shared/ipc'
import type {
  JiraComment,
  JiraIssueDetail,
  JiraIssueSummary,
  JiraPage
} from '../shared/types/jira'
import {
  JiraAdapterSource,
  jiraSearchDescriptor,
  jiraGetIssueDescriptor,
  type JiraAdapterDescriptor
} from '../shared/types/jira'
import { JIRA_DETAIL_PATH, JIRA_LIST_PATH, jiraIssueRow } from './jiraAdapter'

/** An A2UI 0.9 component definition: an id + a `component` discriminator + props. */
type Component = { id: string; component: string } & Record<string, unknown>

/** Surface ids — stable per surface kind (requestId, minted in main, is freshness). */
const SURFACE_ISSUE_LIST = 'jira-issue-list'
/** The issue-detail surfaceId (exported so main registers the bound surface under it). */
export const SURFACE_ISSUE_DETAIL = 'jira-issue-detail'
/** The default-view / JQL-search list surfaceId (exported for bound registration). */
export const SURFACE_DEFAULT_VIEW = 'jira-default-view'
const SURFACE_CREATE_ISSUE = 'jira-create-issue'
const SURFACE_EDIT_ISSUE = 'jira-edit-issue'

/**
 * A post-write notice prepended to the detail surface (FR-007, design §9.5). v2
 * renders it COLORED via the catalog's `Notice` component; the builder just carries
 * the kind + non-secret message.
 */
export interface JiraSurfaceNotice {
  kind: 'success' | 'error' | 'write_not_authorized'
  message: string
}

/** Options for {@link buildIssueDetailSurface}. */
export interface JiraIssueDetailSurfaceOpts {
  /** Prepended success/error/scope-gap notice for the post-write re-push (FR-007). */
  notice?: JiraSurfaceNotice
}

/**
 * Short, locale-aware time from an ISO-8601 timestamp. Best-effort: returns '' for
 * an absent/unparseable value. (Retained for callers/tests; the catalog's CommentRow
 * formats time itself via `atlassianPanelBits.formatTs`.)
 */
export function formatCommentTime(iso: string | undefined): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** A deterministic per-invocation id minter (containers reference children by id). */
function makeIds(): (hint: string) => string {
  let n = 0
  return (hint) => `${hint}-${n++}`
}

/** Map one issue summary to the static prop object an `IssueList` item / `TicketCard` wants. */
function ticketCardProps(issue: JiraIssueSummary): Record<string, unknown> {
  return {
    issueKey: issue.key,
    summary: issue.summary,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    ...(issue.assignee ? { assignee: issue.assignee } : {})
  }
}

/* ------------------------------------------------------------------------- *
 * Surface — issue list (utterance-composed) (design §5)
 * ------------------------------------------------------------------------- */

/**
 * Compose an issue-list surface from a search page (FR-006). A single `IssueList`
 * root carrying the page's issues as static props; the catalog component renders the
 * count header + TicketCards (and its own empty state for a 0-item page).
 */
export function buildIssueListSurface(
  page: JiraPage<JiraIssueSummary>
): A2uiSurfaceUpdate {
  return issueListSurface(SURFACE_ISSUE_LIST, page)
}

/**
 * Compose the per-switch DEFAULT VIEW surface from the bounded recent-issues page
 * (Jira generative-UI v2, D4 / FR-019). Same `IssueList` shape as
 * {@link buildIssueListSurface} but a distinct surfaceId so the default view is
 * identifiable. The catalog's `IssueList` renders the "No issues found." empty state.
 */
export function buildDefaultViewSurface(
  page: JiraPage<JiraIssueSummary>
): A2uiSurfaceUpdate {
  return issueListSurface(SURFACE_DEFAULT_VIEW, page)
}

/**
 * Compose a single-`Notice` surface (Jira generative-UI v2). Used by the per-switch
 * default-view handler to render a calm, recoverable error INSIDE the Jira A2UI host
 * when the bounded recent-issues read fails with a non-`reconnect_needed` kind (a
 * `reconnect_needed` routes to the native Connect/Reconnect via `statusChanged`, D4).
 * The `Notice` component colors the error (design §9.5). No crash, no token (FR-017).
 */
export function buildNoticeSurface(notice: JiraSurfaceNotice): A2uiSurfaceUpdate {
  return {
    surfaceId: SURFACE_DEFAULT_VIEW,
    components: [
      {
        id: 'root',
        component: 'Notice',
        noticeKind: notice.kind,
        message: notice.message
      }
    ]
  }
}

/** Shared: one `IssueList` root carrying the page items as static props. */
function issueListSurface(
  surfaceId: string,
  page: JiraPage<JiraIssueSummary>
): A2uiSurfaceUpdate {
  const id = makeIds()
  const root = id('root')
  const components: Component[] = [
    {
      id: root,
      component: 'IssueList',
      issues: page.items.map(ticketCardProps)
    }
  ]
  return { surfaceId, components }
}

/* ------------------------------------------------------------------------- *
 * BOUND surfaces (jira-generative-adapter-v1) — live, refreshable, paginated
 *
 * A bound surface carries `{path}` bindings instead of literal data props, plus an
 * INITIAL data-model seed (the first page + flags) and a SECRET-FREE descriptor for
 * re-execution. The catalog `IssueList`/`TicketCard` read the bound list + flags;
 * the AdapterDispatcher pushes fresh `updateDataModel` on refresh / load-more.
 * ------------------------------------------------------------------------- */

/** A composed BOUND surface: the view spec + its initial data model + its descriptor. */
export interface JiraBoundSurface {
  /** The `{path}`-bound A2UI surface spec (data-free; rows/flags read the data model). */
  spec: A2uiSurfaceUpdate
  /** The initial data-model seed (first page + `/loading`/`/hasMore`) — FR-001/FR-003. */
  dataModel: UiDataModelPayload[]
  /** The secret-free descriptor for re-execution (refresh / pagination) — FR-006/FR-008. */
  descriptor: JiraAdapterDescriptor
}

/**
 * Compose a BOUND issue-list surface for the DEFAULT view / JQL search (FR-004/FR-008).
 * The `IssueList` root reads its rows from the bound list path + the `loading`/`hasMore`
 * flags (it renders its own load-more footer, design §5.1). The initial data model seeds
 * the first page; the descriptor (`searchIssues` + the composed JQL) drives refresh +
 * load-more. `surfaceId` distinguishes the default view from a JQL search.
 */
export function buildBoundIssueListSurface(
  surfaceId: string,
  jql: string,
  page: JiraPage<JiraIssueSummary>
): JiraBoundSurface {
  const id = makeIds()
  const root = id('root')
  const spec: A2uiSurfaceUpdate = {
    surfaceId,
    components: [
      {
        id: root,
        component: 'IssueList',
        // FR-001: rows + flags are BOUND (data-free spec). The catalog component reads
        // these paths via `useDataBinding`; the dispatcher updates them in place.
        issues: { path: JIRA_LIST_PATH },
        loading: { path: '/loading' },
        hasMore: { path: '/hasMore' }
      }
    ]
  }
  return {
    spec,
    dataModel: listSeed(surfaceId, page),
    descriptor: jiraSearchDescriptor(jql, undefined)
  }
}

/**
 * panel-refresh-v1 (OQ-5 = main-composes): build the DATA-FREE bound SHELL surface for a
 * Jira `dataSource`, so main can push a `{path}`-bound surface (instead of the agent's
 * literal-prop spec) and let the AdapterDispatcher's first `refresh` paint it in place.
 * `searchIssues` → the bound IssueList; `getIssue` → the bound detail tree. Returns `null`
 * for a non-Jira source. The surfaceId is stable per source.
 */
export function buildJiraBoundShell(dataSource: string): A2uiSurfaceUpdate | null {
  if (dataSource === JiraAdapterSource.SearchIssues) {
    return {
      surfaceId: SURFACE_DEFAULT_VIEW,
      components: [
        {
          id: 'root',
          component: 'IssueList',
          issues: { path: JIRA_LIST_PATH },
          loading: { path: '/loading' },
          hasMore: { path: '/hasMore' }
        }
      ]
    }
  }
  if (dataSource === JiraAdapterSource.GetIssue) {
    return boundIssueDetailShellSpec(SURFACE_ISSUE_DETAIL)
  }
  return null
}

/** The data-free bound issue-DETAIL tree (mirrors `buildBoundIssueDetailSurface`'s spec). */
function boundIssueDetailShellSpec(surfaceId: string): A2uiSurfaceUpdate {
  const id = makeIds()
  const components: Component[] = []
  const rootChildren: string[] = []

  const header = id('ticket')
  components.push({
    id: header,
    component: 'TicketCard',
    issue: { path: JIRA_DETAIL_PATH }
  })
  rootChildren.push(header)

  const descLabel = id('desc-label')
  components.push({ id: descLabel, component: 'Text', variant: 'label', text: 'Description' })
  const descBody = id('desc-body')
  components.push({
    id: descBody,
    component: 'Text',
    variant: 'body',
    text: { path: `${JIRA_DETAIL_PATH}/description` }
  })
  rootChildren.push(descLabel, descBody)

  const comments = id('comments')
  components.push({
    id: comments,
    component: 'CommentList',
    comments: { path: `${JIRA_DETAIL_PATH}/comments` }
  })
  rootChildren.push(comments)

  const transition = id('transition')
  components.push({
    id: transition,
    component: 'TransitionPicker',
    issueKey: { path: `${JIRA_DETAIL_PATH}/key` },
    availableTransitions: { path: `${JIRA_DETAIL_PATH}/availableTransitions` }
  })
  rootChildren.push(transition)

  const addComment = id('add-comment')
  components.push({
    id: addComment,
    component: 'AddCommentControl',
    issueKey: { path: `${JIRA_DETAIL_PATH}/key` }
  })
  rootChildren.push(addComment)

  const root = id('root')
  components.push({ id: root, component: 'Column', children: rootChildren })
  return { surfaceId, components }
}

/** The initial data-model seed for a bound list surface (first page + flags). */
function listSeed(surfaceId: string, page: JiraPage<JiraIssueSummary>): UiDataModelPayload[] {
  return [
    { surfaceId, path: JIRA_LIST_PATH, value: page.items.map(jiraIssueRow) },
    { surfaceId, path: '/loading', value: false },
    { surfaceId, path: '/hasMore', value: page.nextCursor !== undefined }
  ]
}

/**
 * Compose a BOUND issue-DETAIL surface (FR-004/FR-008/FR-020). The detail has NO
 * pagination ('none') but is refreshable (FR-013): EVERY display component binds to a
 * sub-path of the single bound issue value at {@link JIRA_DETAIL_PATH} (`/issue`), so a
 * refresh / post-write `updateDataModel` of `/issue` re-renders the whole detail in
 * place — no view re-compose (FR-009/FR-014). Child order follows the static detail
 * (header card → description → comments → transition → add-comment). Manual refresh is now
 * a panel-chrome control (panel-refresh-v1, FR-006), not an in-card button. The
 * transition + add-comment controls read `issueKey`/`availableTransitions` from the
 * bound issue and still own their OWN input binding + emit the `jira.*` write actions
 * (writes unchanged — SC-008). Seed = the issue + `/loading=false`; descriptor =
 * `getIssue` + issueKey.
 */
export function buildBoundIssueDetailSurface(
  surfaceId: string,
  detail: JiraIssueDetail
): JiraBoundSurface {
  const id = makeIds()
  const components: Component[] = []
  const rootChildren: string[] = []

  // Header: the issue as a TicketCard (reads the whole bound issue value). Refresh is now
  // a panel-chrome control (panel-refresh-v1, FR-006) — no in-card RefreshButton.
  // jira-dock-autoapply-weblink-v1 (FR-010/FR-022): the non-secret browse `webUrl` rides this
  // same whole-issue value seeded at JIRA_DETAIL_PATH (no extra data-model entry), so TicketCard
  // reads `boundIssue.webUrl` and the link survives the post-write re-push (the re-read DTO
  // carries `webUrl`). The list/board builder never binds `webUrl` → dock-only (FR-012/FR-020).
  const header = id('ticket')
  components.push({
    id: header,
    component: 'TicketCard',
    issue: { path: JIRA_DETAIL_PATH }
  })
  rootChildren.push(header)

  // Description (label + body) — the body binds to the bound issue's description.
  const descLabel = id('desc-label')
  components.push({ id: descLabel, component: 'Text', variant: 'label', text: 'Description' })
  const descBody = id('desc-body')
  components.push({
    id: descBody,
    component: 'Text',
    variant: 'body',
    text: { path: `${JIRA_DETAIL_PATH}/description` }
  })
  rootChildren.push(descLabel, descBody)

  // Comments — bound to the issue's comments array.
  const comments = id('comments')
  components.push({
    id: comments,
    component: 'CommentList',
    comments: { path: `${JIRA_DETAIL_PATH}/comments` }
  })
  rootChildren.push(comments)

  // Transition control (reads issueKey + transitions from the bound issue; emits jira.transition).
  const transition = id('transition')
  components.push({
    id: transition,
    component: 'TransitionPicker',
    issueKey: { path: `${JIRA_DETAIL_PATH}/key` },
    availableTransitions: { path: `${JIRA_DETAIL_PATH}/availableTransitions` }
  })
  rootChildren.push(transition)

  // Add-comment control (reads issueKey from the bound issue; emits jira.comment).
  const addComment = id('add-comment')
  components.push({
    id: addComment,
    component: 'AddCommentControl',
    issueKey: { path: `${JIRA_DETAIL_PATH}/key` }
  })
  rootChildren.push(addComment)

  const root = id('root')
  components.push({ id: root, component: 'Column', children: rootChildren })

  return {
    spec: { surfaceId, components },
    dataModel: [
      { surfaceId, path: JIRA_DETAIL_PATH, value: detail },
      { surfaceId, path: '/loading', value: false }
    ],
    descriptor: jiraGetIssueDescriptor(detail.key)
  }
}

/* ------------------------------------------------------------------------- *
 * Surface — ticket detail (+ optional post-write notice) (design §9.4/§9.5)
 * ------------------------------------------------------------------------- */

/**
 * Compose a ticket-detail surface from an issue (FR-006). The SAME builder serves the
 * initial render and the post-write re-push: pass `opts.notice` to prepend the
 * colored `Notice` (success/error/scope-gap, FR-007). Child order follows design §9.4
 * (header card → description → transition → comments → add-comment). The transition +
 * comment controls own their binding + emit the `jira.*` bound actions themselves.
 */
export function buildIssueDetailSurface(
  detail: JiraIssueDetail,
  opts?: JiraIssueDetailSurfaceOpts
): A2uiSurfaceUpdate {
  const id = makeIds()
  const components: Component[] = []
  const rootChildren: string[] = []

  // §9.5: a colored post-write notice as the FIRST child (re-push only).
  if (opts?.notice) {
    const notice = id('notice')
    components.push({
      id: notice,
      component: 'Notice',
      noticeKind: opts.notice.kind,
      message: opts.notice.message
    })
    rootChildren.push(notice)
  }

  // Header: the issue as a TicketCard (key + StatusBadge + summary + assignee).
  const header = id('ticket')
  components.push({
    id: header,
    component: 'TicketCard',
    issueKey: detail.key,
    summary: detail.summary,
    statusName: detail.statusName,
    statusCategory: detail.statusCategory,
    ...(detail.assignee ? { assignee: detail.assignee } : {})
  })
  rootChildren.push(header)

  // Description section (design §9.4) — a muted label + body via the generic Text
  // passthrough the Jira catalog includes (design §1.1 permits Column/Text). Empty
  // description degrades to a muted placeholder so the section never reads broken.
  const descLabel = id('desc-label')
  components.push({ id: descLabel, component: 'Text', variant: 'label', text: 'Description' })
  const descBody = id('desc-body')
  components.push({
    id: descBody,
    component: 'Text',
    variant: 'body',
    muted: detail.description.trim().length === 0,
    text: detail.description.trim().length > 0 ? detail.description : 'No description.'
  })
  rootChildren.push(descLabel, descBody)

  // Comments section.
  const comments = id('comments')
  components.push({
    id: comments,
    component: 'CommentList',
    comments: detail.comments as JiraComment[]
  })
  rootChildren.push(comments)

  // Transition control (owns /transitionId + emits jira.transition).
  const transition = id('transition')
  components.push({
    id: transition,
    component: 'TransitionPicker',
    issueKey: detail.key,
    availableTransitions: detail.availableTransitions
  })
  rootChildren.push(transition)

  // Add-comment control (owns /commentBody + emits jira.comment).
  const addComment = id('add-comment')
  components.push({
    id: addComment,
    component: 'AddCommentControl',
    issueKey: detail.key
  })
  rootChildren.push(addComment)

  const root = id('root')
  components.push({ id: root, component: 'Column', children: rootChildren })
  return { surfaceId: SURFACE_ISSUE_DETAIL, components }
}

/* ------------------------------------------------------------------------- *
 * Surface — create-issue form (Jira write-extend v1, FR-018, design §3/§6)
 * ------------------------------------------------------------------------- */

/** Options for {@link buildCreateIssueSurface}. */
export interface JiraCreateSurfaceOpts {
  /** Prepended notice for a failed-create re-push (error / scope-gap) (design §5). */
  notice?: JiraSurfaceNotice
  /** Seed the projectKey field (an agent-supplied default, or the prior value on re-push). */
  defaultProjectKey?: string
  /** Optional issue-type names → render the type field as a Select (design §2 note A). */
  issueTypes?: string[]
  /** Optional project keys → render the project field as a Select (design §2 note A). */
  projectKeys?: string[]
  /** Re-seed the form's entered values on a failed re-push so it never re-appears blank (design §5). */
  seed?: { projectKey?: string; issueType?: string; summary?: string; description?: string; parentKey?: string }
}

/**
 * Compose the CREATE-issue form surface (Jira write-extend v1, FR-018). A single
 * `CreateIssueForm` root carrying its optional builder props; the component owns its
 * form binding (`/createProjectKey` etc.) + emits `jira.create` (design §3). On a
 * failed create the dispatcher re-pushes this with `opts.notice` + `opts.seed` so the
 * form re-appears pre-filled with the error (design §5). The `Notice` (when present)
 * is the FIRST child of the root Column, the form Card next (design §6).
 */
export function buildCreateIssueSurface(opts?: JiraCreateSurfaceOpts): A2uiSurfaceUpdate {
  const id = makeIds()
  const components: Component[] = []
  const rootChildren: string[] = []

  if (opts?.notice) {
    const notice = id('notice')
    components.push({
      id: notice,
      component: 'Notice',
      noticeKind: opts.notice.kind,
      message: opts.notice.message
    })
    rootChildren.push(notice)
  }

  const form = id('create-form')
  const seed = opts?.seed
  components.push({
    id: form,
    component: 'CreateIssueForm',
    ...(opts?.defaultProjectKey ? { defaultProjectKey: opts.defaultProjectKey } : {}),
    ...(Array.isArray(opts?.issueTypes) && opts.issueTypes.length > 0
      ? { issueTypes: opts.issueTypes }
      : {}),
    ...(Array.isArray(opts?.projectKeys) && opts.projectKeys.length > 0
      ? { projectKeys: opts.projectKeys }
      : {}),
    ...(seed?.projectKey ? { seededProjectKey: seed.projectKey } : {}),
    ...(seed?.issueType ? { seededIssueType: seed.issueType } : {}),
    ...(seed?.summary ? { seededSummary: seed.summary } : {}),
    ...(seed?.description ? { seededDescription: seed.description } : {}),
    // jira-create-parent-v1 (FR-007): re-seed the optional Parent field on a failed-create
    // re-push so it never re-appears blank, mirroring the other seeded fields.
    ...(seed?.parentKey ? { seededParentKey: seed.parentKey } : {})
  })
  rootChildren.push(form)

  const root = id('root')
  components.push({ id: root, component: 'Column', children: rootChildren })
  return { surfaceId: SURFACE_CREATE_ISSUE, components }
}

/* ------------------------------------------------------------------------- *
 * Surface — edit-issue form (Jira write-extend v1, FR-018, design §4/§6)
 * ------------------------------------------------------------------------- */

/** Options for {@link buildEditIssueSurface}. */
export interface JiraEditSurfaceOpts {
  /** Prepended notice for a failed-update re-push (error / scope-gap) (design §5). */
  notice?: JiraSurfaceNotice
}

/**
 * Compose the EDIT-issue form surface seeded from the issue's current fields (Jira
 * write-extend v1, FR-018). A single `EditIssueForm` root carrying `issueKey` +
 * seeded `summary`/`description` (design §4); the component diffs against the seed
 * and emits `jira.update` with only changed fields (OQ2). Assignee is OMITTED from
 * the v1 form (design §2 note B) — the seeded assignee is carried for display only.
 * On a failed update the dispatcher re-pushes this with `opts.notice` (design §5).
 */
export function buildEditIssueSurface(
  detail: JiraIssueDetail,
  opts?: JiraEditSurfaceOpts
): A2uiSurfaceUpdate {
  const id = makeIds()
  const components: Component[] = []
  const rootChildren: string[] = []

  if (opts?.notice) {
    const notice = id('notice')
    components.push({
      id: notice,
      component: 'Notice',
      noticeKind: opts.notice.kind,
      message: opts.notice.message
    })
    rootChildren.push(notice)
  }

  const form = id('edit-form')
  components.push({
    id: form,
    component: 'EditIssueForm',
    issueKey: detail.key,
    seededSummary: detail.summary,
    seededDescription: detail.description,
    ...(detail.assignee ? { assignee: detail.assignee } : {})
  })
  rootChildren.push(form)

  const root = id('root')
  components.push({ id: root, component: 'Column', children: rootChildren })
  return { surfaceId: SURFACE_EDIT_ISSUE, components }
}
