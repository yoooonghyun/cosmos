/**
 * Pure copy/logic for the terminal exit banner (terminal-panel-v1 FR-007;
 * terminal-session-unnecessary-restart-v1). Kept in a `.ts` (no xterm/React import) so the copy
 * decisions are node-testable in isolation — the `.tsx` only does the trivial conditional render.
 */

import type { PtyExitPayload } from '../../shared/ipc'

/**
 * The one-line exit message shown in the banner. A spawn/PATH `error` (e.g. claude not found) is
 * surfaced verbatim; otherwise the exit code/signal is summarized.
 */
export function formatExit(payload: PtyExitPayload): string {
  if (payload.error) {
    return payload.error
  }
  const parts: string[] = []
  if (typeof payload.exitCode === 'number') {
    parts.push(`exit code ${payload.exitCode}`)
  }
  if (typeof payload.signal === 'number') {
    parts.push(`signal ${payload.signal}`)
  }
  return parts.length > 0 ? `claude exited (${parts.join(', ')})` : 'claude exited'
}

/**
 * terminal-session-unnecessary-restart-v1 (ARCHITECTURE.md §4.1 continue-don't-restart): an honest
 * recovery hint shown beneath the exit message when a LIVE `claude` died on its own (a process exit
 * with a code/signal — typically its API/stream connection dropping on a Mac lock/sleep, an upstream
 * claude limitation cosmos cannot prevent). Restart re-`--resume`s the SAME session so the
 * CONVERSATION is preserved, but auto-accept mode (the shift+tab TUI toggle) is process-local state
 * that cannot survive the death — so the copy says to re-enable it rather than pretend it was
 * restored. A `payload.error` (e.g. claude not found on PATH) is NOT a live-session death — there is
 * no transcript to resume — so no hint is shown for it (returns null).
 */
export function exitRecoveryHint(payload: PtyExitPayload): string | null {
  if (payload.error) {
    return null
  }
  return 'Restart resumes this conversation. Re-enable auto-accept mode (shift+tab) if you had it on — it can’t carry over a restart.'
}
