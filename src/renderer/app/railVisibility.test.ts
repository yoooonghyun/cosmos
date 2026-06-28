import { describe, it, expect } from 'vitest'
import type { EnabledIntegrations } from '../../shared/ipc'
import {
  ALL_SURFACE_IDS,
  resolveFallbackSurface,
  visibleSurfaceIds,
  type SurfaceId
} from './railVisibility'

const allDisabled: EnabledIntegrations = {
  slack: false,
  jira: false,
  confluence: false,
  'google-calendar': false
}

describe('visibleSurfaceIds — rail = always-present + enabled gateable (FR-004/FR-005)', () => {
  it('first-run (all disabled) shows only cosmos + terminal (SC-005)', () => {
    expect(visibleSurfaceIds(allDisabled)).toEqual(['cosmos', 'terminal'])
  })

  it('shows an integration only when enabled, in fixed rail order (SC-003)', () => {
    expect(
      visibleSurfaceIds({ ...allDisabled, jira: true, slack: true })
    ).toEqual(['cosmos', 'terminal', 'slack', 'jira'])
  })

  it('fully enabled rail preserves the canonical order', () => {
    expect(
      visibleSurfaceIds({
        slack: true,
        jira: true,
        confluence: true,
        'google-calendar': true
      })
    ).toEqual(ALL_SURFACE_IDS)
  })

  it('always keeps terminal + cosmos regardless of the enabled map', () => {
    const visible = visibleSurfaceIds(allDisabled)
    expect(visible).toContain('terminal')
    expect(visible).toContain('cosmos')
  })
})

describe('resolveFallbackSurface — disable-active refocus (FR-014/SC-007)', () => {
  it('keeps the active surface when it is still visible', () => {
    const enabled: EnabledIntegrations = { ...allDisabled, jira: true }
    expect(resolveFallbackSurface('jira', enabled)).toBe('jira')
  })

  it('falls back to terminal when the active surface just got disabled', () => {
    // jira was active; now disabled → not in the visible set.
    expect(resolveFallbackSurface('jira', allDisabled)).toBe('terminal')
  })

  it('keeps an always-present surface active even with everything disabled', () => {
    expect(resolveFallbackSurface('cosmos', allDisabled)).toBe('cosmos')
  })

  it('falls back to the first visible item if terminal were ever absent (defensive)', () => {
    // Synthesize an impossible "terminal hidden" set to prove the defensive branch.
    const visible: SurfaceId[] = ['cosmos', 'slack']
    expect(resolveFallbackSurface('jira', allDisabled, visible)).toBe('cosmos')
  })
})
