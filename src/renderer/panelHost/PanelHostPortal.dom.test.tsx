/**
 * DOM test (jsdom) — the reparenting-portal host (cosmos-favorite-live-panel-portal-v1).
 * Scenario PANEL-HOST-PORTAL-01. Drives the REAL `PanelHostProvider` + `InPortal`/`OutPortal` with a
 * STUB panel (a counter + a mount tally) so the behaviors under test are the HOST wiring, not any real
 * panel's chrome:
 *
 *  - STATE SURVIVES the rail↔favorite relocation (THE CRUX, FR-003): the panel mounts ONCE; moving its
 *    OutPortal from the rail host to the favorite host reparents the DOM node WITHOUT remounting, so an
 *    internal counter (and the mount tally) survive the move.
 *  - The ONE-CLAIMER invariant (FR-004): across every (visibleSurface, activeFavoriteSource) combo,
 *    EXACTLY ONE OutPortal mounts the node — never zero in steady state, never two.
 *  - The one-shot focus channel (FR-006): `focusSourceTab(panelId, tabId)` invokes the panel's
 *    registered handler exactly once per activation; an unregistered panel is a safe no-op.
 */
import '@testing-library/jest-dom/vitest'
import { act, useRef, useState, useEffect } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { InPortal, OutPortal } from 'react-reverse-portal'
import { PanelHostProvider, usePanelHost } from './PanelHostProvider'
import type { SurfaceId } from '../app/railVisibility'
import type { ActiveFavoriteSource, GenerativePanelId } from './panelHostLogic'

/** A mount tally so a test can prove the panel was NEVER remounted across a relocation. */
let mountCount = 0

/** A stub generative panel: an internal counter (its "live state") + the mount tally. */
function StubPanel(): React.JSX.Element {
  const [count, setCount] = useState(0)
  useEffect(() => {
    mountCount += 1
  }, [])
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button data-testid="inc" onClick={() => setCount((c) => c + 1)}>
        inc
      </button>
    </div>
  )
}

/** Captures the provider setters so a test can drive the host signals from the outside. */
const api: {
  setSurface: React.Dispatch<React.SetStateAction<SurfaceId>> | null
  setFav: ((s: ActiveFavoriteSource | null) => void) | null
} = { setSurface: null, setFav: null }

function Capture(): null {
  const { setVisibleSurface, setActiveFavoriteSource } = usePanelHost()
  api.setSurface = setVisibleSurface
  api.setFav = setActiveFavoriteSource
  return null
}

/** Renders the InPortal (the single mount) + a rail slot + a favorite slot, each gated by `hostFor`. */
function HostHarness({ panelId }: { panelId: GenerativePanelId }): React.JSX.Element {
  const { node, hostFor } = usePanelHost()
  return (
    <>
      <InPortal node={node(panelId)}>
        <StubPanel />
      </InPortal>
      <div data-testid="rail">{hostFor(panelId) === 'rail' && <OutPortal node={node(panelId)} />}</div>
      <div data-testid="favorite">
        {hostFor(panelId) === 'favorite' && <OutPortal node={node(panelId)} />}
      </div>
    </>
  )
}

describe('reparenting portal host (PANEL-HOST-PORTAL-01)', () => {
  it('state SURVIVES the rail↔favorite relocation (no remount) — THE CRUX', () => {
    mountCount = 0
    render(
      <PanelHostProvider>
        <Capture />
        <HostHarness panelId="jira" />
      </PanelHostProvider>
    )

    // Default: Home is visible, no favorite → the panel is hosted in the RAIL slot.
    expect(within(screen.getByTestId('rail')).getByTestId('count')).toHaveTextContent('0')
    expect(within(screen.getByTestId('favorite')).queryByTestId('count')).not.toBeInTheDocument()

    // Build up live state in the rail-hosted panel.
    fireEvent.click(screen.getByTestId('inc'))
    fireEvent.click(screen.getByTestId('inc'))
    fireEvent.click(screen.getByTestId('inc'))
    expect(screen.getByTestId('count')).toHaveTextContent('3')
    expect(mountCount).toBe(1)

    // Relocate to the FAVORITE host: Home visible + the active favorite points at jira.
    act(() => {
      api.setFav?.({ panelId: 'jira', tabId: 't1' })
    })

    // The node moved into the favorite slot, and the counter (3) + mount tally (1) survived — the
    // panel was REPARENTED, not remounted.
    expect(within(screen.getByTestId('favorite')).getByTestId('count')).toHaveTextContent('3')
    expect(within(screen.getByTestId('rail')).queryByTestId('count')).not.toBeInTheDocument()
    expect(mountCount).toBe(1)

    // And back to the rail — still the same instance, still 3.
    act(() => {
      api.setFav?.(null)
    })
    expect(within(screen.getByTestId('rail')).getByTestId('count')).toHaveTextContent('3')
    expect(mountCount).toBe(1)
  })

  it('ONE-CLAIMER: exactly one OutPortal mounts the node across every (surface, favorite) combo', () => {
    mountCount = 0
    render(
      <PanelHostProvider>
        <Capture />
        <HostHarness panelId="confluence" />
      </PanelHostProvider>
    )

    const claims = (): { rail: boolean; favorite: boolean } => ({
      rail: within(screen.getByTestId('rail')).queryByTestId('count') !== null,
      favorite: within(screen.getByTestId('favorite')).queryByTestId('count') !== null
    })

    const combos: { surface: SurfaceId; fav: ActiveFavoriteSource | null }[] = [
      { surface: 'cosmos', fav: null },
      { surface: 'cosmos', fav: { panelId: 'confluence', tabId: 't1' } },
      { surface: 'cosmos', fav: { panelId: 'jira', tabId: 't1' } },
      { surface: 'confluence', fav: { panelId: 'confluence', tabId: 't1' } },
      { surface: 'terminal', fav: null },
      { surface: 'cosmos', fav: { panelId: 'terminal', tabId: 't1' } }
    ]

    for (const combo of combos) {
      act(() => {
        api.setSurface?.(combo.surface)
        api.setFav?.(combo.fav)
      })
      const { rail, favorite } = claims()
      // EXACTLY ONE slot claims the node in every committed state — never both, never neither.
      expect(rail !== favorite).toBe(true)
      // It is the favorite ONLY when Home is visible and the favorite points at this panel.
      const expectFavorite = combo.surface === 'cosmos' && combo.fav?.panelId === 'confluence'
      expect(favorite).toBe(expectFavorite)
    }
    // Never remounted across all the relocations.
    expect(mountCount).toBe(1)
  })
})

describe('one-shot focus channel (PANEL-HOST-PORTAL-01)', () => {
  it('focusSourceTab invokes the registered handler exactly once; unregistered is a safe no-op', () => {
    const focusSpy = vi.fn()
    const focusRef: { fire: ((p: GenerativePanelId, t: string) => void) | null } = { fire: null }

    function Registrar(): null {
      const { onFocusTab, focusSourceTab } = usePanelHost()
      const ref = useRef(focusSpy)
      ref.current = focusSpy
      useEffect(() => onFocusTab('jira', (tabId) => ref.current(tabId)), [onFocusTab])
      focusRef.fire = focusSourceTab
      return null
    }

    render(
      <PanelHostProvider>
        <Registrar />
      </PanelHostProvider>
    )

    // An UNREGISTERED panel: no handler → no throw, no call.
    act(() => focusRef.fire?.('slack', 'x1'))
    expect(focusSpy).not.toHaveBeenCalled()

    // The registered jira handler fires exactly once with the pinned tab id.
    act(() => focusRef.fire?.('jira', 'sprint-board'))
    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalledWith('sprint-board')
  })
})
