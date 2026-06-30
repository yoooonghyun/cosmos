/**
 * DOM test (jsdom) for the Home favorite-tabs flow (cosmos-home-favorite-tabs-v1).
 * Scenario: COSMOS-FAVORITE-TABS-01 — right-click a tree row → Pin → a favorite appears in Home's
 * strip after the pinned default; clicking it renders the SOURCE tab's LIVE surface inline; the
 * mirror reflects a source-surface change (live, not a snapshot); a gone source shows the calm
 * "no longer open" state + Unpin; the strip `X` / context menu unpins; a terminal row's Pin is
 * disabled; restored favorites seed on mount.
 *
 * Corrections (user feedback): a FAVORITE tab is a FULL-WIDTH source mirror — it HIDES the
 * cross-panel tree (which renders only on the default tab) AND hides the docked Cosmos composer
 * (Home publishes a null 'cosmos' config), and shows the SOURCE panel's OWN floating Open Prompt
 * whose `onSubmit` routes to the SOURCE target (jira/slack/…), not the Cosmos conversation.
 *
 * Renders the REAL `CosmosPanel` under the real providers + a sibling publisher (the
 * `usePublishPanelTabs` path the four generative panels use). `ActiveTabSurface` is STUBBED to render
 * its surface's `surfaceId` so the inline live-mirror is assertable without driving the A2UI SDK +
 * jira catalog — the FavoriteSurface wiring (which surface it mounts, and that it re-renders on a
 * re-publish) is the behavior under test, not the SDK's own rendering.
 */
import '@testing-library/jest-dom/vitest'
import { act, useMemo } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

// Stub the shared A2UI host so the inline favorite is assertable without the SDK/catalog.
vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

// Stub the floating PromptComposer so the favorite's Open Prompt wiring is assertable without the
// real composer's measure/visibility gate (its collapsed logo is `visibility:hidden` until the panel
// box is measured, which jsdom cannot do). The stub records the props it received + renders a button
// that fires `onSubmit`, so the test can prove the favorite mounts the SOURCE composer's onSubmit.
const composerSpy: { onSubmit: ((u: string) => void) | null; ariaLabel: string | null } = {
  onSubmit: null,
  ariaLabel: null
}
vi.mock('../composer/PromptComposer', () => ({
  PromptComposer: (props: { onSubmit: (u: string) => void; ariaLabel: string; mode?: string }) => {
    composerSpy.onSubmit = props.onSubmit
    composerSpy.ariaLabel = props.ariaLabel
    return (
      <button
        data-testid="favorite-open-prompt"
        aria-label={props.ariaLabel}
        onClick={() => props.onSubmit('ask the source')}
      >
        Open prompt
      </button>
    )
  }
}))

import { CosmosPanel } from './CosmosPanel'
import {
  ActiveComposerProvider,
  usePublishComposer,
  useActiveComposerConfig
} from '../composer/ActiveComposerProvider'
import type { ComposerConfig } from '../composer/activeComposer'
import { PanelTabsProvider, usePublishPanelTabs, type LivePanelTabs } from '../panelTabs'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../../shared/ipc'

/** The source (Jira) panel's published composer onSubmit — proves a favorite submit routes to source. */
const jiraSubmit = vi.fn()
/** The latest 'cosmos' composer config the registry holds (null ⇒ the docked Cosmos composer hides). */
let cosmosConfig: ComposerConfig | null = null

/** Publishes the Jira panel's composer config (unconditionally, as the real JiraPanel does). */
function JiraComposerPublisher(): null {
  usePublishComposer(
    'jira',
    useMemo(
      () => ({
        onSubmit: jiraSubmit,
        placeholder: 'Ask about your Jira issues…',
        ariaLabel: 'Ask about your Jira issues'
      }),
      []
    )
  )
  return null
}

/** Reads the 'cosmos' composer config so a test can assert the docked composer is hidden (null). */
function CosmosComposerProbe(): null {
  cosmosConfig = useActiveComposerConfig('cosmos')
  return null
}

beforeEach(() => {
  composerSpy.onSubmit = null
  composerSpy.ariaLabel = null
  cosmosConfig = null
  // Radix Menu touches these jsdom-missing APIs; stub them so the context menu opens/closes cleanly.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false) as never
  Element.prototype.setPointerCapture = vi.fn() as never
  Element.prototype.releasePointerCapture = vi.fn() as never
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
      shortcuts: { onTrigger: () => () => {} },
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
  // NB: do NOT manually clear `document.body` — Radix menus portal into it; RTL's auto-cleanup
  // unmounts the React root (and its portals) correctly, while a manual wipe races the portal
  // removal and throws "node to be removed is not a child" when a menu is left open at test end.
  vi.clearAllMocks()
})

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
    // Jira + Terminal visible so both groups show in the tree (terminal is always present).
    enabled: { slack: false, jira: true, confluence: false, 'google-calendar': false },
    ...(favorites ? { favorites } : {})
  }
}

const surfaceOf = (surfaceId: string) =>
  ({ requestId: `req-${surfaceId}`, spec: { surfaceId, components: [] } }) as never

/** A jira tab carrying a live surface, plus a terminal tab (to test the disabled Pin). */
function tabsWith(jiraSurfaceId: string | null): { jira: LivePanelTabs; terminal: LivePanelTabs } {
  return {
    jira: {
      tabs: [{ id: 'j1', label: 'Sprint board', surface: jiraSurfaceId ? surfaceOf(jiraSurfaceId) : null }],
      activeTabId: 'j1'
    },
    terminal: { tabs: [{ id: 't1', label: 'Terminal', surface: null }], activeTabId: 't1' }
  }
}

function Publisher({ jira, terminal }: { jira: LivePanelTabs | null; terminal: LivePanelTabs }): null {
  usePublishPanelTabs('jira', useMemo(() => jira, [jira]))
  usePublishPanelTabs('terminal', useMemo(() => terminal, [terminal]))
  return null
}

function renderApp(opts?: {
  jiraSurfaceId?: string | null
  jiraPresent?: boolean
  favorites?: SessionSnapshot['favorites']
}): { rerender: (o?: { jiraSurfaceId?: string | null; jiraPresent?: boolean }) => void } {
  const build = (o?: { jiraSurfaceId?: string | null; jiraPresent?: boolean }): React.JSX.Element => {
    const sid = o?.jiraSurfaceId === undefined ? (opts?.jiraSurfaceId ?? 's-board') : o.jiraSurfaceId
    const present = o?.jiraPresent ?? opts?.jiraPresent ?? true
    const t = tabsWith(sid)
    return (
      <TooltipProvider>
        <SessionProvider snapshot={snapshotWith(opts?.favorites)}>
          <ActiveComposerProvider>
            <PanelTabsProvider>
              <CosmosPanel active />
              <Publisher jira={present ? t.jira : null} terminal={t.terminal} />
              <JiraComposerPublisher />
              <CosmosComposerProbe />
            </PanelTabsProvider>
          </ActiveComposerProvider>
        </SessionProvider>
      </TooltipProvider>
    )
  }
  const { rerender } = render(build())
  return { rerender: (o) => rerender(build(o)) }
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Cosmos tabs' })
}
function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Open panel tabs' })
}
/** The cross-panel tree, or null when it is not rendered (a favorite tab hides it). */
function treeOrNull(): HTMLElement | null {
  return screen.queryByRole('tree', { name: 'Open panel tabs' })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** The level-2 tab row (not the level-1 group header) carrying `label`. */
function tabRow(label: string): HTMLElement {
  const row = within(tree())
    .getAllByRole('treeitem')
    .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes(label))
  if (!row) {
    throw new Error(`tab row "${label}" not found`)
  }
  return row
}

/** Right-click the named tree TAB row to open its Pin/Unpin menu. */
function openRowMenu(label: string): void {
  fireEvent.contextMenu(tabRow(label), { clientX: 10, clientY: 10 })
}

/**
 * Activate a favorite by clicking its strip tab. Pinning is now NON-DISRUPTIVE (it no longer
 * navigates to the favorite), so a test that asserts favorite-active behavior must click the strip
 * tab first.
 */
function activateStripTab(label: string): void {
  fireEvent.click(within(strip()).getByRole('tab', { name: new RegExp(label) }))
}

describe('Home favorite tabs (COSMOS-FAVORITE-TABS-01)', () => {
  it('right-click a tree row → Pin → a favorite appears in the strip after the default', async () => {
    renderApp()
    await settle()
    // Only the default "Cosmos" tab to start.
    expect(within(strip()).getByRole('tab', { name: /Cosmos/ })).toBeInTheDocument()

    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))

    // A favorite tab labeled by the source appears in the strip.
    const favTab = within(strip()).getByRole('tab', { name: /Sprint board/ })
    expect(favTab).toBeInTheDocument()
    // It is AFTER the default tab.
    const tabs = within(strip()).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Cosmos')
    expect(tabs[1]).toHaveTextContent('Sprint board')
    // NON-DISRUPTIVE pin: the default "Cosmos" tab stays ACTIVE (pinning does NOT navigate to the
    // favorite) and the default content — the cross-panel tree — is still shown.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(favTab).toHaveAttribute('aria-selected', 'false')
    expect(treeOrNull()).toBeInTheDocument()
  })

  it('clicking the favorite renders the SOURCE live surface inline; a re-publish mirrors live', async () => {
    const { rerender } = renderApp({ jiraSurfaceId: 's-board' })
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))

    // Pinning is non-disruptive — CLICK the favorite strip tab to activate it, then the inline
    // surface shows the source surfaceId.
    activateStripTab('Sprint board')
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('s-board')
    // The default conversation placeholder is NOT shown (we are on the favorite tab).
    expect(screen.queryByText(/Describe a UI below/)).not.toBeInTheDocument()

    // LIVE MIRROR: the source re-publishes a NEW surface → the inline mirror reflects it.
    act(() => {
      rerender({ jiraSurfaceId: 's-board-v2' })
    })
    expect(screen.getByTestId('fav-surface')).toHaveTextContent('s-board-v2')
  })

  it('a gone source shows the calm "no longer open" state + Unpin (never auto-dropped)', async () => {
    const { rerender } = renderApp({ jiraSurfaceId: 's-board' })
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board') // non-disruptive pin → click to activate the favorite
    expect(screen.getByTestId('fav-surface')).toBeInTheDocument()

    // The source tab/panel closes (publisher stops publishing jira).
    act(() => {
      rerender({ jiraPresent: false })
    })
    // The favorite is KEPT in the strip, and the body shows the calm gone state with Unpin.
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()
    expect(screen.getByText('This tab is no longer open')).toBeInTheDocument()
    const unpin = screen.getByRole('button', { name: 'Unpin' })
    fireEvent.click(unpin)
    // Unpinned → the favorite is gone, focus back on the default conversation.
    expect(within(strip()).queryByRole('tab', { name: /Sprint board/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Describe a UI below/)).toBeInTheDocument()
  })

  it("the favorite's close X unpins it and returns to the default tab", async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()

    // The favorite tab's close affordance unpins it.
    fireEvent.click(within(strip()).getByRole('button', { name: 'Close Sprint board' }))
    expect(within(strip()).queryByRole('tab', { name: /Sprint board/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Describe a UI below/)).toBeInTheDocument()
  })

  it('a pinned tree row shows Unpin instead of Pin (state-reflective, FR-002)', async () => {
    // Seed an already-pinned favorite so the row reflects the pinned state on first open.
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] })
    await settle()
    openRowMenu('Sprint board')
    expect(await screen.findByRole('menuitem', { name: /Unpin/ })).toBeInTheDocument()
  })

  it("a terminal tree row's Pin is disabled with a reason (FR-040)", async () => {
    renderApp()
    await settle()
    openRowMenu('Terminal')
    const pin = await screen.findByRole('menuitem', { name: /Pin/ })
    expect(pin).toHaveAttribute('data-disabled')
    expect(screen.getByText(/Terminal tabs can't be pinned/)).toBeInTheDocument()
  })

  it('restored favorites seed the strip on mount (FR-030)', async () => {
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] })
    await settle()
    // The favorite is present from the persisted snapshot, after the default.
    const tabs = within(strip()).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Cosmos')
    expect(tabs[1]).toHaveTextContent('Sprint board')
  })

  it('the DEFAULT tab shows the tree + the docked Cosmos composer, NOT a favorite Open Prompt', async () => {
    renderApp()
    await settle()
    // Default tab: the cross-panel tree is visible, the docked Cosmos composer config is published,
    // and there is no source Open Prompt.
    expect(treeOrNull()).toBeInTheDocument()
    expect(cosmosConfig).not.toBeNull()
    expect(screen.queryByTestId('favorite-open-prompt')).not.toBeInTheDocument()
  })

  it('a FAVORITE tab is FULL-WIDTH: hides the tree (correction #1)', async () => {
    renderApp()
    await settle()
    expect(treeOrNull()).toBeInTheDocument() // tree present on the default tab
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    await settle()
    // Pinning is non-disruptive — still on the default tab, tree still present.
    expect(treeOrNull()).toBeInTheDocument()
    // Activate the favorite; now the tree is GONE (the favorite content fills the full width).
    activateStripTab('Sprint board')
    await settle()
    expect(treeOrNull()).not.toBeInTheDocument()
    // The favorite's source surface still renders.
    expect(screen.getByTestId('fav-surface')).toBeInTheDocument()
  })

  it("a FAVORITE tab hides the docked Cosmos composer and shows the SOURCE's Open Prompt routing to the source (correction #2)", async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board') // non-disruptive pin → click to activate the favorite
    await settle()

    // The docked Cosmos composer is hidden — Home publishes a NULL 'cosmos' config while a favorite
    // is active (so the App-level SharedComposer renders nothing for Home).
    expect(cosmosConfig).toBeNull()

    // The favorite shows the SOURCE (Jira) panel's own floating Open Prompt — its ariaLabel + onSubmit
    // are the source's published config, NOT the Cosmos conversation composer.
    const openPrompt = screen.getByTestId('favorite-open-prompt')
    expect(openPrompt).toHaveAttribute('aria-label', 'Ask about your Jira issues')
    expect(composerSpy.onSubmit).toBe(jiraSubmit)

    // Submitting through it routes to the SOURCE target (the Jira panel's onSubmit), not cosmos.
    fireEvent.click(openPrompt)
    expect(jiraSubmit).toHaveBeenCalledTimes(1)
  })

  it('switching back to the default tab restores the tree + docked composer (no favorite Open Prompt)', async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board') // non-disruptive pin → click to activate the favorite
    await settle()
    expect(treeOrNull()).not.toBeInTheDocument()

    // Click the default "Cosmos" tab.
    fireEvent.click(within(strip()).getByRole('tab', { name: /Cosmos/ }))
    await settle()
    expect(treeOrNull()).toBeInTheDocument()
    expect(cosmosConfig).not.toBeNull()
    expect(screen.queryByTestId('favorite-open-prompt')).not.toBeInTheDocument()
  })
})
