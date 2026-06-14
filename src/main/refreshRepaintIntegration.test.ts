/**
 * refreshRepaintIntegration.test.ts — end-to-end PROOF of the
 * `refreshable-custom-generative-ui-v1` refresh → data-model → repaint chain.
 *
 * This is a NODE-env test (vitest `environment: 'node'`). It imports NO `.tsx`
 * component, requires no jsdom, and renders no React. It drives the REAL
 * production functions on BOTH halves of the chain so the claim "데이터를 새로
 * 땡겨서 다시 그림" (re-pull data and redraw) is demonstrated, not asserted:
 *
 *   Registration (main)  → planAgentSurfaceRegistration (descriptorRegistration.ts)
 *   Fetch (main, mock)   → AdapterDispatcher.refresh over the REAL jiraAdapterResolver
 *                          fed a FAKE JiraAdapterManager (canned rows per call)
 *   Push (main)          → captured via the dispatcher's injected pushDataModel
 *   Apply (renderer-pure)→ applyDataModel (dataModelApply.ts) + the SDK's own
 *                          setValueByPath (the same store mutation
 *                          SurfaceContext.updateDataModel performs)
 *   Resolve (renderer)   → the SDK's own resolveValue (exactly what useDataBinding /
 *                          useBound / IssueList call) against the applied model
 *
 * Nothing here re-implements apply, binding-resolution, or dispatch. The thin React
 * shells (useDataBinding reads getDataModel then calls resolveValue;
 * SurfaceContext.updateDataModel wraps setValueByPath) are the ONLY pieces replaced
 * with direct calls to the SAME pure functions. No production code is changed and no
 * new production seam is introduced (FR-011).
 *
 * Placement note: this test spans BOTH process halves — it drives main-side functions
 * (AdapterDispatcher, jiraAdapterResolver, planAgentSurfaceRegistration) AND the
 * renderer-pure `applyDataModel`. cosmos typechecks the two process trees as separate
 * composite TS projects (tsconfig.node.json = src/main|shared, tsconfig.web.json =
 * src/renderer|shared), each restricting its file list. The plan placed this under
 * src/renderer/, but a renderer-project file may not pull in src/main/* (TS6307). The
 * renderer-pure `applyDataModel` imports only a `src/shared` TYPE (no DOM/React), so it
 * typechecks cleanly inside the node project; this test therefore lives in src/main/
 * and imports `../renderer/dataModelApply`. (Deviation from the plan's path, recorded
 * in the plan's Deviations section — no production code changed.)
 */

import { describe, it, expect } from 'vitest'
import { setValueByPath, resolveValue } from '@a2ui-sdk/utils/0.9'
import type { FormBindableValue } from '@a2ui-sdk/types/0.9'

import { applyDataModel, type ProcessMessage } from '../renderer/dataModelApply'
import { AdapterDispatcher } from './adapterDispatcher'
import {
  jiraAdapterResolver,
  jiraIssueRow,
  jiraListBindOptions,
  JIRA_LIST_PATH,
  type JiraAdapterManager
} from './jiraAdapter'
import { planAgentSurfaceRegistration } from './descriptorRegistration'
import type { AdapterDescriptor } from '../shared/adapter'
import type { A2uiSurfaceUpdate, UiDataModelPayload } from '../shared/ipc'
import type {
  JiraIssueSummary,
  JiraPage,
  JiraResult,
  JiraIssueDetail
} from '../shared/jira'

/* ----------------------------------------------------------------------------- *
 * Fixtures: two DIFFERENT issue sets + a recoverable failure, controlled per call.
 * ----------------------------------------------------------------------------- */

const SURFACE_ID = 'agent-kanban-1'
const NEXT_CURSOR = 'cur2'

/** Refresh #1 rows (SET A). */
const setA: JiraIssueSummary[] = [
  { key: 'PROJ-1', summary: 'Wire the kanban', statusName: 'To Do', statusCategory: 'todo' },
  {
    key: 'PROJ-2',
    summary: 'Bind the list path',
    statusName: 'In Progress',
    statusCategory: 'in_progress',
    assignee: { accountId: 'acc-7', displayName: 'Ada' }
  }
]

/** Refresh #2 rows (CHANGED SET B — different keys/summaries/categories). */
const setB: JiraIssueSummary[] = [
  { key: 'PROJ-9', summary: 'Repaint on fresh data', statusName: 'Done', statusCategory: 'done' },
  { key: 'PROJ-10', summary: 'Prove the binding', statusName: 'To Do', statusCategory: 'todo' },
  {
    key: 'PROJ-11',
    summary: 'Third changed row',
    statusName: 'In Progress',
    statusCategory: 'in_progress',
    assignee: { accountId: 'acc-3', displayName: 'Grace' }
  }
]

/** Negative-control LITERAL rows (set L) — a static-builder shape, NOT from a fetch. */
const setL = [
  { issueKey: 'LIT-1', summary: 'Literal one', statusName: 'To Do', statusCategory: 'todo' },
  { issueKey: 'LIT-2', summary: 'Literal two', statusName: 'Done', statusCategory: 'done' }
]

/** A recoverable failure the fake manager returns on its 3rd `searchIssues` call. */
const FAILURE_MESSAGE = 'Could not refresh. Please retry.'
const failure: JiraResult<JiraPage<JiraIssueSummary>> = {
  ok: false,
  kind: 'network',
  message: FAILURE_MESSAGE
}

/** Wrap an issue set as a successful first page carrying a next cursor. */
function pageOf(items: JiraIssueSummary[]): JiraResult<JiraPage<JiraIssueSummary>> {
  return { ok: true, data: { items, nextCursor: NEXT_CURSOR } }
}

/**
 * A FAKE JiraAdapterManager: the tiny `{ searchIssues, getIssue }` interface the REAL
 * `jiraAdapterResolver` depends on (src/main/jiraAdapter.ts:77). Each `searchIssues`
 * call dequeues the next canned result; `getIssue` is unused here. No token, no
 * network, no JiraClient/JiraManager/OAuth — this is the whole point: the proven
 * chain cannot carry a secret because none exists (FR-003/FR-012).
 */
function makeFakeManager(
  queue: JiraResult<JiraPage<JiraIssueSummary>>[]
): JiraAdapterManager & { calls: number } {
  let calls = 0
  const remaining = [...queue]
  return {
    get calls() {
      return calls
    },
    async searchIssues() {
      calls += 1
      const next = remaining.shift()
      if (!next) {
        throw new Error('fake manager: searchIssues called more times than queued')
      }
      return next
    },
    async getIssue(): Promise<JiraResult<JiraIssueDetail>> {
      throw new Error('fake manager: getIssue should not be called in this test')
    }
  }
}

/* ----------------------------------------------------------------------------- *
 * The CUSTOM kanban agent spec: a Row of 3 Columns, each holding a catalog
 * `IssueList` bound `issues: { path: "/items" }` plus the reserved flag bindings.
 * All columns read the SAME list path (the documented `searchIssues` contract is
 * one path per dataSource). We keep the IssueList node objects retrievable so the
 * test resolves each node's `issues` source VERBATIM (not a reconstructed copy).
 * ----------------------------------------------------------------------------- */

interface IssueListProps {
  surfaceId: string
  componentId: string
  issues: unknown
  loading: unknown
  hasMore: unknown
  error: unknown
}

/** Build one column's bound IssueList props (the actual `{path}` bindings). */
function boundIssueListProps(componentId: string): IssueListProps {
  return {
    surfaceId: SURFACE_ID,
    componentId,
    issues: { path: JIRA_LIST_PATH }, // {path: "/items"} — the load-bearing binding
    loading: { path: '/loading' },
    hasMore: { path: '/hasMore' },
    error: { path: '/error' }
  }
}

/** The three bound IssueList nodes, one per kanban column. */
const issueListNodes: IssueListProps[] = [
  boundIssueListProps('col-todo-list'),
  boundIssueListProps('col-inprogress-list'),
  boundIssueListProps('col-done-list')
]

/** The full custom kanban surface spec (Row → Columns → IssueLists). */
const kanbanSpec: A2uiSurfaceUpdate = {
  surfaceId: SURFACE_ID,
  components: [
    {
      componentType: 'Row',
      id: 'kanban-row',
      properties: {
        children: issueListNodes.map((node, i) => ({
          componentType: 'Column',
          id: `kanban-col-${i}`,
          properties: {
            children: [{ componentType: 'IssueList', id: node.componentId, properties: node }]
          }
        }))
      }
    }
  ]
  // `components` is typed as the SDK's ComponentDefinition[]; the per-node shape above
  // is illustrative of the layout. The test asserts on the IssueList nodes' `issues`
  // source (issueListNodes[*].issues), taken verbatim, not on the layout rendering.
} as unknown as A2uiSurfaceUpdate

/** The secret-free descriptor: `dataSource` + `query` only (no token, ever). */
const descriptor: AdapterDescriptor = {
  dataSource: 'searchIssues',
  query: { jql: 'assignee = currentUser()' }
}

/* ----------------------------------------------------------------------------- *
 * Renderer-pure harness: a node `processMessage` that mutates a LOCAL data model
 * via the SDK's own immutable `setValueByPath` — byte-for-byte the same mutation
 * SurfaceContext.updateDataModel performs in the renderer. `applyAll` drives the
 * REAL applyDataModel for each captured push.
 * ----------------------------------------------------------------------------- */

function makeSurfaceModel(): {
  processMessage: ProcessMessage
  applyAll: (pushes: UiDataModelPayload[]) => Record<string, unknown>
  model: () => Record<string, unknown>
} {
  let model: Record<string, unknown> = {}
  // Mirrors SurfaceContext.updateDataModel: model = setValueByPath(model, path, value).
  const processMessage: ProcessMessage = (message) => {
    const { path, value } = message.updateDataModel
    model = setValueByPath(model, path ?? '/', value) as Record<string, unknown>
  }
  return {
    processMessage,
    applyAll(pushes) {
      for (const p of pushes) {
        applyDataModel(processMessage, SURFACE_ID, p)
      }
      return model
    },
    model: () => model
  }
}

/**
 * Resolve a component prop's binding the SAME way useBound/useDataBinding does.
 * The `as FormBindableValue` cast mirrors cosmos's `useBound` (controls.tsx), which
 * casts the catalog prop to the SDK's binding source type before resolving.
 */
function resolveBinding<T>(source: unknown, model: Record<string, unknown>): T {
  return resolveValue(source as FormBindableValue, model, null, undefined) as T
}

/* ----------------------------------------------------------------------------- *
 * Tests — each maps to a spec FR / SC.
 * ----------------------------------------------------------------------------- */

describe('refresh → data-model → repaint, end-to-end (refreshable-custom-generative-ui-v1)', () => {
  it('FR-001: planAgentSurfaceRegistration keys the AGENT surfaceId + pushes the agent spec (not a shell)', () => {
    const plan = planAgentSurfaceRegistration(descriptor, kanbanSpec)

    expect(plan.register).toBe(true)
    if (!plan.register) {
      throw new Error('expected a registerable plan for a searchIssues descriptor + usable spec')
    }
    // Registration keys the agent's OWN surfaceId, not a generic shell's.
    expect(plan.surfaceId).toBe(SURFACE_ID)
    // The bind options are the real searchIssues list options (listPath "/items", append).
    expect(plan.options).toEqual({ listPath: JIRA_LIST_PATH, pagination: 'append' })
    expect(plan.options).toBe(jiraListBindOptions)
    expect(JIRA_LIST_PATH).toBe('/items')
    // The spec main pushes is the agent's CUSTOM kanban spec, unchanged — not a shell.
    expect(plan.spec).toBe(kanbanSpec)
  })

  it('FR-004/FR-005/FR-006/FR-008: first refresh (SET A) emits updateDataModel at /items and the bound IssueList resolves SET A', async () => {
    const fakeManager = makeFakeManager([pageOf(setA)])
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: jiraAdapterResolver(fakeManager), // the REAL resolver over the fake manager
      pushDataModel: (p) => pushes.push(p)
    })
    dispatcher.register(SURFACE_ID, descriptor, jiraListBindOptions)

    await dispatcher.refresh(SURFACE_ID)

    // FR-004: an updateDataModel { surfaceId, path: "/items", value } was emitted, keyed
    // by the agent's surfaceId, carrying the mock's fresh rows = setA.map(jiraIssueRow).
    const expectedRowsA = setA.map(jiraIssueRow)
    const itemsPush = pushes.find((p) => p.path === JIRA_LIST_PATH)
    expect(itemsPush).toBeDefined()
    expect(itemsPush?.surfaceId).toBe(SURFACE_ID)
    expect(itemsPush?.value).toEqual(expectedRowsA)

    // FR-005 + FR-006: apply ALL pushes through the REAL applyDataModel + SDK store, then
    // resolve the IssueList's actual `issues` binding via the REAL resolveValue → SET A.
    const surface = makeSurfaceModel()
    const model = surface.applyAll(pushes)
    for (const node of issueListNodes) {
      expect(resolveBinding(node.issues, model)).toEqual(expectedRowsA)
    }

    // FR-008 (success flags): /loading ends false, /hasMore true (cursor present), /error undefined.
    expect(resolveBinding(issueListNodes[0].loading, model)).toBe(false)
    expect(resolveBinding(issueListNodes[0].hasMore, model)).toBe(true)
    expect(resolveBinding(issueListNodes[0].error, model)).toBeUndefined()
  })

  it('FR-007: a SECOND refresh (changed SET B) repaints — the bound IssueList resolves SET B, not SET A', async () => {
    const fakeManager = makeFakeManager([pageOf(setA), pageOf(setB)])
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: jiraAdapterResolver(fakeManager),
      pushDataModel: (p) => pushes.push(p)
    })
    dispatcher.register(SURFACE_ID, descriptor, jiraListBindOptions)
    const surface = makeSurfaceModel()

    // Refresh #1 → SET A established on the surface.
    await dispatcher.refresh(SURFACE_ID)
    const rowsA = setA.map(jiraIssueRow)
    let model = surface.applyAll(pushes)
    expect(resolveBinding(issueListNodes[0].issues, model)).toEqual(rowsA)

    // Refresh #2 → CHANGED SET B. Capture only the new pushes, re-apply, re-resolve.
    pushes.length = 0
    await dispatcher.refresh(SURFACE_ID)
    const rowsB = setB.map(jiraIssueRow)

    // The /items push carries SET B.
    const itemsPush = pushes.find((p) => p.path === JIRA_LIST_PATH)
    expect(itemsPush?.value).toEqual(rowsB)

    // The repaint proof: the SAME `{path:"/items"}` binding now resolves SET B, not SET A.
    model = surface.applyAll(pushes)
    for (const node of issueListNodes) {
      const resolved = resolveBinding(node.issues, model)
      expect(resolved).toEqual(rowsB)
      expect(resolved).not.toEqual(rowsA)
    }

    expect(fakeManager.calls).toBe(2)
  })

  it('FR-008: a recoverable failure surfaces /error, clears /loading, and keeps prior /items rows intact (no wipe)', async () => {
    // Queue: success (SET A) then a recoverable network failure.
    const fakeManager = makeFakeManager([pageOf(setA), failure])
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: jiraAdapterResolver(fakeManager),
      pushDataModel: (p) => pushes.push(p)
    })
    dispatcher.register(SURFACE_ID, descriptor, jiraListBindOptions)
    const surface = makeSurfaceModel()

    // First refresh succeeds → SET A is on the surface, no error.
    await dispatcher.refresh(SURFACE_ID)
    const rowsA = setA.map(jiraIssueRow)
    let model = surface.applyAll(pushes)
    expect(resolveBinding(issueListNodes[0].issues, model)).toEqual(rowsA)

    // Second refresh fails recoverably.
    pushes.length = 0
    await dispatcher.refresh(SURFACE_ID)

    // The dispatcher does NOT write /items on a failure (prior data untouched).
    expect(pushes.find((p) => p.path === JIRA_LIST_PATH)).toBeUndefined()

    model = surface.applyAll(pushes)
    // /error resolves to the failure message; /loading ends false.
    expect(resolveBinding(issueListNodes[0].error, model)).toBe(FAILURE_MESSAGE)
    expect(resolveBinding(issueListNodes[0].loading, model)).toBe(false)
    // Prior /items rows are STILL resolvable (no wipe on a recoverable error).
    expect(resolveBinding(issueListNodes[0].issues, model)).toEqual(rowsA)
  })

  it('FR-009 (negative control): a LITERAL-prop IssueList does NOT repaint when the data model changes', () => {
    // An IssueList whose `issues` is a LITERAL array (no {path}) — a static-builder shape.
    const literalIssuesSource = setL

    const surface = makeSurfaceModel()
    // Apply an updateDataModel at /items (SET B) — exactly what a refresh would push.
    const model = surface.applyAll([
      { surfaceId: SURFACE_ID, path: JIRA_LIST_PATH, value: setB.map(jiraIssueRow) }
    ])

    // The data-model change moved /items, but the literal prop passes through unchanged:
    // resolveValue on a literal returns the literal — so a literal-prop surface CANNOT
    // repaint from a data-model update. The {path} binding is what makes refresh work.
    expect(resolveBinding(literalIssuesSource, model)).toEqual(setL)
    // Sanity: the bound source against the same model WOULD have moved to SET B.
    expect(resolveBinding({ path: JIRA_LIST_PATH }, model)).toEqual(setB.map(jiraIssueRow))
  })

  it('FR-012: no token/secret appears in any captured push payload or in the descriptor', async () => {
    const fakeManager = makeFakeManager([pageOf(setA)])
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: jiraAdapterResolver(fakeManager),
      pushDataModel: (p) => pushes.push(p)
    })
    dispatcher.register(SURFACE_ID, descriptor, jiraListBindOptions)
    await dispatcher.refresh(SURFACE_ID)

    const secretLike = /authorization|token|accessToken|client_secret|bearer/i
    for (const p of pushes) {
      expect(JSON.stringify(p)).not.toMatch(secretLike)
    }
    // The descriptor carries ONLY dataSource + query — never a secret field.
    expect(Object.keys(descriptor).sort()).toEqual(['dataSource', 'query'])
    expect(JSON.stringify(descriptor)).not.toMatch(secretLike)
  })
})
