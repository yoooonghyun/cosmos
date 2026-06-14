/**
 * Pure renderer-side session-snapshot helpers (session-persistence-v1).
 *
 * React-free + DOM-free so it is unit-testable in vitest's node env (the catalog
 * convention: testable logic in a plain `.ts`, never imported from a `.test.ts`
 * as a `.tsx`). The hooks/components call these to BUILD the persisted shape from
 * live tab state and to HYDRATE live tab state from a restored snapshot.
 *
 * Two load-bearing rules live here:
 *  - STRIP (FR-014/FR-015): the build functions emit ONLY the persisted fields —
 *    transient run state (inFlight/loadingDefault/error) is dropped, and a
 *    generative tab's `surface` is kept ONLY when `composed === true`. A live
 *    integration-data view (composed:false) becomes a base tab with no surface, so
 *    it restores to base and re-fetches (it is not representable as a stored surface).
 *  - SEED (FR-010): `everOpened` is restored via `seedEverOpenedFrom` (re-exported
 *    from panelTabs) so the monotonic new-tab index never collides after restore.
 *
 * The MAIN-owned terminal `sessionId`/`cwd` are NOT known to the renderer (D2 —
 * main owns the paneId→session map), so the terminal build emits a DRAFT carrying
 * only renderer-known fields (id/label/renamed/scrollback); main enriches each tab
 * with its sessionId/cwd at the save boundary.
 */

import type {
  GenerativePanelSnapshot,
  GenerativeTabSnapshot,
  TerminalPanelSnapshot
} from '../shared/ipc'
import type { GenerativeTab } from './useGenerativePanelTabs'
import { seedEverOpenedFrom } from './panelTabs'

export { seedEverOpenedFrom }

/** The live shape `usePanelTabs` holds: ordered records + active id. */
export interface LiveTabsState<T> {
  tabs: T[]
  activeTabId: string | null
}

/** A live terminal tab as the renderer knows it (TerminalPanel's record + scrollback). */
export interface LiveTerminalTab {
  id: string
  label: string
  renamed?: boolean
}

/**
 * The renderer-emitted terminal tab draft (session-persistence-v1, D2). Carries
 * only renderer-known fields; main fills sessionId/cwd from its paneId→session map
 * at the save boundary before persisting (the contract's TerminalTabSnapshot).
 */
export interface TerminalTabDraft {
  id: string
  label: string
  renamed?: boolean
  /** Bounded serialized scrollback captured in the renderer (FR-021). */
  scrollback?: string
}

/** The renderer-emitted terminal panel draft (pre-enrichment). */
export interface TerminalPanelDraft {
  tabs: TerminalTabDraft[]
  activeTabId: string | null
  everOpened: number
}

/**
 * Build the terminal panel DRAFT from live tabs + a paneId→scrollback map
 * (FR-008/FR-021). `everOpened` is passed through verbatim (the live monotonic
 * counter). Scrollback is attached only when present for that pane.
 */
export function buildTerminalDraft(
  state: LiveTabsState<LiveTerminalTab>,
  everOpened: number,
  scrollbackByPane: Map<string, string> | Record<string, string>
): TerminalPanelDraft {
  const get = (id: string): string | undefined =>
    scrollbackByPane instanceof Map ? scrollbackByPane.get(id) : scrollbackByPane[id]
  return {
    tabs: state.tabs.map((t) => {
      const draft: TerminalTabDraft = { id: t.id, label: t.label }
      if (t.renamed === true) draft.renamed = true
      const sb = get(t.id)
      if (typeof sb === 'string' && sb.length > 0) draft.scrollback = sb
      return draft
    }),
    activeTabId: state.activeTabId,
    everOpened
  }
}

/**
 * Build ONE generative tab's persisted record from its live record
 * (FR-012/FR-014/FR-015). Drops transient fields; keeps `surface.spec` ONLY for a
 * composed tab. A live-data view (composed !== true) becomes a base tab (no surface),
 * so it restores to base and re-fetches.
 */
export function buildGenerativeTab(tab: GenerativeTab): GenerativeTabSnapshot {
  const snap: GenerativeTabSnapshot = {
    id: tab.id,
    label: tab.label,
    untitled: tab.untitled === true
  }
  if (tab.renamed === true) snap.renamed = true
  if (tab.composed === true && tab.surface && !tab.surface.error) {
    snap.composed = true
    snap.surface = { spec: tab.surface.spec }
    // jira-generative-adapter-v1 (FR-006): persist the bound surface's secret-free
    // descriptor beside its spec so restore can re-execute it for fresh data. Only a
    // bound surface carries one; main re-validates (+ strips secrets) at load.
    if (tab.descriptor) snap.descriptor = tab.descriptor
    // multi-region: a partitioned surface persists its per-container bindings instead.
    if (tab.bindings) snap.bindings = tab.bindings
  }
  return snap
}

/**
 * Build a generative panel's persisted snapshot from live tabs + the monotonic
 * `everOpened` (FR-008/FR-011/FR-012). A zero-tab panel stays zero-tab.
 */
export function buildGenerativePanel(
  state: LiveTabsState<GenerativeTab>,
  everOpened: number
): GenerativePanelSnapshot {
  return {
    tabs: state.tabs.map(buildGenerativeTab),
    activeTabId: state.activeTabId,
    everOpened
  }
}

/**
 * Hydrate live generative tab records from a restored panel snapshot
 * (FR-008/FR-009/FR-012/FR-013). Each composed surface is re-instated with a
 * FRESH requestId (FR-013) — the old correlation id is never restored, since the
 * underlying blocking call (if any) is gone. Transient fields default to idle.
 * A snapshot tab with no stored surface hydrates to a base tab (surface: null).
 */
export function hydrateGenerativeTabs(
  panel: GenerativePanelSnapshot | undefined,
  mintRequestId: () => string
): LiveTabsState<GenerativeTab> {
  if (!panel || !Array.isArray(panel.tabs)) {
    return { tabs: [], activeTabId: null }
  }
  const tabs: GenerativeTab[] = panel.tabs.map((t) => {
    const tab: GenerativeTab = {
      id: t.id,
      label: t.label,
      untitled: t.untitled === true,
      surface: null,
      inFlight: false
    }
    if (t.renamed === true) tab.renamed = true
    if (t.composed === true && t.surface && t.surface.spec) {
      tab.composed = true
      tab.surface = { requestId: mintRequestId(), spec: t.surface.spec }
      // jira-generative-adapter-v1 (FR-006/FR-013): restore the bound descriptor so a
      // re-activation/refresh re-executes it. Main already stripped/validated it. It is
      // carried on BOTH the tab (for persistence round-trips) and the rendered surface
      // (so ActiveTabSurface fires the restore refresh that lazily re-registers it).
      if (t.descriptor) {
        tab.descriptor = t.descriptor
        // FR-013: a RESTORED bound surface — its seed is stale (no live data model was
        // pushed). Mark it so ActiveTabSurface fires the descriptor-bearing refresh that
        // re-registers it in main + re-fetches. (A freshly composed surface is omitted.)
        tab.surface.descriptor = t.descriptor
        tab.surface.restored = true
      }
      // multi-region: a partitioned surface restores its bindings instead; the restore
      // refresh re-registers EVERY region in main and fans out a fetch to each.
      if (t.bindings) {
        tab.bindings = t.bindings
        tab.surface.bindings = t.bindings
        tab.surface.restored = true
      }
    }
    return tab
  })
  const ids = new Set(tabs.map((t) => t.id))
  const activeTabId =
    panel.activeTabId && ids.has(panel.activeTabId)
      ? panel.activeTabId
      : tabs.length > 0
        ? tabs[0].id
        : null
  return { tabs, activeTabId }
}

/**
 * Hydrate live terminal tab records from a restored terminal snapshot
 * (FR-008/FR-009/FR-011). Returns the live tab records (id/label/renamed) plus the
 * active id; sessionId/cwd/scrollback are consumed elsewhere (the per-pane resume +
 * scrollback pre-write). When the snapshot has zero tabs, the caller seeds the
 * default terminal (FR-011) — this returns an empty state in that case.
 */
export function hydrateTerminalTabs(
  panel: TerminalPanelSnapshot | undefined
): LiveTabsState<LiveTerminalTab> {
  if (!panel || !Array.isArray(panel.tabs) || panel.tabs.length === 0) {
    return { tabs: [], activeTabId: null }
  }
  const tabs: LiveTerminalTab[] = panel.tabs.map((t) => {
    const tab: LiveTerminalTab = { id: t.id, label: t.label }
    if (t.renamed === true) tab.renamed = true
    return tab
  })
  const ids = new Set(tabs.map((t) => t.id))
  const activeTabId =
    panel.activeTabId && ids.has(panel.activeTabId) ? panel.activeTabId : tabs[0].id
  return { tabs, activeTabId }
}

/**
 * Cap a serialized scrollback string to the most-recent `maxBytes` UTF-8 bytes
 * (D5 — ~256KB; trim older). Returns the input unchanged when already within the
 * cap. Trims on a UTF-8 boundary (decodes the tail back to a valid string), so a
 * multibyte char is never split. A non-string degrades to '' (safe fallback).
 */
export function capScrollback(serialized: string, maxBytes = 256 * 1024): string {
  if (typeof serialized !== 'string') return ''
  const bytes = new TextEncoder().encode(serialized)
  if (bytes.length <= maxBytes) return serialized
  const tail = bytes.subarray(bytes.length - maxBytes)
  // `fatal: false` replaces a leading partial code unit rather than throwing.
  return new TextDecoder('utf-8', { fatal: false }).decode(tail)
}
