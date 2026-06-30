/**
 * Node-unit tests for the PURE host-selection logic (cosmos-favorite-live-panel-portal-v1).
 * Scenario PANEL-HOST-LOGIC-01: `hostFor` returns `favorite` ONLY when Home is the visible surface
 * and the active favorite points at that panel (the ONE-CLAIMER selector); `panelVisible` truth table
 * for rail / favorite / hidden. No React/DOM — framework-free.
 */
import { describe, it, expect } from 'vitest'
import {
  hostFor,
  panelVisible,
  isGenerativePanelId,
  GENERATIVE_PANEL_IDS,
  type ActiveFavoriteSource
} from './panelHostLogic'

const favOf = (panelId: string, tabId = 't1'): ActiveFavoriteSource =>
  ({ panelId, tabId }) as ActiveFavoriteSource

describe('hostFor (the ONE-CLAIMER selector)', () => {
  it('is FAVORITE iff Home is visible AND the active favorite points at the panel', () => {
    expect(hostFor('jira', 'cosmos', favOf('jira'))).toBe('favorite')
  })

  it('is RAIL when the panel is the visible rail surface (not via Home)', () => {
    expect(hostFor('jira', 'jira', favOf('jira'))).toBe('rail')
  })

  it('is RAIL when Home is visible but the active favorite points at a DIFFERENT panel', () => {
    expect(hostFor('jira', 'cosmos', favOf('slack'))).toBe('rail')
  })

  it('is RAIL when Home is visible with NO active favorite', () => {
    expect(hostFor('jira', 'cosmos', null)).toBe('rail')
  })

  it('is RAIL when another rail surface is visible (panel hidden in its rail slot)', () => {
    expect(hostFor('confluence', 'slack', null)).toBe('rail')
  })

  it('one-claimer: across EVERY (surface, activeFavorite) combo, never claims two slots at once', () => {
    const surfaces = ['cosmos', 'terminal', 'slack', 'jira', 'confluence', 'google-calendar'] as const
    const favs: (ActiveFavoriteSource | null)[] = [
      null,
      favOf('slack'),
      favOf('jira'),
      favOf('confluence'),
      favOf('google-calendar'),
      favOf('terminal')
    ]
    for (const surface of surfaces) {
      for (const fav of favs) {
        for (const panelId of GENERATIVE_PANEL_IDS) {
          const host = hostFor(panelId, surface, fav)
          // FAVORITE requires BOTH Home-visible and the favorite pointing here; else RAIL. Total.
          const expectFavorite = surface === 'cosmos' && fav?.panelId === panelId
          expect(host).toBe(expectFavorite ? 'favorite' : 'rail')
        }
      }
    }
  })
})

describe('panelVisible (the redefined `active` = on screen)', () => {
  it('is true when the panel is the visible rail surface', () => {
    expect(panelVisible('jira', null, 'jira')).toBe(true)
  })

  it('is true when Home is visible and the active favorite hosts this panel', () => {
    expect(panelVisible('cosmos', favOf('jira'), 'jira')).toBe(true)
  })

  it('is false when Home is visible but no favorite (the panel is idle in its rail slot)', () => {
    expect(panelVisible('cosmos', null, 'jira')).toBe(false)
  })

  it('is false when a different rail surface is visible', () => {
    expect(panelVisible('slack', null, 'jira')).toBe(false)
  })

  it('is false when Home hosts a DIFFERENT panel as a favorite', () => {
    expect(panelVisible('cosmos', favOf('slack'), 'jira')).toBe(false)
  })
})

describe('isGenerativePanelId', () => {
  it('accepts the four generative panels, rejects terminal', () => {
    expect(isGenerativePanelId('jira')).toBe(true)
    expect(isGenerativePanelId('slack')).toBe(true)
    expect(isGenerativePanelId('confluence')).toBe(true)
    expect(isGenerativePanelId('google-calendar')).toBe(true)
    expect(isGenerativePanelId('terminal')).toBe(false)
  })
})
