/**
 * PURE reconciliation of the transcript-sourced conversation with the LIVE in-flight run
 * (cosmos-conversation-panel-v2, step 3). Spec: FR-111.
 *
 * The Cosmos timeline has TWO sources for a turn:
 *  - the TRANSCRIPT (authority for COMPLETED turns — re-read on each completed
 *    default-target run), and
 *  - the LIVE `ui:render` / `agent:status` stream (authority for the IN-FLIGHT turn).
 *
 * When a run completes, its surface arrives BOTH live and in the re-read transcript. This
 * module merges the two so a turn is shown EXACTLY ONCE (no double-render) and no turn is
 * dropped, by appending the live provisional entry only while it is genuinely still
 * in-flight; once a transcript re-read confirms the run's surface, the provisional entry
 * is superseded by the transcript turn (keyed by surface spec identity / requestId).
 *
 * NO React/DOM import — a pure function unit-tested in node. The panel feeds it the latest
 * transcript turns + the current live state and renders the returned timeline.
 */

import type { ConversationTurn } from '../../shared/types/conversation'
import type { PromptContext } from '../../shared/promptContext/promptContext'

/**
 * The current LIVE in-flight turn, derived by the panel from the `ui:render` /
 * `agent:status` streams for the default (`'generated-ui'`) target:
 *  - `phase: 'generating'` — a run is in flight, no surface landed yet (show a working
 *    affordance).
 *  - `phase: 'surface'` — the in-flight run pushed a `ui:render` surface live; render it
 *    inline + interactive (it has a LIVE `requestId`, so controls round-trip).
 *  - `null` — no run in flight (the timeline is purely the transcript).
 */
export type LiveInFlight =
  | { phase: 'generating'; promptText?: string; promptContext?: PromptContext }
  | {
      phase: 'surface'
      requestId: string
      spec: import('../../shared/ipc/ui').A2uiSurfaceUpdate
      promptText?: string
      promptContext?: PromptContext
    }
  | null

/**
 * A rendered timeline entry. Mostly the normalized {@link ConversationTurn}s from the
 * transcript, plus optional synthetic LIVE entries for the in-flight run:
 *  - a `live-generating` working affordance, or
 *  - a `live-surface` (carrying a real `requestId` so its controls are actionable —
 *    distinct from a historical `surface` turn, whose controls are display-only no-ops).
 */
export type TimelineEntry =
  | { kind: 'turn'; turn: ConversationTurn }
  | { kind: 'live-generating'; promptText?: string; promptContext?: PromptContext }
  | { kind: 'live-surface'; requestId: string; spec: import('../../shared/ipc/ui').A2uiSurfaceUpdate }

/**
 * Reconcile the transcript turns with the live in-flight state into the rendered timeline
 * (FR-111). The transcript turns come first (chronological, completed history); the live
 * in-flight entry is appended ONLY while the run is still in flight. Once the run completes
 * and the re-read transcript carries the same surface, the panel passes `live = null` (the
 * `completed` status cleared it) so the surface shows exactly once — from the transcript.
 *
 * A `live.phase === 'surface'` whose spec already appears as the LAST transcript surface
 * turn (same `surfaceId`) is treated as already-confirmed and NOT re-appended (defensive
 * against a transcript re-read racing ahead of the status clear), so there is no
 * double-render even if both arrive.
 */
export function reconcileTimeline(
  turns: ConversationTurn[],
  live: LiveInFlight
): TimelineEntry[] {
  const entries: TimelineEntry[] = turns.map((turn) => ({ kind: 'turn', turn }))
  if (!live) {
    return entries
  }
  if (live.phase === 'generating') {
    entries.push({
      kind: 'live-generating',
      promptText: live.promptText,
      promptContext: live.promptContext
    })
    return entries
  }
  // live.phase === 'surface': suppress if the transcript already carries this exact surface
  // (last surface turn with the same surfaceId) — avoids a double-render on a racing re-read.
  const liveSurfaceId = live.spec.surfaceId
  const alreadyInTranscript = turns.some(
    (t) => t.kind === 'surface' && t.spec.surfaceId === liveSurfaceId
  )
  if (!alreadyInTranscript) {
    entries.push({ kind: 'live-surface', requestId: live.requestId, spec: live.spec })
  }
  return entries
}
