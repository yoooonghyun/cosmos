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
import type { TabSurface } from '../tabs/useGenerativePanelTabs'

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
  /**
   * The tab's CURRENT live A2UI surface (cosmos-home-favorite-tabs-v1): the same {@link TabSurface}
   * the source panel renders — spec + live requestId + descriptor/bindings/dataModel. Carried so a
   * Home FAVORITE can mirror this tab's surface through the SAME `ActiveTabSurface` host, sharing the
   * live `requestId`/`surfaceId` (a true live mirror, not a snapshot).
   *
   * NON-SECRET by the A2UI render contract — the SAME whitelist as the label/id above (never a
   * token, OAuth secret, credential, file path, `~/.claude` location, or transcript line). It is a
   * renderer-only REFERENCE pass: {@link PanelTabsProvider} is in-renderer (no IPC), so carrying it
   * is cheap, and it is NEVER persisted or sent over IPC by this seam (favorites persist by
   * reference only — `{panelId, tabId, label}` — and re-acquire the live surface on restore).
   *
   * Absent/`null` for a tab with no surface yet (untitled / in-flight source) and for terminal tabs
   * (a PTY tab has no A2UI surface to mirror).
   */
  surface?: TabSurface | null
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
  /**
   * The favorite-only NATIVE-VIEW mirror surface (cosmos-native-view-mirror-surface-v1, FR-001):
   * a native-first panel (Confluence, Slack) publishes a secret-free bound {@link TabSurface}
   * projecting its CURRENT native view (feed/search/page; channel-list/history/search), DISTINCT
   * from {@link surface} (the agent-COMPOSED surface). A Home favorite resolves
   * `mirrorSurface ?? surface`, so it mirrors native browsing too — not only composed surfaces.
   *
   * MUTUALLY EXCLUSIVE with `surface` by construction (the publish projection nulls this whenever
   * `surface` is present — see `livePanelProjection`), so the favorite always shows exactly what
   * the source shows. `null`/absent while the source shows a composed surface, has no native data
   * yet (→ favorite WAITING), or for Jira/Generated-UI/terminal tabs (which never set it).
   *
   * NON-SECRET by the A2UI render contract (the builders' secret-free output — never a token,
   * OAuth secret, credential, file path, `~/.claude` location, or transcript line). Renderer-only
   * REFERENCE pass ({@link PanelTabsProvider} is in-renderer, no IPC); NEVER persisted (favorites
   * persist by reference only — `{panelId, tabId, label}`).
   */
  mirrorSurface?: TabSurface | null
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
