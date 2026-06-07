/**
 * SlackBridge — local-socket server in the Electron main process (Slack v1).
 * A sibling to {@link UiBridge}: the spawned Slack MCP entry script
 * (`src/mcp/slackMcpServer.ts`) connects here over a Unix domain socket and asks
 * main to run a read operation; main forwards to {@link SlackManager} and writes
 * the typed `SlackResult` back so the tool call resolves (FR-018, FR-020).
 *
 * Each frame is validated at the boundary (FR-023): a malformed/unknown frame is
 * warned and ignored — never crashes, never mis-resolves another call. A
 * not-connected / reconnect-needed read returns a structured result (never a
 * hang — FR-020). Results never include the token (FR-021, SC-008).
 *
 * Unlike UiBridge there is no renderer round-trip, so the entry script's `callId`
 * is the only correlation id; main answers each call immediately with the result.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { encodeBridgeMessage } from '../shared/bridge'
import { SlackOp, type SlackResult } from '../shared/slack'
import { validateSlackBridgeCall } from '../shared/validate'
import {
  validateSlackGetUser,
  validateSlackHistory,
  validateSlackListChannels,
  validateSlackReplies,
  validateSlackSearch
} from '../shared/validate'

type WarnFn = (message: string, ...args: unknown[]) => void

/** The subset of SlackManager the bridge invokes (read-only — FR-019). */
export interface SlackBridgeManager {
  listChannels(params: { cursor?: string }): Promise<SlackResult<unknown>>
  getHistory(params: { channelId: string; cursor?: string }): Promise<SlackResult<unknown>>
  getReplies(params: {
    channelId: string
    threadTs: string
    cursor?: string
  }): Promise<SlackResult<unknown>>
  search(params: { query: string; cursor?: string }): Promise<SlackResult<unknown>>
  getUser(params: { userId: string }): Promise<SlackResult<unknown>>
}

export interface SlackBridgeDeps {
  /** Absolute socket path (sibling to the render_ui socket). */
  socketPath: string
  /** The single Slack manager all reads route through (FR-008). */
  manager: SlackBridgeManager
  warn?: WarnFn
}

export class SlackBridge {
  private server: Server | null = null
  private readonly socketPath: string
  private readonly manager: SlackBridgeManager
  private readonly warn: WarnFn
  private readonly sockets = new Set<Socket>()

  constructor(deps: SlackBridgeDeps) {
    this.socketPath = deps.socketPath
    this.manager = deps.manager
    this.warn = deps.warn ?? ((m, ...a) => console.warn(m, ...a))
  }

  start(): void {
    if (this.server) {
      return
    }
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // best effort
      }
    }
    const server = createServer((socket) => this.onConnection(socket))
    server.on('error', (err) => this.warn('[slack] bridge server error:', err))
    server.listen(this.socketPath)
    this.server = server
  }

  stop(): void {
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
          void this.onMessage(line, socket)
        }
      }
    })
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => {
      // surfaced via 'close'
    })
  }

  /**
   * Parse + validate one inbound frame, run the op, and reply with the typed
   * result. Exposed for unit tests via {@link handleCall}.
   */
  private async onMessage(line: string, socket: Socket): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.warn('[slack] ignoring malformed bridge frame')
      return
    }
    const call = validateSlackBridgeCall(parsed, this.warn)
    if (!call) {
      return // invalid/unknown -> warned + ignored (FR-023)
    }
    const result = await this.handleCall(call.op, call.params)
    if (!socket.destroyed) {
      socket.write(encodeBridgeMessage({ kind: 'slack_result', callId: call.callId, result }))
    }
  }

  /**
   * Validate the op's params and forward to the manager (FR-023). An invalid
   * params object returns a structured error result rather than crashing. Pure
   * w.r.t. the socket so it is unit-testable.
   */
  async handleCall(op: string, params: Record<string, unknown>): Promise<SlackResult<unknown>> {
    const invalidParams: SlackResult<unknown> = {
      ok: false,
      kind: 'network',
      message: 'Invalid Slack tool parameters.'
    }
    switch (op) {
      case SlackOp.ListChannels: {
        const p = validateSlackListChannels(params, this.warn)
        return p ? this.manager.listChannels(p) : invalidParams
      }
      case SlackOp.GetHistory: {
        const p = validateSlackHistory(params, this.warn)
        return p ? this.manager.getHistory(p) : invalidParams
      }
      case SlackOp.GetReplies: {
        const p = validateSlackReplies(params, this.warn)
        return p ? this.manager.getReplies(p) : invalidParams
      }
      case SlackOp.Search: {
        const p = validateSlackSearch(params, this.warn)
        return p ? this.manager.search(p) : invalidParams
      }
      case SlackOp.GetUser: {
        const p = validateSlackGetUser(params, this.warn)
        return p ? this.manager.getUser(p) : invalidParams
      }
      default:
        return invalidParams
    }
  }
}
