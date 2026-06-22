/**
 * render_google_calendar_ui MCP entry script (Google Calendar integration v1).
 *
 * A stdio render server, sibling to `jiraRenderUiServer.ts`. It exposes ONE tool
 * `render_google_calendar_ui(spec)` that teaches the model the Google Calendar CUSTOM
 * A2UI catalog (`catalogId: 'google-calendar'`) vocabulary — EventList, EventRow,
 * Notice — and relays the spec to the SAME `UiBridge` socket as render_ui, stamping the
 * bridge frame `target: 'google-calendar'` so main routes the surface to the Google
 * Calendar panel.
 *
 * The headless `claude -p` run for a `target: 'google-calendar'` utterance is granted
 * ONLY this tool (`mcp__cosmos-google-calendar-render-ui__render_google_calendar_ui`),
 * so a Calendar run cannot reach the generic render_ui and vice versa (least-privilege).
 *
 * v1 is READ-ONLY: the catalog carries event data as STATIC props; there is NO input
 * component and NO bound action. Containers MAY declare ONE refresh binding (the
 * `listEvents` adapter source) so the panel refresh control re-fetches in place.
 *
 * Runs OUTSIDE Electron (plain Node): Node built-ins, the MCP SDK, zod, and the pure
 * shared bridge/validate modules only. Carries NO token/secret.
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
import { AdapterFlagPath } from '../shared/adapter'
import { BindingsFirstEnforcer } from '../shared/dataBearingSpec'
import { GoogleCalendarAdapterSource } from '../shared/googleCalendar'
import { registerGetUiCatalogTool } from './uiCatalog'
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
 * A connection to the Electron main bridge. NDJSON frames. Tracks awaiting tool calls
 * by `callId`. Identical relay to `jiraRenderUiServer.BridgeClient`, except `render`
 * stamps `target: 'google-calendar'`.
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
   * Render `spec` in the Google Calendar panel (stamps `target: 'google-calendar'`) and
   * await the user's resolved action. Resolves `cancel` if the bridge cannot be reached.
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
      target: 'google-calendar',
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
   * `get_ui_catalog` is called. NO waiter (main sends no result). BEST-EFFORT: a bridge-down or
   * write failure is swallowed so the catalog still returns (FR-010/FR-012).
   */
  async notifyGenerating(target?: BridgeGeneratingNotification['target']): Promise<void> {
    let socket: Socket
    try {
      socket = await this.ensureConnected()
    } catch {
      return
    }
    const frame: BridgeGeneratingNotification = {
      kind: 'generating',
      callId: randomUUID(),
      ...(target ? { target } : {})
    }
    try {
      socket.write(encodeBridgeMessage(frame))
    } catch {
      // swallow — the catalog must still return.
    }
  }
}

/**
 * The render_google_calendar_ui tool description — teaches the model the Google Calendar
 * CUSTOM catalog (`catalogId: 'google-calendar'`) vocabulary. Same A2UI 0.9 flat-list
 * format as render_ui, but the component TYPE NAMES are the Calendar catalog's and carry
 * their data as STATIC props (the Calendar resource shapes). v1 is READ-ONLY: no input,
 * no bound action.
 */
const GOOGLE_CALENDAR_TOOL_DESCRIPTION = [
  'Render a Google Calendar UI surface in the cosmos Google Calendar panel using the',
  "Google Calendar custom catalog (catalogId: 'google-calendar') and return the user's",
  'interaction. Use this for event lists / agendas — it renders events with the same',
  'styling as the native panel.',
  '',
  'ALWAYS call get_ui_catalog first to get the component catalog and authoring rules.',
  '',
  'ARGUMENT: { spec: { surfaceId: string, components: Component[] } } — A2UI 0.9.',
  'components is a FLAT array; each is { "id": "<unique>", "component": "<Type>", ...props }.',
  'Parents reference children by id string. Exactly ONE root (id "root" or the',
  'component nothing else references).',
  '',
  'Google Calendar component types and their props (all take STATIC props — the data —',
  'NOT data-model path bindings; v1 is READ-ONLY):',
  '  EventRow  { id: string, summary: string, start: string, end: string,',
  '              allDay: boolean, timeZone?: string, location?: string,',
  '              calendarId?: string }',
  '              // start/end are RFC-3339 for timed events, date-only (YYYY-MM-DD) for all-day',
  '              // calendarId (optional) is the owning calendar — set it ONLY when you also',
  '              //   pass EventList.calendars, so the chip is colored by that calendar',
  '  EventList { events: EventRow-props[],  // an array of the EventRow prop objects',
  '              timeMin?: string, timeMax?: string, hasMore?: boolean,',
  '              calendars?: { id: string, summary: string,',
  '                            colorToken: "blue"|"green"|"purple"|"red"|"amber"|"gray"',
  '                                       |"teal"|"cyan"|"indigo"|"magenta"|"pink"|"olive",',
  '                            selected?: boolean, primary?: boolean }[] }',
  '              // renders the month grid; owns its empty state. Pass calendars[] for a',
  '              //   SHARED / multi-calendar agenda: it renders a per-calendar legend the',
  '              //   user can toggle and colors each event by its owning calendar (match',
  '              //   each event\'s calendarId to a calendars[].id). colorToken is a bounded',
  '              //   token NAME (never a raw hex). Omit calendars[] for a single-calendar view.',
  '  Notice    { noticeKind: "success"|"error", message: string }',
  '              // a colored inline message (e.g. a recoverable read failure)',
  '',
  'Use Column/Row only if you need to group; otherwise emit EventList directly as the',
  'root. Most agendas are a single EventList with "id": "root".',
  '',
  'Example (an agenda):',
  '{ "surfaceId": "gcal-week", "components": [',
  '  { "id": "root", "component": "EventList", "timeMin": "2026-06-15T00:00:00Z",',
  '    "timeMax": "2026-06-22T00:00:00Z", "events": [',
  '    { "id": "e1", "summary": "Standup", "start": "2026-06-16T09:00:00-07:00",',
  '      "end": "2026-06-16T09:15:00-07:00", "allDay": false } ] } ] }',
  '',
  'Resolves with the user action, or an explicit cancellation if dismissed.',
  '',
  '════ REFRESHABLE DATA — compose the agenda, declare ONE BINDING per data container ════',
  'When a container DISPLAYS live Calendar data you just fetched (an EventList), pass the',
  'events you fetched as ORDINARY LITERAL props ("events" on EventList) — those literals',
  'become the first-paint SEED and the surface shows them instantly. To make a container',
  'REFRESHABLE (the panel refresh control re-fetches + repaints it in place, no agent',
  'round-trip), declare ONE binding for it. You do NOT author any "{ path }" data binding',
  'yourself — cosmos rewrites each bound container\'s data prop to a refreshable path for you.',
  '',
  'BINDINGS is the primary way: pass "bindings": one entry per data-bearing container —',
  '  { "componentId": "<the container\'s id>",',
  '    "descriptor": { "dataSource": "listEvents",',
  '      "query": { "timeMin": "...", "timeMax": "...", "cursor"?: "..." } } }.',
  'The descriptor is the SAME read you performed; query holds only NON-SECRET params (the',
  'time window + optional cursor) — NEVER a token (cosmos attaches the token only in main',
  'at refresh). IMPORTANT: "dataSource" is the ADAPTER SOURCE id — EXACTLY "listEvents" —',
  'NOT the MCP read-tool name "google_calendar_list_events". Using the tool name makes the',
  'surface non-refreshable. cosmos KEEPS your custom spec and refreshes it IN PLACE.',
  '',
  '"descriptor": { "dataSource": "listEvents", "query": { ... } } is the DEGENERATE',
  'single-binding form — one surface-wide fetcher for a surface with a single data container.',
  'Use "descriptor" for one region, "bindings" for many — NEVER pass both; if both are',
  'present bindings wins.',
  `You MAY also bind the shared flags ("${AdapterFlagPath.loading}", "${AdapterFlagPath.hasMore}", "${AdapterFlagPath.error}"). Mint a UNIQUE`,
  'surfaceId per surface. Omit all bindings ONLY for a purely static surface with no live data.',
  '',
  'Example (refreshable agenda — literal seed rows + ONE binding):',
  '{ "spec": { "surfaceId": "gcal-week-1", "components": [',
  '    { "id": "root", "component": "EventList", "events": [',
  '      { "id": "e1", "summary": "Standup", "start": "2026-06-16T09:00:00-07:00",',
  '        "end": "2026-06-16T09:15:00-07:00", "allDay": false } ] } ] },',
  '  "bindings": [ { "componentId": "root",',
  '      "descriptor": { "dataSource": "listEvents",',
  '        "query": { "timeMin": "2026-06-15T00:00:00Z", "timeMax": "2026-06-22T00:00:00Z" } } } ] }'
].join('\n')

/** The valid Google Calendar `dataSource` ids: the adapter source ids, NOT the read-tool names. */
const VALID_DATA_SOURCES: readonly string[] = Object.values(GoogleCalendarAdapterSource)

/**
 * Optional secret-free refresh descriptor schema. `dataSource` is CONSTRAINED to the
 * Google Calendar adapter source ids (`listEvents`) so a read-tool-name value
 * (`google_calendar_list_events`) is rejected AT the render tool.
 */
const DESCRIPTOR_SCHEMA = z
  .object({
    dataSource: z.string().refine((s) => VALID_DATA_SOURCES.includes(s), {
      message: `dataSource must be one of: ${VALID_DATA_SOURCES.join(', ')} — the adapter source id, NOT the MCP read-tool name (e.g. google_calendar_list_events).`
    }),
    query: z.record(z.unknown())
  })
  .passthrough()

/**
 * Optional per-container bindings schema: one `{ componentId, descriptor }` per
 * data-bearing container. Main rebinds + registers each region.
 */
const BINDINGS_SCHEMA = z.array(
  z.object({ componentId: z.string(), descriptor: DESCRIPTOR_SCHEMA })
)

/** Human-readable summary of the resolved action for the text tool result. */
function describeAction(action: A2uiAction): string {
  if (action.type === 'cancel') {
    return 'The user dismissed the Google Calendar UI without acting (cancelled).'
  }
  const id = action.actionId ? ` "${action.actionId}"` : ''
  const values = action.values ? ` with values ${JSON.stringify(action.values)}` : ''
  return `The user activated control${id}${values}.`
}

async function main(): Promise<void> {
  const bridge = new BridgeClient(resolveSocketPath())
  const enforcer = new BindingsFirstEnforcer()
  const server = new McpServer({ name: 'cosmos-google-calendar-render-ui', version: '0.1.0' })

  // ui-catalog-pull-spinner-signal-v1 (FR-001/FR-002): shared `get_ui_catalog` — pull fires the
  // begin-signal for THIS server's target ('google-calendar'). Byte-identical helper; best-effort.
  registerGetUiCatalogTool(server, {
    onGenerating: () => void bridge.notifyGenerating('google-calendar')
  })

  server.registerTool(
    'render_google_calendar_ui',
    {
      title: 'Render Google Calendar UI',
      description: GOOGLE_CALENDAR_TOOL_DESCRIPTION,
      inputSchema: {
        spec: z
          .object({
            surfaceId: z.string(),
            components: z.array(z.unknown())
          })
          .passthrough(),
        descriptor: DESCRIPTOR_SCHEMA.optional(),
        bindings: BINDINGS_SCHEMA.optional()
      }
    },
    async ({ spec, descriptor, bindings }) => {
      const valid = validateSurfaceUpdate(spec)
      if (!valid) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'render_google_calendar_ui error: the provided spec is not a valid A2UI surfaceUpdate (needs a non-empty "surfaceId" and a "components" array).'
            }
          ]
        }
      }

      const decision = enforcer.evaluate({
        spec: valid,
        hasDescriptor: descriptor !== undefined,
        hasBindings: bindings !== undefined
      })
      if (decision.reject) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: `render_google_calendar_ui error: ${decision.message}` }
          ]
        }
      }

      const action = await bridge.render(valid, descriptor, bindings)
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
  console.error('[cosmos-google-calendar-render-ui] fatal:', err)
  process.exit(1)
})
