/**
 * Local-socket bridge protocol between the spawned MCP entry script
 * (`src/mcp/renderUiServer.ts`) and the Electron main process
 * (`src/main/uiBridge.ts`). cosmos PoC milestone 2.
 *
 * Rationale (plan Resolved Q1): `.mcp.json` stdio servers are spawned by the
 * `claude` CLI as subprocesses, so a literally in-process MCP server is not
 * reachable. The entry script is a thin stdio↔socket relay; the Electron main
 * process owns surface↔renderer IPC, `requestId` minting, and pending-call
 * state. Messages are newline-delimited JSON over a Node `net` socket — no extra
 * dependency.
 *
 * Direction legend:
 *   S->M  entry script -> main (a render_ui tool call needs a surface shown)
 *   M->S  main -> entry script (the user's resolved action, to return as result)
 */

import type { A2uiAction, A2uiSurfaceUpdate, UiRenderTarget } from './ipc'
import type { AdapterBinding, AdapterDescriptor } from './adapter'
import type { SlackOpName, SlackResult } from './slack'
import type { JiraOpName, JiraResult } from './jira'
import type { ConfluenceOpName, ConfluenceResult } from './confluence'
import type { GoogleCalendarOpName, GoogleCalendarResult } from './googleCalendar'

/**
 * Resolve the render_ui bridge socket path. Derived from the project dir so the
 * spawned entry script (which Claude Code launches with `CLAUDE_PROJECT_DIR` set)
 * and Electron main agree without configuration. Unix domain socket on macOS/Linux.
 *
 * @param projectDir absolute project root (main: `process.cwd()`; entry script:
 *   `CLAUDE_PROJECT_DIR` || `process.cwd()`).
 */
export function bridgeSocketPath(projectDir: string): string {
  // A fixed name under the project dir keeps both ends in sync. Kept short to
  // stay within the platform's sun_path limit.
  return `${projectDir}/.cosmos-render-ui.sock`
}

/**
 * Resolve the Slack bridge socket path — a sibling to {@link bridgeSocketPath}
 * (Slack integration v1, FR-018). The Slack MCP entry script connects here; main
 * threads it explicitly via `COSMOS_SLACK_BRIDGE_SOCKET`.
 */
export function slackBridgeSocketPath(projectDir: string): string {
  return `${projectDir}/.cosmos-slack.sock`
}

/**
 * Resolve the Jira bridge socket path — a sibling to the Slack/render_ui sockets
 * (Atlassian integration v1, FR-X01). The Jira MCP entry script connects here;
 * main threads it explicitly via `COSMOS_JIRA_BRIDGE_SOCKET`.
 */
export function jiraBridgeSocketPath(projectDir: string): string {
  return `${projectDir}/.cosmos-jira.sock`
}

/**
 * Resolve the Confluence bridge socket path — a fully separate sibling socket
 * (FR-X01, FR-A13). The Confluence MCP entry script connects here; main threads it
 * via `COSMOS_CONFLUENCE_BRIDGE_SOCKET`.
 */
export function confluenceBridgeSocketPath(projectDir: string): string {
  return `${projectDir}/.cosmos-confluence.sock`
}

/**
 * Resolve the Google Calendar bridge socket path — a fully separate sibling socket
 * (independent of Slack/Atlassian). The Google Calendar MCP entry script connects
 * here; main threads it via `COSMOS_GOOGLE_CALENDAR_BRIDGE_SOCKET`. Kept short to
 * stay within the platform's sun_path limit.
 */
export function googleCalendarBridgeSocketPath(projectDir: string): string {
  return `${projectDir}/.cosmos-gcal.sock`
}

/**
 * S->M. The entry script asks main to render a surface for a `render_ui` call.
 * `requestId` is the entry script's own correlation id for THIS stdio call; main
 * mints its renderer-facing `requestId` separately and maps the two, so a bad
 * renderer payload can never resolve the wrong tool call.
 */
export interface BridgeRenderRequest {
  kind: 'render'
  /** Entry-script-side correlation id for this tool call. */
  callId: string
  /** The A2UI surfaceUpdate spec passed to `render_ui`. */
  spec: A2uiSurfaceUpdate
  /**
   * Which panel should render the surface (Jira generative-UI v2, D1 / v2 FR-004,
   * FR-011). The Jira-scoped `render_jira_ui` entry script stamps `'jira'`; the
   * standard `render_ui` omits it. ABSENT ⇒ main treats it as `'generated-ui'`
   * (backward-compatible — UiBridge defaults it). Non-secret.
   */
  target?: UiRenderTarget
  /**
   * panel-refresh-v1 (OQ-1 / FR-010..013): an OPTIONAL secret-free
   * {@link AdapterDescriptor} `{ dataSource, query }` the composing agent attaches to
   * make the surface it rendered REFRESHABLE. When present + valid, main re-fetches the
   * descriptor (token attached in main), composes the matching BOUND surface, registers
   * it with the AdapterDispatcher keyed by surfaceId, and pushes THAT bound surface (so a
   * later `adapter.refresh` re-executes it in place). ABSENT or invalid ⇒ the agent's
   * literal spec renders unchanged but non-refreshable (FR-012). Secret-free by contract:
   * never a token (FR-013) — validated + secret-stripped at the main boundary.
   *
   * SINGLE-region shorthand: equivalent to a one-entry `bindings` whose container is the
   * surface's lone data component. Prefer `bindings` for a PARTITIONED layout (e.g. a
   * kanban with one descriptor per column). When both are present, `bindings` wins.
   */
  descriptor?: AdapterDescriptor
  /**
   * refreshable-custom-generative-ui (multi-region): one secret-free
   * {@link AdapterBinding} PER data-bearing container, so a CUSTOM partitioned layout (a
   * kanban's N columns, a dashboard's M panels) is refreshable container-by-container.
   * Main rewrites each named container's literal data prop to a region-scoped `{path}`
   * binding, seeds the literal as the region's first page, and registers each region with
   * the AdapterDispatcher under its own descriptor + cursor (independent refresh/pagination
   * — the user's "구분된 컴포넌트 별로 별도의 data fetcher" model). ABSENT ⇒ fall back to the
   * single-region `descriptor` (or non-refreshable). Secret-free (validated in main).
   */
  bindings?: AdapterBinding[]
}

/**
 * M->S. Main returns the resolved user interaction for a prior `render`, so the
 * entry script can return it as the MCP tool result. Always sent exactly once
 * per `callId` (submit, cancel, supersede, disconnect — FR-009).
 */
export interface BridgeResultResponse {
  kind: 'result'
  /** Echoes the `callId` from the matching BridgeRenderRequest. */
  callId: string
  /** The resolved interaction (a `cancel` covers dismiss/supersede/reload). */
  action: A2uiAction
}

/** Any message the entry script sends to main over the socket. */
export type BridgeClientMessage = BridgeRenderRequest

/** Any message main sends back to the entry script over the socket. */
export type BridgeServerMessage = BridgeResultResponse

/* ------------------------------------------------------------------------- *
 * Slack bridge frames (sibling to render_ui; Slack integration v1, FR-018)
 *
 * The Slack MCP entry script (`src/mcp/slackMcpServer.ts`) connects to
 * `src/main/slackBridge.ts`. Same NDJSON-over-socket framing as render_ui — this
 * is the spec's "registry of MCP tools" generalization: two independent bridges
 * share the framing, each owns its own pending-call state. A Slack call is
 * request/result (main forwards to SlackManager and returns the typed result);
 * there is no renderer round-trip, so main does not mint a separate id — the
 * entry script's `callId` is the only correlation id.
 * ------------------------------------------------------------------------- */

/**
 * S->M. The Slack MCP entry script asks main to run one read operation. `op`
 * selects the SlackManager read; `params` is the operation's parameter object
 * (validated at the boundary — FR-023). READ-ONLY: there is no mutate op (FR-019).
 */
export interface SlackBridgeCallRequest {
  kind: 'slack_call'
  /** Entry-script-side correlation id for this tool call. */
  callId: string
  /** Which read operation to run. */
  op: SlackOpName
  /** The operation's params (shape depends on `op`; validated in main). */
  params: Record<string, unknown>
}

/**
 * M->S. Main returns the typed `SlackResult` for a prior `slack_call`, so the
 * entry script returns it as the MCP tool result. Always sent exactly once per
 * `callId` (success, structured error, or disconnect — FR-020). Carries NO token
 * (FR-021, SC-008).
 */
export interface SlackBridgeResultResponse {
  kind: 'slack_result'
  /** Echoes the `callId` from the matching SlackBridgeCallRequest. */
  callId: string
  /** The typed read result (success data or a structured SlackError). */
  result: SlackResult<unknown>
}

/** Any message the Slack entry script sends to main over the socket. */
export type SlackBridgeClientMessage = SlackBridgeCallRequest

/** Any message main sends back to the Slack entry script over the socket. */
export type SlackBridgeServerMessage = SlackBridgeResultResponse

/* ------------------------------------------------------------------------- *
 * Jira bridge frames (sibling to Slack; Atlassian integration v1, FR-X01)
 *
 * The Jira MCP entry script (`src/mcp/jiraMcpServer.ts`) connects to
 * `src/main/jiraBridge.ts`. Same NDJSON-over-socket framing — its own pending-call
 * state, its own socket. Request/result: main forwards to JiraManager and returns
 * the typed `JiraResult`. The entry script's `callId` is the only correlation id.
 * READ-ONLY: there is no mutate op (FR-J01). Carries NO token (FR-X02, SC-009).
 * ------------------------------------------------------------------------- */

/** S->M. The Jira MCP entry script asks main to run one read operation. */
export interface JiraBridgeCallRequest {
  kind: 'jira_call'
  /** Entry-script-side correlation id for this tool call. */
  callId: string
  /** Which read operation to run. */
  op: JiraOpName
  /** The operation's params (shape depends on `op`; validated in main). */
  params: Record<string, unknown>
}

/** M->S. Main returns the typed `JiraResult` for a prior `jira_call`. NO token. */
export interface JiraBridgeResultResponse {
  kind: 'jira_result'
  /** Echoes the `callId` from the matching JiraBridgeCallRequest. */
  callId: string
  /** The typed read result (success data or a structured JiraError). */
  result: JiraResult<unknown>
}

/** Any message the Jira entry script sends to main over the socket. */
export type JiraBridgeClientMessage = JiraBridgeCallRequest

/** Any message main sends back to the Jira entry script over the socket. */
export type JiraBridgeServerMessage = JiraBridgeResultResponse

/* ------------------------------------------------------------------------- *
 * Confluence bridge frames (fully separate sibling; FR-X01, FR-A13)
 *
 * The Confluence MCP entry script (`src/mcp/confluenceMcpServer.ts`) connects to
 * `src/main/confluenceBridge.ts`. Independent socket + pending-call state from
 * Jira. READ-ONLY (FR-C01). Carries NO token (FR-X02, SC-009).
 * ------------------------------------------------------------------------- */

/** S->M. The Confluence MCP entry script asks main to run one read operation. */
export interface ConfluenceBridgeCallRequest {
  kind: 'confluence_call'
  /** Entry-script-side correlation id for this tool call. */
  callId: string
  /** Which read operation to run. */
  op: ConfluenceOpName
  /** The operation's params (shape depends on `op`; validated in main). */
  params: Record<string, unknown>
}

/** M->S. Main returns the typed `ConfluenceResult` for a prior call. NO token. */
export interface ConfluenceBridgeResultResponse {
  kind: 'confluence_result'
  /** Echoes the `callId` from the matching ConfluenceBridgeCallRequest. */
  callId: string
  /** The typed read result (success data or a structured ConfluenceError). */
  result: ConfluenceResult<unknown>
}

/** Any message the Confluence entry script sends to main over the socket. */
export type ConfluenceBridgeClientMessage = ConfluenceBridgeCallRequest

/** Any message main sends back to the Confluence entry script over the socket. */
export type ConfluenceBridgeServerMessage = ConfluenceBridgeResultResponse

/* ------------------------------------------------------------------------- *
 * Google Calendar bridge frames (fully separate sibling; read-only v1)
 *
 * The Google Calendar MCP entry script (`src/mcp/googleCalendarMcpServer.ts`)
 * connects to `src/main/googleCalendarBridge.ts`. Independent socket + pending-call
 * state. READ-ONLY (v1). Carries NO token.
 * ------------------------------------------------------------------------- */

/** S->M. The Google Calendar MCP entry script asks main to run one read operation. */
export interface GoogleCalendarBridgeCallRequest {
  kind: 'google_cal_call'
  /** Entry-script-side correlation id for this tool call. */
  callId: string
  /** Which read operation to run. */
  op: GoogleCalendarOpName
  /** The operation's params (shape depends on `op`; validated in main). */
  params: Record<string, unknown>
}

/** M->S. Main returns the typed `GoogleCalendarResult` for a prior call. NO token. */
export interface GoogleCalendarBridgeResultResponse {
  kind: 'google_cal_result'
  /** Echoes the `callId` from the matching GoogleCalendarBridgeCallRequest. */
  callId: string
  /** The typed read result (success data or a structured GoogleCalendarError). */
  result: GoogleCalendarResult<unknown>
}

/** Any message the Google Calendar entry script sends to main over the socket. */
export type GoogleCalendarBridgeClientMessage = GoogleCalendarBridgeCallRequest

/** Any message main sends back to the Google Calendar entry script over the socket. */
export type GoogleCalendarBridgeServerMessage = GoogleCalendarBridgeResultResponse

/** Serialize a bridge message as one newline-delimited JSON frame. */
export function encodeBridgeMessage(
  message:
    | BridgeClientMessage
    | BridgeServerMessage
    | SlackBridgeClientMessage
    | SlackBridgeServerMessage
    | JiraBridgeClientMessage
    | JiraBridgeServerMessage
    | ConfluenceBridgeClientMessage
    | ConfluenceBridgeServerMessage
    | GoogleCalendarBridgeClientMessage
    | GoogleCalendarBridgeServerMessage
): string {
  return `${JSON.stringify(message)}\n`
}
