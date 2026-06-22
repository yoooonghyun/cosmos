import * as React from "react"
import { AlertTriangle } from "lucide-react"

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
 * `Dialog` (no `alert-dialog` primitive) with a `destructive` confirm Button and an
 * `outline` Cancel. Reused at every disconnect site so the prompt is uniform by
 * construction; the integration-specific copy is passed in via `title`/`description`.
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
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              aria-hidden
              className="size-4 shrink-0 text-destructive"
            />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* Cancel takes initial focus (autoFocus) so a stray Enter can never
              trigger the destructive action. `ghost` Cancel + `destructive`
              confirm mirrors the Settings Save-confirm footer so the two confirm
              surfaces read identically. */}
          <Button
            type="button"
            variant="ghost"
            autoFocus
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
