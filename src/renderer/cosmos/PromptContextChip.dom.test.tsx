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
import type { PromptContext } from '../../shared/promptContext/promptContext'

function renderChip(context?: PromptContext) {
  return render(
    <TooltipProvider>
      <PromptContextChip context={context} />
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
