import { describe, it, expect, vi } from 'vitest'
import {
  nextStateOnLogoClick,
  submitDecision,
  draftAfterDismiss,
  draftAfterSubmit,
  shouldCollapseOnOutsideClick,
  escDecision,
  surfaceSpinnerVisible,
  type ComposerState
} from './promptComposerLogic'

/*
 * collapsible-prompt-composer-v1 — pure decision logic (Steps 4/5). Node env, no DOM.
 * Tests the `.ts` ONLY (never the `.tsx`), per CLAUDE.md / panelTabs.test.ts precedent.
 */

describe('nextStateOnLogoClick (FR-003 — open-only, never a toggle)', () => {
  it('opens from collapsed (happy path)', () => {
    expect(nextStateOnLogoClick('collapsed')).toBe('expanded')
  })

  it('is open-only: from an already-expanded state it still yields expanded, never toggles back', () => {
    // The logo is not present while expanded, but the helper must never collapse
    // on a logo "click" — it is strictly open-only (FR-003).
    expect(nextStateOnLogoClick('expanded')).toBe('expanded')
  })

  it('only ever produces the expanded state', () => {
    const states: ComposerState[] = ['collapsed', 'expanded']
    for (const s of states) {
      expect(nextStateOnLogoClick(s)).toBe('expanded')
    }
  })
})

describe('submitDecision (FR-005 / FR-006)', () => {
  it('accepts a non-empty, non-running submit → send + auto-collapse (happy path)', () => {
    expect(submitDecision({ value: 'Show my open bugs', running: false })).toEqual({
      accept: true
    })
  })

  it('accepts text with surrounding whitespace (trimmed length > 0)', () => {
    expect(submitDecision({ value: '   hello  ', running: false })).toEqual({ accept: true })
  })

  it('rejects an empty value (no run, stays expanded — FR-005)', () => {
    expect(submitDecision({ value: '', running: false })).toEqual({ accept: false })
  })

  it('rejects a whitespace-only value (no run, stays expanded — FR-005)', () => {
    expect(submitDecision({ value: '   \n\t ', running: false })).toEqual({ accept: false })
  })

  it('rejects while a run is in flight even with non-empty text (FR-005/FR-019)', () => {
    expect(submitDecision({ value: 'do it', running: true })).toEqual({ accept: false })
  })

  it('warns and returns a safe fallback for a non-string value (invalid required arg)', () => {
    const warn = vi.fn()
    expect(submitDecision({ value: undefined as unknown as string, running: false }, warn)).toEqual(
      { accept: false }
    )
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns a safe fallback for a missing input object (does not throw)', () => {
    const warn = vi.fn()
    expect(() =>
      submitDecision(undefined as unknown as { value: string; running: boolean }, warn)
    ).not.toThrow()
    expect(submitDecision(null as unknown as { value: string; running: boolean }, warn)).toEqual({
      accept: false
    })
    expect(warn).toHaveBeenCalled()
  })
})

describe('draft preservation (FR-018 / OQ-2 vs FR-005)', () => {
  it('preserves the draft on dismiss (Esc / click-outside) — restored on re-open', () => {
    expect(draftAfterDismiss('half-typed prompt')).toBe('half-typed prompt')
  })

  it('preserves an empty draft on dismiss without error', () => {
    expect(draftAfterDismiss('')).toBe('')
  })

  it('degrades a non-string draft to "" on dismiss (safe fallback for a controlled textarea)', () => {
    expect(draftAfterDismiss(undefined as unknown as string)).toBe('')
    expect(draftAfterDismiss(null as unknown as string)).toBe('')
  })

  it('clears the draft only on a successful submit (FR-005)', () => {
    expect(draftAfterSubmit()).toBe('')
  })
})

describe('shouldCollapseOnOutsideClick (FR-008 / Edge Cases)', () => {
  it('does NOT collapse when the click target is inside the composer (textarea, Send, padding)', () => {
    expect(shouldCollapseOnOutsideClick(true)).toBe(false)
  })

  it('collapses when the click is elsewhere in the panel (tab strip, content, search, footer)', () => {
    expect(shouldCollapseOnOutsideClick(false)).toBe(true)
  })
})

describe('escDecision (FR-007 / Edge Cases — Esc precedence)', () => {
  it('collapses when the composer is open AND focused (Esc takes precedence)', () => {
    expect(escDecision({ open: true, focused: true })).toBe(true)
  })

  it('does NOT collapse when the composer is not focused (Esc not stolen from other handlers)', () => {
    expect(escDecision({ open: true, focused: false })).toBe(false)
  })

  it('does NOT collapse when the composer is already collapsed', () => {
    expect(escDecision({ open: false, focused: true })).toBe(false)
    expect(escDecision({ open: false, focused: false })).toBe(false)
  })

  it('degrades a missing input to false without throwing (safe fallback)', () => {
    expect(
      escDecision(undefined as unknown as { open: boolean; focused: boolean })
    ).toBe(false)
  })
})

describe('surfaceSpinnerVisible (composer-send-animation-v1 FR-005/FR-006/FR-007/FR-008)', () => {
  it('shows the spinner for an in-flight tab with no surface/error (happy path — FR-005)', () => {
    expect(
      surfaceSpinnerVisible({ inFlight: true, hasSurface: false, hasError: false })
    ).toBe(true)
  })

  it('hides the spinner once a surface has landed (FR-006 — the surface replaces it)', () => {
    expect(
      surfaceSpinnerVisible({ inFlight: false, hasSurface: true, hasError: false })
    ).toBe(false)
  })

  it('hides the spinner even if a stale inFlight overlaps a landed surface (surface wins, FR-006)', () => {
    // Belt-and-suspenders: the render frame clears inFlight + sets surface together, but
    // a landed surface must never co-show the spinner regardless of the inFlight value.
    expect(
      surfaceSpinnerVisible({ inFlight: true, hasSurface: true, hasError: false })
    ).toBe(false)
  })

  it('hides the spinner on a run error (FR-007 — the error state shows, not the spinner)', () => {
    expect(
      surfaceSpinnerVisible({ inFlight: false, hasSurface: false, hasError: true })
    ).toBe(false)
  })

  it('hides the spinner for an idle tab (no run — FR-008 / no perpetual spinner)', () => {
    expect(
      surfaceSpinnerVisible({ inFlight: false, hasSurface: false, hasError: false })
    ).toBe(false)
  })

  it('defers to the Jira default-view skeleton: loadingDefault suppresses the send-spinner (design §4.1)', () => {
    // A default/nav read sets loadingDefault (not a user compose); the panel shows its own
    // DefaultViewSkeleton and the send-spinner must NOT co-render.
    expect(
      surfaceSpinnerVisible({
        inFlight: true,
        hasSurface: false,
        hasError: false,
        loadingDefault: true
      })
    ).toBe(false)
  })

  it('a user compose (inFlight, loadingDefault absent/false) still shows the spinner', () => {
    expect(
      surfaceSpinnerVisible({
        inFlight: true,
        hasSurface: false,
        hasError: false,
        loadingDefault: false
      })
    ).toBe(true)
  })

  it('warns and returns false (safe fallback) for a missing input object — busy never sticks', () => {
    const warn = vi.fn()
    expect(surfaceSpinnerVisible(undefined as unknown as never, warn)).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns false for a non-boolean inFlight (invalid required field)', () => {
    const warn = vi.fn()
    expect(
      surfaceSpinnerVisible(
        { inFlight: undefined as unknown as boolean, hasSurface: false, hasError: false },
        warn
      )
    ).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('collapse-mid-run is permitted by the dismiss helpers (FR-019 / OQ-3)', () => {
  it('Esc / click-outside decisions ignore the running flag — they have no running input', () => {
    // The dismiss helpers (esc / outside-click) carry no `running` parameter, so a
    // collapse via Esc or click-outside is allowed even while a run is in flight
    // (the textarea is disabled and status persists via the footer/tab-strip).
    expect(escDecision({ open: true, focused: true })).toBe(true)
    expect(shouldCollapseOnOutsideClick(false)).toBe(true)
    // Only SUBMIT keys off `running` (it no-ops while running) — the dismiss path does not.
    expect(submitDecision({ value: 'x', running: true })).toEqual({ accept: false })
  })
})
