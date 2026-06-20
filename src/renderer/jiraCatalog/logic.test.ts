import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  diffUpdateFields,
  isCommentSubmittable,
  isCreateSubmittable,
  isDetailSurfaceSpec,
  isOpenableJiraWebUrl,
  isOpenDetailEmittable,
  isTransitionSubmittable,
  isUpdateSubmittable,
  JIRA_DETAIL_SURFACE_ID,
  JIRA_LAYOUT_CLAMP_CLASS,
  JIRA_OPEN_DETAIL_ACTION,
  shouldShowIssueEmptyState,
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

describe('isTransitionSubmittable (design §6 — apply-on-select guard, FR-006/FR-008)', () => {
  it('is true only when a non-empty transitionId is selected', () => {
    expect(isTransitionSubmittable('31')).toBe(true)
  })
  it('is false for empty / absent selection', () => {
    expect(isTransitionSubmittable('')).toBe(false)
    expect(isTransitionSubmittable('  ')).toBe(false)
    expect(isTransitionSubmittable(undefined)).toBe(false)
  })
  // jira-dock-autoapply-weblink-v1 (FR-006): re-selecting the current/in-flight id is a no-op.
  it('is false when the selection equals the current/in-flight id (no-op re-select)', () => {
    expect(isTransitionSubmittable('31', '31')).toBe(false)
    expect(isTransitionSubmittable('  31  ', '31')).toBe(false)
  })
  it('is true when the selection differs from the current/in-flight id', () => {
    expect(isTransitionSubmittable('11', '31')).toBe(true)
  })
  it('treats an empty/absent current id as "nothing in flight" (still submittable)', () => {
    expect(isTransitionSubmittable('31', '')).toBe(true)
    expect(isTransitionSubmittable('31', undefined)).toBe(true)
  })
})

describe('isOpenableJiraWebUrl (FR-014 — renderer re-validates http(s) before linking)', () => {
  it('accepts an absolute http(s) URL', () => {
    expect(isOpenableJiraWebUrl('https://acme.atlassian.net/browse/PROJ-1')).toBe(true)
    expect(isOpenableJiraWebUrl('http://localhost:8080/browse/X-1')).toBe(true)
  })
  it('rejects empty / undefined', () => {
    expect(isOpenableJiraWebUrl(undefined)).toBe(false)
    expect(isOpenableJiraWebUrl('')).toBe(false)
    expect(isOpenableJiraWebUrl('   ')).toBe(false)
  })
  it('rejects non-http(s) and relative / unparseable URLs (never a live link)', () => {
    expect(isOpenableJiraWebUrl('mailto:x@y.z')).toBe(false)
    expect(isOpenableJiraWebUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableJiraWebUrl('/browse/PROJ-1')).toBe(false)
    expect(isOpenableJiraWebUrl('not a url')).toBe(false)
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

describe('isDetailSurfaceSpec (jira-ticket-detail-dock-v1, #86 R-A — dock-routing discriminator)', () => {
  it('is true ONLY for a spec carrying the detail surfaceId (routes the frame to the dock slot)', () => {
    expect(isDetailSurfaceSpec({ surfaceId: JIRA_DETAIL_SURFACE_ID })).toBe(true)
    expect(isDetailSurfaceSpec({ surfaceId: JIRA_DETAIL_SURFACE_ID, components: [] })).toBe(true)
  })

  it('is false for a list/board/search spec or any non-detail surfaceId (falls through to the list)', () => {
    expect(isDetailSurfaceSpec({ surfaceId: 'jira-issue-list' })).toBe(false)
    expect(isDetailSurfaceSpec({ surfaceId: 'jira-default-view' })).toBe(false)
    expect(isDetailSurfaceSpec({ surfaceId: 'other' })).toBe(false)
  })

  it('is false for a missing/non-object/null spec (a malformed frame never hijacks the dock)', () => {
    expect(isDetailSurfaceSpec(undefined)).toBe(false)
    expect(isDetailSurfaceSpec(null)).toBe(false)
    expect(isDetailSurfaceSpec('jira-issue-detail')).toBe(false)
    expect(isDetailSurfaceSpec({})).toBe(false)
  })

  it('pins the detail surfaceId so it never drifts from the main-side builder constant', () => {
    expect(JIRA_DETAIL_SURFACE_ID).toBe('jira-issue-detail')
  })
})

describe('shouldShowIssueEmptyState (bug jira-empty-flash-v1 — no empty flash before seed)', () => {
  it('is true ONLY for a seeded, empty, settled list', () => {
    expect(shouldShowIssueEmptyState([], false)).toBe(true)
  })

  it('is false while bound rows are unseeded (undefined) — the skeleton→paint gap', () => {
    // The regression: useBound returns undefined until main seeds the dataModel; the old
    // `length === 0` check collapsed this to empty and flashed "No issues found.".
    expect(shouldShowIssueEmptyState(undefined, false)).toBe(false)
    expect(shouldShowIssueEmptyState(undefined, true)).toBe(false)
  })

  it('is false while loading, even for an empty array (refresh in flight)', () => {
    expect(shouldShowIssueEmptyState([], true)).toBe(false)
  })

  it('is false for a non-empty list (the list renders instead)', () => {
    expect(shouldShowIssueEmptyState([{ issueKey: 'PROJ-1' }], false)).toBe(false)
  })
})

/* ------------------------------------------------------------------------- *
 * Generative layout width clamp (bug slack-generative-wrap-v1, Jira latent instance)
 *
 * Regression: an agent-grouped Jira list/detail rendered inside the SDK standard-catalog
 * Column/Row overflowed horizontally because that SDK flex container lacks `min-w-0`,
 * keeps `min-width: auto`, and grows to its content's intrinsic width — so a long unbroken
 * line never wrapped. The Jira catalog now registers width-clamped Column/Row wrappers.
 * These tests would FAIL before the fix: the SDK container source carries NO clamp, and
 * there was no clamping wrapper around it. Mirrors the Slack catalog's regression.
 * ------------------------------------------------------------------------- */
describe('JIRA_LAYOUT_CLAMP_CLASS (generative wrap clamp)', () => {
  it('carries the width-clamp tokens that defeat the SDK flex intrinsic width', () => {
    // min-w-0 defeats flex `min-width: auto`; max-w-full caps at the panel width;
    // w-full keeps short content filling the column.
    expect(JIRA_LAYOUT_CLAMP_CLASS).toContain('min-w-0')
    expect(JIRA_LAYOUT_CLAMP_CLASS).toContain('max-w-full')
    expect(JIRA_LAYOUT_CLAMP_CLASS).toContain('w-full')
  })

  it('the raw SDK Column/Row container that caused the bug has NO width clamp', () => {
    // Root cause, asserted against the SDK source: its flex `<div>` className is a fixed
    // `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0`/`max-w-full`. With
    // flex `min-width: auto` the container grows to its content's intrinsic width, so a
    // long unbroken line overflows instead of wrapping. (The SDK components require
    // SurfaceProvider context, so they can't be mounted in the node test env — we assert the
    // emitted className from source.) This test fails the day the SDK adds its own clamp,
    // signalling the wrapper is no longer needed.
    const sdkDir = '../../../node_modules/@a2ui-sdk/react/dist/0.9/components/layout'
    const columnSrc = readFileSync(new URL(`${sdkDir}/ColumnComponent.js`, import.meta.url), 'utf8')
    const rowSrc = readFileSync(new URL(`${sdkDir}/RowComponent.js`, import.meta.url), 'utf8')
    expect(columnSrc).toContain('flex flex-col')
    expect(rowSrc).toContain('flex flex-row')
    expect(columnSrc).not.toContain('min-w-0')
    expect(rowSrc).not.toContain('min-w-0')
  })

  it('the Jira catalog registers the clamped wrappers, not the raw SDK Column/Row', () => {
    // The fix: the catalog index imports Column/Row from ./layout (which apply the clamp)
    // instead of standardCatalog.components.Column/Row. Asserting the wiring is the
    // node-checkable proof the agent-grouped list is rendered inside the clamp box. Before
    // the fix the index registered the raw SDK containers directly.
    const indexSrc = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(indexSrc).toContain("from './layout'")
    expect(indexSrc).not.toContain('standardCatalog.components.Column')
    expect(indexSrc).not.toContain('standardCatalog.components.Row')

    // ...and the wrapper module applies the clamp class around the SDK container.
    const layoutSrc = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8')
    expect(layoutSrc).toContain('JIRA_LAYOUT_CLAMP_CLASS')
    expect(layoutSrc).toContain('standardCatalog.components.Column')
    expect(layoutSrc).toContain('standardCatalog.components.Row')
  })
})
