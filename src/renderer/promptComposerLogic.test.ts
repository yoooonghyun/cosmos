import { describe, it, expect, vi } from 'vitest'
import {
  nextStateOnLogoClick,
  submitDecision,
  draftAfterDismiss,
  draftAfterSubmit,
  shouldCollapseOnOutsideClick,
  escDecision,
  surfaceSpinnerVisible,
  shouldReleaseInFlightOnCompleted,
  sentHintAfterSubmit,
  inFlightOnSubmit,
  composerInteractiveAfterSubmit,
  isAlwaysOpen,
  allowsCollapse,
  hidesOnBusy,
  SENT_HINT_DURATION_MS,
  type ComposerState,
  type ComposerMode
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

/*
 * cosmos-open-prompt-pinned-v1 — the per-surface MODE predicates the `.tsx` reads. These are
 * the node-unit half of scenario CMP-MODE-01; they are NECESSARY but NOT SUFFICIENT — the
 * rendered docked-DOM behavior (always-rendered input, auto-focus, inert Esc, stay-open submit)
 * is covered by PromptComposerDocked.dom.test.tsx. CRITICAL: the `'floating'` rows below are a
 * REGRESSION GUARD proving the four floating panels' composer behavior is unchanged (collapse
 * permitted, hide-on-busy) — they must stay green.
 */
describe('composer mode predicates (cosmos-open-prompt-pinned-v1 FR-001/FR-003/FR-005)', () => {
  const modes: ComposerMode[] = ['docked', 'floating']

  describe('isAlwaysOpen (FR-001 — docked is permanently open)', () => {
    it('is true for docked (the Cosmos chat input never collapses to a logo)', () => {
      expect(isAlwaysOpen('docked')).toBe(true)
    })
    it('is false for floating (the default-collapsed draggable logo — UNCHANGED)', () => {
      expect(isAlwaysOpen('floating')).toBe(false)
    })
  })

  describe('allowsCollapse (FR-003/FR-007 — docked never collapses on submit/Esc/outside-click)', () => {
    it('is false for docked (Esc + click-outside inert, submit stays open)', () => {
      expect(allowsCollapse('docked')).toBe(false)
    })
    it('is true for floating (collapse-on-exit preserved — UNCHANGED)', () => {
      expect(allowsCollapse('floating')).toBe(true)
    })
  })

  describe('hidesOnBusy (FR-005 — "busy hides both states" is now FLOATING-ONLY)', () => {
    it('is false for docked (the Cosmos input stays visible/typeable during a run)', () => {
      expect(hidesOnBusy('docked')).toBe(false)
    })
    it('is true for floating (busy hides the logo + card — UNCHANGED)', () => {
      expect(hidesOnBusy('floating')).toBe(true)
    })
  })

  it('docked is always-open AND never-collapses AND not-hidden-on-busy (the three docked invariants together)', () => {
    expect(isAlwaysOpen('docked')).toBe(true)
    expect(allowsCollapse('docked')).toBe(false)
    expect(hidesOnBusy('docked')).toBe(false)
  })

  it('floating keeps every existing behavior (the regression guard for Slack/Jira/Confluence/Calendar)', () => {
    expect(isAlwaysOpen('floating')).toBe(false)
    expect(allowsCollapse('floating')).toBe(true)
    expect(hidesOnBusy('floating')).toBe(true)
  })

  it('always-open and allows-collapse are exact duals across every mode (no mode is both)', () => {
    for (const mode of modes) {
      expect(isAlwaysOpen(mode)).toBe(!allowsCollapse(mode))
    }
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

describe('shouldReleaseInFlightOnCompleted (open-prompt-spinner-gating-v1 FR-001/FR-002/FR-004/FR-008)', () => {
  it('releases an in-flight no-surface tab whose run produced NO surface (plain command — FR-004)', () => {
    // The root-cause fix: a plain command completes without a surface, so the in-flight
    // tab must be released — otherwise the "Generating…" spinner hangs forever.
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: false, producedSurface: false })
    ).toBe(true)
  })

  it('does NOT release when the run produced a surface (UI generation — FR-001/FR-005)', () => {
    // producedSurface === true ⇒ the ui:render path owns clearing inFlight; never release here.
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: false, producedSurface: true })
    ).toBe(false)
  })

  it('does NOT release a tab that already has a landed surface (surface path won)', () => {
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: true, producedSurface: true })
    ).toBe(false)
  })

  it('releases a no-surface tab even when inFlight is false (late-signal gating regression fix)', () => {
    // ui-catalog-pull-spinner-signal-v1 regression: inFlightOnSubmit() returns false, so
    // inFlight is only true if the agent pulled get_ui_catalog. A plain-answer run never
    // pulls the catalog → inFlight stays false → the old inFlight===true guard blocked the
    // release → originatingTabIdRef was never cleared → panel stuck. Must release whenever
    // no surface was produced, regardless of inFlight.
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: false, hasSurface: false, producedSurface: false })
    ).toBe(true)
  })

  it('falls back to surface-presence when producedSurface is ABSENT — releases a no-surface tab (FR-008)', () => {
    // Old/partial payload: with no signal, release only when there is no surface.
    expect(shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: false })).toBe(true)
  })

  it('falls back to surface-presence when producedSurface is ABSENT — keeps a tab with a surface (FR-008)', () => {
    // A real UI run has its surface by `completed`, so an absent signal must NOT wrongly release it.
    expect(shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: true })).toBe(false)
  })

  it('warns and returns false (safe fallback) for a missing input object — never releases on bad input', () => {
    const warn = vi.fn()
    expect(shouldReleaseInFlightOnCompleted(undefined as unknown as never, warn)).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns false for a non-boolean inFlight (invalid required field)', () => {
    const warn = vi.fn()
    expect(
      shouldReleaseInFlightOnCompleted(
        { inFlight: undefined as unknown as boolean, hasSurface: false },
        warn
      )
    ).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('sentHintAfterSubmit (open-prompt-spinner-gating-v1, OQ-3 — transient non-blocking "Sent" hint)', () => {
  it('shows the hint after an ACCEPTED submit (plain command acknowledgement)', () => {
    expect(sentHintAfterSubmit(true)).toEqual({ visible: true })
  })

  it('shows nothing for a rejected/no-op submit (empty / running)', () => {
    expect(sentHintAfterSubmit(false)).toEqual({ visible: false })
  })

  it('never carries a busy/block field — it cannot hide the composer', () => {
    const hint = sentHintAfterSubmit(true)
    expect(hint).not.toHaveProperty('busy')
    expect(Object.keys(hint)).toEqual(['visible'])
  })

  it('exposes a finite auto-dismiss duration (the timer binding lives in the .tsx)', () => {
    expect(typeof SENT_HINT_DURATION_MS).toBe('number')
    expect(SENT_HINT_DURATION_MS).toBeGreaterThan(0)
  })
})

describe('inFlightOnSubmit (ui-catalog-pull-spinner-signal-v1 — spinner gated on the begin-signal, NOT optimistically at submit)', () => {
  it('submit does NOT optimistically engage inFlight — the begin-signal is the gate', () => {
    // The render surface is split: the agent must pull `get_ui_catalog` before it can author a
    // surface, and that pull fires `ui:generatingBegin` — a TRUE early UI-vs-plain signal. So
    // submit no longer spins optimistically; `inFlightOnSubmit()` is now `false`. FAILS if it
    // still returns `true` (the prior optimistic gate that flickered for plain runs).
    expect(inFlightOnSubmit()).toBe(false)
  })

  // Drive the FULL spinner lifecycle through the real predicates as `useGenerativePanelTabs`
  // wires them: a plain run (no begin-signal) NEVER spins; a UI-generation run spins from the
  // begin-signal (which sets inFlight) until the surface lands.
  it('plain MCP run (no begin-signal) → spinner NEVER shows; UI run (begin-signal sets inFlight) → spinner shows then clears on surface land', () => {
    // 1) At submit, neither kind is in-flight (the begin-signal has not arrived yet).
    const atSubmit = inFlightOnSubmit()
    expect(atSubmit).toBe(false)
    expect(surfaceSpinnerVisible({ inFlight: atSubmit, hasSurface: false, hasError: false })).toBe(
      false
    )

    // 2a) PLAIN MCP/command run: never pulls the catalog ⇒ no `ui:generatingBegin` ⇒ inFlight
    //     stays false the whole run ⇒ the spinner NEVER shows. At `completed`, the release fires
    //     (inFlight===true guard removed — regression fix) so originatingTabIdRef is always cleared.
    expect(surfaceSpinnerVisible({ inFlight: false, hasSurface: false, hasError: false })).toBe(
      false
    )
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: false, hasSurface: false, producedSurface: false })
    ).toBe(true)

    // 2b) UI-GENERATION run: the begin-signal sets inFlight=true (the subscription's effect) →
    //     the spinner shows DURING generation, before the surface is composed.
    const afterBeginSignal = true // useGenerativePanelTabs sets inFlight on ui:generatingBegin.
    expect(
      surfaceSpinnerVisible({ inFlight: afterBeginSignal, hasSurface: false, hasError: false })
    ).toBe(true)

    // 2c) The `ui:render` surface lands → inFlight cleared + surface present → spinner hidden
    //     (replaced by the surface). The `completed`-release is belt-and-suspenders (no-op).
    expect(surfaceSpinnerVisible({ inFlight: false, hasSurface: true, hasError: false })).toBe(false)

    // 2d) Catalog pulled but NO surface ever lands (aborted run): inFlight is still true at
    //     `completed` with producedSurface=false → the release fires → spinner clears (no hang).
    expect(
      shouldReleaseInFlightOnCompleted({ inFlight: true, hasSurface: false, producedSurface: false })
    ).toBe(true)
  })
})

describe('composerInteractiveAfterSubmit (open-prompt-spinner-gating — non-UI submit must not block)', () => {
  it('a plain submit leaves the composer INTERACTIVE — never locked for the run (the root-cause fix)', () => {
    // REGRESSION: previously `submit` set a local `running` flag (and `agent:status`
    // `started` kept it set) for the WHOLE agent run, so a reopened composer was dead —
    // textarea disabled, Send disabled, submit rejected — until the run completed. A plain
    // fire-and-forget submit must return the composer to a usable state immediately.
    expect(composerInteractiveAfterSubmit()).toBe(true)
  })

  it('the derived lock is false, so the composer is never disabled merely because a run is in flight', () => {
    // The component derives `composerLocked = !composerInteractiveAfterSubmit()` and uses it
    // for the textarea `disabled`, the Send `canSubmit`, and the submit-accept gate.
    const composerLocked = !composerInteractiveAfterSubmit()
    expect(composerLocked).toBe(false)
  })

  it('Send is still ENABLED with text after a submit, even while an agent run is in flight', () => {
    // `canSubmit = !composerLocked && value.trim().length > 0`. With the lock false, a
    // reopened composer can send again immediately — the user is not blocked by the run.
    const composerLocked = !composerInteractiveAfterSubmit()
    const canSubmit = !composerLocked && 'next prompt'.trim().length > 0
    expect(canSubmit).toBe(true)
  })

  it('submitDecision ACCEPTS the next plain submit mid-run (running fed from composerLocked, not the agent run)', () => {
    // This is the exact wiring `submit` uses: `submitDecision({ value, running: composerLocked })`.
    // Before the fix, `running` was the agent-run flag (true mid-run) → submit rejected → blocked.
    // Now it is the composer lock (false) → the next send is accepted while the prior run runs.
    const composerLocked = !composerInteractiveAfterSubmit()
    expect(submitDecision({ value: 'another command', running: composerLocked })).toEqual({
      accept: true
    })
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
