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

import type { A2uiAction, A2uiSurfaceUpdate } from './ipc'

/**
 * Resolve the bridge socket path. Derived from the project dir so the spawned
 * entry script (which Claude Code launches with `CLAUDE_PROJECT_DIR` set) and
 * Electron main agree without configuration. Unix domain socket on macOS/Linux.
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

/** Serialize a bridge message as one newline-delimited JSON frame. */
export function encodeBridgeMessage(
  message: BridgeClientMessage | BridgeServerMessage
): string {
  return `${JSON.stringify(message)}\n`
}
