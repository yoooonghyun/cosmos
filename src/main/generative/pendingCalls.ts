/**
 * Pending-call registry for the render_ui bridge (cosmos PoC milestone 2).
 *
 * A `render_ui` tool call is "pending" from the moment main pushes its surface to
 * the renderer until exactly one of these resolves it (FR-007, FR-009, FR-012):
 *   - the user submits an action          -> resolve('submit', ...)
 *   - the user cancels/dismisses          -> resolve('cancel')
 *   - a new surface supersedes this one   -> resolve('cancel') (edge case)
 *   - the renderer reloads / bridge drops -> resolve('cancel') (edge case)
 *
 * This module is pure (no Electron / no `net`) so the resolution rules are
 * unit-testable. It guarantees a pending call resolves AT MOST ONCE, and that a
 * resolution for an unknown/stale `requestId` is reported (so the caller can
 * warn-and-ignore) rather than mis-resolving another call (FR-012, SC-006).
 */

import type { A2uiAction } from '../../shared/ipc'

/** A pending render_ui call awaiting the user's interaction. */
interface PendingCall {
  /** The renderer-facing correlation id (echoed back on `ui:action`). FR-012. */
  requestId: string
  /** Resolves the awaiting MCP tool call with the user's action. FR-007/FR-009. */
  resolve: (action: A2uiAction) => void
}

export class PendingCallRegistry {
  /** At most one active surface at a time (FR-014). */
  private current: PendingCall | null = null

  /**
   * Register a freshly-pushed surface as the active pending call. If a surface is
   * already pending, it is superseded: the old call resolves `cancel` exactly
   * once before the new one becomes current (FR-014, supersede edge case).
   */
  add(requestId: string, resolve: (action: A2uiAction) => void): void {
    if (this.current) {
      this.settle(this.current, { type: 'cancel' })
    }
    this.current = { requestId, resolve }
  }

  /** Whether `requestId` is the currently-pending call. */
  has(requestId: string): boolean {
    return this.current?.requestId === requestId
  }

  /**
   * Resolve the pending call identified by `requestId` with `action`.
   *
   * @returns `true` if a matching pending call was resolved; `false` if the id is
   *   unknown/stale (caller should warn-and-ignore — never mis-resolves another
   *   call). FR-012, SC-006.
   */
  resolve(requestId: string, action: A2uiAction): boolean {
    if (!this.current || this.current.requestId !== requestId) {
      return false
    }
    this.settle(this.current, action)
    return true
  }

  /**
   * Cancel the currently-pending call, if any (renderer reload / bridge
   * disconnect / app teardown). Resolves it `cancel` exactly once so the tool
   * call never hangs (FR-009, edge cases).
   *
   * @returns `true` if a pending call was cancelled.
   */
  cancelCurrent(): boolean {
    if (!this.current) {
      return false
    }
    this.settle(this.current, { type: 'cancel' })
    return true
  }

  /** Settle a call exactly once and clear it if it is still current. */
  private settle(call: PendingCall, action: A2uiAction): void {
    if (this.current === call) {
      this.current = null
    }
    call.resolve(action)
  }
}
