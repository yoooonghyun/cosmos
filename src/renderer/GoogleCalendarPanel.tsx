/**
 * GoogleCalendarPanel — the native cosmos Google Calendar surface, a GENERATIVE,
 * READ-ONLY panel (Google Calendar integration v1, design §2). The panel shell mirrors
 * JiraPanel/ConfluencePanel (tab strip + content region + bottom-docked composer +
 * footer connection status); the CONNECTED body hosts a tab strip whose ACTIVE tab is an
 * A2UI host rendering through the Google Calendar CUSTOM catalog
 * (`catalogId: 'google-calendar'`) — a MONTH GRID (design §1.1) for the default view.
 *
 * Tabs reuse the shared `useGenerativePanelTabs` correlation; the panel's only specific
 * behavior is DEFAULT VIEW ON SWITCH (FR-014): the FIRST time the connected body is shown
 * with an empty/idle active tab it auto-opens one tab + calls
 * `googleCalendar:requestDefaultView`. The default month arrives as an UNSOLICITED
 * `target:'google-calendar'` frame the shared hook files into that active tab. v1 is
 * READ-ONLY — there is NO input component and NO bound action, so this is
 * `cancelOnClose: false` (its reads are never the blocking render call's answer), and a
 * reconnect_needed routes the content region to the native Connect/Reconnect affordance
 * (FR-013) while the tab strip stays put.
 *
 * The OAuth token + client_secret NEVER reach here (secrets stay in main): the panel
 * requests *operations* over `window.cosmos.googleCalendar`; main attaches the token.
 *
 * Spec trace: FR-013 not-connected/reconnect -> native Connect, FR-014 default view on
 * switch, FR-016 timed/all-day (the catalog), FR-017 empty state never an error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { CalendarDays, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { googleCalendarCatalog, CATALOG_ID } from './googleCalendarCatalog'
import { EventDetail, CalendarLoadingLayout } from './googleCalendarCatalog/components'
import {
  CalendarNavContext,
  CalendarDetailContext,
  CalendarVisibilityContext,
  CalendarLoadingContext,
  type CalendarNavValue,
  type CalendarVisibilityValue
} from './googleCalendarCatalog/navContext'
import {
  CALENDAR_OPEN_DETAIL_ACTION,
  isOpenDetailEmittable
} from './googleCalendarCatalog/eventDetailLogic'
import type {
  CalendarLegendData,
  EventChipData
} from './googleCalendarCatalog/logic'
import type { A2UIAction } from '@a2ui-sdk/react/0.9'
import {
  currentMonth,
  currentDay,
  isCurrentMonth,
  isCurrentWeek,
  isCurrentDay,
  stepMonth,
  stepYear,
  stepWeek,
  stepDay,
  monthLabel,
  weekRangeLabel,
  dayLabel,
  viewToWirePayload,
  calendarLoadingScope,
  type CalendarMonthIntent,
  type CalendarDayAnchor,
  type CalendarViewIntent
} from './calendarNavLogic'
import type { CalendarViewKind } from './googleCalendarCatalog/navContext'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelRefreshButton } from './PanelRefreshButton'
import { panelRefreshInputsFor } from './panelRefreshLogic'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { usePublishComposer } from './ActiveComposerProvider'
import { SurfaceSpinner } from './SurfaceSpinner'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { calendarViewContext, contextChipFor } from './viewContextCapture'
import { useRestoredGenerativePanel } from './SessionProvider'
import { seedHiddenCalendarIds } from './googleCalendarCatalog/logic'
import { surfaceSpinnerVisible } from './promptComposerLogic'
import { useTabShortcuts } from './useTabShortcuts'
import { useConfirm } from './useConfirm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { confirmCopy } from './confirmLogic'
import type { GoogleCalendarConnectionStatus } from '../shared/googleCalendar'

/* ------------------------------------------------------------------------- *
 * Connect call-to-action (desktop OAuth browser flow) — Google-specific copy.
 *
 * The Atlassian `ConnectForm` hardcodes Atlassian copy; Google needs its own. A single
 * button starts cosmos's desktop OAuth flow: clicking it opens the system browser for
 * Google consent; main runs the confidential-client flow and persists the resulting
 * token encrypted. No token ever enters the renderer — the panel only triggers the flow
 * and reflects the resulting status.
 * ------------------------------------------------------------------------- */

function GoogleConnectForm({
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
            Your Google Calendar connection expired. Click Connect to sign in again.
          </AlertDescription>
        </Alert>
      )}
      {lastError && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/15" role="alert">
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{lastError}</AlertDescription>
        </Alert>
      )}
      <Button type="button" variant="default" size="sm" disabled={busy} onClick={() => onConnect()}>
        {busy ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Connecting…
          </>
        ) : (
          'Connect Google Calendar'
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens your browser to sign in to Google. cosmos requests read-only calendar access and
        stores the connection encrypted on this device.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * Footer connection status — Google-specific (account email/name, never a token)
 * ------------------------------------------------------------------------- */

function GoogleConnectionStatus({
  status,
  onDisconnect,
  onCancel
}: {
  status: GoogleCalendarConnectionStatus
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
            Connecting…
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
      {status.state === 'connected' && (
        <>
          <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
            {status.accountName ?? status.accountEmail ?? 'Connected'}
            {status.accountName && status.accountEmail && (
              <span className="text-muted-foreground"> · {status.accountEmail}</span>
            )}
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
 * The panel
 * ------------------------------------------------------------------------- */

export function GoogleCalendarPanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<GoogleCalendarConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)

  // Initial status + live updates. A reconnect_needed routes the content region to the
  // native Connect/Reconnect affordance (FR-013) while the tab strip stays put.
  useEffect(() => {
    let alive = true
    void window.cosmos.googleCalendar.getStatus().then((s) => {
      if (alive) {
        setStatus(s)
      }
    })
    const off = window.cosmos.googleCalendar.onStatusChanged((s) => setStatus(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const connect = async (): Promise<void> => {
    setBusy(true)
    const next = await window.cosmos.googleCalendar.connect()
    setStatus(next)
    setBusy(false)
  }

  const disconnect = async (): Promise<void> => {
    const next = await window.cosmos.googleCalendar.disconnect()
    setStatus(next)
  }

  // disconnect-confirm-modal-v1: gate the footer Disconnect behind a confirm modal.
  const confirmDisconnect = useConfirm()

  // oauth-cancel-v1: abort an in-flight connect (the user cancelled the browser consent) so
  // the panel returns to not_connected immediately and Connect is clickable again.
  const cancelConnect = async (): Promise<void> => {
    const next = await window.cosmos.googleCalendar.cancelConnect()
    setStatus(next)
    setBusy(false)
  }

  const isConnected = status.state === 'connected'

  // session-persistence-v1: the restored Google Calendar slice. Only composed surfaces
  // persist; the live default view (composed:false) re-fetches on restore.
  const restoredPanel = useRestoredGenerativePanel('google-calendar')

  // open-prompt-view-context-v1 (FR-004): the LIVE selected event the composer grounds
  // against, read at send time via a ref (`genUiEvent` is defined further below).
  const genUiEventRef = useRef<EventChipData | null>(null)

  // panel-tabs v1: tabs reuse the shared correlation. cancelOnClose=false because v1 is
  // read-only — its reads are unsolicited default-view frames, never the blocking render
  // call's answer — so closing a tab needs no cancel.
  const {
    tabs,
    activeTabId,
    activeTab,
    setActive,
    submit,
    newTab,
    requestDefaultInActiveTab,
    closeTab,
    update
  } = useGenerativePanelTabs({
    target: 'google-calendar',
    panelName: 'Calendar',
    cancelOnClose: false,
    // Ground a compose against the open event detail; no event ⇒ no context (FR-005).
    getViewContext: () => calendarViewContext(genUiEventRef.current),
    ...(restoredPanel ? { initial: restoredPanel } : {})
  })

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

  // Lazily load the default month into an EMPTY tab once the panel is shown AND connected
  // (FR-014). Keyed on the active tab's emptiness: a fresh `+`/seed tab, a reconnect, or
  // first show all resolve to "active tab has no surface, not loading, no error, not
  // in-flight" → fire one `requestDefaultInActiveTab(requestDefaultView)`. That marks the
  // tab loadingDefault (its skeleton), so the condition immediately goes false and never
  // loops. Gated on `active` so a connected-but-hidden panel does not eager-read.
  useEffect(() => {
    if (
      active &&
      isConnected &&
      activeTab &&
      !activeTab.surface &&
      !activeTab.loadingDefault &&
      !activeTab.error &&
      !activeTab.inFlight
    ) {
      requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView())
    }
  }, [active, isConnected, activeTab, requestDefaultInActiveTab])

  // calendar-month-year-nav-v1 (Decision 3) → calendar-week-day-views-v1 (FR-002): the
  // per-tab displayed VIEW INTENT — a renderer-only, SESSION-ONLY ephemeral
  // `Map<tabId, CalendarViewIntent>` (view + 0-based-month anchor). NOT persisted (no
  // session-snapshot field, no SESSION_SCHEMA_VERSION bump); a fresh `+` tab / app reload
  // starts with no entry ⇒ the CURRENT MONTH (Month is always the default, FR-002). Held in
  // the PANEL (not the catalog) so it survives the `A2UIProvider key={tab.id}` remount a tab
  // switch forces ("survives switching away/back").
  const [viewIntents, setViewIntents] = useState<Map<string, CalendarViewIntent>>(
    () => new Map()
  )

  // The active tab's intent: its map entry, else the current month (a fresh tab's default —
  // Month is always the default view, FR-002).
  const now = new Date()
  const activeIntent: CalendarViewIntent =
    (activeTabId ? viewIntents.get(activeTabId) : undefined) ?? {
      view: 'month',
      anchor: currentMonth(now)
    }

  // Set the active tab's intent + re-issue the default-view request for it. Reuses the
  // existing `requestDefaultInActiveTab` (marks the tab `loadingDefault` ⇒ the skeleton). The
  // intent leads; main reads the view's window ⇒ pushes a surface whose `timeMin`/`view` match
  // ⇒ the layout repaints (Decision 3 intent↔surface agreement). `viewToWirePayload` carries
  // the additive optional `view` + day anchor (month stays byte-for-byte the old payload).
  const navigateTo = useCallback(
    (next: CalendarViewIntent): void => {
      const tabId = activeTabId
      if (!tabId) {
        return
      }
      setViewIntents((prev) => {
        const map = new Map(prev)
        map.set(tabId, next)
        return map
      })
      requestDefaultInActiveTab(() =>
        window.cosmos.googleCalendar.requestDefaultView(viewToWirePayload(next))
      )
    },
    [activeTabId, requestDefaultInActiveTab]
  )

  // Drop a tab's intent (e.g. on close / disconnect) so it never re-requests a stale view.
  const clearIntent = useCallback((tabId: string): void => {
    setViewIntents((prev) => {
      if (!prev.has(tabId)) {
        return prev
      }
      const map = new Map(prev)
      map.delete(tabId)
      return map
    })
  }, [])

  // On disconnect, clear ALL intents so a reconnect loads the current month, not a stale
  // navigated view (navigated state does not survive a disconnect).
  useEffect(() => {
    if (!isConnected) {
      setViewIntents((prev) => (prev.size === 0 ? prev : new Map()))
    }
  }, [isConnected])

  // The live default view = a connected tab holding an UN-composed surface (composed:false).
  // The nav cluster + the refresh-the-displayed-month override are offered ONLY then
  // (FR-016/FR-017); composed snapshots + not-connected states get neither.
  const isLiveDefaultView =
    isConnected && !!activeTab && activeTab.surface != null && activeTab.composed === false

  // calendar-week-day-views-v1 (FR-009/FR-010): "Today" is a no-op when the displayed range
  // is already current — per the active granularity (month / week / day).
  const canGoToday =
    activeIntent.view === 'month'
      ? !isCurrentMonth(activeIntent.anchor, now)
      : activeIntent.view === 'week'
        ? !isCurrentWeek(activeIntent.anchor, now)
        : !isCurrentDay(activeIntent.anchor, now)

  // The header LABEL for the active view (panel-composed so it always matches the requested
  // anchor, never re-derived from the surface window).
  const rangeLabel =
    activeIntent.view === 'month'
      ? monthLabel(activeIntent.anchor)
      : activeIntent.view === 'week'
        ? weekRangeLabel(activeIntent.anchor)
        : dayLabel(activeIntent.anchor)

  // Switch the active view (Month/Week/Day). Month keeps a month anchor; Week/Day share a day
  // anchor (today by default). Switching re-issues the default-view request for the new view.
  const selectView = useCallback(
    (view: CalendarViewKind): void => {
      if (view === activeIntent.view) {
        return
      }
      if (view === 'month') {
        // Anchor the month on whichever month the current anchor falls in.
        const anchor: CalendarMonthIntent =
          activeIntent.view === 'month'
            ? activeIntent.anchor
            : { year: activeIntent.anchor.year, month: activeIntent.anchor.month }
        navigateTo({ view: 'month', anchor })
        return
      }
      // Week/Day: carry the day anchor across (today when coming from Month).
      const anchor: CalendarDayAnchor =
        activeIntent.view === 'month' ? currentDay(now) : activeIntent.anchor
      navigateTo({ view, anchor })
    },
    // `now` fresh each render; the intent + navigate are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeIntent, navigateTo]
  )

  // The nav wiring injected into the catalog grid via context. Non-null ONLY for the live
  // default view; the handlers update the intent + re-issue the request (latest click wins
  // because the intent is set synchronously). "Today" is a no-op when already current.
  const navValue: CalendarNavValue | null = useMemo(() => {
    if (!isLiveDefaultView) {
      return null
    }
    const view = activeIntent.view
    const onToday = (): void => {
      if (!canGoToday) {
        return // already current ⇒ no re-read.
      }
      navigateTo(
        view === 'month'
          ? { view: 'month', anchor: currentMonth(now) }
          : { view, anchor: currentDay(now) }
      )
    }
    if (activeIntent.view === 'month') {
      const anchor = activeIntent.anchor
      return {
        view,
        onSelectView: selectView,
        rangeLabel,
        canGoToday,
        onPrev: () => navigateTo({ view: 'month', anchor: stepMonth(anchor, -1) }),
        onNext: () => navigateTo({ view: 'month', anchor: stepMonth(anchor, 1) }),
        onPrevYear: () => navigateTo({ view: 'month', anchor: stepYear(anchor, -1) }),
        onNextYear: () => navigateTo({ view: 'month', anchor: stepYear(anchor, 1) }),
        onToday
      }
    }
    // Week/Day: single-step ±1 (week = ±7 days), no year jump.
    const anchor = activeIntent.anchor
    const step = view === 'week' ? stepWeek : stepDay
    return {
      view,
      onSelectView: selectView,
      rangeLabel,
      canGoToday,
      onPrev: () => navigateTo({ view, anchor: step(anchor, -1) }),
      onNext: () => navigateTo({ view, anchor: step(anchor, 1) }),
      onToday
    }
    // `now` is a fresh Date each render; the intent + gates are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveDefaultView, canGoToday, rangeLabel, activeIntent, navigateTo, selectView])

  // calendar-event-detail-v1 (FR-001/FR-002): the per-tab, TRANSIENT open-detail event. A
  // clicked chip emits CALENDAR_OPEN_DETAIL_ACTION (renderer-local) carrying the WHOLE event;
  // the onAction seam below stores it here and the dock renders BESIDE the still-mounted grid
  // (FR-002). Single state (not a per-tab map) so it RESETS on tab switch (FR-014) — the
  // effect below clears it whenever the active tab changes. NO fetch: the dock renders from
  // the carried event props alone (design §3 "Loading: None").
  const [genUiEvent, setGenUiEvent] = useState<EventChipData | null>(null)
  // Keep the live selected event in sync for the send-time view-context capture (above).
  genUiEventRef.current = genUiEvent
  const closeDetail = useCallback(() => setGenUiEvent(null), [])

  // FR-014: the dock is transient — reset on tab switch AND on disconnect/reconnect_needed.
  // (Month nav resets it too: navigateTo re-issues the default view, replacing the surface.)
  useEffect(() => {
    setGenUiEvent(null)
  }, [activeTabId, isConnected])

  // FR-003 retarget / FR-002 grid-stays: intercept the renderer-local open-detail action so it
  // is handled HERE (returns true) and NEVER forwarded to main/agent. A second chip click
  // simply replaces `genUiEvent` (retarget). Any other action falls through (return false) to
  // the normal main forward — v1 is read-only so there is none, but the seam stays honest.
  const handleSurfaceAction = useCallback((action: A2UIAction): boolean => {
    if (action.name !== CALENDAR_OPEN_DETAIL_ACTION) {
      return false
    }
    const ctx = action.context as { event?: EventChipData } | undefined
    const event = ctx?.event
    if (event && isOpenDetailEmittable(event.id)) {
      setGenUiEvent(event)
    }
    return true
  }, [])

  // The legend the active surface carries (shared view) — so the dock's Calendar-row swatch +
  // name match the chip/legend. Read defensively from the root EventList component; absent on
  // the single-primary path (the dock then falls back to the GCal colorId swatch).
  const activeLegend = useMemo((): CalendarLegendData[] | undefined => {
    const root = activeTab?.surface?.spec?.components?.[0] as
      | { calendars?: CalendarLegendData[] }
      | undefined
    return Array.isArray(root?.calendars) ? root?.calendars : undefined
  }, [activeTab?.surface])

  // calendar-selection-persistence: the legend's hidden-set is PER TAB — each google-calendar
  // tab keeps its own selection, independent of sibling tabs. The set is held on the live
  // GenerativeTab record (`hiddenCalendars`), restored from this tab's persisted snapshot and
  // written back via `update(id, { hiddenCalendars })` on every toggle. Keyed by tab id, it
  // survives the view-nav remount (Month↔Week↔Day re-issues the default-view request → a fresh
  // `EventList`) AND an app restart, while staying independent across tabs.
  const activeHidden = useMemo(
    () => new Set(activeTab?.hiddenCalendars ?? []),
    [activeTab?.hiddenCalendars]
  )

  // Write the active tab's hidden-set back onto its record so the report effect persists it
  // into THIS tab's GenerativeTabSnapshot.hiddenCalendars.
  const setActiveTabHidden = useCallback(
    (next: Set<string>): void => {
      const id = activeTabId
      if (!id) {
        return
      }
      update(id, { hiddenCalendars: [...next] })
    },
    [activeTabId, update]
  )

  // FR-010 first-paint default: the FIRST time a legend appears for a tab that has NO persisted
  // hidden-set yet, seed THAT TAB's set from Google's own `selected` preference (a calendar
  // hidden in Google starts hidden here). Tracked per tab id so each tab seeds once — a later
  // explicit toggle (including re-showing a Google-deselected calendar) is never undone. Once a
  // tab has a stored set, that set is the sole source of truth for it.
  const seededTabsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const id = activeTabId
    if (!id || seededTabsRef.current.has(id) || !activeLegend || activeLegend.length === 0) {
      return
    }
    // A tab that already restored a non-empty hidden-set is considered seeded — never re-seed.
    if ((activeTab?.hiddenCalendars?.length ?? 0) > 0) {
      seededTabsRef.current.add(id)
      return
    }
    seededTabsRef.current.add(id)
    const seed = seedHiddenCalendarIds(activeLegend)
    if (seed.size > 0) {
      update(id, { hiddenCalendars: [...seed] })
    }
    // Seed once per tab on its first legend; the tab's stored set is authoritative thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeLegend])

  // The visibility wiring injected into the catalog (live default view ONLY, like the nav
  // cluster). `onToggle` flips one id in/out of the ACTIVE TAB's hidden-set; the catalog reads
  // `hidden` for all three views so a deselect is honored uniformly. Composed snapshots / the
  // agent-MCP path get a null context and fall back to the catalog's ephemeral local set.
  const visibilityValue: CalendarVisibilityValue | null = useMemo(() => {
    if (!isLiveDefaultView) {
      return null
    }
    return {
      hidden: activeHidden,
      onToggle: (id: string): void => {
        const next = new Set(activeHidden)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        setActiveTabHidden(next)
      }
    }
  }, [isLiveDefaultView, activeHidden, setActiveTabHidden])

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
  // calendar-month-year-nav-v1 (FR-012): refresh of the live default view re-issues the
  // DISPLAYED month's request (the un-bound default view has no descriptor for
  // adapter.refresh). Composed surfaces keep their descriptor-gated refresh, unchanged.
  const onRefreshLiveDefaultView = useCallback((): void => {
    requestDefaultInActiveTab(() =>
      window.cosmos.googleCalendar.requestDefaultView(viewToWirePayload(activeIntent))
    )
  }, [requestDefaultInActiveTab, activeIntent])

  // The surface send-spinner gate, scoped to the ACTIVE tab (composer-send-animation-v1
  // FR-005/FR-008). A user compose sets `inFlight` (not `loadingDefault`), so it shows the
  // spinner; a default read sets `loadingDefault` (excluded here) and routes to the
  // GridSkeleton branch first, so the two never co-render.
  const showSpinner = !!activeTab &&
    surfaceSpinnerVisible({
      inFlight: activeTab.inFlight,
      hasSurface: activeTab.surface != null,
      hasError: activeTab.error != null,
      loadingDefault: activeTab.loadingDefault
    })

  // Closing a tab drops its navigated-month intent so a future tab reusing the id (or the
  // map growing unbounded) never carries a stale month (calendar-month-year-nav-v1).
  const handleCloseTab = useCallback(
    (id: string): void => {
      clearIntent(id)
      closeTab(id)
    },
    [clearIntent, closeTab]
  )

  // Tab keyboard shortcuts act on THIS strip only while the Calendar surface is active.
  useTabShortcuts({
    active,
    tabs,
    activeTabId,
    onActivate: setActive,
    onNewTab: newTab,
    onCloseTab: handleCloseTab
  })

  // open-prompt-hoist-v1: publish this panel's composer wiring (null while not connected,
  // mirroring the old `isConnected &&` JSX gate) so the ONE App-level composer routes to the
  // Calendar while it is the active surface; the view-context chip is captured as before.
  usePublishComposer(
    'google-calendar',
    useMemo(
      () =>
        isConnected
          ? {
              onSubmit: submit,
              placeholder: 'Ask about your calendar…',
              ariaLabel: 'Ask about your calendar',
              contextChip: contextChipFor('google-calendar', calendarViewContext(genUiEvent)),
              busy: showSpinner
            }
          : null,
      [isConnected, submit, genUiEvent, showSpinner]
    )
  )

  return (
    <section
      className="relative flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label="Google Calendar"
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
            {...(isLiveDefaultView ? { onRefresh: onRefreshLiveDefaultView } : {})}
          />
        }
        ariaLabel="Calendar tabs"
      />

      {/* Content region (the active tab's content). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {!isConnected ? (
          // FR-013: not-connected / reconnect_needed -> the native Connect affordance,
          // rendered as the active tab's content (always one tab present).
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <CalendarDays className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect Google Calendar to see your schedule in cosmos.
            </p>
            {status.state !== 'connecting' && (
              <GoogleConnectForm
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
          <div className="flex min-h-0 flex-1 flex-col p-3 text-card-foreground" role="tabpanel">
            {/* calendar-date-change-keeps-chrome: the INITIAL default-view read (no surface yet)
                and a date-change REFETCH (surface exists) share the SAME three-zone separated
                layout — a LEGEND SIDEBAR + a HEADER over the per-view GRID skeleton. On the
                INITIAL load there is no surface yet, so `CalendarLoadingLayout` renders SKELETON
                placeholders for the sidebar + header (in the SAME `flex-row` layout EventList
                uses) around the per-view `GridSkeleton`. On a REFETCH the surface stays mounted
                and EventList renders the REAL legend + header chrome around the same `GridSkeleton`
                (see CalendarLoadingContext below). So the only difference between first-load and a
                date-change is skeleton-vs-real chrome — the layout never jumps when data lands. */}
            {calendarLoadingScope(activeTab?.loadingDefault, activeTab?.surface != null) === 'full' ? (
              <CalendarLoadingLayout view={activeIntent.view} />
            ) : (
              <>
                {/* Surface send-spinner: busy state while a submitted compose is in flight,
                    until its surface lands (composer-send-animation-v1 FR-005/FR-006). */}
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
                    remounts + re-processes that tab's stored surface (FR-003). The grid pane
                    grows to FILL the panel's full height (flex-1 min-h-0 in a flex-col content
                    region) so the month grid stretches its week rows down to the footer rather
                    than sitting at a small fixed height. The event-detail dock is NOT a child of
                    this pane — it is hoisted to the panel root so it spans the full viewport
                    height independent of the grid (see below). */}
                {activeTab && (
                  <div
                    className="relative flex min-h-0 min-w-0 flex-1 overflow-auto"
                    {...(activeTab.loadingDefault ? { 'aria-busy': true } : {})}
                  >
                    <A2UIProvider key={activeTab.id} catalog={googleCalendarCatalog}>
                      {/* calendar-month-year-nav-v1: inject month/year navigation into the
                          catalog grid. Non-null ONLY for the live default view, so composed
                          snapshots render the plain label with no controls (FR-017). */}
                      <CalendarNavContext.Provider value={navValue}>
                        {/* calendar-selection-persistence: inject the panel-owned, PERSISTED
                            hidden-set so the legend toggle survives the view-nav remount + a
                            restart. Non-null only for the live default view. */}
                        <CalendarVisibilityContext.Provider value={visibilityValue}>
                          {/* calendar-date-change-keeps-chrome: on a date-change REFETCH (the
                              `'keep'` scope) the surface stays mounted so the legend + range-nav
                              header stay as persistent chrome; this non-null value tells EventList
                              to swap only the GRID for the TARGET-view skeleton (no progress bar,
                              no blank). `null` in the steady state renders the grid normally. */}
                          <CalendarLoadingContext.Provider
                            value={
                              calendarLoadingScope(
                                activeTab.loadingDefault,
                                activeTab.surface != null
                              ) === 'keep'
                                ? { view: activeIntent.view }
                                : null
                            }
                          >
                            {/* The open-detail dock's current event id flows down so the matching
                                chip reads `selected` (FR-003). */}
                            <CalendarDetailContext.Provider value={genUiEvent?.id ?? null}>
                              <ActiveTabSurface
                                surface={activeTab.surface}
                                catalogId={CATALOG_ID}
                                panelName="GoogleCalendarPanel"
                                onAction={handleSurfaceAction}
                              />
                            </CalendarDetailContext.Provider>
                          </CalendarLoadingContext.Provider>
                        </CalendarVisibilityContext.Provider>
                      </CalendarNavContext.Provider>
                    </A2UIProvider>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* open-prompt-hoist-v1: the composer is now ONE App-level instance; this panel
          publishes its wiring (gated on isConnected) via usePublishComposer above. */}

      {/* Connection bar is the panel footer (Terminal-unified layout). */}
      <PanelFooter
        surfaceName="Calendar"
        icon={CalendarDays}
        activeTab={activeStripTab}
        right={
          <GoogleConnectionStatus
            status={status}
            onDisconnect={() =>
              confirmDisconnect.requestConfirm(
                { integration: 'google-calendar', label: 'Google Calendar' },
                () => void disconnect()
              )
            }
            onCancel={() => void cancelConnect()}
          />
        }
      />

      <ConfirmDialog
        open={confirmDisconnect.state.open}
        title={confirmCopy('Google Calendar').title}
        description={confirmCopy('Google Calendar').body}
        onConfirm={confirmDisconnect.confirm}
        onOpenChange={(next) => {
          if (!next) {
            confirmDisconnect.cancel()
          }
        }}
      />

      {/* Right-docked event detail (design §1.2 / §5): an ALWAYS-overlay absolute right-drawer
          floating over a bg-black/40 click-away scrim, pinned to the right edge at EVERY width.
          calendar-event-detail-v1 (FR-002): it ALWAYS OVERLAYS the month grid — it never reserves
          a column or shrinks the grid; the grid keeps its FULL width and is simply covered on the
          right while open. Hoisted to the panel ROOT (the `relative` <section>, which is h-full)
          rather than nested in the content region, so the scrim + dock span the FULL viewport
          height of the whole panel — top to bottom — INDEPENDENT of the (now taller / variable)
          calendar grid's height. `genUiEvent` only ever sets while connected and resets on
          disconnect/reconnect/tab-switch (FR-014), so the dock is intrinsically gated to the
          connected state. Transient: X or scrim click clears it. */}
      {genUiEvent && (
        <>
          {/* Click-away scrim (glass-dock-v1): closes the dock on click. For the liquid-glass
              dock the scrim is FAINT — the old bg-black/40 darkened the very content the glass
              should reveal through its blur, so it drops to bg-black/15 (a gentle modal cue)
              that lets the frosted month grid read THROUGH the glass while still signalling the
              dock is modal/click-away. Always present. */}
          <div
            className="absolute inset-0 z-10 bg-black/15 transition-opacity duration-200"
            aria-hidden="true"
            onClick={closeDetail}
          />
          {/* glass-dock-v1: the drawer wears the reusable `glass-dock` material (translucent +
              backdrop-blur frosted glass) instead of the opaque bg-card. The inner EventDetail
              root is bg-transparent so this is the SINGLE fill (two stacked opaque surfaces
              would defeat the blur). The glass-dock utility supplies its own border color +
              depth/edge shadow, so we keep only the border-l side + the entry transition. */}
          <div className="glass-dock absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] translate-x-0 border-l transition-transform duration-200 ease-out motion-reduce:transition-none">
            <EventDetail
              event={genUiEvent}
              {...(activeLegend ? { calendars: activeLegend } : {})}
              onClose={closeDetail}
            />
          </div>
        </>
      )}
    </section>
  )
}
