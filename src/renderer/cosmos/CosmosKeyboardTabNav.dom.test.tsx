/**
 * DOM test (jsdom) for Home keyboard tab navigation (cosmos-home-keyboard-tab-nav-v1,
 * scenario COSMOS-KEYBOARD-TAB-NAV-01).
 *
 * The Home (`cosmos`) panel now participates in the SHARED global tab-cycle shortcuts via
 * `useTabShortcuts`, gated on its `active` prop. This renders the REAL `CosmosPanel` with a
 * stubbed `window.cosmos.shortcuts.onTrigger` (the callback is captured) and fires
 * `tab:next`/`tab:prev`/`tab:jump`/`tab:last` to assert the active Home tab moves over
 * `cosmosTabs` order (default first, then favorites in pin order, wrap-around), that `tab:new`
 * / `tab:close` cause NO membership change (Home omits both ⇒ no-op, Q4/Q5/FR-013), and that
 * NONE of the commands act while `active={false}` (FR-005).
 *
 * NOTE (FR-008): the "no stray character while a composer is focused" property is guaranteed by
 * main-side `preventDefault` (ARCHITECTURE §4.12) — main consumes the keystroke before the DOM
 * sees it — so it is NOT re-tested here; the renderer never receives the keystroke as input. We
 * assert only the cycle effect.
 *
 * `ActiveTabSurface` + `PromptComposer` are stubbed (mirrors CosmosFavoriteTabs.dom.test) so the
 * panel mounts under jsdom without the A2UI SDK / the composer's measure-gate.
 */
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ShortcutTriggerPayload } from '../../shared/ipc'

// Stub the shared A2UI host so a favorite tab (gone-source) mounts without the SDK/catalog.
vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: () => <div data-testid="fav-surface" />
}))

// Stub the floating PromptComposer so the panel mounts without the real composer's measure gate.
vi.mock('../composer/PromptComposer', () => ({
  PromptComposer: () => <div data-testid="composer" />
}))

import { CosmosPanel } from './CosmosPanel'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { PanelTabsProvider } from '../panelTabs'
import { PanelHostProvider } from '../panelHost'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../../shared/ipc'

// ---------------------------------------------------------------------------
// shortcut trigger capture
// ---------------------------------------------------------------------------
type TriggerHandler = (payload: ShortcutTriggerPayload) => void
let triggerHandler: TriggerHandler | null = null

function fireTrigger(payload: ShortcutTriggerPayload): void {
  if (!triggerHandler) throw new Error('No trigger handler registered — CosmosPanel did not subscribe')
  act(() => {
    triggerHandler!(payload)
  })
}

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }
function snapshotWith(favorites?: SessionSnapshot['favorites']): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: emptyPanel,
      'generated-ui': emptyPanel,
      jira: emptyPanel,
      slack: emptyPanel,
      confluence: emptyPanel,
      'google-calendar': emptyPanel
    },
    enabled: { slack: true, jira: true, confluence: false, 'google-calendar': false },
    ...(favorites ? { favorites } : {})
  }
}

beforeEach(() => {
  triggerHandler = null
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      conversation: {
        getDefault: () => Promise.resolve({ ok: true, conversation: { turns: [], state: 'empty' } }),
        onUpdate: () => () => {}
      },
      agent: { onStatus: () => () => {}, submit: () => {} },
      ui: { onRender: () => () => {}, onDataModel: () => () => {}, sendAction: () => {} },
      session: { save: () => {} },
      shortcuts: {
        onTrigger: (handler: TriggerHandler) => {
          triggerHandler = handler
          return () => {
            triggerHandler = null
          }
        }
      }
    }
  })
})

afterEach(() => {
  triggerHandler = null
  vi.clearAllMocks()
})

/** Two seeded favorites ⇒ Home tabs order is [Cosmos (default), Sprint board, General]. */
const FAVORITES: SessionSnapshot['favorites'] = [
  { panelId: 'jira', tabId: 'j1', label: 'Sprint board' },
  { panelId: 'slack', tabId: 'c1', label: 'General' }
]

function renderHome(opts?: { active?: boolean; favorites?: SessionSnapshot['favorites'] }): void {
  render(
    <TooltipProvider>
      <SessionProvider snapshot={snapshotWith(opts?.favorites ?? FAVORITES)}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <PanelHostProvider>
              <CosmosPanel active={opts?.active ?? true} />
            </PanelHostProvider>
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Cosmos tabs' })
}

/** The label of the currently active (`aria-selected`) Home strip tab. */
function activeTabLabel(): string {
  const active = within(strip())
    .getAllByRole('tab')
    .find((t) => t.getAttribute('aria-selected') === 'true')
  if (!active) throw new Error('no active tab')
  return active.textContent ?? ''
}

function tabLabels(): string[] {
  return within(strip())
    .getAllByRole('tab')
    .map((t) => t.textContent ?? '')
}

describe('Home keyboard tab navigation (COSMOS-KEYBOARD-TAB-NAV-01)', () => {
  it('tab:next / tab:prev cycle the active Home tab over cosmosTabs order with wrap', () => {
    renderHome()
    // Order: [Cosmos, Sprint board, General]; default active.
    expect(activeTabLabel()).toContain('Cosmos')

    fireTrigger({ command: 'tab:next' })
    expect(activeTabLabel()).toContain('Sprint board')

    fireTrigger({ command: 'tab:next' })
    expect(activeTabLabel()).toContain('General')

    // Wrap forward: last → first.
    fireTrigger({ command: 'tab:next' })
    expect(activeTabLabel()).toContain('Cosmos')

    // Wrap backward: first → last.
    fireTrigger({ command: 'tab:prev' })
    expect(activeTabLabel()).toContain('General')
  })

  it('tab:jump activates the indexed tab; an out-of-range index is a no-op', () => {
    renderHome()
    fireTrigger({ command: 'tab:jump', index: 2 })
    expect(activeTabLabel()).toContain('General')

    // Out of range (only 3 tabs, index 0..2) → no change.
    fireTrigger({ command: 'tab:jump', index: 7 })
    expect(activeTabLabel()).toContain('General')
  })

  it('tab:last activates the final Home tab', () => {
    renderHome()
    fireTrigger({ command: 'tab:last' })
    expect(activeTabLabel()).toContain('General')
  })

  it('tab:new and tab:close cause NO membership change in Home (Home omits both ⇒ no-op)', () => {
    renderHome()
    // Move onto a favorite so a stray tab:close could have closed it if Home wired close.
    fireTrigger({ command: 'tab:next' })
    expect(activeTabLabel()).toContain('Sprint board')

    const before = tabLabels()
    fireTrigger({ command: 'tab:new' })
    fireTrigger({ command: 'tab:close' })
    // Membership unchanged AND the active tab still the favorite (no close happened).
    expect(tabLabels()).toEqual(before)
    expect(activeTabLabel()).toContain('Sprint board')
  })

  it('single-tab Home (default only) → tab:next is a no-op', () => {
    renderHome({ favorites: [] })
    expect(tabLabels()).toHaveLength(1)
    fireTrigger({ command: 'tab:next' })
    expect(activeTabLabel()).toContain('Cosmos')
  })

  it('does NOT change the Home active tab while active={false} (FR-005)', () => {
    renderHome({ active: false })
    expect(activeTabLabel()).toContain('Cosmos')
    fireTrigger({ command: 'tab:next' })
    fireTrigger({ command: 'tab:last' })
    fireTrigger({ command: 'tab:jump', index: 1 })
    expect(activeTabLabel()).toContain('Cosmos')
  })
})
