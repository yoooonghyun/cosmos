/**
 * PanelRefreshButton — the ONE panel-level refresh control (panel-refresh-v1, Goal 1 /
 * FR-001/FR-003). Mounted in `PanelTabStrip`'s trailing cluster, LEFT of the `+` (design
 * §1), it acts on the ACTIVE tab's surface: a repeatable `adapter.refresh` re-executes the
 * surface's bound descriptor in main, which pushes fresh `updateDataModel` to that surface
 * in place (no view re-compose). It REPLACES the removed in-surface `RefreshButton` (FR-006);
 * `LoadMoreButton`/`PaginationBar` stay in-surface (FR-007).
 *
 * Pure reuse (design §2): one `Button variant="ghost" size="icon-sm"` + lucide
 * `RotateCw`/`Loader2` + `Tooltip` — no new tokens/primitive. All state derives from the
 * active tab via {@link derivePanelRefreshState}; the click is guarded while busy/disabled
 * via {@link shouldDispatchRefresh} (design §3.2/§3.3). The dispatch mirrors
 * ActiveTabSurface's manual refresh: a `submit` of `adapter.refresh` carrying the active
 * `surfaceId` + the secret-free descriptor. NO token crosses (the descriptor is secret-free).
 */

import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  derivePanelRefreshState,
  shouldDispatchRefresh,
  type ActiveTabForRefresh
} from './panelRefreshLogic'

export interface PanelRefreshButtonProps {
  /**
   * The active tab's refresh-relevant slice (its surface + busy flag) — `null` for an empty
   * panel. The control derives enabled/busy/disabled from this via `derivePanelRefreshState`.
   */
  activeTab: ActiveTabForRefresh | null
  /**
   * The active surface's `requestId` — required to dispatch a `ui:action` (it correlates to
   * the surface in main; an `adapter.*` action is repeatable and never resolves the call).
   * Absent ⇒ no refreshable surface, so the control is disabled regardless.
   */
  requestId: string | null
}

/**
 * The shared refresh control. Disabled when the active tab has no registered/bound surface
 * (design §3.3/§3.4); spinning + click-guarded while the tab's run is in flight (§3.2);
 * otherwise an enabled `RotateCw` that fires a repeatable `adapter.refresh` (§3.1).
 */
export function PanelRefreshButton({
  activeTab,
  requestId
}: PanelRefreshButtonProps): React.JSX.Element {
  const state = derivePanelRefreshState(activeTab)
  // No requestId ⇒ cannot dispatch ⇒ treat as disabled (defensive; enabled implies a
  // surface, which implies a requestId in practice).
  const enabled = state.enabled && requestId !== null
  const busy = state.busy

  const onClick = (): void => {
    if (!requestId || !shouldDispatchRefresh(state) || !state.refresh) {
      return // guarded: disabled or busy is a no-op (design §3.2/§3.3)
    }
    window.cosmos.ui.sendAction({
      requestId,
      action: {
        type: 'submit',
        actionId: 'adapter.refresh',
        values: {
          surfaceId: state.refresh.surfaceId,
          ...(state.refresh.descriptor ? { descriptor: state.refresh.descriptor } : {}),
          ...(state.refresh.bindings ? { bindings: state.refresh.bindings } : {})
        }
      }
    })
  }

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh"
      // §3.2: busy stays focusable + aria-busy; the click is guarded, not `disabled`.
      // §3.3: no refreshable surface ⇒ native `disabled` (a11y beyond color).
      disabled={!enabled}
      {...(busy ? { 'aria-busy': true } : {})}
      onClick={onClick}
      // Matches the `+` sibling so the cluster reads as one segmented chrome unit (design §1).
      className={cn(
        'shrink-0 self-center rounded-none border-l border-border',
        busy && 'cursor-default'
      )}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <RotateCw className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </Button>
  )

  // §5: tooltip is suppressed when disabled (no actionable hint on a disabled control).
  if (!enabled) {
    return button
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">Refresh</TooltipContent>
    </Tooltip>
  )
}
