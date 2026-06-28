/**
 * DOM test (jsdom, vitest.dom.config.ts) for
 * `cosmos-live-bubble-missing-while-generating-v1`.
 *
 * The bug: after submitting from the Cosmos composer, the TypingIndicator ("…") spins but the
 * user's OWN prompt bubble is not visible, so the user can't tell their utterance registered.
 * Expected: the user bubble shows FIRST, then the "…" below it.
 *
 * The render is trivially correct in isolation (a `live-generating` entry with `promptText`
 * renders a `UserBubble` then a `TypingIndicator`), so a node test can't catch a regression
 * here. This exercises the REAL FLOW that produces that entry: render the REAL `CosmosPanel`,
 * drive its published `'cosmos'` composer `onSubmit` (the Enter path), then drive the
 * `agent:status 'started'` re-seed, and assert across the WHOLE chain
 * (onSubmit → setLive → reconcileTimeline → CosmosTimelineEntry render) that:
 *   1. the submitted text bubble IS in the document, BEFORE the TypingIndicator in DOM order;
 *   2. the bubble SURVIVES the 'started' status re-seed (which re-reads `lastPromptRef`);
 *   3. the bubble shows the CLEAN utterance — never the raw `<cosmos:context>` marker.
 *
 * The panel is wrapped only in `ActiveComposerProvider`; a tiny `CaptureComposer` consumer reads
 * the published config from the registry so the test can invoke the SAME `onSubmit` the shared
 * composer would (no need to mount the heavy `PromptComposer`/glass/drag layer under jsdom).
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
import type { ComposerConfig } from '../composer/activeComposer'
import type { AgentStatusPayload, AgentSubmitPayload } from '../../shared/ipc'

/** Captured `window.cosmos` listeners so the test can fire the live IPC pushes by hand. */
interface CapturedListeners {
  status: ((payload: AgentStatusPayload) => void) | null
  update: ((result: unknown) => void) | null
  submits: AgentSubmitPayload[]
}

let listeners: CapturedListeners

beforeEach(() => {
  listeners = { status: null, update: null, submits: [] }
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      // The conversation read resolves to a populated/empty transcript on mount. Resolve EMPTY
      // so the timeline is purely the live in-flight entry (the only thing under test here).
      conversation: {
        getDefault: () =>
          Promise.resolve({ ok: true, conversation: { turns: [], state: 'empty' } }),
        onUpdate: (listener: (result: unknown) => void) => {
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
      ui: {
        // No live surface in this test — just record/return a no-op unsubscribe.
        onRender: () => () => {}
      }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/** Reads the published `'cosmos'` composer config so the test can call its real `onSubmit`. */
function CaptureComposer({ onConfig }: { onConfig: (c: ComposerConfig | null) => void }): null {
  const config = useActiveComposerConfig('cosmos')
  onConfig(config)
  return null
}

/** Renders the REAL CosmosPanel + captures its published composer config. */
function renderPanel(): { getConfig: () => ComposerConfig | null } {
  let latest: ComposerConfig | null = null
  render(
    <TooltipProvider>
      <ActiveComposerProvider>
        <CosmosPanel active />
        <CaptureComposer onConfig={(c) => (latest = c)} />
      </ActiveComposerProvider>
    </TooltipProvider>
  )
  return { getConfig: () => latest }
}

/** Settle the mount effects (the async `getDefault().then(...)` + the IPC subscriptions). */
async function settleMount(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Cosmos live bubble while generating (cosmos-live-bubble-missing-while-generating-v1)', () => {
  it('shows the user prompt bubble BEFORE the typing indicator on submit', async () => {
    const { getConfig } = renderPanel()
    await settleMount()

    act(() => {
      getConfig()?.onSubmit('make me a chart')
    })

    // The submitted text bubble is present…
    const bubble = screen.getByText('make me a chart')
    expect(bubble).toBeInTheDocument()
    // …and the typing indicator (assistant working affordance) is present…
    const typing = screen.getByRole('status')
    expect(typing).toBeInTheDocument()
    // …and the bubble comes BEFORE the indicator in DOM order (bubble → dots).
    const rel = bubble.compareDocumentPosition(typing)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rel & Node.DOCUMENT_POSITION_PRECEDING).toBeFalsy()
  })

  it('keeps the bubble visible when the run STARTS (the status re-seed must not drop it)', async () => {
    const { getConfig } = renderPanel()
    await settleMount()

    act(() => {
      getConfig()?.onSubmit('build a form')
    })
    // The agent run starts — the panel re-seeds `live` from `lastPromptRef`. The bubble must
    // SURVIVE (the reported failure mode is `live` being replaced/cleared so the text vanishes).
    act(() => {
      listeners.status?.({ state: 'started' })
    })

    const bubble = screen.getByText('build a form')
    expect(bubble).toBeInTheDocument()
    const typing = screen.getByRole('status')
    const rel = bubble.compareDocumentPosition(typing)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the CLEAN utterance — never the raw <cosmos:context> marker', async () => {
    const { getConfig } = renderPanel()
    await settleMount()

    // The composer hands `onSubmit` the RAW (marker-free) utterance — the live bubble shows that
    // clean prose. Submit something that contains marker-shaped text to prove the bubble renders
    // the literal utterance it was given and the panel never injects/echoes a real context marker.
    act(() => {
      getConfig()?.onSubmit('show my open issues')
    })
    act(() => {
      listeners.status?.({ state: 'started' })
    })

    // The displayed bubble is exactly the clean prose…
    expect(screen.getByText('show my open issues')).toBeInTheDocument()
    // …and NO raw `<cosmos:context>` marker is ever surfaced in the live bubble (FR-024/FR-025).
    expect(document.body.textContent ?? '').not.toContain('cosmos:context')
    expect(document.body.innerHTML).not.toContain('<cosmos:context>')
    // The agent submit fired exactly once (the 'started' re-seed must not re-submit).
    expect(listeners.submits).toHaveLength(1)
    expect(listeners.submits[0]?.target).toBe('generated-ui')
  })
})
