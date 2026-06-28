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
} from '../../shared/ipc'
import type { GenerativeTab } from '../useGenerativePanelTabs'
import { seedEverOpenedFrom } from '../panelTabs'

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
  /**
   * The restored open-files slice for this tab (persist-workdir-open-files-v1,
   * FR-004), surfaced by `hydrateTerminalTabs` so `useFileExplorer` can seed its
   * open-files collection on go-live instead of starting empty. Absent for a freshly
   * minted tab or a tab that had no files open.
   */
  openFiles?: { files: string[]; activeRelPath: string | null }
}

/** A pane's open-files slice (the renderer-side shape mirroring the persisted field). */
export interface OpenFilesSlice {
  files: string[]
  activeRelPath: string | null
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
  /**
   * The file-explorer's open files for this pane (persist-workdir-open-files-v1,
   * FR-003/FR-006). Renderer-KNOWN (the explorer owns the open-file set), so it is
   * carried on the draft directly — main does not enrich it. Root-relative paths
   * only; no file contents. Attached only when non-empty.
   */
  openFiles?: { files: string[]; activeRelPath: string | null }
}

/** The renderer-emitted terminal panel draft (pre-enrichment). */
export interface TerminalPanelDraft {
  tabs: TerminalTabDraft[]
  activeTabId: string | null
  everOpened: number
}

/**
 * Build the terminal panel DRAFT from live tabs + a paneId→scrollback map and a
 * paneId→open-files map (FR-008/FR-021; persist-workdir-open-files-v1 FR-003).
 * `everOpened` is passed through verbatim (the live monotonic counter). Scrollback
 * is attached only when present for that pane; `openFiles` is attached only when the
 * pane has ≥1 open file (an empty collection is omitted, so the field stays absent —
 * matching the "no files open" restore default).
 */
export function buildTerminalDraft(
  state: LiveTabsState<LiveTerminalTab>,
  everOpened: number,
  scrollbackByPane: Map<string, string> | Record<string, string>,
  openFilesByPane?: Map<string, OpenFilesSlice> | Record<string, OpenFilesSlice>
): TerminalPanelDraft {
  const get = (id: string): string | undefined =>
    scrollbackByPane instanceof Map ? scrollbackByPane.get(id) : scrollbackByPane[id]
  const getOpen = (id: string): OpenFilesSlice | undefined =>
    openFilesByPane === undefined
      ? undefined
      : openFilesByPane instanceof Map
        ? openFilesByPane.get(id)
        : openFilesByPane[id]
  return {
    tabs: state.tabs.map((t) => {
      const draft: TerminalTabDraft = { id: t.id, label: t.label }
      if (t.renamed === true) draft.renamed = true
      const sb = get(t.id)
      if (typeof sb === 'string' && sb.length > 0) draft.scrollback = sb
      const open = getOpen(t.id)
      if (open && Array.isArray(open.files) && open.files.length > 0) {
        draft.openFiles = { files: open.files, activeRelPath: open.activeRelPath }
      }
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
  // calendar-selection-persistence: persist THIS tab's Google Calendar hidden-set (a
  // non-secret list of deselected calendar ids). Additive + OPTIONAL — attached only when
  // non-empty (an empty/absent set restores as "every calendar shown"). Persisted
  // independent of `composed` so a LIVE default-view tab (composed:false) keeps its
  // selection across a restart. Only google-calendar tabs ever set it.
  if (Array.isArray(tab.hiddenCalendars) && tab.hiddenCalendars.length > 0) {
    snap.hiddenCalendars = [...tab.hiddenCalendars]
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
    // calendar-selection-persistence: restore THIS tab's Google Calendar hidden-set so the
    // panel seeds its per-tab visibility from it (independent of `composed`; main already
    // normalized it — string entries only, deduped). Absent ⇒ left undefined (every
    // calendar shown). Only google-calendar tabs ever carry one.
    if (Array.isArray(t.hiddenCalendars) && t.hiddenCalendars.length > 0) {
      tab.hiddenCalendars = [...t.hiddenCalendars]
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
    // persist-workdir-open-files-v1 FR-004: surface the restored open-files slice so the
    // tab's file explorer seeds from it on go-live. Main already normalized it (string
    // entries only, active nulled if it left the set), so it is carried through as-is.
    if (t.openFiles && Array.isArray(t.openFiles.files) && t.openFiles.files.length > 0) {
      tab.openFiles = { files: t.openFiles.files, activeRelPath: t.openFiles.activeRelPath }
    }
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
