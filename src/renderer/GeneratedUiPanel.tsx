/**
 * GeneratedUiPanel — cosmos PoC milestone 2.
 *
 * Renders A2UI surfaces pushed by the render_ui MCP tool and returns the user's
 * interaction so Claude can continue reasoning.
 *
 * Spec trace:
 *   FR-005 render the pushed A2UI spec via the A2UI React SDK
 *   FR-006 capture the user's action (+values) and send it back over IPC
 *   FR-009 a dismiss/cancel affordance resolves the call explicitly
 *   FR-012 echo the surface's requestId so the right pending call resolves
 *   FR-014 single active surface; a new render replaces the current one
 *   SC-005 a malformed/failed render shows a safe fallback, no crash
 *   SC-007 lives beside the Terminal Panel; the TUI stream is untouched
 */

import { useEffect, useRef, useState } from 'react'
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIMessageHandler,
  type A2UIAction,
  type A2UIMessage
} from '@a2ui-sdk/react/0.8'
import type { UiRenderPayload } from '../shared/ipc'
import './GeneratedUiPanel.css'

/** The currently-displayed surface, or null when the panel is idle. */
interface ActiveSurface {
  requestId: string
  /** Set when the surface could not be rendered, for a safe fallback (SC-005). */
  error?: string
}

/**
 * Inner bridge component (must live inside A2UIProvider to use the message-handler
 * hook). Subscribes to `ui:render`, feeds surfaces to the SDK, and maps SDK
 * actions back to the cosmos `ui:action` contract.
 */
function SurfaceBridge({
  active,
  setActive
}: {
  active: ActiveSurface | null
  setActive: (s: ActiveSurface | null) => void
}): React.JSX.Element {
  const { processMessage, clear } = useA2UIMessageHandler()
  // The active requestId, read by the action handler without re-subscribing.
  const requestIdRef = useRef<string | null>(null)
  requestIdRef.current = active?.requestId ?? null

  useEffect(() => {
    // FR-004/FR-005: render each pushed surface. FR-014: a new surface replaces
    // the current one (clear, then process the new surfaceUpdate).
    const off = window.cosmos.ui.onRender((payload: UiRenderPayload) => {
      try {
        clear()
        const surfaceId = payload.spec.surfaceId
        // The SDK needs a beginRendering before the surfaceUpdate to initialize
        // the surface; the render_ui arg is just the surfaceUpdate, so synthesize
        // beginRendering from it (plan Resolved Q2).
        const begin: A2UIMessage = {
          beginRendering: { surfaceId, root: payload.spec.components[0]?.id ?? surfaceId }
        }
        const update: A2UIMessage = { surfaceUpdate: payload.spec }
        processMessage(begin)
        processMessage(update)
        setActive({ requestId: payload.requestId })
      } catch (err) {
        // SC-005: a bad spec must degrade gracefully, never crash the panel.
        setActive({
          requestId: payload.requestId,
          error: err instanceof Error ? err.message : 'failed to render surface'
        })
      }
    })
    return off
  }, [processMessage, clear, setActive])

  // FR-006: map an SDK action to the cosmos ui:action `submit` contract.
  const handleAction = (action: A2UIAction): void => {
    const requestId = requestIdRef.current
    if (!requestId) {
      return
    }
    window.cosmos.ui.sendAction({
      requestId,
      action: {
        type: 'submit',
        // SDK action name identifies which control fired; context carries values.
        actionId: action.name,
        values: action.context
      }
    })
    setActive(null)
    clear()
  }

  return <A2UIRenderer onAction={handleAction} />
}

/**
 * Mountable panel. Owns the active-surface state and the cancel affordance so the
 * cancel path (FR-009) is cosmos chrome, independent of any SDK event.
 */
export function GeneratedUiPanel(): React.JSX.Element {
  const [active, setActive] = useState<ActiveSurface | null>(null)

  const handleCancel = (): void => {
    if (!active) {
      return
    }
    // FR-009: explicit cancel — resolve the call as cancelled, never empty/hang.
    window.cosmos.ui.sendAction({
      requestId: active.requestId,
      action: { type: 'cancel' }
    })
    setActive(null)
  }

  return (
    <section className="ui-panel" aria-label="Generated UI">
      <div className="ui-panel__header">
        <span className="ui-panel__title">Generated UI</span>
        {active && (
          <button
            type="button"
            className="ui-panel__dismiss"
            onClick={handleCancel}
            title="Dismiss this surface"
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="ui-panel__body">
        {!active && (
          <p className="ui-panel__empty">Claude has not rendered any UI yet.</p>
        )}
        {active?.error && (
          <p className="ui-panel__error" role="alert">
            Could not render this surface: {active.error}
          </p>
        )}
        {/* The provider/renderer stay mounted so surfaces render in place. */}
        <A2UIProvider>
          <SurfaceBridge active={active} setActive={setActive} />
        </A2UIProvider>
      </div>
    </section>
  )
}
