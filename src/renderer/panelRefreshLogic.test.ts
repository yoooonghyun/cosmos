/**
 * panelRefreshLogic — pure derivation tests (panel-refresh-v1, Goal 1 / FR-003/FR-004/FR-016).
 *
 * Per the SHARED interface→test pattern: the spec-compliant happy path (a registered/bound
 * surface ⇒ enabled + a dispatchable refresh target), the missing-optional case (a surface
 * without a descriptor / an empty tab ⇒ disabled, NO error), and the invalid/edge cases
 * (errored surface, empty surfaceId, busy click guard) ⇒ a SAFE disabled/no-op fallback.
 *
 * This is a `.test.ts` (node env) over the PURE `.ts` module — it imports no `.tsx`/DOM, so
 * it runs in the vitest node environment like the rest of the suite.
 */

import { describe, it, expect } from 'vitest'
import {
  derivePanelRefreshState,
  shouldDispatchRefresh,
  panelRefreshInputsFor,
  type GenerativeTabForRefresh
} from './panelRefreshLogic'

const descriptor = { dataSource: 'searchIssues', query: { jql: 'x' } }

describe('derivePanelRefreshState (FR-003/FR-004)', () => {
  it('enabled + dispatchable when the active surface is registered (surfaceId + descriptor)', () => {
    const state = derivePanelRefreshState({ surface: { surfaceId: 's1', descriptor }, busy: false })
    expect(state).toEqual({
      enabled: true,
      busy: false,
      refresh: { surfaceId: 's1', descriptor }
    })
    expect(shouldDispatchRefresh(state)).toBe(true)
  })

  it('DISABLED with a null active tab (empty panel) — safe fallback, no error', () => {
    const state = derivePanelRefreshState(null)
    expect(state).toEqual({ enabled: false, busy: false, refresh: null })
    expect(shouldDispatchRefresh(state)).toBe(false)
  })

  it('DISABLED when the surface has no descriptor (composed without one — missing optional)', () => {
    const state = derivePanelRefreshState({ surface: { surfaceId: 's1' }, busy: false })
    expect(state.enabled).toBe(false)
    expect(state.refresh).toBeNull()
  })

  it('DISABLED when the surface is errored (never refreshable)', () => {
    const state = derivePanelRefreshState({
      surface: { surfaceId: 's1', descriptor, error: true },
      busy: false
    })
    expect(state.enabled).toBe(false)
    expect(state.refresh).toBeNull()
  })

  it('DISABLED when the surfaceId is empty (invalid required → safe fallback)', () => {
    const state = derivePanelRefreshState({ surface: { surfaceId: '', descriptor }, busy: false })
    expect(state.enabled).toBe(false)
    expect(state.refresh).toBeNull()
  })

  it('stays ENABLED but busy when a run is in flight (the busy click is guarded, §3.2)', () => {
    const state = derivePanelRefreshState({ surface: { surfaceId: 's1', descriptor }, busy: true })
    expect(state.enabled).toBe(true)
    expect(state.busy).toBe(true)
    // A busy click must NOT dispatch (no stacking two refreshes — FR-016 / §3.2).
    expect(shouldDispatchRefresh(state)).toBe(false)
  })

  it('a disabled control never dispatches even when not busy', () => {
    expect(shouldDispatchRefresh({ enabled: false, busy: false, refresh: null })).toBe(false)
  })

  // refreshable-custom-generative-ui-v1 (FR-012): a CUSTOM agent-composed bound surface carries
  // the AGENT's own surfaceId + a descriptor — the same two inputs the derivation already keys
  // on — so the panel refresh control enables for it with NO change to this pure logic.
  it('ENABLES for a CUSTOM agent surfaceId + descriptor (FR-012)', () => {
    const state = derivePanelRefreshState({
      surface: { surfaceId: 'agent-kanban-7', descriptor },
      busy: false
    })
    expect(state.enabled).toBe(true)
    expect(state.refresh).toEqual({ surfaceId: 'agent-kanban-7', descriptor })
  })
})

describe('panelRefreshInputsFor (shared 4-panel projection)', () => {
  const tab = (over: Partial<GenerativeTabForRefresh> = {}): GenerativeTabForRefresh => ({
    surface: {
      requestId: 'r1',
      spec: { surfaceId: 's1' },
      descriptor,
      ...(over.surface ?? {})
    },
    ...over
  })

  it('projects a bound surface to an enabled refresh slice + its requestId', () => {
    const { activeTab, requestId } = panelRefreshInputsFor(tab())
    expect(requestId).toBe('r1')
    expect(activeTab.surface).toEqual({ surfaceId: 's1', descriptor })
    expect(activeTab.busy).toBe(false)
    expect(derivePanelRefreshState(activeTab).enabled).toBe(true)
  })

  it('null active tab → a null surface slice + null requestId (empty panel)', () => {
    const { activeTab, requestId } = panelRefreshInputsFor(null)
    expect(activeTab.surface).toBeNull()
    expect(requestId).toBeNull()
  })

  it('a surface whose spec has NO surfaceId → a non-refreshable (null) surface slice', () => {
    const { activeTab } = panelRefreshInputsFor({
      surface: { requestId: 'r1', spec: {}, descriptor }
    })
    expect(activeTab.surface).toBeNull()
    expect(derivePanelRefreshState(activeTab).enabled).toBe(false)
  })

  it('busy reflects an in-flight compose OR a default-view load', () => {
    expect(panelRefreshInputsFor(tab({ inFlight: true })).activeTab.busy).toBe(true)
    expect(panelRefreshInputsFor(tab({ loadingDefault: true })).activeTab.busy).toBe(true)
  })

  it('an errored surface projects an error slice (derives to disabled)', () => {
    const { activeTab } = panelRefreshInputsFor({
      surface: { requestId: 'r1', spec: { surfaceId: 's1' }, error: 'boom' }
    })
    expect(activeTab.surface?.error).toBe(true)
    expect(derivePanelRefreshState(activeTab).enabled).toBe(false)
  })
})
