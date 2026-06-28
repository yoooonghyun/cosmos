/**
 * PromptContext — the shared, non-secret SNAPSHOT of what the user was looking at when
 * they submitted a prompt from a cosmos Open-Prompt composer (cosmos-timeline-prompt-context-v1).
 *
 * It EXTENDS the existing in-view {@link ViewContext} (the dock item already captured for
 * model grounding) with two NEW dimensions — the active panel and the active tab — so the
 * Cosmos timeline can show, alongside each historical/live user-prompt bubble, "which panel /
 * which tab / which open dock" the prompt was sent from (spec FR-001..FR-007).
 *
 * One source, two channels (spec FR-017): captured ONCE at submit, then fed to BOTH the
 * authoritative `viewContextGroundingClause` (`--append-system-prompt`) AND the additive
 * `<cosmos:context>` marker — both derived from this single object so they can never disagree.
 *
 * PURE shared data: NO renderer, React, fs, or Electron import — importable by main, preload,
 * and renderer and unit-testable in node. Every field is a NON-SECRET display/identity label
 * (spec FR-008): NEVER a token, OAuth secret, credential, file path, `~/.claude` location, or
 * raw transcript line. The dock REUSES the literal {@link ViewContext} item fields (FR-005) — it
 * introduces NO parallel item shape and NO new field.
 */

import type { ViewContext } from '../ipc/agent'

/**
 * The rail panels a {@link PromptContext} can name. Mirrors the renderer `SurfaceId` set exactly
 * (declared HERE so shared stays free of a renderer import — the renderer's `SurfaceId` members are
 * assignable to this).
 *
 * cosmos-panel-tab-list-v1 (T1): `'terminal'` is now INCLUDED. The Cosmos panel-tab tree lists the
 * Terminal panel's open tabs and a tree-click selects panel + tab as the next prompt's context;
 * a terminal selection therefore needs a serializable panel id. Terminal has no dock
 * (`DOCK_KIND_BY_PANEL.terminal = null`), fully consistent with v1's panel+tab-only tree model.
 */
export type PromptPanelId =
  | 'cosmos'
  | 'slack'
  | 'jira'
  | 'confluence'
  | 'google-calendar'
  | 'terminal'

/** The discriminator for an open dock/detail overlay, derived from the panel id. */
export type DockKind = 'jira-issue' | 'slack-channel' | 'confluence-page' | 'calendar-event'

/**
 * Non-secret snapshot of the user's screen at submit. EXTENDS the in-view {@link ViewContext}
 * with `panel` + `tab`; the dock REUSES the existing ViewContext item fields verbatim
 * (spec FR-005/FR-007 — no parallel shape, no fabricated label, no new fetch).
 */
export interface PromptContext {
  /** The active rail panel + its display label. ALWAYS present (spec FR-002/FR-006). */
  panel: { id: PromptPanelId; label: string }
  /**
   * The active tab's id + its current display label within the panel. OMITTED when the panel
   * has no tab concept active (spec FR-003).
   */
  tab?: { id: string; label: string }
  /**
   * Present ONLY when a dock/detail overlay is open at submit (spec FR-004). `kind` is the
   * discriminator (derived from `panel.id`); the remaining fields are the POPULATED
   * {@link ViewContext} item fields, verbatim (spec FR-005).
   */
  dock?: { kind: DockKind } & ViewContext
}
