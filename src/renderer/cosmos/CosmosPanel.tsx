/**
 * CosmosPanel — the default-session CONVERSATION TIMELINE (cosmos-conversation-panel-v2,
 * step 3). Supersedes the step-1 surface-per-tab placeholder.
 *
 * The panel renders the default agent's full conversation — read from its persistent
 * transcript jsonl in MAIN (the `transcriptReader`, confined to the one default-session
 * path) and delivered over the `conversation:*` IPC channel — as a scrollable timeline:
 * user prompt bubbles, assistant text, collapsible tool-call rows, and inline interactive
 * A2UI surfaces (FR-109/FR-110). It LIVE-updates as runs land (main re-reads + pushes on a
 * completed run, FR-107) and reconciles the live in-flight `ui:render` surface with the
 * transcript so a turn shows exactly once (no double-render, FR-111).
 *
 * IMPORTANT — rail id vs. wire target still diverge (carried from step 1; FR-117):
 *  - The RAIL `SurfaceId` is `'cosmos'` → `usePublishComposer('cosmos', …)` so the ONE
 *    App-level Open-Prompt composer routes here.
 *  - The WIRE `UiRenderTarget` stays `'generated-ui'` → the agent's `render_ui` frames land
 *    here and the persistent step-2 session path is unchanged. Do NOT "finish the rename".
 *
 * TAB MODEL (FR-114/FR-115/FR-116): the panel retires `useGenerativePanelTabs` for the
 * Cosmos surface in favor of a small purpose-built tab state (`cosmosTabs.ts`) with ONE
 * pinned, UNDELETABLE default tab. Future favorited tabs are appended additively (none built
 * in step 3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelTabStrip, type PanelTab } from '../tabs/PanelTabStrip'
import { useTabShortcuts } from '../tabs/useTabShortcuts'
import {
  usePublishComposer,
  useRecordSubmitContext,
  useLastSubmitContextRef,
  useActiveComposerConfig
} from '../composer/ActiveComposerProvider'
import { PromptComposer } from '../composer/PromptComposer'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { CosmosTimelineEntry } from './CosmosTimelineEntry'
import { reconcileTimeline, type LiveInFlight } from './cosmosConversation'
import {
  initialCosmosTabs,
  setActiveCosmosTab,
  closeCosmosTab,
  appendFavorite,
  favoriteId,
  isPinned
} from './cosmosTabs'
import {
  reconcileFavorites,
  toFavoriteStripTab,
  toHomeFavorites,
  favoritesToTabs
} from './homeFavorites'
import { FavoriteSurface } from './FavoriteSurface'
import { PanelTabTree } from './PanelTabTree'
import { panelTabChipFor } from './cosmosSelectedContext'
import { SURFACE_ICON } from '../app/surfaceIcons'
// Import the divider from its OWN module, not the `../fileExplorer` barrel — the barrel re-exports
// the Monaco-backed FileViewer, which crashes jsdom on import (queryCommandSupported). The divider
// is a self-contained pointer/keyboard handle.
import { ResizeDivider } from '../fileExplorer/ResizeDivider'
import {
  useAllPanelTabs,
  toPanelTabGroups,
  reconcileSelectedContext,
  type CrossPanelId,
  type LivePanelTab,
  type PanelTabGroup
} from '../panelTabs'
import { RAIL_LABEL, visibleSurfaceIds } from '../app/railVisibility'
import {
  useEnabledIntegrations,
  useRestoredFavorites,
  useSessionRegistry
} from '../session/SessionProvider'
import type { Conversation } from '../../shared/types/conversation'
import { buildAgentSubmitWithMarker } from '../../shared/promptContext/buildAgentSubmit'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import type {
  ConversationResult,
  UiRenderPayload,
  AgentStatusPayload
} from '../../shared/ipc'

/** Column minimums for the timeline | tree split (design §1.2). Session-only width, NOT persisted. */
const TIMELINE_MIN = 360
const TREE_MIN = 240

/** The four read states the panel presents (FR-112). */
type ReadState =
  | { phase: 'loading' }
  | { phase: 'empty' }
  | { phase: 'error' }
  | { phase: 'populated'; conversation: Conversation }

/** Map a `ConversationResult` to a read state (FR-108/FR-112). */
function toReadState(result: ConversationResult): ReadState {
  if (result.ok) {
    return result.conversation.state === 'empty'
      ? { phase: 'empty' }
      : { phase: 'populated', conversation: result.conversation }
  }
  return result.reason === 'empty' ? { phase: 'empty' } : { phase: 'error' }
}

export function CosmosPanel({ active }: { active: boolean }): React.JSX.Element {
  // cosmos-home-favorite-tabs-v1 (FR-030): the restored favorites seed the tab state ONCE on mount
  // (re-bound to live source tabs by their stable ids as panels restore). The pinned default tab is
  // always first + active; favorites are appended in pinned order.
  const restoredFavorites = useRestoredFavorites()
  // FR-114: the pinned-default tab state (purpose-built; NOT useGenerativePanelTabs).
  const [tabsState, setTabsState] = useState(() => {
    const base = initialCosmosTabs()
    const favTabs = favoritesToTabs(restoredFavorites ?? [])
    return favTabs.length > 0 ? { ...base, tabs: [...base.tabs, ...favTabs] } : base
  })

  // The transcript-sourced conversation read state (FR-112).
  const [read, setRead] = useState<ReadState>({ phase: 'loading' })
  // cosmos-streaming-duplicate-context-chip-v1: a ref mirror of `read` so the STABLE seed callbacks
  // (the `agent:status 'started'` effect with `[]` deps + the memoized `onSubmit`) capture the
  // CURRENT transcript turn count at submit/started time, not a stale closure. `liveBaseline()`
  // reads it to stamp `baseline` onto each new live entry (the count before this run grows the
  // transcript), so the provisional prompt bubble/chip is suppressed once the run streams.
  const readRef = useRef(read)
  readRef.current = read
  // The live in-flight run, reconciled with the transcript (FR-111). Null when idle.
  const [live, setLive] = useState<LiveInFlight>(null)
  // The last submitted prompt text, shown on the in-flight "generating" affordance.
  const lastPromptRef = useRef<string | undefined>(undefined)
  // cosmos-context-chip-crosspanel-and-historical-v1 (#2): the captured PromptContext for the last
  // submit now lives in the App-root ActiveComposerProvider, written by EVERY Open-Prompt submit
  // site (cosmos here AND useGenerativePanelTabs for Jira/Slack/Confluence/Calendar). The
  // `agent:status 'started'` seed reads `lastSubmitContextRef.current` so the in-flight chip
  // reflects the ACTUAL submitting panel — not a cosmos-only default that ignored cross-panel runs.
  const recordSubmitContext = useRecordSubmitContext()
  const lastSubmitContextRef = useLastSubmitContextRef()
  // A ref mirror of the tab state so onSubmit reads the CURRENT active tab without re-publishing
  // the composer config on every tab switch.
  const tabsStateRef = useRef(tabsState)
  tabsStateRef.current = tabsState
  const scrollRef = useRef<HTMLDivElement>(null)

  // cosmos-home-keyboard-tab-nav-v1 (FR-001..FR-006/FR-014): Home participates in the SHARED global
  // tab-cycle shortcuts (tab:next/prev = Ctrl+Tab / Cmd+Opt+Arrow; tab:jump = mod+1..8; tab:last =
  // mod+9), gated on the `active` rail-surface prop, cycling `cosmosTabs` order (default first, then
  // favorites in pin order, wrap-around) via the SAME pure `setActiveCosmosTab` op the strip uses — no
  // parallel nav helper (the hook owns the wrap/jump math). `onNewTab`/`onCloseTab` are OMITTED so
  // tab:new (Q5) and tab:close (Q4) are structural no-ops in Home. The roving strip-focus arrow nav on
  // PanelTabStrip stays intact (additive). FR-008 (no stray char in a focused composer) is guaranteed
  // by main-side preventDefault (§4.12) — main consumes the keystroke before the DOM sees it.
  useTabShortcuts({
    active,
    tabs: tabsState.tabs,
    activeTabId: tabsState.activeTabId,
    onActivate: (id) => setTabsState((s) => setActiveCosmosTab(s, id))
  })

  // cosmos-panel-tab-list-v1: the timeline | tree split. Session-only width (mirrors the Terminal
  // split's renderer-local `treeWidth`; NOT persisted — OQ-1 resolved). The row owns the clamp.
  const splitRowRef = useRef<HTMLDivElement>(null)
  const [treeWidth, setTreeWidth] = useState<number | null>(null)

  // The live cross-panel tab registry → ordered groups (FR-005/FR-006). The group order is the rail
  // order minus cosmos, filtered to the VISIBLE surfaces so a disabled integration is absent (FR-006,
  // matching rail visibility — disabled panels stay mounted + still publish, so we gate by visibility
  // here rather than on publish).
  const { enabled } = useEnabledIntegrations()
  const order = useMemo<CrossPanelId[]>(
    () =>
      visibleSurfaceIds(enabled).filter((id): id is CrossPanelId => id !== 'cosmos'),
    [enabled]
  )
  const registry = useAllPanelTabs()
  const groups = useMemo<PanelTabGroup[]>(
    () => toPanelTabGroups(registry, order, RAIL_LABEL),
    [registry, order]
  )

  // The one-shot tree-click selection (FR-016): the panel + tab attached to the NEXT prompt. Mirror
  // it in a ref for stale-free reads inside the (stable) submit handler.
  const [selectedContext, setSelectedContext] = useState<PromptContext | null>(null)
  const selectedContextRef = useRef<PromptContext | null>(selectedContext)
  selectedContextRef.current = selectedContext

  // FR-017: keep the selection honest as tabs close/rename — a closed selected tab clears, a renamed
  // one relabels. `reconcileSelectedContext` returns the SAME reference when nothing changed, so this
  // is a no-op render unless the live groups actually invalidate the selection.
  useEffect(() => {
    setSelectedContext((prev) => reconcileSelectedContext(prev, groups))
  }, [groups])

  // cosmos-home-favorite-tabs-v1 (FR-041): keep each favorite's label honest as its source tab
  // renames; KEEP a favorite whose source closed (graceful degrade — never auto-dropped, FR-031).
  // `reconcileFavorites` returns the SAME state reference when nothing changed (no-op render).
  useEffect(() => {
    setTabsState((prev) => reconcileFavorites(prev, groups))
  }, [groups])

  // FR-030: report the favorites list to the debounced save coordinator on every change (the NON-panel
  // path, mirrors openPromptPosition). Non-secret references only — never an A2UI surface (FR-023).
  const sessionRegistry = useSessionRegistry()
  useEffect(() => {
    sessionRegistry.setFavorites(toHomeFavorites(tabsState))
  }, [tabsState, sessionRegistry])

  // FR-001/FR-010: pin a source tab as a favorite (idempotent/de-duped) WITHOUT activating it —
  // pinning is non-disruptive, the user stays on the current tab (the favorite just appears in the
  // strip). cosmos-terminal-favorite-multiplex-v1: terminal IS pinnable now (FR-040 relaxed), so the
  // terminal early-return is gone — `group.panelId` (CrossPanelId) is a valid FavoritePanelId.
  const handlePin = useCallback((group: PanelTabGroup, tab: LivePanelTab): void => {
    const source = { panelId: group.panelId, tabId: tab.id }
    setTabsState((s) => appendFavorite(s, { source, label: tab.label }))
  }, [])

  // FR-004: unpin a source tab's favorite (from the tree's Unpin menu); active favorite → default.
  const handleUnpin = useCallback((group: PanelTabGroup, tab: LivePanelTab): void => {
    const id = favoriteId({ panelId: group.panelId, tabId: tab.id })
    setTabsState((s) => closeCosmosTab(s, id))
  }, [])

  // FR-002: drives the tree row menu's Pin vs Unpin (terminal included now).
  const isSourcePinned = useCallback(
    (panelId: CrossPanelId, tabId: string): boolean => isPinned(tabsState, { panelId, tabId }),
    [tabsState]
  )

  // The tree's selection marker (panel id + tab id) derived from the selected context.
  const treeSelection = useMemo(
    () =>
      selectedContext?.tab
        ? { panelId: selectedContext.panel.id, tabId: selectedContext.tab.id }
        : null,
    [selectedContext]
  )

  // A tree row click selects that panel + tab as the next prompt's context (FR-012/FR-013/FR-018:
  // panel + tab only, no dock). Re-selecting REPLACES (FR-016).
  const handleActivateTab = useCallback((group: PanelTabGroup, tab: LivePanelTab): void => {
    setSelectedContext({
      panel: { id: group.panelId, label: group.label },
      tab: { id: tab.id, label: tab.label }
    })
  }, [])

  // The docked composer's context chip: the `kind: 'panel-tab'` breadcrumb when a tab is selected,
  // else undefined (the Cosmos panel has no dock-item chip of its own).
  const contextChip = useMemo(() => panelTabChipFor(selectedContext), [selectedContext])

  // Divider drag: a POSITIVE (rightward) drag SHRINKS the tree (mirror the Terminal viewer|tree
  // divider), clamped so neither column drops below its min (design §1.2). No xterm here, so no
  // re-fit — simpler than the Terminal handler.
  const handleTreeResize = useCallback((deltaPx: number): void => {
    const row = splitRowRef.current
    if (!row) {
      return
    }
    const total = row.clientWidth
    setTreeWidth((current) => {
      // Default ratio mirrors the Terminal file-explorer tree dock (`flex: 0 0 18%`) per user
      // request, not the design's 30% — keep the two cross-panel trees the same default width.
      const base = current ?? total * 0.18
      const max = total - TIMELINE_MIN
      return Math.max(TREE_MIN, Math.min(max, base - deltaPx))
    })
  }, [])

  // FR-106: fetch the full default-session conversation on mount; subscribe to live pushes
  // (main re-reads + pushes on a completed run — FR-107). `window.cosmos.conversation` is a
  // NEW preload surface (full `npm run dev` restart required); guard it so an un-restarted
  // dev session degrades to the empty state instead of throwing.
  useEffect(() => {
    const conversation = window.cosmos.conversation
    if (!conversation) {
      setRead({ phase: 'empty' })
      return
    }
    let disposed = false
    conversation
      .getDefault()
      .then((result) => {
        if (!disposed) {
          setRead(toReadState(result))
        }
      })
      .catch(() => {
        if (!disposed) {
          setRead({ phase: 'error' })
        }
      })
    const off = conversation.onUpdate((result) => {
      // cosmos-agent-progress-not-streaming-v1: an `conversation:update` now arrives INCREMENTALLY
      // while a run is in flight (main polls the transcript as it grows), not only on completion.
      // So a mid-run update must NOT clear `live` — clearing here would kill the TypingIndicator on
      // every streamed step. Only `agent:status 'completed'`/'error' clears `live` (see the status
      // effect below); an incremental update just refreshes `read`, so reconcileTimeline shows
      // [turns-so-far] + the live spinner at the tail. The reconcile suppresses the provisional
      // prompt bubble + the live surface once the transcript carries them, so each turn still
      // renders exactly once (FR-111: no double-render).
      setRead(toReadState(result))
    })
    return () => {
      disposed = true
      off()
    }
  }, [])

  // FR-111: track the LIVE in-flight run. A `ui:render` for the wire target 'generated-ui'
  // is the in-flight surface (authoritative until the transcript confirms it); an
  // `agent:status` 'started' opens a "generating" affordance, 'completed'/'error' clears it
  // (the transcript re-read on completion supplies the final turn).
  useEffect(() => {
    const offRender = window.cosmos.ui.onRender((payload: UiRenderPayload) => {
      if (payload.target !== 'generated-ui') {
        return
      }
      setLive({
        phase: 'surface',
        requestId: payload.requestId,
        spec: payload.spec,
        promptText: lastPromptRef.current,
        // Carry the run-start transcript count through so a live surface after streaming never
        // reintroduces the provisional bubble (cosmos-streaming-duplicate-context-chip-v1).
        baseline:
          readRef.current.phase === 'populated' ? readRef.current.conversation.turns.length : 0
      })
    })
    const offStatus = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      if (status.state === 'started') {
        setLive({
          phase: 'generating',
          promptText: lastPromptRef.current,
          // #2: read the App-root shared ref so the live chip reflects the ACTUAL submitting panel
          // (a Jira/Slack/etc submit writes it via useGenerativePanelTabs; a cosmos submit via the
          // onSubmit below). The cosmos-only `lastPromptContextRef` could not see cross-panel runs.
          promptContext: lastSubmitContextRef.current,
          // cosmos-streaming-duplicate-context-chip-v1: capture the transcript turn count at run
          // start (per run — this re-seeds on every 'started'), so reconcileTimeline suppresses the
          // provisional bubble/chip once the transcript grows past it (handles the cross-panel run
          // whose promptText is undefined — the empty context-only bubble bug).
          baseline:
            readRef.current.phase === 'populated' ? readRef.current.conversation.turns.length : 0
        })
      } else {
        // completed / error: clear the in-flight affordance. On completed, the
        // conversation:update re-read also clears it (idempotent).
        setLive(null)
      }
    })
    return () => {
      offRender()
      offStatus()
    }
  }, [])

  // cosmos-home-favorite-tabs-v1 (FR-020/FR-021): the active tab decides Home's content + composer.
  // The default tab shows the conversation timeline + the docked Cosmos composer; a FAVORITE tab is a
  // full-width live mirror of its source panel+tab — INCLUDING the source's own floating Open Prompt,
  // which submits to the SOURCE target (jira/slack/…), not the Cosmos conversation. So on a favorite
  // tab Home HIDES its docked composer (publishes a null 'cosmos' config) and renders the SOURCE's
  // already-published composer config (read by key from the shared registry) as a floating composer.
  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeTabId)
  const activeFavoriteSource =
    activeTab?.kind === 'favorite' && activeTab.source ? activeTab.source : null
  // The source panel's published composer wiring (it publishes unconditionally while connected, so it
  // is in the registry even though Home — not the source — is the active rail surface). Read by key;
  // the fallback key when no favorite is active is harmless (its result is only used when a favorite is).
  const favoriteComposerConfig = useActiveComposerConfig(activeFavoriteSource?.panelId ?? 'cosmos')

  // open-prompt-hoist-v1: publish this panel's composer under the RAIL id 'cosmos' so the
  // ONE App-level composer routes here. Submitting starts a default-agent run exactly as
  // today — the composer threads the wire target 'generated-ui' via the agent submit path
  // (FR-113); the step-2 persistent session is unchanged. cosmos-home-favorite-tabs-v1: publish
  // `null` while a favorite tab is active so the docked Cosmos composer (+ its footer) hides — the
  // favorite shows the SOURCE's floating composer instead (rendered below).
  const showSpinner = live?.phase === 'generating'
  const favoriteActive = activeFavoriteSource !== null
  usePublishComposer(
    'cosmos',
    useMemo(
      () =>
        favoriteActive
          ? null
          : {
        onSubmit: (utterance: string, options?: { contextDismiss: 'none' | 'thread' | 'all' }) => {
          // cosmos-panel-tab-list-v1 (FR-015/FR-016): if a tree row is selected, the captured
          // PromptContext is that SELECTED panel + tab (no dock — FR-018); dismissing the chip
          // (`contextDismiss:'all'`) drops it; otherwise it is the Cosmos panel + its active tab
          // (cosmos-timeline-prompt-context-v1 default). Captured ONCE and fed to the builder (the
          // marker) AND seeded into the live entry so the chip appears immediately on Enter. The
          // wire target stays 'generated-ui' regardless of which panel the context names (FR-015).
          const dismissed = options?.contextDismiss === 'all'
          const selected = dismissed ? null : selectedContextRef.current
          let promptContext: PromptContext
          if (selected) {
            promptContext = selected
          } else {
            const ts = tabsStateRef.current
            const activeTab = ts.tabs.find((t) => t.id === ts.activeTabId)
            promptContext = {
              panel: { id: 'cosmos', label: RAIL_LABEL.cosmos },
              ...(activeTab ? { tab: { id: activeTab.id, label: activeTab.label } } : {})
            }
          }
          // Keep the RAW (marker-free) utterance for the live bubble text (FR-024).
          lastPromptRef.current = utterance
          // #2: publish this submit's context into the App-root shared ref so the
          // `agent:status 'started'` seed reads the SAME context (matches the cross-panel path).
          recordSubmitContext(promptContext)
          // FR-113: a new in-flight turn appears immediately (the run's 'started' status will
          // also set this, but seeding here makes the prompt bubble appear on Enter).
          // cosmos-streaming-duplicate-context-chip-v1: stamp the run-start transcript count so the
          // provisional is suppressed once the transcript grows past it (per run).
          setLive({
            phase: 'generating',
            promptText: utterance,
            promptContext,
            baseline:
              readRef.current.phase === 'populated' ? readRef.current.conversation.turns.length : 0
          })
          window.cosmos.agent.submit(
            buildAgentSubmitWithMarker(utterance, 'generated-ui', promptContext)
          )
          // One-shot (OQ-2 resolved): clear the tree selection after a submit so the chip
          // disappears for the next compose (a fresh compose, matching the view-context chip).
          setSelectedContext(null)
        },
              placeholder: 'Describe the UI you want…',
              ariaLabel: 'Compose generated UI',
              contextChip,
              busy: showSpinner
            },
      [favoriteActive, showSpinner, recordSubmitContext, contextChip]
    )
  )

  // The reconciled timeline (FR-111): transcript turns + the live in-flight entry, once.
  const timeline = useMemo(() => {
    const turns = read.phase === 'populated' ? read.conversation.turns : []
    return reconcileTimeline(turns, live)
  }, [read, live])

  // Auto-scroll to the newest turn as the timeline grows.
  useEffect(() => {
    if (active && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [timeline.length, active])

  // FR-114/FR-014: the tab strip — the pinned default tab (no close `X`) then favorites appended in
  // pin order, each carrying its source panel glyph + a right-click Unpin menu (the close `X` unpins
  // too). PanelTabStrip renders a close `X` only when `closeable` is not false.
  const stripTabs: PanelTab[] = tabsState.tabs.map((t) => {
    if (t.kind === 'favorite' && t.source) {
      const favId = t.id
      return toFavoriteStripTab(t, SURFACE_ICON[t.source.panelId], (trigger) => (
        <ContextMenu>
          <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => setTabsState((s) => closeCosmosTab(s, favId))}>
              Unpin
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))
    }
    return {
      id: t.id,
      label: t.label,
      kind: 'generative' as const,
      status: 'idle' as const,
      // The pinned default tab has NO close affordance (FR-114).
      closeable: t.kind !== 'default',
      // cosmos-home-keyboard-tab-nav-v1 (Task B): the pinned default "Cosmos" tab carries the SAME
      // rail Cosmos glyph (SURFACE_ICON.cosmos, D-10) as a leading mark — favorites already show their
      // source glyph, so without this the default tab read glyphless + (with no `X`) visually cramped.
      icon: SURFACE_ICON.cosmos
    }
  })

  const hasLiveOrTurns = timeline.length > 0

  return (
    <section
      className="flex h-full min-w-0 flex-col border-l border-border bg-card"
      aria-label={RAIL_LABEL.cosmos}
    >
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={tabsState.activeTabId}
        onActivate={(id) => setTabsState((s) => setActiveCosmosTab(s, id))}
        onClose={(id) => setTabsState((s) => closeCosmosTab(s, id))}
        ariaLabel="Cosmos tabs"
      />

      {/* cosmos-panel-tab-list-v1 (design §1) + cosmos-home-favorite-tabs-v1: on the DEFAULT tab the
          body is a horizontal SPLIT — the conversation timeline LEFT, the cross-panel `PanelTabTree`
          RIGHT, a `ResizeDivider` between — with the docked Open-Prompt composer band below (App-level
          `SharedComposer`). On a FAVORITE tab the body is a SINGLE FULL-WIDTH pane: the source tab's
          live surface mirror — NO tree, NO divider — overlaid with the SOURCE panel's own floating
          Open Prompt (which submits to the SOURCE target, not the Cosmos conversation; the docked
          Cosmos composer is hidden by publishing a null 'cosmos' config above). `relative` anchors the
          floating composer overlay. */}
      <div ref={splitRowRef} className="relative flex min-h-0 flex-1 flex-row">
        {activeFavoriteSource ? (
          // FR-020: a favorite tab is a full-width live mirror of its source tab's surface.
          <FavoriteSurface
            source={activeFavoriteSource}
            onUnpin={() => setTabsState((s) => closeCosmosTab(s, tabsState.activeTabId))}
          />
        ) : (
          <>
            <div
              ref={scrollRef}
              className="min-h-0 min-w-0 flex-1 space-y-3 overflow-auto p-3 text-card-foreground"
              role="tabpanel"
            >
              {read.phase === 'loading' && (
                <p className="text-[13px] text-muted-foreground">Loading conversation…</p>
              )}
              {read.phase === 'error' && (
                <p
                  className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
                  role="alert"
                >
                  Could not read the conversation transcript. You can still describe a UI below.
                </p>
              )}
              {(read.phase === 'empty' || read.phase === 'populated') &&
                !hasLiveOrTurns && (
                  <p className="text-[13px] text-muted-foreground">
                    Describe a UI below and Claude will build it here — your conversation will appear in
                    this timeline.
                  </p>
                )}
              {timeline.map((entry, i) => (
                <CosmosTimelineEntry key={entryKey(entry, i)} entry={entry} />
              ))}
            </div>

            <ResizeDivider onResize={handleTreeResize} ariaLabel="Resize timeline and panel tabs" />

            <aside
              className="flex min-h-0 flex-col border-l border-border"
              style={treeWidth !== null ? { flex: `0 0 ${treeWidth}px` } : { flex: '0 0 30%' }}
              aria-label="Open panel tabs"
            >
              <PanelTabTree
                groups={groups}
                selected={treeSelection}
                onActivate={handleActivateTab}
                isPinned={isSourcePinned}
                onPin={handlePin}
                onUnpin={handleUnpin}
              />
            </aside>
          </>
        )}

        {/* cosmos-home-favorite-tabs-v1 (FR — favorite shows the source view "as-is" incl. its Open
            Prompt): the SOURCE panel's already-published floating composer, surfaced over the Home
            favorite pane. Its `onSubmit` is the source panel's own — so a submit routes to the SOURCE
            target (jira/slack/confluence/google-calendar) and lands in the source tab, which this
            favorite mirrors. Reuses the shared `PromptComposer` (floating) — no new contract. */}
        {activeFavoriteSource && favoriteComposerConfig && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
            <PromptComposer
              mode="floating"
              onSubmit={favoriteComposerConfig.onSubmit}
              placeholder={favoriteComposerConfig.placeholder}
              ariaLabel={favoriteComposerConfig.ariaLabel}
              {...(favoriteComposerConfig.contextChip
                ? { contextChip: favoriteComposerConfig.contextChip }
                : {})}
              busy={favoriteComposerConfig.busy ?? false}
            />
          </div>
        )}
      </div>

      {/* cosmos-open-prompt-pinned-v1 (design §1.3): the bottom chrome of the Cosmos panel is
          now the DOCKED Open-Prompt composer band (hosted in `SharedComposer` as the last flex
          child of the surface column, below this `<section>`). It supersedes the `PanelFooter`
          slot here, so the panel does not show a status strip ABOVE the docked input — the
          timeline `overflow-auto` region flexes to fill all remaining height, the docked
          composer is `shrink-0` directly beneath it. The other four panels keep `PanelFooter`. */}
    </section>
  )
}

/** A stable-ish key for a timeline entry (turn id, or a synthetic live key). */
function entryKey(entry: ReturnType<typeof reconcileTimeline>[number], index: number): string {
  if (entry.kind === 'turn') {
    return entry.turn.id
  }
  if (entry.kind === 'live-surface') {
    return `live-surface:${entry.requestId}`
  }
  return `live-generating:${index}`
}
