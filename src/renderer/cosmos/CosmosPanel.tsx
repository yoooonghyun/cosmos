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
import {
  usePublishComposer,
  useRecordSubmitContext,
  useLastSubmitContextRef
} from '../composer/ActiveComposerProvider'
import { CosmosTimelineEntry } from './CosmosTimelineEntry'
import { reconcileTimeline, type LiveInFlight } from './cosmosConversation'
import { initialCosmosTabs, setActiveCosmosTab, closeCosmosTab } from './cosmosTabs'
import { PanelTabTree } from './PanelTabTree'
import { panelTabChipFor } from './cosmosSelectedContext'
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
import { useEnabledIntegrations } from '../session/SessionProvider'
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
  // FR-114: the pinned-default tab state (purpose-built; NOT useGenerativePanelTabs).
  const [tabsState, setTabsState] = useState(initialCosmosTabs)

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

  // open-prompt-hoist-v1: publish this panel's composer under the RAIL id 'cosmos' so the
  // ONE App-level composer routes here. Submitting starts a default-agent run exactly as
  // today — the composer threads the wire target 'generated-ui' via the agent submit path
  // (FR-113); the step-2 persistent session is unchanged.
  const showSpinner = live?.phase === 'generating'
  usePublishComposer(
    'cosmos',
    useMemo(
      () => ({
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
      }),
      [showSpinner, recordSubmitContext, contextChip]
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

  // FR-114: the tab strip with the pinned default tab. PanelTabStrip renders a close `X`
  // only when `onClose` would act — the default tab is never closeable (closeCosmosTab is a
  // no-op for it), and we mark it via the strip's `closeable` discriminator below.
  const stripTabs: PanelTab[] = tabsState.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    kind: 'generative' as const,
    status: 'idle' as const,
    // The pinned default tab has NO close affordance (FR-114).
    closeable: t.kind !== 'default'
  }))

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

      {/* cosmos-panel-tab-list-v1 (design §1): the panel body is a horizontal SPLIT — the
          conversation timeline LEFT, the cross-panel `PanelTabTree` RIGHT, a `ResizeDivider`
          between. The docked Open-Prompt composer band (App-level, below this `<section>`) is
          unchanged (DESIGN.md D-3). Both columns are `min-h-0` so they scroll independently. */}
      <div ref={splitRowRef} className="flex min-h-0 flex-1 flex-row">
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
          <PanelTabTree groups={groups} selected={treeSelection} onActivate={handleActivateTab} />
        </aside>
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
