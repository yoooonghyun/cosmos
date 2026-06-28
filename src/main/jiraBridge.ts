/**
 * JiraBridge — local-socket server in the Electron main process (Atlassian v1).
 * A sibling to {@link SlackBridge}: the spawned Jira MCP entry script
 * (`src/mcp/jiraMcpServer.ts`) connects here over a Unix domain socket and asks
 * main to run a read operation; main forwards to {@link JiraManager} and writes the
 * typed `JiraResult` back so the tool call resolves (FR-X01, FR-X05).
 *
 * Each frame is validated at the boundary (FR-X04): a malformed/unknown frame is
 * warned and ignored — never crashes, never mis-resolves another call. A
 * not-connected / reconnect-needed / scope-gap op returns a structured result (never
 * a hang). Results never include the token (FR-X02, SC-009). Jira generative-UI v1
 * adds the two WRITE ops (transition / comment) alongside the reads (FR-008).
 */

import { createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { encodeBridgeMessage } from '../shared/bridge'
import {
  JiraOp,
  type JiraCreateParams,
  type JiraResult,
  type JiraUpdateParams
} from '../shared/types/jira'
import {
  validateJiraBridgeCall,
  validateJiraComment,
  validateJiraCreate,
  validateJiraGetIssue,
  validateJiraSearch,
  validateJiraTransition,
  validateJiraUpdate
} from '../shared/validate'

type WarnFn = (message: string, ...args: unknown[]) => void

/** Token-free one-line summary of a Jira result for diagnostics (issue keys / error kind). */
function summarizeJiraResult(result: JiraResult<unknown>): string {
  if (!result.ok) {
    return `error:${result.kind}`
  }
  const data = (result as { data?: unknown }).data
  if (Array.isArray(data)) {
    return `${data.length} items [${data.map((d) => (d as { key?: string })?.key ?? '?').slice(0, 12).join(',')}]`
  }
  if (data && typeof data === 'object') {
    const obj = data as { items?: unknown[]; key?: string }
    if (Array.isArray(obj.items)) {
      return `${obj.items.length} items [${obj.items.map((d) => (d as { key?: string })?.key ?? '?').slice(0, 12).join(',')}]`
    }
    if (typeof obj.key === 'string') {
      return `issue ${obj.key}`
    }
  }
  return 'ok'
}

/**
 * The subset of JiraManager the bridge invokes. Reads + the two write ops (Jira
 * generative-UI v1, FR-008): the model-mediated write tools relay through here to the
 * SAME manager write methods deterministic dispatch uses — one implementation.
 */
export interface JiraBridgeManager {
  searchIssues(params: { jql: string; cursor?: string }): Promise<JiraResult<unknown>>
  getIssue(params: { issueKey: string }): Promise<JiraResult<unknown>>
  transitionIssue(params: { issueKey: string; transitionId: string }): Promise<JiraResult<unknown>>
  addComment(params: { issueKey: string; body: string }): Promise<JiraResult<unknown>>
  createIssue(params: JiraCreateParams): Promise<JiraResult<unknown>>
  updateIssue(params: JiraUpdateParams): Promise<JiraResult<unknown>>
}

export interface JiraBridgeDeps {
  /** Absolute socket path (sibling to the Slack/render_ui sockets). */
  socketPath: string
  /** The single Jira manager all reads route through (FR-A13). */
  manager: JiraBridgeManager
  warn?: WarnFn
}

export class JiraBridge {
  private server: Server | null = null
  private readonly socketPath: string
  private readonly manager: JiraBridgeManager
  private readonly warn: WarnFn
  private readonly sockets = new Set<Socket>()

  constructor(deps: JiraBridgeDeps) {
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
    server.on('error', (err) => this.warn('[jira] bridge server error:', err))
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
      this.warn('[jira] ignoring malformed bridge frame')
      return
    }
    const call = validateJiraBridgeCall(parsed, this.warn)
    if (!call) {
      return // invalid/unknown -> warned + ignored (FR-X04)
    }
    const result = await this.handleCall(call.op, call.params)
    console.log('[jira] bridge call op=', call.op, 'ok=', (result as { ok?: boolean }).ok, 'summary=', summarizeJiraResult(result))
    if (!socket.destroyed) {
      socket.write(encodeBridgeMessage({ kind: 'jira_result', callId: call.callId, result }))
    }
  }

  /**
   * Validate the op's params and forward to the manager (FR-X04). An invalid params
   * object returns a structured error result rather than crashing. Pure w.r.t. the
   * socket so it is unit-testable.
   */
  async handleCall(op: string, params: Record<string, unknown>): Promise<JiraResult<unknown>> {
    const invalidParams: JiraResult<unknown> = {
      ok: false,
      kind: 'network',
      message: 'Invalid Jira tool parameters.'
    }
    switch (op) {
      case JiraOp.SearchIssues: {
        const p = validateJiraSearch(params, this.warn)
        return p ? this.manager.searchIssues(p) : invalidParams
      }
      case JiraOp.GetIssue: {
        const p = validateJiraGetIssue(params, this.warn)
        return p ? this.manager.getIssue(p) : invalidParams
      }
      case JiraOp.TransitionIssue: {
        const p = validateJiraTransition(params, this.warn)
        return p ? this.manager.transitionIssue(p) : invalidParams
      }
      case JiraOp.AddComment: {
        const p = validateJiraComment(params, this.warn)
        return p ? this.manager.addComment(p) : invalidParams
      }
      case JiraOp.CreateIssue: {
        const p = validateJiraCreate(params, this.warn)
        return p ? this.manager.createIssue(p) : invalidParams
      }
      case JiraOp.UpdateIssue: {
        const p = validateJiraUpdate(params, this.warn)
        return p ? this.manager.updateIssue(p) : invalidParams
      }
      default:
        return invalidParams
    }
  }
}
