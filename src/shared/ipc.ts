/**
 * Shared IPC contract (cosmos) — the single authoritative typed contract surface.
 *
 * This module is the single source of truth for the channel names and payload
 * types exchanged between the Electron main process and the renderer, bridged by
 * the preload `contextBridge`. It is now a thin **barrel** that re-exports the
 * per-domain contract modules under `src/shared/ipc/` — the contract is physically
 * split per domain (so parallel feature work edits independent files) but logically
 * single and authoritative (every consumer keeps importing from `'../shared/ipc'`,
 * unchanged). NO channel wire string, payload shape, or exported name changes when a
 * symbol moves into its domain module.
 *
 * Milestone 1 (Terminal Panel): every Pty* type traces to an FR in
 * .sdd/specs/terminal-panel-v1.md.
 * Milestone 2 (render_ui MCP + Generated-UI panel): every Ui and A2ui type
 * traces to an FR in .sdd/specs/render-ui-v1.md.
 * No field exists that a spec does not require.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 *
 * Barrel-leaf rule (developer note): nothing inside `src/shared/ipc/` imports this
 * barrel — domain modules import each other and `./ipc/common` by their direct paths.
 * The barrel exists solely for external consumers, so it cannot participate in a cycle.
 */

export * from './ipc/common'
export * from './ipc/pty'
export * from './ipc/fs'
export * from './ipc/ui'
export * from './ipc/agent'
export * from './ipc/shortcut'
export * from './ipc/slack'
export * from './ipc/jira'
export * from './ipc/confluence'
export * from './ipc/googleCalendar'
export * from './ipc/session'
export * from './ipc/settings'
export * from './ipc/conversation'

import type { PtyApi } from './ipc/pty'
import type { FsApi } from './ipc/fs'
import type { UiApi } from './ipc/ui'
import type { SlackApi } from './ipc/slack'
import type { JiraApi } from './ipc/jira'
import type { ConfluenceApi } from './ipc/confluence'
import type { GoogleCalendarApi } from './ipc/googleCalendar'
import type { AgentApi } from './ipc/agent'
import type { ShortcutApi } from './ipc/shortcut'
import type { SessionApi } from './ipc/session'
import type { SettingsApi } from './ipc/settings'
import type { ConversationApi } from './ipc/conversation'

/** Shape attached to `window` by the preload. */
export interface CosmosApi {
  pty: PtyApi
  fs: FsApi
  ui: UiApi
  slack: SlackApi
  jira: JiraApi
  confluence: ConfluenceApi
  googleCalendar: GoogleCalendarApi
  agent: AgentApi
  shortcuts: ShortcutApi
  session: SessionApi
  settings: SettingsApi
  conversation: ConversationApi
}
