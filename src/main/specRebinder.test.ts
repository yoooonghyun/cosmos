import { describe, it, expect, vi } from 'vitest'
import { rebindAgentSurface, planRegions } from './specRebinder'
import type { A2uiSurfaceUpdate } from '../shared/ipc'
import type { AdapterBinding } from '../shared/types/adapter'

/* refreshable-custom-generative-ui multi-region — main rebinds an agent's LITERAL-prop custom
 * surface into a `{path}`-bound, refreshable one. The kanban case the user hit: the model emits
 * two IssueList columns with literal `issues:[...]` arrays (NO `{path}` bindings) plus a
 * `bindings` side-channel naming each column's narrowed JQL; main must rewrite each column to its
 * OWN region-scoped paths so each refreshes independently and CSMS-6 moves columns on refresh. */

const SURFACE = 'agent-kanban'

/** A realistic literal 2-column kanban: each IssueList carries a literal `issues` array, no path. */
function kanbanSpec(): A2uiSurfaceUpdate {
  return {
    surfaceId: SURFACE,
    components: [
      { id: 'root', component: 'Row' },
      {
        id: 'todo',
        component: 'IssueList',
        issues: [{ key: 'CSMS-6', summary: 'Move me' }]
      },
      {
        id: 'review',
        component: 'IssueList',
        issues: []
      }
    ]
  } as unknown as A2uiSurfaceUpdate
}

const todoBinding: AdapterBinding = {
  componentId: 'todo',
  descriptor: { dataSource: 'searchIssues', query: { jql: 'status = "To Do"' } }
}
const reviewBinding: AdapterBinding = {
  componentId: 'review',
  descriptor: { dataSource: 'searchIssues', query: { jql: 'status = "In Review"' } }
}

function componentById(spec: A2uiSurfaceUpdate, id: string): Record<string, unknown> {
  const components = (spec as unknown as { components: Array<{ id: string } & Record<string, unknown>> })
    .components
  const found = components.find((c) => c.id === id)
  if (!found) {
    throw new Error(`no component ${id}`)
  }
  return found
}

describe('rebindAgentSurface — multi-region kanban (구분된 컴포넌트 별 별도 fetcher)', () => {
  it('rewrites EACH literal column to its OWN region-scoped {path} bindings + stamps region', () => {
    const result = rebindAgentSurface(kanbanSpec(), [todoBinding, reviewBinding], vi.fn())
    expect(result).not.toBeNull()
    const todo = componentById(result!.spec, 'todo')
    expect(todo.issues).toEqual({ path: '/regions/todo/items' })
    expect(todo.loading).toEqual({ path: '/regions/todo/loading' })
    expect(todo.hasMore).toEqual({ path: '/regions/todo/hasMore' })
    expect(todo.error).toEqual({ path: '/regions/todo/error' })
    // Multi-region: the container is stamped with its region so its in-surface controls
    // (LoadMoreButton) emit adapter.* carrying that region → main reloads only this column.
    expect(todo.region).toBe('todo')

    const review = componentById(result!.spec, 'review')
    expect(review.issues).toEqual({ path: '/regions/review/items' })
    expect(review.region).toBe('review')
  })

  it('seeds each region with the literal rows the agent composed (instant paint before refresh)', () => {
    const result = rebindAgentSurface(kanbanSpec(), [todoBinding, reviewBinding], vi.fn())
    const seed = (path: string): unknown =>
      result!.dataModel.find((p) => p.path === path)?.value
    expect(seed('/regions/todo/items')).toEqual([{ key: 'CSMS-6', summary: 'Move me' }])
    expect(seed('/regions/review/items')).toEqual([])
    // Flags seed to false so controls start idle/exhausted until the first fetch.
    expect(seed('/regions/todo/loading')).toBe(false)
    expect(seed('/regions/todo/hasMore')).toBe(false)
  })

  it('returns one region per bound container, keyed by componentId, with searchIssues options', () => {
    const result = rebindAgentSurface(kanbanSpec(), [todoBinding, reviewBinding], vi.fn())
    expect(result!.regions.map((r) => r.regionKey)).toEqual(['todo', 'review'])
    expect(result!.regions[0]).toMatchObject({
      regionKey: 'todo',
      componentId: 'todo',
      dataProp: 'issues',
      descriptor: todoBinding.descriptor,
      options: { listPath: '/items', pagination: 'append' }
    })
  })

  it('every seed + spec push is keyed to the agent surfaceId (no leak)', () => {
    const result = rebindAgentSurface(kanbanSpec(), [todoBinding, reviewBinding], vi.fn())
    expect(result!.spec.surfaceId).toBe(SURFACE)
    expect(result!.dataModel.every((p) => p.surfaceId === SURFACE)).toBe(true)
  })
})

describe('rebindAgentSurface — single-region surface (degenerate, back-compat)', () => {
  function singleSpec(): A2uiSurfaceUpdate {
    return {
      surfaceId: SURFACE,
      components: [
        { id: 'list', component: 'IssueList', issues: [{ key: 'A' }] }
      ]
    } as unknown as A2uiSurfaceUpdate
  }

  it('uses the FLAT top-level paths + does NOT stamp a region (one binding → empty key)', () => {
    const binding: AdapterBinding = {
      componentId: 'list',
      descriptor: { dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()' } }
    }
    const result = rebindAgentSurface(singleSpec(), [binding], vi.fn())
    const list = componentById(result!.spec, 'list')
    expect(list.issues).toEqual({ path: '/items' })
    expect(list.loading).toEqual({ path: '/loading' })
    expect('region' in list).toBe(false)
    expect(result!.regions[0].regionKey).toBe('')
  })
})

describe('rebindAgentSurface — edge cases', () => {
  it('returns null when no binding names a rebindable list source (caller falls back)', () => {
    const warn = vi.fn()
    const result = rebindAgentSurface(kanbanSpec(), [
      { componentId: 'todo', descriptor: { dataSource: 'getIssue', query: { issueKey: 'X' } } }
    ], warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('skips a binding whose component is missing but keeps usable ones', () => {
    const warn = vi.fn()
    const result = rebindAgentSurface(kanbanSpec(), [
      todoBinding,
      { componentId: 'ghost', descriptor: { dataSource: 'searchIssues', query: { jql: 'x' } } }
    ], warn)
    expect(result!.regions.map((r) => r.componentId)).toEqual(['todo'])
    expect(warn).toHaveBeenCalled()
  })

  it('seeds [] when the agent already path-bound the prop (no literal to seed)', () => {
    const spec = {
      surfaceId: SURFACE,
      components: [{ id: 'todo', component: 'IssueList', issues: { path: '/preexisting' } }]
    } as unknown as A2uiSurfaceUpdate
    const result = rebindAgentSurface(spec, [todoBinding], vi.fn())
    const seed = result!.dataModel.find((p) => p.path === '/items')?.value
    expect(seed).toEqual([])
  })
})

describe('planRegions — compose/restore derive the SAME regionKeys (FR consistency)', () => {
  it('two bindings → componentId keys; one binding → empty key', () => {
    expect(planRegions([todoBinding, reviewBinding], vi.fn()).map((r) => r.regionKey)).toEqual([
      'todo',
      'review'
    ])
    expect(planRegions([todoBinding], vi.fn()).map((r) => r.regionKey)).toEqual([''])
  })

  it('drops non-list sources (warned) so a partial set still plans the usable regions', () => {
    const warn = vi.fn()
    const regions = planRegions(
      [todoBinding, { componentId: 'd', descriptor: { dataSource: 'getIssue', query: {} } }],
      warn
    )
    expect(regions.map((r) => r.componentId)).toEqual(['todo'])
    expect(warn).toHaveBeenCalled()
  })
})
