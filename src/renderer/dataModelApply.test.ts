import { describe, it, expect, vi } from 'vitest'
import { applyDataModel } from './dataModelApply'

/* jira-generative-adapter-v1 — renderer-side in-place data-model apply (FR-002/FR-010/
 * FR-023). Node-env test (no jsdom): exercises the pure apply helper ActiveTabSurface
 * uses for the initial seed + each `ui:dataModel` push. Pattern per FR: happy path;
 * missing optional (no error); invalid/missing required (warn + safe ignore). */

const SURFACE = 'jira-issue-list'

describe('applyDataModel (FR-002/FR-010)', () => {
  it('forwards a full { surfaceId, path, value } push to the SDK (happy path)', () => {
    const process = vi.fn()
    const warn = vi.fn()
    const ok = applyDataModel(process, SURFACE, { surfaceId: SURFACE, path: '/items', value: [1, 2] }, warn)
    expect(ok).toBe(true)
    expect(process).toHaveBeenCalledWith({
      updateDataModel: { surfaceId: SURFACE, path: '/items', value: [1, 2] }
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('preserves an explicit undefined value (remove semantics) when the key is present', () => {
    const process = vi.fn()
    applyDataModel(process, SURFACE, { surfaceId: SURFACE, path: '/error', value: undefined })
    const msg = process.mock.calls[0][0] as { updateDataModel: { value?: unknown } }
    expect('value' in msg.updateDataModel).toBe(true)
    expect(msg.updateDataModel.value).toBeUndefined()
  })

  it('applies a root push with no path (missing optional must not error)', () => {
    const process = vi.fn()
    const warn = vi.fn()
    const ok = applyDataModel(process, SURFACE, { surfaceId: SURFACE, value: { a: 1 } }, warn)
    expect(ok).toBe(true)
    expect(process).toHaveBeenCalledWith({ updateDataModel: { surfaceId: SURFACE, value: { a: 1 } } })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('applyDataModel — safe fallback (FR-023)', () => {
  it('ignores (silently) a push for a DIFFERENT surface — never touches this surface', () => {
    const process = vi.fn()
    const ok = applyDataModel(process, SURFACE, { surfaceId: 'other', path: '/items', value: [] })
    expect(ok).toBe(false)
    expect(process).not.toHaveBeenCalled()
  })

  it('warns + ignores a non-object payload', () => {
    const process = vi.fn()
    const warn = vi.fn()
    expect(applyDataModel(process, SURFACE, 'nope', warn)).toBe(false)
    expect(process).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a missing surfaceId', () => {
    const process = vi.fn()
    const warn = vi.fn()
    expect(applyDataModel(process, SURFACE, { path: '/items', value: [] }, warn)).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns + ignores a non-string path', () => {
    const process = vi.fn()
    const warn = vi.fn()
    expect(applyDataModel(process, SURFACE, { surfaceId: SURFACE, path: 7 }, warn)).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('never throws when the SDK processMessage throws — degrades to warn', () => {
    const process = vi.fn(() => {
      throw new Error('boom')
    })
    const warn = vi.fn()
    expect(applyDataModel(process, SURFACE, { surfaceId: SURFACE, path: '/items', value: [] }, warn)).toBe(false)
    expect(warn).toHaveBeenCalled()
  })
})
