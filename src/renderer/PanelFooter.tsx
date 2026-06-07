/**
 * PanelFooter — the reusable bottom status strip shared by all five rail panels.
 *
 * Unifies every panel on the Terminal layout (tab strip topmost, no extra top chrome):
 * a thin footer that names the PANEL/surface (e.g. "Terminal", "Slack") on the left,
 * mirroring the left rail rather than the active tab. Integration panels
 * (Jira/Slack/Confluence) pass their connection status cluster as the `right` slot, so
 * the connection bar lives in this same footer row rather than as a separate bar.
 *
 * The active tab is still consulted, but ONLY for its run-status glyph (in-flight
 * spinner / error icon) so the footer reflects the active tab's loading/error state
 * while the text stays the surface name.
 */

import { CircleAlert, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PanelTab } from './PanelTabStrip'

export interface PanelFooterProps {
  /** The panel/surface name shown on the left, e.g. "Terminal", "Slack". */
  surfaceName: string
  /** The surface's rail icon (matches the left rail); shown when not in-flight/error. */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** The currently-active tab — consulted only for its run-status glyph. */
  activeTab: PanelTab | null
  /** Optional right-aligned content (e.g. an integration's connection status). */
  right?: React.ReactNode
}

export function PanelFooter({
  surfaceName,
  icon: Icon,
  activeTab,
  right
}: PanelFooterProps): React.JSX.Element {
  const status = activeTab?.status ?? 'idle'

  return (
    <div className="flex h-7 shrink-0 select-none items-center justify-between gap-3 border-t border-border bg-popover px-3 text-[11px] text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5" aria-label="Panel">
        {status === 'in-flight' ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden={true} />
        ) : status === 'error' ? (
          <CircleAlert className="size-3 shrink-0 text-destructive" aria-hidden={true} />
        ) : Icon ? (
          <Icon className="size-3 shrink-0" aria-hidden={true} />
        ) : null}
        <span className={cn('min-w-0 truncate', status === 'error' && 'text-destructive')}>
          {surfaceName}
        </span>
      </span>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}
