/**
 * Tests for the pure active-composer selection logic (open-prompt-hoist-v1).
 *
 * Node env (no jsdom) — `activeComposer.ts` is React/DOM-free by design (the
 * `.ts`/`.test.ts` split). Covers the spec-compliant happy path, the
 * missing-optional/absent-entry case (must not error → null = no composer), and the
 * invalid/missing required-arg case (must warn + return the safe `null` fallback).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  selectActiveComposerConfig,
  composerModeForSurface,
  type ComposerRegistry
} from './activeComposer'
import { ALL_SURFACE_IDS } from '../railVisibility'

const jiraConfig = {
  onSubmit: () => {},
  placeholder: 'Ask about your Jira issues…',
  ariaLabel: 'Ask about your Jira issues',
  busy: false
}

const slackConfig = {
  onSubmit: () => {},
  placeholder: 'Ask about your Slack channels and messages…',
  ariaLabel: 'Ask about Slack'
}

describe('selectActiveComposerConfig', () => {
  it('returns the active surface’s published config (happy path)', () => {
    const registry: ComposerRegistry = { jira: jiraConfig, slack: slackConfig }
    expect(selectActiveComposerConfig(registry, 'jira')).toBe(jiraConfig)
    expect(selectActiveComposerConfig(registry, 'slack')).toBe(slackConfig)
  })

  it('routes to the ACTIVE surface even when others are published', () => {
    // The whole point of the hoist: one shared composer, submit goes to the active surface.
    const registry: ComposerRegistry = { jira: jiraConfig, slack: slackConfig }
    // Switching the active surface flips which config (which onSubmit) is selected.
    expect(selectActiveComposerConfig(registry, 'slack')?.onSubmit).toBe(slackConfig.onSubmit)
    expect(selectActiveComposerConfig(registry, 'jira')?.onSubmit).toBe(jiraConfig.onSubmit)
  })

  it('returns null when the active surface has no published config (Terminal / disconnected)', () => {
    const registry: ComposerRegistry = { jira: jiraConfig }
    // Terminal never publishes → absent → no composer.
    expect(selectActiveComposerConfig(registry, 'terminal')).toBeNull()
    // A disconnected integration publishes an explicit null → no composer.
    const withNull: ComposerRegistry = { slack: null }
    expect(selectActiveComposerConfig(withNull, 'slack')).toBeNull()
  })

  it('does not error on an empty registry (optional/absent entry → null)', () => {
    expect(selectActiveComposerConfig({}, 'jira')).toBeNull()
  })

  it('warns and returns null for a missing registry (invalid required arg)', () => {
    const warn = vi.fn()
    expect(selectActiveComposerConfig(null, 'jira', warn)).toBeNull()
    expect(selectActiveComposerConfig(undefined, 'jira', warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('warns and returns null for an invalid active surface (invalid required arg)', () => {
    const warn = vi.fn()
    // `undefined` is an accepted input type (no ts-error) but still an invalid surface → null.
    expect(selectActiveComposerConfig({ jira: jiraConfig }, undefined, warn)).toBeNull()
    // @ts-expect-error — deliberately passing a non-string to exercise the guard.
    expect(selectActiveComposerConfig({ jira: jiraConfig }, 42, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

/*
 * cosmos-open-prompt-pinned-v1 (OQ-1 Option A) — the per-surface composer MODE. Cosmos ⇒
 * 'docked' (always-open bottom input); every OTHER surface ⇒ 'floating' (the unchanged
 * draggable collapsible logo). Invalid input ⇒ 'floating' (safe fallback, no throw).
 * This is the node-unit half of scenario CMP-MODE-01; the rendered docked-DOM behavior is
 * covered by PromptComposerDocked.dom.test.tsx.
 */
describe('composerModeForSurface (cosmos-open-prompt-pinned-v1)', () => {
  it('returns "docked" for the cosmos surface (happy path)', () => {
    expect(composerModeForSurface('cosmos')).toBe('docked')
  })

  it('returns "floating" for EVERY other rail surface (regression guard for the four panels + terminal)', () => {
    // The four floating panels + terminal must NEVER dock — only Cosmos is docked.
    for (const id of ALL_SURFACE_IDS) {
      if (id === 'cosmos') {
        continue
      }
      expect(composerModeForSurface(id)).toBe('floating')
    }
    // Spot-check the named floating panels explicitly so the intent is readable.
    expect(composerModeForSurface('slack')).toBe('floating')
    expect(composerModeForSurface('jira')).toBe('floating')
    expect(composerModeForSurface('confluence')).toBe('floating')
    expect(composerModeForSurface('google-calendar')).toBe('floating')
    expect(composerModeForSurface('terminal')).toBe('floating')
  })

  it('warns and falls back to "floating" for invalid input (no throw)', () => {
    const warn = vi.fn()
    expect(composerModeForSurface(undefined, warn)).toBe('floating')
    expect(composerModeForSurface(null, warn)).toBe('floating')
    // @ts-expect-error — deliberately passing a non-string to exercise the guard.
    expect(composerModeForSurface(42, warn)).toBe('floating')
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
