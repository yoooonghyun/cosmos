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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A2UIProvider, type A2UIAction } from '@a2ui-sdk/react/0.9'
import { BookText, Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ConnectionStatus,
  ConnectForm,
  EmptyLine,
  ErrorState,
  ReconnectState
} from '../atlassian/atlassianPanelBits'
import { confluenceCatalog, CONFLUENCE_CATALOG_ID } from './confluenceCatalog'
import { CONFLUENCE_OPEN_DETAIL_ACTION } from './confluenceCatalog/logic'
// Shared page-detail body + title — native panel + gen-UI overlay render IDENTICALLY (SC-002/SC-005).
// confluence-page-detail-dock-v1 (FR-007): the open-dock page id provider lets the bound
// SearchResultList mark the OPEN page's row as selected (a renderer-local React context).
import {
  ConfluenceOpenPageProvider,
  PageDetailBody,
  PageDetailTitle
} from './confluenceCatalog/components'
import { CommentsSection } from './confluenceCatalog/CommentsSection'
import { PanelTabStrip, type PanelTab } from '../tabs/PanelTabStrip'
import { PanelRefreshButton } from '../generative/PanelRefreshButton'
import { panelRefreshInputsFor } from '../generative/panelRefreshLogic'
import { PanelFooter } from '../app/PanelFooter'
import { ActiveTabSurface } from '../generative/ActiveTabSurface'
import { usePublishComposer } from '../composer/ActiveComposerProvider'
import { SurfaceSpinner } from '../app/SurfaceSpinner'
import { GlassDock } from '../glassDock/GlassDock'
import { useGenerativePanelTabs } from '../tabs/useGenerativePanelTabs'
import { confluenceViewContext, contextChipFor } from '../app/viewContextCapture'
import { useRestoredGenerativePanel } from '../session/SessionProvider'
import { surfaceSpinnerVisible } from '../composer/promptComposerLogic'
import { usePerTabNav } from '../tabs/usePerTabNav'
import { useTabShortcuts } from '../tabs/useTabShortcuts'
import { useConfirm } from '../confirm/useConfirm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { confirmCopy } from '../confirm/confirmLogic'
import type {
  ConfluenceConnectionStatus,
  ConfluenceError,
  ConfluencePage,
  ConfluencePageDetail,
  ConfluenceResult,
  ConfluenceSearchResult
} from '../../shared/types/confluence'

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
  // Foreshadow the rich body (design §5 loading state): title + space chip, then a
  // heading-sized bar, paragraph line groups, and a wide block hinting a code/table region.
  return (
    <div className="flex flex-col gap-4 p-3" aria-busy="true">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-16 w-full rounded-md" />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Navigation state (search list)
 * ------------------------------------------------------------------------- */

/**
 * The native base always shows the search list now: clicking a document row opens it in
 * the right-side DOCK (confluence-page-detail-dock-v1) instead of swapping the whole region
 * to a page view, so `view` only ever holds `{kind:'search'}` at runtime. The `{kind:'page'}`
 * variant is retained ONLY for type-shape parity with `confluenceViewContext`
 * (`viewContextCapture.ts` mirrors this union); the open page is carried by the `genUiPage`
 * dock overlay, which that mapper reads with precedence.
 */
type ConfluenceView = { kind: 'search' } | { kind: 'page'; pageId: string; title: string }

/**
 * The native-base browser nav held PER-TAB (bug panel-shared-tab-nav-state-v1): the
 * `view` (search list), the in-progress `searchText`, and the submitted `query` (empty =>
 * the default feed). Each tab keeps its own so a search query in one tab does not bleed into
 * another tab's base.
 */
interface ConfluenceNav {
  view: ConfluenceView
  searchText: string
  query: string
}

/** The default native-base nav for an unset / fresh tab (search list, empty input). */
const CONFLUENCE_NAV_DEFAULT: ConfluenceNav = {
  view: { kind: 'search' },
  searchText: '',
  query: ''
}

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
  onReconnect,
  onWebUrl
}: {
  pageId: string
  onReconnect: () => void
  /**
   * confluence-link-404-v1 #100: lift the fetched page's canonical web URL up to the panel
   * so the "Open in Confluence" external-link affordance lives on the DETAIL'S TOP TITLE (the
   * sticky back-row header) instead of the body title. Fires with the `webUrl` (or `undefined`
   * to omit) once the page read resolves, and clears (undefined) while loading/on error/unmount.
   */
  onWebUrl?: (webUrl: string | undefined) => void
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

  // Publish the header link target to the panel: the resolved page's `webUrl` (or undefined
  // when loading/error/no page), and clear it on unmount so a stale link never lingers.
  useEffect(() => {
    onWebUrl?.(detail?.webUrl)
    return () => onWebUrl?.(undefined)
  }, [onWebUrl, detail?.webUrl])

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
  // confluence-dock-comments-v1: the comments section + bottom-pinned composer own the dock
  // scroll layout. The page header + body render as the section's `children` at the top of the
  // shared ScrollArea; the comments list + reply tree sit beneath them; the composer is pinned
  // below the scroll. Keyed (via PageDetail `key={pageId}`) so retarget remounts + reloads.
  return (
    <CommentsSection pageId={pageId} onReconnect={onReconnect}>
      <div className="flex flex-col gap-2">
        {/* The link affordance moved to the top back-row header (#100); the body title is
            plain text so the page is not titled twice as a link. */}
        <h2 className="text-base font-medium leading-snug text-foreground">{detail.title}</h2>
        {detail.space && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {detail.space}
            </Badge>
          </div>
        )}
      </div>
      <PageDetailBody body={detail.body} />
    </CommentsSection>
  )
}

/* ------------------------------------------------------------------------- *
 * Generative surface (Confluence generative-UI v1, now TABBED — panel-tabs v1 Phase 6).
 * The native search/page browser is the ZERO-TAB base (FR-017); each generative tab
 * hosts its own Confluence surface via the shared `useGenerativePanelTabs` correlation
 * + `ActiveTabSurface`. Display-only / read-only as a generative panel (FR-012/FR-020):
 * NO writes, NO action dispatch.
 * ------------------------------------------------------------------------- */


/* ------------------------------------------------------------------------- *
 * The panel
 * ------------------------------------------------------------------------- */

export function ConfluencePanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<ConfluenceConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)
  // panel-tabs v1: the per-tab generative surfaces (read-only, target 'confluence').
  // Zero tabs => the native search/page browser base (FR-017).
  const restoredConfluencePanel = useRestoredGenerativePanel('confluence')
  // open-prompt-view-context-v1 (FR-004): the LIVE open page (native view or gen-UI
  // overlay) the composer grounds against, read at send time via refs (the nav + overlay
  // are defined just below; assigned after they are available).
  const viewRef = useRef<ConfluenceView>(CONFLUENCE_NAV_DEFAULT.view)
  const genUiPageRef = useRef<{ pageId: string; title: string } | null>(null)
  const {
    tabs,
    activeTabId,
    activeTab,
    setActive,
    submit,
    newTab,
    closeTab,
    update
  } = useGenerativePanelTabs({
    target: 'confluence',
    panelName: 'Confluence',
    // Ground a compose against the open page; search/list ⇒ no context (FR-005).
    getViewContext: () => confluenceViewContext(viewRef.current, genUiPageRef.current),
    ...(restoredConfluencePanel ? { initial: restoredConfluencePanel } : {})
  })

  // confluence-page-detail-dock-v1: the open page-detail DOCK target `{ pageId, title }`.
  // BOTH a GENERATED-UI `SearchResultList` row (via `handleSurfaceAction`) AND a NATIVE
  // search/feed `ContentList` row (via its `onOpen`) set this — clicking either opens the page
  // in the right-side dock BESIDE the still-mounted list, reusing the SAME native `PageDetail`
  // component (which reads via `window.cosmos.confluence.getPage`). There is no longer a native
  // full-region page view: closing the dock (X / scrim → `closeGenUiPage`) returns the list to
  // full width with no re-fetch and no surface round-trip. Held PER active tab and reset on a
  // tab switch so an open detail never bleeds across tabs.
  const [genUiPage, setGenUiPage] = useState<{ pageId: string; title: string } | null>(null)
  useEffect(() => {
    setGenUiPage(null)
  }, [activeTabId])
  // confluence-link-404-v1 #100: the open page detail's canonical web URL, lifted out of
  // `PageDetail` so the "Open in Confluence" external-link affordance renders on the DETAIL'S
  // TOP TITLE (the back-row header) rather than the body title. Only one detail header is on
  // screen at a time (the `genUiPage` dock), so one piece of state suffices; `PageDetail`
  // clears it (undefined) on unmount/loading/error.
  const [detailWebUrl, setDetailWebUrl] = useState<string | undefined>(undefined)
  // The native-base browser nav is held PER-TAB, keyed by the active tab id
  // (bug panel-shared-tab-nav-state-v1), so each tab keeps its own view + search + query.
  const {
    nav: { view, searchText, query },
    setNav,
    drop: dropNav,
    clearAll: clearAllNav
  } = usePerTabNav<ConfluenceNav>(activeTabId, CONFLUENCE_NAV_DEFAULT)
  // Keep the live view + overlay in sync for the send-time view-context capture (above).
  // The native base no longer has a full-region page view; `view` stays a `{kind:'search'}`
  // here. It is still tracked so the send-time view-context capture (confluenceViewContext)
  // keeps its shared shape with the other panels — the open page is now carried by the
  // `genUiPage` dock overlay, which that mapper reads with precedence.
  viewRef.current = view
  genUiPageRef.current = genUiPage
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
  // Tab keyboard shortcuts act on THIS strip only while the Confluence surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: handleCloseTab })
  // The native search/page browser is the base shown not only at zero tabs but also
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
  // The native search/page browser is the base; while a submitted compose is in flight the
  // send-spinner takes the region instead (it lands a surface or error there next).
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

  // A connection transition resets EVERY tab's native-base nav back to default
  // (bug panel-shared-tab-nav-state-v1): while disconnected the connect call-to-action
  // replaces the base entirely, so it is coherent to reset all tabs' base nav (view +
  // search text + submitted query) rather than leave stale per-tab drill-ins/queries.
  const connect = useCallback(async () => {
    setBusy(true)
    const next = await window.cosmos.confluence.connect()
    setStatus(next)
    setBusy(false)
    clearAllNav()
  }, [clearAllNav])

  const disconnect = useCallback(async () => {
    const next = await window.cosmos.confluence.disconnect()
    setStatus(next)
    clearAllNav()
  }, [clearAllNav])

  // disconnect-confirm-modal-v1: gate the footer Disconnect behind a confirm modal.
  const confirmDisconnect = useConfirm()

  // oauth-cancel-v1: abort an in-flight connect (the user cancelled the browser consent) so
  // the panel returns to not_connected immediately and Connect is clickable again.
  const cancelConnect = useCallback(async () => {
    const next = await window.cosmos.confluence.cancelConnect()
    setStatus(next)
    setBusy(false)
  }, [])

  const refreshStatus = useCallback(async () => {
    const next = await window.cosmos.confluence.getStatus()
    setStatus(next)
    clearAllNav()
  }, [clearAllNav])

  const submitSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const q = searchText.trim()
      if (q !== '') {
        // Submit the query + show the search list, both scoped to the active tab.
        setNav((prev) => ({ ...prev, query: q, view: { kind: 'search' } }))
      }
    },
    [searchText, setNav]
  )

  const isConnected = status.state === 'connected'

  // confluence-page-detail-nav-v1: intercept the renderer-local open-detail nav action a
  // clicked `SearchResultRow` (in a generated list) emits. Read its `pageId` + `title` and
  // open the page in the SAME native page-detail browser via the `genUiPage` overlay — NO
  // surface compose, NO main round-trip. Return TRUE so the action is NEVER forwarded to
  // main or the agent. ANY OTHER action returns FALSE (Confluence is read-only with no
  // main-side dispatcher; keeping the seam identical to Jira keeps the contract unambiguous).
  const handleSurfaceAction = useCallback(
    (action: A2UIAction): boolean => {
      if (action.name !== CONFLUENCE_OPEN_DETAIL_ACTION) {
        return false
      }
      const ctx = (action.context ?? {}) as Record<string, unknown>
      const pageId = typeof ctx.pageId === 'string' ? ctx.pageId : ''
      const title = typeof ctx.title === 'string' ? ctx.title : ''
      if (pageId.trim().length > 0) {
        setGenUiPage({ pageId, title })
      }
      return true
    },
    []
  )

  // confluence-page-detail-nav-v1: "← Back" from a generated-UI-opened page detail just
  // clears the overlay — the generated list (the active tab's kept surface) renders again
  // verbatim, no re-fetch, no surface round-trip.
  const closeGenUiPage = useCallback(() => setGenUiPage(null), [])

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
  // mirroring the old `isConnected &&` JSX gate) so the ONE App-level composer routes to
  // Confluence while it is the active surface; the view-context chip is captured as before.
  usePublishComposer(
    'confluence',
    useMemo(
      () =>
        isConnected
          ? {
              onSubmit: submit,
              placeholder: 'Ask about your Confluence pages…',
              ariaLabel: 'Ask about Confluence',
              contextChip: contextChipFor('confluence', confluenceViewContext(view, genUiPage)),
              busy: showSpinner
            }
          : null,
      [isConnected, submit, view, genUiPage, showSpinner]
    )
  )

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
        onClose={handleCloseTab}
        onNewTab={newTab}
        onRename={(id, label) => update(id, { label, renamed: true, untitled: false })}
        trailing={
          <PanelRefreshButton
            activeTab={refreshInputs.activeTab}
            requestId={refreshInputs.requestId}
          />
        }
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
          // confluence-page-detail-dock-v1: the connected content region is a
          // `@container/confluencebody` TWO-PANE — the document list (native base / spinner /
          // generative A2UI host) stays mounted on the LEFT (`min-w-0 flex-1`); when a row is
          // clicked (a native search/feed row OR a generated-UI row), the native `PageDetail`
          // opens in a RIGHT-side DOCK BESIDE the list (~half the panel width) instead of a
          // whole-region view swap. The
          // list narrows to share the space; below the breakpoint the dock is a right-drawer
          // overlay over the list with a click-away scrim. Mirrors the Slack thread dock + Jira
          // ticket-detail dock. The dock + selected-row state is the existing per-tab `genUiPage`.
          <div className="@container/confluencebody relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
            {/* Native search browser — the base shown at zero tabs AND on an uncomposed
                (new `+`) active tab (FR-017). A row click opens the right-side dock; there is
                no native full-region page view. */}
            {showNativeBase && (
              <>
                {/* The search input is always present on the native base now: clicking a
                    document row opens it in the right-side DOCK (confluence-page-detail-dock-v1)
                    rather than swapping the whole region to a page view, so the list (and its
                    search box) stay mounted. There is no longer a native full-region page view. */}
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

                <div className="min-h-0 flex-1">
                  {query === '' ? (
                      <ContentList
                        key="default-feed"
                        reloadKey="default-feed"
                        fetcher={(cursor) =>
                          window.cosmos.confluence.defaultFeed(cursor ? { cursor } : {})
                        }
                        emptyLabel="No mentions, watched, or favorited pages yet."
                        onOpen={(result) =>
                          setGenUiPage({ pageId: result.id, title: result.title })
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
                          setGenUiPage({ pageId: result.id, title: result.title })
                        }
                        onReconnect={() => void refreshStatus()}
                      />
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
                    Could not render this surface: {activeTab.error}
                  </p>
                )}
                {/* confluence-page-detail-dock-v1 (FR-007): provide the open dock's page id so
                    the bound `SearchResultList` marks the OPEN page's row as selected. */}
                <ConfluenceOpenPageProvider value={genUiPage?.pageId}>
                  <A2UIProvider key={activeTab.id} catalog={confluenceCatalog}>
                    <ActiveTabSurface
                      surface={activeTab.surface}
                      catalogId={CONFLUENCE_CATALOG_ID}
                      panelName="ConfluencePanel"
                      onAction={handleSurfaceAction}
                    />
                  </A2UIProvider>
                </ConfluenceOpenPageProvider>
              </div>
            )}
            </div>

            {/* confluence-page-detail-dock-v1: the right-side page-detail DOCK (FR-001/FR-003).
                A row in a GENERATED-UI list was clicked → the SAME native `PageDetail` (reads
                via `window.cosmos.confluence.getPage`) opens HERE, floating OVER the still-mounted
                list, instead of a whole-region view swap. An ALWAYS-overlay absolute right-drawer
                (matching the Calendar dock): it floats over the still-full-width list at EVERY
                width and never squeezes it. Width is ~HALF the panel (`w-1/2`, spec OQ-1 / the
                user's "화면 반정도"). The click-away scrim is always present (closes at any size).
                Close (X / scrim) → `closeGenUiPage`. */}
            {genUiPage && (
              <>
                {/* Click-away scrim (glass-dock-v1): closes the dock on click. Faint bg-black/15
                    (was bg-black/40) so the frosted list reads THROUGH the glass blur. Always present. */}
                <div
                  className="absolute inset-0 z-10 bg-black/15 transition-opacity duration-200"
                  aria-hidden="true"
                  onClick={closeGenUiPage}
                />
                {/* glass-dock-v1: the drawer wears the shared `glass-dock` material (the SAME
                    global config the Calendar dock uses). `glass-dock` supplies the translucent
                    fill, border-color, and depth/edge shadow, so `bg-card shadow-lg border-border`
                    are dropped (keep only `border-l`). The dock's header div + the PageDetail
                    ScrollArea below carry no opaque fill, so `glass-dock` is the single fill. */}
                <GlassDock className="absolute inset-y-0 right-0 z-20 flex w-1/2 translate-x-0 flex-col border-l transition-transform duration-200 ease-out motion-reduce:transition-none">
                  {/* Dock frame header — the EXISTING back-row header (PageDetailTitle + the
                      "Open in Confluence" `detailWebUrl` lift, #100), with the leading Back arrow
                      swapped for a trailing ghost `icon-sm` X close (the Slack/Jira/calendar dock
                      close affordance). */}
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
                    <BookText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      <PageDetailTitle title={genUiPage.title} webUrl={detailWebUrl} />
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close page"
                      onClick={closeGenUiPage}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <PageDetail
                      key={genUiPage.pageId}
                      pageId={genUiPage.pageId}
                      onReconnect={() => void refreshStatus()}
                      onWebUrl={setDetailWebUrl}
                    />
                  </div>
                </GlassDock>
              </>
            )}
          </div>
        )}
      </div>

      {/* open-prompt-hoist-v1: the composer is now ONE App-level instance; this panel
          publishes its wiring (gated on isConnected) via usePublishComposer above. */}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        surfaceName="Confluence"
        icon={BookText}
        activeTab={activeStripTab}
        right={
          <ConnectionStatus
            status={status}
            onDisconnect={() =>
              confirmDisconnect.requestConfirm(
                { integration: 'confluence', label: 'Confluence' },
                () => void disconnect()
              )
            }
            onCancel={() => void cancelConnect()}
          />
        }
      />

      <ConfirmDialog
        open={confirmDisconnect.state.open}
        title={confirmCopy('Confluence').title}
        description={confirmCopy('Confluence').body}
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
