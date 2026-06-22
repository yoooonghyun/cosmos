import { describe, it, expect, vi } from 'vitest'
import {
  validateJiraBoundAction,
  validateJiraComment,
  validateJiraCreate,
  validateJiraTransition,
  validateJiraUpdate
} from './validate'
import { JiraBoundAction, isJiraBoundActionId } from './jira'

/* Jira generative-UI v1 — write boundary validators (FR-005, FR-006, FR-020). */

describe('validateJiraTransition (FR-006, FR-020)', () => {
  it('accepts a well-formed transition (happy path)', () => {
    const warn = vi.fn()
    expect(validateJiraTransition({ issueKey: 'ABC-1', transitionId: '31' }, warn)).toEqual({
      issueKey: 'ABC-1',
      transitionId: '31'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects a missing/empty issueKey (warn + null)', () => {
    const warn = vi.fn()
    expect(validateJiraTransition({ transitionId: '31' }, warn)).toBeNull()
    expect(validateJiraTransition({ issueKey: '', transitionId: '31' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a missing/empty transitionId (warn + null)', () => {
    const warn = vi.fn()
    expect(validateJiraTransition({ issueKey: 'ABC-1' }, warn)).toBeNull()
    expect(validateJiraTransition({ issueKey: 'ABC-1', transitionId: '' }, warn)).toBeNull()
  })

  it('rejects a non-object payload (warn + null)', () => {
    const warn = vi.fn()
    expect(validateJiraTransition(null, warn)).toBeNull()
    expect(validateJiraTransition('x', warn)).toBeNull()
  })
})

describe('validateJiraComment (FR-006)', () => {
  it('accepts a well-formed comment (happy path)', () => {
    const warn = vi.fn()
    expect(validateJiraComment({ issueKey: 'ABC-1', body: 'looks good' }, warn)).toEqual({
      issueKey: 'ABC-1',
      body: 'looks good'
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves the exact body text (no trim)', () => {
    const warn = vi.fn()
    const out = validateJiraComment({ issueKey: 'ABC-1', body: '  spaced  ' }, warn)
    expect(out?.body).toBe('  spaced  ')
  })

  it('rejects a whitespace-only body (no write — FR-006)', () => {
    const warn = vi.fn()
    expect(validateJiraComment({ issueKey: 'ABC-1', body: '   ' }, warn)).toBeNull()
    expect(validateJiraComment({ issueKey: 'ABC-1', body: '' }, warn)).toBeNull()
  })

  it('rejects a missing issueKey / non-string body (warn + null)', () => {
    const warn = vi.fn()
    expect(validateJiraComment({ body: 'hi' }, warn)).toBeNull()
    expect(validateJiraComment({ issueKey: 'ABC-1', body: 5 }, warn)).toBeNull()
  })
})

/* Jira write-extend v1 — create/update boundary validators (FR-002/003/006). */

describe('validateJiraCreate (FR-002, FR-006)', () => {
  it('accepts the fixed minimal fields (happy path)', () => {
    const warn = vi.fn()
    expect(
      validateJiraCreate(
        { projectKey: 'PROJ', issueType: 'Task', summary: 'Do the thing', description: 'detail' },
        warn
      )
    ).toEqual({ projectKey: 'PROJ', issueType: 'Task', summary: 'Do the thing', description: 'detail' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('defaults an absent description to "" (optional field, no error)', () => {
    const warn = vi.fn()
    const out = validateJiraCreate({ projectKey: 'PROJ', issueType: 'Task', summary: 'S' }, warn)
    expect(out).toEqual({ projectKey: 'PROJ', issueType: 'Task', summary: 'S', description: '' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves the exact summary text (no trim)', () => {
    const out = validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: '  spaced  ' })
    expect(out?.summary).toBe('  spaced  ')
  })

  it('rejects a missing/empty projectKey (no create — FR-002)', () => {
    const warn = vi.fn()
    expect(validateJiraCreate({ issueType: 'Task', summary: 'S' }, warn)).toBeNull()
    expect(validateJiraCreate({ projectKey: '', issueType: 'Task', summary: 'S' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a missing/empty issueType (no create — FR-002)', () => {
    const warn = vi.fn()
    expect(validateJiraCreate({ projectKey: 'P', summary: 'S' }, warn)).toBeNull()
    expect(validateJiraCreate({ projectKey: 'P', issueType: '', summary: 'S' }, warn)).toBeNull()
  })

  it('rejects an empty/whitespace summary (no create — FR-002)', () => {
    const warn = vi.fn()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: '' }, warn)).toBeNull()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: '   ' }, warn)).toBeNull()
  })

  it('rejects a non-string description and a non-object payload', () => {
    const warn = vi.fn()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: 'S', description: 5 }, warn)).toBeNull()
    expect(validateJiraCreate(null, warn)).toBeNull()
    expect(validateJiraCreate('x', warn)).toBeNull()
  })

  // jira-create-parent-v1 (FR-003, SC-003) — optional parentKey.
  it('carries a present parentKey, trimmed (FR-003)', () => {
    const warn = vi.fn()
    const out = validateJiraCreate(
      { projectKey: 'P', issueType: 'Sub-task', summary: 'S', parentKey: '  PROJ-123  ' },
      warn
    )
    expect(out).toEqual({ projectKey: 'P', issueType: 'Sub-task', summary: 'S', description: '', parentKey: 'PROJ-123' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('omits parentKey entirely when absent (no empty-string default — FR-003)', () => {
    const out = validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: 'S' })
    expect(out).not.toBeNull()
    expect(out).not.toHaveProperty('parentKey')
  })

  it('rejects a present-but-empty/whitespace parentKey (warn + null — FR-003)', () => {
    const warn = vi.fn()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: 'S', parentKey: '' }, warn)).toBeNull()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: 'S', parentKey: '   ' }, warn)).toBeNull()
    expect(validateJiraCreate({ projectKey: 'P', issueType: 'Task', summary: 'S', parentKey: 5 }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('validateJiraUpdate (FR-003, FR-006, OQ2)', () => {
  it('accepts a single changed field (happy path)', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: { summary: 'New title' } }, warn)).toEqual({
      issueKey: 'ABC-1',
      fields: { summary: 'New title' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts multiple changed fields incl. an empty-string description', () => {
    const out = validateJiraUpdate({
      issueKey: 'ABC-1',
      fields: { summary: 'T', description: '' }
    })
    expect(out).toEqual({ issueKey: 'ABC-1', fields: { summary: 'T', description: '' } })
  })

  it('accepts an assignee as { accountId } only', () => {
    const out = validateJiraUpdate({ issueKey: 'ABC-1', fields: { assignee: { accountId: 'a1' } } })
    expect(out).toEqual({ issueKey: 'ABC-1', fields: { assignee: { accountId: 'a1' } } })
  })

  it('rejects an empty fields object (empty edit dispatches no write — OQ2)', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: {} }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('rejects a fields object whose only key is unknown (no recognized change — empty)', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: { priority: 'High' } }, warn)).toBeNull()
  })

  it('keeps only the allowed keys (an unknown key is dropped, not carried through)', () => {
    const out = validateJiraUpdate({
      issueKey: 'ABC-1',
      fields: { summary: 'T', priority: 'High' }
    })
    expect(out).toEqual({ issueKey: 'ABC-1', fields: { summary: 'T' } })
  })

  it('rejects a whitespace-only summary (a required field cannot be blanked)', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: { summary: '   ' } }, warn)).toBeNull()
  })

  it('rejects a malformed assignee (missing accountId)', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: { assignee: {} } }, warn)).toBeNull()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: { assignee: 'a1' } }, warn)).toBeNull()
  })

  it('rejects a missing issueKey / non-object fields / non-object payload', () => {
    const warn = vi.fn()
    expect(validateJiraUpdate({ fields: { summary: 'T' } }, warn)).toBeNull()
    expect(validateJiraUpdate({ issueKey: 'ABC-1', fields: 'x' }, warn)).toBeNull()
    expect(validateJiraUpdate(null, warn)).toBeNull()
  })
})

describe('isJiraBoundActionId (FR-004)', () => {
  it('recognizes the jira.* namespace and rejects everything else', () => {
    expect(isJiraBoundActionId('jira.transition')).toBe(true)
    expect(isJiraBoundActionId('jira.comment')).toBe(true)
    expect(isJiraBoundActionId('jira.frobnicate')).toBe(true) // namespace, not validity
    expect(isJiraBoundActionId('submit')).toBe(false)
    expect(isJiraBoundActionId('confluence.x')).toBe(false)
    expect(isJiraBoundActionId(undefined)).toBe(false)
  })
})

describe('validateJiraBoundAction (FR-005, FR-006)', () => {
  it('maps a valid jira.transition to a discriminated request (happy path)', () => {
    const warn = vi.fn()
    const out = validateJiraBoundAction(
      JiraBoundAction.Transition,
      { issueKey: 'ABC-1', transitionId: '31' },
      warn
    )
    expect(out).toEqual({
      name: 'jira.transition',
      params: { issueKey: 'ABC-1', transitionId: '31' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('maps a valid jira.comment to a discriminated request', () => {
    const out = validateJiraBoundAction(JiraBoundAction.Comment, {
      issueKey: 'ABC-1',
      body: 'note'
    })
    expect(out).toEqual({ name: 'jira.comment', params: { issueKey: 'ABC-1', body: 'note' } })
  })

  it('returns null for a known name with missing fields (no dispatch)', () => {
    const warn = vi.fn()
    expect(validateJiraBoundAction(JiraBoundAction.Transition, { issueKey: 'ABC-1' }, warn)).toBeNull()
    expect(validateJiraBoundAction(JiraBoundAction.Comment, { issueKey: 'ABC-1', body: ' ' }, warn)).toBeNull()
  })

  it('returns null (warn) for an unknown jira.* name', () => {
    const warn = vi.fn()
    expect(validateJiraBoundAction('jira.delete', { issueKey: 'ABC-1' }, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null when values is absent for a name that requires fields', () => {
    const warn = vi.fn()
    expect(validateJiraBoundAction(JiraBoundAction.Comment, undefined, warn)).toBeNull()
  })

  it('maps a valid jira.create to a discriminated request (FR-004/005)', () => {
    const warn = vi.fn()
    const out = validateJiraBoundAction(
      JiraBoundAction.Create,
      { projectKey: 'PROJ', issueType: 'Task', summary: 'S', description: 'd' },
      warn
    )
    expect(out).toEqual({
      name: 'jira.create',
      params: { projectKey: 'PROJ', issueType: 'Task', summary: 'S', description: 'd' }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('maps a valid jira.update to a discriminated request (FR-004/005)', () => {
    const out = validateJiraBoundAction(JiraBoundAction.Update, {
      issueKey: 'ABC-1',
      fields: { summary: 'T' }
    })
    expect(out).toEqual({ name: 'jira.update', params: { issueKey: 'ABC-1', fields: { summary: 'T' } } })
  })

  it('returns null for jira.create missing a required field / jira.update with empty fields', () => {
    const warn = vi.fn()
    expect(validateJiraBoundAction(JiraBoundAction.Create, { issueType: 'Task', summary: 'S' }, warn)).toBeNull()
    expect(validateJiraBoundAction(JiraBoundAction.Update, { issueKey: 'ABC-1', fields: {} }, warn)).toBeNull()
  })
})
