/**
 * UiBridge — local-socket server in the Electron main process (cosmos PoC m2).
 *
 * The spawned MCP entry script (`src/mcp/renderUiServer.ts`) connects here over a
 * Unix domain socket and asks main to render an A2UI surface; main pushes it to
 * the renderer (`ui:render`, FR-004), awaits the user's action (`ui:action`,
 * FR-006), and sends it back so the tool call resolves (FR-007).
 *
 * Main is the single owner of:
 *  - `requestId` minting + correlation (FR-012),
 *  - pending-call state and resolution rules (FR-009, FR-014) via
 *    `PendingCallRegistry`,
 *  - mapping each entry-script `callId` to its renderer-facing `requestId`.
 *
 * A pending call always resolves exactly once: submit, cancel, supersede,
 * renderer reload, or bridge disconnect (FR-009, edge cases) — never hangs.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { bridgeSocketPath, encodeBridgeMessage, type BridgeClientMessage } from '../shared/bridge'
import { DEFAULT_UI_RENDER_TARGET } from '../shared/ipc'
import type {
  A2uiAction,
  A2uiSurfaceUpdate,
  UiDataModelPayload,
  UiRenderPayload,
  UiRenderTarget
} from '../shared/ipc'
import type { AdapterBinding, AdapterDescriptor } from '../shared/adapter'
import { validateAdapterBindings, validateAdapterDescriptor } from '../shared/validate'
import { specHasUnboundDataContainer } from './dataBearingWarning'

/** Logger shape (injectable for clarity / future tests). */
type WarnFn = (message: string, ...args: unknown[]) => void

export interface UiBridgeDeps {
  /** Push a surface to the renderer's Generated-UI panel. FR-004. */
  pushRender: (payload: UiRenderPayload) => void
  /** Project root, used to derive the socket path. */
  projectDir: string
  /**
   * refreshable-custom-generative-ui-v1 (FR-001/FR-006): make an agent-composed surface
   * REFRESHABLE IN PLACE. Given a validated, secret-free descriptor, the frame's agent spec,
   * and the render target, register the descriptor with the AdapterDispatcher and return the
   * spec main should PUSH:
   *   - usable agent spec (non-empty `surfaceId` + a `components` array) → register the
   *     descriptor under the AGENT's OWN `spec.surfaceId` (bind options from `dataSource`),
   *     kick the first refresh, and return the AGENT's spec AS-IS (custom layout refreshes in
   *     place via `updateDataModel`).
   *   - descriptor present but the spec is NOT usable → FALLBACK to the generic `{path}`-bound
   *     SHELL: register the shell's surfaceId, kick the first refresh, return the shell spec.
   *   - descriptor names no registerable source → return the agent's `spec` unchanged
   *     (renders un-refreshably).
   * The boolean `registered` lets `onMessage` know whether to forward the descriptor to the
   * renderer (so the panel refresh control enables for this tab). Injected so `UiBridge` stays
   * dispatcher-agnostic. Optional — absent when no dispatcher is wired (the descriptor path is
   * then skipped). NO token crosses: the descriptor is non-secret by contract; the token is
   * attached only in main at refresh.
   */
  registerAgentSurface?: (
    descriptor: AdapterDescriptor,
    agentSpec: A2uiSurfaceUpdate,
    target: UiRenderTarget
  ) => { spec: A2uiSurfaceUpdate; registered: boolean }
  /**
   * refreshable-custom-generative-ui (multi-region): the PARTITIONED counterpart to
   * {@link registerAgentSurface}. Given the agent's per-container {@link AdapterBinding}s
   * (already validated + secret-screened by UiBridge), the agent spec, and the target, REBIND
   * each named container's literal data prop to a region-scoped `{path}` binding, register each
   * region with the dispatcher under its OWN descriptor + cursor, kick each region's first
   * refresh, and return the rewritten spec + the literal SEED data model (each region's composed
   * rows, so the surface paints instantly before the first refresh). Returns `null` when no
   * binding is usable (caller falls back to the single-region `descriptor`/literal path).
   * Injected so UiBridge stays dispatcher-agnostic. NO token crosses — descriptors are
   * non-secret; the token is attached only in main at refresh.
   */
  registerAgentSurfaceBindings?: (
    bindings: AdapterBinding[],
    agentSpec: A2uiSurfaceUpdate,
    target: UiRenderTarget
  ) => { spec: A2uiSurfaceUpdate; dataModel: UiDataModelPayload[] } | null
  /** Push one `updateDataModel` to the renderer (the rebind SEED). Injected. */
  pushDataModel?: (payload: UiDataModelPayload) => void
  /** Optional warning logger. Defaults to console.warn. */
  warn?: WarnFn
}

/** Internal record linking a renderer requestId to its bridge socket/call. */
interface OutstandingCall {
  requestId: string
  callId: string
  socket: Socket
}

export class UiBridge {
  private server: Server | null = null
  private readonly socketPath: string
  private readonly warn: WarnFn
  private readonly pushRender: (payload: UiRenderPayload) => void
  private readonly registerAgentSurface?: (
    descriptor: AdapterDescriptor,
    agentSpec: A2uiSurfaceUpdate,
    target: UiRenderTarget
  ) => { spec: A2uiSurfaceUpdate; registered: boolean }
  private readonly registerAgentSurfaceBindings?: (
    bindings: AdapterBinding[],
    agentSpec: A2uiSurfaceUpdate,
    target: UiRenderTarget
  ) => { spec: A2uiSurfaceUpdate; dataModel: UiDataModelPayload[] } | null
  private readonly pushDataModel?: (payload: UiDataModelPayload) => void
  /** At most one active surface at a time (FR-014). */
  private active: OutstandingCall | null = null
  private readonly sockets = new Set<Socket>()

  constructor(deps: UiBridgeDeps) {
    this.socketPath = bridgeSocketPath(deps.projectDir)
    this.warn = deps.warn ?? ((m, ...a) => console.warn(m, ...a))
    this.pushRender = deps.pushRender
    this.registerAgentSurface = deps.registerAgentSurface
    this.registerAgentSurfaceBindings = deps.registerAgentSurfaceBindings
    this.pushDataModel = deps.pushDataModel
  }

  /** Start listening for the spawned MCP entry script. Idempotent-ish. */
  start(): void {
    if (this.server) {
      return
    }
    // Clear a stale socket file from a previous crash so bind succeeds.
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // best effort
      }
    }
    const server = createServer((socket) => this.onConnection(socket))
    server.on('error', (err) => this.warn('[ui] bridge server error:', err))
    server.listen(this.socketPath)
    this.server = server
  }

  /** Stop the server and clean up the socket file. No orphaned listeners. */
  stop(): void {
    // Any in-flight surface is resolved cancel so the tool never hangs (FR-009).
    this.cancelActive()
    for (const socket of this.sockets) {
      socket.destroy()
    }
    this.sockets.clear()
    this.server?.close()
    this.server = null
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // best effort
      }
    }
  }

  /**
   * Resolve the active pending call from a validated renderer `ui:action`
   * (FR-006). Returns true if it matched a pending call; an unknown/stale
   * requestId returns false so the caller can warn-and-ignore (FR-012, SC-006).
   */
  resolveAction(requestId: string, action: A2uiAction): boolean {
    if (!this.active || this.active.requestId !== requestId) {
      return false
    }
    this.settle(this.active, action)
    return true
  }

  /**
   * Cancel the active surface (renderer reload / app teardown). Resolves the
   * pending call cancel exactly once (FR-009, edge cases).
   */
  cancelActive(): void {
    if (this.active) {
      this.settle(this.active, { type: 'cancel' })
    }
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding('utf8')
    this.sockets.add(socket)
    let buffer = ''

    socket.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.trim()) {
          this.onMessage(line, socket)
        }
      }
    })

    socket.on('close', () => {
      this.sockets.delete(socket)
      // If the entry script that owns the active call disconnected, resolve it
      // cancel so the (now-gone) tool call is not left dangling (FR-009).
      if (this.active && this.active.socket === socket) {
        this.settle(this.active, { type: 'cancel' })
      }
    })
    socket.on('error', () => {
      // Surfaced via 'close'; nothing extra to do.
    })
  }

  private onMessage(line: string, socket: Socket): void {
    let message: BridgeClientMessage
    try {
      message = JSON.parse(line) as BridgeClientMessage
    } catch {
      this.warn('[ui] ignoring malformed bridge frame')
      return
    }
    if (message.kind !== 'render') {
      this.warn('[ui] ignoring unknown bridge message kind:', message)
      return
    }

    // Supersede any current surface (FR-014): its pending call resolves cancel.
    if (this.active) {
      this.settle(this.active, { type: 'cancel' })
    }

    // FR-012: mint the renderer-facing requestId in main; map it to the
    // entry-script callId so the right tool call resolves.
    const requestId = randomUUID()
    const target = message.target ?? DEFAULT_UI_RENDER_TARGET
    // Capture THIS call into a local and settle through the local, not `this.active`,
    // for the rest of onMessage. The bindings branch below kicks each region's first
    // refresh via the AdapterDispatcher, whose `refresh()` synchronously calls the
    // injected `cancelActive()` (its FR-013 supersede guard) BEFORE its first await —
    // which settles + NULLS `this.active` re-entrantly. Re-reading `this.active` at the
    // display-only settle (below) would then pass `null` to `settle` and null-deref
    // `call.socket`. Settling the captured `call` keeps the late settle bound to the
    // call we actually pushed (and `settle` clears `this.active` only if still current).
    const call: OutstandingCall = { requestId, callId: message.callId, socket }
    this.active = call

    // Make the agent's surface REFRESHABLE IN PLACE. TWO paths, `bindings` taking precedence:
    //
    //  1. MULTI-region (`bindings`, refreshable-custom-generative-ui): the agent named one
    //     secret-free descriptor PER data-bearing container (a kanban's columns, a dashboard's
    //     panels). Validate + secret-screen them against the target, then REBIND each container's
    //     literal data prop to a region-scoped `{path}` binding, register each region with the
    //     dispatcher (its own descriptor + cursor + pagination), kick each region's first refresh,
    //     and SEED the literal rows so the surface paints instantly. The rebound spec + `bindings`
    //     go to the renderer (persisted so a restore re-registers every region).
    //  2. SINGLE-region (`descriptor`, refreshable-custom-generative-ui-v1 FR-001/FR-006/FR-008):
    //     one surface-wide descriptor — register the agent's own surface (or the `{path}`-bound
    //     shell fallback) and forward the descriptor when something registered.
    //
    // Both are validated at THIS main boundary; a cross-target / malformed / unknown-source entry
    // is warned + dropped (the surface still renders, un-refreshable). NO token crosses — the
    // descriptors are non-secret by contract + secret-stripped here; the token is attached only in
    // main at refresh re-execution.
    let spec: A2uiSurfaceUpdate = message.spec
    let descriptor: AdapterDescriptor | undefined
    let bindings: AdapterBinding[] | undefined
    let seed: UiDataModelPayload[] | undefined

    if (message.bindings !== undefined) {
      const validated = validateAdapterBindings(message.bindings, this.warn, target)
      if (validated) {
        const result = this.registerAgentSurfaceBindings?.(validated, message.spec, target)
        if (result) {
          spec = result.spec
          bindings = validated
          seed = result.dataModel
        }
      }
    }

    // Single-region descriptor — only when `bindings` did not already make the surface
    // refreshable (bindings wins per the contract).
    if (bindings === undefined && message.descriptor !== undefined) {
      const validated = validateAdapterDescriptor(message.descriptor, this.warn, target)
      if (validated) {
        const result = this.registerAgentSurface?.(validated, message.spec, target)
        if (result) {
          spec = result.spec
          if (result.registered) {
            descriptor = validated
          }
        }
      }
    }

    // bindings-first-generative-ui-v1 (FR-008/FR-009): a DEV-only warn-and-continue check.
    // When a frame carries NEITHER `bindings` NOR `descriptor` yet its spec paints integration
    // data (a known list rows prop / detail bind prop holding a literal array or a `{path}`),
    // the surface renders but is NOT refreshable — the directive's failure mode. Emit ONE
    // informational warning so it is caught in development. Heuristic + side-effect-free: it
    // errs toward NOT warning (unknown shapes → silent), never throws, never alters the pushed
    // spec/seed, never blocks the render. Runs AFTER the bindings/descriptor branches; both
    // remaining undefined means nothing made the surface refreshable.
    if (bindings === undefined && message.descriptor === undefined) {
      if (specHasUnboundDataContainer(message.spec)) {
        this.warn(
          '[ui] data-bearing surface composed with no binding — it will not be refreshable; declare a binding per data container'
        )
      }
    }

    // Jira generative-UI v2 (D1): carry the frame's render target into the pushed
    // payload so the owning panel filters `ui:render` by `target`. A render_ui frame
    // omits it ⇒ default 'generated-ui' (backward-compatible). Forward the secret-free
    // descriptor/bindings (when refreshable) so the renderer persists the refetch intent +
    // the panel refresh control enables for this tab.
    this.pushRender({
      requestId,
      spec,
      target,
      ...(descriptor ? { descriptor } : {}),
      ...(bindings ? { bindings } : {})
    })

    // Push the rebind SEED AFTER the render so the surface exists when the data-model arrives
    // (each region's composed rows paint instantly; the kicked first refresh repaints live).
    if (seed) {
      for (const payload of seed) {
        this.pushDataModel?.(payload)
      }
    }

    // Every non-`'generated-ui'` target is DISPLAY-ONLY from the composing run's
    // perspective (Slack + Confluence generative-UI v1, FR-014; generalizes the original
    // jira-only branch): the surface emits no action this render call awaits — a `jira.*`
    // action is dispatched DETERMINISTICALLY by main (JiraActionDispatcher), and `'slack'`/
    // `'confluence'` surfaces are read-only with no controls at all. So settle it
    // immediately (the FR-016 cancel pattern) — otherwise the one-shot headless run blocks
    // forever on `await bridge.render()`, never emits `completed`, and the panel spinner
    // never stops. The surface stays rendered (driven by `pushRender` above); any later
    // jira action re-pushes a fresh surface via the dispatcher, independent of this call.
    // Only `'generated-ui'` keeps blocking, awaiting the user's action on its control.
    // Settle the CAPTURED `call` (not `this.active`, which a re-entrant refresh-kick
    // cancelActive may already have nulled — see the capture comment above).
    if (target !== 'generated-ui') {
      this.settle(call, { type: 'cancel' })
    }
  }

  /** Resolve a call exactly once: clear it, then notify the entry script. */
  private settle(call: OutstandingCall | null, action: A2uiAction): void {
    // Defensive: a re-entrant cancel can settle + null the active call before a late
    // caller reaches here. The ordering fix in onMessage already settles a captured
    // local (never `this.active`), so this guard is belt-and-suspenders — a null call
    // is a no-op rather than a crash.
    if (!call) {
      return
    }
    if (this.active === call) {
      this.active = null
    }
    if (!call.socket.destroyed) {
      call.socket.write(
        encodeBridgeMessage({ kind: 'result', callId: call.callId, action })
      )
    }
  }
}
