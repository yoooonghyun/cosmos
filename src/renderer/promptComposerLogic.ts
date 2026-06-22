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

/**
 * The inputs to the terminal-`completed` in-flight release decision
 * (open-prompt-spinner-gating-v1 FR-001/FR-002/FR-004/FR-008). All from state the
 * `agent:status` handler already holds:
 *   - `inFlight`        — whether the originating tab is still awaiting a frame.
 *   - `hasSurface`      — whether that tab already has a landed surface (`surface != null`).
 *   - `producedSurface` — the non-secret signal off the `completed` status: `true` ⇒ this
 *                         run pushed a `generated-ui` surface (it has/will land via
 *                         `ui:render`, which clears `inFlight`); otherwise (false OR
 *                         ABSENT) the run produced no surface.
 */
export interface TerminalReleaseInput {
  inFlight: boolean
  hasSurface: boolean
  /** Present only on `completed`; absent ⇒ unknown (fall back to surface-presence). */
  producedSurface?: boolean
}

/**
 * Whether a terminal `completed` status MUST clear the originating tab's `inFlight`
 * (open-prompt-spinner-gating-v1, FR-004 — the root-cause fix). A plain command's run
 * completes WITHOUT pushing a surface, so it must release the tab (stopping the permanent
 * "Generating…"); a true UI-generation run's surface already cleared `inFlight` when it
 * landed, so this is a no-op for it.
 *
 * Release iff the tab is still in-flight, has NO surface, AND the run did not produce a
 * surface. `producedSurface === true` ⇒ a surface was/will be pushed ⇒ do NOT release
 * (let the `ui:render` path own it). When `producedSurface` is ABSENT (an old/partial
 * payload), fall back to surface-presence: release only when there is no surface — so a
 * real UI run (which has a surface by `completed`) is never wrongly released (FR-008).
 *
 * Invalid/missing input never throws: a missing object (or a non-boolean `inFlight`)
 * warns and returns the SAFE fallback `false` — never releasing on bad input (SDD Step 4).
 */
export function shouldReleaseInFlightOnCompleted(
  input: TerminalReleaseInput,
  warn: (msg: string) => void = console.warn
): boolean {
  if (!input || typeof input.inFlight !== 'boolean') {
    warn('[promptComposer] shouldReleaseInFlightOnCompleted: invalid tab state; not releasing')
    return false
  }
  return input.inFlight === true && input.hasSurface !== true && input.producedSurface !== true
}

/**
 * Whether a freshly-submitted tab should enter the per-tab `inFlight` (spinner) state at
 * SEND time (ui-catalog-pull-spinner-signal-v1 — "spinner ON only when UI generation begins,
 * OFF for a plain MCP run").
 *
 * THE EVENT MODEL (now with a TRUE early signal). The render MCP surface is split into
 * `get_ui_catalog()` + `render_ui(spec)`: the agent MUST pull the catalog before it can
 * author a surface, and that pull fires a non-secret `ui:generatingBegin` IPC frame the
 * MOMENT generation begins — BEFORE the surface is composed. So the renderer no longer needs
 * to spin optimistically at submit; it gates the spinner on that EARLY begin-signal instead.
 *
 * Decision: submit does NOT optimistically engage the spinner (this returns `false`). The
 * per-tab `inFlight` is turned ON by the `ui:generatingBegin` subscription for the originating
 * tab (see `useGenerativePanelTabs`), and turned OFF by the existing stop conditions: the
 * `ui:render` surface land OR the `completed`/`error` run-end release
 * ({@link shouldReleaseInFlightOnCompleted}). A plain MCP/command run never pulls the catalog,
 * so it never emits the begin-signal and never shows the spinner — eliminating the prior
 * residual flicker. The composer stays INTERACTIVE throughout
 * ({@link composerInteractiveAfterSubmit}) — the spinner lives on the SURFACE, never locks input.
 *
 * Pure constant `false` (submit no longer optimistically spins; the begin-signal is the gate).
 * Kept as a named, documented, node-testable helper.
 */
export function inFlightOnSubmit(): boolean {
  return false
}

/**
 * Whether the Open Prompt composer stays INTERACTIVE (typeable + sendable) immediately
 * after an accepted submit (open-prompt-spinner-gating — "non-UI submit must not block").
 *
 * THE BLOCK: on submit the composer set a local `running` flag (and `agent:status`
 * `started` keeps it set) that stays true for the ENTIRE agent run — only cleared on
 * `completed`/`error`. While `running`, the reopened composer is dead: the textarea is
 * `disabled`, the Send button is disabled (`canSubmit = !running && …`), and
 * `submitDecision` rejects (`running === true`). So after a plain fire-and-forget submit the
 * user can reopen the logo but cannot type or send again until the run ends — a long plain
 * command effectively blocks the UI.
 *
 * Decision: a plain submit is fire-and-forget — the composer returns to a usable state
 * immediately. Since there is NO early "this will generate UI" signal (the only UI signal is
 * the `ui:render` surface landing later, which renders in the surface area and never locks
 * the composer), default to INTERACTIVE. If a surface lands later it still renders; the
 * composer is never locked for the run's duration.
 *
 * Pure constant `true` (nothing at send time should disable the composer for the run). Kept
 * as a named, documented, node-testable helper — the dual of {@link inFlightOnSubmit}.
 */
export function composerInteractiveAfterSubmit(): boolean {
  return true
}

/**
 * The "Sent" hint state (open-prompt-spinner-gating-v1, OQ-3). A transient, non-blocking
 * acknowledgement for a PLAIN (non-spinner) submit now that the "Generating…" blocking
 * spinner is suppressed for a no-surface run. It NEVER sets `busy` (the composer stays
 * visible) and NEVER blocks the panel — it is display-only feedback that auto-dismisses.
 */
export interface SentHintState {
  /** Whether the transient "Sent" hint is currently shown. */
  visible: boolean
}

/** How long the transient "Sent" hint stays visible before auto-dismissing (ms). */
export const SENT_HINT_DURATION_MS = 1500

/**
 * The "Sent" hint shown after an accepted submit (OQ-3). Returns `{ visible: true }` only
 * when a submit was actually accepted (so a rejected/no-op submit shows nothing). Pure:
 * the DOM/timer auto-dismiss binding lives in `PromptComposer.tsx`; this only decides the
 * on/off state from the submit outcome, so it is node-testable. Never sets any busy/block
 * state — the hint cannot hide the composer.
 */
export function sentHintAfterSubmit(accepted: boolean): SentHintState {
  return { visible: accepted === true }
}
