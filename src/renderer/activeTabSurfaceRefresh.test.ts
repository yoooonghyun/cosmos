/**
 * activeTabSurfaceRefresh — pure trigger/dispatch tests (jira-tab-switch-auto-refresh-v1,
 * FR-001/FR-004/FR-005/FR-006/FR-011/FR-012/FR-013).
 *
 * Per the SHARED interface→test pattern: the spec-compliant happy path (a BOUND surface
 * RE-activated ⇒ fire + a dispatchable secret-free `adapter.refresh` values), the
 * missing-optional cases (no surface / non-bound surface ⇒ no fire, null values, NO error),
 * and the no-double-fire contract (first live paint ⇒ no fire; errored surface ⇒ no fire).
 *
 * This is a `.test.ts` (node env) over the PURE `.ts` module — it imports no `.tsx`/DOM, so it
 * runs in the vitest node environment like the rest of the suite (`.ts`/`.test.ts` split).
 */

import { describe, it, expect } from 'vitest'
import {
  shouldAutoRefreshOnActivation,
  autoRefreshValues,
  type SurfaceForAutoRefresh
} from './activeTabSurfaceRefresh'

const descriptor = { dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()' } }
const bindings = [
  { componentId: 'col0', descriptor: { dataSource: 'searchIssues', query: { jql: 'status = "To Do"' } } },
  { componentId: 'col1', descriptor: { dataSource: 'searchIssues', query: { jql: 'status = Done' } } }
]

const surface = (over: Partial<SurfaceForAutoRefresh> = {}): SurfaceForAutoRefresh => ({
  requestId: 'r1',
  spec: { surfaceId: 's1' },
  ...over
})

describe('shouldAutoRefreshOnActivation (FR-001/FR-004/FR-005/FR-006/FR-012)', () => {
  it('FIRES for a BOUND multi-region surface RE-activated (already painted once) — SC-001/SC-002', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ bindings }),
        hasPaintedBefore: true
      })
    ).toBe(true)
  })

  it('FIRES for a BOUND single-region descriptor surface RE-activated', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ descriptor }),
        hasPaintedBefore: true
      })
    ).toBe(true)
  })

  it('does NOT fire for a NON-bound (static) surface — repaints verbatim (FR-005/SC-004)', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface(), // no descriptor, no bindings
        hasPaintedBefore: true
      })
    ).toBe(false)
  })

  it('does NOT fire on the FIRST live paint of a bound surface — no double-refresh on compose (FR-012/SC-005)', () => {
    // A fresh compose / default read: the surface is bound but the parent has not painted it
    // before. It is already registered + seeded live, so no redundant first-page re-fetch.
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ bindings }),
        hasPaintedBefore: false
      })
    ).toBe(false)
  })

  it('does NOT fire for an EMPTY / not-yet-composed tab (no surface) — FR-006', () => {
    expect(
      shouldAutoRefreshOnActivation({ surface: null, hasPaintedBefore: true })
    ).toBe(false)
  })

  it('does NOT fire for a surface in ERROR (keeps its failure presentation) — FR-006', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ descriptor, error: 'boom' }),
        hasPaintedBefore: true
      })
    ).toBe(false)
  })

  it('does NOT fire when a bound surface has an empty bindings array (no re-fetch intent)', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ bindings: [] }),
        hasPaintedBefore: true
      })
    ).toBe(false)
  })

  it('does NOT fire for a malformed surface missing its requestId (safe fallback)', () => {
    expect(
      shouldAutoRefreshOnActivation({
        surface: surface({ requestId: '', descriptor }),
        hasPaintedBefore: true
      })
    ).toBe(false)
  })
})

describe('autoRefreshValues (FR-002/FR-003/FR-013 — secret-free dispatch values)', () => {
  it('returns { surfaceId, bindings } for a MULTI-region bound surface', () => {
    expect(autoRefreshValues(surface({ bindings }))).toEqual({ surfaceId: 's1', bindings })
  })

  it('returns { surfaceId, descriptor } for a SINGLE-region bound surface', () => {
    expect(autoRefreshValues(surface({ descriptor }))).toEqual({ surfaceId: 's1', descriptor })
  })

  it('prefers bindings when both are somehow present (multi-region re-registers every region)', () => {
    const values = autoRefreshValues(surface({ bindings, descriptor }))
    expect(values).toEqual({ surfaceId: 's1', bindings })
    expect(values).not.toHaveProperty('descriptor')
  })

  it('returns null for a NON-bound surface (nothing to re-fetch) — FR-005', () => {
    expect(autoRefreshValues(surface())).toBeNull()
  })

  it('returns null for a null surface / an errored surface / an empty surfaceId (safe fallback)', () => {
    expect(autoRefreshValues(null)).toBeNull()
    expect(autoRefreshValues(surface({ descriptor, error: 'boom' }))).toBeNull()
    expect(autoRefreshValues({ requestId: 'r1', spec: { surfaceId: '' }, descriptor })).toBeNull()
  })

  it('carries NO token/secret field — only the secret-free descriptor/bindings (FR-013)', () => {
    const values = autoRefreshValues(surface({ descriptor }))
    const json = JSON.stringify(values)
    expect(json).not.toMatch(/token|secret|authorization|client_secret/i)
    // Exactly the two expected keys — no smuggled extras.
    expect(Object.keys(values ?? {}).sort()).toEqual(['descriptor', 'surfaceId'])
  })
})
