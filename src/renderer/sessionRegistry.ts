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
  type SessionSnapshot,
  type TerminalPanelSnapshot
} from '../shared/ipc'
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
    ...(contributions.openPromptPosition ? { openPromptPosition: contributions.openPromptPosition } : {})
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

  private schedule(): void {
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer)
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      this.save(assembleSnapshot(this.contributions))
    }, this.debounceMs)
  }

  /** Force an immediate save of the current contributions (teardown — FR-007). */
  flush(): void {
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer)
      this.timer = null
    }
    this.save(assembleSnapshot(this.contributions))
  }
}
