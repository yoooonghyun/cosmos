/**
 * render_confluence_ui MCP entry script (Slack + Confluence generative-UI v1, FR-008).
 *
 * A render server scoped to the Confluence panel, sibling to `jiraRenderUiServer.ts`.
 * It exposes ONE tool `render_confluence_ui(spec)` that teaches the model the
 * Confluence CUSTOM A2UI catalog (`catalogId: 'confluence'`) vocabulary —
 * SearchResultList/SearchResultRow, PageDetail, Notice + Column/Row/Text — and relays
 * the spec to the SAME `UiBridge` socket as render_ui, stamping the bridge frame
 * `target: 'confluence'` so main routes the surface to the Confluence panel
 * (FR-002/FR-003).
 *
 * The headless `claude -p` run for a `target: 'confluence'` utterance is granted ONLY
 * this tool plus the read-only Confluence tools (least-privilege, FR-009/FR-010) — it
 * cannot reach Jira, Slack, or the generic render_ui. READ-ONLY: there is NO write tool
 * and NO deterministic action dispatch (FR-012); the surface is display-only.
 *
 * Runs OUTSIDE Electron (plain Node): Node built-ins, the MCP SDK, zod, and the pure
 * shared bridge/validate modules only. Carries NO token/secret (FR-018).
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
 * `renderUiServer.BridgeClient`, except `render` stamps `target: 'confluence'`.
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
   * Render `spec` in the Confluence panel (stamps `target: 'confluence'`) and await
   * the resolved action. A `'confluence'` surface is display-only, so main settles it
   * immediately (UiBridge FR-014) and this resolves a `cancel` right away — the
   * one-shot run then completes and the panel spinner stops. Also resolves `cancel`
   * if the bridge cannot be reached (FR-009).
   */
  async render(spec: BridgeRenderRequest['spec']): Promise<A2uiAction> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { type: 'cancel' }
    }
    const callId = randomUUID()
    const request: BridgeRenderRequest = { kind: 'render', callId, spec, target: 'confluence' }
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
 * The render_confluence_ui tool description — teaches the model the Confluence CUSTOM
 * catalog (`catalogId: 'confluence'`) vocabulary. Same A2UI 0.9 flat-list format as
 * render_ui, but the component TYPE NAMES are the Confluence catalog's, and all carry
 * their data as STATIC props (the Confluence resource shapes from
 * src/shared/confluence.ts). DISPLAY-ONLY: there are NO input controls and NO actions.
 */
const CONFLUENCE_TOOL_DESCRIPTION = [
  'Render a Confluence UI surface in the cosmos Confluence panel using the Confluence',
  "custom catalog (catalogId: 'confluence'). Use this for content search results and",
  'page detail — it matches the native Confluence panel chrome.',
  '',
  'ARGUMENT: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9.',
  'components is a FLAT array; each is { "id": "<unique>", "component": "<Type>", ...props }.',
  'Parents reference children by id string. Exactly ONE root (id "root" or the',
  'component nothing else references).',
  '',
  'Confluence component types and their props (all take STATIC props — real Confluence',
  'data; body/excerpt are pre-flattened plain text):',
  '  SearchResultRow  { id: string, title: string, space?: string, excerpt: string }',
  '  SearchResultList { results: SearchResultRow-props[] }  // empty [] => "No content matches."',
  '  PageDetail  { id: string, title: string, space?: string, body: string }',
  '  Notice      { noticeKind: "info"|"error", message: string }',
  '  Text        { text: string, variant?: "label"|"body", muted?: boolean }',
  '  Column / Row  // layout grouping; reference children by id',
  '',
  'Use a Notice (noticeKind "error") when Confluence is not connected or a read fails,',
  'and (noticeKind "info") for "nothing found" / a page not found. Use Column/Row/Text',
  'only to group or label.',
  '',
  'Example (a search result list — values are ILLUSTRATIVE ONLY, never copy them):',
  '{ "surfaceId": "confluence-search", "components": [',
  '  { "id": "root", "component": "SearchResultList", "results": [',
  '    { "id": "1", "title": "Onboarding", "space": "ENG", "excerpt": "Welcome…" } ] } ] }',
  '',
  'Resolves once the surface is shown (display-only — it does not await a user action).'
].join('\n')

/** Human-readable summary of the resolved action for the text tool result. */
function describeAction(action: A2uiAction): string {
  if (action.type === 'cancel') {
    return 'The Confluence surface was rendered (display-only).'
  }
  const id = action.actionId ? ` "${action.actionId}"` : ''
  return `The user activated control${id}.`
}

async function main(): Promise<void> {
  const bridge = new BridgeClient(resolveSocketPath())
  const server = new McpServer({ name: 'cosmos-confluence-render-ui', version: '0.1.0' })

  server.registerTool(
    'render_confluence_ui',
    {
      title: 'Render Confluence UI',
      description: CONFLUENCE_TOOL_DESCRIPTION,
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
              text: 'render_confluence_ui error: the provided spec is not a valid A2UI surfaceUpdate (needs a non-empty "surfaceId" and a "components" array).'
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
  console.error('[cosmos-confluence-render-ui] fatal:', err)
  process.exit(1)
})
