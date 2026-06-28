/**
 * DOM test (jsdom) for the END-TO-END Cosmos panel-tab-list flow (cosmos-panel-tab-list-v1).
 * Scenario: COSMOS-PANEL-TABS-01 — a tree row click selects that panel+tab as the next prompt's
 * context: the composer's ContextChip shows the panel+tab breadcrumb; submitting embeds the
 * `<cosmos:context>` marker naming that panel+tab while the wire target stays 'generated-ui'; the
 * selection is ONE-SHOT (clears after submit); re-select replaces; a closed selected tab clears;
 * dismissing drops it.
 *
 * Renders the REAL `CosmosPanel` under the real `PanelTabsProvider` + `ActiveComposerProvider` +
 * `SessionProvider`, a sibling Jira publisher (the `usePublishPanelTabs` path the four generative
 * panels use), and a probe that renders the REAL composer `ContextChip` from the published 'cosmos'
 * `ComposerConfig` — so the chip DOM + the submit wiring are exercised through the production path.
 */
import '@testing-library/jest-dom/vitest'
import { act } from 'react'
import { useMemo } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CosmosPanel } from './CosmosPanel'
import { ContextChip } from '../app/ContextChip'
import {
  ActiveComposerProvider,
  useActiveComposerConfig
} from '../composer/ActiveComposerProvider'
import { PanelTabsProvider, usePublishPanelTabs, type LivePanelTabs } from '../panelTabs'
import { SessionProvider } from '../session/SessionProvider'
import { SESSION_SCHEMA_VERSION, type AgentSubmitPayload, type SessionSnapshot } from '../../shared/ipc'

interface Captured {
  status: ((p: { state: string }) => void) | null
  submits: AgentSubmitPayload[]
}
let cap: Captured

beforeEach(() => {
  cap = { status: null, submits: [] }
  Object.defineProperty(window, 'cosmos', {
    configurable: true,
    writable: true,
    value: {
      conversation: {
        getDefault: () => Promise.resolve({ ok: true, conversation: { turns: [], state: 'empty' } }),
        onUpdate: () => () => {}
      },
      agent: {
        onStatus: (l: (p: { state: string }) => void) => {
          cap.status = l
          return () => {
            cap.status = null
          }
        },
        submit: (payload: AgentSubmitPayload) => cap.submits.push(payload)
      },
      ui: { onRender: () => () => {} },
      session: { save: () => {} }
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const emptyPanel = { tabs: [], activeTabId: null, everOpened: 0 }
/** A session snapshot that ENABLES Jira so its group is visible in the tree (matches rail). */
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
  enabled: { slack: false, jira: true, confluence: false, 'google-calendar': false }
}

/** The published 'cosmos' composer config, captured so the test can drive its onSubmit. */
let activeConfig: ReturnType<typeof useActiveComposerConfig> = null

/**
 * Renders the REAL composer ContextChip from the active 'cosmos' config (the docked composer face),
 * inside a test-id slot so chip assertions are scoped to the COMPOSER chip — distinct from the
 * timeline's live `PromptContextChip` (also `role="note"`) the in-flight bubble shows after submit.
 */
function ComposerProbe(): React.JSX.Element {
  const config = useActiveComposerConfig('cosmos')
  activeConfig = config
  return (
    <div data-testid="composer-chip-slot">
      {config?.contextChip ? (
        <ContextChip
          data={config.contextChip}
          onRemoveAll={() => config.onSubmit('dismiss', { contextDismiss: 'all' })}
          onRemoveThread={() => {}}
        />
      ) : null}
    </div>
  )
}

/** The composer chip's `role="note"` (or null), scoped to the composer slot. */
function composerChip(): HTMLElement | null {
  return within(screen.getByTestId('composer-chip-slot')).queryByRole('note')
}

/** The Jira publisher (the `usePublishPanelTabs` path useGenerativePanelTabs uses). */
function JiraPublisher({ tabs }: { tabs: LivePanelTabs }): null {
  usePublishPanelTabs(
    'jira',
    useMemo(() => tabs, [tabs])
  )
  return null
}

const twoJiraTabs: LivePanelTabs = {
  tabs: [
    { id: 'j1', label: 'Sprint board' },
    { id: 'j2', label: 'PROJ-9' }
  ],
  activeTabId: 'j1'
}

function renderApp(tabs: LivePanelTabs = twoJiraTabs): { rerender: (t: LivePanelTabs) => void } {
  const tree = (t: LivePanelTabs): React.JSX.Element => (
    <TooltipProvider>
      <SessionProvider snapshot={snapshot}>
        <ActiveComposerProvider>
          <PanelTabsProvider>
            <CosmosPanel active />
            <JiraPublisher tabs={t} />
            <ComposerProbe />
          </PanelTabsProvider>
        </ActiveComposerProvider>
      </SessionProvider>
    </TooltipProvider>
  )
  const { rerender } = render(tree(tabs))
  return { rerender: (t) => rerender(tree(t)) }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** The trailing marker JSON the submit embedded (or '' when none). */
function markerOf(payload: AgentSubmitPayload | undefined): string {
  if (!payload) return ''
  const m = /<cosmos:context>([\s\S]*?)<\/cosmos:context>/.exec(payload.utterance)
  return m ? m[1] : ''
}

describe('Cosmos panel-tab list end-to-end (COSMOS-PANEL-TABS-01)', () => {
  it('a tree row click shows the panel+tab ContextChip in the composer', async () => {
    renderApp()
    await settle()
    // The Jira group + its tabs are surveyed in the tree.
    expect(screen.getByText('Sprint board')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Sprint board'))
    // The composer chip now names Jira › Sprint board (the panel+tab breadcrumb).
    const chip = composerChip()
    expect(chip).not.toBeNull()
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining('Jira panel'))
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining('Sprint board tab'))
  })

  it('submitting embeds the marker naming the panel+tab; target stays generated-ui; one-shot clears', async () => {
    renderApp()
    await settle()
    fireEvent.click(screen.getByText('Sprint board'))
    expect(composerChip()).not.toBeNull()

    act(() => {
      activeConfig?.onSubmit('build me a chart')
    })

    const payload = cap.submits.at(-1)
    expect(payload?.target).toBe('generated-ui')
    const marker = markerOf(payload)
    expect(marker).toContain('"id":"jira"')
    expect(marker).toContain('"id":"j1"')
    expect(marker).toContain('Sprint board')
    // One-shot (OQ-2): the selection cleared, so the COMPOSER chip is gone for the next compose
    // (the timeline's live in-flight bubble shows its own context chip — a separate note).
    expect(composerChip()).toBeNull()
  })

  it('re-selecting another tab REPLACES the selection (FR-016)', async () => {
    renderApp()
    await settle()
    fireEvent.click(screen.getByText('Sprint board'))
    fireEvent.click(screen.getByText('PROJ-9'))
    const chip = composerChip()
    expect(chip).not.toBeNull()
    expect(chip).toHaveAttribute('aria-label', expect.stringContaining('PROJ-9 tab'))
    expect(chip?.getAttribute('aria-label')).not.toContain('Sprint board')
  })

  it('a CLOSED selected tab clears the chip before submit (FR-017)', async () => {
    const { rerender } = renderApp()
    await settle()
    fireEvent.click(screen.getByText('Sprint board'))
    expect(composerChip()).not.toBeNull()

    // The source panel closes the selected tab (j1) — only j2 remains.
    act(() => {
      rerender({ tabs: [{ id: 'j2', label: 'PROJ-9' }], activeTabId: 'j2' })
    })
    expect(composerChip()).toBeNull()
  })

  it('dismissing the chip (contextDismiss:all) drops the selected panel+tab from the submit', async () => {
    renderApp()
    await settle()
    fireEvent.click(screen.getByText('Sprint board'))

    // Submit with the dismiss flag the chip `×` sets → the SELECTED jira context is dropped; the
    // submit falls back to the Cosmos panel's own default context (never the jira selection).
    act(() => {
      activeConfig?.onSubmit('plain prompt', { contextDismiss: 'all' })
    })
    const marker = markerOf(cap.submits.at(-1))
    expect(marker).not.toContain('"id":"jira"')
    expect(marker).not.toContain('Sprint board')
    expect(marker).toContain('"id":"cosmos"')
  })
})
