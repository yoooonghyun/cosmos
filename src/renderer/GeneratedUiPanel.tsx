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

import { useEffect } from 'react'
import { A2UIProvider } from '@a2ui-sdk/react/0.9'
import { Sparkles } from 'lucide-react'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { PanelRefreshButton } from './PanelRefreshButton'
import { panelRefreshInputsFor } from './panelRefreshLogic'
import { PanelFooter } from './PanelFooter'
import { ActiveTabSurface } from './ActiveTabSurface'
import { PromptComposer } from './PromptComposer'
import { SurfaceSpinner } from './SurfaceSpinner'
import { useGenerativePanelTabs } from './useGenerativePanelTabs'
import { surfaceSpinnerVisible } from './promptComposerLogic'
import { useTabShortcuts } from './useTabShortcuts'
import { useRestoredGenerativePanel } from './SessionProvider'

export function GeneratedUiPanel({ active }: { active: boolean }): React.JSX.Element {
  const restored = useRestoredGenerativePanel('generated-ui')
  const { tabs, activeTabId, activeTab, setActive, submit, newTab, closeTab, update } =
    useGenerativePanelTabs({
      target: 'generated-ui',
      panelName: 'Generated UI',
      cancelOnClose: true,
      ...(restored ? { initial: restored } : {})
    })

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

  // The surface send-spinner gate, scoped to the ACTIVE tab (composer-send-animation-v1
  // FR-005/FR-008): in-flight without a landed surface/error → show the spinner.
  const showSpinner = !!activeTab &&
    surfaceSpinnerVisible({
      inFlight: activeTab.inFlight,
      hasSurface: activeTab.surface != null,
      hasError: activeTab.error != null,
      loadingDefault: activeTab.loadingDefault
    })

  const stripTabs: PanelTab[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'generative' as const,
    status: t.inFlight ? 'in-flight' : t.error ? 'error' : 'idle',
    untitled: t.untitled,
    ...(t.error ? { errorMessage: t.error } : {})
  }))

  const activeStripTab = stripTabs.find((t) => t.id === activeTabId) ?? null
  // panel-refresh-v1 (Goal 1): the shared refresh control, fed the active tab's surface
  // slice. A generated-UI surface composed without a descriptor derives to disabled (OQ-2).
  const refreshInputs = panelRefreshInputsFor(activeTab)

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
        onRename={(id, label) => update(id, { label, renamed: true, untitled: false })}
        trailing={
          <PanelRefreshButton
            activeTab={refreshInputs.activeTab}
            requestId={refreshInputs.requestId}
          />
        }
        ariaLabel="Generated UI tabs"
      />

      <div className="min-h-0 flex-1 overflow-auto p-3 text-card-foreground" role="tabpanel">
        {/* Surface send-spinner: the busy state of this region while a submitted run is in
            flight, until its surface lands (composer-send-animation-v1 FR-005/FR-006). */}
        {showSpinner && <SurfaceSpinner />}
        {showBase && !showSpinner && (
          // FR-018: idle placeholder when zero tabs are open or the active tab is empty.
          // Suppressed while the send-spinner shows so the two never co-render.
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

      <PromptComposer
        onSubmit={submit}
        placeholder="Describe the UI you want…"
        ariaLabel="Compose generated UI"
        busy={showSpinner}
      />
      <PanelFooter surfaceName="Generated UI" icon={Sparkles} activeTab={activeStripTab} />
    </section>
  )
}
