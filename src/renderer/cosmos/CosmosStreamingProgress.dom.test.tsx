/**
 * DOM test (jsdom, vitest.dom.config.ts) for `cosmos-agent-progress-not-streaming-v1`.
 *
 * The bug: while the cosmos agent works, the Cosmos timeline showed ONLY the "…" TypingIndicator
 * spinner, then every turn appeared at once on completion — the intermediate steps never streamed.
 *
 * The fix pushes `conversation:update` INCREMENTALLY while a run is in flight (main polls the
 * transcript as it grows). This test drives the REAL CosmosPanel through that flow and asserts:
 *   1. an INCREMENTAL `conversation:update` mid-run shows the accumulating turns (assistant text +
 *      tool call) WITH the TypingIndicator STILL present — i.e. live is NOT cleared by the update;
 *   2. the streamed user-prompt turn does NOT double-render against the provisional live bubble
 *      (the prompt text appears exactly once);
 *   3. ONLY `agent:status 'completed'` clears live — the spinner disappears then, not before.
 *
 * RED before the fix: the panel's `conversation.onUpdate` called `setLive(null)`, so an incremental
 * update would kill the spinner immediately (and pre-fix main never sent a mid-run update at all).
 */
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CosmosPanel } from './CosmosPanel'
import {
  ActiveComposerProvider,
  useActiveComposerConfig
} from '../composer/ActiveComposerProvider'
import { PanelTabsProvider } from '../panelTabs'
import { SessionProvider } from '../session/SessionProvider'
import type { ComposerConfig } from '../composer/activeComposer'
import type { AgentStatusPayload, AgentSubmitPayload, ConversationResult } from '../../shared/ipc'

interface CapturedListeners {
  status: ((payload: AgentStatusPayload) => void) | null
  update: ((result: ConversationResult) => void) | null
  submits: AgentSubmitPayload[]
}

let listeners: CapturedListeners

beforeEach(() => {
  listeners = { status: null, update: null, submits: [] }
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      conversation: {
        // Mount resolves an EMPTY transcript; the test then drives the incremental pushes by hand.
        getDefault: () =>
          Promise.resolve({ ok: true, conversation: { turns: [], state: 'empty' } }),
        onUpdate: (listener: (result: ConversationResult) => void) => {
          listeners.update = listener
          return () => {
            listeners.update = null
          }
        }
      },
      agent: {
        onStatus: (listener: (payload: AgentStatusPayload) => void) => {
          listeners.status = listener
          return () => {
            listeners.status = null
          }
        },
        submit: (payload: AgentSubmitPayload) => {
          listeners.submits.push(payload)
        }
      },
      ui: { onRender: () => () => {} },
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

function CaptureComposer({ onConfig }: { onConfig: (c: ComposerConfig | null) => void }): null {
  onConfig(useActiveComposerConfig('cosmos'))
  return null
}

function renderPanel(): { getConfig: () => ComposerConfig | null } {
  let latest: ComposerConfig | null = null
  render(
    <TooltipProvider>
      <SessionProvider snapshot={null}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <CosmosPanel active />
            <CaptureComposer onConfig={(c) => (latest = c)} />
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
  return { getConfig: () => latest }
}

async function settleMount(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Cosmos streams in-flight progress (cosmos-agent-progress-not-streaming-v1)', () => {
  it('shows the accumulating turns mid-run WITH the spinner still present, and clears live only on completed', async () => {
    const { getConfig } = renderPanel()
    await settleMount()

    // Submit, then the run starts → the provisional live bubble + spinner appear.
    act(() => {
      getConfig()?.onSubmit('make a chart')
    })
    act(() => {
      listeners.status?.({ state: 'started' })
    })
    expect(screen.getByText('make a chart')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument() // TypingIndicator spinning

    // MID-RUN incremental push: the transcript has grown to carry the user prompt + an assistant
    // message + a tool call. These must STREAM into the timeline and the spinner must REMAIN.
    act(() => {
      listeners.update?.({
        ok: true,
        conversation: {
          state: 'populated',
          turns: [
            { kind: 'user-prompt', id: 'u1', ts: '1', text: 'make a chart' },
            { kind: 'assistant-text', id: 'a1', ts: '2', text: 'Reading the data now' },
            { kind: 'tool-call', id: 't1', ts: '3', toolName: 'GrepData', argPreview: 'q=sales' }
          ]
        }
      })
    })

    // The streamed intermediate steps are visible…
    expect(screen.getByText('Reading the data now')).toBeInTheDocument()
    expect(screen.getByText('GrepData')).toBeInTheDocument()
    // …the spinner is STILL present (the incremental update must NOT clear live)…
    expect(screen.getByRole('status')).toBeInTheDocument()
    // …and the user prompt renders EXACTLY ONCE (provisional live bubble suppressed once the
    // transcript carries the matching prompt — no double bubble).
    expect(screen.getAllByText('make a chart')).toHaveLength(1)

    // ONLY `agent:status 'completed'` clears live → the spinner disappears now, turns remain.
    act(() => {
      listeners.status?.({ state: 'completed' })
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Reading the data now')).toBeInTheDocument()
    expect(screen.getByText('GrepData')).toBeInTheDocument()
    expect(screen.getAllByText('make a chart')).toHaveLength(1)
  })

  it('an incremental update before any turns catch up keeps the provisional bubble + spinner', async () => {
    const { getConfig } = renderPanel()
    await settleMount()

    act(() => {
      getConfig()?.onSubmit('build a form')
    })
    act(() => {
      listeners.status?.({ state: 'started' })
    })

    // A first incremental update that does NOT yet carry the user's prompt (claude has only
    // written an earlier/other line) must keep the provisional bubble visible AND the spinner.
    act(() => {
      listeners.update?.({ ok: true, conversation: { state: 'empty', turns: [] } })
    })

    expect(screen.getByText('build a form')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    // The run never re-submitted on the status re-seed.
    expect(listeners.submits).toHaveLength(1)
  })
})
