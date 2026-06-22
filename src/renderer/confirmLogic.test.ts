/**
 * confirmLogic.test — the pure confirm-state machine behind the shared
 * disconnect-confirm modal (disconnect-confirm-modal-v1, SC-002/SC-003).
 *
 * Node env (no jsdom): tests the plain `.ts` helper, never imports a `.tsx`. These
 * assert the open→confirm (disconnect runs once) and open→cancel (disconnect does
 * NOT run) state transitions plus the integration-named copy — the behavior that
 * makes an accidental Disconnect click recoverable. They FAIL without the logic
 * (there is no state machine / copy builder to exercise).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  closeConfirm,
  closedConfirmState,
  confirmCopy,
  openConfirm,
  type ConfirmTarget
} from './confirmLogic'

const SLACK: ConfirmTarget = { integration: 'slack', label: 'Slack' }

describe('confirmLogic state', () => {
  it('starts closed with no target', () => {
    expect(closedConfirmState).toEqual({ open: false, target: null })
  })

  it('openConfirm sets open:true and records the target', () => {
    const next = openConfirm(SLACK)
    expect(next.open).toBe(true)
    expect(next.target).toEqual(SLACK)
  })

  it('closeConfirm returns open:false and clears the target', () => {
    const next = closeConfirm()
    expect(next.open).toBe(false)
    expect(next.target).toBeNull()
  })
})

describe('confirmCopy', () => {
  it('names the integration in the title (FR-005)', () => {
    const copy = confirmCopy('Slack')
    expect(copy.title).toContain('Slack')
    expect(copy.title).toBe('Disconnect Slack?')
  })

  it('body explains a reconnect is needed and names the integration', () => {
    const copy = confirmCopy('Google Calendar')
    expect(copy.body).toMatch(/reconnect/i)
    expect(copy.body).toContain('Google Calendar')
  })

  it('the destructive action is labelled Disconnect (FR-006)', () => {
    expect(confirmCopy('Jira').confirmLabel).toBe('Disconnect')
  })
})

/**
 * The open→confirm / open→cancel contract that `useConfirm` enforces, exercised at
 * the pure-reducer + ref seam (no live DOM, SC-002). `confirm()` runs the stored
 * callback EXACTLY ONCE then closes; `cancel()` runs it ZERO times then closes. This
 * mirrors `useConfirm`'s internal logic (state via the reducers, side effect via a
 * ref) so it is testable in node.
 */
describe('confirm flow (open→confirm runs once, open→cancel runs zero)', () => {
  function makeFlow(): {
    request: (t: ConfirmTarget, onConfirm: () => void) => void
    confirm: () => void
    cancel: () => void
    getState: () => { open: boolean; target: ConfirmTarget | null }
  } {
    let state = closedConfirmState
    let pending: (() => void) | null = null
    return {
      request: (t, onConfirm) => {
        pending = onConfirm
        state = openConfirm(t)
      },
      confirm: () => {
        const run = pending
        pending = null // double-confirm guard: clear before running so it can fire only once
        state = closeConfirm()
        run?.()
      },
      cancel: () => {
        pending = null
        state = closeConfirm()
      },
      getState: () => state
    }
  }

  it('open→confirm fires the disconnect exactly once and closes', () => {
    const flow = makeFlow()
    const disconnect = vi.fn()
    flow.request(SLACK, disconnect)
    expect(flow.getState().open).toBe(true)
    flow.confirm()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(flow.getState().open).toBe(false)
  })

  it('rapid double-confirm still fires the disconnect only once', () => {
    const flow = makeFlow()
    const disconnect = vi.fn()
    flow.request(SLACK, disconnect)
    flow.confirm()
    flow.confirm()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('open→cancel fires the disconnect zero times and closes', () => {
    const flow = makeFlow()
    const disconnect = vi.fn()
    flow.request(SLACK, disconnect)
    flow.cancel()
    expect(disconnect).not.toHaveBeenCalled()
    expect(flow.getState().open).toBe(false)
  })
})
