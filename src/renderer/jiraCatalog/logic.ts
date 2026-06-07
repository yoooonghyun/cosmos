/**
 * jiraCatalog/logic — pure, framework-free helpers for the Jira custom A2UI catalog
 * (Jira generative-UI v2). Extracted into a plain `.ts` module so the catalog's
 * decision logic (status→token mapping, the comment empty/whitespace guard, the
 * transition-id selection) is unit-testable under the node-only vitest config — the
 * React components (`components.tsx`) are thin shells over these functions.
 *
 * NO React, NO DOM, NO secrets. Inputs are the resource shapes in
 * `src/shared/jira.ts`; outputs are Tailwind class strings / booleans / ids.
 *
 * Spec trace: .sdd/specs/jira-generative-ui-v2.md (FR-006 jira catalog parity,
 * FR-008 surface-side guards mirror main's validators, FR-010 transition/comment).
 * Design trace: .sdd/designs/jira-generative-ui-v2.md §3 (StatusBadge mapping),
 * §6 (TransitionPicker), §8 (AddCommentControl guard).
 */

import type { JiraStatusCategory, JiraUpdateFields } from '../../shared/jira'

/**
 * The renderer-local nav action a clickable `TicketCard` emits to open its detail
 * (jira-ticket-detail-v1, FR-001/FR-002). DELIBERATELY NOT in the `jira.*`
 * (`JiraBoundAction`) namespace — that namespace is reserved for actions MAIN intercepts
 * at the `ui:action` boundary and dispatches as deterministic WRITES (transition/comment/
 * create/update). This action is intercepted in the RENDERER (`JiraPanel.onAction`) and
 * NEVER forwarded to main or the agent (plan contract-note recommendation B). It mirrors
 * Slack's `SLACK_OPEN_CHANNEL_ACTION` — a dedicated, non-`jira.`-prefixed constant so the
 * reserved write namespace stays unambiguous and a click can never be mistaken for a write.
 */
export const JIRA_OPEN_DETAIL_ACTION = 'jiraNav.openDetail'

/**
 * Whether a clicked `TicketCard` should emit the open-detail nav action
 * (jira-ticket-detail-v1, FR-001 / edge case "ticket with no/empty key"). True ONLY when
 * `issueKey` is a non-empty, non-whitespace string — the placeholder `—` card (absent or
 * empty key) is non-actionable and emits nothing. Pure/node-testable; the component leans
 * on this to decide whether to render the clickable `<button>` shell.
 */
export function isOpenDetailEmittable(issueKey: string | undefined): boolean {
  return typeof issueKey === 'string' && issueKey.trim().length > 0
}

/**
 * The shadcn `Badge` variant + token classes for a normalized status category,
 * REUSED VERBATIM from the native `JiraPanel.StatusBadge` (design §3, the v2 color
 * win). `unknown` (or any unrecognized category) → an outline badge with no tint,
 * so a missing/odd category never shows a wrong color (a11y: color is reinforcement
 * only; the `statusName` text is always shown by the component).
 */
export interface StatusBadgeStyle {
  /** The shadcn `Badge` variant. */
  variant: 'secondary' | 'outline'
  /** Extra token classes for the tinted categories; '' for `unknown`/outline. */
  className: string
}

/** The native panel's category→token map (kept identical for visual parity). */
const STATUS_CATEGORY_CLASS: Record<Exclude<JiraStatusCategory, 'unknown'>, string> = {
  done: 'bg-status-done text-status-done-foreground border-transparent',
  in_progress: 'bg-status-progress text-status-progress-foreground border-transparent',
  todo: 'bg-status-todo text-status-todo-foreground border-transparent'
}

/**
 * Resolve the Badge style for a status category. A value outside the known set
 * (the node may carry a malformed/absent category) degrades to the `unknown`
 * outline style — never throws, never a wrong color (design §3 fallback).
 */
export function statusBadgeStyle(category: JiraStatusCategory | undefined): StatusBadgeStyle {
  if (category === 'done' || category === 'in_progress' || category === 'todo') {
    return { variant: 'secondary', className: STATUS_CATEGORY_CLASS[category] }
  }
  return { variant: 'outline', className: '' }
}

/**
 * The display name for the status badge. The status name is ALWAYS shown (color is
 * never the sole carrier — the `src/shared/jira.ts` a11y rule). A blank/absent name
 * degrades to a neutral 'Status' label so the badge never renders empty.
 */
export function statusBadgeLabel(statusName: string | undefined): string {
  return statusName && statusName.trim().length > 0 ? statusName : 'Status'
}

/**
 * The summary text for a TicketCard. A missing/blank summary degrades to a muted
 * placeholder so the card never collapses (design §4 populated state). Returns the
 * text plus whether it is the placeholder (the component renders the placeholder
 * muted).
 */
export function ticketCardSummary(summary: string | undefined): {
  text: string
  isPlaceholder: boolean
} {
  if (summary && summary.trim().length > 0) {
    return { text: summary, isPlaceholder: false }
  }
  return { text: '(no summary)', isPlaceholder: true }
}

/**
 * Whether the AddCommentControl's Comment button is enabled — the surface-side
 * mirror of main's `validateJiraComment` whitespace rejection (design §8, FR-008).
 * Belt-and-braces: main remains the authority; this just disables the obvious case.
 */
export function isCommentSubmittable(body: string | undefined): boolean {
  return typeof body === 'string' && body.trim().length > 0
}

/**
 * Whether the TransitionPicker's Apply button is enabled — a transition must be
 * selected (a non-empty `transitionId` from the surface data model). Mirror of
 * main's guard (design §6, FR-008).
 */
export function isTransitionSubmittable(transitionId: string | undefined): boolean {
  return typeof transitionId === 'string' && transitionId.trim().length > 0
}

/* ------------------------------------------------------------------------- *
 * Jira write-extend v1 — create/edit form guards + diff (FR-018, FR-006)
 *
 * Surface-side mirrors of main's `validateJiraCreate` / `validateJiraUpdate`
 * (belt-and-braces; main remains the authority — FR-006). Pure, node-testable.
 * ------------------------------------------------------------------------- */

/**
 * Whether the CreateIssueForm's "Create issue" button is enabled — the surface-side
 * mirror of main's `validateJiraCreate` required-minimal-fields check (design §3.3,
 * FR-002, FR-006). True only when `projectKey` and `issueType` are non-empty and
 * `summary` is non-whitespace. `description` is optional and never gates submit.
 */
export function isCreateSubmittable(
  projectKey: string | undefined,
  issueType: string | undefined,
  summary: string | undefined
): boolean {
  return (
    typeof projectKey === 'string' &&
    projectKey.trim().length > 0 &&
    typeof issueType === 'string' &&
    issueType.trim().length > 0 &&
    typeof summary === 'string' &&
    summary.trim().length > 0
  )
}

/**
 * The seeded baseline an edit form diffs against (the issue's current values). v1
 * surfaces summary + description only (assignee omitted — design §2 note B).
 */
export interface EditSeed {
  summary: string
  description: string
}

/**
 * Compute the {@link JiraUpdateFields} diff for an edit (Jira write-extend v1, OQ2).
 * Returns ONLY the fields whose current value differs from the seeded baseline, so
 * `jira.update` carries only changed entries (FR-003). A whitespace-only `summary`
 * is EXCLUDED (a required Jira field can't be blanked — design §4.3), so it never
 * enables submit on its own. Description may be edited to any string (incl. empty).
 * Pure; mirrors main's diff intent (main re-validates and rejects an empty result).
 */
export function diffUpdateFields(seed: EditSeed, current: EditSeed): JiraUpdateFields {
  const fields: JiraUpdateFields = {}
  if (current.summary !== seed.summary && current.summary.trim().length > 0) {
    fields.summary = current.summary
  }
  if (current.description !== seed.description) {
    fields.description = current.description
  }
  return fields
}

/**
 * Whether the EditIssueForm's "Save changes" button is enabled — the surface-side
 * mirror of main's `validateJiraUpdate` empty-`fields` rejection (design §4.3,
 * FR-003, FR-006, OQ2). True only when the diff carries at least one changed field.
 */
export function isUpdateSubmittable(fields: JiraUpdateFields): boolean {
  return Object.keys(fields).length > 0
}
