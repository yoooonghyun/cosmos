/**
 * SlackPanel — the native cosmos Slack surface (Slack integration v1).
 *
 * Built to design §2: a connection bar (always present) + a content region with a
 * channel-list -> channel-history -> thread back-stack and a search entry. Every
 * read surface renders all five states (loading / empty / populated / error /
 * disabled). Token-only styling, cosmos palette — no Slack brand color, no raw hex.
 *
 * Spec trace:
 *   FR-011 native React Slack panel, distinct from the Generated-UI panel
 *   FR-012 not-connected -> connect affordance, no reads
 *   FR-013 list channels (paginated), channel history, thread replies
 *   FR-014 resolve author ids to display names; raw-id fallback
 *   FR-015 search when permitted; "unavailable" when not
 *   FR-016 loading / empty / error states for every read surface
 *   FR-026 graceful errors incl. 429 "busy, retry shortly"
 *   SC-007 reconnect-needed prompt (panel) on a rejected token
 *
 * The token never reaches here (FR-006, SC-008): the panel requests *operations*
 * over `window.cosmos.slack`; main attaches the token.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A2UIProvider, type A2UIAction } from '@a2ui-sdk/react/0.9'
import {
  AlertTriangle,
  ChevronLeft,
  ExternalLink,
  Hash,
  Loader2,
  MessageSquare,
  Search,
  SendHorizontal,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { slackCatalog, SLACK_CATALOG_ID, SLACK_OPEN_CHANNEL_ACTION } from './slackCatalog'
import { SlackMessageRow } from './slackCatalog/SlackMessageRow'
import {
  buildOpenThreadContext,
  coerceImageRefs,
  countLabel,
  filterChannelsByName,
  messageToRowProps,
  prependOlderMessages,
  searchMatchToRowProps,
  searchModeLabel,
  searchPlaceholder,
  SLACK_OPEN_THREAD_ACTION,
  SLACK_SEARCH_MODES,
  type SlackOpenThreadContext,
  type SlackSearchMode
} from './slackCatalog/logic'
import {
  type OpenThreadState,
  openThread as openThreadTransition,
  closeThread as closeThreadTransition,
  dropThreadRoot,
  isOpenableThreadPermalink,
  messageListWrapClass
} from './slackThreadPanelLogic'
import { PanelTabStrip, type PanelTab } from '../tabs/PanelTabStrip'
import { PanelRefreshButton } from '../generative/PanelRefreshButton'
import { panelRefreshInputsFor } from '../generative/panelRefreshLogic'
import { PanelFooter } from '../PanelFooter'
import { ActiveTabSurface } from '../generative/ActiveTabSurface'
import { usePublishComposer } from '../composer/ActiveComposerProvider'
import { SurfaceSpinner } from '../SurfaceSpinner'
import { GlassDock } from '../glassDock/GlassDock'
import { useGenerativePanelTabs } from '../tabs/useGenerativePanelTabs'
import { contextChipFor, slackViewContext } from '../viewContextCapture'
import { useRestoredGenerativePanel } from '../session/SessionProvider'
import { surfaceSpinnerVisible } from '../composer/promptComposerLogic'
import { usePerTabNav } from '../tabs/usePerTabNav'
import { useTabShortcuts } from '../tabs/useTabShortcuts'
import { canSubmitSlackMessage } from './slackComposerLogic'
import { useSlackScrollToLatest } from './useSlackScrollToLatest'
import { useSlackScrollPaginate } from './useSlackScrollPaginate'
import { loadAllChannels } from './slackChannelSearchLogic'
import { useConfirm } from '../useConfirm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { confirmCopy } from '../confirmLogic'
import type {
  SlackChannel,
  SlackConnectionStatus,
  SlackError,
  SlackMessage,
  SlackPage,
  SlackResult,
  SlackSearchMatch,
  SlackSendResult,
  SlackUser
} from '../../shared/types/slack'

/* ------------------------------------------------------------------------- *
 * Helpers
 *
 * Author/initials/timestamp presentation now lives ONCE in the shared `SlackMessageRow`
 * (search + history + thread all render through it — bug slack-search-shared-row-v1), so
 * the panel no longer hand-rolls those formatters.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * Small shared sub-views (uniform across read surfaces — design §2.3)
 * ------------------------------------------------------------------------- */

/** Loading skeleton rows shaped like message rows. */
function MessageSkeletons(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Loading skeleton rows shaped like channel rows. */
function ChannelSkeletons(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-2" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

/** Empty-state line scoped to a surface. */
function EmptyLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>
  )
}

/**
 * Error state for a read surface (design §2.3): destructive-tinted Alert + Retry.
 * Rate-limit (429) shows the "busy, retry shortly" copy and disables Retry until
 * the Retry-After window elapses (FR-026).
 */
function ErrorState({ error, onRetry }: { error: SlackError; onRetry: () => void }): React.JSX.Element {
  const [cooldown, setCooldown] = useState(
    error.kind === 'rate_limited' ? error.retryAfterSeconds ?? 0 : 0
  )
  useEffect(() => {
    if (cooldown <= 0) {
      return
    }
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const isRate = error.kind === 'rate_limited'
  return (
    <div className="p-3">
      <Alert
        variant="destructive"
        className="border-destructive/40 bg-destructive/15"
        role="alert"
      >
        <AlertTitle>{isRate ? 'Slack is busy' : 'Something went wrong'}</AlertTitle>
        <AlertDescription>
          {isRate ? 'Slack is busy — retrying shortly.' : error.message}
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={onRetry}
        disabled={cooldown > 0}
      >
        {cooldown > 0 ? `Retry in ${cooldown}s` : 'Retry'}
      </Button>
    </div>
  )
}

/** Reconnect-needed banner shown when a token is rejected mid-read (SC-007). */
function ReconnectState({ onReconnect }: { onReconnect: () => void }): React.JSX.Element {
  return (
    <div className="p-3">
      <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
        <AlertTitle>Reconnect needed</AlertTitle>
        <AlertDescription>Your Slack connection expired. Reconnect to continue.</AlertDescription>
      </Alert>
      <Button type="button" variant="default" size="sm" className="mt-2" onClick={onReconnect}>
        Reconnect
      </Button>
    </div>
  )
}

/**
 * One message row (history + thread) — a THIN adapter over the shared `SlackMessageRow`
 * (slack-generative-message-parity-v1, OQ-3 = full unification, FR-017). The native and
 * generated Slack surfaces now share ONE presentation, so wrap/author/timestamp/reply
 * behavior cannot diverge. The only native-specific piece is the `onOpenThread` wiring
 * (it carries the `SlackMessage`, vs. the catalog row's dispatched action).
 */
function MessageRow({
  message,
  onOpenThread
}: {
  message: SlackMessage
  onOpenThread?: (message: SlackMessage) => void
}): React.JSX.Element {
  // slack-search-row-full-parity-v1: build the row props through the ONE shared mapper
  // (`messageToRowProps`) that native search + the generated rows also use, so the field
  // selection can never diverge across contexts. The native `onOpenThread` carries the
  // `SlackMessage` (vs. the catalog row's dispatched action) — the only per-context piece.
  return (
    <SlackMessageRow
      {...messageToRowProps(
        message,
        onOpenThread ? { onOpenThread: () => onOpenThread(message) } : {}
      )}
    />
  )
}

/* ------------------------------------------------------------------------- *
 * Navigation state (channel list -> history -> thread back-stack)
 * ------------------------------------------------------------------------- */

type View =
  | { kind: 'channels' }
  | { kind: 'history'; channel: SlackChannel }
  | { kind: 'search'; query: string }

/**
 * The native-base browser nav held PER-TAB (bug panel-shared-tab-nav-state-v1): the
 * drill-in `view`, the in-progress `searchText`, and the right-docked thread panel's
 * open-thread state (thread-sidepanel v1, FR-013). Each tab keeps its own so opening
 * #general in tab 1 leaves tab 2 on its own view + thread. `openThread` is the SINGLE
 * source of truth for the docked thread region — fed by BOTH the native `onOpenThread`
 * and the generative `SLACK_OPEN_THREAD_ACTION` (FR-001/FR-013).
 */
interface SlackNav {
  view: View
  searchText: string
  openThread: OpenThreadState
}

/** The default native-base nav for an unset / fresh tab (channel list, empty search, no thread). */
const SLACK_NAV_DEFAULT: SlackNav = { view: { kind: 'channels' }, searchText: '', openThread: null }

/* ------------------------------------------------------------------------- *
 * Connection bar (design §2.1)
 * ------------------------------------------------------------------------- */

function ConnectionStatus({
  status,
  onDisconnect,
  onCancel
}: {
  status: SlackConnectionStatus
  onDisconnect: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <>
      {status.state === 'not_connected' && (
        <span className="text-[11px] text-muted-foreground">Not connected</span>
      )}
      {status.state === 'connecting' && (
        <>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Validating token…
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
      {status.state === 'connected' && (
        <>
          <span className="truncate text-[11px] font-medium text-foreground">
            {status.workspaceName ?? 'Connected'}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onDisconnect}>
            Disconnect
          </Button>
        </>
      )}
      {status.state === 'reconnect_needed' && (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          Reconnect needed
        </Badge>
      )}
    </>
  )
}

/* ------------------------------------------------------------------------- *
 * Connect call-to-action (desktop OAuth browser flow — FR-012)
 * ------------------------------------------------------------------------- */

/**
 * The connect call-to-action (FR-012). A single button starts cosmos's desktop
 * OAuth flow: clicking it opens the system browser for Slack consent; main runs
 * PKCE against cosmos's own public client and persists the resulting user token.
 * No token ever enters the renderer (SC-008) — the panel only triggers the flow
 * and reflects the resulting status.
 */
function ConnectForm({
  busy,
  reconnect,
  lastError,
  onConnect
}: {
  busy: boolean
  reconnect: boolean
  lastError?: string
  onConnect: () => void
}): React.JSX.Element {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left">
      {reconnect && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
          <AlertTitle>Reconnect needed</AlertTitle>
          <AlertDescription>
            Your Slack connection expired. Click Connect to sign in again.
          </AlertDescription>
        </Alert>
      )}
      {lastError && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{lastError}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={busy}
        onClick={() => onConnect()}
      >
        {busy ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Connecting…
          </>
        ) : (
          'Connect Slack'
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens your browser to sign in to Slack. cosmos never sees your password — only a
        read-only token, stored encrypted on this device.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Channel list view (FR-013)
 * ------------------------------------------------------------------------- */

function ChannelList({
  onOpen,
  onReconnect,
  filter
}: {
  onOpen: (channel: SlackChannel) => void
  onReconnect: () => void
  // bug slack-search-mode-selector-v1: the channel-name filter is now driven by the ONE shared
  // search Input at the panel base (the [Channels] mode), so it comes in as a prop instead of a
  // local Input here. Client-side only — a pure substring filter over the already-loaded
  // channels; no extra Slack read, no token, no IPC. Empty ⇒ the full browse list.
  filter: string
}): React.JSX.Element {
  const [items, setItems] = useState<SlackChannel[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<SlackError | null>(null)
  const [loaded, setLoaded] = useState(false)

  // bug slack-channel-search-full-load-v1: the [Channels] search filters by name, but the visible
  // `items` are only the pages loaded via load-more — so a channel not yet paged in was invisible
  // to the filter. Slack's public API has no channel-name search (conversations.list takes no
  // query), so the only fix is to enumerate the FULL list via cursor pagination, then filter
  // client-side. We do this LAZILY (only on first channel-search use), cache the exhausted set for
  // the session in a ref (re-typing must NOT re-paginate), and filter over the full set.
  const [allChannels, setAllChannels] = useState<SlackChannel[] | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  // Cache for the session: holds the exhausted full set (or 'loading' while in flight) so the
  // pagination runs at most once. A failed/partial run leaves it null so a later search retries.
  const fullLoadRef = useRef<'loading' | 'done' | null>(null)

  const load = useCallback(async (next?: string) => {
    if (next) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }
    const result: SlackResult<SlackPage<SlackChannel>> = await window.cosmos.slack.listChannels(
      next ? { cursor: next } : {}
    )
    if (result.ok) {
      setItems((prev) => (next ? [...prev, ...result.data.items] : result.data.items))
      setCursor(result.data.nextCursor)
      setLoaded(true)
    } else {
      setError(result)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Exhaust the FULL channel list the first time the user searches in [Channels] mode (non-empty
  // query). Reuses the EXISTING listChannels({ cursor }) IPC (no new contract). Cached via the ref
  // so re-typing serves from `allChannels` without re-paginating; a mid-pagination failure degrades
  // to the partial set (never cached → retried) and never throws.
  const filtering = filter.trim() !== ''
  useEffect(() => {
    if (!filtering || fullLoadRef.current !== null) {
      return
    }
    fullLoadRef.current = 'loading'
    setLoadingAll(true)
    let cancelled = false
    void loadAllChannels((c) => window.cosmos.slack.listChannels(c ? { cursor: c } : {})).then(
      ({ channels, complete }) => {
        if (cancelled) {
          return
        }
        // Only cache (and stop future loads) when the FULL set was loaded; a partial degrade
        // resets the ref so the next keystroke/search retries the exhaustion.
        fullLoadRef.current = complete ? 'done' : null
        setAllChannels(channels)
        setLoadingAll(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [filtering])

  if (error?.kind === 'reconnect_needed') {
    return <ReconnectState onReconnect={onReconnect} />
  }
  if (loading) {
    return <ChannelSkeletons />
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => void load()} />
  }
  if (loaded && items.length === 0) {
    return <EmptyLine>No channels available.</EmptyLine>
  }
  // bug slack-search-mode-selector-v1: the visible rows are the name-filtered subset. The filter
  // text now arrives from the shared search Input ([Channels] mode) instead of a local Input.
  // bug slack-channel-search-full-load-v1: when filtering, filter over the EXHAUSTED full set
  // (cached in `allChannels`) so a channel not yet paged into `items` is still found. Until the
  // full load resolves we filter over whatever's loaded (`items`) so results appear progressively
  // and an empty query keeps the live filter over the browse list exactly as before.
  const source = filtering && allChannels ? allChannels : items
  const visible = filterChannelsByName(source, filter)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-1">
          {/* bug slack-channel-search-full-load-v1: a subtle spinner while the FULL channel list is
              being exhausted for the search (reuses the same Loader2 pattern as load-more). */}
          {filtering && loadingAll && (
            <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Searching all channels…
            </div>
          )}
          {visible.length === 0 ? (
            // While the full load is still in flight, don't claim "no match" prematurely.
            loadingAll ? null : <EmptyLine>No channels match “{filter.trim()}”.</EmptyLine>
          ) : (
            visible.map((channel) => (
              <Button
                key={channel.id}
                type="button"
                variant="ghost"
                className="h-8 w-full justify-start gap-1.5 px-2 font-normal"
                onClick={() => onOpen(channel)}
              >
                <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">{channel.name}</span>
                {channel.isMember && (
                  <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">
                    member
                  </Badge>
                )}
              </Button>
            ))
          )}
          {/* Load-more pages in MORE channels to filter over; hidden while a filter is active so
              it never looks like "more results" for the query (the filter is over loaded rows). */}
          {cursor && !filtering && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-center gap-1.5 text-muted-foreground"
              onClick={() => void load(cursor)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </>
              ) : (
                'Load more channels'
              )}
            </Button>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Message list view (history + thread share most logic)
 * ------------------------------------------------------------------------- */

function MessageList({
  load,
  emptyText,
  onOpenThread,
  onReconnect,
  resolveNames,
  scroll = true,
  olderAbove = true
}: {
  load: (cursor?: string) => Promise<SlackResult<SlackPage<SlackMessage>>>
  emptyText: string
  onOpenThread?: (message: SlackMessage) => void
  onReconnect: () => void
  resolveNames: (messages: SlackMessage[]) => Promise<SlackMessage[]>
  /**
   * Whether this list owns its own vertical scroll (bug slack-thread-unified-scroll-v1).
   * `true` (default) — history/search: wrap in a `ScrollArea h-full` that fills the column.
   * `false` — thread dock replies: render bare so root + divider + replies scroll as ONE
   * region inside the single shared ScrollArea the thread dock places around them.
   */
  scroll?: boolean
  /**
   * Whether the next page is OLDER history that belongs ABOVE the current rows
   * (bug slack-message-order-loadmore-v1, Issue 3). `true` (default) — channel history: the
   * list is newest-at-bottom, so "load more" (the older `next_cursor` page) is rendered at the
   * TOP and PREPENDS older rows above the existing thread, keeping one ascending order. `false`
   * — thread replies: `conversations.replies` paginates to NEWER replies, so load-more stays at
   * the bottom and appends.
   */
  olderAbove?: boolean
}): React.JSX.Element {
  const [items, setItems] = useState<SlackMessage[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<SlackError | null>(null)
  const [loaded, setLoaded] = useState(false)
  // bug slack-history-scroll-to-latest-v1: this newest-at-bottom list must open scrolled to
  // the LATEST (bottom) message on initial load / channel switch. The component is REMOUNTED
  // per channel (its `key` is `${channel.id}-${historyReloadKey}`), so each fresh load runs
  // this hook's one-shot initial-load scroll; a top load-more (prepend-older) keeps the same
  // mount and is left untouched, preserving the user's position. Only the self-scrolling
  // history/search variant owns the Radix viewport; the bare thread-dock variant (scroll=false)
  // scrolls via its parent dock, so the ref is simply never attached there.
  const scrollRef = useSlackScrollToLatest<HTMLDivElement>(items.length, 'radix-viewport')

  const run = useCallback(
    async (next?: string) => {
      if (next) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }
      const result = await load(next)
      if (result.ok) {
        const withNames = await resolveNames(result.data.items)
        // bug slack-message-order-loadmore-v1 (Issue 3): an OLDER page (olderAbove) is PREPENDED
        // above the existing rows + re-sorted ascending so the newest-at-bottom order is kept; a
        // NEWER page (thread replies) appends at the bottom as before. First page replaces.
        setItems((prev) =>
          !next
            ? withNames
            : olderAbove
              ? prependOlderMessages(prev, withNames)
              : [...prev, ...withNames]
        )
        setCursor(result.data.nextCursor)
        setLoaded(true)
      } else {
        setError(result)
      }
      setLoading(false)
      setLoadingMore(false)
    },
    [load, resolveNames, olderAbove]
  )

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // slack-scroll-pagination-v1: auto-load the next OLDER page when the user scrolls NEAR THE TOP
  // of the self-scrolling history list, anchoring the scroll position on each prepend so the view
  // does not jump. ONLY the self-scrolling `olderAbove` history variant opts in (FR-001/004/012);
  // the thread dock (scroll=false) and any newer-direction list pass enabled=false. The returned
  // callback ref is MERGED with `scrollRef` (the sibling bottom-jump) onto the one ScrollArea Root;
  // the two layout effects are mutually exclusive by construction (see useSlackScrollPaginate header).
  const paginateRef = useSlackScrollPaginate<HTMLDivElement>({
    itemCount: items.length,
    inFlight: loadingMore,
    hasCursor: cursor != null,
    enabled: scroll && olderAbove,
    onLoadOlder: () => {
      if (cursor) {
        void run(cursor)
      }
    }
  })
  const mergedScrollRef = useCallback(
    (node: HTMLDivElement | null): void => {
      scrollRef.current = node
      paginateRef(node)
    },
    [scrollRef, paginateRef]
  )

  if (error?.kind === 'reconnect_needed') {
    return <ReconnectState onReconnect={onReconnect} />
  }
  if (loading) {
    return <MessageSkeletons />
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => void run()} />
  }
  if (loaded && items.length === 0) {
    return <EmptyLine>{emptyText}</EmptyLine>
  }
  // bug slack-message-order-loadmore-v1 (Issue 3): the load-more affordance for OLDER history
  // belongs at the TOP (older messages prepend ABOVE the newest-at-bottom thread); thread
  // replies keep load-more at the bottom (it appends newer replies). Same button either way.
  const loadMore = cursor ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="m-2 justify-center gap-1.5 text-muted-foreground"
      onClick={() => void run(cursor)}
      disabled={loadingMore}
    >
      {loadingMore ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> {olderAbove ? 'Loading older…' : 'Loading…'}
        </>
      ) : (
        olderAbove ? 'Load older messages' : 'Load more'
      )}
    </Button>
  ) : null
  const body = (
    <div className="flex flex-col">
      {olderAbove && loadMore}
      {items.map((m) => (
        <MessageRow key={m.ts} message={m} onOpenThread={onOpenThread} />
      ))}
      {!olderAbove && loadMore}
    </div>
  )
  // bug slack-thread-unified-scroll-v1: history/search own their scroll (ScrollArea h-full);
  // the thread dock passes scroll={false} so the replies flow bare inside the dock's single
  // shared ScrollArea (root 본문 + divider + replies scroll as one), not a second region.
  // The wrapper class for each mode is resolved by the node-tested messageListWrapClass.
  if (!scroll) {
    return body
  }
  return (
    <ScrollArea ref={mergedScrollRef} className={messageListWrapClass(scroll)}>
      {body}
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------------- *
 * Message composer — slack-send-message-v1 (design §1)
 *
 * One shared native control mounted in two homes: the channel-history footer
 * (no threadTs) and the thread dock footer (with threadTs ⇒ thread reply). It owns
 * its own draft / in-flight / error state; the parent supplies the resolved target,
 * the `canSend` flag, an `onReconnect` for the missing-scope branch, and `onSent`
 * (confirmed re-read). Enter sends, Shift+Enter newlines, IME-safe via isComposing.
 * NOT a catalog node / MCP op — native panel chrome only (FR-016).
 * ------------------------------------------------------------------------- */

/** Map a send failure to a calm, non-alarming one-line message (design §3). */
function sendErrorMessage(error: SlackError): string {
  switch (error.kind) {
    case 'not_connected':
      return 'Not connected to Slack.'
    case 'rate_limited':
      return 'Slack is busy — try again shortly.'
    case 'reconnect_needed':
      return 'Your Slack connection expired — reconnect to continue.'
    default:
      return "Couldn't send — try again."
  }
}

function SlackComposer({
  channelId,
  threadTs,
  canSend,
  placeholder,
  ariaLabel,
  onReconnect,
  onSent
}: {
  channelId: string
  threadTs?: string
  canSend: boolean
  placeholder: string
  ariaLabel: string
  onReconnect: () => void
  onSent: (result: SlackSendResult) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<SlackError | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // glass-dock-v1: the THREAD instance (it carries `threadTs`) lives INSIDE the `glass-dock`
  // drawer, so its footer fill must be transparent or it stacks a second opaque surface that
  // defeats the frosted blur. The channel-history instance (no `threadTs`) sits on the panel's
  // opaque body, so it keeps `bg-card`. NOT a per-dock CSS override — the composer just wears
  // the right fill for its home.
  const footerFill = threadTs ? 'bg-transparent' : 'bg-card'

  // canSend === false → replace the form with the reconnect-to-send affordance
  // (design §3 last row). Do NOT show an enabled-but-failing send.
  if (!canSend) {
    return (
      <div className={`shrink-0 border-t border-border ${footerFill} px-3 py-2.5`}>
        <Alert
          variant="destructive"
          className="border-destructive/40 bg-destructive/15"
          role="alert"
        >
          <AlertTitle>Reconnect to send</AlertTitle>
          <AlertDescription>
            Sending a message needs a one-time reconnect to grant write access.
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="mt-2"
          onClick={onReconnect}
        >
          Reconnect Slack
        </Button>
      </div>
    )
  }

  const canSubmit = canSubmitSlackMessage({ text, canSend, sending })

  const doSend = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setSending(true)
    setError(null)
    const result = await window.cosmos.slack.sendMessage({
      channelId,
      text: text.trim(),
      ...(threadTs ? { threadTs } : {})
    })
    setSending(false)
    if (result.ok) {
      // Success: clear, refocus for a rapid back-and-forth, and let the parent
      // re-read the view so the confirmed message renders (FR-013).
      setText('')
      setError(null)
      textareaRef.current?.focus()
      onSent(result.data)
    } else {
      // Failure: preserve the typed text, surface a calm inline error, stay
      // retryable (FR-014). reconnect_needed additionally flips connection state
      // upstream (handled by the parent via onReconnect-equivalent re-sync).
      setError(result)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter newlines. isComposing guard keeps IME/CJK safe (§4).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void doSend()
    }
  }

  return (
    <div className={`shrink-0 border-t border-border ${footerFill} px-2 py-2`}>
      {error && (
        <p
          className="mb-1.5 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/15 px-2 py-1 text-[12px] text-destructive"
          role="alert"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {sendErrorMessage(error)}
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void doSend()
        }}
      >
        <Textarea
          ref={textareaRef}
          className="max-h-32 min-h-[2.25rem] flex-1 resize-none px-2.5 py-1.5 text-sm leading-snug"
          placeholder={placeholder}
          aria-label={ariaLabel}
          rows={1}
          value={text}
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value)
            if (error) {
              setError(null)
            }
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          variant="default"
          size="icon-sm"
          aria-label="Send message"
          disabled={!canSubmit}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
        </Button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Thread panel (right dock) — thread-sidepanel v1 (design §2)
 *
 * Replaces the old whole-view `view.kind==='thread'` base swap with a region docked to
 * the RIGHT of the message list. The parent renders as the header (shared `SlackMessageRow`,
 * NO `onOpenThread` — you are already in its thread); the replies reuse the same `MessageList`
 * loader, dropping the duplicate root (FR-003). Same JSX in both layout modes; only the
 * wrapper positioning differs (side-by-side ≥32rem vs. drawer overlay below — wired by the
 * caller). Loading / empty / error states are inherited from `MessageList` (FR-006).
 * ------------------------------------------------------------------------- */

function SlackThreadPanel({
  context,
  canSend,
  onClose,
  onReconnect,
  onConnectForSend,
  resolveNames
}: {
  context: SlackOpenThreadContext
  canSend: boolean
  onClose: () => void
  onReconnect: () => void
  /** Re-run OAuth with the widened scope so the composer becomes send-capable (FR-011). */
  onConnectForSend: () => void
  resolveNames: (messages: SlackMessage[]) => Promise<SlackMessage[]>
}): React.JSX.Element {
  // Confirmed-render bump (slack-send-message-v1, FR-013): after a successful reply,
  // remount the replies MessageList so the just-sent message is re-read.
  const [replyReloadKey, setReplyReloadKey] = useState(0)
  // slack-thread-open-in-slack-v1: the thread root's canonical "Open in Slack" web permalink,
  // captured from the getReplies load result (main resolves it from chat.getPermalink). Held
  // here so the header link survives reply-list remounts. Reset on a thread change so a stale
  // link never shows for a different thread; absent until the first load resolves it (or when
  // the resolve fails / is non-openable → the header stays a plain "Thread" label).
  const [permalink, setPermalink] = useState<string | undefined>(undefined)
  useEffect(() => {
    setPermalink(undefined)
  }, [context.channelId, context.threadTs])
  // Reconstruct the parent SlackMessage from the non-secret carried fields (FR-013) for the
  // header row. No token, no re-read needed for the header itself. replyCount is intentionally
  // omitted: we are already inside this thread, so a "N replies" label on the root row is
  // redundant (RepliesAffordance §3.3 → null).
  const parent: SlackMessage = {
    ts: context.ts,
    userId: context.userId,
    ...(context.userName !== undefined ? { userName: context.userName } : {}),
    text: context.text,
    // slack-thread-root-image-v1: carry the root's inline image refs so the header row renders
    // its image via the SAME MessageRow → messageToRowProps path the replies use. Absent → none.
    ...(context.images !== undefined ? { images: context.images } : {})
  }
  // The openable-link guard re-validates the carried value so a non-http(s)/malformed permalink
  // can never become a live link (mirrors the Confluence PageDetailTitle treatment).
  const canOpenInSlack = isOpenableThreadPermalink(permalink)
  return (
    // glass-dock-v1: bg-transparent (NOT bg-card) so the owning dock's `glass-dock` material
    // is the single fill — a stacked opaque card here would defeat the frosted backdrop-blur.
    <div className="flex h-full min-w-0 flex-col bg-transparent">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {canOpenInSlack ? (
          // "Open in Slack" header affordance (slack-thread-open-in-slack-v1): the thread title
          // becomes an external link to the real Slack web/app. Mirrors Confluence PageDetailTitle /
          // the Jira ticket-key link: inline anchor + ExternalLink glyph, --ring focus treatment.
          <a
            href={permalink}
            target="_blank"
            rel="noreferrer"
            title="Thread — open in Slack"
            className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
          >
            <span className="truncate text-sm font-medium text-foreground">Thread</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ) : (
          <span className="flex-1 truncate text-sm font-medium text-foreground">Thread</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close thread"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      {/* bug slack-thread-unified-scroll-v1: the root (본문) AND the replies (댓글) share ONE
          scroll region. A single ScrollArea wraps the root block, the "N replies" divider, and
          the replies list so they scroll together — no longer two independent scroll areas (the
          old `max-h-[40%]` root ScrollArea + the replies' own `flex-1` scroll). Only the dock
          header (above) and the composer (below) stay fixed outside this scroll. */}
      <ScrollArea className="min-h-0 flex-1">
        {/* Root (본문) — the thread anchor. Presented as a calm card block on a muted backdrop
            (Slack/Linear thread-drawer pattern): it reads as the message the thread hangs off
            of, not "reply zero". No per-row bottom border here (the count divider below does the
            separating), so the avatar/body sit on a clean panel. It now grows with its content
            and scrolls with the rest, instead of being capped in its own scroll region. */}
        <div className="bg-muted/30">
          <MessageRow message={parent} />
        </div>
        {/* "N replies" count divider (the canonical Slack thread separator): a thin hairline
            rule with a small muted label marking exactly where replies (댓글) begin, distinct
            from the root above. An inline section header within the shared scroll (it scrolls
            with the content). Falls back to a plain "Replies" label when the count is unknown. */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="shrink-0 text-xs font-medium text-muted-foreground" aria-hidden="true">
            {typeof context.replyCount === 'number' && context.replyCount > 0
              ? countLabel(context.replyCount, 'reply', 'replies')
              : 'Replies'}
          </span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>
        {/* Replies group — a subtle left rail indents the whole reply column so it reads as
            subordinate to the root (Discord/Linear connector pattern). The rail lives on this
            wrapper, NOT the shared row, so the canonical SlackMessageRow is untouched. The list
            renders with scroll={false} so it flows inside this single shared ScrollArea. */}
        <div className="border-l-2 border-border/70 pl-1">
          <MessageList
            key={`${context.channelId}-${context.threadTs}-${replyReloadKey}`}
            emptyText="No replies."
            scroll={false}
            olderAbove={false}
            load={async (cursor) => {
              // conversations.replies returns the parent as the first item; it is shown as the
              // thread header above, so drop it here to avoid rendering the root twice (FR-003).
              const r = await window.cosmos.slack.getReplies({
                channelId: context.channelId,
                threadTs: context.threadTs,
                ...(cursor ? { cursor } : {})
              })
              if (!r.ok) {
                return r
              }
              // slack-thread-open-in-slack-v1: lift the thread root's "Open in Slack" permalink
              // (carried only on the first page) into the panel so the header link renders. The
              // guard in the header re-validates it; absent → the header stays a plain label.
              if (r.data.permalink) {
                setPermalink(r.data.permalink)
              }
              return {
                ...r,
                data: { ...r.data, items: dropThreadRoot(r.data.items, context.threadTs) }
              }
            }}
            onReconnect={onReconnect}
            resolveNames={resolveNames}
          />
        </div>
      </ScrollArea>
      {/* Reply composer (slack-send-message-v1 §2.2): carries threadTs ⇒ a thread reply.
          Pinned to the bottom of the dock; canSend gates it (Reconnect affordance when false). */}
      <SlackComposer
        channelId={context.channelId}
        threadTs={context.threadTs}
        canSend={canSend}
        placeholder="Reply…"
        ariaLabel="Reply to thread"
        onReconnect={onConnectForSend}
        onSent={() => setReplyReloadKey((k) => k + 1)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Search results view (FR-015)
 * ------------------------------------------------------------------------- */

function SearchResults({
  query,
  onReconnect,
  resolveMatchNames,
  onOpenThread
}: {
  query: string
  onReconnect: () => void
  /**
   * Resolve author ids → display names on the search matches (bug slack-search-row-data-parity-v1).
   * search.messages does NOT return a display name, so without this the rows showed the raw
   * `userId` (and raw-id avatar initials) while history rows showed "Alice" — the visible
   * divergence. Reuses the panel's shared name cache + raw-id fallback, exactly like history's
   * `resolveNames`, so a search row's author/avatar now matches a history row.
   */
  resolveMatchNames: (matches: SlackSearchMatch[]) => Promise<SlackSearchMatch[]>
  /**
   * Open the right-docked thread for a search hit (slack-search-row-full-parity-v1). A search
   * hit now carries thread coordinates (`channelId` + `threadTs = ts`), so a search row is
   * clickable to open its own thread EXACTLY like a native/generated history row — the same
   * single open-thread state. Absent coords ⇒ the row stays non-interactive (graceful).
   */
  onOpenThread: (ctx: SlackOpenThreadContext) => void
}): React.JSX.Element {
  const [items, setItems] = useState<SlackSearchMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<SlackError | null>(null)
  const [loaded, setLoaded] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await window.cosmos.slack.search({ query })
    if (result.ok) {
      // FR-014 data parity: resolve author display names before rendering so the search row's
      // name + avatar initials match a channel-history row (history calls resolveNames; search
      // previously skipped it — the root cause of the "search doesn't share the component" report).
      const withNames = await resolveMatchNames(result.data.items)
      setItems(withNames)
      setLoaded(true)
    } else {
      setError(result)
    }
    setLoading(false)
  }, [query, resolveMatchNames])

  useEffect(() => {
    void run()
  }, [run])

  if (error?.kind === 'reconnect_needed') {
    return <ReconnectState onReconnect={onReconnect} />
  }
  if (loading) {
    return <MessageSkeletons />
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => void run()} />
  }
  if (loaded && items.length === 0) {
    return <EmptyLine>No results for “{query}”.</EmptyLine>
  }
  return (
    // slack-search-row-full-parity-v1: IDENTICAL wrapper to the history `MessageList` body
    // (ScrollArea h-full → a bare `flex flex-col` of rows) so the rows sit in the same chrome.
    // The count label matches the history list's class (`px-3 py-1.5 text-xs`).
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        <p className="px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
          {items.length} {items.length === 1 ? 'result' : 'results'} for “{query}”
        </p>
        {/* slack-search-row-full-parity-v1 (supersedes slack-search-shared-row-v1): search hits
            render via the SAME canonical SlackMessageRow AND the SAME unified field mapper
            (`searchMatchToRowProps` → `messageToRowProps`) the native + generated history rows use,
            so avatars, rich text, custom emoji, RESOLVED author name, and now inline IMAGES are
            identical. A search hit carries thread coords (channelId + threadTs = ts), so the row is
            ALSO clickable to open its own thread (onOpenThread) — no longer an inert variant. The
            cross-channel `#channelName` chip + the absent "N replies" label (search.messages omits
            reply_count) are the only intended differences. */}
        {items.map((m) => {
          const ctx = buildOpenThreadContext({
            channelId: m.channelId,
            threadTs: m.threadTs,
            ts: m.ts,
            userId: m.userId,
            ...(m.userName !== undefined ? { userName: m.userName } : {}),
            text: m.text,
            // slack-thread-root-image-v1: carry the search hit's images so its thread dock's root
            // header shows the same thumbnail strip the search row did.
            ...(m.images !== undefined ? { images: m.images } : {})
          })
          return (
            <SlackMessageRow
              key={`${m.channelId}-${m.ts}`}
              {...searchMatchToRowProps(
                m,
                ctx ? { onOpenThread: () => onOpenThread(ctx) } : {}
              )}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------------- *
 * Generative surface (Slack generative-UI v1, now TABBED — panel-tabs v1 Phase 6).
 * The native channel/search browser is the ZERO-TAB base (FR-017); each generative
 * tab hosts its own Slack surface via the shared `useGenerativePanelTabs` correlation
 * + `ActiveTabSurface`. Display-only / read-only (FR-012/FR-020): NO writes. The only
 * action is the renderer-local channel-row open (intercepted, never sent to main).
 * ------------------------------------------------------------------------- */


/* ------------------------------------------------------------------------- *
 * The panel
 * ------------------------------------------------------------------------- */

export function SlackPanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<SlackConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)
  // bug slack-search-mode-selector-v1: WHAT the one shared search Input acts on. 'channels'
  // narrows the channel list by name (filterChannelsByName); 'messages' runs the message search
  // (→ SearchResults). Component state (default 'channels' = the browse-and-find default).
  const [searchMode, setSearchMode] = useState<SlackSearchMode>('channels')
  // Confirmed-render bump (slack-send-message-v1, FR-013): after a successful channel
  // send, remount the history MessageList so the just-sent message is re-read.
  const [historyReloadKey, setHistoryReloadKey] = useState(0)
  // panel-tabs v1: the per-tab generative surfaces (read-only, target 'slack'). Zero
  // tabs => the native channel/search browser base (FR-017).
  const restoredPanel = useRestoredGenerativePanel('slack')
  // open-prompt-view-context-v1 (FR-004): the LIVE view + open thread the composer grounds
  // against, read at send time. Routed through refs because the nav is derived from
  // `usePerTabNav` (which needs `activeTabId` from the hook below). Assigned after nav.
  const viewRef = useRef<View>(SLACK_NAV_DEFAULT.view)
  const openThreadRef = useRef<OpenThreadState>(SLACK_NAV_DEFAULT.openThread)
  const { tabs, activeTabId, activeTab, setActive, submit, newTab, closeTab, update } =
    useGenerativePanelTabs({
      target: 'slack',
      panelName: 'Slack',
      // Ground a compose against the open channel (+ thread); channels/search ⇒ no context.
      getViewContext: () => slackViewContext(viewRef.current, openThreadRef.current),
      ...(restoredPanel ? { initial: restoredPanel } : {})
    })
  // The native-base browser nav is held PER-TAB, keyed by the active tab id
  // (bug panel-shared-tab-nav-state-v1), so each tab keeps its own view + search text.
  const {
    nav: { view, searchText, openThread },
    setNav,
    drop: dropNav,
    clearAll: clearAllNav
  } = usePerTabNav<SlackNav>(activeTabId, SLACK_NAV_DEFAULT)
  // Keep the live view + thread in sync for the send-time view-context capture (above).
  viewRef.current = view
  openThreadRef.current = openThread
  // Changing the base view (channel switch, back, search) closes any open thread so a stale
  // thread never shows against a different channel's list (spec Edge Cases). The thread is a
  // transient right-dock, not part of the back-stack.
  const setView = useCallback(
    (view: View) => setNav((prev) => ({ ...prev, view, openThread: null })),
    [setNav]
  )
  const setSearchText = useCallback(
    (searchText: string) => setNav((prev) => ({ ...prev, searchText })),
    [setNav]
  )
  // Open / retarget / toggle-close the single right-docked thread state (FR-001/FR-004/FR-013).
  // BOTH the native row's onOpenThread and the generative SLACK_OPEN_THREAD_ACTION feed this.
  const openThreadFor = useCallback(
    (ctx: SlackOpenThreadContext) =>
      setNav((prev) => ({ ...prev, openThread: openThreadTransition(prev.openThread, ctx) })),
    [setNav]
  )
  const closeThread = useCallback(
    () => setNav((prev) => ({ ...prev, openThread: closeThreadTransition() })),
    [setNav]
  )
  // Closing a tab also drops its per-tab native-base nav entry so the map never leaks
  // state for tabs that no longer exist (bug panel-shared-tab-nav-state-v1).
  const handleCloseTab = useCallback(
    (tabId: string) => {
      dropNav(tabId)
      closeTab(tabId)
    },
    [dropNav, closeTab]
  )
  // Tab keyboard shortcuts act on THIS strip only while the Slack surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: handleCloseTab })
  // The native channel/search browser is the base shown not only at zero tabs but also
  // whenever the active tab has not composed a surface yet (a fresh `+` "Untitled" tab),
  // so a new tab lands on the same base screen instead of a blank panel.
  // The surface send-spinner gate, scoped to the ACTIVE tab (composer-send-animation-v1
  // FR-005/FR-008): in-flight without a landed surface/error → show the spinner.
  const showSpinner = !!activeTab &&
    surfaceSpinnerVisible({
      inFlight: activeTab.inFlight,
      hasSurface: activeTab.surface != null,
      hasError: activeTab.error != null,
      loadingDefault: activeTab.loadingDefault
    })
  // The native channel/search browser is the base; while a submitted compose is in flight
  // the send-spinner takes the region instead (it lands a surface or error there next).
  const showNativeBase = (!activeTab || (!activeTab.surface && !activeTab.error)) && !showSpinner
  // Always keep ≥1 tab (Terminal-unified layout): seed one on mount and reopen a fresh
  // tab if the collection ever empties, so the tab strip is always the topmost element.
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
    // newTab is stable; only react to the count reaching 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])
  // Cache of resolved display names so author ids resolve once (FR-014).
  const nameCache = useRef<Map<string, string>>(new Map())

  // A generated channel-row click navigates to that channel's native conversation
  // view. Handled renderer-locally (never sent to main). With PER-TAB nav state
  // (bug panel-shared-tab-nav-state-v1) this opens the channel IN THE CURRENT tab —
  // clear that tab's generative surface so its native base shows, and set its view to
  // the channel history. (Previously this set the shared view then CLOSED the active
  // tab, relying on the now-removed shared state to reveal the channel in the adjacent
  // tab — that no longer makes sense per-tab.) Read-only preserved (FR-020).
  const handleSurfaceAction = useCallback(
    (action: A2UIAction): boolean => {
      const ctx = (action.context ?? {}) as Record<string, unknown>
      if (action.name === SLACK_OPEN_CHANNEL_ACTION) {
        const id = typeof ctx.channelId === 'string' ? ctx.channelId : ''
        if (id) {
          const channel: SlackChannel = {
            id,
            name: typeof ctx.channelName === 'string' && ctx.channelName !== '' ? ctx.channelName : id,
            isMember: ctx.isMember === true
          }
          setView({ kind: 'history', channel })
          // Clear this tab's surface so the native base (now on the channel view) shows.
          if (activeTabId) {
            update(activeTabId, { surface: null, error: undefined })
          }
        }
        return true
      }
      // thread-sidepanel v1 (FR-001/FR-013): a generated MessageRow's "N replies" affordance
      // opens the RIGHT-DOCKED thread panel — the SAME single open-thread state the native row
      // feeds — instead of swapping the whole view. The generative surface stays mounted
      // underneath (the dock sits beside / overlays it). Reconstruct the non-secret context;
      // read-only via getReplies; never forwarded to main.
      if (action.name === SLACK_OPEN_THREAD_ACTION) {
        const channelId = typeof ctx.channelId === 'string' ? ctx.channelId : ''
        const threadTs = typeof ctx.threadTs === 'string' ? ctx.threadTs : ''
        if (channelId && threadTs) {
          // slack-thread-root-image-v1: shape-validate the image refs crossing the A2UI action
          // boundary (additive). An invalid/absent value yields undefined → no images carried (the
          // header just shows none). Opaque `cosmos-slack-img://` display refs — NEVER a token.
          const images = coerceImageRefs(ctx.images)
          openThreadFor({
            channelId,
            threadTs,
            ts: typeof ctx.ts === 'string' ? ctx.ts : threadTs,
            userId: typeof ctx.userId === 'string' ? ctx.userId : '',
            ...(typeof ctx.userName === 'string' && ctx.userName !== '' ? { userName: ctx.userName } : {}),
            text: typeof ctx.text === 'string' ? ctx.text : '',
            ...(typeof ctx.replyCount === 'number' ? { replyCount: ctx.replyCount } : {}),
            ...(images ? { images } : {})
          })
        }
        return true
      }
      return false
    },
    [activeTabId, setView, update, openThreadFor]
  )

  // Initial status + live updates (FR-007).
  useEffect(() => {
    let active = true
    void window.cosmos.slack.getStatus().then((s) => {
      if (active) {
        setStatus(s)
      }
    })
    const off = window.cosmos.slack.onStatusChanged((s) => setStatus(s))
    return () => {
      active = false
      off()
    }
  }, [])

  // A connection transition resets EVERY tab's native-base nav back to default
  // (bug panel-shared-tab-nav-state-v1): while disconnected the connect call-to-action
  // replaces the base entirely, so it is coherent to reset all tabs' base nav rather
  // than leave stale per-tab drill-ins behind a reconnect.
  const connect = useCallback(async () => {
    setBusy(true)
    const next = await window.cosmos.slack.connect()
    setStatus(next)
    setBusy(false)
    clearAllNav()
  }, [clearAllNav])

  const disconnect = useCallback(async () => {
    const next = await window.cosmos.slack.disconnect()
    setStatus(next)
    clearAllNav()
  }, [clearAllNav])

  // disconnect-confirm-modal-v1: gate the footer Disconnect behind a confirm modal —
  // clicking it OPENS the modal; the real `disconnect()` runs only on confirm.
  const confirmDisconnect = useConfirm()

  // oauth-cancel-v1: abort an in-flight connect (the user cancelled the browser consent) so
  // the panel returns to not_connected immediately and Connect is clickable again.
  const cancelConnect = useCallback(async () => {
    const next = await window.cosmos.slack.cancelConnect()
    setStatus(next)
    setBusy(false)
  }, [])

  /**
   * Re-sync the connection status (used when a read reports reconnect_needed). The
   * manager has already flipped state, so this pulls the fresh status and the panel
   * re-renders into the connect call-to-action. No token involved.
   */
  const refreshStatus = useCallback(async () => {
    const next = await window.cosmos.slack.getStatus()
    setStatus(next)
    clearAllNav()
  }, [clearAllNav])

  /** Resolve author ids to display names with a cache + raw-id fallback (FR-014). */
  const resolveNames = useCallback(async (messages: SlackMessage[]): Promise<SlackMessage[]> => {
    const cache = nameCache.current
    const unknownIds = Array.from(
      new Set(messages.map((m) => m.userId).filter((id) => id && !cache.has(id)))
    )
    await Promise.all(
      unknownIds.map(async (id) => {
        const result: SlackResult<SlackUser> = await window.cosmos.slack.getUser({ userId: id })
        // On any failure, fall back to the raw id (do not block the view — FR-014).
        cache.set(id, result.ok ? result.data.displayName : id)
      })
    )
    return messages.map((m) => ({ ...m, userName: cache.get(m.userId) ?? m.userId }))
  }, [])

  /**
   * Resolve author ids → display names on SEARCH matches (bug slack-search-row-data-parity-v1).
   * The search-row twin of `resolveNames`: search.messages returns no display name, so without
   * this the search rows showed the raw `userId` + raw-id avatar initials while history rows
   * showed the resolved name. Reuses the SAME `nameCache` + `getUser` + raw-id fallback so a
   * search row's author/avatar is identical to a channel-history row (FR-014).
   */
  const resolveMatchNames = useCallback(
    async (matches: SlackSearchMatch[]): Promise<SlackSearchMatch[]> => {
      const cache = nameCache.current
      const unknownIds = Array.from(
        new Set(matches.map((m) => m.userId).filter((id) => id && !cache.has(id)))
      )
      await Promise.all(
        unknownIds.map(async (id) => {
          const result: SlackResult<SlackUser> = await window.cosmos.slack.getUser({ userId: id })
          cache.set(id, result.ok ? result.data.displayName : id)
        })
      )
      return matches.map((m) => ({ ...m, userName: cache.get(m.userId) ?? m.userId }))
    },
    []
  )

  // bug slack-search-mode-selector-v1: submit only RUNS in 'messages' mode (message search is an
  // explicit Slack read). In 'channels' mode the same Input filters the list live-as-you-type, so
  // a submit is a no-op (the list is already narrowed). Switching to 'channels' also drops out of
  // any search results view so the channel list (now filtered by the shared text) is shown.
  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (searchMode !== 'messages') {
        return
      }
      const q = searchText.trim()
      if (q !== '') {
        setView({ kind: 'search', query: q })
      }
    },
    [searchMode, searchText, setView]
  )

  // Selecting a mode routes the shared Input. 'channels' → leave search results and show the
  // (filtered) channel list; 'messages' → land on the channels base so the next submit searches.
  const selectSearchMode = useCallback(
    (mode: SlackSearchMode) => {
      setSearchMode(mode)
      if (mode === 'channels' && view.kind === 'search') {
        setView({ kind: 'channels' })
      }
    },
    [view.kind, setView]
  )

  const isConnected = status.state === 'connected'

  const stripTabs: PanelTab[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'generative' as const,
    status: t.inFlight ? 'in-flight' : t.error ? 'error' : 'idle',
    untitled: t.untitled,
    ...(t.error ? { errorMessage: t.error } : {})
  }))
  const activeStripTab = stripTabs.find((t) => t.id === activeTabId) ?? null
  // panel-refresh-v1 (Goal 1): the shared refresh control, fed the active tab's surface slice.
  const refreshInputs = panelRefreshInputsFor(activeTab)

  // open-prompt-hoist-v1: publish this panel's composer wiring (null while not connected,
  // mirroring the old `isConnected &&` JSX gate) so the ONE App-level composer routes to Slack
  // while it is the active surface; the view-context chip is captured the same way as before.
  usePublishComposer(
    'slack',
    useMemo(
      () =>
        isConnected
          ? {
              onSubmit: submit,
              placeholder: 'Ask about your Slack channels and messages…',
              ariaLabel: 'Ask about Slack',
              contextChip: contextChipFor('slack', slackViewContext(view, openThread)),
              busy: showSpinner
            }
          : null,
      [isConnected, submit, view, openThread, showSpinner]
    )
  )

  return (
    <section
      className="flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label="Slack"
    >
      {/* Terminal-unified layout: the tab strip is the topmost element (no title header).
          The connection status moves to the footer; the not-connected CTA renders inside the
          active tab's content region (FR-002). */}
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={activeTabId}
        onActivate={setActive}
        onClose={handleCloseTab}
        onNewTab={newTab}
        onRename={(id, label) => update(id, { label, renamed: true, untitled: false })}
        trailing={
          <PanelRefreshButton
            activeTab={refreshInputs.activeTab}
            requestId={refreshInputs.requestId}
          />
        }
        ariaLabel="Slack tabs"
      />

      {/* Content region (the active tab's content). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!isConnected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquare className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect your Slack workspace to browse channels and search messages from cosmos.
            </p>
            {status.state !== 'connecting' && (
              <ConnectForm
                busy={busy}
                reconnect={status.state === 'reconnect_needed'}
                {...(status.state === 'not_connected' && status.lastError
                  ? { lastError: status.lastError }
                  : {})}
                onConnect={() => void connect()}
              />
            )}
          </div>
        ) : (
          <>
            {/* Native channel/search browser — the base shown at zero tabs AND on an
                uncomposed (new `+`) active tab (FR-017). */}
            {showNativeBase && (
              <>
                {/* Unified search (bug slack-search-mode-selector-v1): a scope DROPDOWN to the
                    LEFT of the single search Input picks WHAT it searches — the channel list
                    (filterChannelsByName, live as-you-type) or messages (search → SearchResults,
                    on submit). FR-015: the Messages option + Input disable + helper when message
                    search is unavailable; Channels stays usable (it's a local list filter). */}
                <div className="flex flex-col gap-2 border-b border-border p-2">
                  <div className="flex items-center gap-2">
                    <Select
                      value={searchMode}
                      onValueChange={(v) => selectSearchMode(v as SlackSearchMode)}
                    >
                      <SelectTrigger
                        size="sm"
                        // Fixed width (not w-fit): the label swap Channels↔Messages must not
                        // resize the trigger (and, via the popper min-w below, the menu).
                        className="h-8 w-28 shrink-0 text-xs"
                        aria-label="Search scope"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      {/* popper + trigger-width min: the default item-aligned content carries
                          min-w-[8rem], which overflows the compact w-fit scope trigger (menu wider
                          than its button). Popper position lets the viewport adopt the trigger
                          width; the min-w override drops the 8rem floor so the menu matches. */}
                      <SelectContent
                        position="popper"
                        className="min-w-[var(--radix-select-trigger-width)]"
                      >
                        {SLACK_SEARCH_MODES.map((mode) => (
                          <SelectItem
                            key={mode}
                            value={mode}
                            disabled={mode === 'messages' && status.canSearch === false}
                            // No selected-check here: it forces the shared SelectItem's pr-8
                            // reserve, widening items past the compact scope trigger. Drop the
                            // indicator + its padding so items size to the label. text-xs matches
                            // the compact trigger (the shared item default is text-sm).
                            className="pr-2 text-xs [&>[data-slot=select-item-indicator]]:hidden"
                          >
                            {searchModeLabel(mode)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <form onSubmit={submitSearch} className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder={searchPlaceholder(searchMode)}
                        className="h-8 pl-8 text-sm"
                        disabled={searchMode === 'messages' && status.canSearch === false}
                        aria-label={searchPlaceholder(searchMode)}
                      />
                    </form>
                  </div>
                  {searchMode === 'messages' && status.canSearch === false && (
                    <p className="text-xs text-muted-foreground">
                      Search isn’t available for this connection.
                    </p>
                  )}
                </div>

                {/* Header strip with back affordance for non-root views. */}
                {view.kind !== 'channels' && (
                  <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Back"
                      onClick={() => setView({ kind: 'channels' })}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="truncate text-sm font-medium text-foreground">
                      {view.kind === 'history' && `#${view.channel.name}`}
                      {view.kind === 'search' && 'Search'}
                    </span>
                  </div>
                )}

                {/* thread-sidepanel v1 (design §1.1): the history layout is a horizontal
                    container-query pair — the message list on the left, the thread dock on the
                    right (only when a thread is open). `@container/slackbody` gates side-by-side
                    vs. drawer overlay on the PANEL's own width (not the viewport). */}
                <div className="@container/slackbody relative flex min-h-0 flex-1">
                  <div className="flex min-w-0 flex-1 flex-col">
                    {view.kind === 'channels' && (
                      <ChannelList
                        onOpen={(channel) => setView({ kind: 'history', channel })}
                        onReconnect={() => void refreshStatus()}
                        // bug slack-search-mode-selector-v1: filter the list only while the shared
                        // Input is in [Channels] mode; in [Messages] mode the text targets message
                        // search, so the channel list stays the full browse list.
                        filter={searchMode === 'channels' ? searchText : ''}
                      />
                    )}
                    {view.kind === 'history' && (
                      <>
                        <div className="min-h-0 flex-1">
                          <MessageList
                            key={`${view.channel.id}-${historyReloadKey}`}
                            emptyText="No messages yet."
                            load={(cursor) =>
                              window.cosmos.slack.getHistory({
                                channelId: view.channel.id,
                                ...(cursor ? { cursor } : {})
                              })
                            }
                            onOpenThread={(parent) =>
                              openThreadFor({
                                channelId: view.channel.id,
                                threadTs: parent.ts,
                                ts: parent.ts,
                                userId: parent.userId,
                                ...(parent.userName !== undefined ? { userName: parent.userName } : {}),
                                text: parent.text,
                                ...(parent.replyCount !== undefined ? { replyCount: parent.replyCount } : {}),
                                // slack-thread-root-image-v1: carry the clicked row's images so the
                                // dock's root header renders its image like the channel row did.
                                ...(parent.images !== undefined ? { images: parent.images } : {})
                              })
                            }
                            onReconnect={() => void refreshStatus()}
                            resolveNames={resolveNames}
                          />
                        </div>
                        {/* Channel composer (slack-send-message-v1 §2.1): keyed by channel id so a
                            half-typed draft never bleeds across channels; canSend gates it. */}
                        <SlackComposer
                          key={`composer-${view.channel.id}`}
                          channelId={view.channel.id}
                          canSend={status.canSend === true}
                          placeholder={`Message #${view.channel.name}`}
                          ariaLabel="Message channel"
                          onReconnect={() => void connect()}
                          onSent={() => setHistoryReloadKey((k) => k + 1)}
                        />
                      </>
                    )}
                    {view.kind === 'search' && (
                      <SearchResults
                        query={view.query}
                        onReconnect={() => void refreshStatus()}
                        resolveMatchNames={resolveMatchNames}
                        onOpenThread={openThreadFor}
                      />
                    )}
                  </div>

                  {/* Right-docked thread region — ALWAYS-overlay floating drawer (matches the
                      Jira/Confluence/Calendar detail docks): the scrim + absolute right-drawer
                      float OVER the still-full-width list at EVERY panel width and never squeeze
                      it (no `@[32rem]/slackbody` side-by-side branch). Driven by the single
                      open-thread state, so both native + generative surfaces feed it. The scrim
                      is always present and closes the thread on click. */}
                  {openThread && (
                    <>
                      {/* glass-dock-v1: faint scrim (was bg-black/40) so the frosted list reads
                          THROUGH the glass blur. */}
                      <div
                        className="absolute inset-0 z-10 bg-black/15 transition-opacity duration-200"
                        aria-hidden="true"
                        onClick={closeThread}
                      />
                      {/* glass-dock-v1: the drawer wears the shared `glass-dock` material (the SAME
                          global config the Calendar dock uses). It supplies the translucent fill,
                          border-color, and depth/edge shadow, so `bg-card shadow-lg border-border`
                          are dropped (keep only `border-l`). The inner SlackThreadPanel root is
                          bg-transparent so this is the SINGLE fill. */}
                      <GlassDock className="absolute inset-y-0 right-0 z-20 w-full max-w-[28rem] translate-x-0 border-l transition-transform duration-200 ease-out motion-reduce:transition-none">
                        <SlackThreadPanel
                          context={openThread}
                          canSend={status.canSend === true}
                          onClose={closeThread}
                          onReconnect={() => void refreshStatus()}
                          onConnectForSend={() => void connect()}
                          resolveNames={resolveNames}
                        />
                      </GlassDock>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Surface send-spinner: the busy state of this region while a submitted run
                is in flight, until its surface lands (composer-send-animation-v1
                FR-005/FR-006). Replaces the native base for the duration of the run. */}
            {showSpinner && (
              <div className="min-h-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
                <SurfaceSpinner />
              </div>
            )}

            {/*
              Generative A2UI host (per-tab). Only the ACTIVE tab's provider is mounted;
              keyed by tab id so a switch remounts + re-processes that tab's stored
              surface (FR-003). Display-only / read-only (FR-012/FR-020).
            */}
            {activeTab && (activeTab.surface || activeTab.error) && (
              // thread-sidepanel v1 (FR-001/FR-013): the generative surface is also a
              // `@container/slackbody` two-pane parent so the SAME open-thread state (fed by
              // the generative SLACK_OPEN_THREAD_ACTION) docks the thread panel beside / over it.
              <div className="@container/slackbody relative flex min-h-0 flex-1">
                {/* slack-list-scroll-fill-v2 (Story 3): the tabpanel host is a definite-height
                    flex column (SLACK_SURFACE_HOST_CLASS = `flex flex-col min-h-0`) on top of its
                    `flex-1 overflow-auto` — the TOP of the fill chain so its A2UI surface child
                    participates (a lone list fills, N lists equal-split + each scroll). Its parent
                    `@container/slackbody … flex min-h-0 flex-1` gives it a resolved height. */}
                <div
                  className="flex min-w-0 flex-1 flex-col overflow-auto p-3 text-card-foreground min-h-0"
                  role="tabpanel"
                >
                  {activeTab.error && (
                    <p
                      className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
                      role="alert"
                    >
                      Couldn&apos;t do that: {activeTab.error}
                    </p>
                  )}
                  <A2UIProvider key={activeTab.id} catalog={slackCatalog}>
                    <ActiveTabSurface
                      surface={activeTab.surface}
                      catalogId={SLACK_CATALOG_ID}
                      panelName="SlackPanel"
                      onAction={handleSurfaceAction}
                    />
                  </A2UIProvider>
                </div>
                {openThread && (
                  <>
                    {/* ALWAYS-overlay floating drawer (matches Jira/Confluence/Calendar docks):
                        scrim + absolute right-drawer float OVER the full-width generative surface
                        at every width and never squeeze it. Scrim always present, closes on click.
                        glass-dock-v1: faint scrim (was bg-black/40) + the drawer wears the shared
                        `glass-dock` material (drops `bg-card shadow-lg border-border`, keeps
                        `border-l`); the inner SlackThreadPanel root is bg-transparent. */}
                    <div
                      className="absolute inset-0 z-10 bg-black/15 transition-opacity duration-200"
                      aria-hidden="true"
                      onClick={closeThread}
                    />
                    <GlassDock className="absolute inset-y-0 right-0 z-20 w-full max-w-[28rem] translate-x-0 border-l transition-transform duration-200 ease-out motion-reduce:transition-none">
                      <SlackThreadPanel
                        context={openThread}
                        canSend={status.canSend === true}
                        onClose={closeThread}
                        onReconnect={() => void refreshStatus()}
                        onConnectForSend={() => void connect()}
                        resolveNames={resolveNames}
                      />
                    </GlassDock>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* open-prompt-hoist-v1: the composer is now ONE App-level instance; this panel
          publishes its wiring (gated on isConnected) via usePublishComposer above. */}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        surfaceName="Slack"
        icon={MessageSquare}
        activeTab={activeStripTab}
        right={
          <ConnectionStatus
            status={status}
            onDisconnect={() =>
              confirmDisconnect.requestConfirm({ integration: 'slack', label: 'Slack' }, () =>
                void disconnect()
              )
            }
            onCancel={() => void cancelConnect()}
          />
        }
      />

      <ConfirmDialog
        open={confirmDisconnect.state.open}
        title={confirmCopy('Slack').title}
        description={confirmCopy('Slack').body}
        onConfirm={confirmDisconnect.confirm}
        onOpenChange={(next) => {
          if (!next) {
            confirmDisconnect.cancel()
          }
        }}
      />
    </section>
  )
}
