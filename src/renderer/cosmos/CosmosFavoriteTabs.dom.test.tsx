/**
 * DOM test (jsdom) for the Home favorite-tabs flow (cosmos-home-favorite-tabs-v1) UPDATED for the
 * live-panel reparenting portal (cosmos-favorite-live-panel-portal-v1). Scenario COSMOS-FAVORITE-TABS-01.
 *
 * The favorites LIFECYCLE is unchanged (pin/unpin, non-disruptive pin, persist-by-reference, gone-state,
 * terminal-pinnable, tree/composer hide on a favorite). What CHANGED: a favorite of a generative panel
 * now renders the LIVE source panel ITSELF — relocated via the panel-host portal — NOT a re-projected
 * A2UI surface. So the harness mounts a STUB Jira panel ONCE through an `<InPortal>` (standing in for the
 * App-root force-mounted JiraPanel); activating the favorite REPARENTS that node into the Home favorite
 * slot (`jira-live` appears). The stub also wires `useTabShortcuts` + `onFocusTab` so the test can prove:
 *  - FOCUS-ON-ACTIVATION (FR-006): activating a favorite of jira tab `j2` focuses the live panel to `j2`.
 *  - KEYBOARD OWNERSHIP (OQ-3): while a generative favorite is active, `tab:*` targets the INNER panel
 *    (it is visible) and Home CEDES (its `useTabShortcuts` is gated `active && !favoriteActive`).
 *
 * Renders the REAL `CosmosPanel` under the real providers + a sibling publisher (label-only now). The
 * floating `PromptComposer` is stubbed to assert the favorite surfaces the SOURCE composer's onSubmit.
 */
import '@testing-library/jest-dom/vitest'
import { act, useMemo, useState, useRef, useEffect } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { InPortal } from 'react-reverse-portal'

// Stub the floating PromptComposer so the favorite's Open Prompt wiring is assertable without the real
// composer's measure/visibility gate. Records props + renders a button that fires `onSubmit`.
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
import { PanelHostProvider, usePanelHost } from '../panelHost'
import { useTabShortcuts } from '../tabs/useTabShortcuts'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type SessionSnapshot } from '../../shared/ipc'

/** The source (Jira) panel's published composer onSubmit — proves a favorite submit routes to source. */
const jiraSubmit = vi.fn()
/** The latest 'cosmos' composer config the registry holds (null ⇒ the docked Cosmos composer hides). */
let cosmosConfig: ComposerConfig | null = null
/** A bus so a `tab:*` shortcut reaches BOTH Home's and the inner panel's `useTabShortcuts`. */
let shortcutListeners: ((p: { command: string; index?: number }) => void)[] = []
function fireShortcut(p: { command: string; index?: number }): void {
  act(() => {
    shortcutListeners.forEach((l) => l(p))
  })
}

/** The live STUB Jira panel (stands in for the App-root force-mounted JiraPanel), reparented by the
 *  portal into the favorite. Wires `useTabShortcuts` (gated on visibility) + `onFocusTab` so the test
 *  can assert keyboard ownership + focus-on-activation. */
function StubJiraPanel(): React.JSX.Element {
  const { panelVisible, hostFor, onFocusTab } = usePanelHost()
  const [activeTabId, setActiveTabId] = useState('j1')
  const tabs = useMemo(() => [{ id: 'j1' }, { id: 'j2' }], [])
  const setActiveRef = useRef(setActiveTabId)
  setActiveRef.current = setActiveTabId
  useEffect(() => onFocusTab('jira', (id) => setActiveRef.current(id)), [onFocusTab])
  // Mirror the real panels: the inner strip's `tab:*` binds ONLY on the rail surface (NOT while hosted
  // in a favorite, where the strip is suppressed and Home owns the shortcuts).
  useTabShortcuts({
    active: panelVisible('jira') && hostFor('jira') !== 'favorite',
    tabs,
    activeTabId,
    onActivate: setActiveTabId
  })
  return <div data-testid="jira-live" data-active-tab={activeTabId} />
}

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
  shortcutListeners = []
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
      shortcuts: {
        onTrigger: (cb: (p: { command: string; index?: number }) => void) => {
          shortcutListeners.push(cb)
          return () => {
            shortcutListeners = shortcutListeners.filter((l) => l !== cb)
          }
        }
      },
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
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
    enabled: { slack: false, jira: true, confluence: false, 'google-calendar': false },
    ...(favorites ? { favorites } : {})
  }
}

/** Two jira tabs (label-only published) + a terminal tab (to test the terminal Pin). */
function tabsWith(): { jira: LivePanelTabs; terminal: LivePanelTabs } {
  return {
    jira: {
      tabs: [
        { id: 'j1', label: 'Sprint board' },
        { id: 'j2', label: 'PROJ-9' }
      ],
      activeTabId: 'j1'
    },
    terminal: { tabs: [{ id: 't1', label: 'Terminal' }], activeTabId: 't1' }
  }
}

function Publisher({ jira, terminal }: { jira: LivePanelTabs | null; terminal: LivePanelTabs }): null {
  usePublishPanelTabs('jira', useMemo(() => jira, [jira]))
  usePublishPanelTabs('terminal', useMemo(() => terminal, [terminal]))
  return null
}

/** The reparenting host: the live stub Jira panel via InPortal (mounted once). */
function JiraHost(): React.JSX.Element {
  const { node } = usePanelHost()
  return (
    <InPortal node={node('jira')}>
      <StubJiraPanel />
    </InPortal>
  )
}

function renderApp(opts?: {
  jiraPresent?: boolean
  favorites?: SessionSnapshot['favorites']
}): { rerender: (o?: { jiraPresent?: boolean }) => void } {
  const build = (o?: { jiraPresent?: boolean }): React.JSX.Element => {
    const present = o?.jiraPresent ?? opts?.jiraPresent ?? true
    const t = tabsWith()
    return (
      <TooltipProvider>
        <SessionProvider snapshot={snapshotWith(opts?.favorites)}>
          <ActiveComposerProvider>
            <PanelTabsProvider>
              <PanelHostProvider>
                <CosmosPanel active />
                <JiraHost />
                <Publisher jira={present ? t.jira : null} terminal={t.terminal} />
                <JiraComposerPublisher />
                <CosmosComposerProbe />
              </PanelHostProvider>
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
function treeOrNull(): HTMLElement | null {
  return screen.queryByRole('tree', { name: 'Open panel tabs' })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function tabRow(label: string): HTMLElement {
  const row = within(tree())
    .getAllByRole('treeitem')
    .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes(label))
  if (!row) {
    throw new Error(`tab row "${label}" not found`)
  }
  return row
}

function openRowMenu(label: string): void {
  fireEvent.contextMenu(tabRow(label), { clientX: 10, clientY: 10 })
}

function activateStripTab(label: string): void {
  fireEvent.click(within(strip()).getByRole('tab', { name: new RegExp(label) }))
}

describe('Home favorite tabs (COSMOS-FAVORITE-TABS-01)', () => {
  it('right-click a tree row → Pin → a favorite appears in the strip after the default', async () => {
    renderApp()
    await settle()
    expect(within(strip()).getByRole('tab', { name: /Cosmos/ })).toBeInTheDocument()

    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))

    const favTab = within(strip()).getByRole('tab', { name: /Sprint board/ })
    expect(favTab).toBeInTheDocument()
    const tabs = within(strip()).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Cosmos')
    expect(tabs[1]).toHaveTextContent('Sprint board')
    // NON-DISRUPTIVE pin: the default stays active + the tree stays shown.
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(favTab).toHaveAttribute('aria-selected', 'false')
    expect(treeOrNull()).toBeInTheDocument()
  })

  it('activating a favorite RELOCATES the live source panel into Home (the reparenting portal)', async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))

    // Before activation the live panel is OFF-DOM (its node has no OutPortal mounting it).
    expect(screen.queryByTestId('jira-live')).not.toBeInTheDocument()

    activateStripTab('Sprint board')
    await settle()
    // The live Jira panel is now mounted inside the favorite (reparented), and the default conversation
    // placeholder is gone.
    expect(screen.getByTestId('jira-live')).toBeInTheDocument()
    expect(screen.queryByText(/Describe a UI below/)).not.toBeInTheDocument()
  })

  it('a gone source shows the calm "no longer open" state + Unpin (never auto-dropped)', async () => {
    const { rerender } = renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board')
    await settle()
    expect(screen.getByTestId('jira-live')).toBeInTheDocument()

    // The source panel stops publishing jira → the favorite's tab is gone from the registry.
    act(() => {
      rerender({ jiraPresent: false })
    })
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()
    expect(screen.getByText('This tab is no longer open')).toBeInTheDocument()
    const unpin = screen.getByRole('button', { name: 'Unpin' })
    fireEvent.click(unpin)
    expect(within(strip()).queryByRole('tab', { name: /Sprint board/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Describe a UI below/)).toBeInTheDocument()
  })

  it("the favorite's close X unpins it and returns to the default tab", async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()

    fireEvent.click(within(strip()).getByRole('button', { name: 'Close Sprint board' }))
    expect(within(strip()).queryByRole('tab', { name: /Sprint board/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Describe a UI below/)).toBeInTheDocument()
  })

  it('a pinned tree row shows Unpin instead of Pin (state-reflective, FR-002)', async () => {
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] })
    await settle()
    openRowMenu('Sprint board')
    expect(await screen.findByRole('menuitem', { name: /Unpin/ })).toBeInTheDocument()
  })

  it('a terminal tree row IS pinnable → pinning appends a terminal favorite after the default', async () => {
    renderApp()
    await settle()
    openRowMenu('Terminal')
    const pin = await screen.findByRole('menuitem', { name: /Pin/ })
    expect(pin).not.toHaveAttribute('data-disabled')
    expect(screen.queryByText(/Terminal tabs can't be pinned/)).not.toBeInTheDocument()
    fireEvent.click(pin)
    await settle()
    const tabs = within(strip()).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Cosmos')
    expect(tabs[1]).toHaveTextContent('Terminal')
    expect(treeOrNull()).toBeInTheDocument()
  })

  it('restored favorites seed the strip on mount (FR-030)', async () => {
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] })
    await settle()
    const tabs = within(strip()).getAllByRole('tab')
    expect(tabs[0]).toHaveTextContent('Cosmos')
    expect(tabs[1]).toHaveTextContent('Sprint board')
  })

  it('the DEFAULT tab shows the tree + the docked Cosmos composer, NOT a favorite Open Prompt', async () => {
    renderApp()
    await settle()
    expect(treeOrNull()).toBeInTheDocument()
    expect(cosmosConfig).not.toBeNull()
    expect(screen.queryByTestId('favorite-open-prompt')).not.toBeInTheDocument()
  })

  it('a FAVORITE tab is FULL-WIDTH: hides the tree and shows the live panel', async () => {
    renderApp()
    await settle()
    expect(treeOrNull()).toBeInTheDocument()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    await settle()
    expect(treeOrNull()).toBeInTheDocument()
    activateStripTab('Sprint board')
    await settle()
    expect(treeOrNull()).not.toBeInTheDocument()
    expect(screen.getByTestId('jira-live')).toBeInTheDocument()
  })

  it('a FAVORITE tab hides the docked Cosmos composer and shows the SOURCE Open Prompt routing to source', async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board')
    await settle()

    expect(cosmosConfig).toBeNull()
    const openPrompt = screen.getByTestId('favorite-open-prompt')
    expect(openPrompt).toHaveAttribute('aria-label', 'Ask about your Jira issues')
    expect(composerSpy.onSubmit).toBe(jiraSubmit)
    fireEvent.click(openPrompt)
    expect(jiraSubmit).toHaveBeenCalledTimes(1)
  })

  it('switching back to the default tab restores the tree + docked composer (live panel returns to rail)', async () => {
    renderApp()
    await settle()
    openRowMenu('Sprint board')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
    activateStripTab('Sprint board')
    await settle()
    expect(treeOrNull()).not.toBeInTheDocument()
    expect(screen.getByTestId('jira-live')).toBeInTheDocument()

    fireEvent.click(within(strip()).getByRole('tab', { name: /Cosmos/ }))
    await settle()
    expect(treeOrNull()).toBeInTheDocument()
    expect(cosmosConfig).not.toBeNull()
    // The live panel returned to its (off-DOM) rail home — no longer mounted in Home.
    expect(screen.queryByTestId('jira-live')).not.toBeInTheDocument()
  })

  it('FOCUS-ON-ACTIVATION (FR-006): activating a favorite of jira tab j2 focuses the live panel to j2', async () => {
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j2', label: 'PROJ-9' }] })
    await settle()
    activateStripTab('PROJ-9')
    await settle()
    // The one-shot focus fired: the live panel's active tab is now j2 (was j1).
    expect(screen.getByTestId('jira-live')).toHaveAttribute('data-active-tab', 'j2')
  })

  it('KEYBOARD OWNERSHIP (OQ-1 reversal): the inner strip is suppressed, so HOME owns tab:* (inner panel does not move)', async () => {
    renderApp({ favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] })
    await settle()
    activateStripTab('Sprint board')
    await settle()

    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // The live panel's inner active tab does NOT respond to tab:* while suppressed in the favorite.
    expect(screen.getByTestId('jira-live')).toHaveAttribute('data-active-tab', 'j1')

    // Fire tab:next — HOME owns it: it moves OFF the favorite (wrapping to the default "Cosmos" tab).
    fireShortcut({ command: 'tab:next' })
    await settle()
    expect(within(strip()).getByRole('tab', { name: /Cosmos/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })
})
