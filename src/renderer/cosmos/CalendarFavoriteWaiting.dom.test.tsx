/**
 * DOM test (jsdom) — calendar-favorite-waiting-v1. Locks the favorite-mirror seam for Google
 * Calendar and DOCUMENTS + regresses the "Waiting for this tab's view… forever" bug.
 *
 * THE BUG: a Google Calendar tab pinned as a Home favorite shows WAITING forever instead of
 * mirroring the month/week view. THE INVESTIGATION result: the favorite/mirror seam is NOT broken —
 * the calendar's pushed default-view frame IS filed into `tab.surface` by the shared
 * `useGenerativePanelTabs` hook (no `onUnsolicitedFrame` interceptor routes it away), and the
 * favorite resolves `mirrorSurface ?? surface` → it mirrors `tab.surface` whenever it exists. The
 * ROOT CAUSE is upstream in `GoogleCalendarPanel`: its default-view FETCH was gated on `active`, so a
 * pinned-but-HIDDEN calendar tab (e.g. after a restart — the live default view, composed:false, is
 * NOT persisted and re-fetches on restore) never fetched while the user sat in Home → `tab.surface`
 * stayed null → the favorite waited forever. THE FIX: also fetch when the active tab is PINNED,
 * reusing the existing reverse pinned-sources channel (the OQ-3 gate Confluence/Slack use).
 *
 * This test drives the REAL `GoogleCalendarPanel` (active=false, connected, a RESTORED tab with NO
 * surface — the post-restart state) alongside a real `FavoriteSurface` pointing at that tab, with
 * `requestDefaultView` mocked to push a `ui:render` frame (simulating main). Pinning the source tab
 * flips the favorite from WAITING → POPULATED. RED before the fetch-gate fix (no fetch while hidden+
 * unpinned), GREEN after (pinned ⇒ fetch ⇒ surface ⇒ published ⇒ mirrored).
 *
 * `ActiveTabSurface` is STUBBED to render its surface's `surfaceId` so the inline mirror is
 * assertable without driving the A2UI SDK + calendar catalog (same approach as
 * `ConfluenceFavoriteWaiting.dom.test.tsx`). The favorite is scoped under a `home` container so its
 * surface is asserted independently of the panel's own (un-hidden) render.
 */
import '@testing-library/jest-dom/vitest'
import { act, useEffect } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

import { GoogleCalendarPanel } from '../calendar/GoogleCalendarPanel'
import {
  PanelTabsProvider,
  usePublishPins,
  useAllPanelTabs,
  pinnedSourceKey
} from '../panelTabs'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot, type UiRenderPayload } from '../../shared/ipc'
import { FavoriteSurface } from './FavoriteSurface'

let renderCb: ((p: UiRenderPayload) => void) | null = null
let requestDefaultViewCalls = 0

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }
// The RESTORED calendar slice: ONE tab with NO stored surface (the live default view is never
// persisted), id preserved by `hydrateGenerativeTabs` — exactly the post-restart state the favorite
// points at while the panel sits hidden behind Home.
const snapshot: SessionSnapshot = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  panels: {
    terminal: emptyPanel,
    'generated-ui': emptyPanel,
    jira: emptyPanel,
    slack: emptyPanel,
    confluence: emptyPanel,
    'google-calendar': {
      tabs: [{ id: 'g1', label: 'My calendar', untitled: false }],
      activeTabId: 'g1',
      everOpened: 1
    }
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
          Promise.resolve({
            state: 'connected',
            accountEmail: 'me@example.com',
            accountName: 'Me'
          }),
        onStatusChanged: () => () => {},
        connect: () => Promise.resolve({ state: 'connected' }),
        disconnect: () => Promise.resolve({ state: 'not_connected' }),
        cancelConnect: () => Promise.resolve({ state: 'not_connected' }),
        // Simulate main: a default-view request pushes an UNSOLICITED `google-calendar` frame the
        // shared hook files into the active tab's `surface` (an EventList-rooted month view).
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

/** Publishes the given pinned-source keys (Cosmos → panels) on mount/update. */
function PinsPublisher({ keys }: { keys: string[] }): React.ReactElement | null {
  const publish = usePublishPins()
  useEffect(() => {
    publish(new Set(keys))
  }, [publish, keys])
  return null
}

/** Re-render the registry consumer so the favorite picks up publishes (FavoriteSurface reads it). */
function RegistryProbe(): null {
  useAllPanelTabs()
  return null
}

function Harness({ pinnedKeys }: { pinnedKeys: string[] }): React.JSX.Element {
  return (
    <>
      <PinsPublisher keys={pinnedKeys} />
      <RegistryProbe />
      {/* The SOURCE panel — hidden behind Home, so active=false. */}
      <GoogleCalendarPanel active={false} />
      {/* Home's inline favorite mirror of the calendar tab. */}
      <div data-testid="home">
        <FavoriteSurface source={{ panelId: 'google-calendar', tabId: 'g1' }} onUnpin={() => {}} />
      </div>
    </>
  )
}

function wrap(children: React.ReactNode): React.JSX.Element {
  return (
    <SessionProvider snapshot={snapshot}>
      <ActiveComposerProvider>
        <PanelTabsProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </PanelTabsProvider>
      </ActiveComposerProvider>
    </SessionProvider>
  )
}

describe('calendar favorite mirror (calendar-favorite-waiting-v1)', () => {
  it('A: a PINNED, hidden calendar tab with no surface fetches its default view → favorite is POPULATED', async () => {
    render(wrap(<Harness pinnedKeys={[pinnedSourceKey('google-calendar', 'g1')]} />))
    // Let getStatus resolve (connected) + the pinned-gated default-view fetch fire + the pushed
    // frame file into tab.surface + publish to the registry + the favorite re-render.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const home = within(screen.getByTestId('home'))
    // POPULATED: the favorite mirrors the calendar's pushed default-view surface (NOT WAITING).
    expect(home.getByTestId('fav-surface')).toHaveTextContent('google-calendar-default-view')
    expect(home.queryByText(/Waiting for this tab/)).not.toBeInTheDocument()
    // The fix's mechanism: the hidden-but-pinned tab DID fetch.
    expect(requestDefaultViewCalls).toBeGreaterThan(0)
  })

  it('B: an UNPINNED, hidden calendar tab never fetches → favorite stays WAITING (gate unchanged)', async () => {
    render(wrap(<Harness pinnedKeys={[]} />))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const home = within(screen.getByTestId('home'))
    // No favorite points at it ⇒ a hidden panel does not eager-read (the pre-fix gate, preserved for
    // non-pinned tabs) ⇒ the favorite stays on the calm WAITING placeholder.
    expect(home.getByText(/Waiting for this tab/)).toBeInTheDocument()
    expect(home.queryByTestId('fav-surface')).not.toBeInTheDocument()
    expect(requestDefaultViewCalls).toBe(0)
  })
})
