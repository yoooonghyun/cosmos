/**
 * CommentsSection — the native Confluence page-dock comments list + one-level reply tree +
 * bottom-pinned composer (confluence-dock-comments-v1). Mounted inside the page-detail dock
 * body as the OWNER of the dock's scroll layout: it renders the page-body `children` at the
 * top of a single `ScrollArea`, the comments region beneath them (separated by a `border-t`),
 * and a sticky composer bar OUTSIDE the scroll so the write affordance is always reachable
 * (design §2). Keyed by `pageId` upstream (the dock remounts `PageDetail key={pageId}`), so an
 * in-flight read for a no-longer-open page is discarded for free; a belt-and-suspenders
 * `pageId` guard in `run()` mirrors the `PageDetail` discipline (FR-009).
 *
 * Reads/writes go through the renderer IPC `window.cosmos.confluence.getComments`/`addComment`
 * — never the agent. Comment + reply bodies reuse the SAME `PageDetailBody` (DOMPurify + the
 * `prose-cosmos` map) the page body uses (OQ-3); no token ever reaches here (FR-011).
 *
 * States (design §5): loading (skeleton) / empty / populated / fetch-error (ErrorState) /
 * reconnect_needed (ReconnectState) / comment_read_not_authorized (calm inline reconnect) —
 * all recoverable, none crash. The composer surfaces an inline error on a failed add and
 * PRESERVES the typed text (FR-008); on success it clears and re-fetches (OQ-2).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import type { ConfluenceComment, ConfluenceError } from '../../shared/confluence'
import { ErrorState, ReconnectState, formatTs, initials } from '../atlassianPanelBits'
import { PageDetailBody } from './components'

/** Author display name with the design's fallback chain (design §3). */
function commentAuthorName(comment: ConfluenceComment): string {
  return comment.author?.displayName ?? comment.author?.accountId ?? 'Unknown'
}

/** Count top-level comments + their one-level replies for the section header label. */
function totalCommentCount(comments: ConfluenceComment[]): number {
  return comments.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0)
}

/** One comment row (top-level or reply) — Jira `CommentRow` idiom with a RICH body (design §3). */
function CommentRow({ comment }: { comment: ConfluenceComment }): React.JSX.Element {
  const name = commentAuthorName(comment)
  const replies = Array.isArray(comment.replies) ? comment.replies : []
  return (
    <div className="flex gap-2.5 border-b border-border/60 py-2.5 last:border-b-0">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {comment.created && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTs(comment.created)}
            </span>
          )}
        </div>
        <PageDetailBody body={comment.body} />
        {replies.length > 0 && (
          <div className="ml-7 mt-2 flex flex-col gap-2 border-l border-border/60 pl-3">
            {replies.map((reply, i) => (
              <ReplyRow key={reply.id || i} reply={reply} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One reply row — a `CommentRow` without its own bottom divider (replies are gap-separated). */
function ReplyRow({ reply }: { reply: ConfluenceComment }): React.JSX.Element {
  const name = commentAuthorName(reply)
  return (
    <div className="flex gap-2.5">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {reply.created && (
            <span className="shrink-0 text-xs text-muted-foreground">{formatTs(reply.created)}</span>
          )}
        </div>
        <PageDetailBody body={reply.body} />
      </div>
    </div>
  )
}

/** Loading skeleton — foreshadows the avatar + name + body row (design §5). */
function CommentsSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-2.5 py-2.5">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The comment-read-not-authorized state (design §5): a calm, NON-error inline reconnect
 * prompt (the `read:comment:confluence` scope gap is one-time setup, not a failure).
 */
function CommentReadReconnect({ onReconnect }: { onReconnect: () => void }): React.JSX.Element {
  return (
    <div>
      <Alert className="border-border bg-muted/40">
        <AlertTitle>Comments need a reconnect</AlertTitle>
        <AlertDescription>Reconnect Confluence to view comments on this page.</AlertDescription>
      </Alert>
      <Button variant="default" size="sm" className="mt-2" onClick={onReconnect}>
        Reconnect to view comments
      </Button>
    </div>
  )
}

type CommentsState =
  | { status: 'loading' }
  | { status: 'ready'; comments: ConfluenceComment[] }
  | { status: 'error'; error: ConfluenceError }

/**
 * The comments region (header + body for the current read state). Kept separate from the
 * composer so the composer can stay pinned outside the scroll area.
 */
function CommentsList({
  state,
  onRetry,
  onReconnect
}: {
  state: CommentsState
  onRetry: () => void
  onReconnect: () => void
}): React.JSX.Element {
  const count = state.status === 'ready' ? totalCommentCount(state.comments) : undefined
  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {count === undefined ? 'Comments' : `Comments (${count})`}
        </span>
      </div>
      {state.status === 'loading' && <CommentsSkeleton />}
      {state.status === 'error' &&
        (state.error.kind === 'reconnect_needed' ? (
          // Reuse the shared reconnect banner; strip its default p-3 so it aligns with the section.
          <div className="-mx-3">
            <ReconnectState provider="Confluence" onReconnect={onReconnect} />
          </div>
        ) : state.error.kind === 'comment_read_not_authorized' ? (
          <CommentReadReconnect onReconnect={onReconnect} />
        ) : (
          <div className="-mx-3">
            <ErrorState provider="Confluence" error={state.error} onRetry={onRetry} />
          </div>
        ))}
      {state.status === 'ready' &&
        (state.comments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="flex flex-col">
            {state.comments.map((c, i) => (
              <CommentRow key={c.id || i} comment={c} />
            ))}
          </div>
        ))}
    </div>
  )
}

/**
 * The bottom-pinned composer (design §4). Disabled when empty/whitespace or in-flight;
 * shows a busy state that prevents double-submit; clears on success; preserves typed text +
 * surfaces an inline error on failure.
 */
function Composer({
  pageId,
  onAdded
}: {
  pageId: string
  onAdded: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submittable = draft.trim() !== '' && !inFlight

  const submit = useCallback(async () => {
    if (draft.trim() === '' || inFlight) {
      return
    }
    setInFlight(true)
    setError(null)
    const result = await window.cosmos.confluence.addComment({ pageId, body: draft })
    setInFlight(false)
    if (result.ok) {
      setDraft('') // clear ONLY on confirmed success (FR-005/FR-008)
      onAdded() // trigger the re-fetch (OQ-2)
    } else {
      // Preserve the typed text for retry; surface a recoverable, non-secret notice (FR-008).
      setError(
        result.kind === 'write_not_authorized'
          ? 'Reconnect Confluence to comment.'
          : result.message
      )
    }
  }, [draft, inFlight, pageId, onAdded])

  return (
    <div className="shrink-0 border-t border-border p-3">
      <div className="flex flex-col gap-2">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
          >
            {error}
          </p>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a comment…"
          aria-label="Add a comment"
          className="max-h-[12rem] min-h-[72px] resize-none"
          disabled={inFlight}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!submittable}
            onClick={() => void submit()}
          >
            {inFlight ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Posting…
              </>
            ) : (
              'Comment'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * CommentsSection — owns the dock-body scroll layout for one page. Renders the page-body
 * `children` at the top of the scroll area, the comments region beneath, and the pinned
 * composer below the scroll. Loads comments on mount (and reloads on retarget because the dock
 * remounts this keyed by `pageId`); discards a stale in-flight read whose `pageId` no longer
 * matches (FR-009).
 */
export function CommentsSection({
  pageId,
  onReconnect,
  children
}: {
  pageId: string
  /** Trigger the existing connect/reconnect flow (`window.cosmos.confluence.connect()`). */
  onReconnect: () => void
  /** The page header + body rendered above the comments inside the shared scroll area. */
  children: React.ReactNode
}): React.JSX.Element {
  const [state, setState] = useState<CommentsState>({ status: 'loading' })
  // Identifies the page this effect's results belong to; a resolved read for a different
  // pageId is ignored (belt-and-suspenders to the keyed remount — FR-009).
  const activePageRef = useRef(pageId)

  const run = useCallback(async () => {
    activePageRef.current = pageId
    setState({ status: 'loading' })
    const result = await window.cosmos.confluence.getComments({ pageId })
    if (activePageRef.current !== pageId) {
      return // a retarget happened while loading — discard this stale result
    }
    if (result.ok) {
      setState({ status: 'ready', comments: result.data.comments })
    } else {
      setState({ status: 'error', error: result })
    }
  }, [pageId])

  useEffect(() => {
    void run()
  }, [run])

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          {children}
          <CommentsList state={state} onRetry={() => void run()} onReconnect={onReconnect} />
        </div>
      </ScrollArea>
      <Composer pageId={pageId} onAdded={() => void run()} />
    </div>
  )
}
