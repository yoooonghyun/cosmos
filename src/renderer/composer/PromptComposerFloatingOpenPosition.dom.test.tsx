/**
 * DOM regression guard for the FLOATING PromptComposer's open behavior + position
 * (open-prompt-opens-top-left-v1 AND its regression open-prompt-card-never-opens-v1; jsdom env,
 * vitest.dom.config.ts).
 *
 * TWO paired bugs this guards, both invisible to the pure `openPromptPosition.test.ts` (which only
 * clamps WITH a measured card and never renders):
 *   1. open-prompt-opens-top-left-v1 — the card opened at the TOP-LEFT (≈0,0) instead of centered.
 *   2. open-prompt-card-never-opens-v1 — the top-left fix over-gated visibility on the CARD's own
 *      measurement, which on the real floating open never reliably reaches a non-zero box (the
 *      card's `w-full` width derives from the panel-sized layer), so the card was trapped invisible
 *      and NEVER OPENED.
 *
 * The wiring is now: hidden until the PANEL is measured (`cardShow`); once shown, centered over the
 * panel via dimension-independent CSS until the CARD measures (`cardAnchored`), then button-anchored.
 * So the card ALWAYS opens (panel measure is reliable) and NEVER paints at top-left.
 *
 * These tests render the REAL `PromptComposer` floating and drive the open with progressively more
 * of the layout mocked, so they exercise the actual show/anchored transition rather than injecting a
 * pre-measured state:
 *   - PANEL UNMEASURED (no layout mock) ⇒ hidden + centered fallback (hide-until-measured).
 *   - PANEL MEASURED, CARD UNMEASURED (mock ONLY the panel box; the card's offsetWidth stays 0, as
 *     in real jsdom) ⇒ the card is SHOWN (not invisible) and centered — NEVER top-left. This is the
 *     open-prompt-card-never-opens-v1 guard: RED on the over-gated wiring (which kept it invisible).
 *   - PANEL + CARD MEASURED (mock both) ⇒ shown, button-anchored at a px with x>0 AND y>0.
 *
 * Pairs with the node-unit `resolveCardPlacement` rows in `openPromptPosition.test.ts`.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PromptComposer } from './PromptComposer'
import { SessionProvider } from '../session/SessionProvider'
import { OpenPromptPositionProvider } from './OpenPromptPositionProvider'
import { TooltipProvider } from '@/components/ui/tooltip'

const ARIA = 'Ask about your tickets'

// PromptComposer subscribes to `window.cosmos.agent.onStatus`; SessionProvider calls
// `window.cosmos.session.save`. Stub the minimal surface so the real component mounts.
beforeEach(() => {
  ;(globalThis as unknown as { window: Window }).window = globalThis.window
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      agent: { onStatus: () => () => {}, submit: vi.fn() },
      session: { save: vi.fn() }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** Mount the FLOATING composer inside its providers + a `<section>` panel ancestor (the box the
 * logo/card position within — the composer finds it via `rootRef.closest('section')`). */
function FloatingHarness(): React.JSX.Element {
  return (
    <SessionProvider snapshot={null}>
      <OpenPromptPositionProvider>
        <TooltipProvider>
          <section className="flex h-full flex-col">
            <PromptComposer
              mode="floating"
              onSubmit={vi.fn()}
              placeholder="Describe the UI you want…"
              ariaLabel={ARIA}
            />
          </section>
        </TooltipProvider>
      </OpenPromptPositionProvider>
    </SessionProvider>
  )
}

/** The card's positioning WRAPPER div (the parent of the composer `<form>`). */
function cardWrapper(container: HTMLElement): HTMLElement {
  const form = container.querySelector(`form[aria-label="${ARIA}"]`)
  if (!form?.parentElement) {
    throw new Error('floating composer card form not found')
  }
  return form.parentElement
}

function openComposer(): void {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Open prompt' }))
  })
}

/** Mock the PANEL's measured box (the `<section>`); other elements measure a 0-box. */
function mockPanelRect(panel: { width: number; height: number }): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ): DOMRect {
    const box =
      this.tagName === 'SECTION'
        ? { left: 0, top: 0, width: panel.width, height: panel.height }
        : { left: 0, top: 0, width: 0, height: 0 }
    return {
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({})
    } as DOMRect
  })
}

/** Mock the CARD `<form>`'s un-transformed layout box (`offsetWidth/Height`). Returns a restorer. */
function mockCardOffset(card: { width: number; height: number }): () => void {
  const owDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  const ohDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'FORM' ? card.width : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'FORM' ? card.height : 0
    }
  })
  return () => {
    if (owDesc) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', owDesc)
    if (ohDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', ohDesc)
  }
}

describe('PromptComposer floating mode — open behavior + position', () => {
  it('PANEL UNMEASURED: the card is HIDDEN (hide-until-measured) and CENTERED, never top-left', () => {
    // Natural jsdom: getBoundingClientRect is a 0-box, so the panel layer has no size yet.
    const { container } = render(<FloatingHarness />)
    openComposer()

    const wrapper = cardWrapper(container)
    expect(wrapper.className).toContain('invisible') // hide-until-measured (panel not yet sized)
    // CENTERED fallback (dimension-independent), NOT the top-left anchor.
    expect(wrapper.className).toContain('-translate-x-1/2')
    expect(wrapper.className).toContain('-translate-y-1/2')
    expect(wrapper.className).not.toContain('left-0')
    expect(wrapper.className).not.toContain('top-0')
    expect(wrapper.getAttribute('style') ?? '').not.toContain('translate3d')
  })

  it('open-prompt-card-never-opens-v1: PANEL measured but CARD never measures → the card STILL OPENS, centered (not invisible, not top-left)', () => {
    // Mock ONLY the panel box; the card's offsetWidth stays 0 (real jsdom) — i.e. the card's own
    // measurement never lands, the exact condition that trapped the card invisible. The card must
    // still SHOW (visibility no longer depends on the card measuring).
    mockPanelRect({ width: 1000, height: 800 })

    const { container } = render(<FloatingHarness />)
    openComposer()

    const wrapper = cardWrapper(container)
    // RED on the over-gated wiring: it kept `invisible` here forever ("대화창이 안 뜸").
    expect(wrapper.className).not.toContain('invisible')
    // Shown-but-not-anchored ⇒ centered over the panel via CSS, NOT the top-left anchor.
    expect(wrapper.className).toContain('-translate-x-1/2')
    expect(wrapper.className).toContain('-translate-y-1/2')
    expect(wrapper.className).not.toContain('left-0')
    expect(wrapper.className).not.toContain('top-0')
    expect(wrapper.getAttribute('style') ?? '').not.toContain('translate3d')
  })

  it('PANEL + CARD measured → card is SHOWN, button-anchored at a CENTERED px, demonstrably NOT (0,0)', () => {
    mockPanelRect({ width: 1000, height: 800 })
    const restoreOffset = mockCardOffset({ width: 672, height: 300 })

    try {
      const { container } = render(<FloatingHarness />)
      openComposer()

      const wrapper = cardWrapper(container)
      expect(wrapper.className).not.toContain('invisible')
      expect(wrapper.className).toContain('left-0')
      expect(wrapper.className).toContain('top-0')
      expect(wrapper.className).not.toContain('-translate-x-1/2')

      const style = wrapper.getAttribute('style') ?? ''
      const match = style.match(/translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)px/)
      expect(match).toBeTruthy()
      const x = Number.parseFloat(match![1])
      const y = Number.parseFloat(match![2])
      // CENTERED over the panel — NOT the top-left corner (the reported bug).
      expect(x).toBeGreaterThan(0)
      expect(y).toBeGreaterThan(0)
    } finally {
      restoreOffset()
    }
  })
})
