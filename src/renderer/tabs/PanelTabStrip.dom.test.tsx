/**
 * DOM test (jsdom) for the PanelTabStrip leading-slot glyph (cosmos-random-tab-icons-v1).
 * Scenario: TAB-ICONS-STRIP-01 — a per-tab `icon` renders ITS glyph; a terminal tab WITH an icon
 * renders the random glyph (NOT SquareTerminal); a terminal tab WITHOUT an icon falls back to
 * SquareTerminal; the in-flight spinner / error glyph still precede the icon (FR-008); the glyph is
 * STABLE across a re-render.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelTabStrip, type PanelTab } from './PanelTabStrip'
import { TAB_ICON_BY_ID } from './tabIconRegistry'

function renderStrip(tabs: PanelTab[]) {
  return render(
    <TooltipProvider>
      <PanelTabStrip
        tabs={tabs}
        activeTabId={tabs[0]?.id ?? null}
        onActivate={() => {}}
        onClose={() => {}}
        ariaLabel="Test tabs"
      />
    </TooltipProvider>
  )
}

describe('PanelTabStrip leading glyph (TAB-ICONS-STRIP-01)', () => {
  it('a generative tab with an icon renders ITS glyph (FR-005)', () => {
    const { container } = renderStrip([
      { id: 't1', label: 'A', kind: 'generative', icon: TAB_ICON_BY_ID.rocket }
    ])
    expect(container.querySelector('.lucide-rocket')).toBeInTheDocument()
  })

  it('a terminal tab WITH an icon renders the random glyph, NOT SquareTerminal (OQ-2)', () => {
    const { container } = renderStrip([
      { id: 't1', label: 'Terminal', kind: 'terminal', icon: TAB_ICON_BY_ID.orbit }
    ])
    expect(container.querySelector('.lucide-orbit')).toBeInTheDocument()
    expect(container.querySelector('.lucide-square-terminal')).not.toBeInTheDocument()
  })

  it('a terminal tab WITHOUT an icon falls back to SquareTerminal', () => {
    const { container } = renderStrip([{ id: 't1', label: 'Terminal', kind: 'terminal' }])
    expect(container.querySelector('.lucide-square-terminal')).toBeInTheDocument()
  })

  it('in-flight spinner PRECEDES the icon even when one is set (FR-008)', () => {
    const { container } = renderStrip([
      { id: 't1', label: 'A', kind: 'generative', status: 'in-flight', icon: TAB_ICON_BY_ID.star }
    ])
    expect(container.querySelector('.lucide-loader-circle, .animate-spin')).toBeInTheDocument()
    expect(container.querySelector('.lucide-star')).not.toBeInTheDocument()
  })

  it('error glyph PRECEDES the icon even when one is set (FR-008)', () => {
    const { container } = renderStrip([
      {
        id: 't1',
        label: 'A',
        kind: 'generative',
        status: 'error',
        errorMessage: 'boom',
        icon: TAB_ICON_BY_ID.moon
      }
    ])
    expect(container.querySelector('.lucide-circle-alert')).toBeInTheDocument()
    expect(container.querySelector('.lucide-moon')).not.toBeInTheDocument()
  })

  it('the glyph is STABLE across a re-render (same component → same class) (FR-003/SC-003)', () => {
    const tab: PanelTab = { id: 't1', label: 'A', kind: 'generative', icon: TAB_ICON_BY_ID.earth }
    const { container, rerender } = renderStrip([tab])
    expect(container.querySelector('.lucide-earth')).toBeInTheDocument()
    rerender(
      <TooltipProvider>
        <PanelTabStrip
          tabs={[{ ...tab, label: 'A renamed' }]}
          activeTabId="t1"
          onActivate={() => {}}
          onClose={() => {}}
          ariaLabel="Test tabs"
        />
      </TooltipProvider>
    )
    expect(container.querySelector('.lucide-earth')).toBeInTheDocument()
  })
})
