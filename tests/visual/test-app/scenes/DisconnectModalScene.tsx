/**
 * DisconnectModalScene — renders the shared ConfirmDialog (the disconnect modal) OPEN so
 * Playwright/screenshot can capture its ACTUAL rendered pixels against the real design tokens
 * (the harness loads src/renderer/index.css with the .dark class). Used to diagnose the recurring
 * "disconnect modal looks off-system" report: reading code shows it is canonical, so we need the
 * real render to find the runtime gap.
 */

import React from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export function DisconnectModalScene() {
  return (
    <div data-testid="disconnect-modal-scene" className="h-screen w-screen bg-background">
      <ConfirmDialog
        open
        title="Disconnect Confluence?"
        description="This will sign you out of Confluence. You'll need to reconnect to use it again."
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />
    </div>
  )
}
