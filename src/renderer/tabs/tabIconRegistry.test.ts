/**
 * Unit test for the renderer tab-icon registry (cosmos-random-tab-icons-v1).
 * Scenario: TAB-ICONS-REGISTRY-01 — every TabIconId resolves to a component (no missing/extra),
 * and tabIconComponent returns undefined for an unknown/absent id (caller-supplied fallback).
 *
 * Node-env (.test.ts): the registry module imports lucide components but renders no JSX, so it
 * loads fine outside jsdom; this asserts the id↔component mapping, not DOM rendering.
 */
import { describe, it, expect } from 'vitest'
import { TAB_ICON_IDS } from '../../shared/tabIcons'
import { TAB_ICON_BY_ID, tabIconComponent } from './tabIconRegistry'

describe('tabIconRegistry (TAB-ICONS-REGISTRY-01)', () => {
  it('has a component for EVERY TabIconId, no missing / no extra', () => {
    const mapKeys = Object.keys(TAB_ICON_BY_ID).sort()
    const idKeys = [...TAB_ICON_IDS].sort()
    expect(mapKeys).toEqual(idKeys)
    for (const id of TAB_ICON_IDS) {
      // lucide icons are React forwardRef objects (renderable), not plain functions.
      expect(TAB_ICON_BY_ID[id]).toBeTruthy()
    }
  })

  it('tabIconComponent resolves a valid id and returns undefined otherwise (FR-007/FR-010)', () => {
    for (const id of TAB_ICON_IDS) {
      expect(tabIconComponent(id)).toBe(TAB_ICON_BY_ID[id])
    }
    expect(tabIconComponent('nope')).toBeUndefined()
    expect(tabIconComponent(undefined)).toBeUndefined()
  })
})
