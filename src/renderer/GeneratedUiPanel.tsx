/**
 * GeneratedUiPanel — now TABBED (panel-tabs v1, Track B / Phase 6).
 *
 * The panel hosts an independent ordered set of VS Code-style tabs (FR-001). Each
 * tab owns its own A2UI surface; the panel mounts ONLY the active tab's
 * `<A2UIProvider>` + renderer subtree (inactive tabs keep their surface spec in hook
 * state, re-processed on switch — FR-003 — so we never mount N providers fighting
 * over the one `ui:render` channel). With zero tabs the panel shows its idle
 * placeholder (FR-018); the composer is always present (FR-016).
 *
 * The originating-tab correlation (FR-012/012a/013/014/015/027) lives in the shared
 * `useGenerativePanelTabs` hook; this component is chrome (strip + idle placeholder)
 * + composer. `cancelOnClose: true` because a `generated-ui` render_ui call BLOCKS
 * in main awaiting the user's action (CLAUDE.md), so closing its tab must cancel.
 *
 * Spec trace carried forward (render-ui-v1): FR-005 render spec, FR-006 send action,
 * FR-009 cancel (now via tab close), FR-012 requestId echo, SC-005 malformed → safe.
 */

import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { Loader2 } from 'lucide-react'
import type { AgentStatusPayload } from '../shared/ipc'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { useTabShortcuts } from './useTabShortcuts'

/**
 * Bottom-docked composer. Submitting calls `onSubmit(utterance)` (the panel hook owns
 * the originating-tab bookkeeping + agent.submit) and reflects app-wide run status.
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
      aria-label="Compose generated UI"
      onSubmit={handleSubmit}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={running}
        placeholder="Describe the UI you want…"
        aria-label="Describe the UI you want"
        className="max-h-[9rem] min-h-[2.5rem] resize-none"
      />
      {error && (
        <p
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
          role="alert"
        >
          Couldn&apos;t generate that UI: {error}
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

export function GeneratedUiPanel({ active }: { active: boolean }): React.JSX.Element {
  const { tabs, activeTabId, activeTab, setActive, submit, newTab, closeTab } =
    useGenerativePanelTabs({ target: 'generated-ui', cancelOnClose: true })

  // Tab keyboard shortcuts act on THIS strip only while the Generated UI surface is active.
  useTabShortcuts({ active, tabs, activeTabId, onActivate: setActive, onNewTab: newTab, onCloseTab: closeTab })

  // Always keep ≥1 tab (Terminal-unified layout): seed one on mount and reopen a fresh
  // tab if the collection ever empties, so the tab strip is never a zero-tab empty state.
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
    // newTab is stable; only react to the count reaching 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length])

  // The idle placeholder is the base shown not only at zero tabs but also whenever the
  // active tab has not composed a surface yet (a fresh `+` "Untitled" tab), so a new tab
  // lands on the same base screen instead of a blank panel.
  const showBase = !activeTab || (!activeTab.surface && !activeTab.error)

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
      aria-label="Generated UI"
    >
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={activeTabId}
        onActivate={setActive}
        onClose={closeTab}
        onNewTab={newTab}
        ariaLabel="Generated UI tabs"
      />

      <div className="min-h-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
        {showBase && (
          // FR-018: idle placeholder when zero tabs are open or the active tab is empty.
          <p className="text-[13px] text-muted-foreground">
            Describe a UI below and Claude will build it here.
          </p>
        )}
        {activeTab?.error && (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
            role="alert"
          >
            Could not generate that UI: {activeTab.error}
          </p>
        )}
        {/* Only the ACTIVE tab's provider is mounted; keyed by tab id so a switch
            remounts + re-processes that tab's stored surface (FR-003). */}
        {activeTab && (activeTab.surface || activeTab.error) && (
          <A2UIProvider key={activeTab.id}>
            <ActiveTabSurface
              surface={activeTab.surface}
              catalogId="standard"
              panelName="GeneratedUiPanel"
            />
          </A2UIProvider>
        )}
      </div>

      <PromptComposer onSubmit={submit} />
      <PanelFooter activeTab={activeStripTab} />
    </section>
  )
}
