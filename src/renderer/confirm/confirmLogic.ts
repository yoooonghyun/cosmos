/**
 * confirmLogic — the pure, React-free, DOM-free state machine behind the shared
 * disconnect-confirm modal (disconnect-confirm-modal-v1, FR-011).
 *
 * A click on any integration's "Disconnect" affordance no longer disconnects
 * immediately; it OPENS a confirmation modal naming the integration. The actual
 * `window.cosmos.<int>.disconnect()` runs ONLY when the user confirms the modal's
 * destructive action (FR-001/FR-002). Cancel/Esc/overlay leaves the connection
 * untouched (FR-003/FR-010).
 *
 * This file holds ONLY the open/which-target state + copy builder so it is
 * node-testable without Electron or a live DOM. The `useConfirm` hook layers the
 * side-effecting `onConfirm` callback on top via a ref; the `ConfirmDialog`
 * component renders the state. Keep all logic that can be expressed without React
 * here, not inline in the hook/component.
 */

/** The integrations gated by the disconnect-confirm (the four connectable panels). */
export type ConfirmIntegration = 'slack' | 'jira' | 'confluence' | 'google-calendar'

/** What a pending confirm is about: which integration + its human label for copy. */
export interface ConfirmTarget {
  integration: ConfirmIntegration
  /** Human-facing name shown in the modal copy (e.g. 'Slack', 'Google Calendar'). */
  label: string
}

/** The pure confirm state: closed (no target) or open against one target. */
export interface ConfirmState {
  open: boolean
  target: ConfirmTarget | null
}

/** The closed/initial state — no modal, no target. */
export const closedConfirmState: ConfirmState = { open: false, target: null }

/** Open the confirm against a target (pure reducer). */
export function openConfirm(target: ConfirmTarget): ConfirmState {
  return { open: true, target }
}

/** Close the confirm and clear the target (pure reducer). */
export function closeConfirm(): ConfirmState {
  return closedConfirmState
}

/** The copy rendered in the modal — title, body, and the destructive action label. */
export interface ConfirmCopy {
  title: string
  body: string
  confirmLabel: string
}

/**
 * Build the integration-named copy (FR-005). One `label` drives every string so
 * there is no per-integration copy duplication: "Disconnect <Integration>?" with a
 * body explaining a reconnect is needed, consistent in tone with the Settings
 * Save-confirm "you'll need to reconnect" warning (FR-009).
 */
export function confirmCopy(label: string): ConfirmCopy {
  return {
    title: `Disconnect ${label}?`,
    body: `You'll need to reconnect to use ${label} again.`,
    confirmLabel: 'Disconnect'
  }
}
