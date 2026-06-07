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
    } catch {
      // SC-005: a bad spec degrades to the error boundary; nothing to render here.
    }
  }, [surface, catalogId, processMessage, clear])

  const handleAction = (action: A2UIAction): void => {
    // Renderer-local intercept (e.g. Slack open-channel) — never consumes a requestId.
    if (onAction && onAction(action)) {
      return
    }
    const requestId = requestIdRef.current
    if (!requestId || submittedRef.current.has(requestId)) {
      return
    }
    submittedRef.current.add(requestId)
    window.cosmos.ui.sendAction({
      requestId,
      action: { type: 'submit', actionId: action.name, values: action.context }
    })
  }

  return (
    <SurfaceErrorBoundary key={surface?.requestId ?? 'idle'} panelName={panelName}>
      <A2UIRenderer onAction={handleAction} />
    </SurfaceErrorBoundary>
  )
}
