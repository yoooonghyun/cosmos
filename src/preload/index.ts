/**
 * Preload — cosmos PoC milestone 1 (Terminal Panel).
 *
 * FR-006: the ONLY main-process surface exposed to the renderer is the PTY IPC
 * channels, via `contextBridge`. No `ipcRenderer` and no Node APIs leak through.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  AgentChannel,
  ConfluenceChannelName,
  JiraChannelName,
  PtyChannel,
  SlackChannelName,
  UiChannel,
  type AgentApi,
  type AgentStatusPayload,
  type AgentSubmitPayload,
  type ConfluenceApi,
  type CosmosApi,
  type JiraApi,
  type PtyApi,
  type PtyDataPayload,
  type PtyExitPayload,
  type PtyInputPayload,
  type PtyResizePayload,
  type SlackApi,
  type UiApi,
  type UiActionPayload,
  type UiRenderPayload
} from '../shared/ipc'
import type {
  SlackConnectionStatus,
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackRepliesParams,
  SlackSearchParams
} from '../shared/slack'
import type {
  JiraConnectionStatus,
  JiraGetIssueParams,
  JiraSearchParams
} from '../shared/jira'
import type {
  ConfluenceConnectionStatus,
  ConfluenceGetPageParams,
  ConfluenceSearchParams
} from '../shared/confluence'

const ptyApi: PtyApi = {
  // panel-tabs v1 FR-021/FR-022: spawn a new pane's PTY session (renderer mints
  // the per-tab paneId). The single PTY is no longer auto-started in main.
  start(paneId: string): void {
    ipcRenderer.send(PtyChannel.Start, { paneId })
  },
  sendInput(payload: PtyInputPayload): void {
    ipcRenderer.send(PtyChannel.Input, payload)
  },
  resize(payload: PtyResizePayload): void {
    ipcRenderer.send(PtyChannel.Resize, payload)
  },
  // FR-008 (panel-tabs v1 FR-026): restart only the addressed pane's session.
  restart(paneId: string): void {
    ipcRenderer.send(PtyChannel.Restart, { paneId })
  },
  // panel-tabs v1 FR-023: dispose/kill the addressed pane's PTY on tab close.
  dispose(paneId: string): void {
    ipcRenderer.send(PtyChannel.Dispose, { paneId })
  },
  onData(listener: (payload: PtyDataPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: PtyDataPayload): void =>
      listener(payload)
    ipcRenderer.on(PtyChannel.Data, handler)
    return () => ipcRenderer.removeListener(PtyChannel.Data, handler)
  },
  onExit(listener: (payload: PtyExitPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: PtyExitPayload): void =>
      listener(payload)
    ipcRenderer.on(PtyChannel.Exit, handler)
    return () => ipcRenderer.removeListener(PtyChannel.Exit, handler)
  }
}

// FR-011: the Generated-UI surface is exposed ONLY through this dedicated
// `window.cosmos.ui` channel set, alongside (not merged into) the pty surface.
const uiApi: UiApi = {
  onRender(listener: (payload: UiRenderPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: UiRenderPayload): void =>
      listener(payload)
    ipcRenderer.on(UiChannel.Render, handler)
    return () => ipcRenderer.removeListener(UiChannel.Render, handler)
  },
  sendAction(payload: UiActionPayload): void {
    ipcRenderer.send(UiChannel.Action, payload)
  }
}

// FR-007/FR-024: the Slack capability reaches the renderer ONLY through this
// dedicated `window.cosmos.slack` channel set. The reads are request/response via
// `invoke`; `onStatusChanged` is a fire-and-forget M->R subscription. NO method
// takes or returns a token (FR-006, SC-008).
const slackApi: SlackApi = {
  getStatus(): Promise<SlackConnectionStatus> {
    return ipcRenderer.invoke(SlackChannelName.GetStatus)
  },
  connect(): Promise<SlackConnectionStatus> {
    return ipcRenderer.invoke(SlackChannelName.Connect)
  },
  disconnect(): Promise<SlackConnectionStatus> {
    return ipcRenderer.invoke(SlackChannelName.Disconnect)
  },
  listChannels(params: SlackListChannelsParams) {
    return ipcRenderer.invoke(SlackChannelName.ListChannels, params)
  },
  getHistory(params: SlackHistoryParams) {
    return ipcRenderer.invoke(SlackChannelName.GetHistory, params)
  },
  getReplies(params: SlackRepliesParams) {
    return ipcRenderer.invoke(SlackChannelName.GetReplies, params)
  },
  search(params: SlackSearchParams) {
    return ipcRenderer.invoke(SlackChannelName.Search, params)
  },
  getUser(params: SlackGetUserParams) {
    return ipcRenderer.invoke(SlackChannelName.GetUser, params)
  },
  onStatusChanged(listener: (status: SlackConnectionStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: SlackConnectionStatus): void =>
      listener(status)
    ipcRenderer.on(SlackChannelName.StatusChanged, handler)
    return () => ipcRenderer.removeListener(SlackChannelName.StatusChanged, handler)
  }
}

// FR-A12: the Jira capability reaches the renderer ONLY through this dedicated
// `window.cosmos.jira` channel set — fully separate from `slack`/`confluence`.
// Reads are request/response via `invoke`; `onStatusChanged` is a fire-and-forget
// M->R subscription. NO method takes or returns a token (FR-A11, SC-009).
const jiraApi: JiraApi = {
  getStatus(): Promise<JiraConnectionStatus> {
    return ipcRenderer.invoke(JiraChannelName.GetStatus)
  },
  connect(): Promise<JiraConnectionStatus> {
    return ipcRenderer.invoke(JiraChannelName.Connect)
  },
  disconnect(): Promise<JiraConnectionStatus> {
    return ipcRenderer.invoke(JiraChannelName.Disconnect)
  },
  searchIssues(params: JiraSearchParams) {
    return ipcRenderer.invoke(JiraChannelName.SearchIssues, params)
  },
  getIssue(params: JiraGetIssueParams) {
    return ipcRenderer.invoke(JiraChannelName.GetIssue, params)
  },
  // Jira generative-UI v2 (D4 / v2 FR-019): fire-and-forget R->M signal that the
  // Jira panel just became active; main runs ONE bounded recent-issues read and
  // pushes the default-view surface (`target: 'jira'`). No payload, no return.
  requestDefaultView(): void {
    // Send an explicit empty object so main's boundary validator (which requires an
    // object) accepts the trigger; the payload carries no field (D4 / v2 FR-002).
    ipcRenderer.send(JiraChannelName.RequestDefaultView, {})
  },
  onStatusChanged(listener: (status: JiraConnectionStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: JiraConnectionStatus): void =>
      listener(status)
    ipcRenderer.on(JiraChannelName.StatusChanged, handler)
    return () => ipcRenderer.removeListener(JiraChannelName.StatusChanged, handler)
  }
}

// FR-A12/FR-A13: the Confluence capability reaches the renderer ONLY through this
// dedicated `window.cosmos.confluence` channel set — an independent connection from
// Jira. NO method takes or returns a token (FR-A11, SC-009).
const confluenceApi: ConfluenceApi = {
  getStatus(): Promise<ConfluenceConnectionStatus> {
    return ipcRenderer.invoke(ConfluenceChannelName.GetStatus)
  },
  connect(): Promise<ConfluenceConnectionStatus> {
    return ipcRenderer.invoke(ConfluenceChannelName.Connect)
  },
  disconnect(): Promise<ConfluenceConnectionStatus> {
    return ipcRenderer.invoke(ConfluenceChannelName.Disconnect)
  },
  searchContent(params: ConfluenceSearchParams) {
    return ipcRenderer.invoke(ConfluenceChannelName.SearchContent, params)
  },
  getPage(params: ConfluenceGetPageParams) {
    return ipcRenderer.invoke(ConfluenceChannelName.GetPage, params)
  },
  onStatusChanged(listener: (status: ConfluenceConnectionStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: ConfluenceConnectionStatus): void =>
      listener(status)
    ipcRenderer.on(ConfluenceChannelName.StatusChanged, handler)
    return () => ipcRenderer.removeListener(ConfluenceChannelName.StatusChanged, handler)
  }
}

// FR-009: the headless agent runner reaches the renderer ONLY through this
// dedicated `window.cosmos.agent` channel set, alongside (not merged into) the
// pty/ui/slack/jira/confluence surfaces. The renderer sends only the utterance
// string and receives only run status (no tokens/secrets/transcript — FR-011).
const agentApi: AgentApi = {
  submit(payload: AgentSubmitPayload): void {
    ipcRenderer.send(AgentChannel.Submit, payload)
  },
  onStatus(listener: (payload: AgentStatusPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: AgentStatusPayload): void =>
      listener(payload)
    ipcRenderer.on(AgentChannel.Status, handler)
    return () => ipcRenderer.removeListener(AgentChannel.Status, handler)
  }
}

const api: CosmosApi = {
  pty: ptyApi,
  ui: uiApi,
  slack: slackApi,
  jira: jiraApi,
  confluence: confluenceApi,
  agent: agentApi
}

contextBridge.exposeInMainWorld('cosmos', api)
