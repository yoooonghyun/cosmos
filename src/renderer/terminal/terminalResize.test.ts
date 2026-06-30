/**
 * node-unit (TERM-RESIZE-GUARD-01) for the PURE resize-arbitration predicate
 * (cosmos-terminal-favorite-multiplex-v1, FR-011/FR-012). A terminal view drives `pty:resize` ONLY
 * when its container is measurable (on-screen, non-zero); a hidden / zero-size view must not, so a
 * multiplexed paneId's off-screen view never pushes a competing size.
 */
import { describe, it, expect } from 'vitest'
import { shouldDriveResize } from './terminalResize'

/** A minimal element-like with controllable layout dims. */
const box = (clientWidth: number, clientHeight: number): HTMLElement =>
  ({ clientWidth, clientHeight }) as HTMLElement

describe('shouldDriveResize (TERM-RESIZE-GUARD-01)', () => {
  it('drives resize for a MEASURABLE (non-zero) container', () => {
    expect(shouldDriveResize(box(800, 600))).toBe(true)
  })

  it('does NOT drive resize for a hidden / zero-size container (FR-011)', () => {
    expect(shouldDriveResize(box(0, 600))).toBe(false) // zero width (collapsed/hidden)
    expect(shouldDriveResize(box(800, 0))).toBe(false) // zero height
    expect(shouldDriveResize(box(0, 0))).toBe(false) // fully hidden tab/rail
  })

  it('does NOT drive resize for a null/undefined container (not mounted)', () => {
    expect(shouldDriveResize(null)).toBe(false)
    expect(shouldDriveResize(undefined)).toBe(false)
  })
})
