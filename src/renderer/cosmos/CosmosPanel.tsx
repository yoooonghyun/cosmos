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

import { useEffect, useMemo, useRef, useState } from 'react'
import { PanelTabStrip, type PanelTab } from '../tabs/PanelTabStrip'
import { usePublishComposer } from '../composer/ActiveComposerProvider'
import { CosmosTimelineEntry } from './CosmosTimelineEntry'
import { reconcileTimeline, type LiveInFlight } from './cosmosConversation'
import { initialCosmosTabs, setActiveCosmosTab, closeCosmosTab } from './cosmosTabs'
import type { Conversation } from '../../shared/types/conversation'
import { buildAgentSubmitWithMarker } from '../../shared/promptContext/buildAgentSubmit'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import type {
  ConversationResult,
  UiRenderPayload,
  AgentStatusPayload
} from '../../shared/ipc'

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
  // The live in-flight run, reconciled with the transcript (FR-111). Null when idle.
  const [live, setLive] = useState<LiveInFlight>(null)
  // The last submitted prompt text, shown on the in-flight "generating" affordance.
  const lastPromptRef = useRef<string | undefined>(undefined)
  // cosmos-timeline-prompt-context-v1 (FR-024): the captured PromptContext for the last submit,
  // carried alongside lastPromptRef so the `agent:status 'started'` path re-seeds the live entry
  // with the SAME context the onSubmit seed used (no re-parse of its own marker).
  const lastPromptContextRef = useRef<PromptContext | undefined>(undefined)
  // A ref mirror of the tab state so onSubmit reads the CURRENT active tab without re-publishing
  // the composer config on every tab switch.
  const tabsStateRef = useRef(tabsState)
  tabsStateRef.current = tabsState
  const scrollRef = useRef<HTMLDivElement>(null)

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
      setRead(toReadState(result))
      // A completed run flushed into the transcript — the in-flight provisional entry is now
      // confirmed by the transcript, so clear the live state (FR-111: shown exactly once).
      setLive(null)
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
        promptText: lastPromptRef.current
      })
    })
    const offStatus = window.cosmos.agent.onStatus((status: AgentStatusPayload) => {
      if (status.state === 'started') {
        setLive({
          phase: 'generating',
          promptText: lastPromptRef.current,
          promptContext: lastPromptContextRef.current
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
        onSubmit: (utterance: string) => {
          // cosmos-timeline-prompt-context-v1 (FR-001/FR-006): the Cosmos panel + its active tab,
          // no dock (the Cosmos panel has no dock/selection). Captured ONCE and fed to the builder
          // (the marker) AND seeded into the live entry so the chip appears immediately on Enter.
          const ts = tabsStateRef.current
          const activeTab = ts.tabs.find((t) => t.id === ts.activeTabId)
          const promptContext: PromptContext = {
            panel: { id: 'cosmos', label: 'Cosmos' },
            ...(activeTab ? { tab: { id: activeTab.id, label: activeTab.label } } : {})
          }
          // Keep the RAW (marker-free) utterance for the live bubble text (FR-024).
          lastPromptRef.current = utterance
          lastPromptContextRef.current = promptContext
          // FR-113: a new in-flight turn appears immediately (the run's 'started' status will
          // also set this, but seeding here makes the prompt bubble appear on Enter).
          setLive({ phase: 'generating', promptText: utterance, promptContext })
          window.cosmos.agent.submit(
            buildAgentSubmitWithMarker(utterance, 'generated-ui', promptContext)
          )
        },
        placeholder: 'Describe the UI you want…',
        ariaLabel: 'Compose generated UI',
        busy: showSpinner
      }),
      [showSpinner]
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
      aria-label="Cosmos"
    >
      <PanelTabStrip
        tabs={stripTabs}
        activeTabId={tabsState.activeTabId}
        onActivate={(id) => setTabsState((s) => setActiveCosmosTab(s, id))}
        onClose={(id) => setTabsState((s) => closeCosmosTab(s, id))}
        ariaLabel="Cosmos tabs"
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-card-foreground"
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
