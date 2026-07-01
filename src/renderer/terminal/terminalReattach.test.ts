/**
 * Pure reconcile-logic tests for the dev wake-reload reattach handshake
 * (cosmos-dev-wake-reload-session-survival-v1, D4/FR-011/OQ-2).
 *
 * `planReattach` decides which LIVE paneIds must be adopted as new tabs — the survivors whose tab
 * was minted after the last (debounced, possibly stale) snapshot save, so their rehydrated tab is
 * absent. Survivors that already have a hydrated tab reattach via that tab's idempotent autoStart and
 * are NOT adopted.
 */
import { describe, it, expect } from 'vitest'
import { planReattach } from './terminalReattach'

describe('planReattach (cosmos-dev-wake-reload-session-survival-v1, FR-011/OQ-2)', () => {
  it('adopts a live pane that has NO hydrated tab (minted after the last snapshot save)', () => {
    // pane-A is a survivor with a hydrated tab; pane-B survived but its tab was never snapshotted.
    expect(planReattach(['pane-A'], ['pane-A', 'pane-B'])).toEqual({ adopt: ['pane-B'] })
  })

  it('adopts nothing when every live pane already has a hydrated tab (all survivors reattach)', () => {
    expect(planReattach(['pane-A', 'pane-B'], ['pane-A', 'pane-B'])).toEqual({ adopt: [] })
  })

  it('adopts nothing when there are no live panes (first launch after a real quit)', () => {
    expect(planReattach(['pane-A', 'pane-B'], [])).toEqual({ adopt: [] })
  })

  it('adopts every live pane when the renderer rehydrated no tabs (empty snapshot)', () => {
    expect(planReattach([], ['pane-A', 'pane-B'])).toEqual({ adopt: ['pane-A', 'pane-B'] })
  })

  it('preserves live-pane order and de-dupes a repeated id defensively', () => {
    expect(planReattach(['x'], ['b', 'a', 'a', 'x', 'c'])).toEqual({ adopt: ['b', 'a', 'c'] })
  })

  it('does not treat a hydrated tab with no live session as adoptable (it resumes via autoStart)', () => {
    // pane-A hydrated but NOT live (died / never started) → not adopted; it resumes on its own tab.
    expect(planReattach(['pane-A', 'pane-B'], ['pane-B'])).toEqual({ adopt: [] })
  })
})
