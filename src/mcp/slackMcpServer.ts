/**
 * Slack MCP entry script (Slack integration v1). A sibling to renderUiServer.ts.
 *
 * The main-managed `--mcp-config` registers this as a stdio MCP server; the
 * `claude` CLI spawns it and speaks JSON-RPC over stdin/stdout (FR-018). It
 * exposes the FIVE read-only Slack tools (FR-017, FR-019). Each tool is a thin
 * relay: it forwards an `op` + `params` to the running Electron main process over
 * the Slack Unix-domain socket (`src/main/slackBridge.ts`), awaits the typed
 * `SlackResult`, and returns it as the tool result (FR-020). Main owns the single
 * Slack connection + token; the token NEVER reaches this process (FR-021, SC-008).
 *
 * Runs OUTSIDE Electron (plain Node): imports only Node built-ins, the MCP SDK,
 * zod, and the pure shared bridge/slack modules.
 */

import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  encodeBridgeMessage,
  slackBridgeSocketPath,
  type SlackBridgeCallRequest,
  type SlackBridgeServerMessage
} from '../shared/bridge'
import { SlackOp, SlackTool, type SlackOpName, type SlackResult } from '../shared/slack'

function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

function resolveSocketPath(): string {
  return process.env['COSMOS_SLACK_BRIDGE_SOCKET'] || slackBridgeSocketPath(projectDir())
}

/** A connection to the main Slack bridge. NDJSON frames; resolves by `callId`. */
class SlackBridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (result: SlackResult<unknown>) => void>()

  constructor(private readonly socketPath: string) {}

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
      let message: SlackBridgeServerMessage
      try {
        message = JSON.parse(line) as SlackBridgeServerMessage
      } catch {
        continue
      }
      if (message.kind === 'slack_result') {
        const waiter = this.waiters.get(message.callId)
        if (waiter) {
          this.waiters.delete(message.callId)
          waiter(message.result)
        }
      }
    }
  }

  private failAllPending(): void {
    for (const [callId, waiter] of this.waiters) {
      this.waiters.delete(callId)
      // FR-020: never hang — if the app is gone, return a structured result.
      waiter({
        ok: false,
        kind: 'not_connected',
        message: 'cosmos is not running. Connect Slack in cosmos first.'
      })
    }
  }

  /** Run one read op; resolves the typed result (or not_connected if unreachable). */
  async call(op: SlackOpName, params: Record<string, unknown>): Promise<SlackResult<unknown>> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return {
        ok: false,
        kind: 'not_connected',
        message: 'Connect Slack in cosmos first.'
      }
    }
    const callId = randomUUID()
    const request: SlackBridgeCallRequest = { kind: 'slack_call', callId, op, params }
    return new Promise<SlackResult<unknown>>((resolve) => {
      this.waiters.set(callId, resolve)
      socket.write(encodeBridgeMessage(request), (err) => {
        if (err) {
          this.waiters.delete(callId)
          resolve({ ok: false, kind: 'not_connected', message: 'Connect Slack in cosmos first.' })
        }
      })
    })
  }
}

/** Render a SlackResult as MCP tool content (structured + a text summary). */
function toToolResult(result: SlackResult<unknown>): {
  isError?: boolean
  content: { type: 'text'; text: string }[]
  structuredContent: { result: SlackResult<unknown> }
} {
  if (result.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data) }],
      structuredContent: { result }
    }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: result.message }],
    structuredContent: { result }
  }
}

async function main(): Promise<void> {
  const bridge = new SlackBridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-slack', version: '0.1.0' })

  server.registerTool(
    SlackTool.ListChannels,
    {
      title: 'List Slack channels',
      description:
        'List the public Slack channels readable by the connected workspace (read-only). ' +
        'Optionally pass a pagination `cursor` from a previous result to fetch the next page.',
      inputSchema: { cursor: z.string().optional() }
    },
    async ({ cursor }) =>
      toToolResult(await bridge.call(SlackOp.ListChannels, cursor ? { cursor } : {}))
  )

  server.registerTool(
    SlackTool.ReadHistory,
    {
      title: 'Read Slack channel history',
      description:
        'Read recent messages in a public Slack channel in order (read-only). ' +
        'Pass the channel id; optionally a pagination `cursor`.',
      inputSchema: { channelId: z.string(), cursor: z.string().optional() }
    },
    async ({ channelId, cursor }) =>
      toToolResult(
        await bridge.call(SlackOp.GetHistory, { channelId, ...(cursor ? { cursor } : {}) })
      )
  )

  server.registerTool(
    SlackTool.ReadThread,
    {
      title: 'Read Slack thread replies',
      description:
        "Read the replies in a Slack thread in order (read-only). Pass the channel id and the " +
        'parent message timestamp (`threadTs`); optionally a pagination `cursor`.',
      inputSchema: {
        channelId: z.string(),
        threadTs: z.string(),
        cursor: z.string().optional()
      }
    },
    async ({ channelId, threadTs, cursor }) =>
      toToolResult(
        await bridge.call(SlackOp.GetReplies, {
          channelId,
          threadTs,
          ...(cursor ? { cursor } : {})
        })
      )
  )

  server.registerTool(
    SlackTool.SearchMessages,
    {
      title: 'Search Slack messages',
      description:
        'Search Slack messages by keyword (read-only). Returns matching messages with author ' +
        'and channel context. If the connection lacks search permission, returns a structured ' +
        '"search unavailable" result.',
      inputSchema: { query: z.string(), cursor: z.string().optional() }
    },
    async ({ query, cursor }) =>
      toToolResult(await bridge.call(SlackOp.Search, { query, ...(cursor ? { cursor } : {}) }))
  )

  server.registerTool(
    SlackTool.LookupUser,
    {
      title: 'Look up a Slack user',
      description:
        'Resolve a Slack user id to display-name info (read-only).',
      inputSchema: { userId: z.string() }
    },
    async ({ userId }) => toToolResult(await bridge.call(SlackOp.GetUser, { userId }))
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[cosmos-slack] fatal:', err)
  process.exit(1)
})
