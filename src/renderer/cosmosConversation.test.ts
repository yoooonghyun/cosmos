import { describe, it, expect } from 'vitest'
import { reconcileTimeline, type LiveInFlight } from './cosmosConversation'
import type { ConversationTurn } from '../shared/types/conversation'

const userTurn: ConversationTurn = { kind: 'user-prompt', id: 'u1', ts: '1', text: 'hi' }
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
    const out = reconcileTimeline([userTurn], live)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ kind: 'turn', turn: userTurn })
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

  it('shows the surface EXACTLY ONCE when the transcript already carries it (no double-render — FR-111)', () => {
    // The completed run is already reconciled into the transcript (surfaceTurn, surfaceId
    // 'surf-A'); a racing live 'surface' with the SAME surfaceId must be suppressed.
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
    expect(surfaceEntries[0]).toEqual({ kind: 'turn', turn: surfaceTurn })
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
})
