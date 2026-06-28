/**
 * activeComposer — pure, framework-free selection logic for the SINGLE shared
 * Open-Prompt composer (open-prompt-hoist-v1).
 *
 * The composer used to be mounted once PER panel (5 instances), so every panel
 * switch re-mounted + re-measured a composer and the floating Open-Prompt button
 * flickered. It is now hoisted to ONE App-level instance; each generative panel
 * PUBLISHES its current composer wiring (submit handler, placeholder, aria label,
 * context chip, busy gate) into a shared registry keyed by surface id, and the App
 * reads the ACTIVE surface's published entry to route the submit. This module holds
 * the pure pick/gate decision so it is node-testable (no React/DOM), mirroring the
 * `promptComposerLogic.ts` / `openPromptPosition.ts` `.ts`/`.test.ts` split.
 */

import type { SurfaceId } from '../app/railVisibility'
import type { ContextChipData } from '../app/viewContextCapture'
import type { ContextDismiss } from './PromptComposer'

/**
 * One panel's published composer wiring. Every field traces to a prop the per-panel
 * `PromptComposer` used to receive directly. `null`/absence ⇒ the panel has no active
 * composer right now (e.g. an integration panel that is not connected, or Terminal),
 * so the shared composer hides.
 */
export interface ComposerConfig {
  /** Send the utterance to THIS surface (the panel hook owns agent.submit + tab bookkeeping). */
  onSubmit: (utterance: string, options?: { contextDismiss: ContextDismiss }) => void
  /** Per-panel textarea placeholder. */
  placeholder: string
  /** Per-panel accessible name for the form + textarea. */
  ariaLabel: string
  /** Display-only in-view context chip (undefined ⇒ no chip). */
  contextChip?: ContextChipData
  /** True while the active tab has a generation in flight (hides the composer). */
  busy?: boolean
}

/** The published registry: surface id → its current composer config (or absent). */
export type ComposerRegistry = Partial<Record<SurfaceId, ComposerConfig | null>>

/**
 * The two render modes of the single shared composer (cosmos-open-prompt-pinned-v1, OQ-1
 * Option A). The composer is ONE App-level hoisted instance; this per-surface flag picks
 * how it presents on the ACTIVE surface:
 *   - `'docked'`   — Cosmos: an always-open, bottom-pinned chat input that never collapses,
 *                    is not hidden by `busy`, and ignores Esc / click-outside (FR-001..FR-010).
 *   - `'floating'` — every other surface (Slack/Jira/Confluence/Google Calendar): today's
 *                    draggable, collapse-on-submit/Esc/outside-click logo overlay (unchanged,
 *                    FR-011 / SC-006).
 */
export type ComposerMode = 'docked' | 'floating'

/**
 * Pick the composer MODE for a surface (cosmos-open-prompt-pinned-v1, OQ-1 Option A). The
 * Cosmos panel (rail id `'cosmos'`) gets the always-open, bottom-docked input; every other
 * surface keeps the floating collapsible logo. This is the SINGLE place the per-surface
 * rule lives, so the four other panels' `usePublishComposer` calls never carry a `mode`.
 *
 * Pure + node-testable (no React/DOM). Invalid/missing input never throws: a non-string
 * surface warns and falls back to the SAFE `'floating'` mode (the existing behavior — a bad
 * input must never accidentally dock a non-Cosmos panel), matching this module's
 * "invalid required arg → warn + safe fallback" convention.
 */
export function composerModeForSurface(
  surface: SurfaceId | null | undefined,
  warn: (msg: string) => void = console.warn
): ComposerMode {
  if (typeof surface !== 'string') {
    warn('[activeComposer] composerModeForSurface: invalid surface; defaulting to floating')
    return 'floating'
  }
  return surface === 'cosmos' ? 'docked' : 'floating'
}

/**
 * Pick the composer config for the ACTIVE surface, or `null` when that surface has not
 * published one (Terminal, or a disconnected integration panel). A `null`/missing entry
 * means "no composer here" so the shared App-level composer is not rendered.
 *
 * Invalid/missing input never throws: a missing registry or a non-string surface id
 * warns and returns the safe fallback `null` (no composer), matching the SDD Step-4
 * "invalid required arg → warn + safe fallback" rule.
 */
export function selectActiveComposerConfig(
  registry: ComposerRegistry | null | undefined,
  activeSurface: SurfaceId | null | undefined,
  warn: (msg: string) => void = console.warn
): ComposerConfig | null {
  if (!registry || typeof registry !== 'object') {
    warn('[activeComposer] selectActiveComposerConfig: missing registry; hiding composer')
    return null
  }
  if (typeof activeSurface !== 'string') {
    warn('[activeComposer] selectActiveComposerConfig: invalid active surface; hiding composer')
    return null
  }
  return registry[activeSurface] ?? null
}
