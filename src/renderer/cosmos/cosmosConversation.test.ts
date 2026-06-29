import { describe, it, expect } from 'vitest'
import { reconcileTimeline, type LiveInFlight } from './cosmosConversation'
import type { ConversationTurn } from '../../shared/types/conversation'

const userTurn: ConversationTurn = { kind: 'user-prompt', id: 'u1', ts: '1', text: 'hi' }
// A PRE-CATCH-UP transcript ends in the prior run's RESPONSE (assistant/surface), never a bare
// trailing user-prompt (cosmos-streaming-duplicate-context-chip-v1): a transcript whose last turn
// is a user-prompt means a run's prompt just landed → the provisional is suppressed. So tests that
// assert the provisional STILL shows must feed a transcript ending in a non-user-prompt turn.
const priorAssistantTurn: ConversationTurn = {
  kind: 'assistant-text',
  id: 'a0',
  ts: '1',
  text: 'previous answer'
}
const surfaceTurn: ConversationTurn = {
  kind: 'surface',
  id: 's1',
  ts: '2',
  spec: { surfaceId: 'surf-A', components: [] }
}

describe('reconcileTimeline', () => {
  it('returns just the transcript turns when no run is in flight', () => {
    const out = reconcileTimeline([userTurn], null)
    expect(out).toEqual([{ kind: 'turn', turn: userTurn }])
  })

  it('appends a live-generating affordance while a run is in flight (FR-111)', () => {
    const live: LiveInFlight = { phase: 'generating', promptText: 'make a button' }
    // Pre-catch-up transcript (ends in the prior response) → the provisional bubble shows.
    const out = reconcileTimeline([priorAssistantTurn], live)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ kind: 'turn', turn: priorAssistantTurn })
    expect(out[1]).toEqual({ kind: 'live-generating', promptText: 'make a button' })
  })

  it('appends a live-surface (with requestId) for an in-flight surface not yet in the transcript', () => {
    const live: LiveInFlight = {
      phase: 'surface',
      requestId: 'req-1',
      spec: { surfaceId: 'surf-B', components: [] }
    }
    const out = reconcileTimeline([userTurn], live)
    expect(out[1]).toEqual({ kind: 'live-surface', requestId: 'req-1', spec: live.spec })
  })

  it('shows the surface EXACTLY ONCE when the transcript already carries it — the LIVE interactive copy wins while in-flight (no double-render — FR-111)', () => {
    // cosmos-agent-progress-not-streaming-v1: an incremental mid-run push can land the surface in
    // the transcript WHILE the run is still in flight (live='surface'). The surface must show once
    // AND stay the LIVE interactive entry (its controls round-trip via the live requestId) — the
    // transcript's display-only copy is dropped until the run completes (live cleared). Pre-fix the
    // transcript copy won mid-run, which deadlocked a surface still awaiting the user's action.
    const live: LiveInFlight = {
      phase: 'surface',
      requestId: 'req-2',
      spec: { surfaceId: 'surf-A', components: [] }
    }
    const out = reconcileTimeline([userTurn, surfaceTurn], live)
    const surfaceEntries = out.filter(
      (e) => e.kind === 'live-surface' || (e.kind === 'turn' && e.turn.kind === 'surface')
    )
    expect(surfaceEntries).toHaveLength(1)
    expect(surfaceEntries[0]).toEqual({ kind: 'live-surface', requestId: 'req-2', spec: live.spec })
  })

  // cosmos-agent-progress-not-streaming-v1: while a run STREAMS, the transcript catches up and
  // gains the user-prompt turn. The provisional live bubble (same text) must then be suppressed so
  // the prompt renders EXACTLY ONCE (from the transcript) — only the spinner remains live.
  it('suppresses the provisional live prompt bubble once the transcript carries the matching prompt (no double bubble)', () => {
    const streamedPrompt: ConversationTurn = {
      kind: 'user-prompt',
      id: 'u9',
      ts: '5',
      text: 'make a chart'
    }
    const live: LiveInFlight = { phase: 'generating', promptText: 'make a chart' }
    const out = reconcileTimeline([streamedPrompt], live)
    // The transcript prompt turn shows; the live entry is a BARE spinner (no promptText) — so the
    // prompt bubble is not double-rendered.
    expect(out[0]).toEqual({ kind: 'turn', turn: streamedPrompt })
    expect(out[1]).toEqual({ kind: 'live-generating' })
  })

  // cosmos-streaming-duplicate-context-chip-v1: the suppression MUST be robust to a CROSS-PANEL
  // submit, where the live seed's `promptText` is UNDEFINED (CosmosPanel.lastPromptRef is cosmos-
  // only) but a `promptContext` IS present (the shared cross-panel ref). Once the transcript ends
  // with the run's user-prompt turn, the live entry must contribute ONLY the spinner — NO
  // promptContext (and no promptText) — so the prompt's context chip renders exactly once (from the
  // transcript), not twice. RED before the fix: the old exact-text gate (`promptText !== undefined`)
  // was false → the live `promptContext` chip duplicated the transcript turn's chip.
  it('suppresses the provisional chip for a CROSS-PANEL run (undefined promptText) once the transcript carries the prompt', () => {
    const streamedPrompt: ConversationTurn = {
      kind: 'user-prompt',
      id: 'u9',
      ts: '5',
      text: 'summarize this ticket',
      context: { panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Sprint board' } }
    }
    const live: LiveInFlight = {
      phase: 'generating',
      // promptText UNDEFINED (the cross-panel seed) but a context IS present.
      promptContext: { panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Sprint board' } }
    }
    const out = reconcileTimeline([streamedPrompt], live)
    // The live entry is a BARE spinner — NO promptContext, NO promptText — so no duplicate chip.
    expect(out[1]).toEqual({ kind: 'live-generating' })
  })

  // cosmos-streaming-duplicate-context-chip-v1 (baseline fix): the WHOLE-STREAM case. Once the run's
  // ASSISTANT/TOOL turns stream into the transcript, its LAST turn is no longer the user-prompt and
  // (cross-panel) `promptText` is undefined — so the `last.kind`/text guards BOTH fail. The panel-
  // captured `baseline` (transcript count at run start) catches it: `turns.length > baseline` means
  // the transcript already carries this run's prompt + streamed turns → suppress ENTIRELY (spinner
  // only), so NO empty context-only bubble appears. RED before the baseline check.
  it('suppresses the provisional ENTIRELY mid-stream via baseline when the last turn is NOT a user-prompt (cross-panel, no empty bubble)', () => {
    const turns: ConversationTurn[] = [
      // baseline=1 was the transcript at run start (this prior turn). The run then appended its
      // user-prompt + an assistant turn, so length is now 3 (> baseline) and the LAST turn is
      // assistant-text (NOT user-prompt).
      { kind: 'assistant-text', id: 'a0', ts: '0', text: 'previous answer' },
      {
        kind: 'user-prompt',
        id: 'u1',
        ts: '1',
        text: 'summarize this ticket',
        context: { panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Sprint board' } }
      },
      { kind: 'assistant-text', id: 'a1', ts: '2', text: 'Reading the ticket now' }
    ]
    const live: LiveInFlight = {
      phase: 'generating',
      // Cross-panel seed: promptText undefined, promptContext set, baseline captured at run start.
      promptContext: { panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Sprint board' } },
      baseline: 1
    }
    const out = reconcileTimeline(turns, live)
    // No promptText AND no promptContext on the live entry → no empty context-only bubble.
    expect(out[out.length - 1]).toEqual({ kind: 'live-generating' })
  })

  it('still shows the provisional when the baseline has NOT yet grown (length === baseline, transcript not caught up)', () => {
    // PRE-CATCH-UP: the transcript is exactly the run-start snapshot (length === baseline) — the run
    // has not written its prompt yet — so the provisional bubble+chip must show instantly (FR-024).
    const turns: ConversationTurn[] = [
      { kind: 'assistant-text', id: 'a0', ts: '0', text: 'previous answer' }
    ]
    const live: LiveInFlight = {
      phase: 'generating',
      promptContext: { panel: { id: 'jira', label: 'Jira' } },
      baseline: 1 // === turns.length → not yet grown
    }
    const out = reconcileTimeline(turns, live)
    expect(out[1]).toEqual({
      kind: 'live-generating',
      promptContext: { panel: { id: 'jira', label: 'Jira' } }
    })
  })

  it('keeps the provisional live bubble + chip while the transcript has NOT yet caught up (ends in the prior run response)', () => {
    // PRE-STREAM: the transcript still ends with the PRIOR run's assistant response — the new
    // run's user-prompt is not in it yet — so the provisional bubble+chip must remain visible (the
    // user must see their utterance instantly on Enter — FR-024). A COMPLETED prior run always ends
    // in its assistant/surface turn, never a bare trailing user-prompt, so this is the real
    // pre-catch-up shape.
    const priorResponse: ConversationTurn = {
      kind: 'assistant-text',
      id: 'a7',
      ts: '4',
      text: 'done with the last one'
    }
    const live: LiveInFlight = {
      phase: 'generating',
      promptText: 'brand new prompt',
      promptContext: { panel: { id: 'cosmos', label: 'Cosmos' } }
    }
    const out = reconcileTimeline([priorResponse], live)
    expect(out[1]).toEqual({
      kind: 'live-generating',
      promptText: 'brand new prompt',
      promptContext: { panel: { id: 'cosmos', label: 'Cosmos' } }
    })
  })

  it('keeps earlier turns intact when the run completes (live cleared — FR-111)', () => {
    // On completion the panel passes live=null; the surface now comes from the transcript.
    const out = reconcileTimeline([userTurn, surfaceTurn], null)
    expect(out).toEqual([
      { kind: 'turn', turn: userTurn },
      { kind: 'turn', turn: surfaceTurn }
    ])
  })

  it('a completed run with no surface leaves no spinner (live cleared, no synthetic entry)', () => {
    const out = reconcileTimeline([userTurn], null)
    expect(out.some((e) => e.kind === 'live-generating' || e.kind === 'live-surface')).toBe(false)
  })

  // cosmos-timeline-prompt-context-v1 (FR-024): the captured PromptContext rides the live
  // 'generating' entry so the chip appears immediately on submit and stays stable on confirm.
  it('carries promptContext through to the live-generating entry (FR-024)', () => {
    const live: LiveInFlight = {
      phase: 'generating',
      promptText: 'summarize this ticket',
      promptContext: {
        panel: { id: 'jira', label: 'Jira' },
        tab: { id: 't1', label: 'Sprint board' },
        dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
      }
    }
    // Pre-catch-up transcript (ends in the prior response) → the provisional chip+bubble shows.
    const out = reconcileTimeline([priorAssistantTurn], live)
    expect(out[1]).toEqual({
      kind: 'live-generating',
      promptText: 'summarize this ticket',
      promptContext: live.promptContext
    })
  })
})
