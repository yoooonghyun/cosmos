import { describe, it, expect, vi } from 'vitest'
import { PendingCallRegistry } from './pendingCalls'

describe('PendingCallRegistry (FR-007, FR-009, FR-012, SC-006)', () => {
  it('resolves the pending call exactly once on a matching submit (happy path)', () => {
    const reg = new PendingCallRegistry()
    const resolve = vi.fn()
    reg.add('r1', resolve)

    const matched = reg.resolve('r1', { type: 'submit', actionId: 'go', values: { a: 1 } })

    expect(matched).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({ type: 'submit', actionId: 'go', values: { a: 1 } })
  })

  it('does not resolve, and reports false, for an unknown/stale requestId (FR-012, SC-006)', () => {
    const reg = new PendingCallRegistry()
    const resolve = vi.fn()
    reg.add('r1', resolve)

    const matched = reg.resolve('stale', { type: 'submit' })

    expect(matched).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
    // The genuine call is still pending and can still resolve correctly.
    expect(reg.has('r1')).toBe(true)
  })

  it('never resolves a settled call a second time (resolve exactly once)', () => {
    const reg = new PendingCallRegistry()
    const resolve = vi.fn()
    reg.add('r1', resolve)

    reg.resolve('r1', { type: 'submit', actionId: 'first' })
    const second = reg.resolve('r1', { type: 'submit', actionId: 'second' })

    expect(second).toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({ type: 'submit', actionId: 'first' })
  })

  it('supersedes a pending surface: the old call resolves cancel exactly once (FR-014)', () => {
    const reg = new PendingCallRegistry()
    const first = vi.fn()
    const second = vi.fn()

    reg.add('r1', first)
    reg.add('r2', second) // new surface supersedes r1

    expect(first).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledWith({ type: 'cancel' })
    expect(second).not.toHaveBeenCalled()
    expect(reg.has('r2')).toBe(true)
    // The superseded call is gone; resolving it does nothing.
    expect(reg.resolve('r1', { type: 'submit' })).toBe(false)
    expect(first).toHaveBeenCalledOnce()
  })

  it('cancelCurrent resolves the pending call cancel exactly once (reload/disconnect — FR-009)', () => {
    const reg = new PendingCallRegistry()
    const resolve = vi.fn()
    reg.add('r1', resolve)

    expect(reg.cancelCurrent()).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({ type: 'cancel' })

    // Idempotent: nothing pending now.
    expect(reg.cancelCurrent()).toBe(false)
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('explicit cancel action resolves the pending call once (FR-009)', () => {
    const reg = new PendingCallRegistry()
    const resolve = vi.fn()
    reg.add('r1', resolve)

    expect(reg.resolve('r1', { type: 'cancel' })).toBe(true)
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith({ type: 'cancel' })
  })
})
