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
  type BridgeGeneratingNotification,
  type BridgeRenderRequest,
  type BridgeServerMessage
} from '../shared/bridge'
import { validateSurfaceUpdate } from '../shared/validate'
import { BindingsFirstEnforcer } from '../shared/dataBearingSpec'
import { registerGetUiCatalogTool } from './uiCatalog'
import { JiraAdapterSource } from '../shared/jira'
import { SlackAdapterSource } from '../shared/slack'
import { ConfluenceAdapterSource } from '../shared/confluence'
import type { A2uiAction } from '../shared/ipc'

/** Where the bridge socket lives. Claude Code sets CLAUDE_PROJECT_DIR. */
function projectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * Absolute path to the main-process bridge socket. cosmos runs the embedded
 * `claude` in an isolated sandbox cwd, so it threads the socket path explicitly
 * via COSMOS_BRIDGE_SOCKET; we fall back to deriving it from the project dir for
 * a manual run from the project root.
 */
function resolveSocketPath(): string {
  return process.env['COSMOS_BRIDGE_SOCKET'] || bridgeSocketPath(projectDir())
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
   * panel-refresh-v1 (FR-010): an OPTIONAL secret-free `descriptor` makes the surface
   * refreshable — main validates + secret-screens it at the boundary, so passing one
   * here is safe (a malformed/unknown descriptor is ignored, the surface still renders).
   */
  async render(
    spec: BridgeRenderRequest['spec'],
    descriptor?: BridgeRenderRequest['descriptor'],
    bindings?: BridgeRenderRequest['bindings']
  ): Promise<A2uiAction> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return { type: 'cancel' }
    }
    const callId = randomUUID()
    const request: BridgeRenderRequest = {
      kind: 'render',
      callId,
      spec,
      ...(descriptor ? { descriptor } : {}),
      ...(bindings ? { bindings } : {})
    }
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

  /**
   * Fire the EARLY "UI generation has begun" begin-signal (ui-catalog-pull-spinner-signal-v1,
   * FR-003): a fire-and-forget `{ kind:'generating' }` frame over the SAME bridge socket when
   * `get_ui_catalog` is called. NO waiter is registered (main sends no result). BEST-EFFORT:
   * if the bridge is unreachable or the write fails, swallow the error — the catalog still
   * returns (FR-010/FR-012). `target` omitted ⇒ main defaults to 'generated-ui'.
   */
  async notifyGenerating(target?: BridgeGeneratingNotification['target']): Promise<void> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return // bridge down — swallow; the catalog still returns.
    }
    const frame: BridgeGeneratingNotification = {
      kind: 'generating',
      callId: randomUUID(),
      ...(target ? { target } : {})
    }
    try {
      socket.write(encodeBridgeMessage(frame))
    } catch {
      // swallow — a missing/failed begin-signal must never fail the catalog return.
    }
  }
}

/**
 * The SLIMMED render_ui tool description (ui-catalog-pull-spinner-signal-v1, FR-001, OQ-1
 * = STRONG). The full A2UI component catalog now lives in `get_ui_catalog` (shared
 * `uiCatalog.ts`) — this description deliberately omits it so the model CANNOT reliably
 * author a valid surface without first PULLING the catalog (that pull is the early
 * UI-generation spinner signal). Only a one-line pointer + the bare argument shape remain.
 */
const A2UI_TOOL_DESCRIPTION = [
  'Render a rich, interactive UI surface in the cosmos Generated-UI panel and',
  "return the user's interaction. Use this whenever a request is best answered",
  'with a form, list, card, choices, or other interactive UI rather than text.',
  '',
  'ARGUMENT: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9; components',
  'is a FLAT array of { "id", "component": "<TypeName>", ...props }.',
  '',
  'ALWAYS call get_ui_catalog FIRST to get the component catalog and authoring rules',
  '(component types, props, data-binding, and the refreshable-bindings rules) before',
  'calling render_ui — you cannot author a valid surface without it.'
].join('\n')

/**
 * The valid `dataSource` ids the generic render_ui descriptor accepts (bindings-first v3): the
 * UNION of every integration's ADAPTER SOURCE id (mirrors `TARGET_ADAPTER_SOURCES['generated-ui']`
 * in `src/shared/validate.ts`). These are the adapter source ids — NOT the MCP read-tool names
 * (`jira_search_issues`, `slack_*`, `confluence_*`). The model previously set the read-tool name
 * here, so main dropped the binding as cross-target and the surface landed unbound.
 */
const VALID_DATA_SOURCES: readonly string[] = [
  ...Object.values(JiraAdapterSource),
  ...Object.values(SlackAdapterSource),
  ...Object.values(ConfluenceAdapterSource)
]

/**
 * Zod schema for the OPTIONAL secret-free refresh descriptor (panel-refresh-v1, FR-010).
 * `dataSource` is now CONSTRAINED to the known adapter source ids (bindings-first v3) so a
 * read-tool-name value is rejected AT the render tool — the model resubmits with the right id
 * instead of the call silently passing the MCP boundary and being dropped by main as cross-target.
 * `query` internals stay permissive (validated + secret-stripped + target-matched in main).
 */
const DESCRIPTOR_SCHEMA = z
  .object({
    dataSource: z.string().refine((s) => VALID_DATA_SOURCES.includes(s), {
      message: `dataSource must be one of: ${VALID_DATA_SOURCES.join(', ')} — the adapter source id, NOT the MCP read-tool name (e.g. jira_search_issues, slack_read_history, confluence_search_content).`
    }),
    query: z.record(z.unknown())
  })
  .passthrough()

/**
 * Zod schema for the OPTIONAL per-container bindings (refreshable-custom-generative-ui
 * multi-region). One `{ componentId, descriptor }` per data-bearing container so a
 * PARTITIONED layout (a kanban's columns) refreshes container-by-container. Main rebinds +
 * registers each region; an invalid/cross-target entry is dropped at the boundary.
 */
const BINDINGS_SCHEMA = z.array(
  z.object({ componentId: z.string(), descriptor: DESCRIPTOR_SCHEMA })
)

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
  const bridge = new BridgeClient(resolveSocketPath())
  // bindings-first ENFORCEMENT (v2): one per-process gate so an unbound data surface is rejected
  // (the model resubmits with a binding per container), bounded by the cap → render-anyway.
  const enforcer = new BindingsFirstEnforcer()
  const server = new McpServer({ name: 'cosmos-render-ui', version: '0.1.0' })

  // ui-catalog-pull-spinner-signal-v1 (FR-001/FR-002): the `get_ui_catalog` tool the agent must
  // pull before render_ui. Registered via the SHARED helper so all five servers are byte-
  // identical. On each pull it fires the fire-and-forget begin-signal for THIS server's target
  // (omitted ⇒ 'generated-ui'); a notify failure never blocks the catalog return (FR-010/FR-012).
  registerGetUiCatalogTool(server, { onGenerating: () => void bridge.notifyGenerating() })

  server.registerTool(
    'render_ui',
    {
      title: 'Render UI',
      description: A2UI_TOOL_DESCRIPTION,
      inputSchema: {
        // FR-001: single argument, an A2UI surfaceUpdate. Structurally validated
        // here at the boundary by validateSurfaceUpdate (FR-003); zod keeps the
        // tool schema permissive about component internals (the SDK owns those).
        spec: z
          .object({
            surfaceId: z.string(),
            components: z.array(z.unknown())
          })
          .passthrough(),
        // panel-refresh-v1 (FR-010): optional secret-free refresh descriptor.
        descriptor: DESCRIPTOR_SCHEMA.optional(),
        // multi-region: optional per-container bindings for a partitioned refreshable layout.
        bindings: BINDINGS_SCHEMA.optional()
      }
    },
    async ({ spec, descriptor, bindings }) => {
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

      // bindings-first ENFORCEMENT (v2): a data-bearing surface MUST declare a binding per data
      // container so it is refreshable. If the call carries neither `descriptor` nor `bindings`
      // yet the spec paints integration data, reject with an instructive (secret-free) message so
      // the model resubmits with bindings — do NOT render. Bounded by the cap (render-anyway).
      const decision = enforcer.evaluate({
        spec: valid,
        hasDescriptor: descriptor !== undefined,
        hasBindings: bindings !== undefined
      })
      if (decision.reject) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `render_ui error: ${decision.message}` }]
        }
      }

      // FR-004/FR-007: push to the renderer via main and await the user's action.
      // panel-refresh-v1 (FR-010): forward the optional descriptor; main validates +
      // secret-screens it, so an invalid/unknown one is ignored (surface still renders).
      const action = await bridge.render(valid, descriptor, bindings)
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
