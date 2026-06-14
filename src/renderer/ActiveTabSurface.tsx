/**
 * ActiveTabSurface — renders the ACTIVE generative tab's A2UI surface inside its
 * panel's `<A2UIProvider>` (panel-tabs v1, Track B / Phase 6). Shared by all four
 * generative panels; the only per-panel differences are the catalog (the provider
 * the component is mounted under) and the `catalogId` passed to `createSurface`.
 *
 * It processes the tab's stored `spec` into the SDK on mount / when the surface
 * changes — so switching back to a tab re-renders its surface from stored state
 * (FR-003) without re-running the agent — and maps SDK actions back to the cosmos
 * `ui:action` contract (FR-006). The panel-level subscription (in
 * `useGenerativePanelTabs`) does the originating-tab filing; this component only
 * displays + acts. A render-time throw degrades to the error boundary (SC-005 /
 * FR-028 — per tab body, never white-screening the panel or sibling tabs).
 *
 * `onAction` lets a panel intercept a catalog action that is handled renderer-locally
 * (e.g. Slack's open-channel navigation) instead of being returned to main; returning
 * `true` means "handled, do not forward".
 */

import {
  Component,
  useEffect,
  useRef,
  type ErrorInfo,
  type ReactNode
} from 'react'
import {
  A2UIRenderer,
  useA2UIMessageHandler,
  type A2UIAction,
  type A2UIMessage
} from '@a2ui-sdk/react/0.9'
import type { UiDataModelPayload } from '../shared/ipc'
import { applyDataModel } from './dataModelApply'
import type { TabSurface } from './useGenerativePanelTabs'

class SurfaceErrorBoundary extends Component<
  { children: ReactNode; panelName: string },
  { error: string | null }
> {
  constructor(props: { children: ReactNode; panelName: string }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(err: unknown): { error: string } {
    return { error: err instanceof Error ? err.message : 'failed to render surface' }
  }

  componentDidCatch(err: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.panelName}] surface render crashed:`, err, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive"
          role="alert"
        >
          Could not render this surface: {this.state.error}
        </p>
      )
    }
    return this.props.children
  }
}

export function ActiveTabSurface({
  surface,
  catalogId,
  panelName,
  onAction
}: {
  surface: TabSurface | null
  catalogId: string
  /** Used only for the error-boundary console tag. */
  panelName: string
  /** Optional local-action intercept. Return true to mark handled (not forwarded). */
  onAction?: (action: A2UIAction) => boolean
}): React.JSX.Element {
  const { processMessage, clear } = useA2UIMessageHandler()
  const requestIdRef = useRef<string | null>(null)
  requestIdRef.current = surface?.requestId ?? null
  const submittedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    clear()
    if (!surface || surface.error) {
      return
    }
    try {
      const surfaceId = surface.spec.surfaceId
      const create: A2UIMessage = { createSurface: { surfaceId, catalogId } }
      const update: A2UIMessage = {
        updateComponents: { surfaceId, components: surface.spec.components }
      }
      processMessage(create)
      processMessage(update)
      // jira-generative-adapter-v1 (FR-002/FR-003): seed the bound surface's initial
      // data model right after createSurface/updateComponents so it paints its first
      // page of bound data + flags. A malformed seed entry is skipped (never throws).
      if (Array.isArray(surface.dataModel)) {
        for (const seed of surface.dataModel) {
          applyDataModel(processMessage, surfaceId, seed)
        }
      }
    } catch {
      // SC-005: a bad spec degrades to the error boundary; nothing to render here.
    }
  }, [surface, catalogId, processMessage, clear])

  // jira-generative-adapter-v1 (FR-013): when a BOUND surface is (re)mounted — a tab
  // restore from the session snapshot or a panel re-activation that remounts this body —
  // fire one `adapter.refresh` carrying the surface's secret-free descriptor. Main
  // lazily (re-)registers a surface it never freshly composed (a restored tab) and then
  // re-executes it, producing a fresh `updateDataModel` (no view re-compose, no agent).
  // The descriptor is the persisted refetch intent; a manual RefreshButton later fires
  // the same action WITHOUT a descriptor (the surface is registered by then). Keyed on
  // requestId so it fires once per mounted surface, not on every data-model push.
  useEffect(() => {
    const surfaceId = surface?.spec.surfaceId
    if (!surfaceId || surface?.error || !surface.restored) {
      return
    }
    // multi-region: a partitioned surface re-registers EVERY region via its bindings;
    // a single-region surface re-registers via its descriptor. Exactly one is present.
    const values = surface.bindings
      ? { surfaceId, bindings: surface.bindings }
      : surface.descriptor
        ? { surfaceId, descriptor: surface.descriptor }
        : null
    if (!values) {
      return
    }
    window.cosmos.ui.sendAction({
      requestId: surface.requestId,
      action: { type: 'submit', actionId: 'adapter.refresh', values }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface?.requestId])

  // jira-generative-adapter-v1 (FR-002/FR-010): apply IN-PLACE data-model updates the
  // AdapterDispatcher pushes (refresh / pagination / loading flag) to THIS surface —
  // matched by surfaceId so a push for a sibling tab's surface is ignored. The view is
  // not re-composed; only the data model changes (bound hooks re-render). A malformed
  // payload is safely ignored (FR-023). Resubscribes when the active surface changes.
  useEffect(() => {
    const surfaceId = surface?.spec.surfaceId
    if (!surfaceId || surface?.error) {
      return
    }
    const off = window.cosmos.ui.onDataModel((payload: UiDataModelPayload) => {
      if (!payload || payload.surfaceId !== surfaceId) {
        return
      }
      applyDataModel(processMessage, surfaceId, payload)
    })
    return off
  }, [surface, processMessage])

  const handleAction = (action: A2UIAction): void => {
    // Renderer-local intercept (e.g. Slack open-channel) — never consumes a requestId.
    if (onAction && onAction(action)) {
      return
    }
    const requestId = requestIdRef.current
    if (!requestId) {
      return
    }
    // panel-refresh-v1 (Goal 2 / FR-008): split the one-shot guard. A reserved
    // `adapter.*` action (refresh / load-more / page) and any non-terminal control are
    // REPEATABLE — they re-execute the bound descriptor in main and push fresh
    // `updateDataModel` to THIS surface, so they must NOT be consumed by the one-shot
    // set. Only a TERMINAL `submit` (a control with no reserved actionId — the
    // surface's final answer that resolves the awaiting render call) is one-shot, so a
    // double click can't resolve the same pending call twice. The marker is the
    // `adapter.` namespace; a `jira.*` deterministic write is likewise repeatable.
    const actionId = action.name
    const isRepeatable =
      typeof actionId === 'string' &&
      (actionId.startsWith('adapter.') || actionId.startsWith('jira.'))
    if (!isRepeatable) {
      if (submittedRef.current.has(requestId)) {
        return
      }
      submittedRef.current.add(requestId)
    }
    window.cosmos.ui.sendAction({
      requestId,
      action: { type: 'submit', actionId, values: action.context }
    })
  }

  return (
    <SurfaceErrorBoundary key={surface?.requestId ?? 'idle'} panelName={panelName}>
      <A2UIRenderer onAction={handleAction} />
    </SurfaceErrorBoundary>
  )
}
