/**
 * Google Calendar MCP entry script (Google Calendar integration v1). A read-only
 * sibling to jiraMcpServer.ts.
 *
 * The main-managed `--mcp-config` registers this as a stdio MCP server; the `claude`
 * CLI spawns it and speaks JSON-RPC over stdin/stdout. It exposes the SINGLE read-only
 * tool `google_calendar_list_events`. The tool is a thin relay: it forwards an `op` +
 * `params` to the running Electron main process over the Google Calendar Unix-domain
 * socket (`src/main/googleCalendarBridge.ts`), awaits the typed `GoogleCalendarResult`,
 * and returns it as the tool result. Main owns the single connection + token; the token
 * NEVER reaches this process (SC-009). v1 is READ-ONLY — no write tools.
 *
 * Runs OUTSIDE Electron (plain Node): imports only Node built-ins, the MCP SDK, zod,
 * and the pure shared bridge/googleCalendar modules.
 */

import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  encodeBridgeMessage,
  googleCalendarBridgeSocketPath,
  type GoogleCalendarBridgeCallRequest,
  type GoogleCalendarBridgeServerMessage
} from '../shared/bridge'
import {
  GoogleCalendarOp,
  GoogleCalendarTool,
  type GoogleCalendarOpName,
  type GoogleCalendarResult
} from '../shared/types/googleCalendar'

function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

function resolveSocketPath(): string {
  return process.env['COSMOS_GOOGLE_CALENDAR_BRIDGE_SOCKET'] || googleCalendarBridgeSocketPath(projectDir())
}

/** A connection to the main Google Calendar bridge. NDJSON frames; resolves by `callId`. */
class GoogleCalendarBridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (result: GoogleCalendarResult<unknown>) => void>()

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
      let message: GoogleCalendarBridgeServerMessage
      try {
        message = JSON.parse(line) as GoogleCalendarBridgeServerMessage
      } catch {
        continue
      }
      if (message.kind === 'google_cal_result') {
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
      waiter({
        ok: false,
        kind: 'not_connected',
        message: 'cosmos is not running. Connect Google Calendar in cosmos first.'
      })
    }
  }

  /** Run one read op; resolves the typed result (or not_connected if unreachable). */
  async call(
    op: GoogleCalendarOpName,
    params: Record<string, unknown>
  ): Promise<GoogleCalendarResult<unknown>> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { ok: false, kind: 'not_connected', message: 'Connect Google Calendar in cosmos first.' }
    }
    const callId = randomUUID()
    const request: GoogleCalendarBridgeCallRequest = { kind: 'google_cal_call', callId, op, params }
    return new Promise<GoogleCalendarResult<unknown>>((resolve) => {
      this.waiters.set(callId, resolve)
      socket.write(encodeBridgeMessage(request), (err) => {
        if (err) {
          this.waiters.delete(callId)
          resolve({
            ok: false,
            kind: 'not_connected',
            message: 'Connect Google Calendar in cosmos first.'
          })
        }
      })
    })
  }
}

/** Render a GoogleCalendarResult as MCP tool content (structured + a text summary). */
function toToolResult(result: GoogleCalendarResult<unknown>): {
  isError?: boolean
  content: { type: 'text'; text: string }[]
  structuredContent: { result: GoogleCalendarResult<unknown> }
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
  const bridge = new GoogleCalendarBridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-google-calendar', version: '0.1.0' })

  server.registerTool(
    GoogleCalendarTool.ListEvents,
    {
      title: 'List Google Calendar events',
      description:
        'List events on the primary Google Calendar within a time window (read-only). Pass ' +
        '`timeMin` and `timeMax` as RFC-3339 instants (e.g. 2026-06-15T00:00:00Z). Returns ' +
        'time-ordered events (id, summary, start, end, allDay, optional timeZone/location). ' +
        'Optionally pass a pagination `cursor` from a previous result to fetch the next page.',
      inputSchema: {
        timeMin: z.string(),
        timeMax: z.string(),
        cursor: z.string().optional()
      }
    },
    async ({ timeMin, timeMax, cursor }) =>
      toToolResult(
        await bridge.call(GoogleCalendarOp.ListEvents, {
          timeMin,
          timeMax,
          ...(cursor ? { cursor } : {})
        })
      )
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[cosmos-google-calendar] fatal:', err)
  process.exit(1)
})
