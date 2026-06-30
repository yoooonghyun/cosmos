/**
 * sessionRegistry — the renderer-side coordinator that MERGES each panel's latest
 * snapshot contribution into ONE `SessionSnapshot` and debounce-saves it to main
 * (session-persistence-v1, FR-001/FR-007).
 *
 * Each rail panel owns its own tab state, so no single component can build the whole
 * snapshot. Instead every panel REPORTS its per-panel contribution (its built panel
 * snapshot) keyed by panel id; the registry assembles the five contributions into a
 * schema-versioned snapshot and pushes it on a trailing debounce. The terminal
 * contribution is a DRAFT (no sessionId/cwd — main enriches those at the save
 * boundary, D2), but the on-the-wire snapshot type is shared; the draft's terminal
 * tabs simply omit sessionId/cwd and main fills them.
 *
 * Framework-free (no React) so the merge + debounce gate are unit-testable in
 * vitest's node env. `SessionProvider` wraps this in a context; the timer uses an
 * injectable scheduler so tests drive it deterministically.
 */

import {
  SESSION_SCHEMA_VERSION,
  type EnabledIntegrations,
  type GenerativePanelKey,
  type GenerativePanelSnapshot,
  type HomeFavorite,
  type SessionSnapshot,
  type TerminalPanelSnapshot
} from '../../shared/ipc'
import type { TerminalPanelDraft } from './sessionSnapshot'

/** The five contribution keys (one per rail panel). */
export type PanelKey = 'terminal' | GenerativePanelKey

/** A clean empty generative-panel contribution (zero tabs). */
function emptyGenerative(): GenerativePanelSnapshot {
  return { tabs: [], activeTabId: null, everOpened: 0 }
}

/** A clean empty terminal-panel contribution (zero tabs). */
function emptyTerminal(): TerminalPanelSnapshot {
  return { tabs: [], activeTabId: null, everOpened: 0 }
}

/** First-run `enabled` contribution — every gateable integration disabled (FR-008). */
export function emptyEnabled(): EnabledIntegrations {
  return { slack: false, jira: false, confluence: false, 'google-calendar': false }
}

/**
 * Assemble the panel contributions + the `enabled` map into a schema-versioned
 * snapshot. A panel that has not reported yet contributes its empty default; an
 * unreported `enabled` map defaults to all-disabled (FR-008). The terminal draft's
 * tabs are written as-is (their sessionId/cwd are filled by main at save — D2); the
 * renderer-built type is widened to the wire type here.
 */
export function assembleSnapshot(contributions: {
  terminal?: TerminalPanelDraft
  'generated-ui'?: GenerativePanelSnapshot
  jira?: GenerativePanelSnapshot
  slack?: GenerativePanelSnapshot
  confluence?: GenerativePanelSnapshot
  'google-calendar'?: GenerativePanelSnapshot
  enabled?: EnabledIntegrations
  /**
   * draggable-open-prompt-button-v1: the global Open-Prompt button position. A
   * NON-panel contribution (mirrors `enabled`). Omitted when unreported so the restore
   * default applies; present once a drag has reported one.
   */
  openPromptPosition?: { xFrac: number; yFrac: number }
  /**
   * cosmos-home-favorite-tabs-v1: the Home panel's pinned favorites. A NON-panel
   * contribution (mirrors `openPromptPosition`). Omitted when there are none so an older
   * snapshot stays favorite-free; present (in pinned order) once Home reports any.
   */
  favorites?: HomeFavorite[]
}): SessionSnapshot {
  const terminalDraft = contributions.terminal
  const terminal = (terminalDraft
    ? { tabs: terminalDraft.tabs, activeTabId: terminalDraft.activeTabId, everOpened: terminalDraft.everOpened }
    : emptyTerminal()) as unknown as TerminalPanelSnapshot
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal,
      'generated-ui': contributions['generated-ui'] ?? emptyGenerative(),
      jira: contributions.jira ?? emptyGenerative(),
      slack: contributions.slack ?? emptyGenerative(),
      confluence: contributions.confluence ?? emptyGenerative(),
      'google-calendar': contributions['google-calendar'] ?? emptyGenerative()
    },
    enabled: contributions.enabled ?? emptyEnabled(),
    // Additive OPTIONAL top-level field: only present when the registry holds one.
    ...(contributions.openPromptPosition ? { openPromptPosition: contributions.openPromptPosition } : {}),
    // cosmos-home-favorite-tabs-v1: additive OPTIONAL top-level field; omitted when empty.
    ...(contributions.favorites && contributions.favorites.length
      ? { favorites: contributions.favorites }
      : {})
  }
}

/** A function that persists the assembled snapshot (wired to `window.cosmos.session.save`). */
export type SaveFn = (snapshot: SessionSnapshot) => void

/** Injectable timer seam so tests drive the debounce deterministically. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h)
}

/** Trailing-debounce window for a save (ms). */
export const SAVE_DEBOUNCE_MS = 600

/**
 * The mutable registry. Panels call `report(key, contribution)` on every tab-state
 * change; the registry merges + trailing-debounces a `save`. `flush()` forces an
 * immediate save (used on teardown — FR-007). Holds no React state.
 */
export class SessionRegistry {
  private readonly contributions: Parameters<typeof assembleSnapshot>[0] = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly save: SaveFn
  private readonly scheduler: Scheduler
  private readonly debounceMs: number

  constructor(save: SaveFn, scheduler: Scheduler = realScheduler, debounceMs = SAVE_DEBOUNCE_MS) {
    this.save = save
    this.scheduler = scheduler
    this.debounceMs = debounceMs
  }

  /**
   * Seed the registry's contributions from the RESTORED snapshot at mount (favorites-lost-on-restart-v2).
   *
   * WHY (root cause of the round-2 regression): on a fresh relaunch the registry starts with EMPTY
   * contributions, yet the Cosmos panel fires an EAGER favorites save during its mount effect — and
   * Cosmos is mounted BEFORE the generative panels in the rail (App.tsx), so those panels have NOT
   * re-reported yet. {@link assembleSnapshot} fills every un-reported panel with an EMPTY default, so
   * that eager save persists `{ favorites, EMPTY jira/slack/confluence/google-calendar }` — WIPING the
   * favorite's SOURCE panel from disk. The favorite reference survives, but the next load hydrates the
   * source panel empty, so the favorite re-binds to nothing (the "no longer open" gone-source state).
   * The 600ms debounced panel reports only heal disk if the app survives the window; a dev HMR / quick
   * relaunch inside it makes the corruption stick.
   *
   * Seeding the contributions from the loaded snapshot makes any early/eager save preserve the restored
   * panels REGARDLESS of panel-mount order or debounce timing — the same protection the per-mount
   * `enabled` seed already gives that field (SessionProvider). Pure population: it does NOT trigger a
   * save; each panel's own report overwrites its seeded slice once it mounts (with the same data).
   *
   * Terminal is intentionally EXCLUDED: main re-enriches/drops terminal tabs from its live PTY session
   * map at the save boundary (a renderer-seeded terminal tab with no live session would be dropped
   * anyway), and the terminal panel re-reports its draft before the Cosmos eager save fires (it renders
   * earlier in the rail), so terminal is never at risk.
   */
  seed(snapshot: SessionSnapshot): void {
    const p = snapshot.panels
    this.contributions['generated-ui'] = p['generated-ui']
    this.contributions.jira = p.jira
    this.contributions.slack = p.slack
    this.contributions.confluence = p.confluence
    this.contributions['google-calendar'] = p['google-calendar']
    this.contributions.enabled = snapshot.enabled
    if (snapshot.openPromptPosition) {
      this.contributions.openPromptPosition = snapshot.openPromptPosition
    }
    if (snapshot.favorites && snapshot.favorites.length) {
      this.contributions.favorites = snapshot.favorites
    }
  }

  /**
   * The registry's CURRENT favorites contribution (the live, just-persisted truth), or `undefined`
   * when none has been recorded. cosmos-home-favorite-tabs / favorites-lost-on-restart-v2: the Cosmos
   * panel seeds its initial favorite tabs from this FIRST (falling back to the restored snapshot) so a
   * dev Fast-Refresh REMOUNT — which re-runs the panel's `useState` initializer against the STALE
   * app-start snapshot while the registry instance SURVIVES — re-seeds the truly-pinned set instead of
   * resetting to none and eager-saving an empty list (which would wipe the favorite from disk = the
   * "absent, as if never pinned" symptom). A genuine unpin leaves this `[]`, which is respected.
   */
  getFavorites(): HomeFavorite[] | undefined {
    return this.contributions.favorites
  }

  /** Record a panel's latest contribution and schedule a trailing-debounced save. */
  report<K extends PanelKey>(
    key: K,
    contribution: K extends 'terminal' ? TerminalPanelDraft : GenerativePanelSnapshot
  ): void {
    ;(this.contributions as Record<string, unknown>)[key] = contribution
    this.schedule()
  }

  /**
   * Record the latest per-integration `enabled` map (settings-redesign-v1, D2). The
   * Enable toggle reports through this non-panel contribution path; the map merges
   * into the assembled snapshot and trailing-debounces a save like any other change.
   */
  setEnabled(enabled: EnabledIntegrations): void {
    this.contributions.enabled = enabled
    this.schedule()
  }

  /**
   * Record the latest global Open-Prompt button position (draggable-open-prompt-button-v1,
   * FR-003/FR-007). The NON-panel contribution path (mirrors {@link setEnabled}): a drag in
   * any panel reports through here, the value merges into the assembled snapshot and
   * trailing-debounces a save like any other change.
   */
  setOpenPromptPosition(position: { xFrac: number; yFrac: number }): void {
    this.contributions.openPromptPosition = position
    this.schedule()
  }

  /**
   * Record the latest Home favorites list (cosmos-home-favorite-tabs-v1, FR-030) and persist it
   * EAGERLY — the NON-panel contribution path (mirrors {@link setOpenPromptPosition}) records the
   * list, but favorites save IMMEDIATELY rather than on the shared trailing debounce. NON-secret
   * references only (`{panelId, tabId, label}`) — never an A2UI surface (FR-023/FR-033).
   *
   * WHY EAGER (bug favorites-lost-on-restart-v1): a pin/unpin must reach disk PROMPTLY. The shared
   * `SAVE_DEBOUNCE_MS` (600ms) trailing timer is reset by EVERY contribution (the single `this.timer`
   * in {@link schedule}), so an actively-changing session can perpetually defer the favorites save;
   * and a dev HMR / Vite reload that fires inside the debounce window pre-empts it — a partial HMR
   * update fires NEITHER `pagehide` NOR `beforeunload`, so the teardown {@link flush} never runs and
   * the just-pinned favorite never lands. Persisting on the spot closes that window so a full reload /
   * relaunch (which re-runs `useLoadSession`) restores them. Pin/unpin/relabel are rare + user-driven,
   * so the extra writes are negligible; the eager save flushes any OTHER pending contributions too,
   * which is strictly safe (it persists current state early, exactly like the teardown flush).
   */
  setFavorites(favorites: HomeFavorite[]): void {
    this.contributions.favorites = favorites
    this.saveNow()
  }

  private schedule(): void {
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer)
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      this.save(assembleSnapshot(this.contributions))
    }, this.debounceMs)
  }

  /**
   * Cancel any pending trailing-debounce timer and save the current contributions NOW. Shared by
   * {@link flush} (teardown — FR-007) and {@link setFavorites} (eager favorites persistence).
   */
  private saveNow(): void {
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer)
      this.timer = null
    }
    this.save(assembleSnapshot(this.contributions))
  }

  /** Force an immediate save of the current contributions (teardown — FR-007). */
  flush(): void {
    this.saveNow()
  }
}
