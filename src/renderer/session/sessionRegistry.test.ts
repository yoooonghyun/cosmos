import { describe, it, expect, vi } from 'vitest'
import { SESSION_SCHEMA_VERSION, type HomeFavorite, type SessionSnapshot } from '../../shared/ipc'
import {
  assembleSnapshot,
  SessionRegistry,
  type Scheduler
} from './sessionRegistry'
import type { TerminalPanelDraft } from './sessionSnapshot'

/** A controllable scheduler: queue the pending fn so a test can fire it on demand. */
function makeScheduler(): Scheduler & { run: () => void; pending: number } {
  let fn: (() => void) | null = null
  let handle = 0
  return {
    pending: 0,
    setTimeout(f) {
      fn = f
      handle += 1
      ;(this as { pending: number }).pending += 1
      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout() {
      fn = null
    },
    run() {
      const f = fn
      fn = null
      f?.()
    }
  }
}

const termDraft: TerminalPanelDraft = {
  tabs: [{ id: 'p1', label: 'Terminal' }],
  activeTabId: 'p1',
  everOpened: 1
}

describe('assembleSnapshot', () => {
  it('fills absent panels with empty defaults and stamps the schema version', () => {
    const snap = assembleSnapshot({})
    expect(snap.schemaVersion).toBe(SESSION_SCHEMA_VERSION)
    expect(snap.panels.terminal.tabs).toHaveLength(0)
    expect(snap.panels.jira.tabs).toHaveLength(0)
  })

  it('widens a terminal draft into the terminal panel slot', () => {
    const snap = assembleSnapshot({ terminal: termDraft })
    expect(snap.panels.terminal.tabs[0].id).toBe('p1')
    expect(snap.panels.terminal.everOpened).toBe(1)
  })

  // draggable-open-prompt-button-v1 (FR-008): the global Open-Prompt position is an
  // additive OPTIONAL top-level field — omitted when unreported (older/clean session ⇒
  // default), included verbatim when contributed.
  it('OMITS openPromptPosition when none was contributed (NO schema bump)', () => {
    const snap = assembleSnapshot({})
    expect(snap.schemaVersion).toBe(SESSION_SCHEMA_VERSION)
    expect(snap).not.toHaveProperty('openPromptPosition')
  })

  it('passes a contributed openPromptPosition through verbatim (two numbers only)', () => {
    const snap = assembleSnapshot({ openPromptPosition: { xFrac: 0.2, yFrac: 0.9 } })
    expect(snap.openPromptPosition).toEqual({ xFrac: 0.2, yFrac: 0.9 })
  })
})

describe('SessionRegistry — debounced save (FR-007)', () => {
  it('coalesces multiple reports into ONE save on the trailing edge', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.report('terminal', termDraft)
    reg.report('jira', { tabs: [], activeTabId: null, everOpened: 0 })
    reg.report('slack', { tabs: [], activeTabId: null, everOpened: 0 })
    expect(save).not.toHaveBeenCalled() // still within the debounce
    sched.run()
    expect(save).toHaveBeenCalledTimes(1)
    const arg = save.mock.calls[0][0]
    expect(arg.panels.terminal.tabs[0].id).toBe('p1')
  })

  it('flush() forces an immediate save of the latest contributions (teardown)', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.report('terminal', termDraft)
    reg.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].panels.terminal.tabs[0].id).toBe('p1')
  })

  it('a later report overwrites an earlier contribution for the same key', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.report('terminal', termDraft)
    reg.report('terminal', { tabs: [], activeTabId: null, everOpened: 2 })
    reg.flush()
    expect(save.mock.calls[0][0].panels.terminal.tabs).toHaveLength(0)
    expect(save.mock.calls[0][0].panels.terminal.everOpened).toBe(2)
  })

  // draggable-open-prompt-button-v1 (FR-003/FR-007): the global Open-Prompt position
  // reports through the NON-panel `setOpenPromptPosition` path (mirrors `setEnabled`) and
  // lands in the debounced save; the latest reported value wins.
  it('setOpenPromptPosition lands the position in the debounced save (latest wins)', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.setOpenPromptPosition({ xFrac: 0.1, yFrac: 0.1 })
    reg.setOpenPromptPosition({ xFrac: 0.7, yFrac: 0.7 })
    expect(save).not.toHaveBeenCalled() // trailing debounce
    sched.run()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].openPromptPosition).toEqual({ xFrac: 0.7, yFrac: 0.7 })
  })
})

// bug favorites-lost-on-restart-v1: favorites must persist EAGERLY (immediately on pin/unpin), NOT
// on the shared trailing debounce — a dev HMR / reload (which fires no pagehide/beforeunload on a
// partial update, so the teardown flush never runs) inside the SAVE_DEBOUNCE_MS window would
// otherwise pre-empt the save and the just-pinned favorite would never reach disk.
describe('SessionRegistry — eager favorites persistence (favorites-lost-on-restart-v1)', () => {
  const fav: HomeFavorite = { panelId: 'jira', tabId: 't1', label: 'TASK-1' }

  it('setFavorites saves IMMEDIATELY, WITHOUT waiting for the debounce to fire', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.setFavorites([fav])
    // RED before the fix: setFavorites used schedule(), so save fires only on sched.run().
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].favorites).toEqual([fav])
  })

  it('a report STORM that perpetually resets the shared debounce never starves the favorite', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    // Other panels keep re-scheduling the single shared timer (debounced save never fires)...
    reg.report('terminal', termDraft)
    reg.report('jira', { tabs: [], activeTabId: null, everOpened: 0 })
    // ...yet a pin in that same window still lands the favorite on disk eagerly.
    reg.setFavorites([fav])
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].favorites).toEqual([fav])
    // The eager save also carried the other pending contributions (current state, early) — safe.
    expect(save.mock.calls[0][0].panels.terminal.tabs[0].id).toBe('p1')
  })

  it('does NOT make OTHER non-panel contributions eager (openPromptPosition still debounces)', () => {
    const save = vi.fn()
    const sched = makeScheduler()
    const reg = new SessionRegistry(save, sched, 600)
    reg.setOpenPromptPosition({ xFrac: 0.3, yFrac: 0.4 })
    expect(save).not.toHaveBeenCalled() // still trailing-debounced — no regression
    sched.run()
    expect(save).toHaveBeenCalledTimes(1)
  })
})

// favorites-lost-on-restart-v2: a freshly-constructed registry (one per relaunch) starts EMPTY, yet
// Cosmos fires an EAGER favorites save on mount BEFORE the generative panels re-report — so without a
// seed `assembleSnapshot` writes the favorite's SOURCE panel as an empty default, wiping it from disk.
// `seed` populates the contributions from the restored snapshot so any early/eager save preserves them.
// (The end-to-end RED→GREEN is the CosmosFavoriteRestartRoundTrip.dom round-trip; this locks the unit.)
describe('SessionRegistry — seed restored contributions (favorites-lost-on-restart-v2)', () => {
  const restored: SessionSnapshot = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    panels: {
      terminal: { tabs: [], activeTabId: null, everOpened: 0 },
      'generated-ui': { tabs: [], activeTabId: null, everOpened: 0 },
      jira: { tabs: [{ id: 'j1', label: 'Sprint board', untitled: false }], activeTabId: 'j1', everOpened: 1 },
      slack: { tabs: [], activeTabId: null, everOpened: 0 },
      confluence: { tabs: [], activeTabId: null, everOpened: 0 },
      'google-calendar': { tabs: [], activeTabId: null, everOpened: 0 }
    },
    enabled: { slack: false, jira: true, confluence: false, 'google-calendar': false },
    favorites: [{ panelId: 'jira', tabId: 'j1', label: 'Sprint board' }]
  }

  it('an EAGER favorites save on a SEEDED fresh registry preserves the restored source panel', () => {
    const save = vi.fn()
    const reg = new SessionRegistry(save, makeScheduler(), 600)
    reg.seed(restored) // SessionProvider does this once on mount, before any panel reports
    // Cosmos eager favorites save (mount), BEFORE the Jira panel re-reports its tab:
    reg.setFavorites(restored.favorites!)
    expect(save).toHaveBeenCalledTimes(1)
    const snap = save.mock.calls[0][0] as SessionSnapshot
    expect(snap.panels.jira.tabs, 'seeded source panel survives the eager save').toHaveLength(1)
    expect(snap.favorites).toHaveLength(1)
  })

  it('WITHOUT seeding, the same eager save wipes the (un-reported) source panel — the bug', () => {
    const save = vi.fn()
    const reg = new SessionRegistry(save, makeScheduler(), 600)
    // No seed (the pre-fix behaviour). The eager favorites save assembles from EMPTY contributions:
    reg.setFavorites(restored.favorites!)
    const snap = save.mock.calls[0][0] as SessionSnapshot
    expect(snap.panels.jira.tabs, 'un-seeded eager save writes an empty source panel').toHaveLength(0)
  })

  it('getFavorites reflects the live contribution (seeded set, then a genuine unpin)', () => {
    const reg = new SessionRegistry(vi.fn(), makeScheduler(), 600)
    expect(reg.getFavorites()).toBeUndefined() // nothing recorded yet
    reg.seed(restored)
    expect(reg.getFavorites()).toEqual(restored.favorites)
    reg.setFavorites([]) // a genuine unpin of the last favorite is respected (not protected away)
    expect(reg.getFavorites()).toEqual([])
  })

  it('seed does NOT trigger a save (pure population)', () => {
    const save = vi.fn()
    const reg = new SessionRegistry(save, makeScheduler(), 600)
    reg.seed(restored)
    expect(save).not.toHaveBeenCalled()
  })
})
