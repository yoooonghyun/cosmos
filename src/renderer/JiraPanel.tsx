/**
 * JiraPanel — the native cosmos Jira surface, a GENERATIVE surface (Jira
 * generative-UI v2), now TABBED (panel-tabs v1, Track B / Phase 6). The panel shell
 * (title bar + always-present ConnectionBar + not-connected Connect affordance) is
 * unchanged; the CONNECTED body hosts a tab strip whose ACTIVE tab is an A2UI host
 * rendering through the Jira CUSTOM catalog (`catalogId: 'jira'`) plus a bottom-docked
 * prompt composer (design §9).
 *
 * Tabs reuse the shared `useGenerativePanelTabs` correlation; Jira's panel-specific
 * behaviors layered on top are:
 *   - DEFAULT VIEW ON SWITCH (D4 / FR-002, FR-019): the FIRST time the connected body
 *     is shown with no tab yet, it auto-opens one tab + calls `jira:requestDefaultView`.
 *     The default board arrives as an UNSOLICITED `target:'jira'` frame and the shared
 *     hook files it into that active tab. Once a tab holds a surface it persists across
 *     rail switches and is NOT overwritten.
 *   - WRITE RE-PUSH (FR-020): a `jira.*` bound action is forwarded to main by
 *     `ActiveTabSurface` (the cosmos `ui:action` submit); main's deterministic dispatcher
 *     re-pushes a FRESH surface (new requestId) as another unsolicited `target:'jira'`
 *     frame, which the shared hook files into the active tab. Jira is therefore
 *     `cancelOnClose: false` — its actions are never the blocking render call's answer.
 *
 * The token NEVER reaches here (FR-A11, SC-009): the panel requests *operations* over
 * `window.cosmos.jira`; main attaches the token. The agent's render tool is the
 * Jira-scoped `render_jira_ui`, granted only for `target: 'jira'` runs (D2).
 *
 * Spec trace (v2): FR-002 default view on switch, FR-003 composer guards, FR-004
 * target routing, FR-016 reconnect routes to native Connect, FR-019/FR-020 loading +
 * recoverable error, never blocks the rail switch. panel-tabs: FR-019 (target→tab),
 * FR-020 (write re-push lands in tab).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A2UIProvider, type A2UIAction } from '@a2ui-sdk/react/0.9'
import { Search, SquareKanban, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { FormEvent } from 'react'
import { ConnectionStatus, ConnectForm } from './atlassianPanelBits'
import {
  jiraCatalog,
  JIRA_CATALOG_ID,
  JIRA_OPEN_DETAIL_ACTION,
  isDetailSurfaceSpec
} from './jiraCatalog'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelRefreshButton } from './PanelRefreshButton'
import { panelRefreshInputsFor } from './panelRefreshLogic'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { usePublishComposer } from './ActiveComposerProvider'
import { SurfaceSpinner } from './SurfaceSpinner'
import { contextChipFor, jiraViewContext } from './viewContextCapture'
import { useGenerativePanelTabs, type TabSurface } from './useGenerativePanelTabs'
import { useRestoredGenerativePanel } from './SessionProvider'
import { usePerTabNav } from './usePerTabNav'
import {
  shouldAutoRefreshOnActivation,
  autoRefreshValues
} from './activeTabSurfaceRefresh'
import { surfaceSpinnerVisible } from './promptComposerLogic'
import { useTabShortcuts } from './useTabShortcuts'
import { useConfirm } from './useConfirm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { confirmCopy } from './confirmLogic'
import type { UiRenderPayload } from '../shared/ipc'
import type { JiraConnectionStatus } from '../shared/jira'

/**
 * The my-tickets JQL — the native search box's placeholder AND the empty-submit fallback
 * (jira-jql-search-v1 FR-002/FR-005). Mirrors main's `JIRA_DEFAULT_VIEW_JQL`; main owns
 * the empty⇒default decision (this constant is only the placeholder so the box and the
 * fallback never drift visually). Renderer-local because main's constant isn't exported.
 */
const JIRA_DEFAULT_VIEW_JQL = 'assignee = currentUser() ORDER BY updated DESC'

/**
 * One issue-card placeholder — the shared per-card unit of BOTH skeleton variants
 * (jira-tab-switch-auto-refresh-v1 design §Component spec) so the list and board skeletons
 * read as one family. Mirrors a real `TicketCard`: key chip + status pill, summary, meta.
 */
function SkeletonCard(): React.JSX.Element {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-24" />
    </div>
  )
}

/** A skeleton list shown while the per-switch default-view read is in flight (§5/§9.3). */
function DefaultViewSkeleton(): React.JSX.Element {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2" aria-busy="true">
      <Skeleton className="h-3 w-16" />
      {[0, 1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

/**
 * A skeleton BOARD shown while a multi-region kanban auto-refreshes on tab re-activation
 * (jira-tab-switch-auto-refresh-v1 design §Variant B). A horizontal row of column
 * placeholders — each a header bar (title + count chip) over a stack of `SkeletonCard`s — so
 * the loading state reads as a board, not a single list, and the swap to the real board does
 * not jump the data region's scroll axis. Built entirely from the existing `Skeleton`
 * primitive + tokens (no new design-system primitive). Data-region only; chrome stays.
 */
function KanbanBoardSkeleton(): React.JSX.Element {
  return (
    <div className="flex w-full min-w-0 gap-3" aria-busy="true">
      {[0, 1, 2].map((col) => (
        <div key={col} className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-[0.875rem] w-20" />
            <Skeleton className="h-4 w-6 rounded-full" />
          </div>
          {[0, 1, 2].map((card) => (
            <SkeletonCard key={card} />
          ))}
        </div>
      ))}
    </div>
  )
}


/**
 * Native deterministic JQL search box (jira-jql-search-v1, design §1.2). Mirrors the
 * Confluence panel's search box byte-for-byte (the `border-b border-border p-2` container,
 * `<form className="relative">`, lucide `Search` icon, shadcn `Input` `h-8 pl-8 text-sm`).
 * Enter-only submit (no button); the box is NOT cleared on submit (the query stays
 * editable for refinement). Sends the RAW text — main trims + does empty⇒default (FR-005).
 */
function JqlSearchBox({ onSubmit }: { onSubmit: (jql: string) => void }): React.JSX.Element {
  const [searchText, setSearchText] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit(searchText)
  }

  return (
    <div className="border-b border-border p-2">
      <form onSubmit={handleSubmit} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={JIRA_DEFAULT_VIEW_JQL}
          className="h-8 pl-8 text-sm"
          aria-label="Search Jira issues with JQL"
        />
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Ticket-detail dock (right dock) — jira-ticket-detail-v1 (#86, approach R-A)
 *
 * Replaces the retired whole-panel view-swap + native "Back to list" row with a region
 * docked to the RIGHT of the issue list (the shipped Slack-thread / calendar-event-detail
 * side-dock idiom). The dock BODY hosts a SECOND `A2UIProvider` (keyed `:detail`) rendering
 * the per-tab `detailSurface` slot through the SAME `jiraCatalog` — so the detail's
 * `jira.transition`/`jira.comment` write controls keep flowing to main unchanged (a write
 * re-pushes a fresh detail into the SAME slot and the dock STAYS open — FR-012). The list
 * `A2UIProvider` keeps the tab's MAIN surface untouched and visible (FR-002/FR-005).
 *
 * Body states reuse the list region's branches (design §3): loading = `DefaultViewSkeleton`
 * (the detail is always single-column, never a kanban board); error = the existing
 * destructive chip. Same JSX in both layout modes; only the wrapper positioning differs
 * (side-by-side ≥32rem vs. drawer overlay below — wired by the caller).
 * ------------------------------------------------------------------------- */

function JiraDetailDock({
  tabId,
  issueKey,
  surface,
  onClose,
  onAction
}: {
  tabId: string
  issueKey: string
  surface: TabSurface | null
  onClose: () => void
  onAction: (action: A2UIAction) => boolean
}): React.JSX.Element {
  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* Header (sticky top, non-scrolling): icon + issue-key title + X close (FR-004). */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <SquareKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-medium text-foreground">{issueKey}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close ticket detail"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      {/* Body scrolls WITHIN the dock (spec Edge Case "Long detail content"). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 text-card-foreground">
          {surface ? (
            <A2UIProvider key={`${tabId}:detail`} catalog={jiraCatalog}>
              <ActiveTabSurface
                surface={surface}
                catalogId={JIRA_CATALOG_ID}
                panelName="JiraDetailDock"
                onAction={onAction}
              />
            </A2UIProvider>
          ) : (
            // Detail read in flight (FR-006): the dock body shows the per-tab loading
            // skeleton scoped to the dock; the still-visible list pane is undisturbed.
            <DefaultViewSkeleton />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * The per-tab detail-dock state (jira-ticket-detail-v1 #86): the clicked issue key (null =
 * dock closed) + the routed detail `surface` slot (null while the read is in flight). Held
 * PER-TAB via `usePerTabNav` keyed on the active tab so the dock is transient and resets to
 * closed on a tab switch and on disconnect (FR-014) — no cross-tab bleed.
 */
interface JiraDetailState {
  detailIssueKey: string | null
  detailSurface: TabSurface | null
}

/** The default dock state for an unset/fresh tab (closed, empty slot). */
const JIRA_DETAIL_DEFAULT: JiraDetailState = { detailIssueKey: null, detailSurface: null }

export function JiraPanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<JiraConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)

  // Initial status + live updates (FR-A12). A reconnect_needed routes the content region
  // to the native Connect/Reconnect affordance (FR-016) while the tab strip stays put.
  useEffect(() => {
    let alive = true
    void window.cosmos.jira.getStatus().then((s) => {
      if (alive) {
        setStatus(s)
      }
    })
    const off = window.cosmos.jira.onStatusChanged((s) => setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const connect = async (): Promise<void> => {
    setBusy(true)
    const next = await window.cosmos.jira.connect()
    setStatus(next)
    setBusy(false)
  }

  const disconnect = async (): Promise<void> => {
    const next = await window.cosmos.jira.disconnect()
    setStatus(next)
  }

  // disconnect-confirm-modal-v1: gate the footer Disconnect behind a confirm modal.
  const confirmDisconnect = useConfirm()

  // oauth-cancel-v1: abort an in-flight connect (the user cancelled the browser consent) so
  // the panel returns to not_connected immediately and Connect is clickable again.
  const cancelConnect = async (): Promise<void> => {
    const next = await window.cosmos.jira.cancelConnect()
    setStatus(next)
    setBusy(false)
  }

  const isConnected = status.state === 'connected'

  // session-persistence-v1: the restored Jira slice. Only composed surfaces persist;
  // the live default/search/detail views (composed:false) re-fetch on restore.
  const restoredJiraPanel = useRestoredGenerativePanel('jira')

  // jira-ticket-detail-v1 (#86, R-A): the per-tab ticket-detail dock state, keyed on the
  // active tab via `usePerTabNav` so it is transient and resets to closed on a tab switch /
  // disconnect (FR-014). Declared as a ref-backed setter holder first because the hook's
  // `onUnsolicitedFrame` interceptor (passed to `useGenerativePanelTabs` below) must route a
  // detail frame into THIS state — but `setDetail` is created from `usePerTabNav`, which
  // needs `activeTabId` from the hook. Break the cycle by routing through a ref the
  // interceptor reads (so the long-lived render subscription never captures a stale setter).
  const setDetailRef = useRef<((next: JiraDetailState | ((prev: JiraDetailState) => JiraDetailState)) => void) | null>(
    null
  )
  // open-prompt-view-context-v1 (FR-004): the LIVE open issue key the composer grounds
  // against, read at send time. Routed through a ref because `detail` is derived from
  // `usePerTabNav` (which needs `activeTabId` from the hook below) — same cycle-break as
  // `setDetailRef`. Assigned after `detail` is available.
  const detailIssueKeyRef = useRef<string | null>(null)

  // jira-ticket-detail-v1 (#86, R-A): intercept the UNSOLICITED `jira:requestIssueDetail`
  // detail frame and route its surface into the active tab's dock slot instead of letting
  // the shared hook file it into the tab's MAIN (list) surface — so the list is never
  // clobbered (the whole reason the retired snapshot/restore back-nav machinery is gone).
  // A non-detail unsolicited frame (default board / JQL search / a `jira.*` write re-push to
  // the LIST / a Notice) returns false → falls through to normal active-tab filing (FR-020).
  // A detail re-push from an in-dock write IS a detail frame, so it lands back in the SAME
  // dock slot and the dock stays open (FR-012).
  const onUnsolicitedFrame = useCallback((payload: UiRenderPayload): boolean => {
    if (!isDetailSurfaceSpec(payload.spec)) {
      return false
    }
    setDetailRef.current?.((prev) => ({
      ...prev,
      detailSurface: {
        requestId: payload.requestId,
        spec: payload.spec,
        dataModel: payload.dataModel,
        descriptor: payload.descriptor,
        bindings: payload.bindings
      }
    }))
    return true
  }, [])

  // panel-tabs v1: Jira tabs reuse the shared correlation. cancelOnClose=false because
  // jira.* actions are dispatched deterministically by main (never the blocking render
  // call's answer), so closing a tab needs no cancel.
  const {
    tabs,
    activeTabId,
    activeTab,
    setActive,
    submit,
    newTab,
    requestDefaultInActiveTab,
    fireOrDefer,
    closeTab,
    update
  } = useGenerativePanelTabs({
    target: 'jira',
    panelName: 'Jira',
    cancelOnClose: false,
    onUnsolicitedFrame,
    // open-prompt-view-context-v1 (FR-004): ground a compose against the open detail dock's
    // issue (read live at send time via the ref); no dock open ⇒ no context (FR-005).
    getViewContext: () => jiraViewContext(detailIssueKeyRef.current),
    ...(restoredJiraPanel ? { initial: restoredJiraPanel } : {})
  })

  // jira-ticket-detail-v1 (#86, R-A): the per-tab dock state (clicked issue key + routed
  // detail surface slot). `usePerTabNav` keys it on `activeTabId`, so switching tabs shows
  // that tab's dock state (default = closed) and switching back shows the list with the dock
  // closed — no cross-tab bleed (FR-014). `drop` clears a closed tab's entry; `clearAll`
  // resets every tab on a connection transition (the dock closes cleanly on disconnect).
  const {
    nav: detail,
    setNav: setDetail,
    drop: dropDetail,
    clearAll: clearAllDetail
  } = usePerTabNav<JiraDetailState>(activeTabId, JIRA_DETAIL_DEFAULT)
  setDetailRef.current = setDetail
  const { detailIssueKey, detailSurface } = detail
  // Keep the live issue key in sync for the send-time view-context capture (above).
  detailIssueKeyRef.current = detailIssueKey
  // Close the dock: clear the active tab's slot (X / scrim dismiss — FR-004/FR-005). The
  // list pane never moved, so no re-fetch is needed.
  const closeDetail = useCallback(() => {
    setDetail((prev) => ({ ...prev, detailIssueKey: null, detailSurface: null }))
  }, [setDetail])

  // jira-ticket-detail-v1 (#86, FR-014): a connection drop closes every tab's dock cleanly —
  // while disconnected the Connect/Reconnect CTA owns the whole content region (the
  // `@container/jirabody` two-pane unmounts), so no dock is left stranded. Reset all dock
  // state whenever the panel is not connected (covers `disconnect`/`reconnect_needed` from
  // both the explicit handlers and a mid-read `statusChanged`).
  useEffect(() => {
    if (!isConnected) {
      clearAllDetail()
    }
  }, [isConnected, clearAllDetail])

  // Closing a tab drops its per-tab dock entry so the map never leaks state for tabs that no
  // longer exist (mirrors Slack's per-tab nav drop on close).
  const handleCloseTab = useCallback(
    (tabId: string) => {
      dropDetail(tabId)
      closeTab(tabId)
    },
    [dropDetail, closeTab]
  )

  // jira-tab-switch-auto-refresh-v1: a minimum-duration skeleton floor for the JQL search +
  // the tab-switch auto-refresh of a bound surface. The per-tab `loadingDefault` flag already
  // gates the skeleton, but a warm read can resolve faster than one paint, so the skeleton
  // would never become visible. `navLoading` holds it up for a short floor so the transition
  // always reads as "loading"; the real read keeps it up longer when slower.
  const [navLoading, setNavLoading] = useState(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beginNavLoad = useCallback(() => {
    setNavLoading(true)
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current)
    }
    navTimerRef.current = setTimeout(() => setNavLoading(false), 350)
  }, [])
  useEffect(
    () => () => {
      if (navTimerRef.current) {
        clearTimeout(navTimerRef.current)
      }
    },
    []
  )

  // jira-tab-switch-auto-refresh-v1 (FR-001/FR-002/FR-004/FR-007/FR-010): drive the tab-switch
  // auto-refresh from the SURVIVING parent (this effect, keyed on activeTabId), NOT from the
  // remounting <A2UIProvider key={activeTab.id}> child — the "was this surface already painted
  // once?" set must live ABOVE the keyed remount boundary. The set of requestIds we have
  // already painted: a surface's FIRST activation is recorded + skipped (no redundant
  // first-page re-fetch on a fresh compose / default read); a switch-back re-presents the SAME
  // requestId → a RE-activation that fires one `adapter.refresh` (reusing ActiveTabSurface's
  // manual dispatch shape via the pure `autoRefreshValues`), sets the tab's `autoRefreshing`
  // skeleton flag, and starts the existing nav-loading floor. The child's `restored`-driven
  // effect still fires ONLY for restored:true (snapshot/back-nav), so the two never double-fire
  // (a plain switch-back never sets `restored`).
  const paintedRequestIdsRef = useRef<Set<string>>(new Set())
  const activeSurface = activeTab?.surface ?? null
  useEffect(() => {
    if (!activeSurface) {
      return
    }
    const reqId = activeSurface.requestId
    const hasPaintedBefore = paintedRequestIdsRef.current.has(reqId)
    if (
      shouldAutoRefreshOnActivation({ surface: activeSurface, hasPaintedBefore })
    ) {
      const values = autoRefreshValues(activeSurface)
      if (values) {
        const tabId = activeTabId
        if (tabId) {
          update(tabId, { autoRefreshing: true })
        }
        window.cosmos.ui.sendAction({
          requestId: reqId,
          action: { type: 'submit', actionId: 'adapter.refresh', values }
        })
        beginNavLoad()
      }
    }
    // Record this surface's requestId so a later re-activation is recognised (FR-011).
    paintedRequestIdsRef.current.add(reqId)
    // Keyed on the active tab + its surface requestId: re-runs on a switch-back (the active
    // tab's surface is the same requestId) and on a fresh compose/land (a new requestId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeSurface?.requestId])

  // jira-tab-switch-auto-refresh-v1 (FR-008/FR-010): the auto-refresh repaints IN PLACE via an
  // `updateDataModel` push (not a fresh ui:render frame), so the render subscription's
  // surface-land clear does not run for it. Clear the per-tab `autoRefreshing` skeleton flag
  // when the nav-loading floor ends — the floor (350ms) governs the minimum show time and the
  // in-place repaint lands beneath the skeleton, so the surface is repopulated when revealed.
  // A failed refresh resolves to the surface's existing presentation the same way (the
  // skeleton never hangs). Per-tab, so it only clears the tab the floor was started for.
  const autoRefreshTabRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeTab?.autoRefreshing && activeTabId) {
      autoRefreshTabRef.current = activeTabId
    }
    if (!navLoading && autoRefreshTabRef.current) {
      const tabId = autoRefreshTabRef.current
      autoRefreshTabRef.current = null
      update(tabId, { autoRefreshing: false })
    }
  }, [navLoading, activeTab?.autoRefreshing, activeTabId, update])

  // Terminal-unified layout: always keep ≥1 tab. Seed one on mount and reopen a fresh tab
  // if the collection ever empties, so the tab strip is always the topmost element — even
  // when not connected (its content region then shows the Connect CTA).
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
    // newTab is stable; only react to the count reaching 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

  // Lazily load the default board into an EMPTY tab once Jira is shown AND connected
  // (FR-002/FR-019). Keyed on the active tab's emptiness: a fresh `+`/seed tab, a reconnect,
  // or first show all resolve to "active tab has no surface, not loading, no error" → fire
  // one `requestDefaultInActiveTab(requestDefaultView)`. That marks the tab loadingDefault
  // (its skeleton), so the condition immediately goes false and never loops; a search read
  // also sets loadingDefault, so it suppresses this default load too. The detail dock has
  // its OWN slot (it never touches `activeTab.surface`), so an open dock does not affect this.
  // Gated on `active` so a connected-but-hidden Jira panel does not eager-read.
  useEffect(() => {
    if (
      active &&
      isConnected &&
      activeTab &&
      !activeTab.surface &&
      !activeTab.loadingDefault &&
      !activeTab.error &&
      // A user compose clears the tab's surface and sets `inFlight` — that empty-but-in-flight
      // state must NOT be mistaken for a fresh tab needing the default board, or it would fire a
      // default read (loadingDefault) that hides the send-spinner and keeps the composer's logo
      // visible. Only auto-load the default view when the empty tab is genuinely idle.
      !activeTab.inFlight
    ) {
      requestDefaultInActiveTab(() => window.cosmos.jira.requestDefaultView())
    }
  }, [active, isConnected, activeTab, requestDefaultInActiveTab])

  // jira-ticket-detail-v1 (#86, R-A; FR-001/FR-002/FR-009/FR-012): intercept the
  // renderer-local open-detail nav action a clicked TicketCard emits. Read its `issueKey`,
  // open/retarget the per-tab dock (clearing the prior slot so the dock shows the new
  // ticket's loading state — FR-002 retarget), and fire the deterministic detail read. The
  // resulting UNSOLICITED detail frame is routed into the dock slot by `onUnsolicitedFrame`
  // (NOT the list surface, so the list is never disturbed — FR-005/FR-006). Fired through
  // `fireOrDefer` (NOT `requestDefaultInActiveTab`) so it inherits the fire-or-defer
  // discipline against an in-flight compose (FR-009) WITHOUT marking the LIST tab
  // `loadingDefault` — the dock has its own loading (`detailSurface == null`). Return TRUE so
  // the action is NEVER forwarded to main or the agent. ANY OTHER action
  // (jira.transition/jira.comment writes) returns FALSE so it still flows to main via
  // ui:action; the re-pushed detail frame lands back in the dock slot (FR-012).
  const handleSurfaceAction = useCallback(
    (action: A2UIAction): boolean => {
      if (action.name !== JIRA_OPEN_DETAIL_ACTION) {
        return false
      }
      const ctx = (action.context ?? {}) as Record<string, unknown>
      const issueKey = typeof ctx.issueKey === 'string' ? ctx.issueKey : ''
      if (issueKey.trim().length > 0) {
        setDetail((prev) => ({ ...prev, detailIssueKey: issueKey, detailSurface: null }))
        fireOrDefer(() => window.cosmos.jira.requestIssueDetail({ issueKey }))
      }
      return true
    },
    [fireOrDefer, setDetail]
  )

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

  // The surface send-spinner gate, scoped to the ACTIVE tab (composer-send-animation-v1
  // FR-005/FR-008). A user compose sets `inFlight` (not `loadingDefault`), so it shows the
  // spinner; a default/nav read sets `loadingDefault` (excluded here) and routes to the
  // `DefaultViewSkeleton` branch first, so the two never co-render (design §4.1).
  const showSpinner = !!activeTab &&
    surfaceSpinnerVisible({
      inFlight: activeTab.inFlight,
      hasSurface: activeTab.surface != null,
      hasError: activeTab.error != null,
      loadingDefault: activeTab.loadingDefault
    })

  // True when the active tab is showing a COMPOSED (generated-UI) surface rather than a
  // native ticket view (default board / search results / detail). The JQL search box is
  // ticket-browsing chrome, so it is hidden on generated surfaces but kept otherwise.
  const onGeneratedUi = !!(activeTab?.surface && activeTab.composed)

  // Tab keyboard shortcuts act on THIS strip only while the Jira surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: handleCloseTab })

  // open-prompt-hoist-v1: publish this panel's composer wiring (or null while not connected,
  // mirroring the old `isConnected &&` JSX gate) so the ONE App-level composer routes to Jira
  // while it is the active surface. The view-context chip is captured the same way as before.
  usePublishComposer(
    'jira',
    useMemo(
      () =>
        isConnected
          ? {
              onSubmit: submit,
              placeholder: 'Ask about your Jira issues…',
              ariaLabel: 'Ask about your Jira issues',
              contextChip: contextChipFor('jira', jiraViewContext(detailIssueKey)),
              busy: showSpinner
            }
          : null,
      [isConnected, submit, detailIssueKey, showSpinner]
    )
  )

  return (
    <section
      className="flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label="Jira"
    >
      {/* Terminal-unified layout: the tab strip is the topmost element (no title header).
          The connection status moves to the footer; the not-connected CTA renders inside the
          active tab's content region. */}
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
        ariaLabel="Jira tabs"
      />

      {/* Connection-only chrome: the JQL search row only makes sense connected. Hidden while a
          compose send-spinner is up so the panel blanks to JUST the spinner (parity with
          Slack/Confluence), reappearing when the generated surface lands, and hidden on a
          composed (generated-UI) surface (ticket-browsing chrome only). The retired
          whole-panel "Back to list" row is gone — the detail now opens in a right-side dock
          beside the still-visible list (#86). */}
      {isConnected && !showSpinner && !onGeneratedUi && (
        <JqlSearchBox
          onSubmit={(jql) => {
            // A search submit re-reads the active list in place (main re-resolves empty⇒default).
            // The detail dock has its own slot and is left untouched by a list re-read.
            beginNavLoad()
            requestDefaultInActiveTab(() => window.cosmos.jira.requestSearchView({ jql }))
          }}
        />
      )}

      {/* Content region (the active tab's content). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {!isConnected ? (
          // FR-016: not-connected / reconnect_needed -> the native Connect affordance,
          // rendered as the active tab's content (always one tab present).
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <SquareKanban className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect your Atlassian site to work with Jira issues from cosmos.
            </p>
            {status.state !== 'connecting' && (
              <ConnectForm
                busy={busy}
                provider="Jira"
                reconnect={status.state === 'reconnect_needed'}
                {...(status.state === 'not_connected' && status.lastError
                  ? { lastError: status.lastError }
                  : {})}
                onConnect={() => void connect()}
              />
            )}
          </div>
        ) : (
          // jira-ticket-detail-v1 (#86, R-A): the two-pane data region. The LIST pane keeps the
          // tab's MAIN surface (`min-w-0 flex-1`, always visible). The ticket-detail DOCK mounts
          // only when `detailIssueKey != null` — overlay drawer below `32rem`, side-by-side at
          // `@[32rem]/jirabody` (container query gated on THIS panel's width, not the viewport).
          <div className="@container/jirabody relative flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
              {/* Per-tab loading skeleton over the DATA REGION only (the panel chrome — tab
                  strip, JQL/search row, composer, footer — renders outside this content div, so
                  it stays visible). Shown for the initial default-view read, an in-place JQL
                  search read, AND a tab-switch auto-refresh of a bound surface
                  (jira-tab-switch-auto-refresh-v1 FR-007). A multi-region (bound `bindings`)
                  board shows the board-shaped `KanbanBoardSkeleton`; everything else (single-
                  region list) shows the `DefaultViewSkeleton` (design §Variant A/B). */}
              {activeTab?.loadingDefault || navLoading || activeTab?.autoRefreshing ? (
                activeTab?.surface?.bindings && activeTab.surface.bindings.length > 0 ? (
                  <KanbanBoardSkeleton />
                ) : (
                  <DefaultViewSkeleton />
                )
              ) : (
                <>
                  {/* Surface send-spinner: busy state while a submitted compose is in flight,
                      until its surface lands (composer-send-animation-v1 FR-005/FR-006). The
                      skeleton branch above already handled loadingDefault/navLoading. */}
                  {showSpinner && <SurfaceSpinner />}
                  {activeTab?.error && (
                    <p
                      className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
                      role="alert"
                    >
                      Could not render this surface: {activeTab.error}
                    </p>
                  )}
                  {/* Only the ACTIVE tab's provider is mounted; keyed by tab id so a switch
                      remounts + re-processes that tab's stored surface (FR-003). A jira.* action
                      re-pushes a fresh surface that lands in the active tab (FR-020). The
                      open-detail nav action a clicked TicketCard emits is intercepted by
                      `handleSurfaceAction` and routed to the dock — never forwarded. */}
                  {activeTab && (
                    <A2UIProvider key={activeTab.id} catalog={jiraCatalog}>
                      <ActiveTabSurface
                        surface={activeTab.surface}
                        catalogId={JIRA_CATALOG_ID}
                        panelName="JiraPanel"
                        onAction={handleSurfaceAction}
                      />
                    </A2UIProvider>
                  )}
                </>
              )}
            </div>

            {/* Ticket-detail dock (#86, FR-001…FR-006). Mounted only when a ticket is open;
                `activeTabId` is non-null here (a tab is always seeded). Click-away scrim only in
                drawer mode (`@[32rem]/jirabody:hidden`); the side-by-side mode needs no scrim. */}
            {detailIssueKey != null && activeTabId != null && (
              <>
                <button
                  type="button"
                  aria-label="Close ticket detail"
                  className="absolute inset-0 z-10 bg-black/40 @[32rem]/jirabody:hidden"
                  onClick={closeDetail}
                />
                <div className="absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] border-l border-border bg-card shadow-lg @[32rem]/jirabody:relative @[32rem]/jirabody:w-[clamp(18rem,42%,28rem)] @[32rem]/jirabody:shrink-0 @[32rem]/jirabody:shadow-none">
                  <JiraDetailDock
                    tabId={activeTabId}
                    issueKey={detailIssueKey}
                    surface={detailSurface}
                    onClose={closeDetail}
                    onAction={handleSurfaceAction}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* open-prompt-hoist-v1: the composer is now ONE App-level instance; this panel
          publishes its wiring (gated on isConnected) via usePublishComposer above. */}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        surfaceName="Jira"
        icon={SquareKanban}
        activeTab={activeStripTab}
        right={
          <ConnectionStatus
            status={status}
            onDisconnect={() =>
              confirmDisconnect.requestConfirm({ integration: 'jira', label: 'Jira' }, () =>
                void disconnect()
              )
            }
            onCancel={() => void cancelConnect()}
          />
        }
      />

      <ConfirmDialog
        open={confirmDisconnect.state.open}
        title={confirmCopy('Jira').title}
        description={confirmCopy('Jira').body}
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
