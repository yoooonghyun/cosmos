/**
 * DOM test (jsdom, vitest.dom.config.ts) for
 * `cosmos-context-chip-crosspanel-and-historical-v1` (#2 — the REAL bug).
 *
 * The bug: the Cosmos timeline's LIVE in-flight chip ALWAYS showed "Cosmos > conversation",
 * no matter which panel the prompt was submitted from. A submit from Jira/Slack/Confluence/
 * Calendar goes through `useGenerativePanelTabs.submit`, which captures the CORRECT
 * `PromptContext` (panel = Jira, the active tab, the open dock) — but that context never
 * reached the Cosmos timeline's live seed, which read a cosmos-only ref written only by
 * `CosmosPanel.onSubmit`. So a cross-panel run's live chip stayed "Cosmos".
 *
 * The fix: a SHARED "last submitted PromptContext" ref on the App-root `ActiveComposerProvider`
 * (`useRecordSubmitContext` to write, `useLastSubmitContextRef` to read). BOTH submit sites write
 * it; the Cosmos `agent:status 'started'` seed reads it.
 *
 * This test exercises the REAL cross-panel flow WITHOUT mocking the seed: it renders the REAL
 * `CosmosPanel` under `ActiveComposerProvider`, has a sibling consumer call the SAME
 * `useRecordSubmitContext()` that `useGenerativePanelTabs.submit` calls (recording a JIRA context),
 * then fires the `agent:status 'started'` push the agent run emits. It asserts the live chip names
 * JIRA — proving the captured cross-panel context reached the cosmos live seed.
 *
 * Red→green: before the fix the seed read a cosmos-only ref, so the chip showed "Cosmos" (and no
 * "PROJ-123") here; this test would fail. After the fix it shows the Jira context.
 */
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CosmosPanel } from './CosmosPanel'
import {
  ActiveComposerProvider,
  useRecordSubmitContext
} from '../composer/ActiveComposerProvider'
import { PanelTabsProvider } from '../panelTabs'
import { SessionProvider } from '../session/SessionProvider'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import type { AgentStatusPayload } from '../../shared/ipc'

/** Captured `window.cosmos` listeners so the test can fire the live IPC pushes by hand. */
interface CapturedListeners {
  status: ((payload: AgentStatusPayload) => void) | null
}

let listeners: CapturedListeners

beforeEach(() => {
  listeners = { status: null }
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      conversation: {
        // Empty transcript so the timeline is purely the live in-flight entry under test.
        getDefault: () =>
          Promise.resolve({ ok: true, conversation: { turns: [], state: 'empty' } }),
        onUpdate: () => () => {}
      },
      agent: {
        onStatus: (listener: (payload: AgentStatusPayload) => void) => {
          listeners.status = listener
          return () => {
            listeners.status = null
          }
        },
        submit: () => {}
      },
      ui: {
        onRender: () => () => {}
      },
      // CosmosPanel now reads enabled integrations (cross-panel tree) → SessionProvider needs a save.
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/**
 * A sibling consumer that stands in for `useGenerativePanelTabs.submit`: it calls the SAME
 * `useRecordSubmitContext()` to publish a panel's captured PromptContext into the shared ref.
 * Exposes the setter so the test can fire a cross-panel "submit" by hand.
 */
function CrossPanelSubmitter({
  onReady
}: {
  onReady: (record: (ctx: PromptContext | undefined) => void) => void
}): null {
  const record = useRecordSubmitContext()
  onReady(record)
  return null
}

function renderPanel(): { record: (ctx: PromptContext | undefined) => void } {
  let record: (ctx: PromptContext | undefined) => void = () => {}
  render(
    <TooltipProvider>
      <SessionProvider snapshot={null}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <CosmosPanel active />
            <CrossPanelSubmitter onReady={(r) => (record = r)} />
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
  return { record: (ctx) => record(ctx) }
}

async function settleMount(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Cosmos cross-panel live context (cosmos-context-chip-crosspanel-and-historical-v1 #2)', () => {
  const jiraContext: PromptContext = {
    panel: { id: 'jira', label: 'Jira' },
    tab: { id: 't1', label: 'Sprint board' },
    dock: { kind: 'jira-issue', selectedIssueKey: 'PROJ-123' }
  }

  it('live chip reflects the SUBMITTING panel (Jira), not a cosmos-only default', async () => {
    const { record } = renderPanel()
    await settleMount()

    // A submit ORIGINATING in Jira: `useGenerativePanelTabs.submit` records its captured context
    // (it does NOT go through CosmosPanel.onSubmit). Then the agent run's 'started' status fires.
    act(() => {
      record(jiraContext)
    })
    act(() => {
      listeners.status?.({ state: 'started' })
    })

    // The live chip shows the JIRA context — panel label + the open issue key — not "Cosmos".
    const chip = screen.getByRole('note')
    expect(chip).toBeInTheDocument()
    expect(screen.getByText('Jira')).toBeInTheDocument()
    expect(screen.getByText('PROJ-123')).toBeInTheDocument()
    // Regression lock: the old cosmos-only default ("Cosmos") must NOT be the chip's panel.
    expect(screen.queryByText('Cosmos')).not.toBeInTheDocument()
  })

  it('a Slack cross-panel submit shows the Slack channel context', async () => {
    const { record } = renderPanel()
    await settleMount()

    const slackContext: PromptContext = {
      panel: { id: 'slack', label: 'Slack' },
      tab: { id: 't2', label: 'Channels' },
      dock: {
        kind: 'slack-channel',
        selectedChannelId: 'C0123',
        selectedChannelName: 'general'
      }
    }
    act(() => {
      record(slackContext)
    })
    act(() => {
      listeners.status?.({ state: 'started' })
    })

    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('#general')).toBeInTheDocument()
    expect(screen.queryByText('Cosmos')).not.toBeInTheDocument()
  })
})
