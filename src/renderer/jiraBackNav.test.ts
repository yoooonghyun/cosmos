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

  describe('a REFRESHABLE composed surface restores marked `restored` (Defect B)', () => {
    // jira-refreshable-detail-nav-crash-and-empty-v1: a bound kanban keeps its row data
    // only in live SDK state (seed pushed separately, never on surface.dataModel; regions
    // repaint via per-region refresh). The detail overlay clears that state, so restoring
    // the spec alone repaints an EMPTY board. The fix restores the snapshot marked
    // `restored: true` so ActiveTabSurface's restore-refresh effect re-registers every
    // region in main and re-fetches, repopulating the board.
    it('a bindings (multi-region) surface → restore-surface marked restored:true', () => {
      const bound: TabSurface = {
        requestId: 'req-kanban-1',
        spec: { surfaceId: 'jira-kanban-1', components: {} } as unknown as TabSurface['spec'],
        bindings: [
          { componentId: 'col-todo', descriptor: { dataSource: 'searchIssues', query: { jql: 'status=To Do' } } }
        ] as TabSurface['bindings']
      }
      const result = backNavTarget({ kind: 'composed', surface: bound })
      expect(result.kind).toBe('restore-surface')
      if (result.kind === 'restore-surface') {
        // The board re-fetch is re-kicked on Back via the `restored` flag.
        expect(result.surface.restored).toBe(true)
        // The bindings + spec ride along unchanged so every region re-registers.
        expect(result.surface.bindings).toBe(bound.bindings)
        expect(result.surface.spec).toBe(bound.spec)
      }
    })

    it('a single-region descriptor surface → restore-surface marked restored:true', () => {
      const bound: TabSurface = {
        requestId: 'req-bound-1',
        spec: { surfaceId: 'jira-list-1', components: {} } as unknown as TabSurface['spec'],
        descriptor: { dataSource: 'searchIssues', query: { jql: 'assignee=me' } } as TabSurface['descriptor']
      }
      const result = backNavTarget({ kind: 'composed', surface: bound })
      expect(result.kind).toBe('restore-surface')
      if (result.kind === 'restore-surface') {
        expect(result.surface.restored).toBe(true)
        expect(result.surface.descriptor).toBe(bound.descriptor)
      }
    })

    it('an UNBOUND composed surface (no bindings/descriptor) restores verbatim, NOT marked restored', () => {
      // A static generated UI carries its data in the spec/seed — no re-fetch needed, so
      // it must NOT be flagged `restored` (that would fire a needless refresh with no
      // descriptor/bindings). The exact snapshot reference is preserved (the original guard).
      const result = backNavTarget({ kind: 'composed', surface })
      expect(result.kind).toBe('restore-surface')
      if (result.kind === 'restore-surface') {
        expect(result.surface).toBe(surface)
        expect(result.surface.restored).toBeUndefined()
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
