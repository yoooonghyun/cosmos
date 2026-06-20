/**
 * Pure submit-guard logic for the native Slack message composer
 * (slack-send-message-v1, design §1.1/§4). Kept framework-free in a `.ts` so it is
 * node-env unit-testable; the `.tsx` composer imports it (never the reverse —
 * `.test.ts` must not import `.tsx`).
 *
 * No token, no IPC, no React here — just the boolean rules that decide whether a
 * submit may proceed.
 */

/** Inputs that determine whether a composer submit may fire (design §1.1). */
export interface SlackComposerSubmitState {
  /** The current draft text (raw, untrimmed). */
  text: string
  /** Whether the connection's scope permits sending (FR-009/FR-010). */
  canSend: boolean
  /** Whether a send is already in flight (blocks the double-submit — FR-012). */
  sending: boolean
}

/**
 * Whether the composer may submit: scope granted, the trimmed text is non-empty,
 * and no send is already in flight (FR-003/FR-012). Drives both the send button's
 * `disabled` state and the Enter-key guard so neither can issue an empty or
 * duplicate send.
 */
export function canSubmitSlackMessage(state: SlackComposerSubmitState): boolean {
  return state.canSend && !state.sending && state.text.trim().length > 0
}
