import { describe, it, expect, vi } from 'vitest'
import { SESSION_SCHEMA_VERSION } from '../shared/ipc'
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
})
