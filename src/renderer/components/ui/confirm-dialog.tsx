import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * ConfirmDialog — the ONE shared destructive-confirm modal
 * (disconnect-confirm-modal-v1, FR-004/FR-007). Composed from the existing shadcn
 * `Dialog` with a `destructive` confirm Button and a `ghost` Cancel. Reused at every
 * disconnect site so the prompt is uniform by construction; the integration-specific
 * copy is passed in via `title`/`description`.
 *
 * This modal IS the canonical CONFIRM / ALERT dialog class (DESIGN.md §4 "Dialog
 * classes" + D-13). Every dimension is pinned BY RULE so it is indistinguishable in
 * system language from its siblings, not by per-component judgment:
 *   • surface  `bg-popover` (#252526) — the `Dialog` primitive default (D-1);
 *   • width    `sm:max-w-sm` — the ONLY class override (the small decision-forcing size);
 *   • title    `text-title` foreground semibold / description `text-body` muted (§8),
 *              carried by the primitive `DialogTitle`/`DialogDescription` (no overrides);
 *   • footer   `ghost` Cancel + `destructive` confirm, BOTH at the **default** Button
 *              size (h-9) — the SAME pairing + size SettingsDialog's footer uses (D-13);
 *   • no `×`   `showCloseButton={false}` — Cancel is the dismiss.
 * It composes ENTIRELY from the foundation `Dialog` primitive + `Button` variants — no
 * bespoke surface, typography, color, or off-class button size.
 *
 * SURFACE: the `Dialog` primitive now DEFAULTS to `bg-popover` (the cosmos chrome
 * surface #252526, foundation §2) with `shadow-overlay` elevation + `z-overlay`
 * stacking (§11/§13) — so the recurring "modal renders on the wrong #1e1e1e editor
 * surface" regression (D-1) can no longer happen by omission. `bg-popover` is repeated
 * here as defense-in-depth. The title is `foreground` at the `text-title` step and the
 * description is `muted-foreground` at the `text-body` step (§8), carried by the
 * primitive's `DialogTitle`/`DialogDescription`.
 *
 * DESTRUCTIVE AFFORDANCE (§4 / D-2 / D-12): a disconnect IS destructive, so the confirm
 * is a `destructive` Button — and the variant now renders the cosmos `--destructive`
 * pastel as a SOLID fill with `--destructive-foreground` text (D-12), so it reads
 * legibly destructive on the popover surface (the prior washed-out translucent-pink
 * `dark:bg-destructive/60` + white text was the real "still looks off" defect). The
 * destructive SEMANTIC lives ONLY on the confirm action; the surrounding text/surface
 * stay neutral system tokens. `ghost` Cancel + `destructive` confirm at the default
 * Button size is the SAME pairing SettingsDialog's force-disconnect footer uses.
 *
 * Closing via Esc / overlay / Cancel calls `onOpenChange(false)` WITHOUT confirming
 * (FR-003/FR-010) — only the destructive button calls `onConfirm`. The destructive
 * button is NOT autofocused so a stray Enter cannot drop a connection (spec Open
 * Question default: Enter does not confirm); focus stays on Cancel.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Disconnect",
  cancelLabel = "Cancel",
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover sm:max-w-sm" showCloseButton={false}>
        {/* Canonical dialog body: the standard `DialogHeader` > `DialogTitle`
            (foreground, standard title size) + `DialogDescription`
            (muted-foreground, standard body size) on the neutral popover/background
            surface — the SAME treatment every sibling dialog (SettingsDialog) uses,
            so this modal reads on-system. The destructive semantic is carried ONLY
            by the confirm Button below, not by the surrounding text/background. */}
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* Cancel takes initial focus (autoFocus) so a stray Enter can never
              trigger the destructive action. A calm `ghost` Cancel + a
              `destructive` confirm carries the destructive semantic on the action
              alone. Both use the app's prevailing default Button size to match
              sibling dialogs. */}
          <Button
            type="button"
            variant="ghost"
            autoFocus
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
