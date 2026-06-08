/**
 * Electron main entry — cosmos PoC milestone 1 (Terminal Panel).
 *
 * Creates a secure BrowserWindow (FR-006), wires ipcMain handlers to the
 * PtyManager, validates inbound payloads (FR-010), and tears the PTY down
 * cleanly on reload / quit so it is never orphaned (edge case).
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AgentChannel,
  ConfluenceChannelName,
  JiraChannelName,
  PtyChannel,
  SessionChannel,
  ShortcutChannel,
  SlackChannelName,
  UiChannel,
  type AgentStatusPayload,
  type SessionSnapshot,
  type UiRenderPayload
} from '../shared/ipc'
import { matchShortcut } from './shortcutMatch'
import type { SlackConnectionStatus } from '../shared/slack'
import type { JiraConnectionStatus } from '../shared/jira'
import type { ConfluenceConnectionStatus } from '../shared/confluence'
import {
  confluenceBridgeSocketPath,
  jiraBridgeSocketPath,
  slackBridgeSocketPath
} from '../shared/bridge'
import {
  validateAgentPrompt,
  validateConfluenceDefaultFeed,
  validateConfluenceGetPage,
  validateConfluenceSearch,
  validateDispose,
  validateInput,
  validateJiraGetIssue,
  validateJiraSearch,
  validateRequestDefaultView,
  validateRequestIssueDetail,
  validateRequestSearchView,
  validateResize,
  validateRestart,
  validateSlackGetUser,
  validateSlackHistory,
  validateSlackListChannels,
  validateSlackReplies,
  validateSlackSearch,
  validateStart,
  validateUiAction
} from '../shared/validate'
import { PtyManager } from './ptyManager'
import { SessionStore } from './sessionStore'
import { validateSnapshot } from './sessionSnapshot'
import { AgentRunner } from './agentRunner'
import {
  CONFLUENCE_RENDER_UI_SERVER_NAME,
  JIRA_RENDER_UI_SERVER_NAME,
  SLACK_RENDER_UI_SERVER_NAME,
  confluenceRenderUiMcpServerEntry,
  jiraRenderUiMcpServerEntry,
  renderUiMcpServerEntry,
  slackRenderUiMcpServerEntry
} from './mcpConfig'
import { UiBridge } from './uiBridge'
import { SlackBridge } from './slackBridge'
import { SlackManager } from './slackManager'
import { SlackClient } from './integrations/slackClient'
import { TokenStore } from './integrations/tokenStore'
import { runSlackOAuth } from './integrations/slackOAuth'
import { JiraBridge } from './jiraBridge'
import { JiraManager } from './jiraManager'
import { JiraActionDispatcher } from './jiraActionDispatcher'
import { buildDefaultViewSurface, buildIssueDetailSurface, buildNoticeSurface } from './jiraSurfaceBuilder'
import { JiraClient } from './integrations/jiraClient'
import { ConfluenceBridge } from './confluenceBridge'
import { ConfluenceManager } from './confluenceManager'
import { ConfluenceClient } from './integrations/confluenceClient'
import {
  refreshAtlassianToken,
  runAtlassianOAuth
} from './integrations/atlassianOAuth'
import { CONFLUENCE_OAUTH_SCOPES, JIRA_OAUTH_SCOPES } from './integrations/atlassianConfig'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load local `.env` (gitignored) into process.env so runtime config like
// COSMOS_SLACK_CLIENT_ID is available without exporting it in the shell. No-op
// if the file is absent (e.g. CI / packaged build that injects env directly).
try {
  process.loadEnvFile(join(app.getAppPath(), '.env'))
} catch {
  // no .env present — fall back to the ambient environment
}

// The cosmos app icon (rasterized from assets/logo/cosmos-pastel.svg). Used for the
// window (Windows/Linux taskbar) and the macOS dock. Resolved from the app root so it
// works in dev; absent → fall back to the default Electron icon.
function appIconPath(): string {
  return join(app.getAppPath(), 'build', 'icon.png')
}

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let uiBridge: UiBridge | null = null
let slackManager: SlackManager | null = null
let slackBridge: SlackBridge | null = null
let jiraManager: JiraManager | null = null
let jiraBridge: JiraBridge | null = null
let jiraActionDispatcher: JiraActionDispatcher | null = null
let confluenceManager: ConfluenceManager | null = null
let confluenceBridge: ConfluenceBridge | null = null
let agentRunner: AgentRunner | null = null

/* ------------------------------------------------------------------------- *
 * session-persistence-v1 — main-owned snapshot store + terminal session map
 * ------------------------------------------------------------------------- */

let sessionStore: SessionStore | null = null

/** The resolved sandbox cwd, cached so IPC handlers can mint fresh sessions in it. */
let sandboxDirCached = ''

/**
 * Main owns each terminal pane's `claude` session id + cwd (D2). Populated on
 * every `pty:start` (mint or resume) and read by the `session:save` boundary to
 * ENRICH the renderer-built snapshot's terminal tabs with their sessionId/cwd (the
 * renderer never sees the session id). Cleared per-pane on dispose.
 */
const terminalSessionMap = new Map<string, { sessionId: string; cwd: string }>()

/**
 * Terminal sessions to RESUME on the next `pty:start` for that paneId (FR-020),
 * seeded from the snapshot at `session:load`. A paneId present here means its
 * `pty:start` should spawn `claude --resume <sessionId>` (in the persisted cwd)
 * rather than mint a fresh session. Consumed once per pane (deleted on use) so a
 * later manual restart starts fresh.
 */
const terminalResumeMap = new Map<string, { sessionId: string; cwd: string }>()

/**
 * Build the per-pane spawn options for a `pty:start` (D2/FR-019/FR-020/FR-022).
 * A pane queued for resume spawns `--resume <id>` (resume:true so an abnormal early
 * exit triggers the fallback); otherwise a fresh `--session-id <uuid>` is minted.
 * Either way `terminalSessionMap` records the pane's session id + cwd for save.
 */
function paneSpawnFor(paneId: string, sandboxDir: string): {
  args: string[]
  resume: boolean
  cwd: string
} {
  const resume = terminalResumeMap.get(paneId)
  if (resume) {
    terminalResumeMap.delete(paneId)
    terminalSessionMap.set(paneId, { sessionId: resume.sessionId, cwd: resume.cwd })
    return { args: ['--resume', resume.sessionId], resume: true, cwd: resume.cwd }
  }
  const sessionId = randomUUID()
  terminalSessionMap.set(paneId, { sessionId, cwd: sandboxDir })
  return { args: ['--session-id', sessionId], resume: false, cwd: sandboxDir }
}

/**
 * Enrich a renderer-sent snapshot's terminal tabs with their MAIN-owned sessionId
 * + cwd from `terminalSessionMap` before persisting (D2/FR-019). The renderer sends
 * terminal tabs WITHOUT sessionId/cwd (it never sees them); a tab whose pane has no
 * live session mapping (already exited/disposed) is dropped — only resumable tabs
 * are persisted. Returns the enriched snapshot, or `null` when the payload is not a
 * snapshot-shaped object (warned + ignored upstream). Never throws.
 */
function enrichSnapshotForSave(raw: unknown): SessionSnapshot | null {
  if (typeof raw !== 'object' || raw === null) {
    console.warn('[session] session:save payload is not an object; ignoring')
    return null
  }
  const snap = raw as SessionSnapshot
  const terminal = snap.panels?.terminal
  if (terminal && Array.isArray(terminal.tabs)) {
    terminal.tabs = terminal.tabs
      .map((t) => {
        const session = terminalSessionMap.get(t.id)
        if (!session) {
          return null // pane has no live session — not resumable, drop it
        }
        return { ...t, sessionId: session.sessionId, cwd: session.cwd }
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
    // Prune a dangling active id after dropping dead tabs (FR-008/FR-011).
    if (terminal.activeTabId && !terminal.tabs.some((t) => t.id === terminal.activeTabId)) {
      terminal.activeTabId = terminal.tabs.length > 0 ? terminal.tabs[0].id : null
    }
  }
  // `validateSnapshot` runs again inside `sessionStore.save`; this pre-validate keeps
  // the enrichment honest (a wrong-version payload is rejected before we touch it).
  return validateSnapshot(snap)
}

/**
 * Isolated working directory for the embedded `claude`. The host (cosmos) is
 * itself a project the user explores, so the embedded agent must NOT run with
 * the host repo as its cwd or it could edit the user's files. We give it a
 * stable, app-private scratch dir under userData instead. Created on demand.
 */
function resolveSandboxDir(): string {
  const dir = join(app.getPath('userData'), 'sandbox')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * MCP config (as a JSON string for `claude --mcp-config`) that registers the
 * render_ui server for the embedded session. Passing it on the command line
 * loads it without the project `.mcp.json` approval gate, and threads the
 * bridge socket path explicitly via COSMOS_BRIDGE_SOCKET so the server finds
 * main even though it runs from the sandbox cwd.
 */
function embeddedMcpConfig(sandboxDir: string): string {
  const slackPath = join(__dirname, 'mcp/slackMcpServer.js')
  const jiraPath = join(__dirname, 'mcp/jiraMcpServer.js')
  const confluencePath = join(__dirname, 'mcp/confluenceMcpServer.js')
  return JSON.stringify({
    mcpServers: {
      // Shared render_ui entry — the SAME registration the headless AgentRunner
      // uses (built from mcpConfig.ts) so the two configs cannot drift (FR-007).
      'cosmos-render-ui': renderUiMcpServerEntry(sandboxDir),
      // Jira generative-UI v2 (D3): the Jira-scoped render tool. Same UiBridge
      // socket as render_ui; the entry stamps `target: 'jira'` so its surfaces land
      // in the Jira panel. Built from mcpConfig.ts so it cannot drift.
      [JIRA_RENDER_UI_SERVER_NAME]: jiraRenderUiMcpServerEntry(sandboxDir),
      // Slack + Confluence generative-UI v1: the Slack/Confluence-scoped render tools.
      // Same UiBridge socket; each entry stamps its `target` so its surfaces land in the
      // matching panel. Built from mcpConfig.ts so the interactive + headless paths can't
      // drift. Read-only: no write tool, no dispatcher (FR-012).
      [SLACK_RENDER_UI_SERVER_NAME]: slackRenderUiMcpServerEntry(sandboxDir),
      [CONFLUENCE_RENDER_UI_SERVER_NAME]: confluenceRenderUiMcpServerEntry(sandboxDir),
      // Slack read-only tools, registered the same main-managed way (FR-018);
      // its bridge socket threads through COSMOS_SLACK_BRIDGE_SOCKET (sibling).
      'cosmos-slack': {
        type: 'stdio',
        command: 'node',
        args: [slackPath],
        env: { COSMOS_SLACK_BRIDGE_SOCKET: slackBridgeSocketPath(sandboxDir) }
      },
      // Jira read-only tools (FR-X01); its own bridge socket (FR-A13).
      'cosmos-jira': {
        type: 'stdio',
        command: 'node',
        args: [jiraPath],
        env: { COSMOS_JIRA_BRIDGE_SOCKET: jiraBridgeSocketPath(sandboxDir) }
      },
      // Confluence read-only tools (FR-X01); a fully separate bridge socket (FR-A13).
      'cosmos-confluence': {
        type: 'stdio',
        command: 'node',
        args: [confluencePath],
        env: { COSMOS_CONFLUENCE_BRIDGE_SOCKET: confluenceBridgeSocketPath(sandboxDir) }
      }
    }
  })
}

/**
 * Build the SlackManager + its foundation (token store, client, OAuth runner).
 * Slack connects via cosmos's OWN registered public client through a desktop PKCE
 * browser flow (no client secret, no per-user bot install): the user clicks
 * Connect, consents in the browser, and the manager persists the resulting USER
 * token. The token lives only here, encrypted via safeStorage (FR-005, FR-006,
 * SC-008). Status changes push to the renderer as `slack:statusChanged` (FR-007).
 */
function createSlackManager(window: BrowserWindow): SlackManager {
  const tokenStore = new TokenStore({
    filePath: join(app.getPath('userData'), 'integrations', 'slack.token.enc'),
    dirPath: join(app.getPath('userData'), 'integrations'),
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync }
  })
  const client = new SlackClient()
  return new SlackManager({
    client,
    tokenStore,
    runOAuth: () => {
      // cosmos's registered public client id (read from .env / ambient env). Kept
      // out of source so the build stays config-driven (SC: no hardcoded id).
      const clientId = process.env.COSMOS_SLACK_CLIENT_ID
      if (!clientId) {
        return Promise.reject(
          new Error('COSMOS_SLACK_CLIENT_ID is not set — cannot start the Slack OAuth flow.')
        )
      }
      return runSlackOAuth({
        clientId,
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    onStatusChanged: (status: SlackConnectionStatus) => {
      if (!window.isDestroyed()) {
        window.webContents.send(SlackChannelName.StatusChanged, status)
      }
    }
  })
}

/**
 * Build the JiraManager + its foundation (token store, client, OAuth runner,
 * refresher). Jira connects via cosmos's OWN registered Atlassian client through a
 * desktop OAuth flow; Atlassian Cloud is a confidential client, so the documented
 * `client_secret` fallback (FR-A03) is the active path — the id + secret are read
 * here in main only and NEVER logged, IPC'd, bridged, or returned (FR-A11, SC-009).
 * The token lives only here, encrypted via safeStorage. Status changes push to the
 * renderer as `jira:statusChanged` (FR-A12). Fully separate from Confluence (FR-A13).
 */
function createJiraManager(window: BrowserWindow): JiraManager {
  const tokenStore = new TokenStore({
    filePath: join(app.getPath('userData'), 'integrations', 'jira.token.enc'),
    dirPath: join(app.getPath('userData'), 'integrations'),
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync }
  })
  const client = new JiraClient()
  return new JiraManager({
    client,
    tokenStore,
    runOAuth: () => {
      const clientId = process.env.COSMOS_ATLASSIAN_CLIENT_ID
      if (!clientId) {
        // FR-A04: fail fast with a clear "not configured" message; no token stored.
        return Promise.reject(
          new Error('COSMOS_ATLASSIAN_CLIENT_ID is not set — cannot start the Jira OAuth flow.')
        )
      }
      return runAtlassianOAuth({
        scopes: JIRA_OAUTH_SCOPES,
        clientId,
        ...(process.env.COSMOS_ATLASSIAN_CLIENT_SECRET
          ? { clientSecret: process.env.COSMOS_ATLASSIAN_CLIENT_SECRET }
          : {}),
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    refresh: (refreshToken: string) => {
      const clientId = process.env.COSMOS_ATLASSIAN_CLIENT_ID ?? ''
      return refreshAtlassianToken({
        clientId,
        ...(process.env.COSMOS_ATLASSIAN_CLIENT_SECRET
          ? { clientSecret: process.env.COSMOS_ATLASSIAN_CLIENT_SECRET }
          : {}),
        refreshToken
      })
    },
    onStatusChanged: (status: JiraConnectionStatus) => {
      if (!window.isDestroyed()) {
        window.webContents.send(JiraChannelName.StatusChanged, status)
      }
    }
  })
}

/**
 * Build the ConfluenceManager + its foundation. A fully separate connection from
 * Jira (its own encrypted token-store entry — FR-A13). Same secret-handling
 * discipline as Jira (FR-A03, FR-A11, SC-009). Status changes push to the renderer
 * as `confluence:statusChanged` (FR-A12).
 */
function createConfluenceManager(window: BrowserWindow): ConfluenceManager {
  const tokenStore = new TokenStore({
    filePath: join(app.getPath('userData'), 'integrations', 'confluence.token.enc'),
    dirPath: join(app.getPath('userData'), 'integrations'),
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync }
  })
  const client = new ConfluenceClient()
  return new ConfluenceManager({
    client,
    tokenStore,
    runOAuth: () => {
      const clientId = process.env.COSMOS_ATLASSIAN_CLIENT_ID
      if (!clientId) {
        return Promise.reject(
          new Error(
            'COSMOS_ATLASSIAN_CLIENT_ID is not set — cannot start the Confluence OAuth flow.'
          )
        )
      }
      return runAtlassianOAuth({
        scopes: CONFLUENCE_OAUTH_SCOPES,
        clientId,
        ...(process.env.COSMOS_ATLASSIAN_CLIENT_SECRET
          ? { clientSecret: process.env.COSMOS_ATLASSIAN_CLIENT_SECRET }
          : {}),
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    refresh: (refreshToken: string) => {
      const clientId = process.env.COSMOS_ATLASSIAN_CLIENT_ID ?? ''
      return refreshAtlassianToken({
        clientId,
        ...(process.env.COSMOS_ATLASSIAN_CLIENT_SECRET
          ? { clientSecret: process.env.COSMOS_ATLASSIAN_CLIENT_SECRET }
          : {}),
        refreshToken
      })
    },
    onStatusChanged: (status: ConfluenceConnectionStatus) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ConfluenceChannelName.StatusChanged, status)
      }
    }
  })
}

function createPtyManager(window: BrowserWindow, sandboxDir: string): PtyManager {
  return new PtyManager(
    {
      // FR-002: stream raw output to the renderer.
      onData: (payload) => {
        if (!window.isDestroyed()) {
          window.webContents.send(PtyChannel.Data, payload)
        }
      },
      // FR-007: signal exit/error to the renderer.
      onExit: (payload) => {
        // The pane is gone (or about to be re-minted) — drop its session mapping so a
        // stale id is never persisted (FR-018/FR-019).
        terminalSessionMap.delete(payload.paneId)
        if (!window.isDestroyed()) {
          window.webContents.send(PtyChannel.Exit, payload)
        }
      },
      // session-persistence-v1 OQ-1/FR-022: a `--resume` spawn died abnormally too
      // soon (resume failed). Re-mint a FRESH session and re-start this pane ONCE in
      // its persisted cwd; the renderer keeps the restored scrollback as read-only
      // history. No hang/crash — the tab gets a working fresh `claude`.
      onResumeFailure: (paneId) => {
        const prior = terminalSessionMap.get(paneId)
        const cwd = prior?.cwd ?? sandboxDir
        const sessionId = randomUUID()
        terminalSessionMap.set(paneId, { sessionId, cwd })
        console.warn(`[session] resume failed for pane ${paneId}; starting a fresh session`)
        ptyManager?.start(paneId, { args: ['--session-id', sessionId], resume: false, cwd })
      }
    },
    {
      cwd: sandboxDir,
      args: ['--mcp-config', embeddedMcpConfig(sandboxDir)]
    }
  )
}

function registerIpcHandlers(): void {
  // panel-tabs v1 FR-021/FR-022: spawn a new PTY session for a freshly-opened
  // terminal tab. The renderer mints `paneId` per tab and issues this on create
  // (the single PTY is no longer auto-started at window create). Validated — an
  // invalid/missing paneId is warned + ignored (SC-005).
  ipcMain.on(PtyChannel.Start, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateStart(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    // session-persistence-v1 D2/FR-019/FR-020: main owns the pane's `claude` session
    // id. A pane queued for resume (seeded at session:load) spawns `--resume`; else a
    // fresh `--session-id` is minted. Either way the id+cwd are recorded for save.
    ptyManager?.start(payload.paneId, paneSpawnFor(payload.paneId, sandboxDirCached))
  })

  // FR-004 (panel-tabs v1 FR-021): forward keyboard input to the addressed pane
  // (validated — FR-010).
  ipcMain.on(PtyChannel.Input, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateInput(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    ptyManager?.write(payload.paneId, payload.data)
  })

  // FR-005 (panel-tabs v1 FR-021): propagate resize to the addressed pane
  // (validated — FR-010).
  ipcMain.on(PtyChannel.Resize, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateResize(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    ptyManager?.resize(payload.paneId, payload)
  })

  // FR-008 (panel-tabs v1 FR-026): restart the addressed pane's session only.
  ipcMain.on(PtyChannel.Restart, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateRestart(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    ptyManager?.restart(payload.paneId)
  })

  // panel-tabs v1 FR-023: dispose/kill the addressed pane's PTY on tab close. No
  // exit event is emitted (the tab is gone); other panes are unaffected.
  ipcMain.on(PtyChannel.Dispose, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateDispose(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    // session-persistence-v1: a closed tab's session is gone — drop its mapping so it
    // is never persisted or resumed (FR-018).
    terminalSessionMap.delete(payload.paneId)
    terminalResumeMap.delete(payload.paneId)
    ptyManager?.kill(payload.paneId)
  })

  // session-persistence-v1 (FR-001/FR-003/FR-005): read the persisted snapshot once
  // at startup. Seeds the per-pane resume map from the terminal tabs so each tab's
  // first `pty:start` resumes its `claude` session (FR-020). Returns null on a
  // missing/corrupt/wrong-version file so the renderer falls back to a clean session.
  ipcMain.handle(SessionChannel.Load, () => {
    const snapshot = sessionStore?.load() ?? null
    terminalResumeMap.clear()
    if (snapshot) {
      for (const tab of snapshot.panels.terminal.tabs) {
        terminalResumeMap.set(tab.id, { sessionId: tab.sessionId, cwd: tab.cwd })
      }
    }
    return snapshot
  })

  // session-persistence-v1 (FR-001/FR-004/FR-006/FR-007): persist the renderer's
  // debounced snapshot. The renderer cannot know each terminal tab's MAIN-owned
  // sessionId/cwd (D2), so ENRICH the terminal tabs from `terminalSessionMap` here
  // before validating + writing. An invalid payload is warned + ignored by the store
  // (never overwrites a good file). NO secret crosses this boundary (FR-006).
  ipcMain.on(SessionChannel.Save, (_event: IpcMainEvent, raw: unknown) => {
    const enriched = enrichSnapshotForSave(raw)
    if (!enriched) {
      return // not a usable snapshot -> warned + ignored
    }
    sessionStore?.save(enriched)
  })

  // FR-006/FR-010: receive the user's interaction from the Generated-UI panel.
  // Validate at the boundary; an invalid payload is warned + ignored and does
  // NOT resolve any pending render_ui call (SC-006).
  ipcMain.on(UiChannel.Action, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateUiAction(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-006)
    }
    // Jira generative-UI v1 (D1/FR-004): a `submit` whose actionId is in the
    // reserved `jira.*` namespace is DETERMINISTICALLY bound — main executes the
    // Jira write itself (no Claude round-trip) and re-pushes the surface. The
    // dispatcher settles the pending render_ui call as `cancel` internally (FR-016),
    // so we do NOT also resolveAction here. An invalid/unknown bound action is
    // warned + ignored by the dispatcher (returns false) and falls through to the
    // normal resolve so a stray non-bound submit is still handled.
    if (
      payload.action.type === 'submit' &&
      jiraActionDispatcher?.handles(payload.action.actionId)
    ) {
      void jiraActionDispatcher
        .dispatch(payload.action.actionId, payload.action.values)
        .then((handled) => {
          if (!handled) {
            // Not a valid bound action (warned in the dispatcher). Do nothing else:
            // the pending call is left intact and the user can retry.
            console.warn('[ui] ignoring ui:action — invalid jira.* bound action')
          }
        })
        .catch((err) => {
          // Defensive: the dispatcher never throws, but never let a rejection escape.
          console.error('[ui] jira dispatch error (handled):', err instanceof Error ? err.message : err)
        })
      return
    }
    const matched = uiBridge?.resolveAction(payload.requestId, payload.action)
    if (!matched) {
      // FR-012: an action for an unknown/stale requestId is ignored, not
      // mis-applied to another call.
      console.warn('[ui] ignoring ui:action — no pending call for requestId:', payload.requestId)
    }
  })

  // FR-002/FR-010: submit an utterance to the headless runner. Validate at the
  // boundary; an invalid/empty payload is warned + ignored and starts no run
  // (FR-004, SC-005). The runner's single-run guard ignores a submit while busy.
  ipcMain.on(AgentChannel.Submit, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateAgentPrompt(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    console.log('[agent] submit utterance=', JSON.stringify(payload.utterance), 'target=', payload.target)
    // Jira generative-UI v2 (D2): thread the validated render target so the run is
    // granted ONLY that target's render tool (jira vs generated-ui).
    agentRunner?.run(payload.utterance, payload.target)
  })

  registerSlackIpcHandlers()
  registerJiraIpcHandlers()
  registerConfluenceIpcHandlers()
}

/**
 * Register the Slack IPC `invoke` handlers (FR-007). Every inbound payload is
 * validated at the boundary (FR-023): an invalid payload returns a structured
 * error result (never crashes, never attaches a token from a bad request). The
 * token is attached inside SlackManager and never appears in any payload (SC-008).
 */
function registerSlackIpcHandlers(): void {
  const notReady: SlackConnectionStatus = { state: 'not_connected' }
  const badParams = { ok: false as const, kind: 'network' as const, message: 'Invalid request.' }

  ipcMain.handle(SlackChannelName.GetStatus, () => slackManager?.getStatus() ?? notReady)
  ipcMain.handle(SlackChannelName.Connect, () => slackManager?.connect() ?? notReady)
  ipcMain.handle(SlackChannelName.Disconnect, () => slackManager?.disconnect() ?? notReady)

  ipcMain.handle(SlackChannelName.ListChannels, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackListChannels(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.listChannels(params)
  })
  ipcMain.handle(SlackChannelName.GetHistory, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackHistory(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.getHistory(params)
  })
  ipcMain.handle(SlackChannelName.GetReplies, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackReplies(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.getReplies(params)
  })
  ipcMain.handle(SlackChannelName.Search, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackSearch(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.search(params)
  })
  ipcMain.handle(SlackChannelName.GetUser, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackGetUser(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.getUser(params)
  })
}

/**
 * Register the Jira IPC `invoke` handlers (FR-A12, FR-X04). Every inbound payload
 * is validated at the boundary: an invalid payload returns a structured error
 * result (never crashes, never attaches a token from a bad request). The token is
 * attached inside JiraManager and never appears in any payload (FR-A11, SC-009).
 */
function registerJiraIpcHandlers(): void {
  const notReady: JiraConnectionStatus = { state: 'not_connected' }
  const badParams = { ok: false as const, kind: 'network' as const, message: 'Invalid request.' }

  ipcMain.handle(JiraChannelName.GetStatus, () => jiraManager?.getStatus() ?? notReady)
  ipcMain.handle(JiraChannelName.Connect, () => jiraManager?.connect() ?? notReady)
  ipcMain.handle(JiraChannelName.Disconnect, () => jiraManager?.disconnect() ?? notReady)

  ipcMain.handle(JiraChannelName.SearchIssues, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateJiraSearch(raw)
    if (!params || !jiraManager) {
      return badParams
    }
    return jiraManager.searchIssues(params)
  })
  ipcMain.handle(JiraChannelName.GetIssue, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateJiraGetIssue(raw)
    if (!params || !jiraManager) {
      return badParams
    }
    return jiraManager.getIssue(params)
  })

  // Jira generative-UI v2 (D4 / v2 FR-002, FR-019, FR-020): the panel became active.
  // Run ONE bounded recent-issues read (single page, NO pagination loop), compose
  // the default view, and push it `target: 'jira'`. Fire-and-forget: the rail switch
  // never blocks here. Validate the (empty) payload at the boundary (SC-005).
  ipcMain.on(JiraChannelName.RequestDefaultView, (_event: IpcMainEvent, raw: unknown) => {
    if (!validateRequestDefaultView(raw) || !jiraManager) {
      return // invalid -> warned + ignored; or manager not ready
    }
    void handleJiraDefaultView()
  })

  // jira-jql-search-v1 (FR-003, FR-005): the native JQL search box was submitted. Trim
  // the raw jql and fall back to the my-tickets default JQL when empty/whitespace, then
  // run the SAME bounded read/compose/push as the default view. Fire-and-forget; never
  // blocks. Validate the payload at the boundary (FR-012, SC-005).
  ipcMain.on(JiraChannelName.RequestSearchView, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateRequestSearchView(raw)
    if (!payload || !jiraManager) {
      return // invalid -> warned + ignored; or manager not ready
    }
    const jql = payload.jql.trim()
    void handleJiraView(jql.length === 0 ? JIRA_DEFAULT_VIEW_JQL : jql)
  })

  // jira-ticket-detail-v1 (FR-003/FR-010/FR-011): a ticket card was clicked to open its
  // detail in place. Run the deterministic native `getIssue` read for the clicked
  // `issueKey` and push the composed detail surface (`target: 'jira'`) as an unsolicited
  // frame into the active tab. Read-only — NOT an AgentRunner run, no new scope. Validate
  // the payload at the boundary: an invalid/empty `issueKey` is warned + ignored (no read).
  // Fire-and-forget; never blocks.
  ipcMain.on(JiraChannelName.RequestIssueDetail, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateRequestIssueDetail(raw)
    if (!payload || !jiraManager) {
      return // invalid -> warned + ignored; or manager not ready
    }
    void handleJiraIssueDetail(payload.issueKey)
  })
}

/**
 * The default recent-issues JQL for the per-switch default view (v2 FR-020): the
 * current user's recently-updated issues. A single bounded page (no cursor loop).
 */
const JIRA_DEFAULT_VIEW_JQL = 'assignee = currentUser() ORDER BY updated DESC'

/**
 * Run a bounded Jira issue read for `jql` and push the composed surface with
 * `target: 'jira'` (Jira generative-UI v2, D4; generalized for jira-jql-search-v1 FR-003).
 * On `ok` → `buildDefaultViewSurface` (IssueList, incl. its own empty state). On
 * `reconnect_needed`/`not_connected` → the JiraManager already drives `statusChanged`, so
 * the panel routes to the native Connect/Reconnect (no surface OAuth, FR-016) — push
 * nothing. On any other failure (`rate_limited`/`network`) → push a calm, recoverable
 * `Notice` surface (FR-019/jql-search FR-007). Never throws; never blocks the rail
 * switch (FR-020). Parameterized by `jql` so the default view and the JQL search share
 * ALL read/error/push logic (the only difference is the JQL the caller passes).
 */
async function handleJiraView(jql: string): Promise<void> {
  if (!jiraManager) {
    return
  }
  let result
  try {
    result = await jiraManager.searchIssues({ jql })
  } catch (err) {
    console.warn('[jira] view read threw (handled):', err instanceof Error ? err.message : err)
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildNoticeSurface({ kind: 'error', message: 'Could not load Jira issues. Try again shortly.' }),
      target: 'jira'
    })
    return
  }

  if (result.ok) {
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildDefaultViewSurface(result.data),
      target: 'jira'
    })
    return
  }

  // reconnect_needed routes through the native Connect/Reconnect (statusChanged);
  // don't push a surface for it.
  if (result.kind === 'reconnect_needed' || result.kind === 'not_connected') {
    return
  }

  // rate_limited / network / write_not_authorized -> a calm recoverable Notice.
  pushRenderToRenderer({
    requestId: randomUUID(),
    spec: buildNoticeSurface({ kind: 'error', message: result.message }),
    target: 'jira'
  })
}

/**
 * Run the bounded default-view read (the my-tickets recently-updated issues) and push it
 * (Jira generative-UI v2, D4 / v2 FR-002). A thin wrapper over `handleJiraView` so the
 * existing `RequestDefaultView` handler behaves byte-for-byte as before.
 */
async function handleJiraDefaultView(): Promise<void> {
  await handleJiraView(JIRA_DEFAULT_VIEW_JQL)
}

/**
 * Run a bounded native `getIssue` read for `issueKey` and push the composed ticket-detail
 * surface with `target: 'jira'` (jira-ticket-detail-v1, FR-003/FR-007/FR-008). Mirrors
 * `handleJiraView` structurally:
 *  - on `ok` → `buildIssueDetailSurface(detail)` (the EXISTING detail surface the post-write
 *    re-push already renders — key/status, description, comments, transition + add-comment),
 *    pushed as an unsolicited `target: 'jira'` frame the renderer files into the active tab.
 *  - on `reconnect_needed`/`not_connected` → push NOTHING; the JiraManager already drives
 *    `statusChanged` so the panel routes to the native Connect/Reconnect (FR-008).
 *  - on any other failure (`rate_limited`/`network`, or a thrown error) → push a single
 *    calm, recoverable `Notice` surface (FR-007). Never throws; never blocks the click.
 * Read-only — NOT an AgentRunner run, no new OAuth scope; the token stays in main (FR-010).
 */
async function handleJiraIssueDetail(issueKey: string): Promise<void> {
  if (!jiraManager) {
    return
  }
  let result
  try {
    result = await jiraManager.getIssue({ issueKey })
  } catch (err) {
    console.warn('[jira] detail read threw (handled):', err instanceof Error ? err.message : err)
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildNoticeSurface({ kind: 'error', message: 'Could not load this Jira issue. Try again shortly.' }),
      target: 'jira'
    })
    return
  }

  if (result.ok) {
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildIssueDetailSurface(result.data),
      target: 'jira'
    })
    return
  }

  // reconnect_needed routes through the native Connect/Reconnect (statusChanged);
  // don't push a surface for it (FR-008).
  if (result.kind === 'reconnect_needed' || result.kind === 'not_connected') {
    return
  }

  // rate_limited / network / write_not_authorized -> a calm recoverable Notice (FR-007).
  pushRenderToRenderer({
    requestId: randomUUID(),
    spec: buildNoticeSurface({ kind: 'error', message: result.message }),
    target: 'jira'
  })
}

/**
 * Register the Confluence IPC `invoke` handlers (FR-A12, FR-X04). Same validate-at-
 * the-boundary + token-stays-in-main discipline as Jira (FR-A11, SC-009).
 */
function registerConfluenceIpcHandlers(): void {
  const notReady: ConfluenceConnectionStatus = { state: 'not_connected' }
  const badParams = { ok: false as const, kind: 'network' as const, message: 'Invalid request.' }

  ipcMain.handle(ConfluenceChannelName.GetStatus, () => confluenceManager?.getStatus() ?? notReady)
  ipcMain.handle(ConfluenceChannelName.Connect, () => confluenceManager?.connect() ?? notReady)
  ipcMain.handle(ConfluenceChannelName.Disconnect, () => confluenceManager?.disconnect() ?? notReady)

  ipcMain.handle(ConfluenceChannelName.SearchContent, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateConfluenceSearch(raw)
    if (!params || !confluenceManager) {
      return badParams
    }
    return confluenceManager.searchContent(params)
  })
  ipcMain.handle(ConfluenceChannelName.DefaultFeed, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateConfluenceDefaultFeed(raw)
    if (!params || !confluenceManager) {
      return badParams
    }
    return confluenceManager.defaultFeed(params)
  })
  ipcMain.handle(ConfluenceChannelName.GetPage, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateConfluenceGetPage(raw)
    if (!params || !confluenceManager) {
      return badParams
    }
    return confluenceManager.getPage(params)
  })
}

/**
 * Push a surface to the renderer's Generated-UI panel (FR-004). Used by the
 * UiBridge; guards against a destroyed window.
 */
function pushRenderToRenderer(payload: UiRenderPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UiChannel.Render, payload)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'cosmos',
    ...(existsSync(appIconPath()) ? { icon: appIconPath() } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // FR-006: secure renderer baseline.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // TEMP DIAGNOSTIC: surface renderer-side crashes/console errors into the main
  // stdout (dev log) so a blank-screen React crash is debuggable.
  mainWindow.webContents.on(
    'console-message',
    (_e: Electron.Event, level: number, message: string, line: number, source: string) => {
      if (level >= 2) {
        console.error(`[renderer console] ${source}:${line} ${message}`)
      }
    }
  )
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', JSON.stringify(details))
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[renderer unresponsive]')
  })

  // Global tab/window shortcuts (Chrome-style). Matched here in main so they fire
  // regardless of DOM focus (an xterm-focused terminal otherwise swallows the keys)
  // and are `preventDefault`'d before the page/xterm sees them. The resolved command
  // is forwarded to the renderer, which maps it onto the active surface's tab ops.
  // (Cmd/Ctrl+W's default window-close accelerator is removed from the menu in
  // `buildAppMenu` so it can't preempt this — preventDefault here does not stop a
  // menu accelerator.)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const match = matchShortcut(
      {
        type: input.type,
        code: input.code,
        meta: input.meta,
        control: input.control,
        shift: input.shift,
        alt: input.alt
      },
      process.platform === 'darwin' ? 'darwin' : 'other'
    )
    if (match && mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault()
      mainWindow.webContents.send(ShortcutChannel.Trigger, match)
    }
  })

  // The embedded agent and the bridge socket share one isolated cwd so the
  // socket the MCP server connects to matches the one main listens on.
  const sandboxDir = resolveSandboxDir()
  sandboxDirCached = sandboxDir
  ptyManager = createPtyManager(mainWindow, sandboxDir)

  // session-persistence-v1 (D1/FR-001): plain (unencrypted) JSON snapshot under
  // userData, written atomically. The snapshot is non-secret structure — NO token,
  // OAuth material, or client_secret is ever placed here (FR-006).
  sessionStore = new SessionStore({
    filePath: join(app.getPath('userData'), 'session.json'),
    dirPath: app.getPath('userData'),
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }
  })

  // FR-004/FR-012: main hosts the render_ui bridge socket and owns surface
  // pushes + pending-call state. Start it with the window.
  uiBridge = new UiBridge({
    pushRender: pushRenderToRenderer,
    projectDir: sandboxDir
  })
  uiBridge.start()

  // Slack: one manager (token only here, encrypted — FR-006/SC-008) serves both
  // the native panel (IPC handlers above) and the MCP tools (via SlackBridge).
  slackManager = createSlackManager(mainWindow)
  slackBridge = new SlackBridge({
    socketPath: slackBridgeSocketPath(sandboxDir),
    manager: slackManager
  })
  slackBridge.start()

  // Jira + Confluence: two fully separate managers (each its own token, encrypted —
  // FR-A11/A13), each serving both the native panel (IPC) and the MCP tools (bridge).
  jiraManager = createJiraManager(mainWindow)
  jiraBridge = new JiraBridge({
    socketPath: jiraBridgeSocketPath(sandboxDir),
    manager: jiraManager
  })
  jiraBridge.start()

  // Jira generative-UI v1 (D1/FR-004/FR-019): the deterministic `jira.*` dispatcher.
  // It reaches ONLY the jiraManager (writes + re-read), the uiBridge's cancel (to
  // settle the pending render_ui call — FR-016), and the renderer push — NEVER the
  // ptyManager or agentRunner, so a bound action cannot disturb them (FR-019).
  jiraActionDispatcher = new JiraActionDispatcher({
    manager: jiraManager,
    cancelActive: () => uiBridge?.cancelActive(),
    pushRender: pushRenderToRenderer
  })

  confluenceManager = createConfluenceManager(mainWindow)
  confluenceBridge = new ConfluenceBridge({
    socketPath: confluenceBridgeSocketPath(sandboxDir),
    manager: confluenceManager
  })
  confluenceBridge.start()

  // Generative-UI foundation v1: the headless `claude -p` runner. A SEPARATE
  // channel from the interactive PTY (FR-008) that reaches the SAME UiBridge via
  // the shared render_ui --mcp-config (FR-007). Its render_ui registration targets
  // this `sandboxDir`'s bridge socket — the one the running UiBridge listens on.
  agentRunner = new AgentRunner(
    {
      onStatus: (payload: AgentStatusPayload) => {
        console.log('[agent] status=', payload.state, payload.state === 'error' ? payload.message ?? '' : '')
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(AgentChannel.Status, payload)
        }
      }
    },
    { sandboxDir }
  )

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Edge case: renderer reload MUST NOT orphan any PTY. Kill ALL pane sessions
  // (panel-tabs v1, FR-023 teardown); the reloaded renderer re-mints its tabs and
  // issues fresh `pty:start` calls per pane (no auto-start in main).
  mainWindow.webContents.on('did-start-navigation', (event) => {
    if (event.isSameDocument) {
      return
    }
    ptyManager?.killAll()
    // Edge case: a render_ui call pending across a renderer reload MUST NOT hang;
    // resolve it cancel so Claude is not blocked indefinitely (FR-009).
    uiBridge?.cancelActive()
    // Edge case: a headless run in flight across a reload MUST NOT leak/wedge the
    // runner — kill any in-flight child and clear state (mirrors PTY teardown).
    agentRunner?.dispose()
  })

  // panel-tabs v1 FR-021: the single PTY is NO LONGER auto-started at window
  // create / did-finish-load. The Terminal panel's default tab mints a `paneId`
  // and issues `pty:start` when it mounts, so every pane starts explicitly.

  mainWindow.on('closed', () => {
    ptyManager?.killAll()
    ptyManager = null
    uiBridge?.stop()
    uiBridge = null
    slackBridge?.stop()
    slackBridge = null
    slackManager = null
    jiraBridge?.stop()
    jiraBridge = null
    jiraManager = null
    jiraActionDispatcher = null
    confluenceBridge?.stop()
    confluenceBridge = null
    confluenceManager = null
    agentRunner?.dispose()
    agentRunner = null
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// In dev the app runs from the unpackaged Electron binary, whose bundle name is
// "Electron"; set the product name explicitly so the macOS menu bar, About panel,
// and dock all read "cosmos" instead. Must run before the menu is built.
app.setName('cosmos')

// Build the application menu from a template so the bold first menu (and About
// dialog) shows "cosmos". The default menu derives its app-menu title from the
// bundle name ("Electron") in dev, which app.setName alone does not override.
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // Custom Window menu that OMITS the default Close item: its CmdOrCtrl+W
    // accelerator would otherwise close the whole window and preempt our Cmd+W
    // "close active tab" shortcut (a menu accelerator wins over before-input-event).
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'cosmos' })
  buildAppMenu()
  // macOS shows the dock icon from the app bundle, not the BrowserWindow `icon`;
  // set it explicitly so dev (unpackaged Electron) shows the cosmos icon too.
  if (process.platform === 'darwin' && existsSync(appIconPath())) {
    app.dock?.setIcon(appIconPath())
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager?.killAll()
  ptyManager = null
  uiBridge?.stop()
  uiBridge = null
  slackBridge?.stop()
  slackBridge = null
  slackManager = null
  jiraBridge?.stop()
  jiraBridge = null
  jiraManager = null
  jiraActionDispatcher = null
  confluenceBridge?.stop()
  confluenceBridge = null
  confluenceManager = null
  agentRunner?.dispose()
  agentRunner = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Final safety net: never orphan any PTY or the bridge sockets when quitting.
app.on('before-quit', () => {
  ptyManager?.killAll()
  uiBridge?.stop()
  slackBridge?.stop()
  jiraBridge?.stop()
  confluenceBridge?.stop()
  agentRunner?.dispose()
})
