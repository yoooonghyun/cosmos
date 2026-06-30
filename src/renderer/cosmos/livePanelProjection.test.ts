import { describe, it, expect } from 'vitest'
import { projectLivePanelTab } from './livePanelProjection'
import type { TabSurface } from '../tabs/useGenerativePanelTabs'

/* cosmos-native-view-mirror-surface-v1 (D2) — the mutual-exclusivity projection. A favorite resolves
 * `mirrorSurface ?? surface`, so the publish projection must publish them mutually exclusively:
 * composed surface present → mirrorSurface null; native mirror present (no surface) → carried. */

const COMPOSED = { requestId: 'r1', spec: { surfaceId: 'composed', components: [] } } as TabSurface
const MIRROR = { requestId: 'r2', spec: { surfaceId: 'mirror', components: [] } } as TabSurface

describe('projectLivePanelTab', () => {
  it('carries id + label verbatim', () => {
    const out = projectLivePanelTab({ id: 't1', label: 'My tab' })
    expect(out.id).toBe('t1')
    expect(out.label).toBe('My tab')
  })

  it('composed surface present → mirrorSurface nulled (composed wins on screen)', () => {
    const out = projectLivePanelTab({ id: 't1', label: 'x', surface: COMPOSED, mirrorSurface: MIRROR })
    expect(out.surface).toBe(COMPOSED)
    // Even a stale mirror lingering from before a compose is suppressed.
    expect(out.mirrorSurface).toBeNull()
  })

  it('native mirror present + no surface → mirror carried (favorite resolves to it)', () => {
    const out = projectLivePanelTab({ id: 't1', label: 'x', surface: null, mirrorSurface: MIRROR })
    expect(out.surface).toBeNull()
    expect(out.mirrorSurface).toBe(MIRROR)
  })

  it('both absent → both null (favorite WAITING)', () => {
    const out = projectLivePanelTab({ id: 't1', label: 'x' })
    expect(out.surface).toBeNull()
    expect(out.mirrorSurface).toBeNull()
  })

  it('surface present, no mirror → mirror null, surface carried (existing composed favorites)', () => {
    const out = projectLivePanelTab({ id: 't1', label: 'x', surface: COMPOSED })
    expect(out.surface).toBe(COMPOSED)
    expect(out.mirrorSurface).toBeNull()
  })
})
