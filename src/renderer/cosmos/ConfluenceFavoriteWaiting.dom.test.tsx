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
import { act, useMemo } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

import { useGenerativePanelTabs } from '../tabs/useGenerativePanelTabs'
import { PanelTabsProvider, usePublishPanelTabs, useAllPanelTabs, type LivePanelTabs } from '../panelTabs'
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

/** Test B harness: publish a confluence tab with the given surface state, then mirror it. */
function PublishHarness({ surfaceId }: { surfaceId: string | null }): React.JSX.Element {
  const live = useMemo<LivePanelTabs>(
    () => ({
      tabs: [
        {
          id: 'c1',
          label: 'My page',
          surface: surfaceId ? ({ requestId: 'r', spec: { surfaceId, components: [] } } as never) : null
        }
      ],
      activeTabId: 'c1'
    }),
    [surfaceId]
  )
  usePublishPanelTabs('confluence', live)
  // Probe so the registry read re-renders (FavoriteSurface itself calls useAllPanelTabs).
  useAllPanelTabs()
  return <FavoriteSurface source={{ panelId: 'confluence', tabId: 'c1' }} onUnpin={() => {}} />
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

  it('B: a Confluence tab whose surface is null (native browsing) → favorite shows WAITING', async () => {
    render(wrap(<PublishHarness surfaceId={null} />))
    await act(async () => {
      await Promise.resolve()
    })
    // Root cause: Confluence native views never populate `tab.surface`, so the published surface is
    // null and the favorite is stuck on WAITING. (The seam is correct — this is the upstream gap.)
    expect(screen.getByText(/Waiting for this tab/)).toBeInTheDocument()
    expect(screen.queryByTestId('fav-surface')).not.toBeInTheDocument()
  })
})
