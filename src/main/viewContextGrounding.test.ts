import { describe, it, expect } from 'vitest'
import { viewContextGroundingClause } from './viewContextGrounding'

/**
 * open-prompt-view-context-v1 — pure grounding-clause builder (FR-007/FR-008/FR-010).
 * Maps a validated `ViewContext` → an extra system-prompt sentence that tells the model
 * which on-screen item deictic terms refer to. References ONLY ids the model can fetch
 * with its EXISTING read tools; never instructs an action the run lacks tools for.
 */

describe('viewContextGroundingClause — jira (FR-007/FR-008)', () => {
  it('names the in-view issue key for "this ticket"', () => {
    const clause = viewContextGroundingClause('jira', { selectedIssueKey: 'PROJ-123' })
    expect(clause).toContain('PROJ-123')
    expect(clause.toLowerCase()).toContain('this ticket')
  })

  it('is empty when no issue is selected (no-op)', () => {
    expect(viewContextGroundingClause('jira', {})).toBe('')
    expect(viewContextGroundingClause('jira', undefined)).toBe('')
  })
})

describe('viewContextGroundingClause — slack (FR-007/FR-008)', () => {
  it('names the in-view channel (id + name)', () => {
    const clause = viewContextGroundingClause('slack', {
      selectedChannelId: 'C1',
      selectedChannelName: 'general'
    })
    expect(clause).toContain('C1')
    expect(clause).toContain('general')
    expect(clause.toLowerCase()).toContain('this channel')
  })

  it('adds the thread dimension when a thread is open', () => {
    const clause = viewContextGroundingClause('slack', {
      selectedChannelId: 'C1',
      selectedChannelName: 'general',
      threadTs: '1700000000.0001'
    })
    expect(clause).toContain('1700000000.0001')
    expect(clause.toLowerCase()).toContain('thread')
  })

  it('is empty when no channel is in view (no-op)', () => {
    expect(viewContextGroundingClause('slack', {})).toBe('')
  })

  it('does not instruct a send/write action a read-only slack run lacks (FR-008/FR-009)', () => {
    const clause = viewContextGroundingClause('slack', {
      selectedChannelId: 'C1',
      selectedChannelName: 'general'
    }).toLowerCase()
    expect(clause).not.toContain('send')
    expect(clause).not.toContain('post a message')
  })
})

describe('viewContextGroundingClause — confluence (FR-007/FR-008)', () => {
  it('names the in-view page id + title', () => {
    const clause = viewContextGroundingClause('confluence', {
      selectedPageId: 'p1',
      selectedPageTitle: 'Release notes'
    })
    expect(clause).toContain('p1')
    expect(clause).toContain('Release notes')
    expect(clause.toLowerCase()).toContain('this page')
  })

  it('is empty when no page is in view (no-op)', () => {
    expect(viewContextGroundingClause('confluence', {})).toBe('')
  })
})

describe('viewContextGroundingClause — google-calendar (FR-007/FR-008)', () => {
  it('names the in-view event id + title', () => {
    const clause = viewContextGroundingClause('google-calendar', {
      selectedEventId: 'e1',
      selectedEventTitle: 'Sprint planning'
    })
    expect(clause).toContain('e1')
    expect(clause).toContain('Sprint planning')
    expect(clause.toLowerCase()).toContain('this event')
  })

  it('is empty when no event is selected (no-op)', () => {
    expect(viewContextGroundingClause('google-calendar', {})).toBe('')
  })
})

describe('viewContextGroundingClause — generated-ui / fallback', () => {
  it('is empty for the generated-ui target (no panel selection — FR-003)', () => {
    expect(viewContextGroundingClause('generated-ui', { selectedIssueKey: 'PROJ-1' })).toBe('')
  })

  it('never references a secret/token (SC-004 — by construction it carries none)', () => {
    const clause = viewContextGroundingClause('jira', { selectedIssueKey: 'PROJ-9' }).toLowerCase()
    expect(clause).not.toContain('token')
    expect(clause).not.toContain('secret')
  })
})
