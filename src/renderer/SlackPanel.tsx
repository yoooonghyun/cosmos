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

import { useCallback, useEffect, useRef, useState } from 'react'
import { A2UIProvider, type A2UIAction } from '@a2ui-sdk/react/0.9'
import { ChevronLeft, Hash, Loader2, MessageSquare, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { slackCatalog, SLACK_CATALOG_ID, SLACK_OPEN_CHANNEL_ACTION } from './slackCatalog'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { PromptComposer } from './PromptComposer'
import { SurfaceSpinner } from './SurfaceSpinner'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { useRestoredGenerativePanel } from './SessionProvider'
import { surfaceSpinnerVisible } from './promptComposerLogic'
import { usePerTabNav } from './usePerTabNav'
import { useTabShortcuts } from './useTabShortcuts'
import type {
  SlackChannel,
  SlackConnectionStatus,
  SlackError,
  SlackMessage,
  SlackPage,
  SlackResult,
  SlackSearchMatch,
  SlackUser
} from '../shared/slack'

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Author display name with raw-id fallback (FR-014). */
function authorName(userId: string, userName?: string): string {
  return userName && userName.trim() !== '' ? userName : userId
}

/** Initials for the Avatar fallback (NO remote images — design §0/§5). */
function initials(name: string): string {
  const parts = name.replace(/^[@#]/, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Best-effort short timestamp from a Slack `ts` (design only needs one present). */
function formatTs(ts: string): string {
  const seconds = Number(ts.split('.')[0])
  if (!Number.isFinite(seconds)) {
    return ''
  }
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

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

/** One message row (history + thread). */
function MessageRow({
  message,
  onOpenThread
}: {
  message: SlackMessage
  onOpenThread?: (message: SlackMessage) => void
}): React.JSX.Element {
  const name = authorName(message.userId, message.userName)
  return (
    <div className="flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatTs(message.ts)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
          {message.text}
        </p>
        {onOpenThread && message.replyCount && message.replyCount > 0 ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="px-0"
            onClick={() => onOpenThread(message)}
          >
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Navigation state (channel list -> history -> thread back-stack)
 * ------------------------------------------------------------------------- */

type View =
  | { kind: 'channels' }
  | { kind: 'history'; channel: SlackChannel }
  | { kind: 'thread'; channel: SlackChannel; parent: SlackMessage }
  | { kind: 'search'; query: string }

/**
 * The native-base browser nav held PER-TAB (bug panel-shared-tab-nav-state-v1): the
 * drill-in `view` plus the in-progress `searchText`. Each tab keeps its own so opening
 * #general in tab 1 leaves tab 2 on its own view.
 */
interface SlackNav {
  view: View
  searchText: string
}

/** The default native-base nav for an unset / fresh tab (channel list, empty search). */
const SLACK_NAV_DEFAULT: SlackNav = { view: { kind: 'channels' }, searchText: '' }

/* ------------------------------------------------------------------------- *
 * Connection bar (design §2.1)
 * ------------------------------------------------------------------------- */

function ConnectionStatus({
  status,
  onDisconnect
}: {
  status: SlackConnectionStatus
  onDisconnect: () => void
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
          <Button type="button" variant="ghost" size="xs" onClick={onDisconnect}>
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
  onReconnect
}: {
  onOpen: (channel: SlackChannel) => void
  onReconnect: () => void
}): React.JSX.Element {
  const [items, setItems] = useState<SlackChannel[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<SlackError | null>(null)
  const [loaded, setLoaded] = useState(false)

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
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col p-1">
        {items.map((channel) => (
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
        ))}
        {cursor && (
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
  resolveNames
}: {
  load: (cursor?: string) => Promise<SlackResult<SlackPage<SlackMessage>>>
  emptyText: string
  onOpenThread?: (message: SlackMessage) => void
  onReconnect: () => void
  resolveNames: (messages: SlackMessage[]) => Promise<SlackMessage[]>
}): React.JSX.Element {
  const [items, setItems] = useState<SlackMessage[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<SlackError | null>(null)
  const [loaded, setLoaded] = useState(false)

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
        setItems((prev) => (next ? [...prev, ...withNames] : withNames))
        setCursor(result.data.nextCursor)
        setLoaded(true)
      } else {
        setError(result)
      }
      setLoading(false)
      setLoadingMore(false)
    },
    [load, resolveNames]
  )

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {items.map((m) => (
          <MessageRow key={m.ts} message={m} onOpenThread={onOpenThread} />
        ))}
        {cursor && (
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
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </>
            ) : (
              'Load more'
            )}
          </Button>
        )}
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------------- *
 * Search results view (FR-015)
 * ------------------------------------------------------------------------- */

function SearchResults({
  query,
  onReconnect
}: {
  query: string
  onReconnect: () => void
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
      setItems(result.data.items)
      setLoaded(true)
    } else {
      setError(result)
    }
    setLoading(false)
  }, [query])

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
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        <p className="px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {items.length} {items.length === 1 ? 'result' : 'results'} for “{query}”
        </p>
        {items.map((m) => {
          const name = authorName(m.userId, m.userName)
          return (
            <div
              key={`${m.channelId}-${m.ts}`}
              className="flex gap-2.5 border-b border-border/60 px-3 py-2"
            >
              <Avatar size="sm" className="mt-0.5">
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{name}</span>
                  {m.channelName && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      #{m.channelName}
                    </Badge>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatTs(m.ts)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-card-foreground">
                  {m.text}
                </p>
              </div>
            </div>
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
  // panel-tabs v1: the per-tab generative surfaces (read-only, target 'slack'). Zero
  // tabs => the native channel/search browser base (FR-017).
  const restoredPanel = useRestoredGenerativePanel('slack')
  const { tabs, activeTabId, activeTab, setActive, submit, newTab, closeTab, update } =
    useGenerativePanelTabs({
      target: 'slack',
      panelName: 'Slack',
      ...(restoredPanel ? { initial: restoredPanel } : {})
    })
  // The native-base browser nav is held PER-TAB, keyed by the active tab id
  // (bug panel-shared-tab-nav-state-v1), so each tab keeps its own view + search text.
  const {
    nav: { view, searchText },
    setNav,
    drop: dropNav,
    clearAll: clearAllNav
  } = usePerTabNav<SlackNav>(activeTabId, SLACK_NAV_DEFAULT)
  const setView = useCallback((view: View) => setNav((prev) => ({ ...prev, view })), [setNav])
  const setSearchText = useCallback(
    (searchText: string) => setNav((prev) => ({ ...prev, searchText })),
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
      if (action.name !== SLACK_OPEN_CHANNEL_ACTION) {
        return false
      }
      const ctx = (action.context ?? {}) as Record<string, unknown>
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
    },
    [activeTabId, setView, update]
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

  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const q = searchText.trim()
      if (q !== '') {
        setView({ kind: 'search', query: q })
      }
    },
    [searchText]
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
                {/* Search field (FR-015). Disabled + helper when search unavailable. */}
                <div className="border-b border-border p-2">
                  <form onSubmit={submitSearch} className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Search messages"
                      className="h-8 pl-8 text-sm"
                      disabled={status.canSearch === false}
                      aria-label="Search messages"
                    />
                  </form>
                  {status.canSearch === false && (
                    <p className="mt-1 text-xs text-muted-foreground">
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
                      onClick={() =>
                        setView(
                          view.kind === 'thread'
                            ? { kind: 'history', channel: view.channel }
                            : { kind: 'channels' }
                        )
                      }
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="truncate text-sm font-medium text-foreground">
                      {view.kind === 'history' && `#${view.channel.name}`}
                      {view.kind === 'thread' && 'Thread'}
                      {view.kind === 'search' && 'Search'}
                    </span>
                  </div>
                )}

                <div className="min-h-0 flex-1">
                  {view.kind === 'channels' && (
                    <ChannelList
                      onOpen={(channel) => setView({ kind: 'history', channel })}
                      onReconnect={() => void refreshStatus()}
                    />
                  )}
                  {view.kind === 'history' && (
                    <MessageList
                      key={view.channel.id}
                      emptyText="No messages yet."
                      load={(cursor) =>
                        window.cosmos.slack.getHistory({
                          channelId: view.channel.id,
                          ...(cursor ? { cursor } : {})
                        })
                      }
                      onOpenThread={(parent) =>
                        setView({ kind: 'thread', channel: view.channel, parent })
                      }
                      onReconnect={() => void refreshStatus()}
                      resolveNames={resolveNames}
                    />
                  )}
                  {view.kind === 'thread' && (
                    <div className="flex h-full flex-col">
                      <div className="border-b border-border">
                        <MessageRow message={view.parent} />
                      </div>
                      <div className="min-h-0 flex-1 border-l border-border pl-2">
                        <MessageList
                          key={`${view.channel.id}-${view.parent.ts}`}
                          emptyText="No replies."
                          load={async (cursor) => {
                            // conversations.replies returns the parent as the first item;
                            // it's already shown as the thread header above, so drop it
                            // here to avoid rendering the thread root twice.
                            const r = await window.cosmos.slack.getReplies({
                              channelId: view.channel.id,
                              threadTs: view.parent.ts,
                              ...(cursor ? { cursor } : {})
                            })
                            if (!r.ok) {
                              return r
                            }
                            return {
                              ...r,
                              data: {
                                ...r.data,
                                items: r.data.items.filter((m) => m.ts !== view.parent.ts)
                              }
                            }
                          }}
                          onReconnect={() => void refreshStatus()}
                          resolveNames={resolveNames}
                        />
                      </div>
                    </div>
                  )}
                  {view.kind === 'search' && (
                    <SearchResults query={view.query} onReconnect={() => void refreshStatus()} />
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
              <div className="min-h-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
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
            )}
          </>
        )}
      </div>

      {/* Composer docks above the footer, only when there is something to ask about. */}
      {isConnected && (
        <PromptComposer
          onSubmit={submit}
          placeholder="Ask about your Slack channels and messages…"
          ariaLabel="Ask about Slack"
          busy={showSpinner}
        />
      )}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        surfaceName="Slack"
        icon={MessageSquare}
        activeTab={activeStripTab}
        right={<ConnectionStatus status={status} onDisconnect={() => void disconnect()} />}
      />
    </section>
  )
}
