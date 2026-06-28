/**
 * Node-unit tests for `buildAgentSubmitWithMarker` — the one-source-two-channels chokepoint
 * (cosmos-timeline-prompt-context-v1, SC-010/SC-011 + FR-013/FR-017).
 *
 * Asserts: a ctx with a dock gains BOTH the trailing marker AND `viewContext` (the dock's literal
 * ViewContext fields, minus `kind`); a no-dock ctx gets the marker but no `viewContext`; and — the
 * key two-channel guarantee — an oversized/dropped marker NEVER weakens `viewContext` grounding.
 */
import { describe, it, expect } from 'vitest'
import { buildAgentSubmitWithMarker } from './buildAgentSubmit'
import { parsePromptContextMarker } from './promptContextMarker'
import type { PromptContext } from './promptContext'

const jiraCtx: PromptContext = {
  panel: { id: 'jira', label: 'Jira' },
  tab: { id: 't1', label: 'Sprint board' },
  dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
}

const cosmosCtx: PromptContext = {
  panel: { id: 'cosmos', label: 'Cosmos' },
  tab: { id: 'default', label: 'Conversation' }
}

describe('buildAgentSubmitWithMarker', () => {
  it('appends the trailing marker AND derives viewContext from the dock (FR-013/FR-017)', () => {
    const payload = buildAgentSubmitWithMarker('summarize this ticket', 'jira', jiraCtx)
    expect(payload.target).toBe('jira')
    // Channel (b): the utterance gained a trailing marker after a blank line.
    expect(payload.utterance.startsWith('summarize this ticket\n\n<cosmos:context>')).toBe(true)
    // Channel (a): viewContext is the dock's ViewContext fields, kind stripped — the EXACT shape
    // agent.submit already sends today (grounding byte-identical).
    expect(payload.viewContext).toEqual({ selectedIssueKey: 'PROJ-123' })
    // The marker round-trips the full PromptContext.
    expect(parsePromptContextMarker(payload.utterance).context).toEqual(jiraCtx)
  })

  it('a no-dock ctx → marker present, viewContext ABSENT (FR-004)', () => {
    const payload = buildAgentSubmitWithMarker('build a form', 'generated-ui', cosmosCtx)
    expect(payload.utterance).toContain('<cosmos:context>')
    expect(payload.viewContext).toBeUndefined()
    expect(parsePromptContextMarker(payload.utterance).context).toEqual(cosmosCtx)
  })

  it('GROUNDING SURVIVES a dropped (oversized) marker — viewContext still derived (SC-010)', () => {
    const huge = 'x'.repeat(5000)
    const ctx: PromptContext = {
      panel: { id: 'jira', label: 'Jira' },
      // The huge title blows the marker cap so serialize returns '' — but viewContext must persist.
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-9', selectedPageTitle: huge }
    }
    const payload = buildAgentSubmitWithMarker('do it', 'jira', ctx)
    // Marker omitted (no trailing block appended).
    expect(payload.utterance).toBe('do it')
    expect(payload.utterance).not.toContain('<cosmos:context>')
    // ...yet the authoritative grounding channel is intact (the WHOLE dock ViewContext).
    expect(payload.viewContext).toEqual({ selectedIssueKey: 'PROJ-9', selectedPageTitle: huge })
  })

  it('no ctx at all → plain utterance, no marker, no viewContext', () => {
    const payload = buildAgentSubmitWithMarker('plain', 'generated-ui')
    expect(payload.utterance).toBe('plain')
    expect(payload.viewContext).toBeUndefined()
  })

  it('the SAME object feeds both channels — they name the same item (SC-011)', () => {
    const payload = buildAgentSubmitWithMarker('x', 'slack', {
      panel: { id: 'slack', label: 'Slack' },
      dock: { kind: 'slack-channel', selectedChannelId: 'C1', selectedChannelName: 'general' }
    })
    const markerDock = parsePromptContextMarker(payload.utterance).context?.dock
    expect(markerDock?.selectedChannelId).toBe('C1')
    expect(payload.viewContext?.selectedChannelId).toBe('C1')
  })
})
