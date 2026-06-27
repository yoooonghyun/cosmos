import { describe, it, expect, vi } from 'vitest'
import {
  PERSISTENT_SESSION_TARGET,
  isPersistentSessionTarget,
  selectDefaultSessionId,
  decideSubmit
} from './agentSessionQueue'

describe('isPersistentSessionTarget (cosmos-conversation-panel-v1 step 2)', () => {
  it('is true only for the default render target', () => {
    expect(isPersistentSessionTarget(PERSISTENT_SESSION_TARGET)).toBe(true)
    expect(isPersistentSessionTarget('generated-ui')).toBe(true)
    expect(isPersistentSessionTarget('jira')).toBe(false)
    expect(isPersistentSessionTarget('slack')).toBe(false)
    expect(isPersistentSessionTarget('confluence')).toBe(false)
  })
})

describe('selectDefaultSessionId — create-or-continue', () => {
  it('mints a fresh id when nothing is persisted (and flags it for the caller to persist)', () => {
    const mint = vi.fn(() => 'fresh-uuid')
    const sel = selectDefaultSessionId(null, mint)
    expect(sel).toEqual({ sessionId: 'fresh-uuid', minted: true })
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('mints when the persisted value is undefined', () => {
    const sel = selectDefaultSessionId(undefined, () => 'fresh')
    expect(sel).toEqual({ sessionId: 'fresh', minted: true })
  })

  it('mints when the persisted value is blank/whitespace (corrupt) — never reuses an empty id', () => {
    const sel = selectDefaultSessionId('   ', () => 'fresh')
    expect(sel).toEqual({ sessionId: 'fresh', minted: true })
  })

  it('REUSES a persisted, non-empty id (continuity across runs + relaunch) and does NOT mint', () => {
    const mint = vi.fn(() => 'would-not-use')
    const sel = selectDefaultSessionId('persisted-id', mint)
    expect(sel).toEqual({ sessionId: 'persisted-id', minted: false })
    expect(mint).not.toHaveBeenCalled()
  })
})

describe('decideSubmit — spawn / enqueue / drop', () => {
  it('spawns immediately when idle, regardless of target', () => {
    expect(decideSubmit({ running: false, isPersistentTarget: true })).toEqual({ action: 'spawn' })
    expect(decideSubmit({ running: false, isPersistentTarget: false })).toEqual({ action: 'spawn' })
  })

  it('ENQUEUES a default-conversation submit while busy (serialize the continuous conversation)', () => {
    expect(decideSubmit({ running: true, isPersistentTarget: true })).toEqual({ action: 'enqueue' })
  })

  it('DROPS a non-default submit while busy (today’s blocked-while-busy is unchanged)', () => {
    expect(decideSubmit({ running: true, isPersistentTarget: false })).toEqual({ action: 'drop' })
  })
})
