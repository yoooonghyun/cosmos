/**
 * DOM test (jsdom, vitest.dom.config.ts) — regression diagnostic for
 * `cosmos-context-chip-historical-not-showing-v2`.
 *
 * THIS TEST IS ALSO THE DIAGNOSTIC: if it is GREEN on first run the on-disk wiring is
 * correct and the user's runtime miss is STALE DEV (un-restarted preload / provider).
 * If it is RED a real read→reconcile→render-historical integration bug exists at the
 * identified file:line.
 *
 * What it tests (COSMOS-HIST-CTX-01):
 *   The CosmosPanel reads its default conversation via `window.cosmos.conversation.getDefault()`
 *   → `toReadState` → `setRead(populated)` → `reconcileTimeline(turns, live=null)` →
 *   `CosmosTimelineEntry` renders each turn → `PromptContextChip` renders the historical chip.
 *
 *   This integration link has never been covered end-to-end in jsdom. Every prior test either:
 *   - drove the LIVE in-flight path (`agent:status 'started'` / `ui:render`), OR
 *   - injected `turn.context` directly into `CosmosTimelineEntry` without going through the panel.
 *
 * Harness:
 *   - Mounts the REAL `CosmosPanel` under the REAL `ActiveComposerProvider`.
 *   - Stubs `window.cosmos.conversation.getDefault()` to resolve a POPULATED `Conversation`
 *     whose `turns` include a `user-prompt` turn whose `context` is built from a REAL
 *     `parsePromptContextMarker(serializePromptContextMarker(ctx))` round-trip with a JIRA
 *     context (panel `{id:'jira',label:'Jira'}` + a tab + an issue key) — so the chip label
 *     is unmistakable and the round-trip codec is exercised.
 *   - Stubs `onUpdate`, `ui.onRender`, `agent.onStatus` as no-op unsubscribers.
 *   - Keeps `live = null` (does NOT touch the live/generating path — exclusively the
 *     HISTORICAL branch).
 *
 * Asserts:
 *   - The `role="note"` badge with `aria-label` starting `Prompt context:` is in the DOM.
 *   - It names the Jira panel label ("Jira") and the tab label ("Sprint board").
 *   - It sits ABOVE the user bubble in DOM order (chip → bubble).
 *   - The raw `<cosmos:context>` marker is never surfaced.
 */
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CosmosPanel } from './CosmosPanel'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { PanelTabsProvider } from '../panelTabs'
import { PanelHostProvider } from '../panelHost'
import { SessionProvider } from '../session/SessionProvider'
import type { PromptContext } from '../../shared/promptContext/promptContext'
import type { Conversation } from '../../shared/types/conversation'
import {
  serializePromptContextMarker,
  parsePromptContextMarker
} from '../../shared/promptContext/promptContextMarker'

// ---------------------------------------------------------------------------
// Build the historical turn via a REAL round-trip through the shared codec
// (the same codec `parseTranscript` delegates to for string-content user lines).
// This exercises the submit→read codec, not a hand-injected context.
// ---------------------------------------------------------------------------

const jiraContext: PromptContext = {
  panel: { id: 'jira', label: 'Jira' },
  tab: { id: 'tab-sprint', label: 'Sprint board' }
}

const utterance = 'summarize my open tickets'

// Reproduce what `buildAgentSubmitWithMarker` does on submit (channel b):
const marker = serializePromptContextMarker(jiraContext)
// Reproduce what `parseTranscript` does when it reads a string-content user line:
const parsed = parsePromptContextMarker(utterance + marker)

/** The populated `Conversation` the stub will resolve to. */
const populatedConversation: Conversation = {
  sessionId: 'test-session',
  state: 'populated',
  turns: [
    {
      kind: 'user-prompt',
      id: 'turn-1',
      ts: '2026-06-28T00:00:00Z',
      text: parsed.text,
      ...(parsed.context ? { context: parsed.context } : {})
    }
  ]
}

// ---------------------------------------------------------------------------
// window.cosmos stub
// ---------------------------------------------------------------------------

beforeEach(() => {
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      conversation: {
        // Resolve a POPULATED conversation with the round-trip-built historical turn.
        getDefault: () =>
          Promise.resolve({ ok: true, conversation: populatedConversation }),
        // No-op subscriber — we are NOT testing the live-update path.
        onUpdate: () => () => {}
      },
      agent: {
        // No-op subscriber — live=null throughout (HISTORICAL path only).
        onStatus: () => () => {},
        submit: () => {}
      },
      ui: {
        // No-op subscriber — no live surface in this test.
        onRender: () => () => {}
      },
      // cosmos-home-keyboard-tab-nav-v1: CosmosPanel subscribes to global tab shortcuts on mount.
      shortcuts: { onTrigger: () => () => {} },
      // CosmosPanel now reads enabled integrations (cross-panel tree) → SessionProvider needs a save.
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPanel(): void {
  render(
    <TooltipProvider>
      <SessionProvider snapshot={null}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <PanelHostProvider>
              <CosmosPanel active />
            </PanelHostProvider>
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
}

/** Settle the async `getDefault().then(setRead)` + all mount effects. */
async function settleMount(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// Tests (COSMOS-HIST-CTX-01)
// ---------------------------------------------------------------------------

describe('CosmosPanel — HISTORICAL context chip integration (COSMOS-HIST-CTX-01)', () => {
  it('renders the Jira chip above the user bubble for a HISTORICAL turn (read→reconcile→render)', async () => {
    renderPanel()
    await settleMount()

    // The chip (role="note") must be in the DOM — the full read→reconcile→render chain ran.
    const chip = screen.getByRole('note')
    expect(chip).toBeInTheDocument()

    // The aria-label starts with "Prompt context:" (PromptContextChip.ariaLabelFor).
    expect(chip).toHaveAttribute('aria-label', expect.stringMatching(/^Prompt context:/))

    // The panel label "Jira" is visible.
    expect(screen.getByText('Jira')).toBeInTheDocument()

    // The tab label "Sprint board" is visible.
    expect(screen.getByText('Sprint board')).toBeInTheDocument()

    // The chip sits ABOVE the user bubble (chip → bubble in DOM order).
    const bubble = screen.getByText(utterance)
    expect(bubble).toBeInTheDocument()
    expect(chip.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never surfaces the raw <cosmos:context> marker in the DOM (FR-025)', async () => {
    renderPanel()
    await settleMount()

    expect(document.body.textContent ?? '').not.toContain('cosmos:context')
    expect(document.body.innerHTML).not.toContain('<cosmos:context>')
  })

  it('shows the clean prose utterance (marker stripped from displayed text)', async () => {
    renderPanel()
    await settleMount()

    // The bubble text is the stripped clean prose, not the marker-bearing raw string.
    expect(screen.getByText(utterance)).toBeInTheDocument()
    // The raw marker suffix is absent.
    expect(screen.queryByText(utterance + marker)).not.toBeInTheDocument()
  })

  it('the round-trip codec produced a real context (guard: codec itself works)', () => {
    // If this assertion fails the test is misconfigured, not the product.
    expect(marker).not.toBe('')
    expect(parsed.context).toBeDefined()
    expect(parsed.context?.panel.id).toBe('jira')
    expect(parsed.context?.tab?.label).toBe('Sprint board')
    expect(parsed.text).toBe(utterance)
  })
})
