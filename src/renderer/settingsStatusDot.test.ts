import { describe, expect, it } from 'vitest'
import { shouldShowStatusDot, type ConnectionState } from './settingsStatusDot'

/**
 * settings-visual-v1 defect #1: the side-nav status dot must be gated on the LIVE
 * connection state, not on the "Show in sidebar" (`enabled`) preference. These
 * assertions fail under the old `enabled[id] ? <StatusDot/> : null` gate (a
 * connected-but-not-enabled integration returned `null`) and pass after the fix.
 */
describe('shouldShowStatusDot', () => {
  it('shows the dot for a connected integration regardless of enablement', () => {
    // The lone-Google-Calendar repro: connected but "Show in sidebar" OFF.
    expect(shouldShowStatusDot('connected')).toBe(true)
  })

  it('shows the dot while connecting', () => {
    expect(shouldShowStatusDot('connecting')).toBe(true)
  })

  it('shows the dot when a reconnect is needed', () => {
    expect(shouldShowStatusDot('reconnect_needed')).toBe(true)
  })

  it('hides the dot only when not connected', () => {
    expect(shouldShowStatusDot('not_connected')).toBe(false)
  })

  it('covers every connection state in the vocabulary', () => {
    const states: ConnectionState[] = [
      'not_connected',
      'connecting',
      'connected',
      'reconnect_needed'
    ]
    expect(states.map(shouldShowStatusDot)).toEqual([false, true, true, true])
  })
})
