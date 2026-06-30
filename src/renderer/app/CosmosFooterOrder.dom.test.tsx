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

/**
 * Renders the docked cosmos surface with NO published cosmos config — the Home-FAVORITE-active
 * state (cosmos-home-favorite-tabs-v1: a favorite tab publishes a NULL 'cosmos' config so the
 * docked Cosmos composer is hidden and the source panel's own floating Open-Prompt overlays).
 */
function renderDockedCosmosNoConfig() {
  const surfaceRef = { current: document.createElement('div') }
  return render(
    <SessionProvider snapshot={null}>
      <OpenPromptPositionProvider>
        <ActiveComposerProvider>
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
    // surface label renamed Cosmos → Home (rail/footer display label; wire id stays 'cosmos').
    expect(screen.getByText('Home')).toBeInTheDocument()
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

describe('Cosmos docked footer survives a null config (home-favorite-missing-footer-v1)', () => {
  // A Home FAVORITE tab publishes a NULL 'cosmos' composer config (CosmosPanel hides the docked
  // Cosmos composer + overlays the source panel's floating Open-Prompt). The "Home" footer is
  // surface CHROME, not the composer, so it MUST still render. RED before the fix: the early
  // `if (!config) return null` dropped the WHOLE docked return (composer AND footer) → no footer.
  it('renders the Home footer (no composer) when no cosmos config is published', () => {
    renderDockedCosmosNoConfig()
    // The footer's surface-name strip (aria-label="Panel", text "Home") IS present…
    expect(screen.getByLabelText('Panel')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    // …and the composer textarea is ABSENT (the band is omitted when config is null).
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('still renders BOTH composer and footer (composer → footer order) when a config IS present', () => {
    renderDockedCosmos()
    const textarea = screen.getByRole('textbox')
    const footer = screen.getByLabelText('Panel')
    expect(textarea).toBeInTheDocument()
    expect(footer).toBeInTheDocument()
    // The composer→footer order invariant is preserved (CosmosFooterOrder / CMP rows).
    const rel = textarea.compareDocumentPosition(footer)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rel & Node.DOCUMENT_POSITION_PRECEDING).toBeFalsy()
  })
})
