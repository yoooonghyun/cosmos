/**
 * ConfluenceBridge — local-socket server in the Electron main process (Atlassian
 * v1). A fully separate sibling to {@link JiraBridge} (independent socket +
 * pending-call state — FR-A13): the spawned Confluence MCP entry script
 * (`src/mcp/confluenceMcpServer.ts`) connects here and asks main to run a read
 * operation; main forwards to {@link ConfluenceManager} and writes the typed
 * `ConfluenceResult` back so the tool call resolves (FR-X01, FR-X05).
 *
 * Each frame is validated at the boundary (FR-X04): a malformed/unknown frame is
 * warned and ignored. Results never include the token (FR-X02, SC-009). Two reads
 * plus the single page-create write (`createPage`).
 */

import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { encodeBridgeMessage } from '../shared/bridge'
import { ConfluenceOp, type ConfluenceResult } from '../shared/confluence'
import {
  validateConfluenceBridgeCall,
  validateConfluenceCreate,
  validateConfluenceGetPage,
  validateConfluenceSearch
} from '../shared/validate'

type WarnFn = (message: string, ...args: unknown[]) => void

/** The subset of ConfluenceManager the bridge invokes (two reads + the page-create write). */
export interface ConfluenceBridgeManager {
  searchContent(params: { query: string; cursor?: string }): Promise<ConfluenceResult<unknown>>
  getPage(params: { pageId: string }): Promise<ConfluenceResult<unknown>>
  createPage(params: {
    spaceKey: string
    title: string
    body: string
    parentId?: string
  }): Promise<ConfluenceResult<unknown>>
}

export interface ConfluenceBridgeDeps {
  /** Absolute socket path (independent sibling socket). */
  socketPath: string
  /** The single Confluence manager all reads route through (FR-A13). */
  manager: ConfluenceBridgeManager
  warn?: WarnFn
}

export class ConfluenceBridge {
  private server: Server | null = null
  private readonly socketPath: string
  private readonly manager: ConfluenceBridgeManager
  private readonly warn: WarnFn
  private readonly sockets = new Set<Socket>()

  constructor(deps: ConfluenceBridgeDeps) {
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
    server.on('error', (err) => this.warn('[confluence] bridge server error:', err))
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

  private async onMessage(line: string, socket: Socket): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.warn('[confluence] ignoring malformed bridge frame')
      return
    }
    const call = validateConfluenceBridgeCall(parsed, this.warn)
    if (!call) {
      return // invalid/unknown -> warned + ignored (FR-X04)
    }
    const result = await this.handleCall(call.op, call.params)
    if (!socket.destroyed) {
      socket.write(encodeBridgeMessage({ kind: 'confluence_result', callId: call.callId, result }))
    }
  }

  /**
   * Validate the op's params and forward to the manager (FR-X04). An invalid params
   * object returns a structured error result rather than crashing.
   */
  async handleCall(op: string, params: Record<string, unknown>): Promise<ConfluenceResult<unknown>> {
    const invalidParams: ConfluenceResult<unknown> = {
      ok: false,
      kind: 'network',
      message: 'Invalid Confluence tool parameters.'
    }
    switch (op) {
      case ConfluenceOp.SearchContent: {
        const p = validateConfluenceSearch(params, this.warn)
        return p ? this.manager.searchContent(p) : invalidParams
      }
      case ConfluenceOp.GetPage: {
        const p = validateConfluenceGetPage(params, this.warn)
        return p ? this.manager.getPage(p) : invalidParams
      }
      case ConfluenceOp.CreatePage: {
        const p = validateConfluenceCreate(params, this.warn)
        return p ? this.manager.createPage(p) : invalidParams
      }
      default:
        return invalidParams
    }
  }
}
