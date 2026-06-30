/**
 * DOM test (jsdom) — a Confluence Home favorite renders the LIVE source panel itself, reparented via
 * the panel-host portal (cosmos-favorite-live-panel-portal-v1; SUPERSEDES the surface-mirror that
 * confluence-favorite-waiting-v1 / cosmos-native-view-mirror-surface-v1 tested). Scenario
 * CONF-FAVORITE-LIVE-PANEL-01.
 *
 * Drives the REAL `ConfluencePanel` (connected) through an `<InPortal>` at the harness root and a
 * `FavoriteSurface` of its sole tab as the Home favorite slot, under the real `PanelHostProvider`. The
 * behavior under test is the PORTAL host wiring + that the favorite shows the panel's OWN interactive
 * CHROME (the live search box), not a chrome-less re-projected surface:
 *
 *  - LIVE CHROME: with a Confluence favorite active in Home, the favorite slot contains the panel's
 *    real search box (proves it is the live panel, the regression this feature fixes).
 *  - STATE SURVIVES the rail↔favorite relocation: text typed into the live search box while the panel
 *    is hosted on its RAIL slot is still there after the panel relocates into the Home favorite — the
 *    single instance was REPARENTED, never remounted.
 *  - ONE-CLAIMER: the live search box is in EXACTLY ONE of the rail/favorite slots at a time.
 */
import '@testing-library/jest-dom/vitest'
import { act, useEffect } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { InPortal, OutPortal } from 'react-reverse-portal'

import { ConfluencePanel } from '../confluence/ConfluencePanel'
import { PanelTabsProvider, useAllPanelTabs } from '../panelTabs'
import { PanelHostProvider, usePanelHost } from '../panelHost'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot, type UiRenderPayload } from '../../shared/ipc'
import type { SurfaceId } from '../app/railVisibility'
import { FavoriteSurface } from './FavoriteSurface'

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }
const snapshot: SessionSnapshot = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  panels: {
    terminal: emptyPanel,
    'generated-ui': emptyPanel,
    jira: emptyPanel,
    slack: emptyPanel,
    confluence: emptyPanel,
    'google-calendar': emptyPanel
  },
  enabled: { slack: false, jira: false, confluence: true, 'google-calendar': false }
}

beforeEach(() => {
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      ui: {
        onRender: (_cb: (p: UiRenderPayload) => void) => () => {},
        onDataModel: () => () => {},
        onGeneratingBegin: () => () => {},
        sendAction: () => {}
      },
      agent: { onStatus: () => () => {}, submit: () => {} },
      session: { save: () => {} },
      shortcuts: { onTrigger: () => () => {} },
      confluence: {
        getStatus: () => Promise.resolve({ state: 'connected', site: 'acme', accountName: 'Me' }),
        onStatusChanged: () => () => {},
        // The native default feed (ContentList) — an empty page is enough to render the base chrome.
        defaultFeed: () => Promise.resolve({ ok: true, data: { items: [] } }),
        searchContent: () => Promise.resolve({ ok: true, data: { items: [] } }),
        getPage: () => Promise.resolve({ ok: false, kind: 'unknown', message: 'no' })
      }
    }
  })
})

/** Drives the provider's host signals + points the favorite at the panel's (dynamic) seeded tab id. */
function Harness({ surface }: { surface: SurfaceId }): React.JSX.Element {
  const { node, hostFor, panelVisible, setVisibleSurface, setActiveFavoriteSource } = usePanelHost()
  const registry = useAllPanelTabs()
  const tabId = registry.confluence?.tabs?.[0]?.id ?? null

  useEffect(() => setVisibleSurface(surface), [surface, setVisibleSurface])
  // The favorite points at the panel's sole (seeded) tab; activate it only while Home is visible.
  useEffect(() => {
    setActiveFavoriteSource(surface === 'cosmos' && tabId ? { panelId: 'confluence', tabId } : null)
  }, [surface, tabId, setActiveFavoriteSource])

  return (
    <>
      {/* The single live Confluence instance (App-root InPortal). */}
      <InPortal node={node('confluence')}>
        <ConfluencePanel active={panelVisible('confluence')} />
      </InPortal>
      {/* The rail slot. */}
      <div data-testid="rail">
        {hostFor('confluence') === 'rail' && <OutPortal node={node('confluence')} />}
      </div>
      {/* The Home favorite slot. */}
      <div data-testid="home">
        {tabId && <FavoriteSurface source={{ panelId: 'confluence', tabId }} onUnpin={() => {}} />}
      </div>
    </>
  )
}

function wrap(surface: SurfaceId): React.JSX.Element {
  return (
    <TooltipProvider>
      <SessionProvider snapshot={snapshot}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <PanelHostProvider>
              <Harness surface={surface} />
            </PanelHostProvider>
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const SEARCH_LABEL = 'Search Confluence content'

describe('Confluence favorite = live reparented panel (CONF-FAVORITE-LIVE-PANEL-01)', () => {
  it('renders the LIVE panel CHROME (its real search box) in the Home favorite, not a static surface', async () => {
    render(wrap('cosmos'))
    await settle()
    const home = within(screen.getByTestId('home'))
    // The favorite shows the live Confluence panel's OWN search box (interactive chrome) — proof it is
    // the live panel reparented, not a chrome-less re-projected surface.
    expect(home.getByLabelText(SEARCH_LABEL)).toBeInTheDocument()
    // OQ-1 reversal (user feedback): the panel's OWN tab strip is SUPPRESSED in the favorite (no
    // tab-list nested inside a Home tab) — only the active tab's body shows.
    expect(home.queryByRole('tablist', { name: 'Confluence tabs' })).not.toBeInTheDocument()
    // The rail slot is empty (the node is claimed by the favorite).
    expect(within(screen.getByTestId('rail')).queryByLabelText(SEARCH_LABEL)).not.toBeInTheDocument()
  })

  it('state SURVIVES the rail↔favorite move: text typed on the rail is kept in the favorite', async () => {
    const { rerender } = render(wrap('confluence'))
    await settle()
    // On the rail, the live search box is present; type into it.
    const rail = within(screen.getByTestId('rail'))
    const input = rail.getByLabelText(SEARCH_LABEL) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'roadmap' } })
    expect((screen.getByLabelText(SEARCH_LABEL) as HTMLInputElement).value).toBe('roadmap')

    // Relocate the panel into the Home favorite (Home becomes the visible surface).
    rerender(wrap('cosmos'))
    await settle()

    // The SAME live input (its typed value) is now in the favorite slot — reparented, not remounted.
    const home = within(screen.getByTestId('home'))
    const moved = home.getByLabelText(SEARCH_LABEL) as HTMLInputElement
    expect(moved.value).toBe('roadmap')
    // And gone from the rail (one-claimer).
    expect(within(screen.getByTestId('rail')).queryByLabelText(SEARCH_LABEL)).not.toBeInTheDocument()
  })
})
