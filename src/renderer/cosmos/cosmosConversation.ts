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
 *
 * `baseline` (cosmos-streaming-duplicate-context-chip-v1): the transcript turn COUNT captured by
 * the panel at run start. Once `turns.length > baseline` the transcript has grown past where THIS
 * run began — i.e. it already carries this run's user-prompt (+ any streamed assistant/tool turns)
 * — so the provisional prompt bubble/chip is suppressed ENTIRELY (spinner only). This is the
 * robust signal that survives the whole stream (the transcript's last turn is no longer the
 * user-prompt once a response streams in) and the cross-panel case (`promptText` undefined). It is
 * re-captured per run on each `started`/submit seed, so a prior run's count never leaks.
 */
export type LiveInFlight =
  | { phase: 'generating'; promptText?: string; promptContext?: PromptContext; baseline?: number }
  | {
      phase: 'surface'
      requestId: string
      spec: import('../../shared/ipc/ui').A2uiSurfaceUpdate
      promptText?: string
      promptContext?: PromptContext
      baseline?: number
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
 * (FR-111). The transcript turns come first (chronological history); the live in-flight entry is
 * appended at the tail while the run is still in flight.
 *
 * cosmos-agent-progress-not-streaming-v1: main now pushes `conversation:update` INCREMENTALLY as
 * the transcript grows during a run (not only on completion), so the transcript can carry the
 * run's turns WHILE `live` is still set. The reconcile keeps each turn EXACTLY ONCE across that
 * overlap:
 *  - `generating`: the live prompt bubble is PROVISIONAL (it shows the utterance immediately on
 *    submit, before `claude` writes it). Once the transcript gains a matching trailing user-prompt
 *    turn, IT owns the bubble — so the provisional bubble is suppressed (only the spinner remains)
 *    to avoid a DOUBLE prompt bubble.
 *  - `surface`: while the surface is live it is AUTHORITATIVE (its controls round-trip via the live
 *    `requestId`), so a transcript surface turn with the same `surfaceId` is dropped and the live
 *    interactive surface shown — NOT the other way around. Otherwise a mid-run push would replace
 *    the still-pending interactive surface with the transcript's display-only copy, deadlocking a
 *    surface that is waiting for the user's action. On completion the panel clears `live` (=null)
 *    and the transcript's display-only surface takes over — still exactly once.
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
    // Suppress the provisional bubble + context chip once the transcript carries THIS run's
    // user-prompt turn, so the prompt (and its single marker-parsed chip) renders EXACTLY ONCE
    // from the transcript — never a SECOND chip from the live entry
    // (cosmos-streaming-duplicate-context-chip-v1).
    //
    // Robust signal — PRIMARY (cosmos-streaming-duplicate-context-chip-v1): the transcript has
    // GROWN past where this run started (`turns.length > live.baseline`), so it already carries
    // this run's user-prompt + any streamed turns. This survives the WHOLE stream (the transcript's
    // last turn is no longer the user-prompt once a response streams in → the EMPTY context-only
    // bubble bug) and the cross-panel case (`promptText` undefined). The two older checks stay as
    // belt-and-suspenders for the FIRST poll before the count is captured / the brief
    // prompt-just-landed window: the transcript's LAST turn being a `user-prompt` (a COMPLETED prior
    // run always ends in its assistant/surface response, never a bare trailing user-prompt) OR an
    // exact-text match. Pre-stream (transcript not yet grown past the baseline, ends in the prior
    // response) none hold, so the provisional bubble+chip still appears INSTANTLY on Enter (FR-024).
    const last = turns[turns.length - 1]
    const transcriptOwnsPrompt =
      (live.baseline !== undefined && turns.length > live.baseline) ||
      last?.kind === 'user-prompt' ||
      (live.promptText !== undefined && lastUserPromptText(turns) === live.promptText)
    entries.push({
      kind: 'live-generating',
      ...(transcriptOwnsPrompt
        ? {}
        : {
            ...(live.promptText !== undefined ? { promptText: live.promptText } : {}),
            ...(live.promptContext !== undefined ? { promptContext: live.promptContext } : {})
          })
    })
    return entries
  }
  // live.phase === 'surface': the live interactive surface wins over a transcript surface turn with
  // the same surfaceId (drop the transcript copy) so the surface shows once AND stays interactive
  // during the run.
  const liveSurfaceId = live.spec.surfaceId
  const deduped = entries.filter(
    (e) => !(e.kind === 'turn' && e.turn.kind === 'surface' && e.turn.spec.surfaceId === liveSurfaceId)
  )
  deduped.push({ kind: 'live-surface', requestId: live.requestId, spec: live.spec })
  return deduped
}

/** The text of the LAST user-prompt turn in the transcript, or null when there is none. */
function lastUserPromptText(turns: ConversationTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.kind === 'user-prompt') {
      return turn.text
    }
  }
  return null
}
