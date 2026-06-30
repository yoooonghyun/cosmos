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

/**
 * One open tab's non-secret identity + display label (FR-007/FR-011).
 *
 * cosmos-favorite-live-panel-portal-v1: a generative-panel favorite now renders the LIVE source panel
 * itself (reparented via the panel-host portal), NOT a re-projected A2UI surface — so the published
 * tab is LABEL-ONLY for those four panels (no `surface`/`mirrorSurface`). The TERMINAL favorite keeps
 * its xterm-multiplex `serialize` accessor (below). GONE detection for a favorite is "the panel has
 * no tab with the pinned id" (the registry existence check), not "no published surface".
 */
export interface LivePanelTab {
  id: string
  label: string
  /**
   * This tab's per-tab "cosmos" glyph id (cosmos-random-tab-icons-v1, FR-012): a renderer-only
   * NON-SECRET reference (a bounded enum string from the 14-icon set) carried so the Cosmos tree's
   * leaf row resolves the SAME glyph as the panel strip. Like {@link serialize}, it is a renderer
   * ref pass on the in-process `PanelTabsProvider` — NEVER persisted or sent over IPC on this path
   * (the persisted copy is the per-tab snapshot's `iconId`). Absent ⇒ the tree falls back to
   * `AppWindow`.
   */
  iconId?: string
  /**
   * A TERMINAL pane's live scrollback accessor (cosmos-terminal-favorite-multiplex-v1, FR-009): a
   * renderer-only REFERENCE that returns the source xterm's current serialized buffer. A Home
   * terminal favorite calls it ONCE on mount to seed its mirror xterm (`initialScrollback`) so it
   * shows real history, not a blank screen, before attaching to the shared `pty:data` stream.
   *
   * Present ONLY while the pane's PTY is live (an awaiting/`[Open a folder]` pane omits it ⇒ the
   * favorite shows WAITING); terminal liveness is therefore encoded by PRESENCE of `serialize`, so
   * no separate `live` flag is needed. Only terminal tabs ever set it; the four generative panels
   * never do.
   *
   * NON-SECRET by the SAME standard as the already-persisted session scrollback — it is on-screen
   * terminal output, the same whitelist as the label/id above. It is a renderer-only ref pass
   * ({@link PanelTabsProvider} is in-renderer, no IPC) and is NEVER persisted or sent over IPC by
   * this seam (favorites persist by reference only — `{panelId, tabId, label}`).
   */
  serialize?: () => string
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
