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

import { useEffect, useRef, useState } from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { Loader2, SquareKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import type { FormEvent, KeyboardEvent } from 'react'
import { ConnectionBar, ConnectForm } from './atlassianPanelBits'
import { jiraCatalog, JIRA_CATALOG_ID } from './jiraCatalog'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { ActiveTabSurface } from './ActiveTabSurface'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import type { AgentStatusPayload } from '../shared/ipc'
import type { JiraConnectionStatus } from '../shared/jira'

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

/** The connected body: the tab strip + per-tab A2UI host + composer + per-switch
 * default refresh (§9, panel-tabs v1 Phase 6). */
function ConnectedBody({ active }: { active: boolean }): React.JSX.Element {
  // panel-tabs v1: Jira tabs reuse the shared correlation. cancelOnClose=false because
  // jira.* actions are dispatched deterministically by main (never the blocking render
  // call's answer), so closing a tab needs no cancel. new-tab-base-view-v1: the per-tab
  // default-view loading state + fire-or-defer of `requestDefaultView` live in the shared
  // hook (`newTabWithDefault`), NOT as panel-wide flags here.
  const { tabs, activeTabId, activeTab, setActive, submit, newTabWithDefault, closeTab } =
    useGenerativePanelTabs({ target: 'jira', cancelOnClose: false })

  // Track the prior `active` so we only act on the false->true edge.
  const wasActiveRef = useRef(false)
  // Mirror of tab presence so the activation effect (which only depends on `active`)
  // can read it without going stale across switches.
  const hasTabsRef = useRef(false)
  hasTabsRef.current = tabs.length > 0
  // Latest newTabWithDefault, read inside the activation effect without re-running it
  // on every render (the callback identity changes when `open` would, but `open` is
  // stable; this keeps the effect keyed purely on `active`).
  const newTabWithDefaultRef = useRef(newTabWithDefault)
  newTabWithDefaultRef.current = newTabWithDefault

  useEffect(() => {
    // FR-002/FR-019 + new-tab-base-view-v1 FR-007: load the default view only on the
    // FIRST show with no tab yet. `newTabWithDefault` opens a fresh tab (loadingDefault)
    // and fires-or-defers `requestDefaultView`; the default board arrives as an
    // unsolicited 'jira' frame the shared hook files into the (now active) tab and
    // clears its skeleton. Once a tab exists, keep it across rail switches — do NOT
    // re-request the default view.
    if (active && !wasActiveRef.current && !hasTabsRef.current) {
      newTabWithDefaultRef.current(() => window.cosmos.jira.requestDefaultView())
    }
    wasActiveRef.current = active
    // reads go through refs; keyed purely on `active`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div className="flex h-full flex-col">
      <PanelTabStrip
        tabs={tabs.map(
          (t): PanelTab => ({
            id: t.id,
            label: t.label,
            kind: 'generative',
            status: t.inFlight ? 'in-flight' : t.error ? 'error' : 'idle',
            untitled: t.untitled,
            ...(t.error ? { errorMessage: t.error } : {})
          })
        )}
        activeTabId={activeTabId}
        onActivate={setActive}
        onClose={closeTab}
        onNewTab={() => newTabWithDefault(() => window.cosmos.jira.requestDefaultView())}
        ariaLabel="Jira tabs"
      />

      <div className="min-h-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
        {/* Per-tab default-view loading skeleton (FR-008/FR-009): shown only while THIS
            tab's default-view read is outstanding and before its surface lands. */}
        {activeTab?.loadingDefault && !activeTab.surface && <DefaultViewSkeleton />}
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
            />
          </A2UIProvider>
        )}
      </div>
      <PromptComposer onSubmit={submit} />
    </div>
  )
}

/* ------------------------------------------------------------------------- *
 * The panel
 * ------------------------------------------------------------------------- */

export function JiraPanel({ active }: { active: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<JiraConnectionStatus>({ state: 'not_connected' })
  const [busy, setBusy] = useState(false)

  // Initial status + live updates (FR-A12). A reconnect_needed flows here, so the
  // body routes to the native Connect/Reconnect affordance (FR-016).
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

  return (
    <section
      className="flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label="Jira"
    >
      <div className="flex select-none items-center border-b border-border bg-popover px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">Jira</span>
      </div>

      <ConnectionBar status={status} onDisconnect={() => void disconnect()} />

      <div className="min-h-0 flex-1">
        {!isConnected ? (
          // FR-016: not-connected / reconnect_needed -> the existing native Connect
          // affordance. No A2UI host, no composer, no per-switch read.
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
          <ConnectedBody active={active} />
        )}
      </div>
    </section>
  )
}
