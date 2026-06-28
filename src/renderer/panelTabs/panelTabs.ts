/**
 * panelTabs — the shared, NON-SECRET shape of the live cross-panel tab read
 * (cosmos-panel-tab-list-v1, FR-009/FR-010/FR-011).
 *
 * The Cosmos panel surveys the open tabs of every OTHER panel (the four generative panels +
 * Terminal) without reaching into their internals: each panel PUBLISHES its current tab list into
 * the App-root {@link PanelTabsProvider}; the Cosmos tree subscribes + re-reads on every publish.
 * This module holds only the pure data contract so it is framework-free + node-testable (the
 * `.ts`/`.test.ts` split). The provider + hooks live in `PanelTabsProvider.tsx`; the pure grouping
 * lives in `panelTabsTree.ts`.
 *
 * SECURITY (FR-011): every field here is a non-secret display/identity value already on screen — a
 * panel id, a tab id, a tab label, the active flag. It NEVER carries a token, OAuth secret,
 * credential, file path, `~/.claude` location, transcript line, or any dock secret — the same
 * whitelist that governs `ViewContext`/`PromptContext`.
 */

import type { SurfaceId } from '../app/railVisibility'

/**
 * The panels the Cosmos tree lists — every rail surface EXCEPT the Cosmos panel itself (it never
 * shows its own tabs in its own tree, FR-005). Equals
 * `'terminal' | 'slack' | 'jira' | 'confluence' | 'google-calendar'`.
 */
export type CrossPanelId = Exclude<SurfaceId, 'cosmos'>

/** One open tab's non-secret identity + display label (FR-007/FR-011). */
export interface LivePanelTab {
  id: string
  label: string
}

/** One panel's FULL live tab list + which tab is active (FR-008). */
export interface LivePanelTabs {
  tabs: LivePanelTab[]
  /** The active tab's id, or `null` when the panel has no active tab. */
  activeTabId: string | null
}

/**
 * The published registry: a panel that has published appears with its {@link LivePanelTabs}; a
 * panel that has not published (unmounted / disabled / not in the rail) is ABSENT (FR-006). A
 * `null` value is treated the same as absent (a panel clearing its entry on unmount).
 */
export type PanelTabsRegistry = Partial<Record<CrossPanelId, LivePanelTabs | null>>
