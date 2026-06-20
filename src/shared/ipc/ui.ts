/**
 * render_ui MCP server & Generated-UI panel (Milestone 2) IPC contract —
 * `ui:*` channels + A2UI payloads. Spec: .sdd/specs/render-ui-v1.md. Re-exported
 * (unchanged) through the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

import type { UpdateComponentsPayload, UpdateDataModelPayload } from '@a2ui-sdk/types/0.9'
import type { AdapterBinding, AdapterDescriptor } from '../adapter'
import type { UiRenderTarget } from './common'

/**
 * UI channel name constants for the A2UI Generated-UI panel. FR-008: a single
 * shared interaction contract, consumed by both the MCP bridge and the renderer.
 */
export const UiChannel = {
  /** M->R: push an A2UI surface to render in the panel. FR-004. */
  Render: 'ui:render',
  /** R->M: return the user's interaction (action or cancel) for a surface. FR-006. */
  Action: 'ui:action',
  /**
   * M->R: push a DATA-MODEL update (not a full surface) to a bound surface
   * (jira-generative-adapter-v1, FR-009/FR-010). The AdapterDispatcher emits this on
   * a refresh trigger or a reserved `adapter.*` pagination action; the renderer
   * applies it to the surface named by `surfaceId`. Shared by all four generative
   * panels (panel-agnostic). NO secret (FR-021).
   */
  DataModel: 'ui:dataModel'
} as const

export type UiChannelName = (typeof UiChannel)[keyof typeof UiChannel]

/**
 * The A2UI surface payload that `render_ui(spec)` receives and the panel renders
 * (FR-001, FR-005). Typed alias over the installed SDK's 0.9
 * `UpdateComponentsPayload` (`@a2ui-sdk/types/0.9`) — `{ surfaceId, components }`
 * — so cosmos and the SDK never disagree on the surface shape. The panel
 * synthesizes the 0.9 `createSurface` envelope around it at render time.
 */
export type A2uiSurfaceUpdate = UpdateComponentsPayload

/**
 * M->R. A data-model update for a bound surface (jira-generative-adapter-v1,
 * FR-009/FR-010). Typed alias over the SDK's 0.9 `UpdateDataModelPayload`
 * (`{ surfaceId, path?, value? }`) so cosmos and the SDK never disagree on the
 * shape. The AdapterDispatcher pushes one (or a batch) on refresh/pagination:
 *
 *  - `surfaceId` — which bound surface to apply to (the dispatcher KEYS pushes by it,
 *    FR-010). Validated non-empty at the main boundary (FR-022).
 *  - `path` — RFC 6901 JSON Pointer; defaults to `/` (root). The dispatcher writes
 *    the FULL accumulated list at the bound list path for append (NEVER the `-`
 *    append token, FR-015) and the flags (`/loading`, `/hasMore`, …) at their keys.
 *  - `value` — the new value at `path`; omitted means "remove" (SDK semantics).
 *
 * Carries ONLY non-secret data (FR-021). Validated by `validateUiDataModel`; a
 * malformed payload is warned + ignored at the boundary and safely ignored at the
 * renderer — never a crash (FR-022/FR-023).
 */
export type UiDataModelPayload = UpdateDataModelPayload

/**
 * M->R. Push a surface to the Generated-UI panel. FR-004, FR-012.
 *
 * `requestId` is minted by the main-process bridge per `render_ui` call so the
 * returned action resolves the correct pending call.
 */
export interface UiRenderPayload {
  /** Per-call correlation id minted in main. FR-012. */
  requestId: string
  /** The A2UI surfaceUpdate spec to render. FR-001, FR-005. */
  spec: A2uiSurfaceUpdate
  /**
   * Which panel should render this surface (Jira generative-UI v2, D1 / v2
   * FR-004, FR-012). Each panel filters incoming `ui:render` by this field. Always
   * present on a pushed payload — main defaults it to `'generated-ui'` when the
   * originating render frame omits a target (backward-compatible). NO secret.
   */
  target: UiRenderTarget
  /**
   * The bound surface's INITIAL data-model seed (jira-generative-adapter-v1,
   * FR-001/FR-003). Present only for a bound surface: an ordered list of
   * `{ surfaceId, path?, value? }` pushes the renderer applies right AFTER
   * createSurface/updateComponents so the surface paints its first page of bound data
   * + flags (`/loading=false`, `/hasMore`, …) without a separate round-trip. Absent
   * for a non-bound surface. NO secret (FR-021).
   */
  dataModel?: UiDataModelPayload[]
  /**
   * The bound surface's SECRET-FREE adapter descriptor (jira-generative-adapter-v1,
   * FR-006). Present only for a bound surface; the renderer stores it on the tab so a
   * later refresh/restore can re-execute it, and persists it in the session snapshot
   * beside the spec. Absent for a non-bound surface. Carries no token/secret (FR-007).
   *
   * For a MULTI-region surface this is omitted in favor of {@link bindings}; a
   * single-region surface keeps using `descriptor`.
   */
  descriptor?: AdapterDescriptor
  /**
   * refreshable-custom-generative-ui (multi-region): the per-region
   * {@link AdapterBinding} list main rebound the surface against — one entry per
   * data-bearing container, each with its OWN secret-free descriptor. The renderer stores
   * it on the tab and persists it in the session snapshot beside the spec so a restore
   * re-registers EVERY region. Present only for a multi-region bound surface; a
   * single-region surface uses {@link descriptor} instead. No token/secret (FR-007).
   */
  bindings?: AdapterBinding[]
}

/**
 * The user's interaction with a surface, mapped from the A2UI SDK's
 * `ActionPayload` (renderer) or generated by the panel's own dismiss affordance.
 * FR-006, FR-009.
 *
 *  - `type: 'submit'` — a control fired. `actionId` is the SDK action name (the
 *    control that fired); `values` is the action's resolved context/form data.
 *  - `type: 'cancel'` — the user dismissed/cancelled without acting (FR-009);
 *    `actionId`/`values` are absent.
 */
export interface A2uiAction {
  /** Discriminates a completed action from an explicit cancel. FR-006, FR-009. */
  type: 'submit' | 'cancel'
  /** Which control fired (SDK action `name`). Present for `submit`. FR-006. */
  actionId?: string
  /** Associated values (e.g. form fields / SDK action context). FR-006. */
  values?: Record<string, unknown>
}

/**
 * R->M. Return the user's interaction for a surface. FR-006, FR-012.
 * The `requestId` echoes the one from the matching `UiRenderPayload`.
 */
export interface UiActionPayload {
  /** Correlates to the pushed surface's requestId. FR-012. */
  requestId: string
  /** The user's interaction. FR-006, FR-009. */
  action: A2uiAction
}

/**
 * The UI API surface exposed to the renderer via `contextBridge` as
 * `window.cosmos.ui`, alongside (not merged into) `window.cosmos.pty`. FR-011.
 */
export interface UiApi {
  /**
   * M->R. Subscribe to pushed surfaces. Returns an unsubscribe fn so the panel
   * can detach on unmount (avoids leaks / double-binding on HMR). FR-004.
   */
  onRender(listener: (payload: UiRenderPayload) => void): () => void
  /** R->M. Return the user's interaction for a surface. FR-006, FR-009. */
  sendAction(payload: UiActionPayload): void
  /**
   * M->R. Subscribe to data-model updates for bound surfaces
   * (jira-generative-adapter-v1, FR-009/FR-010). The renderer applies each to the
   * surface named by `surfaceId`. Returns an unsubscribe fn so the panel can detach
   * on unmount (avoids leaks / double-binding on HMR). NOTE: a NEW preload method —
   * a full `npm run dev` restart is required (HMR alone leaves it `not a function`).
   */
  onDataModel(listener: (payload: UiDataModelPayload) => void): () => void
}
