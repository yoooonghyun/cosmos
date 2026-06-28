import { describe, it, expect } from 'vitest'
import {
  jiraViewContext,
  slackViewContext,
  confluenceViewContext,
  calendarViewContext,
  contextChipFor
} from './viewContextCapture'

/**
 * open-prompt-view-context-v1 — pure capture mappers (FR-004/FR-005/FR-010/FR-011).
 * Each maps a panel's EXISTING view state → a non-secret `ViewContext` (or undefined when
 * nothing is selected). Node-testable: no React/DOM imports.
 */

describe('jiraViewContext (FR-004/FR-005)', () => {
  it('maps the open detail dock issue key → selectedIssueKey (populated)', () => {
    expect(jiraViewContext('PROJ-123')).toEqual({ selectedIssueKey: 'PROJ-123' })
  })

  it('returns undefined when no issue detail is open (list view only — FR-005)', () => {
    expect(jiraViewContext(null)).toBeUndefined()
  })

  it('returns undefined for an empty/whitespace key (never a dangling id)', () => {
    expect(jiraViewContext('')).toBeUndefined()
    expect(jiraViewContext('   ')).toBeUndefined()
  })
})

describe('slackViewContext (FR-004/FR-005)', () => {
  it('maps a history view → channel id + name (no thread)', () => {
    const ctx = slackViewContext({ kind: 'history', channel: { id: 'C1', name: 'general' } }, null)
    expect(ctx).toEqual({ selectedChannelId: 'C1', selectedChannelName: 'general' })
  })

  it('includes threadTs when a thread dock is open', () => {
    const ctx = slackViewContext(
      { kind: 'history', channel: { id: 'C1', name: 'general' } },
      { channelId: 'C1', threadTs: '1700000000.0001' }
    )
    expect(ctx).toEqual({
      selectedChannelId: 'C1',
      selectedChannelName: 'general',
      threadTs: '1700000000.0001'
    })
  })

  it('omits the channel name when absent (id only, no fabricated label)', () => {
    const ctx = slackViewContext({ kind: 'history', channel: { id: 'C1', name: '' } }, null)
    expect(ctx).toEqual({ selectedChannelId: 'C1' })
  })

  it('returns undefined on the channel-list view (no channel open — FR-005)', () => {
    expect(slackViewContext({ kind: 'channels' }, null)).toBeUndefined()
  })

  it('returns undefined on the search view (no channel open)', () => {
    expect(slackViewContext({ kind: 'search', query: 'hi' }, null)).toBeUndefined()
  })
})

describe('confluenceViewContext (FR-004/FR-005)', () => {
  it('maps a native page view → page id + title', () => {
    const ctx = confluenceViewContext({ kind: 'page', pageId: 'p1', title: 'Release notes' }, null)
    expect(ctx).toEqual({ selectedPageId: 'p1', selectedPageTitle: 'Release notes' })
  })

  it('maps the gen-UI page overlay → page id + title (overlay takes precedence)', () => {
    const ctx = confluenceViewContext(
      { kind: 'search' },
      { pageId: 'p2', title: 'Onboarding' }
    )
    expect(ctx).toEqual({ selectedPageId: 'p2', selectedPageTitle: 'Onboarding' })
  })

  it('returns undefined on the search/list view with no page open (FR-005)', () => {
    expect(confluenceViewContext({ kind: 'search' }, null)).toBeUndefined()
  })

  it('omits the title when absent (id only)', () => {
    const ctx = confluenceViewContext({ kind: 'page', pageId: 'p1', title: '' }, null)
    expect(ctx).toEqual({ selectedPageId: 'p1' })
  })
})

describe('calendarViewContext (FR-004/FR-005)', () => {
  it('maps a selected event → event id + title', () => {
    expect(calendarViewContext({ id: 'e1', summary: 'Sprint planning' })).toEqual({
      selectedEventId: 'e1',
      selectedEventTitle: 'Sprint planning'
    })
  })

  it('omits the title when the event has no summary (id only)', () => {
    expect(calendarViewContext({ id: 'e1' })).toEqual({ selectedEventId: 'e1' })
  })

  it('returns undefined when no event is selected (FR-005)', () => {
    expect(calendarViewContext(null)).toBeUndefined()
  })

  it('returns undefined when the selected event has no id (no dangling selection)', () => {
    expect(calendarViewContext({ summary: 'No id' })).toBeUndefined()
  })
})

describe('contextChipFor — display descriptor for the composer chip (design §3/§6)', () => {
  it('jira → a single jira chip labelled by the issue key', () => {
    expect(contextChipFor('jira', { selectedIssueKey: 'PROJ-123' })).toEqual({
      kind: 'item',
      primary: { kind: 'jira', label: 'PROJ-123' }
    })
  })

  it('slack channel-only → one slack-channel chip labelled #name', () => {
    expect(
      contextChipFor('slack', { selectedChannelId: 'C1', selectedChannelName: 'general' })
    ).toEqual({ kind: 'item', primary: { kind: 'slack-channel', label: '#general' } })
  })

  it('slack channel falls back to the id when the name is absent', () => {
    expect(contextChipFor('slack', { selectedChannelId: 'C1' })).toEqual({
      kind: 'item',
      primary: { kind: 'slack-channel', label: 'C1' }
    })
  })

  it('slack channel + thread → primary channel chip + secondary thread chip', () => {
    expect(
      contextChipFor('slack', {
        selectedChannelId: 'C1',
        selectedChannelName: 'general',
        threadTs: '1700000000.0001'
      })
    ).toEqual({
      kind: 'item',
      primary: { kind: 'slack-channel', label: '#general' },
      secondary: { kind: 'slack-thread', label: 'Thread' }
    })
  })

  it('confluence → a page chip labelled by the title (full label carried for the tooltip)', () => {
    expect(
      contextChipFor('confluence', { selectedPageId: 'p1', selectedPageTitle: 'Release notes' })
    ).toEqual({
      kind: 'item',
      primary: { kind: 'confluence', label: 'Release notes', fullLabel: 'Release notes' }
    })
  })

  it('confluence falls back to "Page" when the title is absent but a page id is present', () => {
    expect(contextChipFor('confluence', { selectedPageId: 'p1' })).toEqual({
      kind: 'item',
      primary: { kind: 'confluence', label: 'Page' }
    })
  })

  it('calendar → an event chip labelled by the title (full label for the tooltip)', () => {
    expect(
      contextChipFor('google-calendar', {
        selectedEventId: 'e1',
        selectedEventTitle: 'Sprint planning'
      })
    ).toEqual({
      kind: 'item',
      primary: { kind: 'calendar', label: 'Sprint planning', fullLabel: 'Sprint planning' }
    })
  })

  it('calendar falls back to "Event" when the title is absent but an event id is present', () => {
    expect(contextChipFor('google-calendar', { selectedEventId: 'e1' })).toEqual({
      kind: 'item',
      primary: { kind: 'calendar', label: 'Event' }
    })
  })

  it('generated-ui → no chip (state A)', () => {
    expect(contextChipFor('generated-ui', { selectedIssueKey: 'PROJ-1' })).toBeUndefined()
  })

  it('undefined / empty viewContext → no chip (state A)', () => {
    expect(contextChipFor('jira', undefined)).toBeUndefined()
    expect(contextChipFor('jira', {})).toBeUndefined()
    expect(contextChipFor('slack', {})).toBeUndefined()
  })
})
