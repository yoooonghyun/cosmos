/**
 * Pure settings status-dot gating (settings-visual-v1, defect #1).
 *
 * No React/DOM imports — just the rule for WHEN the per-integration status dot
 * renders in the Settings side-nav. The dot signals the LIVE connection, so it
 * shows whenever the integration is anything other than not-connected — it is
 * independent of the "Show in sidebar" (`enabled`) preference. Kept node-testable
 * (.ts) so SettingsDialog.tsx stays a thin shell over this rule.
 */

/** The shared connection state vocabulary across all four integration managers. */
export type ConnectionState = 'not_connected' | 'connecting' | 'connected' | 'reconnect_needed'

/**
 * Whether the side-nav status dot should render for a given live connection
 * state. Gated on CONNECTION, not enablement: a connected-but-not-shown
 * integration (e.g. Google Calendar with "Show in sidebar" OFF) still signals
 * its connection (defect #1). Only `not_connected` hides the dot.
 */
export function shouldShowStatusDot(state: ConnectionState): boolean {
  return state !== 'not_connected'
}
