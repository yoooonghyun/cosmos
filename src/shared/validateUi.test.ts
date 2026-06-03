import { describe, it, expect, vi } from 'vitest'
import { validateUiAction, validateSurfaceUpdate } from './validate'

describe('validateUiAction (FR-006, FR-010, SC-006)', () => {
  it('accepts a valid submit action with actionId and values (happy path)', () => {
    const warn = vi.fn()
    const result = validateUiAction(
      { requestId: 'r1', action: { type: 'submit', actionId: 'confirm', values: { name: 'Ada' } } },
      warn
    )
    expect(result).toEqual({
      requestId: 'r1',
      action: { type: 'submit', actionId: 'confirm', values: { name: 'Ada' } }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a submit action with the optional fields omitted (missing optional must not error)', () => {
    const warn = vi.fn()
    const result = validateUiAction({ requestId: 'r1', action: { type: 'submit' } }, warn)
    expect(result).toEqual({ requestId: 'r1', action: { type: 'submit' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a cancel action (FR-009)', () => {
    const warn = vi.fn()
    const result = validateUiAction({ requestId: 'r1', action: { type: 'cancel' } }, warn)
    expect(result).toEqual({ requestId: 'r1', action: { type: 'cancel' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra/unknown fields without erroring', () => {
    const warn = vi.fn()
    const result = validateUiAction(
      { requestId: 'r1', action: { type: 'cancel', extra: 1 }, stray: true } as unknown,
      warn
    )
    expect(result).toEqual({ requestId: 'r1', action: { type: 'cancel' } })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when required "requestId" is missing (SC-006)', () => {
    const warn = vi.fn()
    const result = validateUiAction({ action: { type: 'submit' } }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "requestId" is an empty string (cannot correlate)', () => {
    const warn = vi.fn()
    const result = validateUiAction({ requestId: '', action: { type: 'submit' } }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "action" is missing', () => {
    const warn = vi.fn()
    const result = validateUiAction({ requestId: 'r1' }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each(['', 'done', 'click', null, 42])(
    'warns and returns null for invalid action.type %p',
    (type) => {
      const warn = vi.fn()
      const result = validateUiAction({ requestId: 'r1', action: { type } } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it('warns and returns null when action.actionId is the wrong type', () => {
    const warn = vi.fn()
    const result = validateUiAction(
      { requestId: 'r1', action: { type: 'submit', actionId: 99 } } as unknown,
      warn
    )
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when action.values is malformed (not an object)', () => {
    const warn = vi.fn()
    const result = validateUiAction(
      { requestId: 'r1', action: { type: 'submit', values: 'nope' } } as unknown,
      warn
    )
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'a string', 7])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateUiAction(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateSurfaceUpdate (FR-003, SC-005)', () => {
  it('accepts a well-formed surfaceUpdate spec (happy path)', () => {
    const warn = vi.fn()
    const spec = {
      surfaceId: 's1',
      components: [{ id: 'btn', component: { Button: { label: 'Go' } } }]
    }
    const result = validateSurfaceUpdate(spec, warn)
    expect(result).toEqual(spec)
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an empty components array (valid — no controls is structurally fine)', () => {
    const warn = vi.fn()
    const result = validateSurfaceUpdate({ surfaceId: 's1', components: [] }, warn)
    expect(result).toEqual({ surfaceId: 's1', components: [] })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when surfaceId is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateSurfaceUpdate({ components: [] }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when components is not an array (SC-005)', () => {
    const warn = vi.fn()
    const result = validateSurfaceUpdate({ surfaceId: 's1', components: {} }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'surfaceUpdate', 42, []])(
    'warns and returns null for non-object / non-surfaceUpdate spec %p (SC-005)',
    (raw) => {
      const warn = vi.fn()
      const result = validateSurfaceUpdate(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})
