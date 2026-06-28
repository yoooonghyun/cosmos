/**
 * GoogleCalendarBridge — local-socket server in the Electron main process (Google
 * Calendar integration v1). A read-only sibling to {@link JiraBridge}: the spawned
 * Google Calendar MCP entry script (`src/mcp/googleCalendarMcpServer.ts`) connects here
 * over a Unix domain socket and asks main to run a read operation; main forwards to
 * {@link GoogleCalendarManager} and writes the typed `GoogleCalendarResult` back so the
 * tool call resolves.
 *
 * Each frame is validated at the boundary: a malformed/unknown frame is warned and
 * ignored — never crashes, never mis-resolves another call. A not-connected /
 * reconnect-needed / rate-limited op returns a structured result (never a hang).
 * Results never include the token (SC-009). v1 is READ-ONLY: the only op is
 * `listEvents` — there is NO write path.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { encodeBridgeMessage } from '../shared/bridge'
import { GoogleCalendarOp, type GoogleCalendarResult } from '../shared/types/googleCalendar'
import { validateGoogleCalendarBridgeCall, validateGoogleCalendarListEvents } from '../shared/validate'

type WarnFn = (message: string, ...args: unknown[]) => void

/** Token-free one-line summary of a Google Calendar result for diagnostics. */
function summarizeResult(result: GoogleCalendarResult<unknown>): string {
  if (!result.ok) {
    return `error:${result.kind}`
  }
  const data = (result as { data?: unknown }).data
  if (data && typeof data === 'object') {
    const obj = data as { items?: unknown[] }
    if (Array.isArray(obj.items)) {
      return `${obj.items.length} events`
    }
  }
  return 'ok'
}

/**
 * The subset of GoogleCalendarManager the bridge invokes. Read-only (v1): the MCP
 * tool relays through here to the SAME manager read the IPC default-view path uses —
 * one implementation, two callers.
 */
export interface GoogleCalendarBridgeManager {
  listEvents(params: {
    timeMin: string
    timeMax: string
    cursor?: string
  }): Promise<GoogleCalendarResult<unknown>>
}

export interface GoogleCalendarBridgeDeps {
  /** Absolute socket path (sibling to the Slack/Jira/render_ui sockets). */
  socketPath: string
  /** The single Google Calendar manager all reads route through. */
  manager: GoogleCalendarBridgeManager
  warn?: WarnFn
}

export class GoogleCalendarBridge {
  private server: Server | null = null
  private readonly socketPath: string
  private readonly manager: GoogleCalendarBridgeManager
  private readonly warn: WarnFn
  private readonly sockets = new Set<Socket>()

  constructor(deps: GoogleCalendarBridgeDeps) {
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
    server.on('error', (err) => this.warn('[google-calendar] bridge server error:', err))
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
      this.warn('[google-calendar] ignoring malformed bridge frame')
      return
    }
    const call = validateGoogleCalendarBridgeCall(parsed, this.warn)
    if (!call) {
      return // invalid/unknown -> warned + ignored
    }
    const result = await this.handleCall(call.op, call.params)
    console.log(
      '[google-calendar] bridge call op=',
      call.op,
      'ok=',
      (result as { ok?: boolean }).ok,
      'summary=',
      summarizeResult(result)
    )
    if (!socket.destroyed) {
      socket.write(
        encodeBridgeMessage({ kind: 'google_cal_result', callId: call.callId, result })
      )
    }
  }

  /**
   * Validate the op's params and forward to the manager. An invalid params object
   * returns a structured error result rather than crashing. Pure w.r.t. the socket so
   * it is unit-testable.
   */
  async handleCall(
    op: string,
    params: Record<string, unknown>
  ): Promise<GoogleCalendarResult<unknown>> {
    const invalidParams: GoogleCalendarResult<unknown> = {
      ok: false,
      kind: 'network',
      message: 'Invalid Google Calendar tool parameters.'
    }
    switch (op) {
      case GoogleCalendarOp.ListEvents: {
        const p = validateGoogleCalendarListEvents(params, this.warn)
        return p ? this.manager.listEvents(p) : invalidParams
      }
      default:
        return invalidParams
    }
  }
}
