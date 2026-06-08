/**
 * promptComposer — pure, framework-free decision logic for the shared collapsible
 * prompt composer (collapsible-prompt-composer-v1).
 *
 * This module is intentionally React-free and DOM-free so it can be unit-tested in
 * vitest's node env (no jsdom) — the catalog convention in CLAUDE.md ("keep testable
 * logic in a plain `.ts`, never import a `.tsx` from a `.test.ts`"). The
 * `PromptComposer.tsx` shell wraps these helpers; the DOM-bound concerns (the
 * click-outside hit-test, focus moves, the `agent.onStatus` subscription, and the
 * Tailwind animation) stay in the `.tsx`.
 *
 * Spec trace (.sdd/specs/collapsible-prompt-composer-v1.md):
 *   FR-003  nextStateOnLogoClick — the collapsed logo is OPEN-ONLY (never a toggle).
 *   FR-005  submitDecision — Enter submits only when non-empty (trimmed) AND not
 *           running; empty/whitespace or a run-in-flight is a no-op.
 *   FR-006  submitDecision.accept also drives the auto-collapse on a successful submit.
 *   FR-007  escDecision — Esc collapses while the composer is the open/focused element.
 *   FR-008  shouldCollapseOnOutsideClick — a click outside the composer root collapses.
 *   FR-018 / OQ-2  draftAfterDismiss / draftAfterSubmit — preserve the draft on Esc /
 *           click-outside dismissal; clear it only on a successful submit.
 *   FR-019 / OQ-3  the dismiss helpers (Esc / click-outside) ignore `running`, so a
 *           collapse mid-run is permitted.
 *
 * Spec trace (.sdd/specs/composer-send-animation-v1.md):
 *   FR-005/FR-006/FR-008  surfaceSpinnerVisible — the per-tab busy gate for the surface
 *           send-spinner: an originating tab that is in-flight WITHOUT a landed surface,
 *           error, or default-view skeleton shows the spinner; it stops the moment the
 *           surface lands (FR-006) or the run errors (FR-007). Driven off the per-tab
 *           `GenerativeTab` state (`useGenerativePanelTabs`), NOT `agent.onStatus`.
 */

/** The two mutually-exclusive states of the composer (FR-002). */
export type ComposerState = 'collapsed' | 'expanded'

/**
 * The next state when the collapsed logo button is clicked (FR-003). The logo is
 * OPEN-ONLY — clicking it always yields `'expanded'`; it never toggles back to
 * `'collapsed'` (when expanded there is no logo to click, FR-002). Pure.
 */
export function nextStateOnLogoClick(_state: ComposerState): ComposerState {
  return 'expanded'
}

/** The inputs to the submit-accept decision (FR-005). */
export interface SubmitDecisionInput {
  /** The raw textarea value (may have surrounding whitespace). */
  value: string
  /** Whether a run is currently in flight (submit is ignored while running). */
  running: boolean
}

/** The outcome of the submit-accept decision (FR-005/FR-006). */
export interface SubmitDecision {
  /**
   * Whether this submit is accepted: the utterance is sent AND the composer
   * auto-collapses + clears the draft. False ⇒ a no-op that stays expanded.
   */
  accept: boolean
}

/**
 * Decide whether a submit is accepted (FR-005). Accept iff the value is non-empty
 * after trimming AND no run is in flight — the SAME condition today's composer uses
 * to gate the `onSubmit` call and the `setValue('')` clear. On accept the composer
 * also auto-collapses (FR-006); on reject it is a no-op that stays expanded.
 *
 * Invalid/missing input never throws: a non-string `value` (or a missing object)
 * warns and returns a safe fallback `{ accept: false }` (SDD Step 4: invalid
 * required arg → warn + safe fallback), so a misuse never sends an empty run or
 * collapses unexpectedly.
 */
export function submitDecision(
  input: SubmitDecisionInput,
  warn: (msg: string) => void = console.warn
): SubmitDecision {
  if (!input || typeof input.value !== 'string') {
    warn('[promptComposer] submitDecision: value must be a string; rejecting submit')
    return { accept: false }
  }
  if (input.running === true) {
    return { accept: false }
  }
  return { accept: input.value.trim().length > 0 }
}

/**
 * What happens to the typed draft when the composer is DISMISSED without submitting
 * (Esc / click-outside) — preserve it so re-opening restores the text (FR-018 / OQ-2).
 * Pure: returns the value unchanged. A non-string degrades to '' (safe fallback —
 * the composer never restores `undefined` into a controlled textarea).
 */
export function draftAfterDismiss(value: string): string {
  return typeof value === 'string' ? value : ''
}

/**
 * What happens to the typed draft after a SUCCESSFUL submit — clear it (FR-005:
 * today's composer clears `value` only on a successful submit). Pure constant ''.
 */
export function draftAfterSubmit(): string {
  return ''
}

/**
 * Whether a click whose target is/ isn't inside the composer root should collapse
 * the expanded composer (FR-008 / Edge Cases). Clicks INSIDE the composer (textarea,
 * Send, card padding) must NOT collapse; clicks anywhere else in the panel DO.
 *
 * The DOM hit-test ("is the event target inside the composer root?") stays in the
 * `.tsx`; this is just the decision, so it is node-testable. Pure.
 */
export function shouldCollapseOnOutsideClick(targetInsideComposer: boolean): boolean {
  return targetInsideComposer !== true
}

/** The inputs to the Esc-collapse decision (FR-007 / Edge Cases). */
export interface EscDecisionInput {
  /** Whether the composer is currently expanded/open. */
  open: boolean
  /**
   * Whether the composer (its textarea) is the focused element. Esc takes precedence
   * to collapse the composer ONLY while it is the open, focused element so it does
   * not steal Esc from unrelated panel handlers when it is not in play.
   */
  focused: boolean
}

/**
 * Decide whether Esc collapses the composer (FR-007 / Edge Cases). Esc collapses
 * only while the composer is the OPEN and FOCUSED element — so it takes precedence
 * over unrelated panel Esc handling while it is in play, and is inert otherwise.
 * Note: this ignores `running` (a collapse mid-run is allowed — FR-019 / OQ-3). Pure.
 */
export function escDecision(input: EscDecisionInput): boolean {
  if (!input) {
    return false
  }
  return input.open === true && input.focused === true
}

/**
 * The inputs to the surface send-spinner gate (composer-send-animation-v1 FR-005/
 * FR-006/FR-008). These are exactly the existing per-tab `GenerativeTab` signals the
 * panel already owns via `useGenerativePanelTabs` — no invented fields:
 *   - `inFlight`      — a run is correlated to this tab and awaiting its frame (FR-014).
 *   - `hasSurface`    — this tab has a landed A2UI surface (`GenerativeTab.surface != null`).
 *   - `hasError`      — this tab's run failed (`GenerativeTab.error != null`).
 *   - `loadingDefault`— a default/nav read is outstanding (Jira-only; shows the panel's
 *                       own `DefaultViewSkeleton`, so the send-spinner must defer to it).
 */
export interface SurfaceSpinnerInput {
  inFlight: boolean
  hasSurface: boolean
  hasError: boolean
  /** Optional: only Jira sets it; absent for Slack/Confluence/Generated UI tabs. */
  loadingDefault?: boolean
}

/**
 * Whether the surface send-spinner is visible for a tab (composer-send-animation-v1
 * FR-005/FR-006/FR-007/FR-008, design §4). Visible iff the tab is in-flight WITHOUT a
 * landed surface, error, or default-view skeleton:
 *
 *     inFlight && !hasSurface && !hasError && !loadingDefault
 *
 * This is the single shared gate every panel uses (FR-011), reading the ACTIVE tab's
 * record so it scopes per-tab automatically (FR-008): a non-in-flight tab hides it,
 * switching back to a still-in-flight tab re-shows it. The spinner stops the instant a
 * surface lands (FR-006: `hasSurface` → false gate) or the run errors (FR-007:
 * `hasError`), so it never persists past a terminal outcome. `loadingDefault` is
 * excluded so a Jira default/nav read shows the existing `DefaultViewSkeleton` and the
 * two never co-render (design §4.1).
 *
 * Invalid/missing input never throws: a missing object (or a non-boolean `inFlight`)
 * warns and returns the SAFE fallback `false` — the busy state never sticks on bad input
 * (SDD Step 4: invalid required arg → warn + safe fallback).
 */
export function surfaceSpinnerVisible(
  input: SurfaceSpinnerInput,
  warn: (msg: string) => void = console.warn
): boolean {
  if (!input || typeof input.inFlight !== 'boolean') {
    warn('[promptComposer] surfaceSpinnerVisible: invalid tab state; hiding spinner')
    return false
  }
  return (
    input.inFlight === true &&
    input.hasSurface !== true &&
    input.hasError !== true &&
    input.loadingDefault !== true
  )
}
