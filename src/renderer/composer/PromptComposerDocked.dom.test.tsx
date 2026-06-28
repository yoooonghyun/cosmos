/**
 * DOM tests for the DOCKED PromptComposer (jsdom env, vitest.dom.config.ts) —
 * cosmos-open-prompt-pinned-v1, scenario CMP-MODE-01.
 *
 * The node-unit predicates (`composerModeForSurface`, `isAlwaysOpen`/`allowsCollapse`/
 * `hidesOnBusy`) are NECESSARY but NOT SUFFICIENT — they cannot see the RENDERED docked
 * behavior (an always-present input, auto-focus on activation, inert Esc, stay-open submit,
 * not-hidden-while-busy). These tests render the REAL `PromptComposer` in `mode="docked"`
 * and assert that DOM behavior.
 *
 * RED BEFORE FIX: with no `mode` branch the composer renders the default-collapsed floating
 * logo (no always-present textarea), Esc collapses, submit collapses, and `busy` hides the
 * card — so the docked assertions below fail. GREEN with the docked branch.
 *
 * The FLOATING path is exercised by the existing node-unit logic tests + the unchanged render
 * code; this file does NOT touch the floating panels (FR-011 regression guard lives in the
 * node-unit `'floating'` rows of activeComposer.test.ts / promptComposerLogic.test.ts).
 */

// Register the jest-dom matcher TYPES on vitest's `expect` (the runtime matchers are loaded by
// the shared `src/test-setup.dom.ts` setupFile; this import only augments the Assertion types so
// `toBeInTheDocument`/`toBeVisible`/`toHaveFocus`/`toBeDisabled` typecheck under tsconfig.web).
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PromptComposer } from './PromptComposer'
import type { ContextChipData } from '../app/viewContextCapture'
import { SessionProvider } from '../session/SessionProvider'
import { OpenPromptPositionProvider } from './OpenPromptPositionProvider'

// PromptComposer subscribes to `window.cosmos.agent.onStatus` and SessionProvider calls
// `window.cosmos.session.save`. Stub the minimal surface so the real component mounts.
beforeEach(() => {
  ;(globalThis as unknown as { window: Window }).window = globalThis.window
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      agent: {
        onStatus: () => () => {},
        submit: vi.fn()
      },
      session: {
        save: vi.fn()
      }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

/**
 * Mount the docked composer inside the providers it depends on (it calls
 * `useOpenPromptPosition` unconditionally — hooks can't be conditional — even though the
 * docked render drops the drag machinery). `autoFocusActive` is exposed via a small wrapper so
 * a test can flip it false→true to exercise the activation-edge auto-focus.
 */
function DockedHarness({
  onSubmit = vi.fn(),
  busy = false,
  initialAutoFocusActive = false,
  contextChip
}: {
  onSubmit?: (utterance: string, options?: unknown) => void
  busy?: boolean
  initialAutoFocusActive?: boolean
  contextChip?: ContextChipData
}): React.JSX.Element {
  const [autoFocusActive, setAutoFocusActive] = useState(initialAutoFocusActive)
  return (
    <TooltipProvider>
      <SessionProvider snapshot={null}>
        <OpenPromptPositionProvider>
          <button type="button" data-testid="activate" onClick={() => setAutoFocusActive(true)}>
            activate
          </button>
          <PromptComposer
            mode="docked"
            autoFocusActive={autoFocusActive}
            onSubmit={onSubmit}
            placeholder="Describe the UI you want…"
            ariaLabel="Compose generated UI"
            busy={busy}
            {...(contextChip ? { contextChip } : {})}
          />
        </OpenPromptPositionProvider>
      </SessionProvider>
    </TooltipProvider>
  )
}

describe('PromptComposer docked mode — DOM behavior (CMP-MODE-01)', () => {
  // cosmos-panel-tab-list-v1 regression: the DOCKED composer render branch previously omitted the
  // ContextChip entirely, so a Cosmos tree-click panel+tab selection had NO visible affordance. The
  // docked branch now renders the SAME chip the floating composer does.
  it('renders a panel+tab ContextChip in DOCKED mode (cosmos-panel-tab-list-v1)', () => {
    const chip: ContextChipData = {
      kind: 'panel-tab',
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 'j1', label: 'Sprint board' }
    }
    render(<DockedHarness contextChip={chip} />)
    const note = screen.getByRole('note')
    expect(note).toHaveAttribute('aria-label', expect.stringContaining('Jira panel'))
    expect(note).toHaveAttribute('aria-label', expect.stringContaining('Sprint board tab'))
    // The chip carries a removable `×` (drops the selection for the next compose).
    expect(screen.getByRole('button', { name: /Remove Sprint board/ })).toBeInTheDocument()
  })

  it('hides the docked ContextChip once dismissed via its `×` (contextDismiss all)', () => {
    const chip: ContextChipData = {
      kind: 'panel-tab',
      panel: { id: 'jira', label: 'Jira' },
      tab: { id: 'j1', label: 'Sprint board' }
    }
    render(<DockedHarness contextChip={chip} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove Sprint board/ }))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('renders the input ALWAYS-OPEN on mount: a textarea is present, no collapsed logo (FR-001)', () => {
    render(<DockedHarness />)
    // The textarea is immediately present (no click-to-reveal).
    const textarea = screen.getByRole('textbox')
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea).toBeVisible()
    // The Send control is present.
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    // The floating "Open prompt" logo button is NOT rendered in docked mode.
    expect(screen.queryByRole('button', { name: 'Open prompt' })).not.toBeInTheDocument()
  })

  it('STAYS OPEN after a submit and clears the draft (FR-004 / §4.6 — chat-style)', () => {
    const onSubmit = vi.fn()
    render(<DockedHarness onSubmit={onSubmit} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'make a button' } })
    // Enter submits (no Shift).
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toBe('make a button')
    // The composer is STILL open (textarea present) and the draft cleared.
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('does NOT submit empty/whitespace-only text (FR-006 — submitDecision preserved)', () => {
    const onSubmit = vi.fn()
    render(<DockedHarness onSubmit={onSubmit} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '   \n\t  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    // Send is disabled for whitespace-only.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('Shift+Enter does NOT submit (newline path) — composer stays open, onSubmit not called', () => {
    const onSubmit = vi.fn()
    render(<DockedHarness onSubmit={onSubmit} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'line one' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Enter while IME-composing does NOT submit — no duplicate last char (cosmos-composer-ime-enter-duplicate-char-v1)', () => {
    const onSubmit = vi.fn()
    render(<DockedHarness onSubmit={onSubmit} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '안녕' } })
    // The commit-Enter fires keydown with isComposing=true; it must be ignored.
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()

    // A real Enter (composition finished) submits exactly once.
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toBe('안녕')
  })

  it('Esc is INERT: it does NOT remove/collapse the docked input (FR-003/FR-007 / §5)', () => {
    render(<DockedHarness />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'half typed' } })

    fireEvent.keyDown(textarea, { key: 'Escape' })

    // Still present (not collapsed to a logo) AND the draft is untouched.
    const after = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(after).toBeInTheDocument()
    expect(after.value).toBe('half typed')
    expect(screen.queryByRole('button', { name: 'Open prompt' })).not.toBeInTheDocument()
  })

  it('click-outside does NOT collapse the docked input (FR-003 / §5)', () => {
    render(
      <div>
        <div data-testid="outside">elsewhere</div>
        <DockedHarness />
      </div>
    )
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // A mousedown outside the composer must NOT remove it.
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('stays VISIBLE and typeable while busy (FR-005 — "busy hides both" is floating-only)', () => {
    const onSubmit = vi.fn()
    render(<DockedHarness onSubmit={onSubmit} busy />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // The input is present (not hidden) and not disabled despite busy.
    expect(textarea).toBeVisible()
    expect(textarea).not.toBeDisabled()
    // And it can still send while a run is in flight (fire-and-forget).
    fireEvent.change(textarea, { target: { value: 'follow up' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('auto-focuses the textarea on the Cosmos ACTIVATION EDGE without focus already there (OQ-2 / §5)', () => {
    render(<DockedHarness initialAutoFocusActive={false} />)
    const textarea = screen.getByRole('textbox')
    // Not focused before activation.
    expect(textarea).not.toHaveFocus()
    // Flip autoFocusActive false→true (the activation edge).
    act(() => {
      fireEvent.click(screen.getByTestId('activate'))
    })
    expect(textarea).toHaveFocus()
  })
})
