/**
 * catalogShared/controls — the SHARED generative-adapter catalog controls + binding
 * helpers, the SINGLE source both the Jira and Slack (and later Confluence) custom A2UI
 * catalogs import (slack-generative-adapter-v1, design §6.1).
 *
 * These were originally built inside `jiraCatalog/components.tsx` (jira-generative-adapter-v1);
 * they are EXTRACTED here UNCHANGED (byte-for-byte visuals/tokens/ARIA) so every panel that
 * rides the shared adapter reuses ONE definition of each control — no copy-paste drift, one
 * design (the spec/plan require Slack reuse the shared infra verbatim). Jira's catalog
 * re-exports them from here; Slack's catalog imports them directly.
 *
 * jira-generative-adapter-v1 (FR-015/FR-016): thin shells over existing shadcn
 * primitives that read bound `loading`/`hasMore`/`hasPrev` flags and emit a reserved
 * `adapter.*` action carrying `{ surfaceId }` context. (Manual refresh is no longer an
 * in-surface control — it moved to the panel chrome, panel-refresh-v1 FR-006 — so this
 * module exports only `LoadMoreButton` + `PaginationBar`.) Main intercepts the action at the
 * `ui:action` boundary and dispatches it via the AdapterDispatcher (never the agent). The
 * `surfaceId` rides in the action context so main knows which registered surface to
 * re-execute (FR-010). `PaginationBar` (page-replace) stays available for panels that need
 * it; Slack does NOT register it (append-only — FR-011).
 */

import { useDataBinding, useDispatchAction } from '@a2ui-sdk/react/0.9'
import type { DynamicValue } from '@a2ui-sdk/types/0.9'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdapterAction } from '../../../shared/types/adapter'

/**
 * A `{path}` binding source — what a bound prop carries instead of a literal value
 * (the SDK spreads node props verbatim; `useDataBinding` resolves either a `{path}`
 * binding OR a passthrough literal, so a static-prop builder still works).
 */
export type Bind = { path: string }
/** A prop that may be a literal OR a `{path}` binding. */
export type Bound<T> = T | Bind

/**
 * Resolve a {@link Bound} prop (literal OR `{path}` binding) from the data model via
 * the SDK's `useDataBinding`. The SDK's `DynamicValue` source type models only
 * primitives + `{path}` + FunctionCall, but its impl passes ANY non-binding literal
 * through verbatim — so a bound object/array prop resolves correctly. The cast narrows
 * to the under-modeled source type; behavior is unchanged (the literal is returned
 * as-is when not a `{path}`).
 */
export function useBound<T>(
  surfaceId: string,
  source: Bound<T> | undefined,
  fallback: T | undefined
): T | undefined {
  return useDataBinding<T | undefined>(surfaceId, source as DynamicValue | undefined, fallback)
}

/** Props the SDK injects into every catalog component. */
interface SdkProps {
  surfaceId: string
  componentId: string
}

export interface LoadMoreButtonNode extends SdkProps {
  /** Bound busy flag (FR-018) → spinner + disabled. */
  loading?: Bound<boolean>
  /** Bound "next page exists" flag (FR-017) → render/omit. */
  hasMore?: Bound<boolean>
  /**
   * The owning container's region key (multi-region partitioned surface). Threaded into
   * the emitted `adapter.loadMore` so main reloads ONLY this region's fetcher. Absent on a
   * single-region surface → the action proceeds surface-wide (back-compat).
   */
  region?: string
}

export function LoadMoreButton({
  surfaceId,
  componentId,
  loading,
  hasMore,
  region
}: LoadMoreButtonNode): React.JSX.Element | null {
  const dispatch = useDispatchAction()
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const canLoadMore = useDataBinding<boolean>(surfaceId, hasMore, false)
  // §5.1: exhausted (hasMore=false) → render nothing (the end is implicit).
  if (!canLoadMore) {
    return null
  }
  const loadMore = (): void => {
    if (isLoading) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: AdapterAction.LoadMore,
      context: { surfaceId, ...(region ? { region } : {}) }
    })
  }
  return (
    <div className="flex justify-center pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isLoading}
        aria-busy={isLoading}
        onClick={loadMore}
      >
        {isLoading ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Loading…
          </>
        ) : (
          'Load more'
        )}
      </Button>
    </div>
  )
}

export interface PaginationBarNode extends SdkProps {
  /** Bound busy flag (FR-018) → both controls disabled + active spinner. */
  loading?: Bound<boolean>
  /** Bound "next page exists" flag (FR-017) → Next disabled. */
  hasMore?: Bound<boolean>
  /** Bound "previous page exists" flag (FR-017) → Prev disabled. */
  hasPrev?: Bound<boolean>
  /** Optional bound page indicator text (design §5.2); falls back to a dot. */
  pageLabel?: Bound<string>
  /**
   * The owning container's region key (multi-region partitioned surface). Threaded into
   * the emitted `adapter.page` so main pages ONLY this region's fetcher. Absent on a
   * single-region surface → the action proceeds surface-wide (back-compat).
   */
  region?: string
}

export function PaginationBar({
  surfaceId,
  componentId,
  loading,
  hasMore,
  hasPrev,
  pageLabel,
  region
}: PaginationBarNode): React.JSX.Element {
  const dispatch = useDispatchAction()
  const isLoading = useDataBinding<boolean>(surfaceId, loading, false)
  const canNext = useDataBinding<boolean>(surfaceId, hasMore, false)
  const canPrev = useDataBinding<boolean>(surfaceId, hasPrev, false)
  const label = useDataBinding<string | undefined>(surfaceId, pageLabel, undefined)
  const go = (direction: 'next' | 'prev'): void => {
    if (isLoading) {
      return
    }
    dispatch(surfaceId, componentId, {
      name: AdapterAction.Page,
      context: { surfaceId, direction, ...(region ? { region } : {}) }
    })
  }
  return (
    <div className="flex items-center justify-between pt-1" aria-busy={isLoading}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isLoading || !canPrev}
        aria-label="Previous page"
        onClick={() => go('prev')}
      >
        <ChevronLeft className="size-4" />
        Prev
      </Button>
      <span className="text-xs text-muted-foreground">{label ?? '·'}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isLoading || !canNext}
        aria-label="Next page"
        onClick={() => go('next')}
      >
        Next
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
