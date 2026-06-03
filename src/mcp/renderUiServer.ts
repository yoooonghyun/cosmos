/**
 * render_ui MCP entry script (cosmos PoC milestone 2).
 *
 * `.mcp.json` registers this as a stdio MCP server; the `claude` CLI spawns it as
 * a subprocess and speaks JSON-RPC over its stdin/stdout (FR-002). It exposes one
 * tool, `render_ui(spec)`, whose argument is an A2UI `surfaceUpdate` (FR-001).
 *
 * It is a thin relay (plan Resolved Q1): on each call it validates the spec
 * (FR-003), forwards it to the running Electron main process over a local Unix
 * domain socket (`src/main/uiBridge.ts`), awaits the user's resolved action, and
 * returns that action as the tool result (FR-007). Main owns the renderer IPC,
 * `requestId` minting, and pending-call state.
 *
 * This script runs OUTSIDE Electron (plain Node), so it imports only Node
 * built-ins, the MCP SDK, zod, and the pure shared bridge/validate modules.
 */

import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  bridgeSocketPath,
  encodeBridgeMessage,
  type BridgeRenderRequest,
  type BridgeServerMessage
} from '../shared/bridge'
import { validateSurfaceUpdate } from '../shared/validate'
import type { A2uiAction } from '../shared/ipc'

/** Where the bridge socket lives. Claude Code sets CLAUDE_PROJECT_DIR. */
function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * A connection to the Electron main bridge. Frames are newline-delimited JSON.
 * Tracks awaiting tool calls by `callId` and resolves them when main responds.
 */
class BridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (action: A2uiAction) => void>()

  constructor(private readonly socketPath: string) {}

  /** Connect (or reconnect) to main; rejects if the app is not running. */
  private ensureConnected(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket)
    }
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath)
      socket.setEncoding('utf8')
      socket.once('connect', () => {
        this.socket = socket
        resolve(socket)
      })
      socket.once('error', (err) => {
        this.socket = null
        reject(err)
      })
      socket.on('data', (chunk: string) => this.onData(chunk))
      // If the bridge drops while a call is pending, resolve waiters as cancel so
      // the tool never hangs (FR-009, disconnect edge case).
      socket.on('close', () => {
        this.socket = null
        this.failAllPending()
      })
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) {
        continue
      }
      let message: BridgeServerMessage
      try {
        message = JSON.parse(line) as BridgeServerMessage
      } catch {
        continue // ignore malformed frame; never crash the relay
      }
      if (message.kind === 'result') {
        const waiter = this.waiters.get(message.callId)
        if (waiter) {
          this.waiters.delete(message.callId)
          waiter(message.action)
        }
      }
    }
  }

  private failAllPending(): void {
    for (const [callId, waiter] of this.waiters) {
      this.waiters.delete(callId)
      waiter({ type: 'cancel' })
    }
  }

  /**
   * Render `spec` in the app and await the user's resolved action. Resolves
   * `cancel` if the bridge cannot be reached (FR-009) rather than hanging.
   */
  async render(spec: BridgeRenderRequest['spec']): Promise<A2uiAction> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { type: 'cancel' }
    }
    const callId = randomUUID()
    const request: BridgeRenderRequest = { kind: 'render', callId, spec }
    return new Promise<A2uiAction>((resolve) => {
      this.waiters.set(callId, resolve)
      socket.write(encodeBridgeMessage(request), (err) => {
        if (err) {
          this.waiters.delete(callId)
          resolve({ type: 'cancel' })
        }
      })
    })
  }
}

/** Human-readable summary of the resolved action for the text tool result. */
function describeAction(action: A2uiAction): string {
  if (action.type === 'cancel') {
    return 'The user dismissed the UI without acting (cancelled).'
  }
  const id = action.actionId ? ` "${action.actionId}"` : ''
  const values = action.values ? ` with values ${JSON.stringify(action.values)}` : ''
  return `The user activated control${id}${values}.`
}

async function main(): Promise<void> {
  const bridge = new BridgeClient(bridgeSocketPath(projectDir()))
  const server = new McpServer({ name: 'cosmos-render-ui', version: '0.1.0' })

  server.registerTool(
    'render_ui',
    {
      title: 'Render UI',
      description:
        'Render a rich, interactive A2UI surface in the cosmos Generated-UI panel ' +
        'and return the user\'s interaction. The argument is an A2UI surfaceUpdate ' +
        '(a surfaceId plus a list of components). Resolves with the user action, or ' +
        'an explicit cancellation if the user dismisses the surface.',
      inputSchema: {
        // FR-001: single argument, an A2UI surfaceUpdate. Structurally validated
        // here at the boundary by validateSurfaceUpdate (FR-003); zod keeps the
        // tool schema permissive about component internals (the SDK owns those).
        spec: z
          .object({
            surfaceId: z.string(),
            components: z.array(z.unknown())
          })
          .passthrough()
      }
    },
    async ({ spec }) => {
      // FR-003: reject a malformed surfaceUpdate with an error tool result; the
      // app is never asked to render it, so it cannot crash.
      const valid = validateSurfaceUpdate(spec)
      if (!valid) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'render_ui error: the provided spec is not a valid A2UI surfaceUpdate (needs a non-empty "surfaceId" and a "components" array).'
            }
          ]
        }
      }

      // FR-004/FR-007: push to the renderer via main and await the user's action.
      const action = await bridge.render(valid)
      return {
        content: [{ type: 'text' as const, text: describeAction(action) }],
        // Structured result so Claude can branch on the interaction precisely.
        structuredContent: { action }
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  // Never write diagnostics to stdout: that channel is the JSON-RPC transport.
  console.error('[cosmos-render-ui] fatal:', err)
  process.exit(1)
})
