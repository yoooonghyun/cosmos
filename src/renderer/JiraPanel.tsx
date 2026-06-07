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

import { useCallback, useEffect, useRef, useState } from 'react'
import { A2UIProvider, type A2UIAction } from '@a2ui-sdk/react/0.9'
import { ChevronLeft, Loader2, Search, SquareKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import type { FormEvent, KeyboardEvent } from 'react'
import { ConnectionStatus, ConnectForm } from './atlassianPanelBits'
import { jiraCatalog, JIRA_CATALOG_ID, JIRA_OPEN_DETAIL_ACTION } from './jiraCatalog'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { useTabShortcuts } from './useTabShortcuts'
import type { AgentStatusPayload } from '../shared/ipc'
import type { JiraConnectionStatus } from '../shared/jira'

/**
 * The my-tickets JQL — the native search box's placeholder AND the empty-submit fallback
 * (jira-jql-search-v1 FR-002/FR-005). Mirrors main's `JIRA_DEFAULT_VIEW_JQL`; main owns
 * the empty⇒default decision (this constant is only the placeholder so the box and the
 * fallback never drift visually). Renderer-local because main's constant isn't exported.
 */
const JIRA_DEFAULT_VIEW_JQL = 'assignee = currentUser() ORDER BY updated DESC'

/** A skeleton list shown while the per-switch default-view read is in flight (§5/§9.3). */
function DefaultViewSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton className="h-3 w-16" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * Bottom-docked Jira prompt composer (design §9.2). Reuses GeneratedUiPanel's composer
 * structure verbatim; submitting calls `onSubmit` (the panel hook owns the
 * originating-tab bookkeeping + agent.submit with target 'jira', D2). Enter submits,
 * Shift+Enter newlines, empty/whitespace starts no run (FR-003).
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
    // D2: the panel hook threads target: 'jira' so the run is granted the Jira render
    // tool and its surface lands back in the originating tab.
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
      aria-label="Ask about your Jira issues"
      onSubmit={handleSubmit}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={running}
        placeholder="Ask about your Jira issues…"
        aria-label="Ask about your Jira issues"
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

  const isConnected = status.state === 'connected'

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
    closeTab
  } = useGenerativePanelTabs({ target: 'jira', cancelOnClose: false })

  // jira-ticket-detail-v1 (FR-002/FR-004/FR-005): renderer-local navigation chrome over
  // the ACTIVE tab. `view` toggles the native back row (panel chrome OUTSIDE the A2UI host);
  // `originList` remembers which list the open detail came from so "back" re-runs the
  // originating read (FR-005). Both are reset to the list view whenever the active tab
  // changes so detail chrome never bleeds across tabs (FR-013 edge: detail bleed).
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'detail'; issueKey: string }>({
    kind: 'list'
  })
  const originListRef = useRef<{ kind: 'default' } | { kind: 'search'; jql: string }>({
    kind: 'default'
  })

  // jira-ticket-detail-v1: a minimum-duration skeleton floor for in-place navigation
  // (list⇄detail, JQL search). The per-tab `loadingDefault` flag already gates the
  // skeleton, but a warm detail/list read can resolve faster than one paint, so the
  // skeleton would never become visible. `navLoading` holds the skeleton up for a short
  // floor on every navigation so the transition always reads as "loading"; the real
  // read (via `loadingDefault`) keeps it up longer when it's slower.
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

  // Reset the detail chrome to the list view on a tab switch / new tab so an open detail's
  // back row does not bleed across tabs (FR-013 edge).
  useEffect(() => {
    setView({ kind: 'list' })
    originListRef.current = { kind: 'default' }
  }, [activeTabId])

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
  // or first show all resolve to "active tab has no surface, not loading, no error, list
  // view" → fire one `requestDefaultInActiveTab(requestDefaultView)`. That marks the tab
  // loadingDefault (its skeleton), so the condition immediately goes false and never loops;
  // search/detail reads also set loadingDefault, so they suppress this default load too.
  // Gated on `active` so a connected-but-hidden Jira panel does not eager-read.
  useEffect(() => {
    if (
      active &&
      isConnected &&
      view.kind === 'list' &&
      activeTab &&
      !activeTab.surface &&
      !activeTab.loadingDefault &&
      !activeTab.error
    ) {
      requestDefaultInActiveTab(() => window.cosmos.jira.requestDefaultView())
    }
  }, [active, isConnected, view.kind, activeTab, requestDefaultInActiveTab])

  // jira-ticket-detail-v1 (FR-001/FR-002/FR-009/FR-012): intercept the renderer-local
  // open-detail nav action a clicked TicketCard emits. Read its `issueKey`, flip to the
  // detail view (shows the back row immediately), and fire the deterministic detail read
  // through the in-place seam. Return TRUE so the action is NEVER forwarded to main or the
  // agent. ANY OTHER action (jira.transition/jira.comment writes) returns FALSE so it still
  // flows to main via ui:action (FR-012).
  const handleSurfaceAction = useCallback(
    (action: A2UIAction): boolean => {
      if (action.name !== JIRA_OPEN_DETAIL_ACTION) {
        return false
      }
      const ctx = (action.context ?? {}) as Record<string, unknown>
      const issueKey = typeof ctx.issueKey === 'string' ? ctx.issueKey : ''
      if (issueKey.trim().length > 0) {
        setView({ kind: 'detail', issueKey })
        beginNavLoad()
        requestDefaultInActiveTab(() => window.cosmos.jira.requestIssueDetail({ issueKey }))
      }
      return true
    },
    [requestDefaultInActiveTab, beginNavLoad]
  )

  // jira-ticket-detail-v1 (FR-004/FR-005): the native back row re-runs the originating read
  // — the last JQL search if the detail was opened from a search, else the default view
  // (also the fallback when no origin was captured). Then flip back to the list view.
  const goBackToList = useCallback(() => {
    const origin = originListRef.current
    setView({ kind: 'list' })
    beginNavLoad()
    if (origin.kind === 'search') {
      requestDefaultInActiveTab(() => window.cosmos.jira.requestSearchView({ jql: origin.jql }))
    } else {
      requestDefaultInActiveTab(() => window.cosmos.jira.requestDefaultView())
    }
  }, [requestDefaultInActiveTab, beginNavLoad])

  const stripTabs: PanelTab[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'generative' as const,
    status: t.inFlight ? 'in-flight' : t.error ? 'error' : 'idle',
    untitled: t.untitled,
    ...(t.error ? { errorMessage: t.error } : {})
  }))
  const activeStripTab = stripTabs.find((t) => t.id === activeTabId) ?? null

  // Tab keyboard shortcuts act on THIS strip only while the Jira surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: closeTab })

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
        onClose={closeTab}
        onNewTab={newTab}
        ariaLabel="Jira tabs"
      />

      {/* Connection-only chrome: the JQL search row + back row only make sense connected. */}
      {isConnected && (
        <JqlSearchBox
          onSubmit={(jql) => {
            // jira-ticket-detail-v1 (FR-005): a search submit makes the active list a SEARCH
            // origin (capturing the RAW text — main re-resolves empty⇒default on a back), and
            // returns to the list view so a stale detail's back row is dropped.
            originListRef.current = { kind: 'search', jql }
            setView({ kind: 'list' })
            beginNavLoad()
            requestDefaultInActiveTab(() => window.cosmos.jira.requestSearchView({ jql }))
          }}
        />
      )}

      {isConnected && view.kind === 'detail' && (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to list"
            onClick={goBackToList}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="truncate text-sm font-medium text-foreground">Back to list</span>
        </div>
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
          <div className="min-h-0 flex-1 p-3 text-card-foreground" role="tabpanel">
            {/* Per-tab loading skeleton: shown for the initial default-view read AND every
                in-place navigation read (list⇄detail, JQL search). While loadingDefault is
                set we hide the stale surface below and show the skeleton so a navigation
                always reads as "loading" instead of flashing the previous surface. */}
            {activeTab?.loadingDefault || navLoading ? (
              <DefaultViewSkeleton />
            ) : (
              <>
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
                    re-pushes a fresh surface that lands in the active tab (FR-020). */}
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
