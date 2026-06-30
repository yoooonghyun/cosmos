/**
 * Session persistence — on-disk working-session snapshot IPC surface.
 * Spec: .sdd/specs/session-persistence-v1.md. Re-exported (unchanged) through the
 * `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type { AdapterBinding, AdapterDescriptor } from '../types/adapter'
import type { A2uiSurfaceUpdate } from './ui'

/**
 * Session IPC channel name constants (session-persistence-v1, FR-003).
 *
 * `Load` is request/response (`ipcRenderer.invoke`/`ipcMain.handle`) — read once
 * at startup. `Save` is fire-and-forget (`ipcRenderer.send`/`ipcMain.on`) — the
 * renderer pushes the debounced snapshot on change (FR-007). NO channel carries
 * a secret in either direction (FR-006): the snapshot is non-secret structure.
 */
export const SessionChannel = {
  /** R->M (invoke): read the persisted snapshot at startup; null when absent/corrupt. FR-001/FR-005. */
  Load: 'session:load',
  /** R->M (send): persist the latest snapshot (debounced on change). FR-001/FR-007. */
  Save: 'session:save'
} as const

export type SessionChannelName =
  (typeof SessionChannel)[keyof typeof SessionChannel]

/**
 * The current on-disk snapshot schema version (session-persistence-v1, FR-002).
 * Bump on any breaking shape change; main treats a non-matching version as
 * unreadable → warn + clean empty session (FR-002/FR-005).
 *
 * v3 (panel-refresh-v1): the meaning of a persisted bound surface changed. A
 * descriptor-bearing surface is now always a `{path}`-BOUND shell (OQ-5 main-composes),
 * never the agent's literal-prop spec. A pre-v3 snapshot can hold a literal-prop surface
 * paired with a descriptor; restored under the new code that combination enables the panel
 * refresh control yet cannot repaint (literal props ignore `updateDataModel`). Bumping
 * invalidates those stale snapshots so they fall back to a clean session instead.
 *
 * v4 (refreshable-custom-generative-ui-v1): the rule flipped again — a descriptor-bearing
 * persisted surface is now the AGENT's OWN custom spec, re-registered under the agent's OWN
 * `spec.surfaceId` on restore (NOT a generic shell). A v3 snapshot was written under the
 * shell-replacement rule, so its descriptor pairs with a shell spec whose surfaceId is the
 * shell's, not the agent's; restored under v4 it would be wrongly re-registered as the
 * agent's own bound layout. Bumping invalidates v3 → clean session (FR-013).
 *
 * v5 (refreshable-custom-generative-ui multi-region): a partitioned custom surface now
 * persists per-container {@link AdapterBinding}s ({@link GenerativeTabSnapshot.bindings})
 * instead of a single surface-wide descriptor, and its persisted spec is the REBOUND
 * (`{path}`, region-scoped) layout. A v4 snapshot has neither field nor the rebound spec, so
 * restoring it under v5's multi-region re-registration would mis-key regions. Bump → clean.
 *
 * v6 (google-calendar-v1): the snapshot's `panels` record gains a fixed
 * `'google-calendar'` key (a new generative panel). A v5 snapshot lacks it, so
 * restoring under v6 would leave the panel undefined; bump → clean session.
 *
 * v7 (settings-redesign-v1): the snapshot gains a top-level `enabled` map — the
 * per-integration rail-visibility preference (non-secret). A v6 snapshot lacks it;
 * restoring under v7 would leave `enabled` undefined. The bump invalidates v6 → a
 * clean session whose integrations all default to disabled (FR-008/FR-018). Within
 * v7, a present-but-partial/malformed `enabled` map is normalized at the boundary —
 * each missing/invalid key defaults to `false` (the migration; see validateSnapshot).
 *
 * v8 (persist-workdir-open-files-v1): each terminal tab gains an optional `openFiles`
 * slice — the ordered root-relative open-file paths + the active path (non-secret; no
 * absolute path/token, and NO file contents — restore re-reads each from disk). A v7
 * snapshot lacks it; restoring under v8 simply yields no restored open files for those
 * tabs (the safe default — the tab restores live on its cwd with an empty viewer strip).
 * The bump invalidates v7 → a clean session once. Within v8, a present-but-malformed
 * `openFiles` value is normalized at the boundary (non-string entries dropped, an active
 * path not naming a surviving open file nulled out; see validateTerminalTab). This change
 * composes ON TOP of v7's `enabled` migration — both fields coexist in a v8 snapshot.
 *
 * calendar-selection-persistence (NO version bump): the Google Calendar legend's
 * deselected (hidden) calendar ids are persisted PER generative TAB as the additive
 * OPTIONAL `GenerativeTabSnapshot.hiddenCalendars` string[] (non-secret email-like ids,
 * never tokens). Purely additive + OPTIONAL, so an older snapshot lacking it restores
 * cleanly (the field defaults to absent ⇒ []), exactly like `openFiles` was added to
 * `TerminalTabSnapshot` without a bump — a bump would needlessly invalidate every prior
 * snapshot and wipe the restored session. A present-but-malformed value is normalized at
 * the boundary (non-string / empty entries dropped, deduped; see validateHiddenCalendars).
 *
 * draggable-open-prompt-button-v1 (NO version bump): the collapsed Open-Prompt logo
 * button's user-chosen position is persisted as the additive OPTIONAL TOP-LEVEL
 * `SessionSnapshot.openPromptPosition` — a normalized fraction `{ xFrac, yFrac }` in
 * `[0,1]` of the panel content area (NON-SECRET; two numbers only, never a token/path).
 * It is GLOBAL (one value for every panel's button), so it lives at the top level, NOT
 * under `panels`. Purely additive + OPTIONAL: an older snapshot lacking it restores
 * cleanly (the field defaults to absent ⇒ the centered-bottom default), exactly like
 * `hiddenCalendars`/`openFiles` were added without a bump — a bump would needlessly
 * invalidate every prior snapshot and wipe the restored session. A present-but-malformed
 * value is normalized at the boundary (each component clamped to `[0,1]`, a non-object
 * or non-number treated as absent ⇒ default; see validateOpenPromptPosition).
 */
export const SESSION_SCHEMA_VERSION = 8

/**
 * One terminal tab's persisted state (FR-008/FR-018/FR-019/FR-021).
 *
 * The `id` IS the renderer-minted `paneId` that keys the live PTY session; on
 * relaunch the same id re-binds the tab to its resumed `claude` session. `sessionId`
 * is the MAIN-minted `claude --session-id <uuid>` used to `--resume` (D2/FR-019).
 * NO secret — this is process-session structure, not credentials (FR-006).
 */
export interface TerminalTabSnapshot {
  /** Renderer-minted paneId (the live PTY key). FR-008/FR-021. */
  id: string
  /** Tab label (default e.g. "Terminal 1" or a user rename). FR-008. */
  label: string
  /** True when the user renamed the tab, so the label is preserved verbatim. FR-009. */
  renamed?: boolean
  /** Main-minted `claude` session id used to `--resume` on relaunch. FR-019/FR-020. */
  sessionId: string
  /** The working directory the session was spawned in. FR-019. */
  cwd: string
  /** Bounded serialized scrollback, restored as on-screen history (≤~256KB). FR-021. */
  scrollback?: string
  /**
   * The file-explorer's persisted open files for this tab (persist-workdir-open-files-v1,
   * FR-003/FR-006). The ordered, root-RELATIVE open-file paths (`files`) plus which one is
   * active/focused (`activeRelPath`, or `null`). Absent when the tab had no files open
   * (the empty viewer strip restores). NO absolute path, filesystem root, or token — these
   * are the same non-secret relative identifiers the explorer already uses (FR-006); and
   * NO file CONTENTS — restore re-reads each path from disk via `fs:read` (FR-005). A
   * present-but-malformed value is normalized at the boundary (see validateTerminalTab).
   */
  openFiles?: { files: string[]; activeRelPath: string | null }
}

/**
 * The Terminal panel's persisted state (FR-008/FR-010/FR-011). Terminal always
 * restores ≥1 tab; an empty/absent collection is reconciled to a single default
 * tab at restore (FR-011).
 */
export interface TerminalPanelSnapshot {
  /** Ordered terminal tabs (FR-008). */
  tabs: TerminalTabSnapshot[]
  /** The active tab's id, or null. FR-008. */
  activeTabId: string | null
  /** Monotonic "ever opened" counter, restored so new tab indices never collide. FR-010. */
  everOpened: number
}

/**
 * One generative-panel tab's persisted state (FR-008/FR-012/FR-013/FR-014/FR-015).
 *
 * ONLY a `composed: true` surface persists its `surface.spec` verbatim (FR-012);
 * a live integration-data view (`composed: false`) is structurally NOT representable
 * here — it carries no `surface`, so it restores to base and re-fetches (FR-015).
 * Transient run state (inFlight/loadingDefault/error) is intentionally ABSENT from
 * this shape (FR-014). NO secret (FR-006).
 */
export interface GenerativeTabSnapshot {
  /** Renderer tab id. FR-008. */
  id: string
  /** Tab label. FR-008. */
  label: string
  /** True for a never-composed "Untitled" tab. FR-008. */
  untitled: boolean
  /** True when the user renamed the tab. FR-009. */
  renamed?: boolean
  /**
   * The verbatim composed A2UI surface spec; present ONLY when `composed` is true.
   * Absent for a base/empty tab or a live-data view (FR-012/FR-015).
   */
  surface?: { spec: A2uiSurfaceUpdate }
  /**
   * Discriminates a restorable composed surface. ONLY ever `true` here — a
   * `composed: false` view is not persisted as a surface (FR-012/FR-015).
   */
  composed?: true
  /**
   * The bound surface's SECRET-FREE adapter descriptor, persisted BESIDE the view
   * spec so a restored surface can re-execute it for fresh data
   * (jira-generative-adapter-v1, FR-006). Present ONLY when the persisted surface is
   * a bound surface (it accompanies `surface`); absent for a non-bound composed
   * surface. Carries no token/secret — the validator strips it to `{ dataSource,
   * query }` only (FR-007/FR-021). Schema bump from v1 → v2 added this field.
   *
   * For a MULTI-region surface this is absent in favor of {@link bindings}.
   */
  descriptor?: AdapterDescriptor
  /**
   * refreshable-custom-generative-ui (multi-region): the per-region
   * {@link AdapterBinding} list, persisted beside the view spec so a restored CUSTOM
   * partitioned surface re-registers EVERY region's fetcher for fresh data. Present ONLY
   * when the persisted surface is a multi-region bound surface; a single-region surface
   * uses {@link descriptor}. Secret-free — each binding's descriptor is stripped to
   * `{ dataSource, query }` by the validator (FR-007/FR-021).
   */
  bindings?: AdapterBinding[]
  /**
   * The Google Calendar legend's HIDDEN (deselected) calendar ids for THIS tab
   * (calendar-selection-persistence). PER-TAB so each google-calendar tab keeps its own
   * selection independent of sibling tabs. Non-secret email-like ids (never tokens). The
   * panel seeds its persisted hidden-set from this and reports back on every legend toggle
   * so a deselection survives a view switch, the A2UIProvider remount, and an app restart.
   * Additive + OPTIONAL: a missing/malformed value normalizes to absent/[] at the boundary
   * (every calendar shown), so an older snapshot restores cleanly with no version bump (see
   * validateGenerativeTab + validateHiddenCalendars). Only google-calendar tabs ever carry
   * it; the other generative panels never set it.
   */
  hiddenCalendars?: string[]
}

/**
 * A generative panel's persisted state (Generated-UI / Jira / Slack / Confluence).
 * A zero-tab panel stays zero-tab on restore (FR-011); only `composed:true` tab
 * surfaces survive (FR-012). No integration data/cursors are persisted (FR-016).
 */
export interface GenerativePanelSnapshot {
  /** Ordered tabs (FR-008). */
  tabs: GenerativeTabSnapshot[]
  /** The active tab's id, or null. FR-008. */
  activeTabId: string | null
  /** Monotonic "ever opened" counter, restored so new tab indices never collide. FR-010. */
  everOpened: number
}

/**
 * The four gateable integrations whose left-rail icon is shown only when enabled
 * (settings-redesign-v1, FR-003). Terminal + Generated UI are NOT integrations and
 * are always present, so they are deliberately absent from this set (FR-005).
 */
export type GateableIntegration = 'slack' | 'jira' | 'confluence' | 'google-calendar'

/**
 * Per-integration rail-visibility preference (settings-redesign-v1, FR-003/FR-007).
 *
 * `enabled[id] === true` means "show this integration's icon in the left rail". This
 * is a NON-secret UI preference, distinct from the integration's connection state —
 * enabling never connects and disabling never clears a token (FR-009). Persisted in
 * the plain-JSON session snapshot (NOT the encrypted client-config blob). First-run /
 * any missing key defaults to `false` (FR-008).
 */
export type EnabledIntegrations = Record<GateableIntegration, boolean>

/**
 * The persisted working-session snapshot (session-persistence-v1, FR-001/FR-002).
 *
 * Schema-versioned; an unknown `schemaVersion` is treated as unreadable (FR-002).
 * Holds ONLY non-secret tab/terminal structure + composed-surface specs + the
 * per-integration `enabled` UI preference — never tokens, OAuth material, or the
 * Atlassian client_secret (FR-006). Integration connection state itself is NOT
 * stored; panels rehydrate to not-connected / re-fetch on restore (FR-016/FR-017).
 */
export interface SessionSnapshot {
  /** Snapshot schema version; MUST equal SESSION_SCHEMA_VERSION to be readable. FR-002. */
  schemaVersion: number
  /** Per-panel persisted state, keyed by render target (+ terminal). FR-008. */
  panels: {
    terminal: TerminalPanelSnapshot
    'generated-ui': GenerativePanelSnapshot
    jira: GenerativePanelSnapshot
    slack: GenerativePanelSnapshot
    confluence: GenerativePanelSnapshot
    'google-calendar': GenerativePanelSnapshot
  }
  /**
   * Per-integration rail-visibility preference (settings-redesign-v1, FR-003/FR-006).
   * A missing/partial map normalizes each key to `false` at the boundary (FR-008/FR-018).
   */
  enabled: EnabledIntegrations
  /**
   * The collapsed Open-Prompt logo button's GLOBALLY-SHARED position
   * (draggable-open-prompt-button-v1, FR-003/FR-007/FR-008) — a normalized fraction of
   * the panel content area, origin top-left, both components in `[0,1]`. ADDITIVE +
   * OPTIONAL (NO schema bump): absent ⇒ the centered-bottom default on restore (FR-011).
   * NON-SECRET: two numbers only — no token/path (FR-010). A present-but-malformed value
   * is clamped/dropped at the main boundary (validateOpenPromptPosition).
   */
  openPromptPosition?: { xFrac: number; yFrac: number }
  /**
   * The Home panel's pinned FAVORITES (cosmos-home-favorite-tabs-v1, FR-030), in pinned order.
   * Each entry references a source generative-panel tab BY identity — `{panelId, tabId, label}` —
   * so on relaunch the favorite re-binds to the restored source tab (ids are stable across
   * relaunch) and re-acquires its LIVE surface; a favorite whose source is gone still renders a
   * calm "no longer open" state and is never auto-dropped (FR-031). ADDITIVE + OPTIONAL (NO schema
   * bump — mirrors `openPromptPosition`): absent ⇒ no favorites on restore. NON-SECRET: only the
   * panel id, the source tab id, and the source tab's display label — never a token, OAuth secret,
   * credential, path, transcript line, or any A2UI surface spec (the surface is NEVER persisted;
   * it is re-acquired live). Malformed/secret-shaped entries are dropped at the main boundary
   * (validateFavorites, FR-033).
   */
  favorites?: HomeFavorite[]
}

/**
 * One persisted Home favorite (cosmos-home-favorite-tabs-v1): a non-secret reference to a source
 * generative panel+tab. `panelId` is a {@link GateableIntegration} (terminal is NOT pinnable —
 * FR-040), `tabId` is the source's stable generative tab id, `label` is its display label.
 */
export interface HomeFavorite {
  panelId: GateableIntegration
  tabId: string
  label: string
}

/** The gateable panel ids a favorite may reference (terminal excluded — not pinnable, FR-040). */
const FAVORITE_PANEL_IDS: readonly GateableIntegration[] = [
  'slack',
  'jira',
  'confluence',
  'google-calendar'
]

/**
 * Validate the inbound persisted `favorites` list at the main boundary (cosmos-home-favorite-tabs-v1,
 * FR-033). KEEPS only entries that are a `{ panelId, tabId, label }` object whose `panelId` is a
 * known gateable panel and whose `tabId`/`label` are non-empty strings; every other entry (malformed,
 * extra/secret-shaped keys, unknown panel id, terminal id, non-string fields) is DROPPED with a warn —
 * never fatal. Returns ONLY the three whitelisted fields, so a secret-bearing persisted entry can
 * never carry an unexpected field through. Pure (no electron/fs) so it is the SINGLE source reused by
 * both the main `validateSnapshot` boundary and the renderer favorites code; node-testable.
 */
export function validateFavorites(
  value: unknown,
  warn: (message: string) => void = (m) => console.warn(m)
): HomeFavorite[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    warn('[session] favorites is not an array; dropping')
    return []
  }
  const out: HomeFavorite[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warn('[session] favorites: dropping a non-object entry')
      continue
    }
    const { panelId, tabId, label } = raw as Record<string, unknown>
    if (!FAVORITE_PANEL_IDS.includes(panelId as GateableIntegration)) {
      warn(`[session] favorites: dropping entry with invalid panelId "${String(panelId)}"`)
      continue
    }
    if (typeof tabId !== 'string' || tabId.length === 0) {
      warn('[session] favorites: dropping entry with a missing/empty tabId')
      continue
    }
    if (typeof label !== 'string' || label.length === 0) {
      warn('[session] favorites: dropping entry with a missing/empty label')
      continue
    }
    // Idempotent: a duplicate (panelId, tabId) is the same favorite — keep the first only.
    const key = `${panelId}:${tabId}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    // Whitelist-rebuild: emit ONLY the three known fields (drops any extra/secret-shaped key).
    out.push({ panelId: panelId as GateableIntegration, tabId, label })
  }
  return out
}

/** The four generative render targets that own a persisted panel. */
export type GenerativePanelKey = Exclude<keyof SessionSnapshot['panels'], 'terminal'>

/**
 * The session API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.session` (FR-003). Load is the single startup read; save is the
 * debounced push. NO method takes or returns a secret (FR-006).
 */
export interface SessionApi {
  /**
   * R->M (invoke). Read the persisted snapshot at startup. Resolves with `null`
   * when no snapshot exists or the file is missing/corrupt/wrong-version, so the
   * renderer falls back to a clean empty session (FR-001/FR-005).
   */
  load(): Promise<SessionSnapshot | null>
  /**
   * R->M (send). Persist the latest snapshot. Fire-and-forget; main validates at
   * the boundary and ignores an invalid payload without overwriting a good file
   * (FR-004/FR-007).
   */
  save(snapshot: SessionSnapshot): void
}
