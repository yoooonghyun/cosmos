/**
 * PanelTabStrip — the reusable VS Code-style tab strip shared by all five rail
 * panels (panel-tabs v1, Track B / Phase 5). Built verbatim to the design contract
 * `.sdd/designs/panel-tabs-v1.md` (§2 layout, §3 states, §4 affordances, §5 exact
 * classes, §7 a11y). It is a bespoke composite over existing primitives (`Button`,
 * `Tooltip`) + raw `role=tab` elements — NOT the shadcn `Tabs` primitive (design §9).
 *
 * Generic over tab kind: a panel passes a flat list of `PanelTab` descriptors plus
 * `onActivate` / `onClose` / `onNewTab` callbacks. Terminal vs generative styling is
 * driven by `kind` + per-tab `status` so one component serves every panel.
 *
 * Spec trace: FR-002 (strip, active distinguished), FR-003 (click activates),
 * FR-004 (per-tab close), FR-005 (new-tab `+`), FR-006/FR-007 (adjacent on
 * Delete/Backspace via onClose), FR-008 (overflow horizontal scroll, `+` pinned),
 * FR-009 (Untitled italic-muted), FR-010 (truncated utterance label + tooltip),
 * FR-011 (terminal glyph + "Terminal N"), FR-014 (in-flight Loader2 + aria-busy),
 * FR-015 (error CircleAlert + destructive tint + tooltip message).
 */

import { useRef, type KeyboardEvent } from 'react'
import { CircleAlert, Loader2, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** A tab's lifecycle status as surfaced on the strip (design §3). */
export type PanelTabStatus = 'idle' | 'in-flight' | 'error'

/** A tab's kind — drives the leading glyph + label treatment (design §3.4/§3.5). */
export type PanelTabKind = 'generative' | 'terminal'

/** A single tab descriptor the panel hands to the strip (one per open tab). */
export interface PanelTab {
  /** Stable tab id (the generative tab id, or the terminal `paneId`). */
  id: string
  /** Visible label: the (truncated-by-CSS) utterance, "Untitled", or "Terminal N". */
  label: string
  /** generative vs terminal — selects glyph + label styling. Defaults to generative. */
  kind?: PanelTabKind
  /** Lifecycle status (generative only; terminal tabs are always idle — design §3.6). */
  status?: PanelTabStatus
  /** True for a `+`-created, not-yet-composed generative tab → italic-muted (FR-009). */
  untitled?: boolean
  /** Error message for the tooltip when `status === 'error'` (FR-015). */
  errorMessage?: string
}

export interface PanelTabStripProps {
  /** The open tabs, in order. */
  tabs: PanelTab[]
  /** The active tab id (null when zero tabs — only the `+` shows). */
  activeTabId: string | null
  /** Click / Enter / Space activates a tab (FR-003). */
  onActivate: (tabId: string) => void
  /** `X` click or Delete/Backspace closes a tab (FR-004/FR-006). */
  onClose: (tabId: string) => void
  /** `+` opens a new tab (FR-005). */
  onNewTab: () => void
  /** Accessible name for the tablist, e.g. "Slack tabs" (design §7). */
  ariaLabel: string
}

/** Move keyboard focus to the tab button at `index` (roving tabindex, design §7). */
function focusTabAt(listEl: HTMLElement | null, index: number): void {
  if (!listEl) {
    return
  }
  const buttons = listEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  const target = buttons[index]
  if (target) {
    target.focus()
  }
}

export function PanelTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onNewTab,
  ariaLabel
}: PanelTabStripProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)

  // design §7: manual-activation roving tablist. Arrow/Home/End move focus only;
  // Enter/Space activate; Delete/Backspace close (adjacent-activation via onClose).
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, tabId: string): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusTabAt(listRef.current, Math.min(index + 1, tabs.length - 1))
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusTabAt(listRef.current, Math.max(index - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        focusTabAt(listRef.current, 0)
        break
      case 'End':
        event.preventDefault()
        focusTabAt(listRef.current, tabs.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onActivate(tabId)
        break
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        onClose(tabId)
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // design §5: strip container — fixed 32px band, popover bg, bottom border.
      className="flex h-8 shrink-0 select-none items-stretch border-b border-border bg-popover"
    >
      {/* design §2.1: the only scrolling region (overflow-x-auto), `+` is outside it. */}
      <div
        ref={listRef}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((t, index) => {
          const isActive = t.id === activeTabId
          const kind = t.kind ?? 'generative'
          const status = t.status ?? 'idle'
          const isTerminal = kind === 'terminal'
          const tooltip =
            status === 'error' && t.errorMessage
              ? `Run failed: ${t.errorMessage}`
              : t.label

          return (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  // design §7: roving tabindex — active is 0, others -1.
                  tabIndex={isActive ? 0 : -1}
                  data-state={isActive ? 'active' : 'inactive'}
                  data-status={status}
                  {...(status === 'in-flight' ? { 'aria-busy': true } : {})}
                  title={tooltip}
                  onClick={() => onActivate(t.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index, t.id)}
                  className={cn(
                    // §5 Tab (base)
                    'group/tab relative flex h-full min-w-0 max-w-[16rem] cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    // §5 Tab inactive
                    'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                    // §5 Tab active (darker, primary top-accent, owns its edges)
                    'data-[state=active]:border-r-transparent data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:before:absolute data-[state=active]:before:inset-x-0 data-[state=active]:before:top-0 data-[state=active]:before:h-0.5 data-[state=active]:before:bg-primary',
                    // §5 Tab error (label tint)
                    'data-[status=error]:text-destructive'
                  )}
                >
                  {/* Leading slot (mutually-exclusive): in-flight spinner | error glyph |
                      terminal glyph. Decorative — the busy/error semantics live on the
                      button (aria-busy / tooltip). design §3.2/§3.3/§3.4. */}
                  {status === 'in-flight' ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  ) : status === 'error' ? (
                    <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : isTerminal ? (
                    <SquareTerminal
                      className="size-3.5 shrink-0 text-muted-foreground group-data-[state=active]/tab:text-foreground"
                      aria-hidden="true"
                    />
                  ) : null}

                  {/* Label — truncates with ellipsis (FR-010); Untitled is italic-muted
                      even when active (FR-009 / design §3.5). */}
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      t.untitled && 'italic text-muted-foreground'
                    )}
                  >
                    {t.label}
                  </span>

                  {/* Close X — nested ghost button; hidden until hover/active/focus
                      (design §4.2). stopPropagation so it doesn't also activate the tab. */}
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${t.label}`}
                    className="opacity-0 transition-opacity group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5"
                  >
                    {/* asChild: render a <span role=button> so we don't nest <button>s
                        (invalid HTML). Keyboard-activatable via onKeyDown. */}
                    <span
                      role="button"
                      tabIndex={isActive ? 0 : -1}
                      aria-label={`Close ${t.label}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(t.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          onClose(t.id)
                        }
                      }}
                    >
                      <X aria-hidden="true" />
                    </span>
                  </Button>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{tooltip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Pinned trailing `+` — never scrolls (design §4.1). Always present, incl. the
          zero-tab state (FR-005/FR-016). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="New tab"
            onClick={onNewTab}
            className="shrink-0 self-center rounded-none border-l border-border"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New tab</TooltipContent>
      </Tooltip>
    </div>
  )
}
