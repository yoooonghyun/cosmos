/**
 * Jira MCP entry script (Atlassian integration v1). A sibling to slackMcpServer.ts.
 *
 * The main-managed `--mcp-config` registers this as a stdio MCP server; the
 * `claude` CLI spawns it and speaks JSON-RPC over stdin/stdout (FR-X01). It exposes
 * the two read-only Jira tools plus the two WRITE tools (transition / comment) added
 * by Jira generative-UI v1 (FR-008/FR-009). Each tool is a thin relay: it
 * forwards an `op` + `params` to the running Electron main process over the Jira
 * Unix-domain socket (`src/main/jiraBridge.ts`), awaits the typed `JiraResult`, and
 * returns it as the tool result (FR-X05). Main owns the single Jira connection +
 * token; the token NEVER reaches this process (FR-X02, SC-009).
 *
 * Runs OUTSIDE Electron (plain Node): imports only Node built-ins, the MCP SDK,
 * zod, and the pure shared bridge/jira modules.
 */

import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  encodeBridgeMessage,
  jiraBridgeSocketPath,
  type JiraBridgeCallRequest,
  type JiraBridgeServerMessage
} from '../shared/bridge'
import { JiraOp, JiraTool, type JiraOpName, type JiraResult } from '../shared/jira'

function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

function resolveSocketPath(): string {
  return process.env['COSMOS_JIRA_BRIDGE_SOCKET'] || jiraBridgeSocketPath(projectDir())
}

/** A connection to the main Jira bridge. NDJSON frames; resolves by `callId`. */
class JiraBridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (result: JiraResult<unknown>) => void>()

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
      let message: JiraBridgeServerMessage
      try {
        message = JSON.parse(line) as JiraBridgeServerMessage
      } catch {
        continue
      }
      if (message.kind === 'jira_result') {
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
        message: 'cosmos is not running. Connect Jira in cosmos first.'
      })
    }
  }

  /** Run one read op; resolves the typed result (or not_connected if unreachable). */
  async call(op: JiraOpName, params: Record<string, unknown>): Promise<JiraResult<unknown>> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { ok: false, kind: 'not_connected', message: 'Connect Jira in cosmos first.' }
    }
    const callId = randomUUID()
    const request: JiraBridgeCallRequest = { kind: 'jira_call', callId, op, params }
    return new Promise<JiraResult<unknown>>((resolve) => {
      this.waiters.set(callId, resolve)
      socket.write(encodeBridgeMessage(request), (err) => {
        if (err) {
          this.waiters.delete(callId)
          resolve({ ok: false, kind: 'not_connected', message: 'Connect Jira in cosmos first.' })
        }
      })
    })
  }
}

/** Render a JiraResult as MCP tool content (structured + a text summary). */
function toToolResult(result: JiraResult<unknown>): {
  isError?: boolean
  content: { type: 'text'; text: string }[]
  structuredContent: { result: JiraResult<unknown> }
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
  const bridge = new JiraBridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-jira', version: '0.1.0' })

  server.registerTool(
    JiraTool.SearchIssues,
    {
      title: 'Search Jira issues',
      description:
        'Search Jira issues with a JQL query (read-only). Returns matching issues with key, ' +
        'summary, status, and assignee. Optionally pass a pagination `cursor` from a previous ' +
        'result to fetch the next page.',
      inputSchema: { jql: z.string(), cursor: z.string().optional() }
    },
    async ({ jql, cursor }) =>
      toToolResult(await bridge.call(JiraOp.SearchIssues, { jql, ...(cursor ? { cursor } : {}) }))
  )

  server.registerTool(
    JiraTool.GetIssue,
    {
      title: 'Get a Jira issue',
      description:
        'Read one Jira issue in full (read-only): summary, status, assignee, reporter, ' +
        'description, and comments in order. Pass the issue key (e.g. PROJ-123).',
      inputSchema: { issueKey: z.string() }
    },
    async ({ issueKey }) => toToolResult(await bridge.call(JiraOp.GetIssue, { issueKey }))
  )

  // WRITE tools (Jira generative-UI v1, FR-008/FR-009). These MUTATE Jira and reach
  // the SAME JiraManager write methods as deterministic `jira.*` dispatch.
  server.registerTool(
    JiraTool.TransitionIssue,
    {
      title: 'Transition a Jira issue',
      description:
        'MUTATES Jira: move an issue to another status by applying a transition. Pass the ' +
        'issue key (e.g. PROJ-123) and a `transitionId` from that issue\'s available ' +
        'transitions (read jira_get_issue first to get valid ids). Returns the applied id ' +
        'or a structured error (e.g. an invalid/stale transition, or reconnect needed).',
      inputSchema: { issueKey: z.string(), transitionId: z.string() }
    },
    async ({ issueKey, transitionId }) =>
      toToolResult(await bridge.call(JiraOp.TransitionIssue, { issueKey, transitionId }))
  )

  server.registerTool(
    JiraTool.AddComment,
    {
      title: 'Add a comment to a Jira issue',
      description:
        'MUTATES Jira: post a comment to an issue. Pass the issue key (e.g. PROJ-123) and a ' +
        'non-empty `body` (plain text). Returns the created comment or a structured error.',
      inputSchema: { issueKey: z.string(), body: z.string() }
    },
    async ({ issueKey, body }) =>
      toToolResult(await bridge.call(JiraOp.AddComment, { issueKey, body }))
  )

  // WRITE tools (Jira write-extend v1, FR-008/FR-009). These MUTATE Jira and reach the
  // SAME JiraManager write methods (createIssue / updateIssue) as deterministic
  // `jira.create` / `jira.update` dispatch — one implementation, two callers.
  server.registerTool(
    JiraTool.CreateIssue,
    {
      title: 'Create a Jira issue',
      description:
        'MUTATES Jira: create a NEW issue. Pass the fixed minimal fields — `projectKey` ' +
        '(e.g. PROJ), `issueType` (the type NAME, e.g. Task/Bug/Story), `summary` ' +
        '(non-empty), and an optional `description` (plain text). Returns the new issue ' +
        'key or a structured error (e.g. the project requires additional required fields, ' +
        'an unknown project/type, or reconnect needed). Does NOT discover per-project ' +
        'required fields.',
      inputSchema: {
        projectKey: z.string(),
        issueType: z.string(),
        summary: z.string(),
        description: z.string().optional()
      }
    },
    async ({ projectKey, issueType, summary, description }) =>
      toToolResult(
        await bridge.call(JiraOp.CreateIssue, {
          projectKey,
          issueType,
          summary,
          ...(description !== undefined ? { description } : {})
        })
      )
  )

  server.registerTool(
    JiraTool.UpdateIssue,
    {
      title: 'Update a Jira issue',
      description:
        'MUTATES Jira: update an existing issue\'s fields. Pass the issue key (e.g. ' +
        'PROJ-123) and a `fields` object carrying ONLY the fields to change — `summary` ' +
        'and/or `description` (plain text), and optionally `assignee` as { accountId }. ' +
        'An empty `fields` is rejected (no-op). Returns the edited key or a structured ' +
        'error (e.g. an unknown/inaccessible key, or reconnect needed).',
      inputSchema: {
        issueKey: z.string(),
        fields: z
          .object({
            summary: z.string().optional(),
            description: z.string().optional(),
            assignee: z.object({ accountId: z.string() }).optional()
          })
          .passthrough()
      }
    },
    async ({ issueKey, fields }) =>
      toToolResult(await bridge.call(JiraOp.UpdateIssue, { issueKey, fields }))
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[cosmos-jira] fatal:', err)
  process.exit(1)
})
