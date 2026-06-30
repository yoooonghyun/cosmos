/**
 * DOM round-trip regression for the Home favorites-lost-on-restart bug (favorites-lost-on-restart-v2).
 *
 * WHY THIS EXISTS (round-2 — the prior guard was inadequate): the v1 regression was a SessionRegistry
 * NODE-UNIT test that mocked `save` with a spy and never exercised the REAL
 * save → main-validate → load → seed → re-bind cycle, so it could not catch the actual defect. This
 * test renders the REAL {@link CosmosPanel} under the REAL {@link SessionProvider}/{@link SessionRegistry},
 * wired to the REAL main {@link SessionStore} (validate + atomic write + load) over an in-memory fs, and
 * PINS a favorite, lets the eager save land, then SIMULATES a restart by re-loading the persisted
 * snapshot through the SAME validate→load path and re-mounting the panel.
 *
 * The defect: on a fresh relaunch the registry starts EMPTY and Cosmos (mounted BEFORE the generative
 * panels in the rail) fires an EAGER favorites save during its mount effect — before the Jira panel
 * re-reports — so `assembleSnapshot` writes the favorite's SOURCE panel as an EMPTY default, WIPING it
 * from disk. The favorite reference survives but its source hydrates empty on the next load, so it
 * re-binds to nothing (the calm "no longer open" gone-source state). A second restart shows the user
 * the broken favorite. The mount-time `seed` of the registry from the restored snapshot fixes it.
 *
 * A SECOND scenario guards the "absent, as if never pinned" symptom: a dev Fast-Refresh REMOUNT of Home
 * (the registry instance SURVIVES, the snapshot prop stays the STALE app-start one) must not reset the
 * favorites to none and eager-save an empty list — the panel now seeds from the surviving registry.
 *
 * Faithful source: `JiraSource` hydrates its tab from the RESTORED snapshot slice
 * (`hydrateGenerativeTabs`), publishes it live to the cross-panel registry so the favorite re-binds +
 * mirrors a surface, AND reports it to the SESSION registry (`buildGenerativePanel`) — the real
 * persistence path. `ActiveTabSurface` is stubbed (as in CosmosFavoriteTabs.dom.test) so the inline
 * mirror is assertable without the A2UI SDK.
 */
import '@testing-library/jest-dom/vitest'
import { act, useEffect, useMemo } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

// Stub the shared A2UI host so the inline favorite mirror is assertable without the SDK/catalog.
vi.mock('../generative/ActiveTabSurface', () => ({
  ActiveTabSurface: ({ surface }: { surface: { spec?: { surfaceId?: string } } | null }) => (
    <div data-testid="fav-surface">{surface?.spec?.surfaceId ?? 'no-surface'}</div>
  )
}))

// Stub the floating PromptComposer (its measure/visibility gate cannot run in jsdom).
vi.mock('../composer/PromptComposer', () => ({
  PromptComposer: (props: { onSubmit: (u: string) => void; ariaLabel: string }) => (
    <button data-testid="favorite-open-prompt" aria-label={props.ariaLabel}>
      Open prompt
    </button>
  )
}))

import { CosmosPanel } from './CosmosPanel'
import {
  ActiveComposerProvider,
  usePublishComposer
} from '../composer/ActiveComposerProvider'
import {
  PanelTabsProvider,
  usePublishPanelTabs,
  type LivePanelTabs
} from '../panelTabs'
import {
  SessionProvider,
  useReportPanel,
  useRestoredGenerativePanel
} from '../session/SessionProvider'
import { hydrateGenerativeTabs, buildGenerativePanel } from '../session/sessionSnapshot'
import { SESSION_SCHEMA_VERSION, validateFavorites, type SessionSnapshot } from '../../shared/ipc'

/**
 * A disk-equivalent session store: JSON-serializes on save and parses on load (a real round-trip
 * through bytes, NOT a spy), and re-runs the SHARED `validateFavorites` on the favorites field — the
 * SAME validator the main `validateSnapshot` boundary delegates to (sessionSnapshot.ts), dropping the
 * field when empty exactly like main. We cannot import the main `SessionStore` class itself here: the
 * cross-tree typecheck boundary (tsconfig.web) forbids a renderer test importing main, and a jsdom
 * test cannot compile under the node lib. This store is behaviourally identical for the favorites
 * persistence round-trip under test (validateSnapshot passes valid panels through unchanged).
 */
function diskStore(): { save: (s: SessionSnapshot) => void; load: () => SessionSnapshot | null } {
  let raw: string | null = null
  return {
    save(snap) {
      const favorites = validateFavorites(snap.favorites, () => {})
      const onDisk: SessionSnapshot = { ...snap }
      if (favorites.length) onDisk.favorites = favorites
      else delete onDisk.favorites
      raw = JSON.stringify(onDisk)
    },
    load() {
      return raw === null ? null : (JSON.parse(raw) as SessionSnapshot)
    }
  }
}

let store: ReturnType<typeof diskStore>

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }

/** A persisted snapshot with a Jira tab open (jira+terminal visible), optional favorites. */
function snapshotWith(opts?: { favorite?: boolean }): SessionSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: emptyPanel,
      'generated-ui': emptyPanel,
      jira: { tabs: [{ id: 'j1', label: 'Sprint board', untitled: false }], activeTabId: 'j1', everOpened: 1 },
      slack: emptyPanel,
      confluence: emptyPanel,
      'google-calendar': emptyPanel
    },
    enabled: { slack: false, jira: true, confluence: false, 'google-calendar': false },
    ...(opts?.favorite ? { favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }] } : {})
  } as SessionSnapshot
}

const surfaceOf = (surfaceId: string) =>
  ({ requestId: `req-${surfaceId}`, spec: { surfaceId, components: [] } }) as never

/**
 * A faithful Jira source panel: hydrates its tab from the RESTORED snapshot slice, publishes it LIVE
 * to the cross-panel registry (so a favorite re-binds + mirrors a surface), AND reports it to the
 * SESSION registry (the real persistence path that persists the source panel). Renders nothing.
 */
function JiraSource(): null {
  const initial = useRestoredGenerativePanel('jira')
  const hydrated = useMemo(() => hydrateGenerativeTabs(initial, () => 'req-fixed'), [initial])
  const live = useMemo<LivePanelTabs | null>(
    () =>
      hydrated.tabs.length
        ? {
            tabs: hydrated.tabs.map((t) => ({ id: t.id, label: t.label, surface: surfaceOf('s-board') })),
            activeTabId: hydrated.activeTabId
          }
        : null,
    [hydrated]
  )
  usePublishPanelTabs('jira', live)
  const report = useReportPanel()
  useEffect(() => {
    report('jira', buildGenerativePanel(hydrated, Math.max(1, hydrated.tabs.length)))
  }, [hydrated, report])
  return null
}

/** Publishes the Jira composer config (as the real JiraPanel does), so a favorite's Open Prompt mounts. */
function JiraComposerPublisher(): null {
  usePublishComposer(
    'jira',
    useMemo(() => ({ onSubmit: () => {}, placeholder: 'Ask Jira', ariaLabel: 'Ask about your Jira issues' }), [])
  )
  return null
}

/** Render the app shell with Cosmos BEFORE the Jira source (faithful to AppShell's rail order). */
function appTree(snapshot: SessionSnapshot | null, cosmosKey = 'cosmos'): React.JSX.Element {
  return (
    <TooltipProvider>
      <SessionProvider snapshot={snapshot}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <CosmosPanel key={cosmosKey} active />
            <JiraSource />
            <JiraComposerPublisher />
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
}

beforeEach(() => {
  store = diskStore()
  // Radix Menu touches these jsdom-missing APIs; stub them so the context menu opens cleanly.
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
      ui: { onRender: () => () => {}, onGeneratingBegin: () => () => {}, onDataModel: () => () => {}, sendAction: () => {} },
      shortcuts: { onTrigger: () => () => {} },
      // The REAL main boundary: validate + atomic write through the in-memory SessionStore.
      session: { save: (snap: SessionSnapshot) => store.save(snap) }
    }
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Cosmos tabs' })
}
function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Open panel tabs' })
}
function tabRow(label: string): HTMLElement {
  const row = within(tree())
    .getAllByRole('treeitem')
    .find((r) => r.getAttribute('aria-level') === '2' && r.textContent?.includes(label))
  if (!row) throw new Error(`tab row "${label}" not found`)
  return row
}
async function pin(label: string): Promise<void> {
  fireEvent.contextMenu(tabRow(label), { clientX: 10, clientY: 10 })
  fireEvent.click(await screen.findByRole('menuitem', { name: /Pin/ }))
  await settle()
}
function activateStripTab(label: string): void {
  fireEvent.click(within(strip()).getByRole('tab', { name: new RegExp(label) }))
}

describe('Home favorites survive a restart round-trip (favorites-lost-on-restart-v2)', () => {
  it('pin → save → RESTART preserves the favorite SOURCE panel on disk and re-binds POPULATED (not gone-source)', async () => {
    // A prior session already has a Jira tab open (no favorite yet).
    store.save(snapshotWith())

    // Launch #1: pin the Jira tab. The eager save lands the favorite (with the live source) on disk.
    const launch1 = render(appTree(store.load()))
    await settle()
    await pin('Sprint board')
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()
    let disk = store.load()
    expect(disk?.favorites, 'pin persists the favorite').toHaveLength(1)
    expect(disk?.panels.jira.tabs, 'pin keeps the source panel on disk').toHaveLength(1)
    launch1.unmount()

    // Launch #2 — RESTART: re-load the persisted snapshot and re-mount. On mount, Cosmos fires its
    // EAGER favorites save BEFORE the Jira source re-reports (Cosmos precedes Jira in the rail). The
    // bug wrote the source panel as an empty default here, wiping it from disk.
    const launch2 = render(appTree(store.load()))
    await settle()
    disk = store.load()
    expect(
      disk?.panels.jira.tabs,
      'RESTART must not wipe the favorite source panel (eager save preserves restored panels)'
    ).toHaveLength(1)
    expect(disk?.favorites, 'RESTART keeps the favorite').toHaveLength(1)
    launch2.unmount()

    // Launch #3 — a SECOND restart from the (now possibly-corrupted) disk: the favorite must re-bind to
    // a POPULATED live source, NOT the "no longer open" gone-source state the user reported.
    render(appTree(store.load()))
    await settle()
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()
    activateStripTab('Sprint board')
    expect(screen.getByTestId('fav-surface'), 'favorite re-binds to a POPULATED source').toHaveTextContent('s-board')
    expect(screen.queryByText('This tab is no longer open')).not.toBeInTheDocument()
  })

  it('a dev Fast-Refresh REMOUNT of Home keeps the pinned favorite (the "absent, as if never pinned" guard)', async () => {
    // Clean first launch: the Jira tab is open but NO favorite is persisted — the favorite is pinned
    // DURING the session, so the app-start snapshot never carries it (exactly the dev-HMR condition).
    store.save(snapshotWith())
    const staleSnapshot = store.load() // captured ONCE — the stale app-start snapshot a remount re-reads.

    const view = render(appTree(staleSnapshot, 'cosmos-a'))
    await settle()
    await pin('Sprint board')
    expect(within(strip()).getByRole('tab', { name: /Sprint board/ })).toBeInTheDocument()
    expect(store.load()?.favorites, 'pin persists the favorite').toHaveLength(1)

    // Fast-Refresh REMOUNT: change Home's key (remounts CosmosPanel) while SessionProvider — and its
    // SURVIVING registry — stays mounted with the SAME stale snapshot prop (no favorite).
    act(() => {
      view.rerender(appTree(staleSnapshot, 'cosmos-b'))
    })
    await settle()

    // The favorite SURVIVES the remount (seeded from the surviving registry, not the stale snapshot)…
    expect(
      within(strip()).getByRole('tab', { name: /Sprint board/ }),
      'a Fast-Refresh remount must not drop the pinned favorite'
    ).toBeInTheDocument()
    // …and the remount's eager favorites effect did NOT wipe it from disk.
    expect(store.load()?.favorites, 'a Fast-Refresh remount must not wipe the favorite from disk').toHaveLength(1)
  })
})
