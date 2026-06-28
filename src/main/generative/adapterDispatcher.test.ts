import { describe, it, expect, vi } from 'vitest'
import {
  AdapterDispatcher,
  type AdapterDispatcherDeps,
  type AdapterFetchResult,
  type AdapterResolver
} from './adapterDispatcher'
import type { AdapterDescriptor } from '../../shared/types/adapter'
import type { UiDataModelPayload } from '../../shared/ipc'

/* jira-generative-adapter-v1 — SHARED dispatcher (FR-009..FR-018, FR-021, FR-022).
 * Panel-agnostic: the resolver is injected, so these tests use a fake list source. */

const SURFACE = 'jira-issue-list'
const baseDescriptor: AdapterDescriptor = {
  dataSource: 'searchIssues',
  query: { jql: 'assignee = currentUser()' }
}

interface Harness {
  dispatcher: AdapterDispatcher
  pushes: UiDataModelPayload[]
  resolve: ReturnType<typeof vi.fn>
  cancelActive: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  /** The latest pushed value at a given path for the surface. */
  latest: (path: string) => unknown
}

function makeDispatcher(
  resolver: AdapterResolver,
  overrides?: Partial<AdapterDispatcherDeps>
): Harness {
  const pushes: UiDataModelPayload[] = []
  const resolve = vi.fn(resolver)
  const cancelActive = vi.fn()
  const warn = vi.fn()
  const dispatcher = new AdapterDispatcher({
    resolve,
    pushDataModel: (p) => pushes.push(p),
    cancelActive,
    warn,
    ...overrides
  })
  return {
    dispatcher,
    pushes,
    resolve,
    cancelActive,
    warn,
    latest: (path) => {
      const matches = pushes.filter((p) => p.surfaceId === SURFACE && p.path === path)
      return matches.length ? matches[matches.length - 1].value : undefined
    }
  }
}

/** A list result with optional cursors. */
function page(items: unknown[], next?: string, prev?: string): AdapterFetchResult {
  return { ok: true, items, ...(next ? { nextCursor: next } : {}), ...(prev ? { prevCursor: prev } : {}) }
}

describe('AdapterDispatcher.refresh (FR-013/FR-014)', () => {
  it('re-executes the descriptor and replaces the bound list + cursor flags + toggles loading', async () => {
    const h = makeDispatcher(async () => page([{ key: 'A' }, { key: 'B' }], 'cur2'))
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })

    await h.dispatcher.refresh(SURFACE)

    // FR-014: the bound list is replaced with fresh values.
    expect(h.latest('/items')).toEqual([{ key: 'A' }, { key: 'B' }])
    // FR-017: hasMore reflects the next cursor; hasPrev false for a first page.
    expect(h.latest('/hasMore')).toBe(true)
    expect(h.latest('/hasPrev')).toBe(false)
    // FR-018: loading toggled true then false; final state is false.
    const loadings = h.pushes.filter((p) => p.path === '/loading').map((p) => p.value)
    expect(loadings[0]).toBe(true)
    expect(loadings[loadings.length - 1]).toBe(false)
  })

  it('refresh restarts from the base cursor (not a stale paginated cursor)', async () => {
    const h = makeDispatcher(async () => page([{ key: 'A' }], 'cur2'))
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await h.dispatcher.loadMore(SURFACE) // advances nextCursor
    h.resolve.mockClear()
    await h.dispatcher.refresh(SURFACE)
    // The descriptor passed to refresh carries the base query (no advanced cursor).
    const passed = h.resolve.mock.calls[0][0] as AdapterDescriptor
    expect(passed.query.cursor).toBeUndefined()
  })

  it('warns + no-ops on an unknown surface (safe fallback)', async () => {
    const h = makeDispatcher(async () => page([]))
    await h.dispatcher.refresh('nope')
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.pushes).toHaveLength(0)
    expect(h.warn).toHaveBeenCalledOnce()
  })
})

describe('AdapterDispatcher.loadMore — append pagination (FR-015)', () => {
  it('accumulates and writes the FULL accumulated list at the bound path', async () => {
    let call = 0
    const h = makeDispatcher(async () => {
      call += 1
      return call === 1 ? page([{ k: 1 }], 'c1') : page([{ k: 2 }], 'c2')
    })
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })

    await h.dispatcher.refresh(SURFACE) // seeds [1]
    expect(h.latest('/items')).toEqual([{ k: 1 }])

    await h.dispatcher.loadMore(SURFACE) // appends 2 → full list [1,2]
    expect(h.latest('/items')).toEqual([{ k: 1 }, { k: 2 }])
  })

  it('passes the held next cursor on loadMore', async () => {
    const h = makeDispatcher(async () => page([{ k: 1 }], 'NEXTCUR'))
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await h.dispatcher.refresh(SURFACE)
    await h.dispatcher.loadMore(SURFACE)
    const second = h.resolve.mock.calls[1][0] as AdapterDescriptor
    expect(second.query.cursor).toBe('NEXTCUR')
  })

  it('an empty next page leaves the list unchanged and sets hasMore=false (empty-page edge)', async () => {
    let call = 0
    const h = makeDispatcher(async () => {
      call += 1
      return call === 1 ? page([{ k: 1 }], 'c1') : page([]) // no cursor → no more
    })
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await h.dispatcher.refresh(SURFACE)
    await h.dispatcher.loadMore(SURFACE)
    expect(h.latest('/items')).toEqual([{ k: 1 }]) // unchanged
    expect(h.latest('/hasMore')).toBe(false)
  })
})

describe('AdapterDispatcher.page — page-replace pagination (FR-016/FR-017)', () => {
  it('replaces the list and updates hasMore/hasPrev from cursor state', async () => {
    let call = 0
    const h = makeDispatcher(async () => {
      call += 1
      return call === 1 ? page([{ k: 1 }], 'next1') : page([{ k: 2 }], 'next2', 'prev2')
    })
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'replace' })

    await h.dispatcher.refresh(SURFACE) // page 1
    expect(h.latest('/items')).toEqual([{ k: 1 }])
    expect(h.latest('/hasPrev')).toBe(false)

    await h.dispatcher.page(SURFACE, 'next') // page 2 replaces
    expect(h.latest('/items')).toEqual([{ k: 2 }])
    expect(h.latest('/hasMore')).toBe(true)
    expect(h.latest('/hasPrev')).toBe(true)
  })

  it('uses the next cursor for a next page and prev cursor for a prev page', async () => {
    const h = makeDispatcher(async () => page([{ k: 1 }], 'NEXT', 'PREV'))
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'replace' })
    await h.dispatcher.refresh(SURFACE)
    await h.dispatcher.page(SURFACE, 'prev')
    expect((h.resolve.mock.calls[1][0] as AdapterDescriptor).query.cursor).toBe('PREV')
    await h.dispatcher.page(SURFACE, 'next')
    expect((h.resolve.mock.calls[2][0] as AdapterDescriptor).query.cursor).toBe('NEXT')
  })
})

describe('AdapterDispatcher — detail surface (single value)', () => {
  it('writes a single bound value at the list path for a non-list result', async () => {
    const detail = { key: 'PROJ-1', summary: 'Fix' }
    const h = makeDispatcher(async () => ({ ok: true, value: detail }))
    h.dispatcher.register('jira-issue-detail', { dataSource: 'getIssue', query: { issueKey: 'PROJ-1' } }, {
      listPath: '/issue',
      pagination: 'none'
    })
    await h.dispatcher.refresh('jira-issue-detail')
    const push = h.pushes.find((p) => p.surfaceId === 'jira-issue-detail' && p.path === '/issue')
    expect(push?.value).toEqual(detail)
  })
})

describe('AdapterDispatcher — safe fallback (FR-022, spec edges)', () => {
  it('a fetch error renders a recoverable notice + clears loading, leaving prior data', async () => {
    let call = 0
    const h = makeDispatcher(async () => {
      call += 1
      return call === 1
        ? page([{ k: 1 }], 'c1')
        : ({ ok: false, kind: 'network', message: 'busy, retry' } as AdapterFetchResult)
    })
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await h.dispatcher.refresh(SURFACE)
    await h.dispatcher.loadMore(SURFACE)
    // Prior list not corrupted (no new /items push on the failed call).
    expect(h.latest('/items')).toEqual([{ k: 1 }])
    expect(h.latest('/error')).toBe('busy, retry')
    expect(h.latest('/loading')).toBe(false)
  })

  it('a resolver that throws degrades to an error notice + cleared loading (never throws)', async () => {
    const h = makeDispatcher(async () => {
      throw new Error('boom')
    })
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await expect(h.dispatcher.refresh(SURFACE)).resolves.toBeUndefined()
    expect(typeof h.latest('/error')).toBe('string')
    expect(h.latest('/loading')).toBe(false)
    expect(h.warn).toHaveBeenCalled()
  })
})

describe('AdapterDispatcher — secret-free invariant (FR-021)', () => {
  it('no pushed payload contains a token even if the resolver result is inspected', async () => {
    const h = makeDispatcher(async () => page([{ key: 'A' }], 'cur2'))
    h.dispatcher.register(SURFACE, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await h.dispatcher.refresh(SURFACE)
    for (const p of h.pushes) {
      expect(JSON.stringify(p)).not.toMatch(/token|secret|bearer/i)
    }
  })
})

describe('AdapterDispatcher — agent-keyed surface (refreshable-custom-generative-ui-v1, FR-005/FR-014)', () => {
  it('refresh emits updateDataModel keyed by the AGENT surfaceId at the resolved listPath', async () => {
    // The dispatcher is surfaceId-agnostic: a CUSTOM agent surfaceId routes exactly like the
    // generic shell's id. Register under the agent's own id + the bind options its dataSource
    // implies; refresh must push to THAT id at THAT path (no generic shell id leaks).
    const agentId = 'agent-kanban-7'
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: async () => ({ ok: true, items: [{ key: 'A' }], nextCursor: 'c2' }),
      pushDataModel: (p) => pushes.push(p)
    })
    dispatcher.register(agentId, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await dispatcher.refresh(agentId)

    const itemsPush = pushes.find((p) => p.surfaceId === agentId && p.path === '/items')
    expect(itemsPush?.value).toEqual([{ key: 'A' }])
    // No push escaped to a different (shell) surfaceId.
    expect(pushes.every((p) => p.surfaceId === agentId)).toBe(true)
  })

  it('re-registering the same agent surfaceId replaces prior accumulation/cursors (FR-014)', async () => {
    let call = 0
    const pushes: UiDataModelPayload[] = []
    const dispatcher = new AdapterDispatcher({
      resolve: async () => {
        call += 1
        return { ok: true, items: [{ n: call }], nextCursor: `c${call}` }
      },
      pushDataModel: (p) => pushes.push(p)
    })
    const id = 'agent-dup'
    dispatcher.register(id, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await dispatcher.refresh(id)
    await dispatcher.loadMore(id) // accumulates → [{n:1},{n:2}]
    // Re-register the SAME id (an agent reused a surfaceId): accumulation resets.
    dispatcher.register(id, baseDescriptor, { listPath: '/items', pagination: 'append' })
    await dispatcher.refresh(id)
    const last = pushes.filter((p) => p.surfaceId === id && p.path === '/items').at(-1)
    expect(last?.value).toEqual([{ n: 3 }]) // fresh, not appended onto the prior list
  })
})

describe('AdapterDispatcher — multi-region surface (구분된 컴포넌트 별 별도 fetcher)', () => {
  const todoDesc: AdapterDescriptor = { dataSource: 'searchIssues', query: { jql: 'status = "To Do"' } }
  const reviewDesc: AdapterDescriptor = { dataSource: 'searchIssues', query: { jql: 'status = "In Review"' } }

  it('refresh(region) reloads ONLY that region\'s fetcher + path; siblings untouched', async () => {
    // Each column has its own JQL → its own resolver branch. Refreshing 'todo' must not write
    // 'review' (region independence: one column never overwrites another's data-model sub-tree).
    const h = makeDispatcher(async (d) =>
      d.query.jql === 'status = "To Do"' ? page([{ key: 'T1' }]) : page([{ key: 'R1' }])
    )
    h.dispatcher.register(SURFACE, todoDesc, { listPath: '/items', pagination: 'append' }, 'todo')
    h.dispatcher.register(SURFACE, reviewDesc, { listPath: '/items', pagination: 'append' }, 'review')

    await h.dispatcher.refresh(SURFACE, 'todo')
    expect(h.latest('/regions/todo/items')).toEqual([{ key: 'T1' }])
    // The review region was never touched by a todo-scoped refresh.
    expect(h.latest('/regions/review/items')).toBeUndefined()
  })

  it('refreshSurface fans out to EVERY region — CSMS-6 moves columns on refresh', async () => {
    // The card moved To Do → In Review server-side. A surface-level refresh re-queries BOTH
    // columns' JQL: To Do no longer returns it, In Review now does → it changes columns.
    let moved = false
    const h = makeDispatcher(async (d) => {
      const isTodo = d.query.jql === 'status = "To Do"'
      if (!moved) {
        return isTodo ? page([{ key: 'CSMS-6' }]) : page([])
      }
      return isTodo ? page([]) : page([{ key: 'CSMS-6' }])
    })
    h.dispatcher.register(SURFACE, todoDesc, { listPath: '/items', pagination: 'append' }, 'todo')
    h.dispatcher.register(SURFACE, reviewDesc, { listPath: '/items', pagination: 'append' }, 'review')

    await h.dispatcher.refreshSurface(SURFACE)
    expect(h.latest('/regions/todo/items')).toEqual([{ key: 'CSMS-6' }])
    expect(h.latest('/regions/review/items')).toEqual([])

    moved = true
    await h.dispatcher.refreshSurface(SURFACE)
    expect(h.latest('/regions/todo/items')).toEqual([]) // left To Do
    expect(h.latest('/regions/review/items')).toEqual([{ key: 'CSMS-6' }]) // landed In Review
  })

  it('each region holds its OWN cursor — loadMore advances only that region', async () => {
    const calls: AdapterDescriptor[] = []
    const h = makeDispatcher(async (d) => {
      calls.push(d)
      const isTodo = d.query.jql === 'status = "To Do"'
      return isTodo ? page([{ k: 't' }], 'TODO_NEXT') : page([{ k: 'r' }], 'REVIEW_NEXT')
    })
    h.dispatcher.register(SURFACE, todoDesc, { listPath: '/items', pagination: 'append' }, 'todo')
    h.dispatcher.register(SURFACE, reviewDesc, { listPath: '/items', pagination: 'append' }, 'review')
    await h.dispatcher.refresh(SURFACE, 'todo')
    await h.dispatcher.refresh(SURFACE, 'review')
    await h.dispatcher.loadMore(SURFACE, 'todo')
    const todoLoadMore = calls.at(-1)!
    expect(todoLoadMore.query.jql).toBe('status = "To Do"')
    expect(todoLoadMore.query.cursor).toBe('TODO_NEXT') // its own cursor, not review's
  })

  it('regionsOf lists every registered region; unregister(region) drops just one', () => {
    const h = makeDispatcher(async () => page([]))
    h.dispatcher.register(SURFACE, todoDesc, { listPath: '/items', pagination: 'append' }, 'todo')
    h.dispatcher.register(SURFACE, reviewDesc, { listPath: '/items', pagination: 'append' }, 'review')
    expect(h.dispatcher.regionsOf(SURFACE).sort()).toEqual(['review', 'todo'])
    h.dispatcher.unregister(SURFACE, 'todo')
    expect(h.dispatcher.regionsOf(SURFACE)).toEqual(['review'])
    expect(h.dispatcher.has(SURFACE)).toBe(true) // still has review
    h.dispatcher.unregister(SURFACE, 'review')
    expect(h.dispatcher.has(SURFACE)).toBe(false) // last region gone → surface gone
  })
})

describe('AdapterDispatcher — channel independence (FR-012)', () => {
  it('is constructed with only resolver/push/cancel — no PtyManager/AgentRunner deps (by construction)', () => {
    // The deps type itself proves this: there is no ptyManager/agentRunner field.
    const deps: AdapterDispatcherDeps = {
      resolve: async () => page([]),
      pushDataModel: () => {}
    }
    const dispatcher = new AdapterDispatcher(deps)
    expect(dispatcher).toBeInstanceOf(AdapterDispatcher)
    // cancelActive is optional; absent is fine.
    expect('cancelActive' in deps).toBe(false)
  })
})
