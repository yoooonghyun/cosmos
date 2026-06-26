/**
 * slackCatalog/components — the Slack custom A2UI catalog components (Slack +
 * Confluence generative-UI v1, FR-004). Plain cosmos React components rendered by the
 * Slack panel's `<A2UIProvider catalog={slackCatalog}>`. Cosmos palette only — no Slack
 * brand color, no raw hex (design §2).
 *
 * Each component receives the rest of its surface node spread in by the SDK's
 * `ComponentRenderer` plus `{ surfaceId, componentId }` (design §1.3). These are
 * DISPLAY-ONLY: they read static node props directly (the agent emits the
 * `src/shared/slack.ts` shapes on the node) — there is NO `useFormBinding`/
 * `useDispatchAction`, no input, and no action in v1 (FR-012).
 *
 * Visuals are lifted from `SlackPanel.tsx` (its MessageRow, channel rows, search rows)
 * so the agent-composed body matches the native browser body. Author names use the
 * raw-id fallback (`userName ?? userId`) the native panel uses.
 *
 * Design trace: §2.1 ChannelRow, §2.2 ChannelList, §2.3 MessageRow, §2.4 MessageList,
 * §2.5 SearchResultRow, §2.6 SearchResultList, §2.7 UserChip, §2.8 Notice, §2.9 Text.
 */

import { useRef } from 'react'
import { useDataBinding, useDispatchAction } from '@a2ui-sdk/react/0.9'
import { Hash, Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
// slack-generative-adapter-v1 (design §6): the bound Slack lists reuse the SHARED adapter
// controls + binding helpers VERBATIM (the single definition the Jira catalog also uses).
// Slack registers LoadMoreButton only — never PaginationBar (append-only). Refresh moved to
// the panel chrome (panel-refresh-v1, FR-006) — no in-surface RefreshButton.
import { LoadMoreButton, useBound, type Bound } from '../catalogShared/controls'
// slack-generative-message-parity-v1 (OQ-3 = full unification): the ONE canonical row,
// shared with the native panel; the catalog list skeleton (design §5).
import { SlackMessageRow } from './SlackMessageRow'
import { MessageSkeleton } from './MessageSkeleton'
import type { SlackImageRef } from '../../shared/slack'
import {
  boundRows,
  buildOpenThreadContext,
  countLabel,
  initials,
  messageToRowProps,
  orderBoundMessages,
  searchMatchToRowProps,
  showEmptyState,
  showErrorNotice,
  showSkeletonState,
  SLACK_LIST_SCROLL_CLASS,
  SLACK_OPEN_CHANNEL_ACTION,
  SLACK_OPEN_THREAD_ACTION
} from './logic'

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
}

/**
 * Derive a "has loaded at least once" signal renderer-locally (slack-generative-message-
 * parity-v1, FR-015). The bound surface does NOT carry a `loaded` flag (the node props are
 * rows/loading/hasMore/error only), so each bound list latches loaded-once when it first
 * sees a non-empty result OR a settled (not-loading) state. Until then, an empty list is
 * treated as "loading" (skeleton) rather than "genuinely empty" (mirrors the native panel's
 * `loaded` flag). The ref never un-latches, so a later refresh that momentarily clears rows
 * keeps `loaded=true` and the gating shows the skeleton (not the empty state) only while
 * `loading` is true.
 */
function useLoadedOnce(rowCount: number, loading: boolean): boolean {
  const loadedRef = useRef(false)
  if (!loadedRef.current && (rowCount > 0 || !loading)) {
    loadedRef.current = true
  }
  return loadedRef.current
}

/* ------------------------------------------------------------------------- *
 * ChannelRow / ChannelList (design §2.1 / §2.2) — SlackChannel
 * ------------------------------------------------------------------------- */

export interface ChannelRowNode extends SdkProps {
  id?: string
  name?: string
  isMember?: boolean
}

export function ChannelRow({ name, isMember }: ChannelRowNode): React.JSX.Element {
  return (
    <div className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 hover:bg-accent/40">
      <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-foreground">{name ?? ''}</span>
      {isMember && (
        <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
          member
        </Badge>
      )}
    </div>
  )
}

/**
 * The recoverable-error Notice the bound lists render ABOVE kept rows (design §3 / FR-007).
 * Reuses the catalog's destructive Alert treatment; prior data is NOT cleared. Returns
 * null when there is no error message.
 */
function BoundListError({ message }: { message: string | undefined }): React.JSX.Element | null {
  if (!showErrorNotice(message)) {
    return null
  }
  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/15">
      <TriangleAlert className="text-destructive" />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  )
}

export interface ChannelListNode extends SdkProps {
  /**
   * The rows. A bound surface passes a `{path}` (slack-generative-adapter-v1, FR-001/FR-002)
   * so a refresh / load-more `updateDataModel` re-renders the list in place; a static
   * builder passes the literal array. Resolved through `useBound`.
   */
  channels?: Bound<ChannelRowNode[]>
  /** Bound busy flag (FR-004) — drives the RefreshButton + LoadMoreButton spinners. */
  loading?: Bound<boolean>
  /** Bound "a next page exists" flag (FR-012) — gates the LoadMoreButton. */
  hasMore?: Bound<boolean>
  /** Bound recoverable error notice (FR-007) — shown above the list when present. */
  error?: Bound<string>
  /** Region key (multi-region partitioned surface) — forwarded to LoadMoreButton so a
   * load-more reloads only this container's fetcher. Absent → surface-wide. */
  region?: string
}

export function ChannelList({
  surfaceId,
  componentId,
  channels,
  loading,
  hasMore,
  error,
  region
}: ChannelListNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const rows = useBound<ChannelRowNode[]>(surfaceId, channels, undefined)
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const errorMessage = useDataBinding<string | undefined>(surfaceId, error, undefined)
  const items = boundRows(rows)
  // slack-generative-message-parity-v1 (FR-014/FR-015): gating order error > skeleton >
  // empty > rows, with loaded-once derived renderer-locally.
  const loaded = useLoadedOnce(items.length, isLoading)
  // A row click navigates to that channel's native conversation view. The action is
  // handled renderer-locally by the Slack panel (not sent to main/the agent). A channel
  // missing an id is non-navigable (still shown). Coexists with the header/footer
  // adapter.* controls — different components, no collision (design §2.3).
  const open = (channel: ChannelRowNode): void => {
    if (!channel.id) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: SLACK_OPEN_CHANNEL_ACTION,
      context: {
        channelId: channel.id,
        channelName: channel.name ?? '',
        isMember: channel.isMember ?? false
      }
    })
  }
  if (showSkeletonState(items.length, isLoading, loaded, errorMessage)) {
    return <MessageSkeleton />
  }
  if (showEmptyState(items.length, errorMessage, loaded, isLoading)) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center" aria-busy={isLoading}>
        <Hash className="size-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No channels.</p>
      </div>
    )
  }
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-1" aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {countLabel(items.length, 'channel', 'channels')}
        </p>
      </div>
      {items.map((channel, i) =>
        channel.id ? (
          <button
            key={channel.id}
            type="button"
            className="w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => open(channel)}
            aria-label={`Open #${channel.name ?? channel.id}`}
          >
            <ChannelRow {...channel} surfaceId="" componentId="" />
          </button>
        ) : (
          <ChannelRow key={i} {...channel} surfaceId="" componentId="" />
        )
      )}
      <LoadMoreButton surfaceId={surfaceId} componentId={componentId} loading={loading} hasMore={hasMore} region={region} />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * MessageRow / MessageList (design §2.3 / §2.4) — SlackMessage
 * ------------------------------------------------------------------------- */

export interface MessageRowNode extends SdkProps {
  ts?: string
  userId?: string
  userName?: string
  text?: string
  replyCount?: number
  /** Per-message custom-emoji shortcode → opaque ref map (slack-rich-message-render-v1,
   * FR-006/FR-007). Forwarded to the shared row's inline-emoji rendering. */
  customEmoji?: Record<string, string>
  /** Inline image attachment refs (FR-009/FR-010). Forwarded to the shared row's thumbnails. */
  images?: SlackImageRef[]
  /**
   * Non-secret thread coordinates (slack-generative-message-parity-v1, FR-013). Carried
   * by channel-history rows only (the adapter injects `channelId` + `threadTs = ts` for the
   * getHistory branch); absent on search rows. Their presence turns the "N replies"
   * affordance into the interactive reply drill-in; absent → the non-interactive label
   * (FR-012). NEVER a token/secret.
   */
  channelId?: string
  threadTs?: string
}

export function MessageRow({
  surfaceId,
  componentId,
  ts,
  userId,
  userName,
  text,
  replyCount,
  customEmoji,
  images,
  channelId,
  threadTs
}: MessageRowNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  // slack-generative-message-parity-v1 (FR-005/FR-008/FR-013): build the secret-free reply
  // drill-in context from this row's coords. Null when coords are absent → no onOpenThread
  // → the shared row renders the non-interactive label (FR-012). The action is handled
  // renderer-locally by the Slack panel (intercepted, never sent to main/the agent). The
  // list passes its real surfaceId/componentId so the dispatch routes through the SDK.
  const threadCtx = buildOpenThreadContext({ channelId, threadTs, ts, userId, userName, text, replyCount })
  const onOpenThread = threadCtx
    ? (): void => {
        dispatch(surfaceId, componentId, {
          name: SLACK_OPEN_THREAD_ACTION,
          context: { ...threadCtx }
        })
      }
    : undefined
  // slack-search-row-full-parity-v1: build the row props through the ONE shared mapper
  // (`messageToRowProps`) the native history + native/generated search rows also use, so the
  // field selection can never diverge across contexts. The dispatched-action `onOpenThread`
  // (vs. the native closure carrying a SlackMessage) is the only per-context piece.
  return (
    <SlackMessageRow
      {...messageToRowProps(
        { ts, userId, userName, text, replyCount, customEmoji, images },
        onOpenThread ? { onOpenThread } : {}
      )}
    />
  )
}

export interface MessageListNode extends SdkProps {
  /**
   * The rows. A bound surface passes a `{path}` (slack-generative-adapter-v1, FR-001/FR-002)
   * so a refresh / append `updateDataModel` re-renders the list in place; a static builder
   * passes the literal array. Resolved through `useBound`.
   */
  messages?: Bound<MessageRowNode[]>
  /** Bound busy flag (FR-004) — drives the RefreshButton + LoadMoreButton spinners. */
  loading?: Bound<boolean>
  /** Bound "a next page exists" flag (FR-012) — gates the LoadMoreButton. */
  hasMore?: Bound<boolean>
  /** Bound recoverable error notice (FR-007) — shown above the list when present. */
  error?: Bound<string>
  /** Region key (multi-region partitioned surface) — forwarded to LoadMoreButton so a
   * load-more reloads only this container's fetcher. Absent → surface-wide. */
  region?: string
}

export function MessageList({
  surfaceId,
  componentId,
  messages,
  loading,
  hasMore,
  error,
  region
}: MessageListNode): React.JSX.Element {
  const rows = useBound<MessageRowNode[]>(surfaceId, messages, undefined)
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const errorMessage = useDataBinding<string | undefined>(surfaceId, error, undefined)
  // bug slack-generated-message-order-v1: the shared dispatcher APPENDS each older page at the
  // bottom of the accumulated array (correct for Jira/Confluence), but Slack history paginates
  // to OLDER messages, so render the bound rows in one ascending order to match the native
  // panel (newest-at-bottom). Re-ordering here leaves the shared dispatcher untouched.
  const items = orderBoundMessages(boundRows(rows))
  const loaded = useLoadedOnce(items.length, isLoading)
  if (showSkeletonState(items.length, isLoading, loaded, errorMessage)) {
    return <MessageSkeleton />
  }
  if (showEmptyState(items.length, errorMessage, loaded, isLoading)) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground" aria-busy={isLoading}>
        No messages.
      </p>
    )
  }
  return (
    // slack-list-scroll-fill-v2 (FR-001/FR-002/FR-006): the message list consumes the v2 fill
    // chain (SLACK_LIST_SCROLL_CLASS: min-h-0 flex-1 overflow-y-auto, threaded from the host
    // through the layout.tsx wrapper) so a LONE list fills to the panel bottom (no dead gap) and
    // N lists equal-split + each scroll independently. The count label, top load-more, and rows
    // stay inside the region (FR-005); a short list shows no inner scrollbar (FR-004).
    <div className={cn('flex w-full flex-col', SLACK_LIST_SCROLL_CLASS)} aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {countLabel(items.length, 'message', 'messages')}
        </p>
      </div>
      {/* bug slack-generated-message-order-v1: the message list is newest-at-bottom, so the
          load-more (OLDER history) affordance belongs at the TOP — loading older messages grows
          the list ABOVE the existing thread, matching the native panel. ChannelList /
          SearchResultList keep their bottom load-more (those are not chronological threads). */}
      <LoadMoreButton surfaceId={surfaceId} componentId={componentId} loading={loading} hasMore={hasMore} region={region} />
      {items.map((m, i) => (
        // slack-generative-message-parity-v1 (FR-005): pass the list's real
        // surfaceId/componentId so the row's reply-drill-in dispatch routes through the SDK.
        <MessageRow key={m.ts ?? i} {...m} surfaceId={surfaceId} componentId={componentId} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * SearchResultRow / SearchResultList (design §2.5 / §2.6) — SlackSearchMatch
 * ------------------------------------------------------------------------- */

export interface SearchResultRowNode extends SdkProps {
  ts?: string
  userId?: string
  userName?: string
  text?: string
  /** Per-match custom-emoji shortcode → opaque ref map (slack-rich-message-render-v1,
   * FR-006/FR-012) so a search row renders custom emoji like a history row. */
  customEmoji?: Record<string, string>
  /** Inline image attachment refs (slack-search-row-full-parity-v1) — search hits now carry them
   * (extracted main-side), so a generated search row shows the same thumbnail strip a history row
   * does. Forwarded to the shared row's thumbnails. */
  images?: SlackImageRef[]
  channelId?: string
  channelName?: string
  /** The thread root key the row drills into (slack-search-row-full-parity-v1). A search hit is its
   * own thread root (`threadTs = ts`); with `channelId` it makes the row clickable to open its
   * thread — exactly like a generated history row. Absent ⇒ non-interactive row. */
  threadTs?: string
}

export function SearchResultRow({
  surfaceId,
  componentId,
  ts,
  userId,
  userName,
  text,
  customEmoji,
  images,
  channelId,
  channelName,
  threadTs
}: SearchResultRowNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  // slack-search-row-full-parity-v1 (supersedes slack-search-shared-row-v1): a search hit renders
  // via the ONE canonical SlackMessageRow AND the SAME unified mapper (`searchMatchToRowProps` →
  // `messageToRowProps`) the native + generated history rows use, so avatars, rich text, custom
  // emoji, RESOLVED author name, and now inline IMAGES are identical to a channel-history row. A
  // search hit now carries thread coords (channelId + threadTs = ts), so the row is ALSO clickable
  // to open its thread — the SAME SLACK_OPEN_THREAD_ACTION drill-in the generated history row
  // dispatches (handled renderer-locally by the Slack panel, never sent to main). `userName` is the
  // RESOLVED display name (`resolveAuthorNames` fills it before this renders); the `#channelName`
  // chip + the absent "N replies" label (search.messages omits reply_count) are the only intended
  // differences.
  const threadCtx = buildOpenThreadContext({ channelId, threadTs, ts, userId, userName, text })
  const onOpenThread = threadCtx
    ? (): void => {
        dispatch(surfaceId, componentId, {
          name: SLACK_OPEN_THREAD_ACTION,
          context: { ...threadCtx }
        })
      }
    : undefined
  return (
    <SlackMessageRow
      {...searchMatchToRowProps(
        {
          ts: ts ?? '',
          userId: userId ?? '',
          ...(userName !== undefined ? { userName } : {}),
          text: text ?? '',
          ...(customEmoji ? { customEmoji } : {}),
          ...(images ? { images } : {}),
          channelId: channelId ?? '',
          ...(channelName ? { channelName } : {})
        },
        onOpenThread ? { onOpenThread } : {}
      )}
    />
  )
}

export interface SearchResultListNode extends SdkProps {
  /**
   * The rows. A bound surface passes a `{path}` (slack-generative-adapter-v1, FR-001/FR-002)
   * so a refresh / append `updateDataModel` re-renders the list in place; a static builder
   * passes the literal array. Resolved through `useBound`.
   */
  matches?: Bound<SearchResultRowNode[]>
  /** Bound busy flag (FR-004) — drives the RefreshButton + LoadMoreButton spinners. */
  loading?: Bound<boolean>
  /** Bound "a next page exists" flag (FR-012) — gates the LoadMoreButton. */
  hasMore?: Bound<boolean>
  /** Bound recoverable error notice (FR-007) — shown above the list when present. */
  error?: Bound<string>
  /** Region key (multi-region partitioned surface) — forwarded to LoadMoreButton so a
   * load-more reloads only this container's fetcher. Absent → surface-wide. */
  region?: string
}

export function SearchResultList({
  surfaceId,
  componentId,
  matches,
  loading,
  hasMore,
  error,
  region
}: SearchResultListNode): React.JSX.Element {
  const rows = useBound<SearchResultRowNode[]>(surfaceId, matches, undefined)
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const errorMessage = useDataBinding<string | undefined>(surfaceId, error, undefined)
  const items = boundRows(rows)
  const loaded = useLoadedOnce(items.length, isLoading)
  if (showSkeletonState(items.length, isLoading, loaded, errorMessage)) {
    return <MessageSkeleton />
  }
  if (showEmptyState(items.length, errorMessage, loaded, isLoading)) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground" aria-busy={isLoading}>
        No results.
      </p>
    )
  }
  return (
    // slack-list-scroll-fill-v2 (FR-001/FR-002/FR-006): the search-result list consumes the
    // same v2 fill chain (SLACK_LIST_SCROLL_CLASS as MessageList — it renders the same shared
    // SlackMessageRow), so a lone list fills the panel and N lists equal-split + each scroll
    // independently. Count label, rows, and the bottom load-more stay inside the region (FR-005).
    <div className={cn('flex w-full flex-col', SLACK_LIST_SCROLL_CLASS)} aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {countLabel(items.length, 'result', 'results')}
        </p>
      </div>
      {items.map((m, i) => (
        <SearchResultRow
          key={`${m.channelId ?? ''}-${m.ts ?? i}`}
          {...m}
          surfaceId=""
          componentId=""
        />
      ))}
      <LoadMoreButton surfaceId={surfaceId} componentId={componentId} loading={loading} hasMore={hasMore} region={region} />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * UserChip (design §2.7) — SlackUser
 * ------------------------------------------------------------------------- */

export interface UserChipNode extends SdkProps {
  id?: string
  displayName?: string
}

export function UserChip({ id, displayName }: UserChipNode): React.JSX.Element {
  const name = displayName && displayName.trim() !== '' ? displayName : id ?? ''
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar size="sm">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  )
}

/* ------------------------------------------------------------------------- *
 * Notice (design §2.8) — not-connected / read-error / empty fallback (FR-011)
 * ------------------------------------------------------------------------- */

export interface NoticeNode extends SdkProps {
  noticeKind?: 'info' | 'error'
  message?: string
}

export function Notice({ noticeKind, message }: NoticeNode): React.JSX.Element {
  const isError = noticeKind === 'error'
  const Glyph = isError ? TriangleAlert : Info
  return (
    <Alert
      variant={isError ? 'destructive' : 'default'}
      className={isError ? 'border-destructive/40 bg-destructive/15' : ''}
    >
      <Glyph className={isError ? 'text-destructive' : 'text-muted-foreground'} />
      <AlertDescription className={isError ? 'text-destructive' : 'text-card-foreground'}>
        {message ?? ''}
      </AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------------- *
 * Text passthrough (design §2.9) — identical to the Jira catalog's Text
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
