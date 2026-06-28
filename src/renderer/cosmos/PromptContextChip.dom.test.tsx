/**
 * jsdom render tests for the read-only timeline PromptContextChip
 * (cosmos-timeline-prompt-context-v1, design §1/§4 + FR-021/FR-023).
 *
 * Asserts the dimension permutations (panel always; tab/dock only when present, all four dock
 * kinds), the slack thread sub-segment, the absent → renders-nothing state, and that no raw
 * `<cosmos:context>` marker text reaches the surface.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PromptContextChip } from './PromptContextChip'
import { CosmosTimelineEntry } from './CosmosTimelineEntry'
import type { TimelineEntry } from './cosmosConversation'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import {
  serializePromptContextMarker,
  parsePromptContextMarker
} from '../../shared/promptContext/promptContextMarker'
import type { ConversationTurn } from '../../shared/types/conversation'

function renderChip(context?: PromptContext) {
  return render(
    <TooltipProvider>
      <PromptContextChip context={context} />
    </TooltipProvider>
  )
}

function renderEntry(entry: TimelineEntry) {
  return render(
    <TooltipProvider>
      <CosmosTimelineEntry entry={entry} />
    </TooltipProvider>
  )
}

describe('PromptContextChip', () => {
  it('renders nothing when context is undefined (FR-021)', () => {
    const { container } = renderChip(undefined)
    expect(container).toBeEmptyDOMElement()
  })

  it('panel only: shows the panel label, no tab/dock', () => {
    renderChip({ panel: { id: 'jira', label: 'Jira' } })
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveAttribute('aria-label', 'Prompt context: Jira panel')
  })

  it('panel + tab: shows both, no dock (FR-023)', () => {
    renderChip({ panel: { id: 'jira', label: 'Jira' }, tab: { id: 't1', label: 'Sprint board' } })
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByText('Sprint board')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveAttribute(
      'aria-label',
      'Prompt context: Jira panel, Sprint board tab'
    )
  })

  it('panel + tab + jira dock: shows the issue KEY (no fabricated title)', () => {
    renderChip({
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 't1', label: 'Sprint board' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
    })
    expect(screen.getByText('PROJ-123')).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveAttribute(
      'aria-label',
      'Prompt context: Jira panel, Sprint board tab, Jira issue PROJ-123'
    )
  })

  it('slack dock with a thread: shows the channel AND the Thread sub-segment', () => {
    renderChip({
      panel: { id: 'slack', label: 'Slack' },
      tab: { id: 't2', label: 'Channels' },
      dock: {
        kind: 'slack-channel',
        selectedChannelId: 'C0123',
        selectedChannelName: 'general',
        threadTs: '1700000000.0001'
      }
    })
    expect(screen.getByText('#general')).toBeInTheDocument()
    expect(screen.getByText('Thread')).toBeInTheDocument()
    expect(screen.getByRole('note').getAttribute('aria-label')).toContain('thread')
  })

  it('confluence dock: shows the page title', () => {
    renderChip({
      panel: { id: 'confluence', label: 'Confluence' },
      dock: { kind: 'confluence-page', selectedPageId: 'P9', selectedPageTitle: 'Release notes' }
    })
    expect(screen.getByText('Release notes')).toBeInTheDocument()
  })

  it('calendar dock: shows the event title', () => {
    renderChip({
      panel: { id: 'google-calendar', label: 'Google Calendar' },
      dock: { kind: 'calendar-event', selectedEventId: 'E5', selectedEventTitle: 'Standup' }
    })
    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('panel + dock without a tab still renders the dock', () => {
    renderChip({
      panel: { id: 'jira', label: 'Jira' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-7' }
    })
    expect(screen.getByText('PROJ-7')).toBeInTheDocument()
  })

  it('never surfaces raw marker syntax (FR-025)', () => {
    const { container } = renderChip({
      panel: { id: 'jira', label: 'Jira' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-1' }
    })
    expect(container.innerHTML).not.toContain('<cosmos:context>')
    expect(container.textContent).not.toContain('cosmos:context')
  })
})

/**
 * The HISTORICAL user-prompt turn rendered through `CosmosTimelineEntry`
 * (cosmos-context-chip-position-and-historical-v1).
 *
 * #1 regression guard: a COMPLETED turn whose transcript carried a `<cosmos:context>` marker is
 * parsed (by `transcriptParse`, covered node-side) into `turn.context`, so the chip MUST render on
 * the historical turn — not only on the live (generating) turn. Locks the live-only regression
 * (the marker was once silently wiped from `CosmosPanel`, so completed turns lost their chip).
 *
 * #2 ordering: the chip sits ABOVE the bubble (chip → bubble) in the historical branch too.
 */
describe('CosmosTimelineEntry — historical user-prompt turn', () => {
  const historicalContext: PromptContext = {
    panel: { id: 'jira', label: 'Jira' },
    tab: { id: 't1', label: 'Sprint board' },
    dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
  }

  it('renders the chip on a HISTORICAL turn carrying a parsed context (#1, not live-only)', () => {
    renderEntry({
      kind: 'turn',
      turn: {
        kind: 'user-prompt',
        id: 'u1',
        ts: '2026-01-01T00:00:00Z',
        text: 'summarize this ticket',
        context: historicalContext
      }
    })
    // The chip (role="note") IS present on the completed turn…
    const chip = screen.getByRole('note')
    expect(chip).toBeInTheDocument()
    expect(screen.getByText('PROJ-123')).toBeInTheDocument()
    // …and it sits ABOVE the bubble (chip → bubble in DOM order — #2).
    const bubble = screen.getByText('summarize this ticket')
    expect(chip.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders a bare bubble (no chip) on a historical turn with no context (FR-021)', () => {
    renderEntry({
      kind: 'turn',
      turn: { kind: 'user-prompt', id: 'u2', ts: '2026-01-01T00:00:00Z', text: 'hello there' }
    })
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

/**
 * #1 FAITHFUL round-trip guard (cosmos-context-chip-crosspanel-and-historical-v1).
 *
 * The prior historical guard above INJECTS `turn.context` directly, so it proves the chip RENDERS
 * but NOT the marker→parse→chip round-trip — it cannot catch a real codec/parse break. This guard
 * drives the WHOLE chain with the REAL codec, never a hand-built `turn.context`:
 *
 *   serializePromptContextMarker(jiraCtx)  → append to the utterance (the submit-side string)
 *     → parsePromptContextMarker(text)  (the EXACT read-side codec `parseTranscript` delegates to —
 *        cf. transcriptParse.ts: a string-content user line is fed straight through it)
 *       → build the `user-prompt` turn from the parser's `{context, text}` output (NOT injected),
 *         mirroring parseTranscript's mapping
 *         → render through CosmosTimelineEntry
 *           → the chip MUST show THAT panel (Jira) + the stripped CLEAN prose
 *
 * The jsonl line extraction around the codec is covered node-side (`transcriptParse.test.ts`); the
 * `.ts`/`.test.ts` project split keeps a renderer dom test from importing the main-side parser, so
 * we drive the shared codec it delegates to. Locks the round-trip for a NON-cosmos panel (the
 * user's doubt was a Jira/Slack submit chip) and asserts the raw marker never reaches the surface.
 */
describe('historical chip — REAL marker round-trip (non-cosmos panel)', () => {
  /**
   * Run a captured PromptContext through the REAL submit→read codec, building the `user-prompt`
   * turn exactly as `parseTranscript` does (from the parser's `{context, text}` output — never a
   * hand-built context). Returns the turn the timeline would carry for that historical prompt.
   */
  function roundTripTurn(utterance: string, ctx: PromptContext): ConversationTurn {
    // Submit side (channel b): the trailing <cosmos:context> block appended to the prose.
    const marker = serializePromptContextMarker(ctx)
    expect(marker).not.toBe('') // the codec produced a real marker for this context
    // Read side: the same codec parseTranscript feeds a string-content user line through.
    const parsed = parsePromptContextMarker(utterance + marker)
    return {
      kind: 'user-prompt',
      id: 'rt-1',
      ts: '2026-06-28T00:00:00Z',
      text: parsed.text,
      ...(parsed.context ? { context: parsed.context } : {})
    }
  }

  it('a JIRA-context marker round-trips through the REAL codec into a Jira chip', () => {
    const jiraContext: PromptContext = {
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 't1', label: 'Sprint board' },
      dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
    }
    const utterance = 'summarize this ticket'
    const turn = roundTripTurn(utterance, jiraContext)
    if (turn.kind !== 'user-prompt') {
      throw new Error('expected a user-prompt turn')
    }
    // The parser recovered the Jira context from the marker (the round-trip, not an injection)…
    expect(turn.context?.panel.id).toBe('jira')
    // …and stripped the marker so the bubble text is the clean prose.
    expect(turn.text).toBe(utterance)

    // Render the PARSED turn — the chip shows the Jira panel + the open issue, clean prose, no marker.
    renderEntry({ kind: 'turn', turn })
    const chip = screen.getByRole('note')
    expect(chip).toBeInTheDocument()
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByText('Sprint board')).toBeInTheDocument()
    expect(screen.getByText('PROJ-123')).toBeInTheDocument()
    expect(screen.getByText(utterance)).toBeInTheDocument()
    // The panel is Jira, never the cosmos default.
    expect(screen.queryByText('Cosmos')).not.toBeInTheDocument()
    // The raw marker is never surfaced (FR-025).
    expect(document.body.textContent ?? '').not.toContain('cosmos:context')
    expect(document.body.innerHTML).not.toContain('<cosmos:context>')
  })

  it('a Slack-channel marker round-trips into a Slack #channel chip', () => {
    const slackContext: PromptContext = {
      panel: { id: 'slack', label: 'Slack' },
      tab: { id: 't2', label: 'Channels' },
      dock: {
        kind: 'slack-channel',
        selectedChannelId: 'C0123',
        selectedChannelName: 'general'
      }
    }
    const utterance = 'recap this channel'
    const turn = roundTripTurn(utterance, slackContext)
    if (turn.kind !== 'user-prompt') {
      throw new Error('expected a user-prompt turn')
    }
    expect(turn.context?.panel.id).toBe('slack')
    expect(turn.text).toBe(utterance)

    renderEntry({ kind: 'turn', turn })
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('#general')).toBeInTheDocument()
    expect(screen.queryByText('Cosmos')).not.toBeInTheDocument()
  })
})
