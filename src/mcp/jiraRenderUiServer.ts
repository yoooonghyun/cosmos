/**
 * render_jira_ui MCP entry script (Jira generative-UI v2, D3).
 *
 * A SECOND stdio render server, sibling to `renderUiServer.ts`. It exposes ONE tool
 * `render_jira_ui(spec)` that teaches the model the Jira CUSTOM A2UI catalog
 * (`catalogId: 'jira'`) vocabulary — StatusBadge, TicketCard, IssueList,
 * TransitionPicker, CommentRow, CommentList, AddCommentControl — and relays the spec
 * to the SAME `UiBridge` socket as render_ui, stamping the bridge frame
 * `target: 'jira'` so main routes the surface to the Jira panel (FR-004/FR-011).
 *
 * The headless `claude -p` run for a `target: 'jira'` utterance is granted ONLY this
 * tool (`mcp__cosmos-jira-render-ui__render_jira_ui`), so a Jira run cannot reach the
 * generic render_ui and vice versa (D2, least-privilege).
 *
 * Runs OUTSIDE Electron (plain Node): Node built-ins, the MCP SDK, zod, and the pure
 * shared bridge/validate modules only. Carries NO token/secret (FR-017).
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

/** Absolute path to the main-process bridge socket (same socket as render_ui). */
function resolveSocketPath(): string {
  return process.env['COSMOS_BRIDGE_SOCKET'] || bridgeSocketPath(projectDir())
}

/**
 * A connection to the Electron main bridge. NDJSON frames. Tracks awaiting tool
 * calls by `callId` and resolves them when main responds. Identical relay to
 * `renderUiServer.BridgeClient`, except `render` stamps `target: 'jira'`.
 */
class BridgeClient {
  private socket: Socket | null = null
  private buffer = ''
  private readonly waiters = new Map<string, (action: A2uiAction) => void>()

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
      let message: BridgeServerMessage
      try {
        message = JSON.parse(line) as BridgeServerMessage
      } catch {
        continue
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
   * Render `spec` in the Jira panel (stamps `target: 'jira'`) and await the user's
   * resolved action. Resolves `cancel` if the bridge cannot be reached (FR-009).
   */
  async render(spec: BridgeRenderRequest['spec']): Promise<A2uiAction> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { type: 'cancel' }
    }
    const callId = randomUUID()
    // D3: stamp target: 'jira' so main routes the surface to the Jira panel.
    const request: BridgeRenderRequest = { kind: 'render', callId, spec, target: 'jira' }
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

/**
 * The render_jira_ui tool description — teaches the model the Jira CUSTOM catalog
 * (`catalogId: 'jira'`) vocabulary. Same A2UI 0.9 flat-list format as render_ui, but
 * the component TYPE NAMES are the Jira catalog's, and most carry their data as
 * STATIC props (the Jira resource shapes), not data-model paths. Only the two inputs
 * (TransitionPicker, AddCommentControl) round-trip through the data model.
 */
const JIRA_TOOL_DESCRIPTION = [
  'Render a Jira UI surface in the cosmos Jira panel using the Jira custom catalog',
  "(catalogId: 'jira') and return the user's interaction. Use this for Jira issue",
  'lists, ticket detail, transitions, and comments — it renders status with color',
  'parity to the native panel.',
  '',
  'ARGUMENT: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9.',
  'components is a FLAT array; each is { "id": "<unique>", "component": "<Type>", ...props }.',
  'Parents reference children by id string. Exactly ONE root (id "root" or the',
  'component nothing else references).',
  '',
  'Jira component types and their props (most take STATIC props — the Jira data —',
  'NOT data-model path bindings):',
  '  StatusBadge { statusName: string, statusCategory: "todo"|"in_progress"|"done"|"unknown" }',
  '  TicketCard  { issueKey: string, summary: string,',
  '                statusName: string, statusCategory: <category>,',
  '                assignee?: { accountId: string, displayName: string } }',
  '  IssueList   { issues: TicketCard-props[] }   // an array of the TicketCard prop objects',
  '  CommentRow  { comment: { id, author?: {accountId,displayName}, body, created? } }',
  '  CommentList { comments: Comment[] }',
  '  TransitionPicker { issueKey: string,',
  '                     availableTransitions: [{ id: string, name: string }] }',
  '       // emits jira.transition; its selection binds to /transitionId internally',
  '  AddCommentControl { issueKey: string }',
  '       // emits jira.comment; its text binds to /commentBody internally',
  '',
  'You do NOT add path bindings or a submit Button for TransitionPicker /',
  'AddCommentControl — those components own their input binding and their action.',
  'Use Column/Row only if you need to group; otherwise emit the Jira components',
  'directly as children of a root with "id": "root".',
  '',
  'Example (an issue list):',
  '{ "surfaceId": "jira-list", "components": [',
  '  { "id": "root", "component": "IssueList", "issues": [',
  '    { "issueKey": "PROJ-1", "summary": "Fix login", "statusName": "In Progress",',
  '      "statusCategory": "in_progress" } ] } ] }',
  '',
  'Resolves with the user action (e.g. a jira.transition / jira.comment), or an',
  'explicit cancellation if dismissed.'
].join('\n')

/** Human-readable summary of the resolved action for the text tool result. */
function describeAction(action: A2uiAction): string {
  if (action.type === 'cancel') {
    return 'The user dismissed the Jira UI without acting (cancelled).'
  }
  const id = action.actionId ? ` "${action.actionId}"` : ''
  const values = action.values ? ` with values ${JSON.stringify(action.values)}` : ''
  return `The user activated control${id}${values}.`
}

async function main(): Promise<void> {
  const bridge = new BridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-jira-render-ui', version: '0.1.0' })

  server.registerTool(
    'render_jira_ui',
    {
      title: 'Render Jira UI',
      description: JIRA_TOOL_DESCRIPTION,
      inputSchema: {
        spec: z
          .object({
            surfaceId: z.string(),
            components: z.array(z.unknown())
          })
          .passthrough()
      }
    },
    async ({ spec }) => {
      const valid = validateSurfaceUpdate(spec)
      if (!valid) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'render_jira_ui error: the provided spec is not a valid A2UI surfaceUpdate (needs a non-empty "surfaceId" and a "components" array).'
            }
          ]
        }
      }

      const action = await bridge.render(valid)
      return {
        content: [{ type: 'text' as const, text: describeAction(action) }],
        structuredContent: { action }
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[cosmos-jira-render-ui] fatal:', err)
  process.exit(1)
})
