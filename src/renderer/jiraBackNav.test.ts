/**
 * jiraBackNav.test — regression tests for the Jira "← Back to list" decision
 * (bug jira-detail-back-loses-generated-ui-v1).
 *
 * The bug: a ticket detail opened on top of a PINNED generated-UI (`composed`) surface,
 * pressed "Back", returned to the default board / last search instead of restoring the
 * generated UI — because the back-nav origin had no `composed` variant and the detail
 * frame had overwritten the surface without snapshotting it. The fix adds a `composed`
 * origin carrying the surface snapshot; `backNavTarget` maps it to `restore-surface`.
 *
 * These tests pin that decision. The composed→restore assertion is the regression guard:
 * with the pre-fix origin union (`default` | `search` only) there was no way to express a
 * composed origin at all, so `restore-surface` could never be produced — that is what
 * fails without the fix. The default/search→read assertions pin the UNCHANGED behavior.
 *
 * Node env (no jsdom): tests the plain `.ts` helper, never imports a `.tsx`.
 */

import { describe, expect, it } from 'vitest'
import { backNavTarget, type JiraBackOrigin } from './jiraBackNav'
import type { TabSurface } from './useGenerativePanelTabs'

const surface: TabSurface = {
  requestId: 'req-gen-ui-1',
  spec: { root: 'card', components: {} } as unknown as TabSurface['spec']
}

describe('backNavTarget', () => {
  describe('composed origin → restore the pinned generated UI (the bug)', () => {
    it('returns restore-surface carrying the snapshotted surface', () => {
      const origin: JiraBackOrigin = { kind: 'composed', surface }
      expect(backNavTarget(origin)).toEqual({ kind: 'restore-surface', surface })
    })

    it('restores the EXACT snapshot reference (no read, surface re-filed verbatim)', () => {
      const result = backNavTarget({ kind: 'composed', surface })
      expect(result.kind).toBe('restore-surface')
      if (result.kind === 'restore-surface') {
        expect(result.surface).toBe(surface)
      }
    })
  })

  describe('default / search origins → existing read behavior (unchanged)', () => {
    it('default origin → read-default', () => {
      expect(backNavTarget({ kind: 'default' })).toEqual({ kind: 'read-default' })
    })

    it('search origin → read-search carrying the raw jql', () => {
      const origin: JiraBackOrigin = { kind: 'search', jql: 'project = COS ORDER BY updated' }
      expect(backNavTarget(origin)).toEqual({
        kind: 'read-search',
        jql: 'project = COS ORDER BY updated'
      })
    })
  })

  describe('safe fallback (no throw)', () => {
    it('a malformed composed origin missing its snapshot degrades to read-default', () => {
      // The runtime-invalid shape a strict type would forbid; the helper must not throw.
      const origin = { kind: 'composed' } as unknown as JiraBackOrigin
      expect(backNavTarget(origin)).toEqual({ kind: 'read-default' })
    })
  })
})
