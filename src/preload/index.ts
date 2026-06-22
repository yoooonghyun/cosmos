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
  FsChannel,
  GoogleCalendarChannelName,
  JiraChannelName,
  PtyChannel,
  SessionChannel,
  SettingsChannelName,
  ShortcutChannel,
  SlackChannelName,
  UiChannel,
  type AgentApi,
  type AgentStatusPayload,
  type AgentSubmitPayload,
  type ConfluenceApi,
  type CosmosApi,
  type FsApi,
  type FsChangedPayload,
  type FsListResult,
  type FsReadResult,
  type GoogleCalendarApi,
  type GoogleCalendarRequestDefaultViewPayload,
  type JiraApi,
  type JiraRequestIssueDetailPayload,
  type JiraRequestSearchViewPayload,
  type PtyApi,
  type PtyDataPayload,
  type PtyExitPayload,
  type PtyInputPayload,
  type PtyPickDirectoryResult,
  type PtyResizePayload,
  type ClientConfigClearPayload,
  type ClientConfigSavePayload,
  type ClientConfigSaveResult,
  type ClientConfigStatus,
  type SessionApi,
  type SessionSnapshot,
  type SettingsApi,
  type ShortcutApi,
  type ShortcutTriggerPayload,
  type SlackApi,
  type UiApi,
  type UiActionPayload,
  type UiDataModelPayload,
  type UiGeneratingBeginPayload,
  type UiRenderPayload
} from '../shared/ipc'
import type {
  SlackConnectionStatus,
  SlackGetUserParams,
  SlackHistoryParams,
  SlackListChannelsParams,
  SlackRepliesParams,
  SlackSearchParams,
  SlackSendParams
} from '../shared/slack'
import type {
  JiraConnectionStatus,
  JiraGetIssueParams,
  JiraSearchParams
} from '../shared/jira'
import type {
  ConfluenceConnectionStatus,
  ConfluenceDefaultFeedParams,
  ConfluenceGetPageParams,
  ConfluenceSearchParams
} from '../shared/confluence'
import type {
  GoogleCalendarConnectionStatus,
  GoogleCalendarListEventsParams
} from '../shared/googleCalendar'

const ptyApi: PtyApi = {
  // panel-tabs v1 FR-021/FR-022: spawn a new pane's PTY session (renderer mints
  // the per-tab paneId). The single PTY is no longer auto-started in main.
  // terminal-open-directory-picker-v1 FR-004: forward an OPTIONAL chosen `cwd` for a
  // freshly-picked tab; omitted entirely on the restore/normal path.
  start(paneId: string, opts?: { cwd?: string }): void {
    ipcRenderer.send(PtyChannel.Start, opts?.cwd ? { paneId, cwd: opts.cwd } : { paneId })
  },
  // terminal-open-directory-picker-v1 FR-002/FR-003: open the native OS directory
  // picker in MAIN and resolve with the chosen path (or null on cancel). NEW preload
  // method — requires a full `npm run dev` restart; HMR won't expose it live.
  pickDirectory(): Promise<PtyPickDirectoryResult> {
    return ipcRenderer.invoke(PtyChannel.PickDirectory)
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
  },
  // jira-generative-adapter-v1 FR-009/FR-010: data-only updates for a bound
  // surface (createSurface/updateComponents stay on onRender). NEW preload method
  // — requires a full `npm run dev` restart; HMR won't expose it live.
  onDataModel(listener: (payload: UiDataModelPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: UiDataModelPayload): void =>
      listener(payload)
    ipcRenderer.on(UiChannel.DataModel, handler)
    return () => ipcRenderer.removeListener(UiChannel.DataModel, handler)
  },
  // ui-catalog-pull-spinner-signal-v1 (FR-004/FR-005): the EARLY "UI generation has begun"
  // begin-signal (a `get_ui_catalog` pull) — the panel turns the originating tab's spinner
  // ON. NEW preload method — requires a full `npm run dev` restart; HMR won't expose it live.
  onGeneratingBegin(listener: (payload: UiGeneratingBeginPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: UiGeneratingBeginPayload): void =>
      listener(payload)
    ipcRenderer.on(UiChannel.GeneratingBegin, handler)
    return () => ipcRenderer.removeListener(UiChannel.GeneratingBegin, handler)
  }
}

// terminal-file-explorer-v1 (FR-025/FR-026): the file explorer reaches the renderer
// ONLY through this dedicated `window.cosmos.fs` channel set. `list`/`read` are
// request/response (`invoke`); `watchStart`/`watchStop` are fire-and-forget; `onChanged`
// is an M->R subscription returning an unsubscribe fn. NO token/secret crosses this
// surface (FR-024) — only the user's own local file contents inside the chosen root.
// NEW preload methods — a full `npm run dev` restart is required; HMR won't expose them.
const fsApi: FsApi = {
  list(paneId: string, relPath: string): Promise<FsListResult> {
    return ipcRenderer.invoke(FsChannel.List, { paneId, relPath })
  },
  read(paneId: string, relPath: string): Promise<FsReadResult> {
    return ipcRenderer.invoke(FsChannel.Read, { paneId, relPath })
  },
  watchStart(paneId: string): void {
    ipcRenderer.send(FsChannel.WatchStart, { paneId })
  },
  watchStop(paneId: string): void {
    ipcRenderer.send(FsChannel.WatchStop, { paneId })
  },
  onChanged(listener: (payload: FsChangedPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: FsChangedPayload): void =>
      listener(payload)
    ipcRenderer.on(FsChannel.Changed, handler)
    return () => ipcRenderer.removeListener(FsChannel.Changed, handler)
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
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent). NEW preload
  // method — requires a full `npm run dev` restart; HMR won't expose it live.
  cancelConnect(): Promise<SlackConnectionStatus> {
    return ipcRenderer.invoke(SlackChannelName.CancelConnect)
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
  sendMessage(params: SlackSendParams) {
    return ipcRenderer.invoke(SlackChannelName.Send, params)
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
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent). NEW preload
  // method — requires a full `npm run dev` restart; HMR won't expose it live.
  cancelConnect(): Promise<JiraConnectionStatus> {
    return ipcRenderer.invoke(JiraChannelName.CancelConnect)
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
  // jira-jql-search-v1 (FR-003): fire-and-forget R->M signal carrying the raw JQL the
  // user submitted in the native search box; main trims + does empty⇒default and runs
  // the same read/compose/push as the default view. No payload return, no token.
  requestSearchView(payload: JiraRequestSearchViewPayload): void {
    ipcRenderer.send(JiraChannelName.RequestSearchView, payload)
  },
  // jira-ticket-detail-v1 (FR-003/FR-010): fire-and-forget R->M signal carrying the
  // clicked ticket's key; main runs the deterministic `getIssue` read and pushes the
  // composed detail surface (`target: 'jira'`) into the active tab. No return, no token.
  requestIssueDetail(payload: JiraRequestIssueDetailPayload): void {
    ipcRenderer.send(JiraChannelName.RequestIssueDetail, payload)
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
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent). NEW preload
  // method — requires a full `npm run dev` restart; HMR won't expose it live.
  cancelConnect(): Promise<ConfluenceConnectionStatus> {
    return ipcRenderer.invoke(ConfluenceChannelName.CancelConnect)
  },
  searchContent(params: ConfluenceSearchParams) {
    return ipcRenderer.invoke(ConfluenceChannelName.SearchContent, params)
  },
  defaultFeed(params: ConfluenceDefaultFeedParams) {
    return ipcRenderer.invoke(ConfluenceChannelName.DefaultFeed, params)
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

// google-calendar-v1 (Track A): the Google Calendar capability reaches the renderer
// ONLY through this dedicated `window.cosmos.googleCalendar` channel set — an
// independent connection from Slack/Atlassian. Reads are request/response via `invoke`;
// `onStatusChanged` is a fire-and-forget M->R subscription. READ-ONLY — no write method;
// NO method takes or returns a token (SC-009).
const googleCalendarApi: GoogleCalendarApi = {
  getStatus(): Promise<GoogleCalendarConnectionStatus> {
    return ipcRenderer.invoke(GoogleCalendarChannelName.GetStatus)
  },
  connect(): Promise<GoogleCalendarConnectionStatus> {
    return ipcRenderer.invoke(GoogleCalendarChannelName.Connect)
  },
  disconnect(): Promise<GoogleCalendarConnectionStatus> {
    return ipcRenderer.invoke(GoogleCalendarChannelName.Disconnect)
  },
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent). NEW preload
  // method — requires a full `npm run dev` restart; HMR won't expose it live.
  cancelConnect(): Promise<GoogleCalendarConnectionStatus> {
    return ipcRenderer.invoke(GoogleCalendarChannelName.CancelConnect)
  },
  listEvents(params: GoogleCalendarListEventsParams) {
    return ipcRenderer.invoke(GoogleCalendarChannelName.ListEvents, params)
  },
  // Fire-and-forget R->M signal that the Google Calendar panel wants the default-view
  // surface (`target: 'google-calendar'`). With no arg main reads the CURRENT month; with
  // an optional `{ year, month }` (1-based) the panel navigates to that month
  // (calendar-month-year-nav-v1). Always send an OBJECT (the supplied params, else `{}`)
  // so main's boundary validator (which requires an object) accepts the trigger.
  requestDefaultView(params?: GoogleCalendarRequestDefaultViewPayload): void {
    ipcRenderer.send(GoogleCalendarChannelName.RequestDefaultView, params ?? {})
  },
  onStatusChanged(listener: (status: GoogleCalendarConnectionStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: GoogleCalendarConnectionStatus): void =>
      listener(status)
    ipcRenderer.on(GoogleCalendarChannelName.StatusChanged, handler)
    return () => ipcRenderer.removeListener(GoogleCalendarChannelName.StatusChanged, handler)
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

// session-persistence-v1 (FR-003): the persisted-session surface reaches the
// renderer ONLY through this dedicated `window.cosmos.session` channel set. `load`
// is request/response (`invoke`) read once at startup; `save` is fire-and-forget.
// The snapshot is non-secret structure — no token/secret crosses this surface (FR-006).
const sessionApi: SessionApi = {
  load(): Promise<SessionSnapshot | null> {
    return ipcRenderer.invoke(SessionChannel.Load)
  },
  save(snapshot: SessionSnapshot): void {
    ipcRenderer.send(SessionChannel.Save, snapshot)
  }
}

// Global tab/window shortcuts: receive-only in the renderer. Main matches the key
// combo (via `before-input-event`) and forwards the resolved command here.
const shortcutApi: ShortcutApi = {
  onTrigger(listener: (payload: ShortcutTriggerPayload) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: ShortcutTriggerPayload): void =>
      listener(payload)
    ipcRenderer.on(ShortcutChannel.Trigger, handler)
    return () => ipcRenderer.removeListener(ShortcutChannel.Trigger, handler)
  }
}

// settings-oauth-clients-v1 (FR-004/FR-007/FR-008): the OAuth client-config surface
// reaches the renderer ONLY through this dedicated `window.cosmos.settings` channel
// set. All three calls are request/response (`invoke`). The renderer learns only the
// renderer-safe status (secretConfigured boolean, never the secret value) — no token
// or secret crosses this surface (FR-006). NEW preload methods: a full `npm run dev`
// restart is required; HMR won't expose them live.
const settingsApi: SettingsApi = {
  getConfig(): Promise<ClientConfigStatus> {
    return ipcRenderer.invoke(SettingsChannelName.GetConfig)
  },
  save(payload: ClientConfigSavePayload): Promise<ClientConfigSaveResult> {
    return ipcRenderer.invoke(SettingsChannelName.Save, payload)
  },
  clearField(payload: ClientConfigClearPayload): Promise<ClientConfigSaveResult> {
    return ipcRenderer.invoke(SettingsChannelName.ClearField, payload)
  }
}

const api: CosmosApi = {
  pty: ptyApi,
  fs: fsApi,
  ui: uiApi,
  slack: slackApi,
  jira: jiraApi,
  confluence: confluenceApi,
  googleCalendar: googleCalendarApi,
  agent: agentApi,
  shortcuts: shortcutApi,
  session: sessionApi,
  settings: settingsApi
}

contextBridge.exposeInMainWorld('cosmos', api)
