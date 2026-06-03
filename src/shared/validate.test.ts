import { describe, it, expect, vi } from 'vitest'
import { validateInput, validateResize } from './validate'

describe('validateInput (FR-004, FR-010)', () => {
  it('accepts a valid pty:input payload (happy path)', () => {
    const warn = vi.fn()
    const result = validateInput({ data: 'ls -la\r' }, warn)
    expect(result).toEqual({ data: 'ls -la\r' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts an empty-string data field (valid, not "missing")', () => {
    const warn = vi.fn()
    const result = validateInput({ data: '' }, warn)
    expect(result).toEqual({ data: '' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra/optional unknown fields without erroring', () => {
    const warn = vi.fn()
    // Extra properties are not part of the contract but must not cause failure.
    const result = validateInput({ data: 'x', extra: 123 } as unknown, warn)
    expect(result).toEqual({ data: 'x' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when required "data" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateInput({}, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "data" is the wrong type', () => {
    const warn = vi.fn()
    const result = validateInput({ data: 42 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([null, undefined, 'a string', 42])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateInput(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})

describe('validateResize (FR-005, FR-010)', () => {
  it('accepts a valid pty:resize payload (happy path)', () => {
    const warn = vi.fn()
    const result = validateResize({ cols: 80, rows: 24 }, warn)
    expect(result).toEqual({ cols: 80, rows: 24 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores extra unknown fields without erroring', () => {
    const warn = vi.fn()
    const result = validateResize({ cols: 120, rows: 40, pixelWidth: 999 } as unknown, warn)
    expect(result).toEqual({ cols: 120, rows: 40 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and returns null when "cols" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateResize({ rows: 24 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns and returns null when "rows" is missing (SC-005)', () => {
    const warn = vi.fn()
    const result = validateResize({ cols: 80 }, warn)
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it.each([0, -1, 1.5, NaN, Infinity, '80'])(
    'warns and returns null for invalid cols value %p',
    (cols) => {
      const warn = vi.fn()
      const result = validateResize({ cols, rows: 24 } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([0, -1, 2.2, NaN, Infinity, '24'])(
    'warns and returns null for invalid rows value %p',
    (rows) => {
      const warn = vi.fn()
      const result = validateResize({ cols: 80, rows } as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )

  it.each([null, undefined, 'nope', 7])(
    'warns and returns null for non-object payload %p',
    (raw) => {
      const warn = vi.fn()
      const result = validateResize(raw as unknown, warn)
      expect(result).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    }
  )
})
