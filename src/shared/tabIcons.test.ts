/**
 * Unit tests for the pure tab-icon vocabulary + helpers (cosmos-random-tab-icons-v1).
 * Scenario: TAB-ICONS-REGISTRY-01 — the 14-id set, membership, random ∈ set, deterministic fallback.
 */
import { describe, it, expect } from 'vitest'
import {
  TAB_ICON_IDS,
  isTabIconId,
  randomTabIconId,
  tabIconIdFromKey,
  type TabIconId
} from './tabIcons'

describe('tabIcons vocabulary (TAB-ICONS-REGISTRY-01)', () => {
  it('TAB_ICON_IDS is EXACTLY the 14 named ids, no more/fewer (FR-001/SC-006)', () => {
    expect(TAB_ICON_IDS).toEqual([
      'rocket',
      'orbit',
      'satellite',
      'satellite-dish',
      'telescope',
      'atom',
      'star',
      'moon-star',
      'moon',
      'sun',
      'sun-moon',
      'sparkle',
      'sparkles',
      'earth'
    ])
    expect(TAB_ICON_IDS).toHaveLength(14)
    // No duplicate ids.
    expect(new Set(TAB_ICON_IDS).size).toBe(14)
  })

  it('isTabIconId accepts members and rejects unknown / non-string (FR-007)', () => {
    for (const id of TAB_ICON_IDS) {
      expect(isTabIconId(id)).toBe(true)
    }
    expect(isTabIconId('nope')).toBe(false)
    expect(isTabIconId('Rocket')).toBe(false) // case-sensitive, kebab only
    expect(isTabIconId(undefined)).toBe(false)
    expect(isTabIconId(null)).toBe(false)
    expect(isTabIconId(42)).toBe(false)
    expect(isTabIconId({})).toBe(false)
  })

  it('randomTabIconId always returns a member of the set (FR-002)', () => {
    const set = new Set<TabIconId>(TAB_ICON_IDS)
    for (let i = 0; i < 500; i++) {
      expect(set.has(randomTabIconId())).toBe(true)
    }
  })

  it('tabIconIdFromKey is DETERMINISTIC and always ∈ set (FR-006)', () => {
    const set = new Set<TabIconId>(TAB_ICON_IDS)
    const keys = ['tab-1', 'pane-abc', '', 'a', crypto.randomUUID(), 'another-id']
    for (const k of keys) {
      const a = tabIconIdFromKey(k)
      const b = tabIconIdFromKey(k)
      expect(a).toBe(b) // same key → same id, every call
      expect(set.has(a)).toBe(true)
    }
  })

  it('tabIconIdFromKey spreads across the set for varied keys (best-effort distinguishability)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(tabIconIdFromKey(`tab-${i}`))
    }
    // Not asserting a uniform distribution, just that the hash is not collapsing to one bucket.
    expect(seen.size).toBeGreaterThan(5)
  })
})
