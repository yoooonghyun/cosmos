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
import {
  authorName,
  boundRows,
  countLabel,
  formatTs,
  initials,
  showEmptyState,
  showErrorNotice,
  SLACK_OPEN_CHANNEL_ACTION
} from './logic'

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
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
    <div className="flex h-8 items-center gap-1.5 rounded-md px-2 hover:bg-accent/40">
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
  if (showEmptyState(items.length, errorMessage)) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center" aria-busy={isLoading}>
        <Hash className="size-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No channels.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1" aria-busy={isLoading}>
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
}

export function MessageRow({
  ts,
  userId,
  userName,
  text,
  replyCount
}: MessageRowNode): React.JSX.Element {
  const name = authorName(userId ?? '', userName)
  return (
    <div className="flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatTs(ts ?? '')}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
          {text ?? ''}
        </p>
        {typeof replyCount === 'number' && replyCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </p>
        )}
      </div>
    </div>
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
  const items = boundRows(rows)
  if (showEmptyState(items.length, errorMessage)) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground" aria-busy={isLoading}>
        No messages.
      </p>
    )
  }
  return (
    <div className="flex flex-col" aria-busy={isLoading}>
      <BoundListError message={errorMessage} />
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {countLabel(items.length, 'message', 'messages')}
        </p>
      </div>
      {items.map((m, i) => (
        <MessageRow key={m.ts ?? i} {...m} surfaceId="" componentId="" />
      ))}
      <LoadMoreButton surfaceId={surfaceId} componentId={componentId} loading={loading} hasMore={hasMore} region={region} />
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
  channelId?: string
  channelName?: string
}

export function SearchResultRow({
  ts,
  userId,
  userName,
  text,
  channelName
}: SearchResultRowNode): React.JSX.Element {
  const name = authorName(userId ?? '', userName)
  return (
    <div className="flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {channelName && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              #{channelName}
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatTs(ts ?? '')}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
          {text ?? ''}
        </p>
      </div>
    </div>
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
  if (showEmptyState(items.length, errorMessage)) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground" aria-busy={isLoading}>
        No results.
      </p>
    )
  }
  return (
    <div className="flex flex-col" aria-busy={isLoading}>
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
