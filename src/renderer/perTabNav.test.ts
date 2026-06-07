/**
 * perTabNav.test — regression tests for per-tab native-base navigation state
 * (bug panel-shared-tab-nav-state-v1).
 *
 * The bug: Slack/Confluence held the native-base nav (`view`/`searchText`/`query`) in a
 * single panel-level `useState`, so every tab's base reflected the SAME navigation.
 * These tests assert the pure per-tab helper keeps each tab independent: setting tab A's
 * nav must NOT affect tab B, and an unset tab reads its panel default. With the old
 * single-value model there was no per-tab keying at all, so the "tab B is unaffected"
 * assertion would have been impossible to satisfy — that is what fails without the fix.
 *
 * Node env (no jsdom): tests the plain `.ts` helper, never imports a `.tsx`.
 */

import { describe, expect, it, vi } from 'vitest'
import { clearAllNav, dropNav, getNav, setNav, type PerTabNav } from './perTabNav'

interface Nav {
  view: string
  searchText: string
}

const DEFAULT: Nav = { view: 'channels', searchText: '' }

describe('perTabNav', () => {
  describe('per-tab independence (the bug)', () => {
    it('setting tab A nav does not affect tab B (each tab independent)', () => {
      let map: PerTabNav<Nav> = {}
      // Tab A drills into a channel's history.
      map = setNav(map, 'tab-A', { view: 'history:general', searchText: '' })

      // Tab A reflects the drill-in...
      expect(getNav(map, 'tab-A', DEFAULT)).toEqual({ view: 'history:general', searchText: '' })
      // ...but tab B is UNTOUCHED and reads its default (the regression assertion: the
      // pre-fix single shared `view` would have shown tab A's history here too).
      expect(getNav(map, 'tab-B', DEFAULT)).toEqual(DEFAULT)
    })

    it('an unset tab reads the supplied default', () => {
      const map: PerTabNav<Nav> = {}
      expect(getNav(map, 'fresh-tab', DEFAULT)).toEqual(DEFAULT)
    })

    it('two tabs can hold different nav simultaneously', () => {
      let map: PerTabNav<Nav> = {}
      map = setNav(map, 'tab-A', { view: 'history:general', searchText: '' })
      map = setNav(map, 'tab-B', { view: 'search', searchText: 'deploy' })

      expect(getNav(map, 'tab-A', DEFAULT)).toEqual({ view: 'history:general', searchText: '' })
      expect(getNav(map, 'tab-B', DEFAULT)).toEqual({ view: 'search', searchText: 'deploy' })
    })

    it('re-setting a tab replaces only that tab', () => {
      let map: PerTabNav<Nav> = {}
      map = setNav(map, 'tab-A', { view: 'history:general', searchText: '' })
      map = setNav(map, 'tab-B', { view: 'channels', searchText: '' })
      map = setNav(map, 'tab-A', { view: 'thread', searchText: '' })

      expect(getNav(map, 'tab-A', DEFAULT)).toEqual({ view: 'thread', searchText: '' })
      expect(getNav(map, 'tab-B', DEFAULT)).toEqual({ view: 'channels', searchText: '' })
    })
  })

  describe('purity (no input mutation)', () => {
    it('setNav returns a fresh map and does not mutate the input', () => {
      const map: PerTabNav<Nav> = {}
      const next = setNav(map, 'tab-A', { view: 'history', searchText: '' })
      expect(next).not.toBe(map)
      expect(map).toEqual({})
    })

    it('dropNav returns a fresh map and does not mutate the input', () => {
      const map: PerTabNav<Nav> = { 'tab-A': { view: 'history', searchText: '' } }
      const next = dropNav(map, 'tab-A')
      expect(next).not.toBe(map)
      expect(Object.prototype.hasOwnProperty.call(map, 'tab-A')).toBe(true)
    })
  })

  describe('dropNav (tab close cleanup)', () => {
    it('drops only the named tab, leaving others intact', () => {
      let map: PerTabNav<Nav> = {}
      map = setNav(map, 'tab-A', { view: 'history', searchText: '' })
      map = setNav(map, 'tab-B', { view: 'search', searchText: 'x' })
      map = dropNav(map, 'tab-A')

      expect(getNav(map, 'tab-A', DEFAULT)).toEqual(DEFAULT) // back to default
      expect(getNav(map, 'tab-B', DEFAULT)).toEqual({ view: 'search', searchText: 'x' })
    })

    it('dropping an absent or empty tab is a harmless no-op', () => {
      const map: PerTabNav<Nav> = { 'tab-A': { view: 'history', searchText: '' } }
      expect(dropNav(map, 'missing')).toBe(map)
      expect(dropNav(map, '')).toBe(map)
      expect(dropNav(map, null)).toBe(map)
    })
  })

  describe('clearAllNav (connection transition)', () => {
    it('resets every tab to default (empty map)', () => {
      let map: PerTabNav<Nav> = {}
      map = setNav(map, 'tab-A', { view: 'history', searchText: '' })
      map = setNav(map, 'tab-B', { view: 'search', searchText: 'x' })
      const cleared = clearAllNav<Nav>()

      expect(getNav(cleared, 'tab-A', DEFAULT)).toEqual(DEFAULT)
      expect(getNav(cleared, 'tab-B', DEFAULT)).toEqual(DEFAULT)
    })
  })

  describe('invalid / missing required args (safe fallback, no throw)', () => {
    it('setNav with a missing/empty tabId warns and returns the unchanged map', () => {
      const warn = vi.fn()
      const map: PerTabNav<Nav> = { 'tab-A': { view: 'history', searchText: '' } }

      expect(setNav(map, '', { view: 'x', searchText: '' }, warn)).toBe(map)
      expect(setNav(map, null, { view: 'x', searchText: '' }, warn)).toBe(map)
      expect(warn).toHaveBeenCalledTimes(2)
    })

    it('getNav with a missing/empty tabId returns the fallback', () => {
      const map: PerTabNav<Nav> = { 'tab-A': { view: 'history', searchText: '' } }
      expect(getNav(map, '', DEFAULT)).toEqual(DEFAULT)
      expect(getNav(map, null, DEFAULT)).toEqual(DEFAULT)
    })
  })
})
