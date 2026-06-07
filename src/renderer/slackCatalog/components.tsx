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

import { useDispatchAction } from '@a2ui-sdk/react/0.9'
import { Hash, Info, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { authorName, countLabel, formatTs, initials, SLACK_OPEN_CHANNEL_ACTION } from './logic'

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

export interface ChannelListNode extends SdkProps {
  channels?: ChannelRowNode[]
}

export function ChannelList({ surfaceId, componentId, channels }: ChannelListNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const items = Array.isArray(channels) ? channels : []
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Hash className="size-7 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No channels.</p>
      </div>
    )
  }
  // A row click navigates to that channel's native conversation view. The action is
  // handled renderer-locally by the Slack panel (not sent to main/the agent). A channel
  // missing an id is non-navigable (still shown).
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
  return (
    <div className="flex flex-col">
      <p className="px-2 py-1.5 text-xs text-muted-foreground" aria-live="polite">
        {countLabel(items.length, 'channel', 'channels')}
      </p>
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
  messages?: MessageRowNode[]
}

export function MessageList({ messages }: MessageListNode): React.JSX.Element {
  const items = Array.isArray(messages) ? messages : []
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No messages.</p>
  }
  return (
    <div className="flex flex-col">
      {items.map((m, i) => (
        <MessageRow key={m.ts ?? i} {...m} surfaceId="" componentId="" />
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
  matches?: SearchResultRowNode[]
}

export function SearchResultList({ matches }: SearchResultListNode): React.JSX.Element {
  const items = Array.isArray(matches) ? matches : []
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results.</p>
  }
  return (
    <div className="flex flex-col">
      <p className="px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
        {countLabel(items.length, 'result', 'results')}
      </p>
      {items.map((m, i) => (
        <SearchResultRow
          key={`${m.channelId ?? ''}-${m.ts ?? i}`}
          {...m}
          surfaceId=""
          componentId=""
        />
      ))}
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
