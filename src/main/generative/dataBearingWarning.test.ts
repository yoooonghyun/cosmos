/**
 * dataBearingWarning tests (bindings-first-generative-ui-v1, FR-008/FR-009).
 *
 * The pure heuristic `specHasUnboundDataContainer(spec)` answers: does this spec paint
 * integration data (a known list rows prop or detail bind prop holding a literal array or a
 * `{path}`)? It is the trigger for the no-binding dev warning, so it must be true on a
 * data-bearing surface (literal-array list, `{path}` list, bound detail) and false on a static
 * surface — and NEVER throw on a malformed spec (errs toward NOT warning).
 */

import { describe, expect, it } from 'vitest'
import { specHasUnboundDataContainer } from './dataBearingWarning'

describe('specHasUnboundDataContainer (FR-008/FR-009)', () => {
  it('TRUE: a list container with a LITERAL ARRAY rows prop (the seed)', () => {
    const spec = {
      surfaceId: 's1',
      components: [
        {
          id: 'root',
          component: 'IssueList',
          issues: [{ issueKey: 'P-1', summary: 'x', statusName: 'To Do', statusCategory: 'todo' }]
        }
      ]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(true)
  })

  it('TRUE: a list container with a {path}-bound rows prop', () => {
    const spec = {
      surfaceId: 's2',
      components: [{ id: 'root', component: 'IssueList', issues: { path: '/items' } }]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(true)
  })

  it('TRUE: each integration rows prop counts (channels/messages/matches/results)', () => {
    for (const prop of ['channels', 'messages', 'matches', 'results']) {
      const spec = { surfaceId: 's', components: [{ id: 'root', component: 'List', [prop]: [] }] }
      expect(specHasUnboundDataContainer(spec)).toBe(true)
    }
  })

  it('TRUE: a detail container with a {path}-bound issue prop', () => {
    const spec = {
      surfaceId: 's3',
      components: [{ id: 'root', component: 'TicketCard', issue: { path: '/issue' } }]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(true)
  })

  it('TRUE: a PageDetail with a {path}-bound body', () => {
    const spec = {
      surfaceId: 's4',
      components: [{ id: 'root', component: 'PageDetail', body: { path: '/page/body' } }]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(true)
  })

  it('FALSE: a purely static surface (Text / Column only)', () => {
    const spec = {
      surfaceId: 's5',
      components: [
        { id: 'root', component: 'Column', children: ['t'] },
        { id: 't', component: 'Text', text: 'hello' }
      ]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(false)
  })

  it('FALSE: a detail prop with a LITERAL scalar is static, not data-bearing', () => {
    // A static builder passes a literal title/body string — that is not refreshable data,
    // so the heuristic must NOT warn (conservative: only a {path} on a detail prop counts).
    const spec = {
      surfaceId: 's6',
      components: [{ id: 'root', component: 'PageDetail', title: 'Onboarding', body: 'Welcome' }]
    }
    expect(specHasUnboundDataContainer(spec)).toBe(false)
  })

  it('FALSE + no throw: malformed / empty / non-object specs', () => {
    expect(specHasUnboundDataContainer(undefined)).toBe(false)
    expect(specHasUnboundDataContainer(null)).toBe(false)
    expect(specHasUnboundDataContainer('nope')).toBe(false)
    expect(specHasUnboundDataContainer(42)).toBe(false)
    expect(specHasUnboundDataContainer({})).toBe(false)
    expect(specHasUnboundDataContainer({ components: 'not-an-array' })).toBe(false)
    expect(specHasUnboundDataContainer({ surfaceId: 's', components: [] })).toBe(false)
    expect(specHasUnboundDataContainer({ components: [null, 1, 'x'] })).toBe(false)
  })

  it('is pure — repeated calls on the same spec do not mutate it', () => {
    const spec = {
      surfaceId: 's7',
      components: [{ id: 'root', component: 'IssueList', issues: [{ issueKey: 'P-1' }] }]
    }
    const before = JSON.stringify(spec)
    specHasUnboundDataContainer(spec)
    specHasUnboundDataContainer(spec)
    expect(JSON.stringify(spec)).toBe(before)
  })
})
