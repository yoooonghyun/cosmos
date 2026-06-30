/**
 * DOM test (jsdom) — a Google Calendar Home favorite renders the LIVE source panel itself (reparented
 * via the panel-host portal) and its default-view fetch fires because the favorite makes the panel
 * VISIBLE (cosmos-favorite-live-panel-portal-v1; SUPERSEDES calendar-favorite-waiting-v1's
 * pinned-sources gate). Scenario CAL-FAVORITE-LIVE-PANEL-01.
 *
 * THE REVERT: calendar-favorite-waiting-v1 gated the default-view fetch on `(active || isActivePinned)`
 * using the pinned-sources channel, because a favorited-but-hidden calendar tab never became `active`.
 * With the portal, `active` is redefined as VISIBLE (rail-active OR hosted in the active Home favorite),
 * so a favorited Calendar tab is genuinely `active` when shown → the plain-`active` gate fires
 * naturally and the pinned-sources hack is gone.
 *
 * Drives the REAL `GoogleCalendarPanel` (connected) through an `<InPortal>` + a `FavoriteSurface` of its
 * restored tab as the Home favorite slot, under the real `PanelHostProvider`. `requestDefaultView` is
 * mocked to push a `google-calendar` frame (simulating main); `ActiveTabSurface` is stubbed to print
 * its `surfaceId` so the live surface inside the reparented panel is assertable without the SDK.
 */
import '@testing-library/jest-dom/vitest'
import { act, useEffect } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { InPortal, OutPortal } from 'react-reverse-portal'

vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

import { GoogleCalendarPanel } from '../calendar/GoogleCalendarPanel'
import { PanelTabsProvider, useAllPanelTabs } from '../panelTabs'
import { PanelHostProvider, usePanelHost } from '../panelHost'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot, type UiRenderPayload } from '../../shared/ipc'
import type { SurfaceId } from '../app/railVisibility'
import { FavoriteSurface } from './FavoriteSurface'

let renderCb: ((p: UiRenderPayload) => void) | null = null
let requestDefaultViewCalls = 0

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }
const snapshot: SessionSnapshot = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  panels: {
    terminal: emptyPanel,
    'generated-ui': emptyPanel,
    jira: emptyPanel,
    slack: emptyPanel,
    confluence: emptyPanel,
    // The RESTORED calendar slice: ONE tab with NO stored surface (the live default view is never
    // persisted) — the post-restart state the favorite points at.
    'google-calendar': { tabs: [{ id: 'g1', label: 'My calendar', untitled: false }], activeTabId: 'g1', everOpened: 1 }
  },
  enabled: { slack: false, jira: false, confluence: false, 'google-calendar': true }
}

beforeEach(() => {
  renderCb = null
  requestDefaultViewCalls = 0
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      ui: {
        onRender: (cb: (p: UiRenderPayload) => void) => {
          renderCb = cb
          return () => {}
        },
        onDataModel: () => () => {},
        onGeneratingBegin: () => () => {},
        sendAction: () => {}
      },
      agent: { onStatus: () => () => {} },
      session: { save: () => {} },
      shortcuts: { onTrigger: () => () => {} },
      googleCalendar: {
        getStatus: () =>
          Promise.resolve({ state: 'connected', accountEmail: 'me@example.com', accountName: 'Me' }),
        onStatusChanged: () => () => {},
        connect: () => Promise.resolve({ state: 'connected' }),
        disconnect: () => Promise.resolve({ state: 'not_connected' }),
        cancelConnect: () => Promise.resolve({ state: 'not_connected' }),
        requestDefaultView: () => {
          requestDefaultViewCalls += 1
          renderCb?.({
            target: 'google-calendar',
            requestId: `gc-${requestDefaultViewCalls}`,
            spec: { surfaceId: 'google-calendar-default-view', components: [] }
          } as UiRenderPayload)
          return Promise.resolve()
        }
      }
    }
  })
})

/** Drives the host signals: `surface` is the visible rail surface; `favorite` activates the g1 favorite. */
function Harness({ surface, favorite }: { surface: SurfaceId; favorite: boolean }): React.JSX.Element {
  const { node, hostFor, panelVisible, setVisibleSurface, setActiveFavoriteSource } = usePanelHost()
  useAllPanelTabs()
  useEffect(() => setVisibleSurface(surface), [surface, setVisibleSurface])
  useEffect(() => {
    setActiveFavoriteSource(favorite ? { panelId: 'google-calendar', tabId: 'g1' } : null)
  }, [favorite, setActiveFavoriteSource])

  return (
    <>
      <InPortal node={node('google-calendar')}>
        <GoogleCalendarPanel active={panelVisible('google-calendar')} />
      </InPortal>
      <div data-testid="rail">
        {hostFor('google-calendar') === 'rail' && <OutPortal node={node('google-calendar')} />}
      </div>
      <div data-testid="home">
        <FavoriteSurface source={{ panelId: 'google-calendar', tabId: 'g1' }} onUnpin={() => {}} />
      </div>
    </>
  )
}

function wrap(surface: SurfaceId, favorite: boolean): React.JSX.Element {
  return (
    <TooltipProvider>
      <SessionProvider snapshot={snapshot}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <PanelHostProvider>
              <Harness surface={surface} favorite={favorite} />
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

describe('calendar favorite = live reparented panel (CAL-FAVORITE-LIVE-PANEL-01)', () => {
  it('A: a calendar favorite active in Home is VISIBLE → its default-view fetch fires → favorite shows the live surface', async () => {
    render(wrap('cosmos', true))
    await settle()

    // The gate revert: hosted in the active favorite ⇒ `active` (visible) ⇒ the default-view fetch fired.
    expect(requestDefaultViewCalls).toBeGreaterThan(0)
    // The favorite shows the live panel's pushed default-view surface (inside the reparented panel).
    const home = within(screen.getByTestId('home'))
    expect(home.getByTestId('fav-surface')).toHaveTextContent('google-calendar-default-view')
  })

  it('B: a hidden, UNfavorited calendar tab is NOT visible → no eager fetch (the gate revert keeps the common case)', async () => {
    render(wrap('cosmos', false))
    await settle()

    // Home is visible but the calendar is neither the rail surface nor a favorite → not visible → no fetch.
    expect(requestDefaultViewCalls).toBe(0)
    // The favorite slot renders nothing live (the node stays in the hidden rail slot).
    expect(within(screen.getByTestId('home')).queryByTestId('fav-surface')).not.toBeInTheDocument()
  })
})
