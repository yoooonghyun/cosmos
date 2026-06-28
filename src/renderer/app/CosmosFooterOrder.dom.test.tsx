/**
 * DOM test (jsdom, vitest.dom.config.ts) for footer-placement-cosmos-terminal-v1.
 *
 * The bug: the Cosmos name+status footer rendered ABOVE the docked Open-Prompt composer
 * (footer inside CosmosPanel, composer in the App column below it). The fix moves the footer
 * into `SharedComposer`'s docked branch BELOW the composer band, so the rendered DOM order is
 * composer → footer. A node test can't see this (it's rendered DOM order across two elements),
 * so this asserts it at the jsdom layer by rendering the REAL `SharedComposer` for the cosmos
 * surface with a published composer config.
 *
 * RED BEFORE FIX: with the footer above the composer (old layout) the footer node PRECEDES the
 * composer textarea — `compareDocumentPosition` is FOLLOWING reversed — so the assertion fails.
 */
import '@testing-library/jest-dom/vitest'
import { useMemo } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SharedComposer } from './SharedComposer'
import { ActiveComposerProvider, usePublishComposer } from '../composer/ActiveComposerProvider'
import { SessionProvider } from '../session/SessionProvider'
import { OpenPromptPositionProvider } from '../composer/OpenPromptPositionProvider'

beforeEach(() => {
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
  vi.clearAllMocks()
})

/** Publishes a cosmos composer config so `SharedComposer` reads a non-null config and renders. */
function PublishCosmos(): null {
  const config = useMemo(
    () => ({
      onSubmit: vi.fn(),
      placeholder: 'Describe the UI you want…',
      ariaLabel: 'Compose generated UI',
      busy: false
    }),
    []
  )
  usePublishComposer('cosmos', config)
  return null
}

function renderDockedCosmos() {
  const surfaceRef = { current: document.createElement('div') }
  return render(
    <SessionProvider snapshot={null}>
      <OpenPromptPositionProvider>
        <ActiveComposerProvider>
          <PublishCosmos />
          <SharedComposer surface="cosmos" surfaceRef={surfaceRef} />
        </ActiveComposerProvider>
      </OpenPromptPositionProvider>
    </SessionProvider>
  )
}

describe('Cosmos docked column order (footer-placement-cosmos-terminal-v1)', () => {
  it('renders the composer BEFORE the footer (composer → footer, not footer → composer)', () => {
    renderDockedCosmos()
    const textarea = screen.getByRole('textbox')
    // PanelFooter renders the surface name strip with aria-label="Panel".
    const footer = screen.getByLabelText('Panel')
    expect(textarea).toBeInTheDocument()
    expect(footer).toBeInTheDocument()
    // composer precedes footer ⇒ footer FOLLOWS the textarea in document order.
    const rel = textarea.compareDocumentPosition(footer)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rel & Node.DOCUMENT_POSITION_PRECEDING).toBeFalsy()
  })

  it('shows the Cosmos footer with its surface name', () => {
    renderDockedCosmos()
    expect(screen.getByText('Cosmos')).toBeInTheDocument()
  })

  // terminal-broke-scroll-unify-redo-v1 (Task 2): the docked band's bottom padding is the SOLE
  // control of the composer→footer gap. It was bumped pb-5 → pb-8 to give the composer more
  // breathing room above the footer (measured gap 26px → 38px in the composer-gap visual spec).
  // Lock the class so the gap can't silently revert to the cramped pb-5.
  it('docked composer band carries pb-8 (the composer→footer gap control)', () => {
    renderDockedCosmos()
    const textarea = screen.getByRole('textbox')
    // The band is the composer's wrapping flex column slot: form → … → band(div.pb-8).
    const band = textarea.closest('div.pb-8')
    expect(band).not.toBeNull()
    expect(band).toHaveClass('shrink-0', 'justify-center', 'pb-8')
    // Guard against a silent revert to the old cramped padding.
    expect(band).not.toHaveClass('pb-5')
  })
})
