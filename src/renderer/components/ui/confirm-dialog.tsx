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
 * Visual parity (disconnect-modal-design-fix): the body is the SAME canonical
 * `DialogHeader` > `DialogTitle` + `DialogDescription` pair every sibling dialog uses
 * (e.g. SettingsDialog), on the standard popover surface — NOT a red `Alert` card.
 *
 * SURFACE — load-bearing, do NOT drop (root cause of the recurring "modal looks
 * off-system" report): `DialogContent` MUST carry `bg-popover`. The shadcn
 * `DialogContent` default is `bg-background` (`--background` = #1e1e1e, the editor
 * surface), but EVERY other dialog in the app (SettingsDialog, SlackImageViewer)
 * overrides it to `bg-popover` (`--popover` = #252526, the chrome surface). Without
 * this override the disconnect modal alone renders on the darker #1e1e1e surface, so
 * its background reads wrong AND the same `foreground` / `muted-foreground` text reads
 * at a different contrast than every sibling — which is exactly the four reported axes
 * (background, title color, description color, contrast). Matching `bg-popover` puts it
 * on the identical surface every sibling dialog uses.
 *
 * So the title is `foreground` at the standard dialog-title size, the description is
 * `muted-foreground` at the standard body size, on the same popover surface as siblings.
 * The destructive SEMANTIC lives ONLY on the confirm action (the `destructive` Button);
 * the rest of the modal stays in neutral system tokens. The `ghost` Cancel + `destructive`
 * confirm pairing at the default Button size is the SAME pairing SettingsDialog's own
 * disconnect-confirm footer uses, so the buttons are on-system by construction.
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
