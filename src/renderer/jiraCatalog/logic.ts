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
 * The stable `surfaceId` main stamps on the issue-DETAIL surface
 * (`SURFACE_ISSUE_DETAIL` in `jiraSurfaceBuilder.ts`). Mirrored renderer-side (main does
 * not export it to the renderer) so the JiraPanel can tell a detail frame apart from a
 * list/default/search frame (`jira-issue-list` / `jira-default-view`) when routing the
 * unsolicited `target:'jira'` frame — a detail frame is diverted into the per-tab dock
 * slot instead of clobbering the tab's list surface (#86, approach R-A).
 */
export const JIRA_DETAIL_SURFACE_ID = 'jira-issue-detail'

/**
 * Whether an unsolicited `target:'jira'` render frame's spec is the issue-DETAIL surface
 * (#86, R-A). True only when the spec carries `surfaceId === JIRA_DETAIL_SURFACE_ID`.
 * A list/default/search/create frame, a Notice (no `surfaceId`), or a malformed spec
 * returns false (safe fallback — it falls through to the normal active-tab filing). Pure/
 * node-testable; the panel leans on this in its unsolicited-frame interceptor.
 */
export function isDetailSurfaceSpec(spec: unknown): boolean {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    (spec as { surfaceId?: unknown }).surfaceId === JIRA_DETAIL_SURFACE_ID
  )
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
 * Whether selecting `transitionId` should dispatch a transition (design §6, FR-006/FR-008).
 * True only when it is a non-empty/non-whitespace id. The TransitionPicker now applies
 * ON SELECT (no Apply button — jira-dock-autoapply-weblink-v1), so `currentId` (the
 * in-flight / last-dispatched id) makes a RE-SELECTION of that same value a no-op (FR-006) —
 * never dispatching a second transition for the value already being applied. An empty/absent
 * `currentId` means "nothing in flight", so any valid id is submittable. Mirror of main's guard.
 */
export function isTransitionSubmittable(
  transitionId: string | undefined,
  currentId?: string | undefined
): boolean {
  if (typeof transitionId !== 'string' || transitionId.trim().length === 0) {
    return false
  }
  if (typeof currentId === 'string' && currentId.trim().length > 0 && transitionId.trim() === currentId.trim()) {
    return false
  }
  return true
}

/**
 * The resolved action context the TransitionPicker dispatches for `jira.transition`
 * (bug jira-status-transition-applying-hang-v1). Carries the LITERAL `issueKey` +
 * `transitionId` strings the user just selected — NOT a `{ path: '/transitionId' }`
 * binding.
 *
 * WHY a literal, not a binding: the SDK's `useDispatchAction` resolves a `{ path }`
 * action-context binding against the surface data model AT DISPATCH TIME by reading
 * the SDK's React-`useState`-backed store (`getDataModel`). The picker selects-AND-
 * dispatches in ONE event tick, so the `setTransitionId(next)` form-binding write
 * (which only queues a React state update) has NOT flushed when dispatch reads the
 * model — `resolveContext` would resolve `/transitionId` to its STALE/empty value,
 * sending `transitionId: undefined` to main. Main's `validateJiraTransition` then
 * rejects it (no write), the dispatcher returns false (no `cancelActive`, no surface
 * re-push), and the picker's "Applying…" optimistic state never clears → the UI hangs
 * forever. Passing the just-selected literal `transitionId` here sidesteps the
 * not-yet-flushed model entirely so the write always carries the chosen id.
 *
 * Pure/node-testable; the component leans on this so the literal-vs-binding decision
 * is asserted off-React. The shape mirrors the SDK action contract
 * (`{ issueKey, transitionId }` — `JiraBoundAction.Transition`, FR-005).
 */
export function transitionActionContext(
  issueKey: string,
  transitionId: string
): { issueKey: string; transitionId: string } {
  return { issueKey, transitionId }
}

/**
 * The "Applying…" watchdog window, in ms (bug jira-status-transition-applying-hang-v1).
 *
 * On the normal path a transition write makes main re-read + re-push a FRESH detail
 * frame, which REMOUNTS the TransitionPicker idle — so its in-flight "Applying…" lock
 * clears by remount, not by a callback. But if a write ever fails WITHOUT a re-push
 * reaching this instance (a dropped/never-arriving frame), the lock would otherwise
 * hang forever. The picker arms a timer for this long when it dispatches; if no
 * remount has cleared it by then, the picker self-recovers (clears "Applying…" +
 * surfaces a recoverable inline error) so a failed transition can NEVER hang the UI.
 * Generous so the deterministic main round-trip (write + re-read + re-push) virtually
 * always wins the race on the happy path; the watchdog is a last-resort safety net.
 */
export const TRANSITION_APPLYING_TIMEOUT_MS = 15_000

/**
 * The recoverable inline message the TransitionPicker shows when its "Applying…"
 * watchdog fires (the write produced no fresh frame in time). Non-secret, non-alarming,
 * and actionable — mirrors the FR-017 notice tone. Centralized here so it is asserted in
 * a node test rather than scraped from JSX.
 */
export const TRANSITION_APPLYING_TIMEOUT_MESSAGE =
  'Could not confirm the status change. Please try again.'

/**
 * Whether a bound issue `webUrl` is a live, openable external link
 * (jira-dock-autoapply-weblink-v1, FR-014). The main-side assembler already enforces
 * `http(s)`, but the bound/native value re-validates here so a malformed value can NEVER
 * become a live link. Pure; never throws. Mirrors Confluence's `isOpenableWebUrl`.
 */
export function isOpenableJiraWebUrl(webUrl: string | undefined): webUrl is string {
  if (typeof webUrl !== 'string' || webUrl.trim() === '') {
    return false
  }
  try {
    const u = new URL(webUrl)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
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

/* ------------------------------------------------------------------------- *
 * Generative layout width-clamp (bug slack-generative-wrap-v1, Jira latent instance)
 *
 * The agent groups Jira lists/detail with the SDK standard-catalog `Column`/`Row`
 * (registered in `index.ts`). Those SDK containers render a `<div>` whose className is a
 * fixed `flex flex-col gap-4` / `flex flex-row gap-3` with NO `min-w-0` — so the flex box
 * keeps its default `min-width: auto` and grows to its content's INTRINSIC width. A long
 * unbroken line therefore expands that container past the panel and overflows horizontally;
 * the leaf's `break-words` and the list root's `min-w-0` never take effect because their
 * containing block is already wider than the panel.
 *
 * We cannot edit the third-party SDK div's className, so the Jira catalog registers clamped
 * wrappers (see `layout.tsx`) that render the SDK `Column`/`Row` inside a block box carrying
 * this class. `min-w-0` defeats the flex `min-width: auto` floor the wrapper inherits from
 * the panel's flex host; `max-w-full` caps it at the panel width; `w-full` keeps short
 * content filling the column. The class lives here (not the `.tsx`) so the fix is assertable
 * in a node (no-jsdom) unit test — mirroring `slackCatalog/logic.ts`.
 * ------------------------------------------------------------------------- */

/** Width-clamp applied around an agent-emitted SDK Column/Row so its subtree wraps. */
export const JIRA_LAYOUT_CLAMP_CLASS = 'w-full min-w-0 max-w-full'

/* ------------------------------------------------------------------------- *
 * IssueList empty-state gate (bug jira-empty-flash-v1)
 *
 * A `{path}`-bound `issues` prop resolves through `useBound` to `undefined` UNTIL main
 * seeds the surface dataModel (jira-generative-adapter-v1): ActiveTabSurface paints the
 * createSurface/updateComponents spec FIRST, then applies the dataModel seed a tick later.
 * In that gap `rows === undefined` — which `Array.isArray(rows) ? rows : []` collapses to
 * an empty array, indistinguishable from a genuinely empty seeded list. The result was the
 * "No issues found." empty state flashing between skeleton and first paint.
 *
 * Gate: show the empty state ONLY for a SEEDED, genuinely empty, settled list — `rows` is
 * an array, it is empty, and it is not mid-load. `undefined` (not yet seeded) or
 * `isLoading` both suppress it, so the quiet container/skeleton shows during the gap.
 * ------------------------------------------------------------------------- */

/**
 * Whether IssueList should render its "No issues found." empty state. True ONLY when the
 * bound rows have been SEEDED to an array, that array is empty, and the surface is not
 * loading — so the unseeded (`undefined`) window and the loading window both suppress it.
 * Pure/node-testable; the component leans on this instead of a raw `length === 0` check.
 */
export function shouldShowIssueEmptyState(
  rows: readonly unknown[] | undefined,
  isLoading: boolean
): boolean {
  return Array.isArray(rows) && rows.length === 0 && !isLoading
}
