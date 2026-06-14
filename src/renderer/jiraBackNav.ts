/**
 * jiraBackNav — pure, framework-free back-navigation decision for the Jira panel's
 * "← Back to list" affordance (bug jira-detail-back-loses-generated-ui-v1).
 *
 * A ticket detail opened in a Jira tab is a temporary overlay over whatever list the
 * tab was showing. "Back" must return to that originating list. There are three
 * origins:
 *   - `default` — the my-tickets default board → re-run the default-view read.
 *   - `search`  — a JQL search result → re-run that search read.
 *   - `composed` — a generated-UI (`composed`) surface that was PINNED in the tab. The
 *     detail-open overwrote the tab's surface with the detail frame, so the generated
 *     UI must be RESTORED from a snapshot taken at detail-open time (no read — the
 *     surface is restored verbatim and re-marked `composed`).
 *
 * This module is intentionally React-free and DOM-free so it can be unit-tested in
 * vitest's node env (no jsdom) — the CLAUDE.md convention ("keep testable logic in a
 * plain `.ts`, never import a `.tsx` from a `.test.ts`"). `JiraPanel.tsx` holds the
 * origin in a ref and dispatches on `backNavTarget`'s result.
 */

import type { TabSurface } from './useGenerativePanelTabs'

/**
 * Where a detail was opened from — the back-nav origin tracked per active tab.
 *   - `default`  — the default board.
 *   - `search`   — a JQL search (carries the raw `jql` so back re-runs it).
 *   - `composed` — a pinned generated-UI surface (carries the `surface` snapshot
 *     captured at detail-open time so back can restore it without a read).
 */
export type JiraBackOrigin =
  | { kind: 'default' }
  | { kind: 'search'; jql: string }
  | { kind: 'composed'; surface: TabSurface }

/**
 * The action "Back to list" should take for a given origin:
 *   - `restore-surface` — re-file the snapshotted generated-UI surface into the tab
 *     (no read); the panel restores `surface` + `composed: true` and shows the list.
 *   - `read-search` — re-run the JQL search read for `jql`.
 *   - `read-default` — re-run the default-view read.
 */
export type JiraBackTarget =
  | { kind: 'restore-surface'; surface: TabSurface }
  | { kind: 'read-search'; jql: string }
  | { kind: 'read-default' }

/**
 * Decide what "← Back to list" should do given the detail's origin. Pure; total over
 * the origin union. A `composed` origin with a valid snapshot restores it; everything
 * else (default, search, or a malformed composed origin missing its snapshot) falls
 * back to the existing read behavior — never throws.
 *
 * jira-refreshable-detail-nav-crash-and-empty-v1 (Defect B): a REFRESHABLE generated UI
 * (a kanban with `bindings`, or a single-region `descriptor`) keeps its row data only in
 * the live A2UI SDK state — the seed is pushed via a separate `updateDataModel`, NEVER
 * stored on `surface.dataModel`, and the per-region refreshes repaint live. The detail
 * overlay clears that SDK state, so restoring the snapshot SPEC alone repaints an EMPTY
 * board ("No issue found"). So when the snapshot is a bound surface, restore it marked
 * `restored: true`: ActiveTabSurface's existing restore-refresh effect then re-registers
 * every region in main (idempotent) and re-fetches, repopulating the board (the user's
 * "re-run the refresh on Back" option). An UNBOUND composed surface (no bindings/
 * descriptor) carries its own data in the spec/seed, so it is restored verbatim.
 */
export function backNavTarget(origin: JiraBackOrigin): JiraBackTarget {
  if (origin.kind === 'composed') {
    // Safe fallback: a composed origin must carry a snapshot to restore. If it is
    // missing (malformed state), degrade to the default-view read rather than throw.
    if (origin.surface) {
      const isBound = !!(origin.surface.bindings || origin.surface.descriptor)
      const surface = isBound
        ? { ...origin.surface, restored: true }
        : origin.surface
      return { kind: 'restore-surface', surface }
    }
    return { kind: 'read-default' }
  }
  if (origin.kind === 'search') {
    return { kind: 'read-search', jql: origin.jql }
  }
  return { kind: 'read-default' }
}
