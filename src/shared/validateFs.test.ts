import { describe, it, expect, vi } from 'vitest'
import { validateFsPath, validateFsWatch } from './validate'
import { FsChannel } from './ipc'

/*
 * fs:* inbound-payload validators (terminal-file-explorer-v1, FR-023, SC-005). The main
 * boundary MUST accept a shape-valid frame and warn+ignore (→ null) a malformed one — never
 * crash, never read out-of-root. Shape only; the CONFINEMENT gate (pathConfine) is separate.
 */

describe('validateFsPath (fs:list / fs:read)', () => {
  it('accepts a well-formed payload', () => {
    expect(validateFsPath({ paneId: 'p1', relPath: 'src/a.ts' }, FsChannel.List)).toEqual({
      paneId: 'p1',
      relPath: 'src/a.ts'
    })
  })

  it('accepts an EMPTY relPath (the root itself is valid)', () => {
    expect(validateFsPath({ paneId: 'p1', relPath: '' }, FsChannel.Read)).toEqual({
      paneId: 'p1',
      relPath: ''
    })
  })

  it('drops extra fields, keeping only paneId + relPath', () => {
    expect(
      validateFsPath({ paneId: 'p1', relPath: 'a', root: '/etc', extra: 1 }, FsChannel.List)
    ).toEqual({ paneId: 'p1', relPath: 'a' })
  })

  it('rejects a non-object payload (warn + null)', () => {
    const warn = vi.fn()
    expect(validateFsPath(null, FsChannel.List, warn)).toBeNull()
    expect(validateFsPath('nope', FsChannel.List, warn)).toBeNull()
    expect(validateFsPath(42, FsChannel.List, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('rejects a missing / empty / non-string paneId (warn + null)', () => {
    const warn = vi.fn()
    expect(validateFsPath({ relPath: 'a' }, FsChannel.List, warn)).toBeNull()
    expect(validateFsPath({ paneId: '', relPath: 'a' }, FsChannel.List, warn)).toBeNull()
    expect(validateFsPath({ paneId: 7, relPath: 'a' }, FsChannel.List, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('rejects a non-string relPath (warn + null)', () => {
    const warn = vi.fn()
    expect(validateFsPath({ paneId: 'p1' }, FsChannel.Read, warn)).toBeNull()
    expect(validateFsPath({ paneId: 'p1', relPath: 5 }, FsChannel.Read, warn)).toBeNull()
    expect(validateFsPath({ paneId: 'p1', relPath: null }, FsChannel.Read, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })
})

describe('validateFsWatch (fs:watchStart / fs:watchStop)', () => {
  it('accepts a well-formed payload (paneId only)', () => {
    expect(validateFsWatch({ paneId: 'p1' }, FsChannel.WatchStart)).toEqual({ paneId: 'p1' })
  })

  it('drops extra fields', () => {
    expect(validateFsWatch({ paneId: 'p1', relPath: 'x' }, FsChannel.WatchStop)).toEqual({
      paneId: 'p1'
    })
  })

  it('rejects a non-object payload (warn + null)', () => {
    const warn = vi.fn()
    expect(validateFsWatch(undefined, FsChannel.WatchStart, warn)).toBeNull()
    expect(validateFsWatch([], FsChannel.WatchStart, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing / empty / non-string paneId (warn + null)', () => {
    const warn = vi.fn()
    expect(validateFsWatch({}, FsChannel.WatchStop, warn)).toBeNull()
    expect(validateFsWatch({ paneId: '' }, FsChannel.WatchStop, warn)).toBeNull()
    expect(validateFsWatch({ paneId: {} }, FsChannel.WatchStop, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
