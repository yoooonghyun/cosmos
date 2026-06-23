import { describe, expect, it } from 'vitest'
import { resolveCloseTarget } from './closeTabRouting'

describe('resolveCloseTarget', () => {
  it('routes to file-tab when the viewer is focused and ≥1 file is open (FR-002)', () => {
    expect(resolveCloseTarget({ viewerFocused: true, openFileCount: 1 })).toBe('file-tab')
    expect(resolveCloseTarget({ viewerFocused: true, openFileCount: 3 })).toBe('file-tab')
  })

  it('falls through to panel-tab when the viewer is focused but empty (FR-005, OQ-2)', () => {
    expect(resolveCloseTarget({ viewerFocused: true, openFileCount: 0 })).toBe('panel-tab')
  })

  it('routes to panel-tab when the viewer is not focused, even with open files (FR-004)', () => {
    expect(resolveCloseTarget({ viewerFocused: false, openFileCount: 2 })).toBe('panel-tab')
  })

  it('routes to panel-tab when the viewer is not focused and empty', () => {
    expect(resolveCloseTarget({ viewerFocused: false, openFileCount: 0 })).toBe('panel-tab')
  })
})
