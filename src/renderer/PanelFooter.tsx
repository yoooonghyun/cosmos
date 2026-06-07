/**
 * PanelFooter — the reusable bottom status strip shared by all five rail panels.
 *
 * Unifies every panel on the Terminal layout (tab strip topmost, no extra top chrome):
 * a thin footer that always names the ACTIVE tab on the left. Integration panels
 * (Jira/Slack/Confluence) pass their connection status cluster as the `right` slot, so
 * the connection bar lives in this same footer row rather than as a separate bar.
 *
 * The left indicator mirrors the active tab's `PanelTab` descriptor (glyph + label +
 * status) so the footer and the tab strip stay in lockstep.
 */

import { CircleAlert, Loader2, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PanelTab } from './PanelTabStrip'

export interface PanelFooterProps {
  /** The currently-active tab, or null when none is active. */
  activeTab: PanelTab | null
  /** Optional right-aligned content (e.g. an integration's connection status). */
  right?: React.ReactNode
}

export function PanelFooter({ activeTab, right }: PanelFooterProps): React.JSX.Element {
  const kind = activeTab?.kind ?? 'generative'
  const status = activeTab?.status ?? 'idle'
  const isTerminal = kind === 'terminal'

  return (
    <div className="flex h-7 shrink-0 select-none items-center justify-between gap-3 border-t border-border bg-popover px-3 text-[11px] text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5" aria-label="Active tab">
        {status === 'in-flight' ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
        ) : status === 'error' ? (
          <CircleAlert className="size-3 shrink-0 text-destructive" aria-hidden="true" />
        ) : isTerminal ? (
          <SquareTerminal className="size-3 shrink-0" aria-hidden="true" />
        ) : null}
        <span
          className={cn(
            'min-w-0 truncate',
            activeTab?.untitled && 'italic',
            status === 'error' && 'text-destructive'
          )}
        >
          {activeTab ? activeTab.label : 'No tab'}
        </span>
      </span>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}
