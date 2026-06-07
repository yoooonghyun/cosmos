/**
 * ConfluencePanel — the native cosmos Confluence surface (Atlassian integration v1).
 *
 * Built to design §2 + §5: the same panel shell as SlackPanel/JiraPanel (tab-strip
 * header + always-present ConnectionBar + content region), a single-button
 * browser-OAuth Connect call-to-action (NO token inputs — FR-A11/SC-009), a content
 * search list, and a page-detail drill-in. Every read surface renders all five
 * states (loading / empty-idle / populated / error / disabled+reconnect). Token-only
 * styling, cosmos palette — no Atlassian-brand color, no raw hex.
 *
 * Spec trace:
 *   FR-C03 not-connected -> connect affordance, no reads
 *   FR-C04 search content (paginated), page detail (title/space/body)
 *   FR-C05 loading / empty / error states for every read surface
 *   FR-A10/SC-007 reconnect-needed prompt on a rejected token
 *   FR-A12 connection status reflected (site/account identity, never a token)
 *   FR-X07 graceful errors incl. 429 "busy, retry shortly"
 *
 * The token never reaches here (FR-A11, SC-009): the panel requests *operations*
 * over `window.cosmos.confluence`; main attaches the token.
 */

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { BookText, ChevronLeft, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  ConnectionStatus,
  ConnectForm,
  EmptyLine,
  ErrorState,
  ReconnectState
} from './atlassianPanelBits'
import { confluenceCatalog, CONFLUENCE_CATALOG_ID } from './confluenceCatalog'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { useTabShortcuts } from './useTabShortcuts'
import type { AgentStatusPayload } from '../shared/ipc'
import type {
  ConfluenceConnectionStatus,
  ConfluenceError,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchResult
} from '../shared/confluence'

/* ------------------------------------------------------------------------- *
 * Loading skeletons (design §5.2 / §5.3)
 * ------------------------------------------------------------------------- */

function ContentRowSkeletons(): React.JSX.Element {
  return (
    <div className="flex flex-col" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 px-3 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function PageDetailSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 p-3" aria-busy="true">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Navigation state (search list <-> page detail)
 * ------------------------------------------------------------------------- */

type ConfluenceView = { kind: 'search' } | { kind: 'page'; pageId: string; title: string }

/* ------------------------------------------------------------------------- *
 * Search results list (§5.1 / §5.2)
 * ------------------------------------------------------------------------- */

/**
 * Generalized content list (confluence-default-feed v1, FR-002). Renders any paginated
 * `ConfluenceSearchResult` source — text search OR the default personal feed — via the
 * same five states, "Load more" pagination, and row-click drill-in. The source is
 * injected as `fetcher`; `reloadKey` drives the re-load `useEffect` (the submitted
 * `query` for search, a stable constant for the feed); `emptyLabel` is the per-source
 * empty line. The personal CQL never reaches here — the feed's `fetcher` calls the
 * cursor-only `defaultFeed` IPC method (SC-008).
 */
function ContentList({
  fetcher,
  reloadKey,
  emptyLabel,
  onOpen,
  onReconnect
}: {
  fetcher: (
    cursor?: string
  ) => Promise<ConfluenceResult<ConfluencePage<ConfluenceSearchResult>>>
  reloadKey: string
  emptyLabel: string
  onOpen: (result: ConfluenceSearchResult) => void
  onReconnect: () => void
}): React.JSX.Element {
  const [items, setItems] = useState<ConfluenceSearchResult[]>([])
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ConfluenceError | null>(null)
  const [loaded, setLoaded] = useState(false)

  const run = useCallback(
    async (next?: string) => {
      if (next) {
        setLoadingMore(true)
      } else {
        setLoading(true)
        setError(null)
      }
      const result = await fetcher(next)
      if (result.ok) {
        setItems((prev) => (next ? [...prev, ...result.data.items] : result.data.items))
        setCursor(result.data.nextCursor)
        setLoaded(true)
      } else {
        setError(result)
      }
      setLoading(false)
      setLoadingMore(false)
    },
    [fetcher]
  )

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  if (error?.kind === 'reconnect_needed') {
    return <ReconnectState provider="Confluence" onReconnect={onReconnect} />
  }
  if (loading) {
    return <ContentRowSkeletons />
  }
  if (error) {
    return <ErrorState provider="Confluence" error={error} onRetry={() => void run()} />
  }
  if (loaded && items.length === 0) {
    return <EmptyLine>{emptyLabel}</EmptyLine>
  }
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        <p className="px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {items.length} {items.length === 1 ? 'result' : 'results'}
        </p>
        {items.map((result) => (
          <Button
            key={result.id}
            type="button"
            variant="ghost"
            className="h-auto w-full flex-col items-start justify-start gap-1 rounded-none border-b border-border/60 px-3 py-2 font-normal last:border-b-0"
            onClick={() => onOpen(result)}
          >
            <div className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground">
                {result.title}
              </span>
              {result.space && (
                <Badge variant="outline" className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">
                  {result.space}
                </Badge>
              )}
            </div>
            {result.excerpt && (
              <span className="line-clamp-2 w-full whitespace-normal text-left text-xs text-muted-foreground">
                {result.excerpt}
              </span>
            )}
          </Button>
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
 * Page detail (§5.3)
 * ------------------------------------------------------------------------- */

function PageDetail({
  pageId,
  onReconnect
}: {
  pageId: string
  onReconnect: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<ConfluencePageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ConfluenceError | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await window.cosmos.confluence.getPage({ pageId })
    if (result.ok) {
      setDetail(result.data)
    } else {
      setError(result)
    }
    setLoading(false)
  }, [pageId])

  useEffect(() => {
    void run()
  }, [run])

  if (error?.kind === 'reconnect_needed') {
    return <ReconnectState provider="Confluence" onReconnect={onReconnect} />
  }
  if (loading) {
    return <PageDetailSkeleton />
  }
  if (error) {
    return <ErrorState provider="Confluence" error={error} onRetry={() => void run()} />
  }
  if (!detail) {
    return <EmptyLine>Page not found.</EmptyLine>
  }
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3">
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-medium leading-snug text-foreground">{detail.title}</h2>
          {detail.space && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {detail.space}
              </Badge>
            </div>
          )}
        </div>
        {detail.body.trim() !== '' ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-card-foreground">
            {detail.body}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">This page has no readable body.</p>
        )}
      </div>
    </ScrollArea>
  )
}

/* ------------------------------------------------------------------------- *
 * Generative surface (Confluence generative-UI v1, now TABBED — panel-tabs v1 Phase 6).
 * The native search/page browser is the ZERO-TAB base (FR-017); each generative tab
 * hosts its own Confluence surface via the shared `useGenerativePanelTabs` correlation
 * + `ActiveTabSurface`. Display-only / read-only as a generative panel (FR-012/FR-020):
 * NO writes, NO action dispatch.
 * ------------------------------------------------------------------------- */

/**
 * Bottom-docked Confluence prompt composer (design §4). Submitting calls `onSubmit`
 * (the panel hook owns the originating-tab bookkeeping + agent.submit with target
 * 'confluence'). Enter submits, Shift+Enter newlines, empty/whitespace is a no-op,
 * submit ignored while a run is in flight (FR-003).
 */
function PromptComposer({ onSubmit }: { onSubmit: (utterance: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const off = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      switch (status.state) {
        case 'started':
          setRunning(true)
          setError(null)
          break
        case 'completed':
          setRunning(false)
          break
        case 'error':
          setRunning(false)
          setError(status.message ?? 'The run failed.')
          break
      }
    })
    return off
  }, [])

  const submit = (): void => {
    if (running || value.trim().length === 0) {
      return
    }
    onSubmit(value)
    setRunning(true)
    setError(null)
    setValue('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const canSubmit = !running && value.trim().length > 0

  return (
    <form
      className="shrink-0 border-t border-border bg-popover px-3 py-3"
      aria-label="Ask about Confluence"
      onSubmit={handleSubmit}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={running}
        placeholder="Ask about your Confluence pages…"
        aria-label="Ask about Confluence"
        className="max-h-[9rem] min-h-[2.5rem] resize-none"
      />
      {error && (
        <p
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
          role="alert"
        >
          Couldn&apos;t do that: {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground" role="status" aria-live="polite">
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span className="text-muted-foreground">Generating…</span>
            </span>
          ) : (
            'Enter to send · Shift+Enter for newline'
          )}
        </span>
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={!canSubmit}
          aria-label={running ? 'Generating' : 'Send'}
        >
          {running ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Generating…
            </>
          ) : (
            'Send'
          )}
        </Button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------------- *
 * The panel
 * ------------------------------------------------------------------------- */

export function ConfluencePanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<ConfluenceConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<ConfluenceView>({ kind: 'search' })
  const [searchText, setSearchText] = useState('')
  // The query that has actually been submitted (empty => idle prompt, no read).
  const [query, setQuery] = useState('')
  // panel-tabs v1: the per-tab generative surfaces (read-only, target 'confluence').
  // Zero tabs => the native search/page browser base (FR-017).
  const { tabs, activeTabId, activeTab, setActive, submit, newTab, closeTab } =
    useGenerativePanelTabs({ target: 'confluence' })
  // Tab keyboard shortcuts act on THIS strip only while the Confluence surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: closeTab })
  // The native search/page browser is the base shown not only at zero tabs but also
  // whenever the active tab has not composed a surface yet (a fresh `+` "Untitled" tab),
  // so a new tab lands on the same base screen instead of a blank panel.
  const showNativeBase = !activeTab || (!activeTab.surface && !activeTab.error)
  // Always keep ≥1 tab (Terminal-unified layout): seed one on mount and reopen a fresh
  // tab if the collection ever empties, so the tab strip is always the topmost element.
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
    // newTab is stable; only react to the count reaching 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

  // Initial status + live updates (FR-A12).
  useEffect(() => {
    let active = true
    void window.cosmos.confluence.getStatus().then((s) => {
      if (active) {
        setStatus(s)
      }
    })
    const off = window.cosmos.confluence.onStatusChanged((s) => setStatus(s))
    return () => {
      active = false
      off()
    }
  }, [])

  const connect = useCallback(async () => {
    setBusy(true)
    const next = await window.cosmos.confluence.connect()
    setStatus(next)
    setBusy(false)
    setView({ kind: 'search' })
  }, [])

  const disconnect = useCallback(async () => {
    const next = await window.cosmos.confluence.disconnect()
    setStatus(next)
    setView({ kind: 'search' })
    setQuery('')
    setSearchText('')
  }, [])

  const refreshStatus = useCallback(async () => {
    const next = await window.cosmos.confluence.getStatus()
    setStatus(next)
    setView({ kind: 'search' })
  }, [])

  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const q = searchText.trim()
      if (q !== '') {
        setQuery(q)
        setView({ kind: 'search' })
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
      aria-label="Confluence"
    >
      {/* Terminal-unified layout: the tab strip is the topmost element (no title header).
          The connection status moves to the footer; the not-connected CTA renders inside the
          active tab's content region (FR-002). */}
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={activeTabId}
        onActivate={setActive}
        onClose={closeTab}
        onNewTab={newTab}
        ariaLabel="Confluence tabs"
      />

      {/* Content region (the active tab's content). */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!isConnected ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <BookText className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect your Atlassian site to search Confluence pages from cosmos.
            </p>
            {status.state !== 'connecting' && (
              <ConnectForm
                busy={busy}
                provider="Confluence"
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
            {/* Native search/page browser — the base shown at zero tabs AND on an
                uncomposed (new `+`) active tab (FR-017). */}
            {showNativeBase && (
              <>
                {view.kind === 'search' && (
                  <div className="border-b border-border p-2">
                    <form onSubmit={submitSearch} className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="(mention = currentUser() or watcher = currentUser() or favourite = currentUser()) and type = page order by lastmodified desc"
                        className="h-8 pl-8 text-sm"
                        aria-label="Search Confluence content"
                      />
                    </form>
                  </div>
                )}

                {view.kind === 'page' && (
                  <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Back"
                      onClick={() => setView({ kind: 'search' })}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="truncate text-sm font-medium text-foreground">
                      {view.title}
                    </span>
                  </div>
                )}

                <div className="min-h-0 flex-1">
                  {view.kind === 'search' &&
                    (query === '' ? (
                      <ContentList
                        key="default-feed"
                        reloadKey="default-feed"
                        fetcher={(cursor) =>
                          window.cosmos.confluence.defaultFeed(cursor ? { cursor } : {})
                        }
                        emptyLabel="No mentions, watched, or favorited pages yet."
                        onOpen={(result) =>
                          setView({ kind: 'page', pageId: result.id, title: result.title })
                        }
                        onReconnect={() => void refreshStatus()}
                      />
                    ) : (
                      <ContentList
                        key={query}
                        reloadKey={query}
                        fetcher={(cursor) =>
                          window.cosmos.confluence.searchContent({
                            query,
                            ...(cursor ? { cursor } : {})
                          })
                        }
                        emptyLabel="No content matches this query."
                        onOpen={(result) =>
                          setView({ kind: 'page', pageId: result.id, title: result.title })
                        }
                        onReconnect={() => void refreshStatus()}
                      />
                    ))}
                  {view.kind === 'page' && (
                    <PageDetail
                      key={view.pageId}
                      pageId={view.pageId}
                      onReconnect={() => void refreshStatus()}
                    />
                  )}
                </div>
              </>
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
                    Could not render this surface: {activeTab.error}
                  </p>
                )}
                <A2UIProvider key={activeTab.id} catalog={confluenceCatalog}>
                  <ActiveTabSurface
                    surface={activeTab.surface}
                    catalogId={CONFLUENCE_CATALOG_ID}
                    panelName="ConfluencePanel"
                  />
                </A2UIProvider>
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer docks above the footer, only when there is something to ask about. */}
      {isConnected && <PromptComposer onSubmit={submit} />}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        activeTab={activeStripTab}
        right={<ConnectionStatus status={status} onDisconnect={() => void disconnect()} />}
      />
    </section>
  )
}
