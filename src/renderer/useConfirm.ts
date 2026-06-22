/**
 * useConfirm — a thin React hook over the pure `confirmLogic` state machine that
 * drives the shared disconnect-confirm modal (disconnect-confirm-modal-v1).
 *
 * Mount ONE per surface (each integration panel; once at the Settings dialog level).
 * A "Disconnect" affordance calls `requestConfirm(target, onConfirm)` to OPEN the
 * modal instead of disconnecting; the real `window.cosmos.<int>.disconnect()` is the
 * `onConfirm` callback and runs only from `confirm()` (FR-001/FR-002). `cancel()` —
 * also fired on Esc/overlay/Cancel — closes without running it (FR-003/FR-010).
 *
 * The side-effecting `onConfirm` is kept in a ref (not state) so the open/target
 * STATE stays pure and node-testable in `confirmLogic`. `confirm()` clears the ref
 * before invoking it, so a rapid double-confirm fires the disconnect exactly once
 * (the double-confirm guard from the spec's Edge Cases).
 */

import { useCallback, useRef, useState } from 'react'
import {
  closeConfirm,
  closedConfirmState,
  openConfirm,
  type ConfirmState,
  type ConfirmTarget
} from './confirmLogic'

export interface UseConfirm {
  /** The live confirm state — `{ open, target }` — for the `ConfirmDialog`. */
  state: ConfirmState
  /** Open the modal against `target`; `onConfirm` runs only if the user confirms. */
  requestConfirm: (target: ConfirmTarget, onConfirm: () => void) => void
  /** Run the stored `onConfirm` once, then close (the destructive action). */
  confirm: () => void
  /** Close without running `onConfirm` (Cancel / Esc / overlay). */
  cancel: () => void
}

export function useConfirm(): UseConfirm {
  const [state, setState] = useState<ConfirmState>(closedConfirmState)
  const onConfirmRef = useRef<(() => void) | null>(null)

  const requestConfirm = useCallback(
    (target: ConfirmTarget, onConfirm: () => void) => {
      onConfirmRef.current = onConfirm
      setState(openConfirm(target))
    },
    []
  )

  const confirm = useCallback(() => {
    // Double-confirm guard: clear the ref BEFORE running so the disconnect fires once
    // even on a rapid double click (the modal also closes on confirm).
    const run = onConfirmRef.current
    onConfirmRef.current = null
    setState(closeConfirm())
    run?.()
  }, [])

  const cancel = useCallback(() => {
    onConfirmRef.current = null
    setState(closeConfirm())
  }, [])

  return { state, requestConfirm, confirm, cancel }
}
