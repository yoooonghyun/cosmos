/**
 * Pure session-snapshot helpers (session-persistence-v1, main side).
 *
 * No Electron / fs / IPC imports — just the shape contract (`src/shared/ipc.ts`)
 * plus the validation, empty-session, and reconciliation logic the SessionStore
 * and main IPC boundary build on. Kept node-testable (.ts, not .tsx) so the rules
 * below are exercised without spinning up Electron.
 *
 * Spec trace: FR-002 (schema version → unknown is unreadable), FR-004/FR-005
 * (validate inbound; corrupt/wrong-version → clean empty session), FR-006 (no
 * secrets — the validator strips to the known non-secret shape), FR-008..FR-015
 * (per-tab structure; only composed:true surfaces survive), FR-010/FR-011
 * (monotonic everOpened + ≥1 terminal tab reconciliation).
 */

import {
  SESSION_SCHEMA_VERSION,
  type A2uiSurfaceUpdate,
  type GenerativePanelKey,
  type GenerativePanelSnapshot,
  type GenerativeTabSnapshot,
  type SessionSnapshot,
  type TerminalPanelSnapshot,
  type TerminalTabSnapshot
} from '../shared/ipc'
import { validateAdapterBindings, validateAdapterDescriptor } from '../shared/validate'

/** Optional structured warning sink (defaults to console.warn) — mirrors validate.ts. */
export type WarnFn = (message: string, ...rest: unknown[]) => void
const defaultWarn: WarnFn = (message, ...rest) => console.warn(message, ...rest)

const GENERATIVE_KEYS: GenerativePanelKey[] = ['generated-ui', 'jira', 'slack', 'confluence']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A clean, empty per-generative-panel snapshot (zero tabs — FR-011). */
export function emptyGenerativePanel(): GenerativePanelSnapshot {
  return { tabs: [], activeTabId: null, everOpened: 0 }
}

/** A clean, empty terminal-panel snapshot (zero tabs; renderer seeds the default tab — FR-005/FR-011). */
export function emptyTerminalPanel(): TerminalPanelSnapshot {
  return { tabs: [], activeTabId: null, everOpened: 0 }
}

/** A clean, empty session snapshot — the FR-005 fallback when no/bad snapshot exists. */
export function emptySnapshot(): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: emptyTerminalPanel(),
      'generated-ui': emptyGenerativePanel(),
      jira: emptyGenerativePanel(),
      slack: emptyGenerativePanel(),
      confluence: emptyGenerativePanel()
    }
  }
}

/**
 * Validate ONE terminal tab. Required: non-empty id, sessionId, cwd (FR-019); a
 * string label (defaulted if missing). Optional: renamed (bool), scrollback
 * (string). Returns null + warns on a required-field violation (FR-004).
 */
function validateTerminalTab(value: unknown, warn: WarnFn): TerminalTabSnapshot | null {
  if (!isObject(value)) {
    warn('[session] terminal tab is not an object; dropping')
    return null
  }
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.sessionId) || !isNonEmptyString(value.cwd)) {
    warn('[session] terminal tab missing required id/sessionId/cwd; dropping')
    return null
  }
  const tab: TerminalTabSnapshot = {
    id: value.id,
    label: isNonEmptyString(value.label) ? value.label : value.id,
    sessionId: value.sessionId,
    cwd: value.cwd
  }
  if (value.renamed === true) tab.renamed = true
  if (typeof value.scrollback === 'string') tab.scrollback = value.scrollback
  return tab
}

/**
 * Validate ONE generative tab. Required: non-empty id (FR-008). A `surface` is
 * accepted ONLY when `composed === true` AND it carries a `spec` object (FR-012);
 * anything else is stripped to a base tab (FR-015). Transient run fields are never
 * read (FR-014).
 */
function validateGenerativeTab(value: unknown, warn: WarnFn): GenerativeTabSnapshot | null {
  if (!isObject(value)) {
    warn('[session] generative tab is not an object; dropping')
    return null
  }
  if (!isNonEmptyString(value.id)) {
    warn('[session] generative tab missing required id; dropping')
    return null
  }
  const tab: GenerativeTabSnapshot = {
    id: value.id,
    label: isNonEmptyString(value.label) ? value.label : value.id,
    untitled: value.untitled === true
  }
  if (value.renamed === true) tab.renamed = true
  // Only a composed surface with a real spec object survives (FR-012/FR-015).
  if (value.composed === true && isObject(value.surface) && isObject(value.surface.spec)) {
    tab.composed = true
    tab.surface = { spec: value.surface.spec as unknown as A2uiSurfaceUpdate }
    // jira-generative-adapter-v1 (FR-006/FR-007): a bound surface persists its
    // SECRET-FREE adapter descriptor beside the spec so restore can re-execute it.
    // `validateAdapterDescriptor` strips any secret-looking query key + drops a
    // malformed descriptor (warn + omit), so a bad descriptor never blocks the tab.
    if (value.descriptor !== undefined) {
      const descriptor = validateAdapterDescriptor(value.descriptor, warn)
      if (descriptor) {
        tab.descriptor = descriptor
      }
    }
    // refreshable-custom-generative-ui (multi-region): a PARTITIONED surface persists its
    // per-container bindings instead. `validateAdapterBindings` secret-strips each descriptor
    // and drops malformed entries (warn), so a bad binding never blocks the tab.
    if (value.bindings !== undefined) {
      const bindings = validateAdapterBindings(value.bindings, warn)
      if (bindings) {
        tab.bindings = bindings
      }
    }
  }
  return tab
}

/** Validate a generative panel's snapshot, dropping any invalid tab. */
function validateGenerativePanel(value: unknown, warn: WarnFn): GenerativePanelSnapshot {
  if (!isObject(value)) {
    return emptyGenerativePanel()
  }
  const rawTabs = Array.isArray(value.tabs) ? value.tabs : []
  const tabs: GenerativeTabSnapshot[] = []
  for (const raw of rawTabs) {
    const tab = validateGenerativeTab(raw, warn)
    if (tab) tabs.push(tab)
  }
  return reconcileGenerativePanel(tabs, value.activeTabId, value.everOpened)
}

/** Validate the terminal panel's snapshot, dropping any invalid tab. */
function validateTerminalPanel(value: unknown, warn: WarnFn): TerminalPanelSnapshot {
  if (!isObject(value)) {
    return emptyTerminalPanel()
  }
  const rawTabs = Array.isArray(value.tabs) ? value.tabs : []
  const tabs: TerminalTabSnapshot[] = []
  for (const raw of rawTabs) {
    const tab = validateTerminalTab(raw, warn)
    if (tab) tabs.push(tab)
  }
  return reconcileTerminalPanel(tabs, value.activeTabId, value.everOpened)
}

/**
 * Reconcile a generative panel's active id + everOpened against its surviving
 * tabs (FR-010/FR-011). `activeTabId` is kept only if it still names a present
 * tab (else first tab, or null when empty). `everOpened` is floored to the tab
 * count so the monotonic new-tab index never collides (FR-010).
 */
export function reconcileGenerativePanel(
  tabs: GenerativeTabSnapshot[],
  rawActiveTabId: unknown,
  rawEverOpened: unknown
): GenerativePanelSnapshot {
  const ids = new Set(tabs.map((t) => t.id))
  const activeTabId =
    isNonEmptyString(rawActiveTabId) && ids.has(rawActiveTabId)
      ? rawActiveTabId
      : tabs.length > 0
        ? tabs[0].id
        : null
  const everOpened = reconcileEverOpened(rawEverOpened, tabs.length)
  return { tabs, activeTabId, everOpened }
}

/** As `reconcileGenerativePanel`, for the terminal panel. Terminal keeps zero tabs here; the renderer seeds the default tab on restore (FR-011). */
export function reconcileTerminalPanel(
  tabs: TerminalTabSnapshot[],
  rawActiveTabId: unknown,
  rawEverOpened: unknown
): TerminalPanelSnapshot {
  const ids = new Set(tabs.map((t) => t.id))
  const activeTabId =
    isNonEmptyString(rawActiveTabId) && ids.has(rawActiveTabId)
      ? rawActiveTabId
      : tabs.length > 0
        ? tabs[0].id
        : null
  const everOpened = reconcileEverOpened(rawEverOpened, tabs.length)
  return { tabs, activeTabId, everOpened }
}

/**
 * Floor a persisted `everOpened` to at least the surviving tab count and a
 * non-negative integer (FR-010). A missing/garbage value becomes the tab count.
 */
export function reconcileEverOpened(rawEverOpened: unknown, tabCount: number): number {
  const n = isFiniteNumber(rawEverOpened) ? Math.floor(rawEverOpened) : 0
  return Math.max(tabCount, n < 0 ? 0 : n)
}

/**
 * Validate + normalize a whole inbound snapshot (FR-002/FR-004/FR-005).
 *
 * Returns a normalized `SessionSnapshot` on a readable, version-matching payload,
 * or `null` (with a warning) when the value is not an object or the schemaVersion
 * does not match SESSION_SCHEMA_VERSION. Individual bad tabs are dropped, never
 * fatal. The caller treats `null` as "ignore this save / fall back to empty".
 */
export function validateSnapshot(value: unknown, warn: WarnFn = defaultWarn): SessionSnapshot | null {
  if (!isObject(value)) {
    warn('[session] snapshot is not an object; ignoring')
    return null
  }
  if (value.schemaVersion !== SESSION_SCHEMA_VERSION) {
    warn(`[session] snapshot schemaVersion ${String(value.schemaVersion)} != ${SESSION_SCHEMA_VERSION}; ignoring`)
    return null
  }
  const panels = isObject(value.panels) ? value.panels : {}
  const generative = {} as Record<GenerativePanelKey, GenerativePanelSnapshot>
  for (const key of GENERATIVE_KEYS) {
    generative[key] = validateGenerativePanel(panels[key], warn)
  }
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: validateTerminalPanel(panels.terminal, warn),
      'generated-ui': generative['generated-ui'],
      jira: generative.jira,
      slack: generative.slack,
      confluence: generative.confluence
    }
  }
}
