import { describe, it, expect } from 'vitest'
import {
  diffUpdateFields,
  isCommentSubmittable,
  isCreateSubmittable,
  isOpenDetailEmittable,
  isTransitionSubmittable,
  isUpdateSubmittable,
  JIRA_OPEN_DETAIL_ACTION,
  statusBadgeLabel,
  statusBadgeStyle,
  ticketCardSummary
} from './logic'

/* Jira generative-UI v2 — pure catalog decision logic (FR-006/008/010). */

describe('statusBadgeStyle (the v2 color win, design §3)', () => {
  it('maps the three known categories to the secondary variant + status tokens', () => {
    expect(statusBadgeStyle('todo')).toEqual({
      variant: 'secondary',
      className: 'bg-status-todo text-status-todo-foreground border-transparent'
    })
    expect(statusBadgeStyle('in_progress')).toEqual({
      variant: 'secondary',
      className: 'bg-status-progress text-status-progress-foreground border-transparent'
    })
    expect(statusBadgeStyle('done')).toEqual({
      variant: 'secondary',
      className: 'bg-status-done text-status-done-foreground border-transparent'
    })
  })

  it('degrades unknown/absent/odd categories to an outline badge with no tint (safe fallback)', () => {
    expect(statusBadgeStyle('unknown')).toEqual({ variant: 'outline', className: '' })
    expect(statusBadgeStyle(undefined)).toEqual({ variant: 'outline', className: '' })
    // a malformed value (cast through unknown) must not throw and must outline
    expect(statusBadgeStyle('weird' as never)).toEqual({ variant: 'outline', className: '' })
  })
})

describe('statusBadgeLabel (a11y — status name always shown)', () => {
  it('returns the status name when present', () => {
    expect(statusBadgeLabel('In Progress')).toBe('In Progress')
  })
  it('falls back to a neutral label for blank/absent names (never empty)', () => {
    expect(statusBadgeLabel('')).toBe('Status')
    expect(statusBadgeLabel('   ')).toBe('Status')
    expect(statusBadgeLabel(undefined)).toBe('Status')
  })
})

describe('ticketCardSummary (design §4 populated)', () => {
  it('returns the summary text when present', () => {
    expect(ticketCardSummary('Fix login')).toEqual({ text: 'Fix login', isPlaceholder: false })
  })
  it('returns a muted placeholder for a blank/absent summary (card never collapses)', () => {
    expect(ticketCardSummary('')).toEqual({ text: '(no summary)', isPlaceholder: true })
    expect(ticketCardSummary('   ')).toEqual({ text: '(no summary)', isPlaceholder: true })
    expect(ticketCardSummary(undefined)).toEqual({ text: '(no summary)', isPlaceholder: true })
  })
})

describe('isCommentSubmittable (design §8 — mirrors main\'s whitespace guard, FR-008)', () => {
  it('is true only for a non-empty, non-whitespace body', () => {
    expect(isCommentSubmittable('hi')).toBe(true)
    expect(isCommentSubmittable('  text  ')).toBe(true)
  })
  it('is false for empty / whitespace-only / absent body', () => {
    expect(isCommentSubmittable('')).toBe(false)
    expect(isCommentSubmittable('   ')).toBe(false)
    expect(isCommentSubmittable('\n\t')).toBe(false)
    expect(isCommentSubmittable(undefined)).toBe(false)
  })
})

describe('isTransitionSubmittable (design §6 — Apply disabled until selected, FR-008)', () => {
  it('is true only when a non-empty transitionId is selected', () => {
    expect(isTransitionSubmittable('31')).toBe(true)
  })
  it('is false for empty / absent selection', () => {
    expect(isTransitionSubmittable('')).toBe(false)
    expect(isTransitionSubmittable('  ')).toBe(false)
    expect(isTransitionSubmittable(undefined)).toBe(false)
  })
})

/* Jira write-extend v1 — create/edit form guards + diff (FR-002/003/006/018). */

describe('isCreateSubmittable (design §3.3 — mirrors validateJiraCreate, FR-006)', () => {
  it('is true only when projectKey + issueType + non-whitespace summary are all present', () => {
    expect(isCreateSubmittable('PROJ', 'Task', 'Do it')).toBe(true)
    expect(isCreateSubmittable('PROJ', 'Task', '  trimmed-ok  ')).toBe(true)
  })
  it('does not require a description (optional)', () => {
    expect(isCreateSubmittable('PROJ', 'Task', 'S')).toBe(true)
  })
  it('is false when any required field is empty/whitespace/absent', () => {
    expect(isCreateSubmittable('', 'Task', 'S')).toBe(false)
    expect(isCreateSubmittable('PROJ', '', 'S')).toBe(false)
    expect(isCreateSubmittable('PROJ', 'Task', '   ')).toBe(false)
    expect(isCreateSubmittable(undefined, 'Task', 'S')).toBe(false)
    expect(isCreateSubmittable('PROJ', undefined, 'S')).toBe(false)
    expect(isCreateSubmittable('PROJ', 'Task', undefined)).toBe(false)
  })
})

describe('diffUpdateFields (OQ2 — only changed entries)', () => {
  const seed = { summary: 'Old title', description: 'Old body' }

  it('returns an empty diff when nothing changed (unchanged edit)', () => {
    expect(diffUpdateFields(seed, { summary: 'Old title', description: 'Old body' })).toEqual({})
  })

  it('carries ONLY the changed summary', () => {
    expect(diffUpdateFields(seed, { summary: 'New title', description: 'Old body' })).toEqual({
      summary: 'New title'
    })
  })

  it('carries ONLY the changed description, incl. clearing it to empty', () => {
    expect(diffUpdateFields(seed, { summary: 'Old title', description: '' })).toEqual({
      description: ''
    })
  })

  it('carries both when both changed', () => {
    expect(diffUpdateFields(seed, { summary: 'New', description: 'Body2' })).toEqual({
      summary: 'New',
      description: 'Body2'
    })
  })

  it('excludes a whitespace-only summary (a required field cannot be blanked — §4.3)', () => {
    expect(diffUpdateFields(seed, { summary: '   ', description: 'Old body' })).toEqual({})
  })
})

describe('isUpdateSubmittable (design §4.3 — mirrors validateJiraUpdate empty-fields, FR-006)', () => {
  it('is true only when the diff carries at least one changed field', () => {
    expect(isUpdateSubmittable({ summary: 'T' })).toBe(true)
    expect(isUpdateSubmittable({ description: '' })).toBe(true)
  })
  it('is false for an empty diff (unchanged edit disables Save)', () => {
    expect(isUpdateSubmittable({})).toBe(false)
  })
})

describe('isOpenDetailEmittable (jira-ticket-detail-v1, FR-001 — clickable only on a real key)', () => {
  it('is true for a non-empty issueKey (an actionable card emits the nav action)', () => {
    expect(isOpenDetailEmittable('PROJ-1')).toBe(true)
    expect(isOpenDetailEmittable('ABC-123')).toBe(true)
  })

  it('is false for an absent/empty/whitespace key (the "—" placeholder card is inert)', () => {
    expect(isOpenDetailEmittable(undefined)).toBe(false)
    expect(isOpenDetailEmittable('')).toBe(false)
    expect(isOpenDetailEmittable('   ')).toBe(false)
  })
})

describe('JIRA_OPEN_DETAIL_ACTION (recommendation B — non-jira.* nav action)', () => {
  it('is NOT in the reserved jira.* write namespace', () => {
    expect(JIRA_OPEN_DETAIL_ACTION.startsWith('jira.')).toBe(false)
    expect(JIRA_OPEN_DETAIL_ACTION).toBe('jiraNav.openDetail')
  })
})
