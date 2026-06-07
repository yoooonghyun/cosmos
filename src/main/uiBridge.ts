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
import type { A2uiAction, UiRenderPayload } from '../shared/ipc'

/** Logger shape (injectable for clarity / future tests). */
type WarnFn = (message: string, ...args: unknown[]) => void

export interface UiBridgeDeps {
  /** Push a surface to the renderer's Generated-UI panel. FR-004. */
  pushRender: (payload: UiRenderPayload) => void
  /** Project root, used to derive the socket path. */
  projectDir: string
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
  /** At most one active surface at a time (FR-014). */
  private active: OutstandingCall | null = null
  private readonly sockets = new Set<Socket>()

  constructor(deps: UiBridgeDeps) {
    this.socketPath = bridgeSocketPath(deps.projectDir)
    this.warn = deps.warn ?? ((m, ...a) => console.warn(m, ...a))
    this.pushRender = deps.pushRender
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
    this.active = { requestId, callId: message.callId, socket }
    console.log('[ui] render received target=', target, 'surfaceId=', message.spec?.surfaceId, 'components=', Array.isArray(message.spec?.components) ? message.spec.components.map((c) => c.component).join(',') : 'n/a')
    // Jira generative-UI v2 (D1): carry the frame's render target into the pushed
    // payload so the owning panel filters `ui:render` by `target`. A render_ui frame
    // omits it ⇒ default 'generated-ui' (backward-compatible).
    this.pushRender({ requestId, spec: message.spec, target })

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
    if (target !== 'generated-ui') {
      this.settle(this.active, { type: 'cancel' })
    }
  }

  /** Resolve a call exactly once: clear it, then notify the entry script. */
  private settle(call: OutstandingCall, action: A2uiAction): void {
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
