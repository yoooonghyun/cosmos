/**
 * DOM test (jsdom) — TERM-FAVORITE-SURFACE-01 (cosmos-terminal-favorite-multiplex-v1,
 * FR-009/FR-013/FR-014). The FavoriteSurface terminal branch's three states, keyed off the live
 * cross-panel registry:
 *  - GONE (source terminal pane not published) → calm "no longer open" + Unpin (FR-013).
 *  - WAITING (pane published but its PTY not live yet — no `serialize`) → calm waiting (FR-014).
 *  - POPULATED (pane live — `serialize` present) → the mirror `TerminalView`, seeded with the source's
 *    current scrollback via `initialScrollback={serialize()}` (FR-009).
 *
 * `TerminalView` is STUBBED to surface the props it received (paneId, mirror, initialScrollback) so the
 * branch's wiring — that it mounts a MIRROR and SEEDS it from the live serializer — is assertable
 * without driving xterm. The behavior under test is FavoriteSurface's branch, not xterm rendering.
 */
import '@testing-library/jest-dom/vitest'
import { useMemo } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Stub the reused mirror view so its props (mirror + seed) are assertable without xterm/Monaco.
vi.mock('../terminal/TerminalPanel', () => ({
  TerminalView: (props: { paneId: string; mirror?: boolean; initialScrollback?: string }) => (
    <div
      data-testid="terminal-mirror"
      data-pane={props.paneId}
      data-mirror={String(props.mirror)}
      data-seed={props.initialScrollback}
    />
  )
}))

import { FavoriteSurface } from './FavoriteSurface'
import { PanelTabsProvider, usePublishPanelTabs, useAllPanelTabs, type LivePanelTabs } from '../panelTabs'

/** Publish (or clear) the Terminal panel's live tab list, then mirror its pane as a favorite. */
function Harness({ live, onUnpin }: { live: LivePanelTabs | null; onUnpin?: () => void }): React.JSX.Element {
  return (
    <PanelTabsProvider>
      <Publisher live={live} />
      <FavoriteSurface source={{ panelId: 'terminal', tabId: 'pane-1' }} onUnpin={onUnpin ?? (() => {})} />
    </PanelTabsProvider>
  )
}

function Publisher({ live }: { live: LivePanelTabs | null }): null {
  usePublishPanelTabs('terminal', useMemo(() => live, [live]))
  useAllPanelTabs() // re-render on registry change
  return null
}

describe('TerminalFavoriteSurface (TERM-FAVORITE-SURFACE-01)', () => {
  it('GONE: source terminal not published → calm "no longer open" + Unpin (FR-013)', () => {
    const onUnpin = vi.fn()
    render(<Harness live={null} onUnpin={onUnpin} />)
    expect(screen.getByText('This tab is no longer open')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-mirror')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
    expect(onUnpin).toHaveBeenCalledTimes(1)
  })

  it('WAITING: pane published but not live (no serialize) → calm waiting (FR-014)', () => {
    render(<Harness live={{ tabs: [{ id: 'pane-1', label: 'Terminal 2' }], activeTabId: 'pane-1' }} />)
    expect(screen.getByText(/Waiting for this terminal/)).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-mirror')).not.toBeInTheDocument()
  })

  it('POPULATED: pane live (serialize present) → mirror TerminalView seeded from serialize() (FR-009)', async () => {
    render(
      <Harness
        live={{
          tabs: [{ id: 'pane-1', label: 'Terminal 2', serialize: () => 'SCROLLBACK-SEED' }],
          activeTabId: 'pane-1'
        }}
      />
    )
    // TerminalView is lazy-loaded (the Monaco import is kept out of the FavoriteSurface graph), so the
    // mirror resolves through Suspense — find it asynchronously.
    const mirror = await screen.findByTestId('terminal-mirror')
    expect(mirror).toHaveAttribute('data-pane', 'pane-1')
    expect(mirror).toHaveAttribute('data-mirror', 'true')
    expect(mirror).toHaveAttribute('data-seed', 'SCROLLBACK-SEED')
    expect(screen.queryByText(/Waiting for this terminal/)).not.toBeInTheDocument()
  })
})
