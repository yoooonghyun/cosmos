/**
 * dataBearingSpec tests (bindings-first-generative-ui-v1 + v2 enforcement, FR-008/FR-009).
 *
 * The pure heuristics answer: does this spec paint integration data (a known list rows prop or
 * detail bind prop holding a literal array or a `{path}`)? They drive BOTH the no-binding dev
 * warning AND the MCP render-server enforcement rejection, so they must be true on a data-bearing
 * surface (literal-array list, `{path}` list, bound detail) and false on a static surface — and
 * NEVER throw on a malformed spec (errs toward NOT flagging). `firstUnboundDataContainerId` also
 * returns the offending container id so the rejection message can name it.
 */

import { describe, expect, it } from 'vitest'
import {
  BindingsFirstEnforcer,
  ENFORCEMENT_REJECT_CAP,
  evaluateBindingsFirst,
  firstUnboundDataContainerId,
  specHasUnboundDataContainer
} from './dataBearingSpec'

/** A data-bearing spec: an IssueList with literal seed rows and no binding. */
const DATA_SPEC = {
  surfaceId: 'jira-kanban-1',
  components: [{ id: 'todo', component: 'IssueList', issues: [{ issueKey: 'P-1' }] }]
}

/** A purely static spec — no data container. */
const STATIC_SPEC = {
  surfaceId: 's',
  components: [{ id: 'root', component: 'Text', text: 'static' }]
}

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

describe('firstUnboundDataContainerId (v2 enforcement — names the offending container)', () => {
  it('returns the data-bearing container id (a kanban column with literal seed rows)', () => {
    const spec = {
      surfaceId: 'jira-kanban-1',
      components: [
        { id: 'root', component: 'Row', children: ['todo', 'review'] },
        { id: 'todo', component: 'IssueList', issues: [{ issueKey: 'P-1' }] },
        { id: 'review', component: 'IssueList', issues: [] }
      ]
    }
    // First data-bearing container in document order is `todo`.
    expect(firstUnboundDataContainerId(spec)).toBe('todo')
  })

  it("returns '' for a data-bearing container that has no string id (still flagged)", () => {
    const spec = { surfaceId: 's', components: [{ component: 'IssueList', issues: [] }] }
    expect(firstUnboundDataContainerId(spec)).toBe('')
  })

  it('returns null for a static-only surface (no data container)', () => {
    const spec = {
      surfaceId: 's',
      components: [{ id: 'root', component: 'Text', text: 'static' }]
    }
    expect(firstUnboundDataContainerId(spec)).toBeNull()
  })

  it('returns null + no throw for malformed specs', () => {
    expect(firstUnboundDataContainerId(undefined)).toBeNull()
    expect(firstUnboundDataContainerId({ components: 'nope' })).toBeNull()
  })
})

describe('evaluateBindingsFirst (v2 enforcement — reject/allow)', () => {
  it('REJECTS an unbound data surface (no descriptor, no bindings) with a secret-free message', () => {
    const decision = evaluateBindingsFirst({
      spec: DATA_SPEC,
      hasDescriptor: false,
      hasBindings: false
    })
    expect(decision.reject).toBe(true)
    if (decision.reject) {
      // Names the offending container + teaches the bindings shape, and REMINDS that query is
      // secret-free (the message instructs NEVER to put a token — it must not emit any secret).
      expect(decision.message).toContain('todo')
      expect(decision.message).toContain('bindings')
      expect(decision.message).toContain('NEVER a token')
    }
  })

  it('ALLOWS a static-only surface (no data container)', () => {
    expect(
      evaluateBindingsFirst({ spec: STATIC_SPEC, hasDescriptor: false, hasBindings: false }).reject
    ).toBe(false)
  })

  it('ALLOWS when a descriptor is already present (single-binding form)', () => {
    expect(
      evaluateBindingsFirst({ spec: DATA_SPEC, hasDescriptor: true, hasBindings: false }).reject
    ).toBe(false)
  })

  it('ALLOWS when bindings are already present', () => {
    expect(
      evaluateBindingsFirst({ spec: DATA_SPEC, hasDescriptor: false, hasBindings: true }).reject
    ).toBe(false)
  })
})

describe('BindingsFirstEnforcer (v2 — bounded reject loop)', () => {
  it('rejects up to the cap, then falls back to rendering (allow) so the surface still appears', () => {
    const enforcer = new BindingsFirstEnforcer()
    const input = { spec: DATA_SPEC, hasDescriptor: false, hasBindings: false }
    // First ENFORCEMENT_REJECT_CAP calls reject; the next falls back to render-anyway.
    for (let i = 0; i < ENFORCEMENT_REJECT_CAP; i++) {
      expect(enforcer.evaluate(input).reject).toBe(true)
    }
    expect(enforcer.evaluate(input).reject).toBe(false)
    // Stays in render-anyway mode afterward (does not resume rejecting).
    expect(enforcer.evaluate(input).reject).toBe(false)
  })

  it('an allowed call (descriptor present) does NOT consume the reject budget', () => {
    const enforcer = new BindingsFirstEnforcer()
    // A bound call is allowed and must not count toward the cap.
    expect(
      enforcer.evaluate({ spec: DATA_SPEC, hasDescriptor: true, hasBindings: false }).reject
    ).toBe(false)
    // The full reject budget is still available for unbound calls.
    for (let i = 0; i < ENFORCEMENT_REJECT_CAP; i++) {
      expect(
        enforcer.evaluate({ spec: DATA_SPEC, hasDescriptor: false, hasBindings: false }).reject
      ).toBe(true)
    }
    expect(
      enforcer.evaluate({ spec: DATA_SPEC, hasDescriptor: false, hasBindings: false }).reject
    ).toBe(false)
  })

  it('honors a custom cap', () => {
    const enforcer = new BindingsFirstEnforcer(1)
    const input = { spec: DATA_SPEC, hasDescriptor: false, hasBindings: false }
    expect(enforcer.evaluate(input).reject).toBe(true)
    expect(enforcer.evaluate(input).reject).toBe(false)
  })
})
