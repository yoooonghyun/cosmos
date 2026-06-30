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
  validateFavorites,
  type A2uiSurfaceUpdate,
  type EnabledIntegrations,
  type GateableIntegration,
  type GenerativePanelKey,
  type GenerativePanelSnapshot,
  type GenerativeTabSnapshot,
  type SessionSnapshot,
  type TerminalPanelSnapshot,
  type TerminalTabSnapshot
} from '../../shared/ipc'
import { validateAdapterBindings, validateAdapterDescriptor } from '../../shared/validate'

/** Optional structured warning sink (defaults to console.warn) — mirrors validate.ts. */
export type WarnFn = (message: string, ...rest: unknown[]) => void
const defaultWarn: WarnFn = (message, ...rest) => console.warn(message, ...rest)

const GENERATIVE_KEYS: GenerativePanelKey[] = [
  'generated-ui',
  'jira',
  'slack',
  'confluence',
  'google-calendar'
]

/** The gateable integrations carrying an `enabled` rail-visibility flag (FR-003). */
const GATEABLE_KEYS: GateableIntegration[] = ['slack', 'jira', 'confluence', 'google-calendar']

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

/** First-run / fallback `enabled` map — every gateable integration disabled (FR-008). */
export function emptyEnabledIntegrations(): EnabledIntegrations {
  return { slack: false, jira: false, confluence: false, 'google-calendar': false }
}

/**
 * Normalize the inbound `enabled` map (settings-redesign-v1, FR-008/FR-016/FR-018).
 *
 * Each gateable key is read as a strict boolean; a missing key, a non-boolean value,
 * or a non-object map all normalize to `false` (disabled) — never crash, never an
 * `undefined` key. This is the in-version migration: a v7 snapshot whose `enabled`
 * map is absent/partial/malformed is repaired to a complete all-default-false map.
 */
function validateEnabled(value: unknown): EnabledIntegrations {
  const out = emptyEnabledIntegrations()
  if (!isObject(value)) {
    return out
  }
  for (const key of GATEABLE_KEYS) {
    out[key] = value[key] === true
  }
  return out
}

/**
 * Normalize the inbound `hiddenCalendars` list (calendar-selection-persistence). The
 * Google Calendar legend's deselected calendar ids. Defensive + total: a non-array, or
 * any non-string / empty entry, is dropped; duplicates are collapsed. An absent/malformed
 * value yields `[]` (the safe default — every calendar shown). This is the in-version
 * migration for a present-but-malformed field within v9.
 */
function validateHiddenCalendars(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  for (const entry of value) {
    if (isNonEmptyString(entry)) {
      seen.add(entry)
    }
  }
  return [...seen]
}

/**
 * Normalize the inbound `openPromptPosition` (draggable-open-prompt-button-v1,
 * FR-008/FR-009). The persisted Open-Prompt button position is a normalized fraction
 * `{ xFrac, yFrac }` in `[0,1]`. A present, well-formed value has each component
 * CLAMPED into `[0,1]` (an out-of-range or off-screen-after-resize value never crashes
 * and never lands off-panel — FR-005/FR-012). A non-object, a missing / non-finite
 * component, or any other malformed value yields `undefined` ⇒ the field is omitted and
 * restore falls back to the centered-bottom default (FR-011). NON-SECRET: two numbers
 * only, never a token/path (FR-010).
 */
function validateOpenPromptPosition(value: unknown): { xFrac: number; yFrac: number } | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const { xFrac, yFrac } = value as { xFrac?: unknown; yFrac?: unknown }
  if (typeof xFrac !== 'number' || !Number.isFinite(xFrac)) {
    return undefined
  }
  if (typeof yFrac !== 'number' || !Number.isFinite(yFrac)) {
    return undefined
  }
  const clamp = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
  return { xFrac: clamp(xFrac), yFrac: clamp(yFrac) }
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
      confluence: emptyGenerativePanel(),
      'google-calendar': emptyGenerativePanel()
    },
    enabled: emptyEnabledIntegrations()
  }
}

/**
 * Normalize ONE terminal tab's optional `openFiles` slice (persist-workdir-open-files-v1,
 * FR-009/FR-012). Additive at the boundary: returns the cleaned `{ files, activeRelPath }`
 * — keeping only non-empty, de-duplicated string paths, and an `activeRelPath` that names
 * a surviving path (else `null`) — or `undefined` when the field is absent/malformed or
 * nothing valid survives (so the tab restores with no open files, the safe default).
 * NEVER throws; a present-but-garbage value degrades to `undefined`.
 */
function validateOpenFiles(
  value: unknown
): { files: string[]; activeRelPath: string | null } | undefined {
  if (!isObject(value) || !Array.isArray(value.files)) {
    return undefined
  }
  const seen = new Set<string>()
  const files: string[] = []
  for (const relPath of value.files) {
    if (isNonEmptyString(relPath) && !seen.has(relPath)) {
      seen.add(relPath)
      files.push(relPath)
    }
  }
  if (files.length === 0) {
    return undefined
  }
  const activeRelPath =
    isNonEmptyString(value.activeRelPath) && seen.has(value.activeRelPath)
      ? value.activeRelPath
      : null
  return { files, activeRelPath }
}

/**
 * Validate ONE terminal tab. Required: non-empty id, sessionId, cwd (FR-019); a
 * string label (defaulted if missing). Optional: renamed (bool), scrollback
 * (string), openFiles (normalized per-tab open-files slice). Returns null + warns on
 * a required-field violation (FR-004).
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
  // persist-workdir-open-files-v1 (FR-003/FR-009/FR-012): an absent/malformed slice
  // normalizes to undefined (omitted) — additive, never affecting required fields.
  const openFiles = validateOpenFiles(value.openFiles)
  if (openFiles) tab.openFiles = openFiles
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
  // calendar-selection-persistence: the PER-TAB Google Calendar hidden-set. Purely additive
  // + OPTIONAL (mirrors openFiles on validateTerminalTab) — an absent/malformed value
  // normalizes to [] (the field is omitted when empty), so an older snapshot lacking it
  // restores cleanly with no version bump. Reuses validateHiddenCalendars (drops
  // non-string/empty entries, dedupes). Only google-calendar tabs ever carry one.
  const hiddenCalendars = validateHiddenCalendars(value.hiddenCalendars)
  if (hiddenCalendars.length > 0) {
    tab.hiddenCalendars = hiddenCalendars
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
  // draggable-open-prompt-button-v1 (FR-008): additive OPTIONAL global field. Set only
  // when present + well-formed; absent/malformed ⇒ omit so restore uses the default.
  const openPromptPosition = validateOpenPromptPosition(value.openPromptPosition)
  // cosmos-home-favorite-tabs-v1 (FR-030/FR-033): additive OPTIONAL top-level field (NO schema
  // bump — mirrors openPromptPosition). The shared pure validator drops malformed/secret-shaped
  // entries + rebuilds each to the {panelId,tabId,label} whitelist; omit when there are none.
  const favorites = validateFavorites(value.favorites, (m) => warn(m))
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: validateTerminalPanel(panels.terminal, warn),
      'generated-ui': generative['generated-ui'],
      jira: generative.jira,
      slack: generative.slack,
      confluence: generative.confluence,
      'google-calendar': generative['google-calendar']
    },
    enabled: validateEnabled(value.enabled),
    ...(openPromptPosition ? { openPromptPosition } : {}),
    ...(favorites.length ? { favorites } : {})
  }
}
