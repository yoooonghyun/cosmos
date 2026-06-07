/**
 * jiraCatalog/components — the six Jira custom A2UI catalog components (Jira
 * generative-UI v2, FR-006). Plain cosmos React components rendered by the Jira
 * panel's `<A2UIProvider catalog={jiraCatalog}>`, so they may use ANY Tailwind class
 * — including the `--status-*` tokens the native panel uses (the v2 color win).
 *
 * Each component receives the rest of its surface node spread in by the SDK's
 * `ComponentRenderer` plus `{ surfaceId, componentId }` (design §1.3). DISPLAY
 * components read static node props directly (the builder puts the `src/shared/jira.ts`
 * shapes on the node). The two INPUT components (TransitionPicker, AddCommentControl)
 * read their value from the surface data model via `useFormBinding` and emit a
 * `jira.*` bound action via `useDispatchAction` (design §1.4) — the IDENTICAL
 * renderer→main action path v1 proved.
 *
 * Decision logic lives in `./logic.ts` (node-testable); these are thin shells.
 *
 * Design trace: §3 StatusBadge, §4 TicketCard, §5 IssueList, §6 TransitionPicker,
 * §7 CommentRow/CommentList, §8 AddCommentControl, §9.5 post-write notice.
 */

import { useDispatchAction, useFormBinding } from '@a2ui-sdk/react/0.9'
import type { DynamicValue } from '@a2ui-sdk/types/0.9'
import { Check, Lock, SquareKanban, TriangleAlert, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { JiraBoundAction } from '../../shared/jira'
import type {
  JiraComment,
  JiraStatusCategory,
  JiraTransition,
  JiraUpdateFields,
  JiraUserRef
} from '../../shared/jira'
import { formatTs, initials } from '../atlassianPanelBits'
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

/**
 * The data-model paths the two input controls bind to (shared with the surface
 * builder so a control's `value` path and its action context agree). Kept here so
 * the action's `{ path }` literal can never drift from the `useFormBinding` source.
 */
export const PATH_TRANSITION_ID = '/transitionId'
export const PATH_COMMENT_BODY = '/commentBody'

/** CreateIssueForm data-model paths (Jira write-extend v1, design §3). */
export const PATH_CREATE_PROJECT_KEY = '/createProjectKey'
export const PATH_CREATE_ISSUE_TYPE = '/createIssueType'
export const PATH_CREATE_SUMMARY = '/createSummary'
export const PATH_CREATE_DESCRIPTION = '/createDescription'

/** EditIssueForm data-model paths (Jira write-extend v1, design §4). */
export const PATH_EDIT_SUMMARY = '/editSummary'
export const PATH_EDIT_DESCRIPTION = '/editDescription'

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
}

/* ------------------------------------------------------------------------- *
 * StatusBadge (display) — the v2 color win (design §3)
 * ------------------------------------------------------------------------- */

export interface StatusBadgeNode extends SdkProps {
  statusName?: string
  statusCategory?: JiraStatusCategory
}

export function StatusBadge({ statusName, statusCategory }: StatusBadgeNode): React.JSX.Element {
  const style = statusBadgeStyle(statusCategory)
  return (
    <Badge variant={style.variant} className={cn('shrink-0', style.className)}>
      {statusBadgeLabel(statusName)}
    </Badge>
  )
}

/* ------------------------------------------------------------------------- *
 * PersonInline (internal) — reuse the native panel treatment (design §2)
 * ------------------------------------------------------------------------- */

function PersonInline({ person }: { person?: JiraUserRef }): React.JSX.Element {
  if (!person) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Avatar size="sm">
          <AvatarFallback>
            <User className="size-3 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        Unassigned
      </span>
    )
  }
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar size="sm">
        <AvatarFallback>{initials(person.displayName)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{person.displayName}</span>
    </span>
  )
}

/* ------------------------------------------------------------------------- *
 * TicketCard (display, no action) (design §4)
 * ------------------------------------------------------------------------- */

export interface TicketCardNode extends SdkProps {
  issueKey?: string
  summary?: string
  statusName?: string
  statusCategory?: JiraStatusCategory
  assignee?: JiraUserRef
  /**
   * Whether this card is the clickable/actionable variant (jira-ticket-detail-v1,
   * design §1.3/§2). When true it gets `cursor-pointer` + the hover lift (it is wrapped
   * in a real `<button>` by `IssueList`); when false (the `—` placeholder, no real key)
   * it is an inert read-only card with NO hover affordance (§2.2). The `<button>` wrapper
   * + the open-detail dispatch live in `IssueList`, mirroring Slack `ChannelList`.
   */
  actionable?: boolean
}

export function TicketCard({
  issueKey,
  summary,
  statusName,
  statusCategory,
  assignee,
  actionable
}: TicketCardNode): React.JSX.Element {
  const summaryText = ticketCardSummary(summary)
  return (
    <Card
      className={cn(
        'gap-2 rounded-xl p-3 transition-colors',
        // §2.1: the actionable card gets the pointer + hover lift (it responds to a click).
        // §2.2: the inert "—" card drops them so it has no false affordance.
        actionable && 'cursor-pointer hover:bg-accent/40'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
          {issueKey ?? '—'}
        </Badge>
        <StatusBadge surfaceId="" componentId="" statusName={statusName} statusCategory={statusCategory} />
      </div>
      <p
        className={cn(
          'line-clamp-2 text-sm leading-snug',
          summaryText.isPlaceholder ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {summaryText.text}
      </p>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PersonInline person={assignee} />
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------------- *
 * IssueList (display container of TicketCards) (design §5)
 * ------------------------------------------------------------------------- */

export interface IssueListNode extends SdkProps {
  issues?: TicketCardNode[]
}

export function IssueList({ surfaceId, componentId, issues }: IssueListNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const items = Array.isArray(issues) ? issues : []
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <SquareKanban className="size-7 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No issues found.</p>
      </div>
    )
  }
  // A card click opens that ticket's detail in place (jira-ticket-detail-v1, FR-001/FR-002).
  // The action is handled renderer-locally by the Jira panel's onAction seam (never sent to
  // main or the agent — JIRA_OPEN_DETAIL_ACTION is a non-jira.* nav action). A card with no
  // real key (the "—" placeholder) is non-actionable (no button, no dispatch — §2.2).
  const open = (issueKey: string): void => {
    if (!isOpenDetailEmittable(issueKey)) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: JIRA_OPEN_DETAIL_ACTION,
      context: { issueKey }
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {items.length} {items.length === 1 ? 'issue' : 'issues'}
      </p>
      {items.map((issue, i) => {
        const actionable = isOpenDetailEmittable(issue.issueKey)
        const card = (
          <TicketCard
            surfaceId={surfaceId}
            componentId={`${issue.issueKey ?? i}`}
            issueKey={issue.issueKey}
            summary={issue.summary}
            statusName={issue.statusName}
            statusCategory={issue.statusCategory}
            assignee={issue.assignee}
            actionable={actionable}
          />
        )
        // Actionable (non-empty key): a real <button> wrapper — focusable, Enter/Space for
        // free, cosmos focus ring on the rounded-xl corner (Slack ChannelList precedent).
        return actionable ? (
          <button
            key={issue.issueKey}
            type="button"
            className="w-full rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${issue.issueKey}`}
            onClick={() => open(issue.issueKey as string)}
          >
            {card}
          </button>
        ) : (
          // Non-actionable ("—"): the inert card, no wrapper, skipped in tab order (§2.2).
          <div key={i}>{card}</div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * TransitionPicker (input → emits jira.transition) (design §6)
 * ------------------------------------------------------------------------- */

export interface TransitionPickerNode extends SdkProps {
  issueKey?: string
  availableTransitions?: JiraTransition[]
}

export function TransitionPicker({
  surfaceId,
  componentId,
  issueKey,
  availableTransitions
}: TransitionPickerNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const [transitionId, setTransitionId] = useFormBinding<string>(
    surfaceId,
    { path: PATH_TRANSITION_ID },
    ''
  )
  const transitions = Array.isArray(availableTransitions) ? availableTransitions : []

  if (transitions.length === 0) {
    return <p className="text-sm text-muted-foreground">No transitions available.</p>
  }

  const apply = (): void => {
    if (!isTransitionSubmittable(transitionId) || !issueKey) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: JiraBoundAction.Transition,
      context: { issueKey, transitionId: { path: PATH_TRANSITION_ID } }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Move to</span>
      <div className="flex items-center gap-2">
        <Select value={transitionId} onValueChange={setTransitionId}>
          <SelectTrigger className="flex-1" aria-label="Select a transition">
            <SelectValue placeholder="Select a transition" />
          </SelectTrigger>
          <SelectContent>
            {transitions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!isTransitionSubmittable(transitionId)}
          onClick={apply}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * CommentRow / CommentList (display) — reuse native CommentRow (design §7)
 * ------------------------------------------------------------------------- */

export interface CommentRowNode extends SdkProps {
  comment?: JiraComment
}

function commentAuthorName(comment: JiraComment | undefined): string {
  return comment?.author?.displayName ?? comment?.author?.accountId ?? 'Unknown'
}

export function CommentRow({ comment }: CommentRowNode): React.JSX.Element {
  const name = commentAuthorName(comment)
  return (
    <div className="flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {comment?.created && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTs(comment.created)}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
          {comment?.body ?? ''}
        </p>
      </div>
    </div>
  )
}

export interface CommentListNode extends SdkProps {
  comments?: JiraComment[]
}

export function CommentList({ surfaceId, comments }: CommentListNode): React.JSX.Element {
  const items = Array.isArray(comments) ? comments : []
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Comments ({items.length})</span>
      {items.length > 0 ? (
        <div className="flex flex-col">
          {items.map((c, i) => (
            <CommentRow key={c.id ?? i} surfaceId={surfaceId} componentId={c.id ?? `${i}`} comment={c} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No comments.</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * AddCommentControl (input → emits jira.comment) (design §8)
 * ------------------------------------------------------------------------- */

export interface AddCommentControlNode extends SdkProps {
  issueKey?: string
}

export function AddCommentControl({
  surfaceId,
  componentId,
  issueKey
}: AddCommentControlNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const [body, setBody] = useFormBinding<string>(surfaceId, { path: PATH_COMMENT_BODY }, '')

  const submit = (): void => {
    if (!isCommentSubmittable(body) || !issueKey) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: JiraBoundAction.Comment,
      context: { issueKey, body: { path: PATH_COMMENT_BODY } }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Add a comment</span>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a comment…"
        aria-label="Add a comment"
        className="max-h-[12rem] min-h-[80px] resize-none"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={!isCommentSubmittable(body)}
          onClick={submit}
        >
          Comment
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * CreateIssueForm (input → emits jira.create) (design §3)
 *
 * A blank multi-field form. projectKey / issueType render as a text Input by default
 * (design §2 note A) and upgrade to a Select only when the builder supplies an
 * options list (projectKeys / issueTypes). Summary is required; description optional.
 * The button mirrors main's validateJiraCreate via isCreateSubmittable (FR-006). On a
 * failed re-push the builder re-seeds the fields (seeded* props → initial values).
 * ------------------------------------------------------------------------- */

export interface CreateIssueFormNode extends SdkProps {
  defaultProjectKey?: string
  issueTypes?: string[]
  projectKeys?: string[]
  seededProjectKey?: string
  seededIssueType?: string
  seededSummary?: string
  seededDescription?: string
}

export function CreateIssueForm({
  surfaceId,
  componentId,
  defaultProjectKey,
  issueTypes,
  projectKeys,
  seededProjectKey,
  seededIssueType,
  seededSummary,
  seededDescription
}: CreateIssueFormNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const [projectKey, setProjectKey] = useFormBinding<string>(
    surfaceId,
    { path: PATH_CREATE_PROJECT_KEY },
    seededProjectKey ?? defaultProjectKey ?? ''
  )
  const [issueType, setIssueType] = useFormBinding<string>(
    surfaceId,
    { path: PATH_CREATE_ISSUE_TYPE },
    seededIssueType ?? ''
  )
  const [summary, setSummary] = useFormBinding<string>(
    surfaceId,
    { path: PATH_CREATE_SUMMARY },
    seededSummary ?? ''
  )
  const [description, setDescription] = useFormBinding<string>(
    surfaceId,
    { path: PATH_CREATE_DESCRIPTION },
    seededDescription ?? ''
  )

  const typeOptions = Array.isArray(issueTypes) ? issueTypes : []
  const projectOptions = Array.isArray(projectKeys) ? projectKeys : []
  const submittable = isCreateSubmittable(projectKey, issueType, summary)

  const create = (): void => {
    if (!submittable) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: JiraBoundAction.Create,
      context: {
        projectKey: { path: PATH_CREATE_PROJECT_KEY },
        issueType: { path: PATH_CREATE_ISSUE_TYPE },
        summary: { path: PATH_CREATE_SUMMARY },
        description: { path: PATH_CREATE_DESCRIPTION }
      }
    })
  }

  return (
    <Card className="gap-4 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <SquareKanban className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Create issue</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="create-project" className="text-xs font-medium text-muted-foreground">
          Project key
        </label>
        {projectOptions.length > 0 ? (
          <Select value={projectKey} onValueChange={setProjectKey}>
            <SelectTrigger id="create-project" aria-label="Select a project">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projectOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="create-project"
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            placeholder="PROJ"
            className="font-mono"
            aria-invalid={projectKey.length > 0 && projectKey.trim().length === 0}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="create-type" className="text-xs font-medium text-muted-foreground">
          Issue type
        </label>
        {typeOptions.length > 0 ? (
          <Select value={issueType} onValueChange={setIssueType}>
            <SelectTrigger id="create-type" aria-label="Select an issue type">
              <SelectValue placeholder="Select an issue type" />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            id="create-type"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            placeholder="Task"
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="create-summary" className="text-xs font-medium text-muted-foreground">
          Summary
        </label>
        <Input
          id="create-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Short summary of the issue"
          aria-invalid={summary.length > 0 && summary.trim().length === 0}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="create-desc" className="text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          id="create-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add more detail…"
          className="max-h-[16rem] min-h-[96px] resize-none"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Project key, type, and summary are required.
        </span>
        <Button type="button" variant="default" size="sm" disabled={!submittable} onClick={create}>
          Create issue
        </Button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------------- *
 * EditIssueForm (input → emits jira.update) (design §4)
 *
 * Seeded from the issue's current summary/description; Save is enabled only when the
 * diff (vs. the seed) is non-empty (isUpdateSubmittable mirrors main's empty-fields
 * rejection — OQ2/FR-006). The emitted `jira.update` context.fields is the COMPUTED
 * diff (a literal subset, design §4.4), NOT a single { path } binding. Assignee is
 * OMITTED from the v1 form (design §2 note B) — `assignee` is carried for display only.
 * ------------------------------------------------------------------------- */

export interface EditIssueFormNode extends SdkProps {
  issueKey?: string
  seededSummary?: string
  seededDescription?: string
  assignee?: JiraUserRef
}

export function EditIssueForm({
  surfaceId,
  componentId,
  issueKey,
  seededSummary,
  seededDescription
}: EditIssueFormNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const seedSummary = seededSummary ?? ''
  const seedDescription = seededDescription ?? ''
  const [summary, setSummary] = useFormBinding<string>(
    surfaceId,
    { path: PATH_EDIT_SUMMARY },
    seedSummary
  )
  const [description, setDescription] = useFormBinding<string>(
    surfaceId,
    { path: PATH_EDIT_DESCRIPTION },
    seedDescription
  )

  const diff: JiraUpdateFields = diffUpdateFields(
    { summary: seedSummary, description: seedDescription },
    { summary, description }
  )
  const submittable = isUpdateSubmittable(diff) && !!issueKey
  const summaryInvalid = summary !== seedSummary && summary.trim().length === 0

  const save = (): void => {
    if (!isUpdateSubmittable(diff) || !issueKey) {
      return
    }
    // design §4.4: pass the computed diff as a literal subset (only changed keys).
    // The SDK's `DynamicValue` context type models only primitives / { path } /
    // FunctionCall, but `resolveContext` passes any non-binding literal through
    // verbatim (dataBinding.resolveValue) — so a nested `fields` object reaches
    // main intact. Cast narrowly to satisfy the under-modeled SDK type.
    dispatch(surfaceId, componentId, {
      name: JiraBoundAction.Update,
      context: { issueKey, fields: diff as unknown as DynamicValue }
    })
  }

  return (
    <Card className="gap-4 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
          {issueKey ?? '—'}
        </Badge>
        <span className="text-sm font-medium text-foreground">Edit issue</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-summary" className="text-xs font-medium text-muted-foreground">
          Summary
        </label>
        <Input
          id="edit-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-invalid={summaryInvalid}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-desc" className="text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          id="edit-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="max-h-[16rem] min-h-[96px] resize-none"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Change a field to enable saving.
        </span>
        <Button type="button" variant="default" size="sm" disabled={!submittable} onClick={save}>
          Save changes
        </Button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------------- *
 * Notice (display) — the post-write notice, v2 colored (design §9.5)
 *
 * Rendered as the first child of a re-pushed detail surface by the surface builder.
 * `kind` selects the glyph + tint; `message` is the non-secret copy from the write
 * result. success reuses the neutral Alert + Check (no new success token, design §9.5).
 * ------------------------------------------------------------------------- */

export interface NoticeNode extends SdkProps {
  noticeKind?: 'success' | 'error' | 'write_not_authorized'
  message?: string
}

/* ------------------------------------------------------------------------- *
 * Generic passthroughs — Column / Text (design §1.1 allows these)
 *
 * The detail surface needs a root container + a description label/body, which the
 * six contract components don't cover. The SDK permits a custom catalog to include
 * generic passthroughs; these are minimal, theme-inheriting shells (no new vocabulary
 * for the agent — the builder emits them, the agent uses the Jira components).
 * ------------------------------------------------------------------------- */

export interface TextNode extends SdkProps {
  text?: string
  variant?: 'label' | 'body'
  muted?: boolean
}

export function Text({ text, variant, muted }: TextNode): React.JSX.Element {
  if (variant === 'label') {
    return <span className="text-xs font-medium text-muted-foreground">{text ?? ''}</span>
  }
  return (
    <p
      className={cn(
        'whitespace-pre-wrap break-words text-sm leading-relaxed',
        muted ? 'text-muted-foreground' : 'text-card-foreground'
      )}
    >
      {text ?? ''}
    </p>
  )
}

export function Notice({ noticeKind, message }: NoticeNode): React.JSX.Element {
  const isError = noticeKind === 'error' || noticeKind === 'write_not_authorized'
  const Glyph = noticeKind === 'write_not_authorized' ? Lock : noticeKind === 'error' ? TriangleAlert : Check
  return (
    <Alert variant={isError ? 'destructive' : 'default'} className={isError ? '' : 'border-status-done/40'}>
      <Glyph className={noticeKind === 'success' || noticeKind === undefined ? 'text-status-done-foreground' : undefined} />
      <AlertDescription className={isError ? 'text-destructive' : 'text-card-foreground'}>
        {message ?? ''}
      </AlertDescription>
    </Alert>
  )
}
