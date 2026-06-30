/**
 * DOM test (jsdom) — confluence-favorite-waiting-v1. Locks the favorite-mirror seam for Confluence
 * and DOCUMENTS the root cause of the "Waiting for this tab's view… forever" bug.
 *
 * THE BUG (verified): a Confluence tab pinned as a Home favorite shows WAITING forever instead of
 * mirroring the page. THE INVESTIGATION result: the publish path (`useGenerativePanelTabs`'s publish
 * memo → `PanelTabsProvider` registry) and `FavoriteSurface` are NOT broken — whenever a Confluence
 * tab carries a `TabSurface`, the favorite renders it (POPULATED). The WAITING state is correct for a
 * genuinely-null surface. The root cause is upstream: Confluence renders its native browsing views
 * (the `defaultFeed`/`searchContent` `ContentList` and the page-detail dock's native `PageDetail`,
 * `genUiPage`) as NATIVE React and never writes a `TabSurface` into the tab record, so `t.surface`
 * stays null and the published `LivePanelTab.surface` is null. Jira never hits this because its
 * default view IS a pushed bound surface (`jira:requestDefaultView`); Slack shares the same gap for
 * its native channel/history views (only composed surfaces mirror).
 *
 * Test A drives the REAL `useGenerativePanelTabs` for target 'confluence' end-to-end: a composed
 * `ui:render` confluence frame lands in `t.surface`, publishes through the registry, and the favorite
 * renders POPULATED — proving the seam works once a surface exists.
 * Test B publishes a confluence tab whose surface is null (the native-browsing state) and asserts the
 * favorite shows the WAITING placeholder — the documented root-cause state.
 *
 * `ActiveTabSurface` is STUBBED to render its surface's `surfaceId` so the inline mirror is assertable
 * without driving the A2UI SDK + confluence catalog (the FavoriteSurface wiring is the behavior under
 * test, not the SDK's own rendering — same approach as `CosmosFavoriteTabs.dom.test.tsx`).
 */
import '@testing-library/jest-dom/vitest'
import { act, useEffect, useMemo } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

import { useGenerativePanelTabs } from '../tabs/useGenerativePanelTabs'
import {
  PanelTabsProvider,
  usePublishPanelTabs,
  useAllPanelTabs,
  usePublishPins,
  usePinnedSources,
  pinnedSourceKey,
  type LivePanelTabs
} from '../panelTabs'
import { ActiveComposerProvider } from '../composer/ActiveComposerProvider'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot, type UiRenderPayload } from '../../shared/ipc'
import { FavoriteSurface } from './FavoriteSurface'

let renderCb: ((p: UiRenderPayload) => void) | null = null

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
  renderCb = null
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
      session: { save: () => {} }
    }
  })
})

/** Test A harness: a real confluence panel-tabs hook + a favorite mirror of its (sole) tab. */
function HookHarness(): React.JSX.Element {
  const { tabs, activeTabId } = useGenerativePanelTabs({ target: 'confluence', panelName: 'Confluence' })
  const tabId = tabs[0]?.id ?? activeTabId
  return (
    <div>
      {tabId && <FavoriteSurface source={{ panelId: 'confluence', tabId }} onUnpin={() => {}} />}
    </div>
  )
}

/**
 * Test B/C/D harness: publish a tab with the given COMPOSED surface + NATIVE mirror state, then
 * mirror it. `surfaceId`/`mirrorSurfaceId` null/undefined ⇒ that field is absent. The favorite
 * resolves `mirrorSurface ?? surface` (cosmos-native-view-mirror-surface-v1, FR-007).
 */
function PublishHarness({
  panelId = 'confluence',
  surfaceId,
  mirrorSurfaceId
}: {
  panelId?: 'confluence' | 'slack'
  surfaceId: string | null
  mirrorSurfaceId?: string | null
}): React.JSX.Element {
  const live = useMemo<LivePanelTabs>(
    () => ({
      tabs: [
        {
          id: 'c1',
          label: 'My view',
          surface: surfaceId ? ({ requestId: 'r', spec: { surfaceId, components: [] } } as never) : null,
          mirrorSurface: mirrorSurfaceId
            ? ({ requestId: 'm', spec: { surfaceId: mirrorSurfaceId, components: [] } } as never)
            : null
        }
      ],
      activeTabId: 'c1'
    }),
    [surfaceId, mirrorSurfaceId]
  )
  usePublishPanelTabs(panelId, live)
  // Probe so the registry read re-renders (FavoriteSurface itself calls useAllPanelTabs).
  useAllPanelTabs()
  return <FavoriteSurface source={{ panelId, tabId: 'c1' }} onUnpin={() => {}} />
}

function wrap(children: React.ReactNode): React.JSX.Element {
  return (
    <SessionProvider snapshot={snapshot}>
      <ActiveComposerProvider>
        <PanelTabsProvider>{children}</PanelTabsProvider>
      </ActiveComposerProvider>
    </SessionProvider>
  )
}

describe('confluence favorite mirror (confluence-favorite-waiting-v1)', () => {
  it('A: a composed confluence frame populates the published surface → favorite is POPULATED', async () => {
    render(wrap(<HookHarness />))
    await act(async () => {
      await Promise.resolve()
    })
    // A composed/native confluence frame lands → the hook files it into the tab's surface and
    // publishes it; the favorite mounts that live surface (NOT the WAITING placeholder).
    await act(async () => {
      renderCb?.({
        target: 'confluence',
        requestId: 'req-1',
        spec: { surfaceId: 'confluence-search', components: [] }
      } as UiRenderPayload)
      await Promise.resolve()
    })
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('confluence-search')
    expect(screen.queryByText(/Waiting for this tab/)).not.toBeInTheDocument()
  })

  it('B: a Confluence tab with NO surface AND no mirror (e.g. not pinned / no data) → WAITING', async () => {
    render(wrap(<PublishHarness surfaceId={null} mirrorSurfaceId={null} />))
    await act(async () => {
      await Promise.resolve()
    })
    // The GATE outcome (OQ-3): an UNPINNED native-browsing tab publishes mirrorSurface:null (the
    // panel never builds a mirror nobody pinned), so the favorite stays on the calm WAITING state —
    // exactly the pre-feature behavior for this case.
    expect(screen.getByText(/Waiting for this tab/)).toBeInTheDocument()
    expect(screen.queryByTestId('fav-surface')).not.toBeInTheDocument()
  })

  // cosmos-native-view-mirror-surface-v1: the feature — a native-view MIRROR now renders POPULATED
  // (was WAITING before, with surface null). RED→GREEN: pre-feature there was no `mirrorSurface`, so
  // a native-browsing tab (surface null) could ONLY be WAITING (Test B's old shape).
  it('C: a Confluence tab whose mirrorSurface is a native FEED → favorite is POPULATED (not WAITING)', async () => {
    render(wrap(<PublishHarness surfaceId={null} mirrorSurfaceId="confluence-feed" />))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('confluence-feed')
    expect(screen.queryByText(/Waiting for this tab/)).not.toBeInTheDocument()
  })

  it('D: a Slack tab whose mirrorSurface is a native CHANNEL LIST → favorite is POPULATED', async () => {
    render(wrap(<PublishHarness panelId="slack" surfaceId={null} mirrorSurfaceId="slack-channels" />))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('slack-channels')
    expect(screen.queryByText(/Waiting for this tab/)).not.toBeInTheDocument()
  })

  it('E: a COMPOSED surface present (mirror nulled by the projection) → favorite shows the composed surface', async () => {
    // Mutual exclusivity (FR-007): the publish projection nulls the mirror whenever a composed
    // surface is present, so `mirrorSurface ?? surface` resolves to the composed surface.
    render(wrap(<PublishHarness surfaceId="confluence-search" mirrorSurfaceId={null} />))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('confluence-search')
  })
})

/** A reader that records the latest pinned-source membership for `confluence:c1`. */
function PinsProbe({ onRead }: { onRead: (has: boolean) => void }): React.ReactElement | null {
  const pins = usePinnedSources()
  onRead(pins.has(pinnedSourceKey('confluence', 'c1')))
  return null
}

/** Publishes the given pinned-source keys (Cosmos → panels) on mount/update. */
function PinsPublisher({ keys }: { keys: string[] }): React.ReactElement | null {
  const publish = usePublishPins()
  useEffect(() => {
    publish(new Set(keys))
  }, [publish, keys])
  return null
}

describe('pinned-sources reverse channel (cosmos-native-view-mirror-surface-v1, D6 gate)', () => {
  it('publishes the pinned set Cosmos→panels so a panel can gate its mirror build', async () => {
    let lastRead = false
    const { rerender } = render(
      wrap(
        <>
          <PinsPublisher keys={[]} />
          <PinsProbe onRead={(h) => (lastRead = h)} />
        </>
      )
    )
    await act(async () => {
      await Promise.resolve()
    })
    // Not pinned yet → the gate is closed (the panel would skip the mirror build).
    expect(lastRead).toBe(false)

    // Cosmos pins confluence:c1 → the reverse channel flips the gate open.
    rerender(
      wrap(
        <>
          <PinsPublisher keys={[pinnedSourceKey('confluence', 'c1')]} />
          <PinsProbe onRead={(h) => (lastRead = h)} />
        </>
      )
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(lastRead).toBe(true)
  })
})
