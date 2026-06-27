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
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import { fileURLToPath } from 'node:url'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch as fsWatch,
  writeFileSync
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  AgentChannel,
  ConversationChannel,
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
  type AgentStatusPayload,
  type ClientConfigSaveResult,
  type PtyPickDirectoryResult,
  type SessionSnapshot,
  type UiDataModelPayload,
  type UiRenderPayload,
  type UiRenderTarget
} from '../shared/ipc'
import { matchShortcut } from './shortcutMatch'
import { resolvePaneSpawn, type ResolvedPaneSpawn } from './paneSpawn'
import {
  planResumeRetry,
  RESUME_RETRY_BACKOFF_MS,
  IN_USE_RETRY_CLEAR_SEQUENCE,
  type SessionLockEnv
} from './sessionLockRecovery'
import { canGroupKill } from './processGroupKill'
import {
  selectOrphanMcpServers,
  type CosmosMcpSignature,
  type ProcSnapshotRow
} from './orphanReaper'
import type { SlackConnectionStatus } from '../shared/slack'
import type { JiraConnectionStatus } from '../shared/jira'
import { JiraAdapterSource } from '../shared/jira'
import type { ConfluenceConnectionStatus } from '../shared/confluence'
import type { GoogleCalendarConnectionStatus } from '../shared/googleCalendar'
import {
  confluenceBridgeSocketPath,
  googleCalendarBridgeSocketPath,
  jiraBridgeSocketPath,
  slackBridgeSocketPath
} from '../shared/bridge'
import {
  validateAgentPrompt,
  validateAgentStatusPayload,
  validateConfluenceAddComment,
  validateConfluenceDefaultFeed,
  validateConfluenceGetComments,
  validateConfluenceGetPage,
  validateConfluenceSearch,
  validateFsPath,
  validateFsWatch,
  validateGoogleCalendarListEvents,
  validateGoogleCalendarRequestDefaultView,
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
  validateSlackSend,
  validateStart,
  validateAdapterAction,
  validateClientConfigClear,
  validateClientConfigSave,
  validateUiAction,
  validateUiGeneratingBeginPayload,
  validateConversationResult
} from '../shared/validate'
import { PtyManager } from './ptyManager'
import { SessionStore } from './sessionStore'
import { validateSnapshot } from './sessionSnapshot'
import { AgentRunner } from './agentRunner'
import { AgentSessionStore } from './agentSessionStore'
import { TranscriptReader } from './transcriptReader'
import { selectDefaultSessionId } from './agentSessionQueue'
import {
  CONFLUENCE_RENDER_UI_SERVER_NAME,
  GOOGLE_CALENDAR_RENDER_UI_SERVER_NAME,
  GOOGLE_CALENDAR_TOOLS_SERVER_NAME,
  JIRA_RENDER_UI_SERVER_NAME,
  SLACK_RENDER_UI_SERVER_NAME,
  confluenceRenderUiMcpServerEntry,
  googleCalendarRenderUiMcpServerEntry,
  googleCalendarToolsMcpServerEntry,
  jiraRenderUiMcpServerEntry,
  renderUiMcpServerEntry,
  slackRenderUiMcpServerEntry
} from './mcpConfig'
import { UiBridge } from './uiBridge'
import { SlackBridge } from './slackBridge'
import { SlackManager } from './slackManager'
import { SlackClient } from './integrations/slackClient'
import { TokenStore } from './integrations/tokenStore'
import {
  ClientConfigStore,
  ClientConfigEncryptionUnavailableError,
  type ClientConfig
} from './integrations/clientConfigStore'
import {
  resolveEffective,
  toStatus,
  diffEffective,
  type ClientConfigEnv,
  type EffectiveClientConfig
} from './clientConfigResolver'
import { mergeClientConfigSave, clearClientConfigField } from './clientConfigMutate'
import { runSlackOAuth, refreshSlackToken } from './integrations/slackOAuth'
import { JiraBridge } from './jiraBridge'
import { JiraManager } from './jiraManager'
import { JiraActionDispatcher } from './jiraActionDispatcher'
import { AdapterDispatcher, type AdapterResolver } from './adapterDispatcher'
import { jiraAdapterResolver, jiraListBindOptions, jiraDetailBindOptions } from './jiraAdapter'
// slack-generative-adapter-v1 (FR-005/FR-015): the SAME shared AdapterDispatcher serves
// Slack's bound lists. A composite resolver branches Slack vs Jira by dataSource (the two
// source namespaces don't collide), and the lazy re-registration consults Slack's
// bind-options selector for a restored Slack descriptor.
import { slackAdapterResolver, slackBindOptionsForSource } from './slackAdapter'
// confluence-generative-adapter-v1 (FR-005/FR-008/FR-015): the same shared dispatcher
// also serves Confluence's two append-only lists + its refresh-only page detail. The
// composite resolver branches Confluence-vs-Slack-vs-Jira by dataSource; the lazy
// re-registration consults this selector in the chain. READ-ONLY (FR-017): no write.
import { confluenceAdapterResolver, confluenceBindOptionsForSource } from './confluenceAdapter'
// panel-refresh-v1 (OQ-5 = main-composes): resolve a descriptor → its bound shell + bind
// options so an agent-composed surface carrying a descriptor renders refreshable.
import { planAgentSurfaceRegistration } from './descriptorRegistration'
// refreshable-custom-generative-ui (multi-region): rebind an agent's per-container literal
// props to region-scoped `{path}` bindings + plan the regions to register/refresh.
import { planRegions, rebindAgentSurface } from './specRebinder'
import {
  buildBoundIssueListSurface,
  buildBoundIssueDetailSurface,
  buildNoticeSurface,
  SURFACE_DEFAULT_VIEW,
  SURFACE_ISSUE_DETAIL
} from './jiraSurfaceBuilder'
import { JiraClient } from './integrations/jiraClient'
import { ConfluenceBridge } from './confluenceBridge'
import { ConfluenceManager } from './confluenceManager'
import { ConfluenceClient } from './integrations/confluenceClient'
import {
  refreshAtlassianToken,
  runAtlassianOAuth
} from './integrations/atlassianOAuth'
import { CONFLUENCE_OAUTH_SCOPES, JIRA_OAUTH_SCOPES } from './integrations/atlassianConfig'
import {
  registerConfluenceImageScheme,
  installConfluenceImageProtocol
} from './confluenceImageProtocol'
import {
  registerLocalFileScheme,
  installLocalFileProtocol
} from './localFileProtocol'
import { createFsExplorer, type ExplorerFs, type FsExplorer } from './fsExplorer'
import {
  registerSlackImageScheme,
  installSlackImageProtocol
} from './slackImageProtocol'
import { GoogleCalendarBridge } from './googleCalendarBridge'
import { GoogleCalendarManager } from './googleCalendarManager'
import { GoogleCalendarClient } from './integrations/googleCalendarClient'
import { runGoogleOAuth, refreshGoogleToken } from './integrations/googleOAuth'
import { GOOGLE_CALENDAR_OAUTH_SCOPES } from './integrations/googleConfig'
import {
  buildNoticeSurface as buildGoogleCalendarNoticeSurface,
  buildSharedViewSurface as buildGoogleCalendarSharedViewSurface
} from './googleCalendarSurfaceBuilder'
import {
  googleCalendarDefaultWindow,
  type GoogleCalendarDefaultViewAnchor
} from './googleCalendarWindow'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load local `.env` (gitignored) into process.env so runtime config like
// COSMOS_SLACK_CLIENT_ID is available without exporting it in the shell. No-op
// if the file is absent (e.g. CI / packaged build that injects env directly).
try {
  process.loadEnvFile(join(app.getAppPath(), '.env'))
} catch {
  // no .env present — fall back to the ambient environment
}

// confluence-content-images-v1: register the privileged `cosmos-confluence-img` streaming
// scheme. MUST run BEFORE `app.whenReady` (Electron requires pre-ready scheme registration);
// the matching `protocol.handle` is installed post-ready alongside createWindow().
registerConfluenceImageScheme()

// terminal-file-explorer-v1 (FR-027/FR-028): register the privileged `cosmos-file` streaming
// scheme for the file viewer's local images. MUST run BEFORE `app.whenReady`; the matching
// `protocol.handle` is installed post-ready with the per-pane root resolver.
registerLocalFileScheme()

// slack-rich-message-render-v1: register the privileged `cosmos-slack-img` streaming scheme
// (same pre-ready requirement); the matching `protocol.handle` is installed post-ready below.
registerSlackImageScheme()

// The cosmos app icon (rasterized from assets/logo/cosmos-pastel.svg). Used for the
// window (Windows/Linux taskbar) and the macOS dock. Resolved from the app root so it
// works in dev; absent → fall back to the default Electron icon.
function appIconPath(): string {
  return join(app.getAppPath(), 'build', 'icon.png')
}

/**
 * macOS-only: stamp the cosmos logo onto the dock. In dev the app runs from the
 * unpackaged Electron binary, whose bundle ships the default Electron dock icon;
 * `app.dock.setIcon` overrides it for the running process. We pass a `NativeImage`
 * (not the path string) because the image overload is the reliable form.
 *
 * Persistence after the LAST window closes: on macOS closing the last window does
 * NOT quit (window-all-closed is guarded), but destroying the window resets the dock
 * tile back to the bundle's default Electron icon. `activate` only fires on the NEXT
 * reactivation (a dock click), so the icon would show Electron's logo in the gap. We
 * therefore re-stamp at the exact moment of the revert — the window `closed` event —
 * as well as on `activate`, so the cosmos logo persists with no window open.
 * No-op off macOS (`app.dock` is undefined) or when the asset is missing.
 */
function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }
  if (!existsSync(appIconPath())) {
    return
  }
  const image = nativeImage.createFromPath(appIconPath())
  if (!image.isEmpty()) {
    app.dock.setIcon(image)
  }
}

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let uiBridge: UiBridge | null = null
let slackManager: SlackManager | null = null
let slackBridge: SlackBridge | null = null
let jiraManager: JiraManager | null = null
let jiraBridge: JiraBridge | null = null
let jiraActionDispatcher: JiraActionDispatcher | null = null
// jira-generative-adapter-v1 (FR-009/FR-012): the SHARED, panel-agnostic adapter
// dispatch path. Constructed with a Jira resolver here; channel-independent (no
// ptyManager/agentRunner). Drives refresh + load-more/pagination + the loading flag.
let adapterDispatcher: AdapterDispatcher | null = null
let confluenceManager: ConfluenceManager | null = null
let confluenceBridge: ConfluenceBridge | null = null
// google-calendar-v1 (Track A, main-only): one manager (token only in main, encrypted)
// serves both the native panel (IPC) and the MCP tools (via GoogleCalendarBridge).
// READ-ONLY — no write path, no scope-gate, no action dispatcher.
let googleCalendarManager: GoogleCalendarManager | null = null
let googleCalendarBridge: GoogleCalendarBridge | null = null
let agentRunner: AgentRunner | null = null
// cosmos-conversation-panel-v2 (step 3): the main-only default-session transcript reader.
// Owns ALL `~/.claude` access (confined to the one default-session transcript path); the
// renderer reads the parsed conversation via the `conversation:*` channel only.
let transcriptReader: TranscriptReader | null = null

/* ------------------------------------------------------------------------- *
 * settings-oauth-clients-v1 — main-owned, safeStorage-encrypted client-config
 * store + the Settings-over-env resolver the manager closures read from.
 * ------------------------------------------------------------------------- */

let clientConfigStore: ClientConfigStore | null = null

/**
 * Read the env fallback for the resolver (FR-009). Captured fresh on each call so a
 * test/runtime env change is reflected; the values are non-secret client ids plus the
 * Atlassian secret which stays in main and is never logged/IPC'd.
 */
function clientConfigEnv(): ClientConfigEnv {
  return {
    ...(process.env.COSMOS_SLACK_CLIENT_ID ? { COSMOS_SLACK_CLIENT_ID: process.env.COSMOS_SLACK_CLIENT_ID } : {}),
    ...(process.env.COSMOS_ATLASSIAN_CLIENT_ID
      ? { COSMOS_ATLASSIAN_CLIENT_ID: process.env.COSMOS_ATLASSIAN_CLIENT_ID }
      : {}),
    ...(process.env.COSMOS_ATLASSIAN_CLIENT_SECRET
      ? { COSMOS_ATLASSIAN_CLIENT_SECRET: process.env.COSMOS_ATLASSIAN_CLIENT_SECRET }
      : {}),
    ...(process.env.COSMOS_GOOGLE_CLIENT_ID
      ? { COSMOS_GOOGLE_CLIENT_ID: process.env.COSMOS_GOOGLE_CLIENT_ID }
      : {}),
    ...(process.env.COSMOS_GOOGLE_CLIENT_SECRET
      ? { COSMOS_GOOGLE_CLIENT_SECRET: process.env.COSMOS_GOOGLE_CLIENT_SECRET }
      : {})
  }
}

/**
 * The EFFECTIVE client credentials at THIS moment (Settings-over-env). The managers'
 * `runOAuth`/`refresh` closures call this so a save takes effect with no restart
 * (FR-010/FR-011). Reads the encrypted store (in-process only) + the env fallback.
 */
function effectiveClientConfig(): EffectiveClientConfig {
  const stored: ClientConfig = clientConfigStore?.load() ?? {}
  return resolveEffective(stored, clientConfigEnv())
}

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
 * terminal-file-explorer-v1 (FR-022): resolve a pane's absolute root (its `claude` cwd) from
 * the MAIN-owned session map, or `undefined` when the pane has no live session. The file
 * explorer + the `cosmos-file://` protocol confine every access to this root; the renderer
 * never supplies a root.
 */
function paneRoot(paneId: string): string | undefined {
  return terminalSessionMap.get(paneId)?.cwd
}

/**
 * terminal-file-explorer-v1: the real-disk `ExplorerFs` for the file explorer. Every probe is
 * TOTAL — it returns a sentinel on error rather than throwing (the manager turns those into
 * denied/not-found results). `readDir` reports per-entry dir/symlink flags; `readFileBytes`
 * reads the whole file (no size cap, FR-012); `watch` is a recursive `fs.watch` whose handle
 * the manager closes. `realpath` (from {@link ConfineFs}) canonicalizes for confinement.
 */
const diskExplorerFs: ExplorerFs = {
  realpath(p) {
    try {
      return realpathSync(p)
    } catch {
      return null
    }
  },
  readDir(absDir) {
    try {
      const dirents = readdirSync(absDir, { withFileTypes: true })
      return dirents.map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
        isSymlink: d.isSymbolicLink()
      }))
    } catch (err) {
      return { error: (err as NodeJS.ErrnoException)?.code === 'EACCES' ? 'denied' : 'not-found' }
    }
  },
  readFileBytes(absFile) {
    try {
      return readFileSync(absFile)
    } catch (err) {
      return { error: (err as NodeJS.ErrnoException)?.code === 'EACCES' ? 'denied' : 'not-found' }
    }
  },
  statSize(absFile) {
    // file-viewer-multiformat-v1 (FR-012): the file's size for the per-format document cap,
    // WITHOUT reading the bytes. Total — any stat error → null ("size unknown, do not refuse").
    try {
      return statSync(absFile).size
    } catch {
      return null
    }
  },
  watch(absRoot, onEvent) {
    try {
      const w = fsWatch(absRoot, { recursive: true }, () => onEvent())
      // A watcher error (e.g. the root vanished) must not crash main — swallow it; the
      // coarse re-list path tolerates a missed event.
      w.on('error', () => {})
      return { close: () => w.close() }
    } catch {
      return null
    }
  }
}

/** The file-explorer manager (terminal-file-explorer-v1). Built in `createWindow` once the
 * window exists (its change sink targets that window's `webContents`); released on teardown. */
let fsExplorer: FsExplorer | null = null

/**
 * Terminal sessions to RESUME on the next `pty:start` for that paneId (FR-020),
 * seeded from the snapshot at `session:load`. A paneId present here means its
 * `pty:start` should spawn `claude --resume <sessionId>` (in the persisted cwd)
 * rather than mint a fresh session. Consumed once per pane (deleted on use) so a
 * later manual restart starts fresh.
 */
const terminalResumeMap = new Map<string, { sessionId: string; cwd: string }>()

/**
 * Build the per-pane spawn options for a `pty:start` (D2/FR-019/FR-020/FR-022;
 * terminal-open-directory-picker-v1 FR-004). A pane queued for resume spawns
 * `--resume <id>` in its persisted cwd (resume:true so an abnormal early exit triggers
 * the fallback) and IGNORES `overrideCwd` (OQ-2); a fresh pane mints a `--session-id
 * <uuid>` and spawns in `overrideCwd ?? sandboxDir` — `overrideCwd` is the directory the
 * user chose via the native picker. Either way `terminalSessionMap` records the pane's
 * session id + (chosen) cwd for save. Resolution logic lives in the pure `resolvePaneSpawn`.
 */
function paneSpawnFor(
  paneId: string,
  sandboxDir: string,
  overrideCwd?: string
): ResolvedPaneSpawn {
  return resolvePaneSpawn(
    paneId,
    sandboxDir,
    terminalResumeMap,
    terminalSessionMap,
    randomUUID,
    overrideCwd,
    dirExistsOnDisk
  )
}

/**
 * session-resume-relaunch-v2: how many in-use retries this pane has used in the CURRENT recovery
 * sequence (paneId → attempt count). Reset to 0 when a non-retry `pty:start`/`pty:restart` for the
 * pane begins a fresh sequence, and cleared on dispose. Lets the re-entrant `onSessionInUse` (each
 * failed `--resume` fires it again) count attempts across the async backoff without a fresh mint.
 */
const terminalResumeAttempts = new Map<string, number>()

/**
 * session-resume-relaunch-v2: one step of the in-use SAME-ID resume backoff. Called every time a
 * `--resume <id>` attempt is rejected "already in use" (re-entrant: each failed retry fires
 * `onSessionInUse` again). It plans the next attempt via the pure {@link planResumeRetry} (which
 * also kills a still-alive orphan / removes a stale registry file), and either schedules a delayed
 * same-id re-`--resume` or — once the backoff budget is exhausted — surfaces a recoverable error.
 * The id is NEVER replaced with a fresh one on this path (that is the content-loss bug this fixes).
 */
function onSessionInUseForPane(paneId: string, sessionId: string): void {
  // A live session re-attached for this pane in the meantime (e.g. a later start won the race) —
  // do not touch any holder or schedule a retry against a now-live pane.
  if (ptyManager?.isRunning(paneId)) {
    terminalResumeAttempts.delete(paneId)
    return
  }
  const nextAttempt = (terminalResumeAttempts.get(paneId) ?? 0) + 1
  terminalResumeAttempts.set(paneId, nextAttempt)

  const plan = planResumeRetry(sessionId, nextAttempt, claudeSessionLockEnv)
  if (plan.action === 'give-up') {
    // Budget exhausted and the id is still held/rejected. Do NOT mint fresh (that orphans the
    // conversation). Surface a clear, recoverable error so the user can retry manually; the
    // recorded id stays correct so a later relaunch (after the holder finally dies) resumes it.
    terminalResumeAttempts.delete(paneId)
    console.warn(
      `[session] could not free in-use session ${sessionId} for pane ${paneId} after ${RESUME_RETRY_BACKOFF_MS.length} attempts; leaving id intact for a later resume`
    )
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(PtyChannel.Exit, {
        paneId,
        error:
          'This terminal’s previous Claude session is still shutting down (its id is briefly in use). It was not changed — reopen or restart this tab in a moment to resume it.'
      })
    }
    return
  }

  const prior = terminalSessionMap.get(paneId)
  const cwd = prior?.cwd ?? sandboxDirCached
  console.warn(
    `[session] in-use resume retry #${nextAttempt} for pane ${paneId} (id ${sessionId}, freedHolder=${plan.freedHolder}); waiting ${plan.delayMs}ms`
  )
  // session-resume-relaunch-v4: wipe the transient "Session ID <id> is already in use" line that the
  // just-failed `--resume` printed into the pane, so the user only ever sees the clean resumed
  // session — NOT on the give-up path (its error must stay visible) and NOT on a normal resume
  // (untouched). Sent through the existing PtyChannel.Data frame the renderer writes to xterm; clears
  // the visible screen only, preserving the restored scrollback.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(PtyChannel.Data, { paneId, data: IN_USE_RETRY_CLEAR_SEQUENCE })
  }
  // Wait one backoff slot for the dying holder to finish releasing the id, then re-`--resume` the
  // SAME id in the recorded cwd. A success leaves the pane live (no further onSessionInUse); a
  // repeat rejection re-enters this function and advances the attempt counter.
  setTimeout(() => {
    if (ptyManager?.isRunning(paneId)) {
      terminalResumeAttempts.delete(paneId)
      return // already recovered/replaced
    }
    ptyManager?.start(paneId, { args: ['--resume', sessionId], resume: true, cwd })
  }, plan.delayMs)
}

/**
 * restart-pty-cwd-v1: does `absDir` resolve to an existing directory on disk? Used by
 * `resolvePaneSpawn` to reject a stale persisted resume cwd (a deleted/renamed/moved repo)
 * before it reaches node-pty — resuming into a non-existent dir kills `claude` on spawn
 * (SIGHUP / exit 0) AND makes the file explorer deny every read (same cwd as its root).
 * Total: any stat error (missing / permission) is treated as "not a directory" (false).
 */
function dirExistsOnDisk(absDir: string): boolean {
  try {
    return statSync(absDir).isDirectory()
  } catch {
    return false
  }
}

/**
 * session-resume-relaunch-v1: the live {@link SessionLockEnv} backing the "already in use"
 * recovery. claude tracks every running interactive session in `~/.claude/sessions/<pid>.json`
 * (`{ pid, sessionId, cwd, ... }`); a `--resume`/`--session-id` spawn is rejected when an entry
 * names the id with a still-alive pid. This env reads that registry, probes pid liveness
 * (`process.kill(pid, 0)`), and frees the id by killing the orphan / removing a stale file. All
 * side-effects are best-effort and never throw (the resolver tolerates partial failure).
 */
const claudeSessionLockEnv: SessionLockEnv = {
  listRegistryFiles: () => {
    const dir = join(app.getPath('home'), '.claude', 'sessions')
    try {
      return readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(dir, name))
    } catch {
      return [] // no registry dir / unreadable → nothing to recover
    }
  },
  readEntry: (filePath) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath).toString('utf8'))
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { pid?: unknown }).pid === 'number' &&
        typeof (parsed as { sessionId?: unknown }).sessionId === 'string'
      ) {
        const e = parsed as { pid: number; sessionId: string }
        return { pid: e.pid, sessionId: e.sessionId }
      }
    } catch {
      // unreadable / unparsable / foreign-shaped → skip
    }
    return null
  },
  isAlive: (pid) => {
    try {
      // Signal 0 performs the permission/existence check without delivering a signal.
      process.kill(pid, 0)
      return true
    } catch (err) {
      // ESRCH → dead. EPERM → alive but not ours (treat as alive so we never remove a live entry).
      return (err as NodeJS.ErrnoException)?.code === 'EPERM'
    }
  },
  // Defense-in-depth (session-resume-relaunch-v2): true when `pid` is THIS process or one of its
  // direct children — the latter being the embedded `claude` we spawned (ppid === our pid). An
  // ORPHAN from a previous launch was reparented (its old cosmos died), so its ppid is launchd (1),
  // never us — hence it is correctly NOT "own". Best-effort via `ps`; any failure → false ("not
  // ours"), preserving the prior behaviour so a transient ps error never blocks a real recovery.
  isOwnProcess: (pid) => {
    if (pid === process.pid) {
      return true
    }
    try {
      const ppid = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1000
      }).trim()
      return ppid === String(process.pid)
    } catch {
      return false
    }
  },
  killPid: (pid) => {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone / not permitted → best-effort
    }
  },
  removeFile: (filePath) => {
    try {
      rmSync(filePath, { force: true })
    } catch {
      // best-effort
    }
  }
}

/**
 * session-resume-relaunch-v4 (orphan prevention, part c): at STARTUP, find and SIGKILL any of THIS
 * install's MCP-server processes (`node <app>/out/main/mcp/<X>Server.js`) left ORPHANED by a previous
 * run — an abrupt cosmos termination (sleep/force-quit/SIGKILL never ran teardown), or pre-existing
 * orphans from before the teardown fix. A backstop that matches by COMMAND + SOCKET signature (not by
 * process group), so it also catches a server that escaped the group teardown via its own `setsid`.
 *
 * The selection is the pure {@link selectOrphanMcpServers}: it only picks a process that (1) is one
 * of OUR server scripts under THIS app's out dir AND references THIS install's sandbox socket dir,
 * (2) is genuinely orphaned (reparented to launchd, or its `claude` leader is dead), and (3) has
 * pid > 1 — so a concurrent second cosmos's LIVE servers and any unrelated process are never touched.
 * Best-effort: a `ps` failure / kill error never throws (startup must not be blocked).
 */
function reapOrphanMcpServers(): void {
  // Env-augmented snapshot (`-E`): macOS appends the process env to the command, so the
  // `COSMOS_*_BRIDGE_SOCKET=<sandbox>/...` value is visible for the install-scoping match.
  let raw: string
  try {
    raw = execFileSync('ps', ['-axEww', '-o', 'pid=,ppid=,pgid=,command='], {
      encoding: 'utf8',
      timeout: 4000,
      maxBuffer: 8 * 1024 * 1024
    })
  } catch {
    return // ps unavailable / errored → skip reaping (never block startup)
  }

  const snapshot: ProcSnapshotRow[] = []
  for (const line of raw.split('\n')) {
    // "  pid  ppid  pgid  command...". Split off the three leading integer columns; the rest (which
    // may contain spaces — paths, env) is the command line, kept intact.
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) {
      continue
    }
    snapshot.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] })
  }

  const signature: CosmosMcpSignature = {
    // `<app.getAppPath()>/out/main/mcp/` — the exact dir our server scripts are bundled under (the
    // same `join(__dirname, 'mcp/<X>Server.js')` the mcpConfig entries use, __dirname = out/main).
    outDirMarker: join(app.getAppPath(), 'out', 'main', 'mcp') + sep,
    // `<userData>/sandbox` — this install's bridge-socket dir (resolveSandboxDir's parent of the
    // `.cosmos-*.sock` files), so a different install instance's servers are left alone.
    sandboxMarker: join(app.getPath('userData'), 'sandbox')
  }

  const orphans = selectOrphanMcpServers(snapshot, signature)
  if (orphans.length === 0) {
    return
  }
  console.warn(`[session] reaping ${orphans.length} orphaned cosmos MCP server(s) from a previous run`)
  for (const pid of orphans) {
    // Reuse the negative-pid SAFETY GATE: kill the orphan's whole GROUP (it may itself lead a small
    // group), then the pid directly as a fallback. Both best-effort.
    try {
      if (canGroupKill(pid)) {
        process.kill(-pid, 'SIGKILL')
      }
    } catch {
      // group already gone / not permitted
    }
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
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
      // Google Calendar generative-UI v1 (Track A): the Google-Calendar-scoped render tool.
      // Same UiBridge socket; the entry stamps `target: 'google-calendar'` so its surfaces
      // land in the Google Calendar panel (Track B). Built from mcpConfig.ts so it can't drift.
      [GOOGLE_CALENDAR_RENDER_UI_SERVER_NAME]: googleCalendarRenderUiMcpServerEntry(sandboxDir),
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
      },
      // Google Calendar read-only tools (Track A); its OWN separate bridge socket.
      // Built from mcpConfig.ts (googleCalendarToolsMcpServerEntry) so it can't drift.
      [GOOGLE_CALENDAR_TOOLS_SERVER_NAME]: googleCalendarToolsMcpServerEntry(sandboxDir)
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
      // settings-oauth-clients-v1 (FR-010): read the EFFECTIVE Slack client id from
      // the resolver (Settings-over-env) at connect time, so a Settings save takes
      // effect with no restart. Still fail-fast with a clear "not configured" message.
      const clientId = effectiveClientConfig().slackClientId
      if (!clientId) {
        return Promise.reject(
          new Error('No Slack client ID is configured (set it in Settings or COSMOS_SLACK_CLIENT_ID) — cannot start the Slack OAuth flow.')
        )
      }
      return runSlackOAuth({
        clientId,
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    // slack-oauth-keeps-unlinking-v1: refresh a rotating user token via the same effective
    // public client id (Settings-over-env). PKCE — no secret. Only invoked when a refresh
    // token was persisted (rotation-enabled apps); a classic xoxp token never has one.
    refresh: (refreshTok: string) => {
      const clientId = effectiveClientConfig().slackClientId
      if (!clientId) {
        return Promise.reject(
          new Error('No Slack client ID is configured — cannot refresh the Slack token.')
        )
      }
      return refreshSlackToken({ clientId, refreshToken: refreshTok })
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
      // settings-oauth-clients-v1 (FR-010): the ONE Atlassian client (id + optional
      // secret) is resolved Settings-over-env at connect time. The secret stays in main
      // (FR-007) — read here, attached to the OAuth exchange, never logged/IPC'd.
      const eff = effectiveClientConfig()
      if (!eff.atlassianClientId) {
        // FR-A04: fail fast with a clear "not configured" message; no token stored.
        return Promise.reject(
          new Error('No Atlassian client ID is configured (set it in Settings or COSMOS_ATLASSIAN_CLIENT_ID) — cannot start the Jira OAuth flow.')
        )
      }
      return runAtlassianOAuth({
        scopes: JIRA_OAUTH_SCOPES,
        clientId: eff.atlassianClientId,
        ...(eff.atlassianClientSecret ? { clientSecret: eff.atlassianClientSecret } : {}),
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    refresh: (refreshToken: string) => {
      const eff = effectiveClientConfig()
      return refreshAtlassianToken({
        clientId: eff.atlassianClientId ?? '',
        ...(eff.atlassianClientSecret ? { clientSecret: eff.atlassianClientSecret } : {}),
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
      const eff = effectiveClientConfig()
      if (!eff.atlassianClientId) {
        return Promise.reject(
          new Error(
            'No Atlassian client ID is configured (set it in Settings or COSMOS_ATLASSIAN_CLIENT_ID) — cannot start the Confluence OAuth flow.'
          )
        )
      }
      return runAtlassianOAuth({
        scopes: CONFLUENCE_OAUTH_SCOPES,
        clientId: eff.atlassianClientId,
        ...(eff.atlassianClientSecret ? { clientSecret: eff.atlassianClientSecret } : {}),
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    refresh: (refreshToken: string) => {
      const eff = effectiveClientConfig()
      return refreshAtlassianToken({
        clientId: eff.atlassianClientId ?? '',
        ...(eff.atlassianClientSecret ? { clientSecret: eff.atlassianClientSecret } : {}),
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

/**
 * Build the GoogleCalendarManager + its foundation (token store, client, OAuth runner,
 * refresher). Google Calendar integration v1 (Track A) — READ-ONLY. Google is a
 * CONFIDENTIAL client, so the client id + secret are resolved Settings-over-env at
 * connect time and read here in main only; the secret is attached to the OAuth/refresh
 * exchange and NEVER logged, IPC'd, bridged, or returned (SC-009). The token lives only
 * here, encrypted via safeStorage. Status changes push to the renderer as
 * `googleCalendar:statusChanged`. Fully separate connection (its own encrypted token).
 */
function createGoogleCalendarManager(window: BrowserWindow): GoogleCalendarManager {
  const tokenStore = new TokenStore({
    filePath: join(app.getPath('userData'), 'integrations', 'googleCalendar.token.enc'),
    dirPath: join(app.getPath('userData'), 'integrations'),
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync }
  })
  const client = new GoogleCalendarClient()
  return new GoogleCalendarManager({
    client,
    tokenStore,
    runOAuth: () => {
      // Resolve the EFFECTIVE Google client id + secret (Settings-over-env) at connect
      // time, so a Settings save takes effect with no restart. Google is confidential —
      // BOTH the id and the secret are required; fail fast with a clear message when
      // either is missing (no token stored). The secret stays in main.
      const eff = effectiveClientConfig()
      if (!eff.googleClientId || !eff.googleClientSecret) {
        return Promise.reject(
          new Error(
            'Google Calendar is not configured (set the client ID + secret in Settings or COSMOS_GOOGLE_CLIENT_ID / COSMOS_GOOGLE_CLIENT_SECRET) — cannot start the Google OAuth flow.'
          )
        )
      }
      return runGoogleOAuth({
        scopes: GOOGLE_CALENDAR_OAUTH_SCOPES,
        clientId: eff.googleClientId,
        clientSecret: eff.googleClientSecret,
        openExternal: (url: string) => {
          void shell.openExternal(url)
        }
      })
    },
    refresh: (refreshTok: string) => {
      const eff = effectiveClientConfig()
      return refreshGoogleToken({
        clientId: eff.googleClientId ?? '',
        clientSecret: eff.googleClientSecret ?? '',
        refreshToken: refreshTok
      })
    },
    onStatusChanged: (status: GoogleCalendarConnectionStatus) => {
      if (!window.isDestroyed()) {
        window.webContents.send(GoogleCalendarChannelName.StatusChanged, status)
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
        // terminal-cwd-persist-v1: do NOT delete from terminalSessionMap on exit.
        // The cwd must survive the PTY's lifetime so (a) enrichSnapshotForSave can
        // persist the tab across exits (the tab reappears on next restart with the
        // correct cwd) and (b) pty:restart can re-spawn in the same folder. The
        // session entry is removed only on explicit tab DISPOSE (FR-018/FR-019 —
        // that handler already calls terminalSessionMap.delete).
        // terminal-file-explorer-v1 (FR-006/FR-016): the pane's root is no longer live; release
        // its fs watcher so it never fires against a dead root.
        fsExplorer?.stopWatch(payload.paneId)
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
      },
      // session-resume-relaunch-v1: claude REJECTED the recorded id with "Session ID <id> is
      // already in use" — a LIVE ORPHAN claude (survived a prior un-clean cosmos exit: macOS sleep,
      // force-quit, SIGKILL) or a stale `~/.claude/sessions/<pid>.json` holds it. Free the id (kill
      // the orphan / remove the stale file) and re-`--resume` the SAME id ONCE in its recorded cwd.
      // NEVER mint a fresh id (that orphans the conversation — the bug this whole feature fixes).
      // Guard: only attempt recovery when THIS process has no live PTY for the pane (the manager
      // already deleted the dead session before firing), so we can only ever kill a true orphan,
      // never a sibling pane's just-spawned claude.
      onSessionInUse: (paneId, sessionId) => onSessionInUseForPane(paneId, sessionId)
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
    // terminal-open-directory-picker-v1 FR-004: a freshly-picked tab carries the chosen
    // `cwd`; for a fresh spawn it overrides the sandbox cwd (a resumed pane ignores it).
    // session-resume-relaunch-v2: a renderer-driven start begins a FRESH recovery sequence, so
    // reset the in-use retry counter (a stale count from a prior pane lifecycle must not shorten it).
    terminalResumeAttempts.delete(payload.paneId)
    ptyManager?.start(payload.paneId, paneSpawnFor(payload.paneId, sandboxDirCached, payload.cwd))
  })

  // terminal-open-directory-picker-v1 (FR-002/FR-003/FR-006): open the native OS
  // directory picker in MAIN and resolve with the chosen absolute path, or null on
  // cancel. Request/response (`invoke`/`handle`); any inbound arg is ignored (the
  // request carries no field). A dialog error resolves to `{ path: null }` (cancel-like)
  // rather than rejecting, so the renderer never crashes (SC-005). The chosen path is a
  // user-selected local filesystem path, NOT a secret — and it is not logged here.
  ipcMain.handle(PtyChannel.PickDirectory, async (): Promise<PtyPickDirectoryResult> => {
    try {
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) {
        return { path: null }
      }
      return { path: result.filePaths[0] }
    } catch {
      // Treat any dialog failure as a cancel — no spawn, no error surfaced (FR-006).
      return { path: null }
    }
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
  // terminal-cwd-persist-v1: pass the recorded cwd from terminalSessionMap so a
  // restart after exit re-spawns in the correct folder (not the sandbox default).
  // ptyManager.restart reads from its own dead session map after an exit and would
  // fall back to sandbox; paneSpawnFor reads terminalSessionMap which survives exits.
  //
  // session-resume-relaunch-v1 (THE FIX): a restart MUST CONTINUE the pane's recorded
  // `claude` session (same session id) — NOT mint a fresh one. This handler is the path a
  // user takes to recover a terminal whose PTY died on Mac sleep/wake (the PTY exits, the
  // renderer shows the exit banner, the user clicks Restart). Minting `randomUUID()` here —
  // the previous behaviour — overwrote `terminalSessionMap[paneId]` with an EMPTY session
  // that has no conversation on disk, ORPHANING the original conversation (content "lost",
  // and the next save persisted the empty fresh id so `--resume` later found nothing). This
  // violated FR-019 (stable session id) / FR-020 (resume the recorded session). Re-using the
  // recorded id with `--session-id` (CREATE-OR-CONTINUE — continues a populated session, and
  // never prints "No conversation found" on an empty one) preserves the conversation across
  // a restart. Only a pane with NO recorded session (never started / already disposed) mints
  // a fresh id. The whole resolution (reuse-vs-mint + the stale-cwd guard) lives in the pure,
  // node-tested `resolvePaneSpawn`, so this handler simply delegates — no override cwd, so a
  // recorded pane takes the idempotent reuse branch in its recorded cwd.
  ipcMain.on(PtyChannel.Restart, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateRestart(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    // session-resume-relaunch-v2: a manual restart begins a fresh recovery sequence.
    terminalResumeAttempts.delete(payload.paneId)
    ptyManager?.start(payload.paneId, paneSpawnFor(payload.paneId, sandboxDirCached))
  })

  // panel-tabs v1 FR-023: dispose/kill the addressed pane's PTY on tab close. No
  // exit event is emitted (the tab is gone); other panes are unaffected.
  ipcMain.on(PtyChannel.Dispose, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateDispose(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    // session-persistence-v1: a closed tab is no longer queued for resume — drop its
    // resume entry (FR-018).
    //
    // terminal-cwd-sandbox-v1: do NOT delete `terminalSessionMap` here. React StrictMode
    // (dev) unmounts a terminal tab and IMMEDIATELY remounts it, firing dispose BETWEEN the
    // two `pty:start` calls for the SAME paneId. If dispose wiped the session record, the
    // remount's `pty:start` would find no resume entry (consumed by start #1) and no session
    // record, fall to the FRESH branch, and mint a brand-new `--session-id` in the sandbox —
    // permanently overwriting the pane's real cwd (the cwd-sandbox bug). Keeping the record
    // lets `resolvePaneSpawn` re-resume the SAME session in the SAME cwd on the remount
    // (idempotent re-start). A genuinely-closed tab's stale record is harmless: paneIds are
    // minted fresh per tab (never reused), enrichSnapshotForSave only enriches tabs the
    // renderer snapshot still lists (a closed tab is absent), and its fs watcher is stopped
    // below — so the lingering entry is never read. This mirrors the keep-on-exit policy in
    // `onExit` (the record outlives the PTY so a restart re-spawns in the right folder).
    terminalResumeMap.delete(payload.paneId)
    // session-resume-relaunch-v2: a disposed pane has no pending in-use recovery — drop its counter.
    terminalResumeAttempts.delete(payload.paneId)
    // terminal-file-explorer-v1 (FR-016): release the pane's fs watcher on tab close so no
    // watcher leaks. (The session map delete above also makes its root unresolvable.)
    fsExplorer?.stopWatch(payload.paneId)
    ptyManager?.kill(payload.paneId)
  })

  // terminal-file-explorer-v1 (FR-004/FR-022/FR-023): list a root-relative directory for the
  // tree. Validated at the boundary (invalid → warn + ignore → denied result, never a crash).
  // Main resolves the root by paneId and CONFINES the path; an out-of-root/missing/denied
  // target yields a typed failure, never an out-of-root read (SC-005).
  ipcMain.handle(FsChannel.List, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const payload = validateFsPath(raw, FsChannel.List)
    if (!payload) {
      return { ok: false as const, reason: 'out-of-root' as const }
    }
    return fsExplorer?.list(payload.paneId, payload.relPath) ?? { ok: false, reason: 'out-of-root' }
  })

  // terminal-file-explorer-v1 (FR-008/FR-009/FR-010/FR-011): read a root-relative file for the
  // viewer. Returns a text body, an image MARKER (bytes ride `cosmos-file://`, not IPC), or a
  // not-previewable reason — never raw binary bytes, never a throw.
  ipcMain.handle(FsChannel.Read, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const payload = validateFsPath(raw, FsChannel.Read)
    if (!payload) {
      return { ok: false as const, reason: 'out-of-root' as const }
    }
    return fsExplorer?.read(payload.paneId, payload.relPath) ?? { ok: false, reason: 'out-of-root' }
  })

  // file-viewer-multiformat-v1 (FR-007/FR-012): read a routed DOCUMENT file's RAW BYTES for the
  // byte-consuming renderers (pdf/docx/sheet). Replaces the cross-scheme `cosmos-file://` fetch
  // Chromium blocks from the http dev origin. Validated at the boundary (invalid → warn + ignore
  // → out-of-root, never a crash). Main resolves the root by paneId, CONFINES the path, and
  // enforces the per-format size cap BEFORE reading — an oversize/out-of-root/missing target
  // yields a typed failure, never an out-of-root read and never an absolute-path leak.
  ipcMain.handle(FsChannel.ReadBytes, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const payload = validateFsPath(raw, FsChannel.ReadBytes)
    if (!payload) {
      return { ok: false as const, reason: 'out-of-root' as const }
    }
    return (
      fsExplorer?.readBytes(payload.paneId, payload.relPath) ?? { ok: false, reason: 'out-of-root' }
    )
  })

  // terminal-file-explorer-v1 (FR-015/FR-016): begin watching this pane's root. A pane with no
  // live root creates no watcher (FR-006). Fire-and-forget; validated.
  ipcMain.on(FsChannel.WatchStart, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateFsWatch(raw, FsChannel.WatchStart)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    fsExplorer?.startWatch(payload.paneId)
  })

  // terminal-file-explorer-v1 (FR-016): release this pane's watcher (explorer unmount).
  ipcMain.on(FsChannel.WatchStop, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateFsWatch(raw, FsChannel.WatchStop)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    fsExplorer?.stopWatch(payload.paneId)
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

  // cosmos-conversation-panel-v2 (step 3, FR-106): the Cosmos panel reads the full
  // default-session conversation on demand (panel mount). The reader owns all `~/.claude`
  // access (confined to the one default-session transcript path — FR-105) and NEVER throws:
  // a missing file → empty, a corrupt file → unreadable (FR-108). The result is validated at
  // the boundary so a malformed/secret-bearing frame is dropped (FR-118); a null validation
  // falls back to the empty state. No renderer path is ever accepted (the invoke has no arg).
  ipcMain.handle(ConversationChannel.Fetch, () => {
    const result = transcriptReader?.read() ?? { ok: false as const, reason: 'empty' as const }
    return validateConversationResult(result) ?? { ok: false as const, reason: 'empty' as const }
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
    // jira-generative-adapter-v1 (FR-010/FR-019): a `submit` whose actionId is in the
    // reserved `adapter.*` namespace (refresh / loadMore / page) is DETERMINISTICALLY
    // routed to the shared AdapterDispatcher — NOT returned to Claude. It re-executes
    // the bound surface's descriptor and pushes `updateDataModel` (not a full re-push).
    // Validated at the boundary: an invalid/unknown adapter.* (e.g. bad direction or
    // missing surfaceId) is warned + ignored (FR-022). Same interception discipline as
    // the `jira.*` write path below — one coherent main-side dispatch (FR-011).
    if (payload.action.type === 'submit' && payload.action.actionId?.startsWith('adapter.')) {
      const request = validateAdapterAction(
        payload.action.actionId,
        payload.action.values,
        (m, ...a) => console.warn(m, ...a)
      )
      if (request && adapterDispatcher) {
        const surfaceId = request.surfaceId
        if (request.name === 'adapter.refresh') {
          // FR-013: a restore/re-activation refresh may carry the persisted descriptor OR
          // bindings for a surface main never freshly composed; lazily (re-)register it so the
          // refresh has a registration to run. MULTI-region bindings win (a partitioned surface
          // persists `bindings`); a single-region surface persists `descriptor`.
          if (request.bindings && !adapterDispatcher.has(surfaceId)) {
            // planRegions derives the SAME regionKeys/options compose used (single source of
            // truth), so a restored surface re-registers each container under its own region.
            for (const region of planRegions(request.bindings)) {
              adapterDispatcher.register(surfaceId, region.descriptor, region.options, region.regionKey)
            }
          } else if (request.descriptor && !adapterDispatcher.has(surfaceId)) {
            // Panel-agnostic bind-options selection: a restored descriptor may be a Slack,
            // Confluence, OR a Jira source. slack-/confluence-generative-adapter-v1
            // (FR-015): consult the Slack selector first (append-only lists), then the
            // Confluence selector (append lists + none detail); fall back to the Jira
            // detail/list split.
            const slackOpts = slackBindOptionsForSource(request.descriptor.dataSource)
            const confluenceOpts = confluenceBindOptionsForSource(request.descriptor.dataSource)
            const opts =
              slackOpts ??
              confluenceOpts ??
              (request.descriptor.dataSource === JiraAdapterSource.GetIssue
                ? jiraDetailBindOptions
                : jiraListBindOptions)
            adapterDispatcher.register(surfaceId, request.descriptor, opts)
          }
          // No region ⇒ fan out to EVERY region (surface-level refresh / restore); a region ⇒
          // reload just that container's fetcher (the user's per-component refresh event).
          if (request.region) {
            void adapterDispatcher.refresh(surfaceId, request.region)
          } else {
            void adapterDispatcher.refreshSurface(surfaceId)
          }
        } else if (request.name === 'adapter.loadMore') {
          void adapterDispatcher.loadMore(surfaceId, request.region ?? '')
        } else {
          void adapterDispatcher.page(surfaceId, request.direction, request.region ?? '')
        }
      }
      // Adapter actions never resolve a pending render_ui call; stop here.
      return
    }

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
    // open-prompt-view-context-v1: thread the validated non-secret viewContext so deictic
    // utterances resolve via grounding (FR-007); absent ⇒ exactly today's behaviour.
    agentRunner?.run(payload.utterance, payload.target, payload.viewContext)
  })

  registerSlackIpcHandlers()
  registerJiraIpcHandlers()
  registerConfluenceIpcHandlers()
  registerGoogleCalendarIpcHandlers()
  registerSettingsIpcHandlers()
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
  // oauth-cancel-v1: abort an in-flight connect so a cancelled browser consent returns to
  // not_connected immediately (no 3-minute timeout wait). No payload, no token.
  ipcMain.handle(SlackChannelName.CancelConnect, () => slackManager?.cancelConnect() ?? notReady)

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
  // slack-send-message-v1 (FR-004/FR-005): the first write. Validate at the boundary
  // (object + non-empty channelId + non-empty text + optional threadTs); main attaches
  // the token inside SlackManager — it never crosses this channel (FR-006).
  ipcMain.handle(SlackChannelName.Send, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateSlackSend(raw)
    if (!params || !slackManager) {
      return badParams
    }
    return slackManager.sendMessage(params)
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
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent) → not_connected.
  ipcMain.handle(JiraChannelName.CancelConnect, () => jiraManager?.cancelConnect() ?? notReady)

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
    // jira-generative-adapter-v1 (FR-004/FR-008): compose a BOUND list surface (rows +
    // flags read the data model), register its secret-free descriptor with the
    // dispatcher so refresh / load-more can re-execute it, and push the render frame
    // carrying the initial data model + descriptor (the renderer seeds + persists them).
    const bound = buildBoundIssueListSurface(SURFACE_DEFAULT_VIEW, jql, result.data)
    adapterDispatcher?.register(bound.spec.surfaceId, bound.descriptor, jiraListBindOptions)
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: bound.spec,
      dataModel: bound.dataModel,
      descriptor: bound.descriptor,
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
    // jira-generative-adapter-v1 (FR-004/FR-020): the detail is a BOUND, refreshable
    // (pagination 'none') surface — its header reads the single bound issue value, so a
    // later refresh / post-write push replaces it in place. Register the getIssue
    // descriptor + push the seed + descriptor with the frame.
    const bound = buildBoundIssueDetailSurface(SURFACE_ISSUE_DETAIL, result.data)
    adapterDispatcher?.register(bound.spec.surfaceId, bound.descriptor, jiraDetailBindOptions)
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: bound.spec,
      dataModel: bound.dataModel,
      descriptor: bound.descriptor,
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
 * Register the Google Calendar IPC handlers (Google Calendar integration v1, Track A).
 * READ-ONLY — `getStatus`/`connect`/`disconnect`/`listEvents` + the per-switch default
 * view. Same validate-at-the-boundary + token-stays-in-main discipline as Jira (SC-009).
 * No write handler, no action dispatcher, no scope-gate.
 */
function registerGoogleCalendarIpcHandlers(): void {
  const notReady: GoogleCalendarConnectionStatus = { state: 'not_connected' }
  const badParams = { ok: false as const, kind: 'network' as const, message: 'Invalid request.' }

  ipcMain.handle(GoogleCalendarChannelName.GetStatus, () => googleCalendarManager?.getStatus() ?? notReady)
  ipcMain.handle(GoogleCalendarChannelName.Connect, () => googleCalendarManager?.connect() ?? notReady)
  ipcMain.handle(GoogleCalendarChannelName.Disconnect, () => googleCalendarManager?.disconnect() ?? notReady)
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent) → not_connected.
  ipcMain.handle(GoogleCalendarChannelName.CancelConnect, () => googleCalendarManager?.cancelConnect() ?? notReady)

  ipcMain.handle(GoogleCalendarChannelName.ListEvents, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateGoogleCalendarListEvents(raw)
    if (!params || !googleCalendarManager) {
      return badParams
    }
    return googleCalendarManager.listEvents(params)
  })

  // The Google Calendar panel wants the default view. Run ONE bounded events read (single
  // page, NO pagination loop) over the target month's window (current month when no target
  // is supplied), compose the default view, and push it `target: 'google-calendar'`.
  // Fire-and-forget: the rail switch never blocks here. Validate at the boundary with the
  // CALENDAR-SPECIFIC validator (calendar-month-year-nav-v1): an absent OR invalid target
  // returns `{}` → current-month fallback (the tab still repaints, never hangs); only a
  // non-object is dropped (`null`).
  ipcMain.on(GoogleCalendarChannelName.RequestDefaultView, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateGoogleCalendarRequestDefaultView(raw)
    if (!payload || !googleCalendarManager) {
      return // non-object -> warned + dropped; or manager not ready
    }
    // calendar-week-day-views-v1 (FR-012): the validated payload carries the (optional) 1-based
    // anchor + granularity. A complete { year, month } navigates; an empty {} (absent/invalid)
    // ⇒ current month; `view`/`day` select the week/day window (the window builder owns the
    // 1→0 conversion + the Sunday week / single-day spans). Pass the validated payload straight
    // through as the anchor — it is structurally `{ year?, month?, day?, view? }`, no secret.
    const anchor: GoogleCalendarDefaultViewAnchor | undefined =
      payload.year !== undefined ||
      payload.month !== undefined ||
      payload.day !== undefined ||
      payload.view !== undefined
        ? payload
        : undefined
    void handleGoogleCalendarDefaultView(anchor)
  })
}

/**
 * Run a bounded Google Calendar events read over a forward window and push the composed
 * surface `target: 'google-calendar'` (Track A). Mirrors `handleJiraView` structurally
 * but with the simpler UN-BOUND default-view builder (the refreshable adapter binding is
 * Track B / deferred):
 *  - on `ok` → `buildDefaultViewSurface(page, window)` (EventList, incl. its empty state).
 *  - on `reconnect_needed`/`not_connected` → push NOTHING; the manager drives
 *    `statusChanged` so the panel routes to the native Connect/Reconnect.
 *  - on any other failure (`rate_limited`/`network`, or a thrown error) → push a single
 *    calm, recoverable `Notice` surface. Never throws; never blocks the rail switch.
 * Read-only — NOT an AgentRunner run; the token stays in main.
 */
async function handleGoogleCalendarDefaultView(
  anchor?: GoogleCalendarDefaultViewAnchor
): Promise<void> {
  if (!googleCalendarManager) {
    return
  }
  const window = googleCalendarDefaultWindow(anchor)
  // calendar-week-day-views-v1 (FR-001): the granularity rides onto the EventList root so the
  // catalog routes month grid vs week/day schedule. Absent ⇒ 'month' (the catalog's default).
  const view = anchor?.view ?? 'month'
  let result
  try {
    // shared-calendars-v1 (FR-004): aggregate events from ALL accessible calendars over the
    // SAME month window (bounded fan-out merge, partial failures degrade per FR-012).
    result = await googleCalendarManager.listAggregatedEvents(window)
  } catch (err) {
    console.warn('[google-calendar] view read threw (handled):', err instanceof Error ? err.message : err)
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildGoogleCalendarNoticeSurface({
        kind: 'error',
        message: 'Could not load your calendar. Try again shortly.'
      }),
      target: 'google-calendar'
    })
    return
  }

  if (result.ok) {
    // The calendars[]-bearing EventList root feeds BOTH the native panel and the agent/MCP
    // render path (FR-016); the per-calendar legend + color-by-calendar live in the catalog.
    pushRenderToRenderer({
      requestId: randomUUID(),
      spec: buildGoogleCalendarSharedViewSurface(result.data, window, view),
      target: 'google-calendar'
    })
    return
  }

  // reconnect_needed / not_connected route through the native Connect/Reconnect
  // (statusChanged); don't push a surface for them.
  if (result.kind === 'reconnect_needed' || result.kind === 'not_connected') {
    return
  }

  // rate_limited / network -> a calm recoverable Notice.
  pushRenderToRenderer({
    requestId: randomUUID(),
    spec: buildGoogleCalendarNoticeSurface({ kind: 'error', message: result.message }),
    target: 'google-calendar'
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
  // oauth-cancel-v1: abort an in-flight connect (cancelled browser consent) → not_connected.
  ipcMain.handle(ConfluenceChannelName.CancelConnect, () => confluenceManager?.cancelConnect() ?? notReady)

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
  // confluence-dock-comments-v1: read a page's footer comments (+ one-level reply tree).
  ipcMain.handle(ConfluenceChannelName.GetComments, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateConfluenceGetComments(raw)
    if (!params || !confluenceManager) {
      return badParams
    }
    return confluenceManager.getComments(params)
  })
  // confluence-dock-comments-v1: add a footer comment (renderer write path, reuses createComment).
  ipcMain.handle(ConfluenceChannelName.AddComment, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const params = validateConfluenceAddComment(raw)
    if (!params || !confluenceManager) {
      return badParams
    }
    return confluenceManager.addComment(params)
  })
}

/**
 * settings-oauth-clients-v1 — the `settings:` handlers (FR-004/FR-007/FR-008).
 * GetConfig returns the renderer-safe status (never the secret value). Save and
 * ClearField persist into the encrypted main-only store, then — if a client's
 * EFFECTIVE id/secret changed (diffEffective) — force-disconnect the affected
 * integration(s): Slack→Slack; Atlassian→Jira AND Confluence. The raw payload is
 * never logged (a secret may ride in Save), so failures pass only descriptive text.
 */
function registerSettingsIpcHandlers(): void {
  ipcMain.handle(SettingsChannelName.GetConfig, () =>
    toStatus(clientConfigStore?.load() ?? {}, clientConfigEnv())
  )

  ipcMain.handle(SettingsChannelName.Save, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const payload = validateClientConfigSave(raw)
    if (!payload) {
      return invalidSaveResult()
    }
    return applyClientConfigMutation((current) => mergeClientConfigSave(current, payload))
  })

  ipcMain.handle(SettingsChannelName.ClearField, (_e: IpcMainInvokeEvent, raw: unknown) => {
    const payload = validateClientConfigClear(raw)
    if (!payload) {
      return invalidSaveResult()
    }
    return applyClientConfigMutation((current) => clearClientConfigField(current, payload.field))
  })
}

/** A renderer-safe failure result for a payload the boundary validator rejected. */
function invalidSaveResult(): ClientConfigSaveResult {
  return {
    ok: false,
    errorKind: 'invalid',
    message: 'The settings payload was malformed and was ignored.',
    status: toStatus(clientConfigStore?.load() ?? {}, clientConfigEnv()),
    disconnected: { slack: false, jira: false, confluence: false, 'google-calendar': false }
  }
}

/**
 * Persist a mutation, then force-disconnect any integration whose EFFECTIVE creds
 * changed. Refuses to write plaintext when encryption is unavailable (the store
 * throws); on that or any write failure nothing is persisted and the prior status
 * is returned. Never logs the config (secret-bearing).
 */
function applyClientConfigMutation(
  mutate: (current: ClientConfig) => ClientConfig
): ClientConfigSaveResult {
  const env = clientConfigEnv()
  const before = effectiveClientConfig()
  const current = clientConfigStore?.load() ?? {}
  const next = mutate(current)

  try {
    clientConfigStore?.save(next)
  } catch (err) {
    const encryption = err instanceof ClientConfigEncryptionUnavailableError
    return {
      ok: false,
      errorKind: encryption ? 'encryption_unavailable' : 'write_failed',
      message: encryption
        ? 'OS encryption is unavailable, so the credentials were not saved.'
        : 'The credentials could not be written to disk.',
      status: toStatus(current, env),
      disconnected: { slack: false, jira: false, confluence: false, 'google-calendar': false }
    }
  }

  const after = resolveEffective(next, env)
  const changed = diffEffective(before, after)
  const disconnected = { slack: false, jira: false, confluence: false, 'google-calendar': false }
  if (changed.slack && slackManager?.getStatus().state === 'connected') {
    slackManager.disconnect()
    disconnected.slack = true
  }
  if (changed.atlassian) {
    if (jiraManager?.getStatus().state === 'connected') {
      jiraManager.disconnect()
      disconnected.jira = true
    }
    if (confluenceManager?.getStatus().state === 'connected') {
      confluenceManager.disconnect()
      disconnected.confluence = true
    }
  }
  // google-calendar-v1 (Track A): an effective Google client id/secret change
  // force-disconnects the Google Calendar connection — INDEPENDENT of Slack/Atlassian.
  if (changed.google && googleCalendarManager?.getStatus().state === 'connected') {
    googleCalendarManager.disconnect()
    disconnected['google-calendar'] = true
  }

  return { ok: true, status: toStatus(next, env), disconnected }
}

/**
 * open-prompt-spinner-gating-v1 (FR-001/FR-002): whether the CURRENT headless run has
 * pushed a `generated-ui` `ui:render` surface frame. Plain main-side state — `AgentRunner`
 * is single-run (at most one child in flight), so a single boolean is sufficient. Set in
 * `pushRenderToRenderer` (the one place main learns a generated-ui surface is produced),
 * reset on a run's `started`, and read+reset when stamping the terminal `completed` status.
 * It is the non-secret source of the `producedSurface` signal (no token/transcript).
 */
let renderPushedForRun = false

/**
 * Push a surface to the renderer's Generated-UI panel (FR-004). Used by the
 * UiBridge; guards against a destroyed window.
 */
function pushRenderToRenderer(payload: UiRenderPayload): void {
  // open-prompt-spinner-gating-v1: a `generated-ui` surface frame for the in-flight run is
  // the signal that this run is a UI-generation run (only that target keeps the blocking
  // spinner; the others settle display-only). Record it so the terminal status can carry
  // `producedSurface`. Other targets do not engage the Open Prompt spinner gate.
  if (payload.target === 'generated-ui') {
    renderPushedForRun = true
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UiChannel.Render, payload)
  }
}

/**
 * Push a data-model update for a bound surface to the renderer (jira-generative-
 * adapter-v1, FR-009/FR-010). The AdapterDispatcher's `pushDataModel` sink — guards a
 * destroyed window exactly like `pushRenderToRenderer`. Carries only non-secret data.
 */
function pushDataModelToRenderer(payload: UiDataModelPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UiChannel.DataModel, payload)
  }
}

/**
 * Push the EARLY "UI generation has begun" begin-signal to the renderer (ui-catalog-pull-
 * spinner-signal-v1, FR-004). The UiBridge's `pushGeneratingBegin` sink — fired when a render
 * run pulls the component catalog. VALIDATE at the boundary (target-only, warn-and-ignore an
 * invalid one — FR-012) and guard a destroyed window, exactly like `pushRenderToRenderer`.
 * NON-SECRET: carries only the render `target` (no token/transcript/surface — FR-011).
 */
function pushGeneratingBeginToRenderer(payload: { target: UiRenderTarget }): void {
  const validated = validateUiGeneratingBeginPayload(payload)
  if (!validated) {
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UiChannel.GeneratingBegin, validated)
  }
}

/**
 * Re-read the default-session transcript and push the updated conversation to the
 * renderer's Cosmos panel (cosmos-conversation-panel-v2, step 3, FR-107). Triggered when a
 * default-target (`'generated-ui'`) run completes — the runner already knows the run is
 * done and `claude` has flushed the transcript by then (more robust than racing a partial
 * mid-write). VALIDATE the result at the boundary (a malformed/secret-bearing frame is
 * dropped, never sent — FR-118) and guard a destroyed window. NON-SECRET: only the
 * normalized conversation model crosses (no raw line, path, token — FR-104/FR-106).
 */
function pushConversationUpdateToRenderer(): void {
  if (!transcriptReader) {
    return
  }
  const validated = validateConversationResult(transcriptReader.read())
  if (!validated) {
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(ConversationChannel.Update, validated)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'cosmos',
    // titlebar-brand-accent: drop the native title bar but KEEP the macOS traffic-light
    // buttons (close/min/max). On macOS `'hidden'` removes the bar chrome and leaves the
    // lights, which we vertically center inside the renderer's custom title strip (28px tall,
    // `bg-background` with a centered "cosmos" wordmark) via `trafficLightPosition`. The ~12px
    // lights centered in 28px ⇒ y≈8; x=14 insets them from the left. NOTE: this option only
    // takes effect at window creation, so a running dev session must be FULLY restarted (not
    // HMR) to see it. Windows/Linux have no traffic lights — there the strip is just a
    // draggable title bar and the OS draws its own controls; native window controls /
    // `titleBarOverlay` for those platforms are a follow-up if cosmos ever ships off macOS.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 8 },
    ...(existsSync(appIconPath()) ? { icon: appIconPath() } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // FR-006: secure renderer baseline.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // calendar-event-detail-v1 (design §2.8): route any in-page `target="_blank"` anchor (the
  // event-detail "Open in Google Calendar" link) to the SYSTEM browser via shell.openExternal
  // and DENY the in-app child window — standard Electron window config, NOT a new IPC channel.
  // Only http(s) is opened (a guard against a file:/javascript: URL ever being navigated to).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // terminal-file-explorer-v1 (FR-014/FR-022): build the file-explorer manager bound to THIS
  // window. `getRoot` resolves a pane's root from `terminalSessionMap` (never a renderer root);
  // `onChanged` sends the coarse, debounced `fs:changed` so the renderer re-lists seamlessly.
  fsExplorer = createFsExplorer({
    getRoot: paneRoot,
    onChanged: (paneId) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(FsChannel.Changed, { paneId })
      }
    },
    fs: diskExplorerFs
  })

  // TEMP DIAGNOSTIC: surface renderer-side crashes/console errors into the main
  // stdout (dev log) so a blank-screen React crash is debuggable.
  mainWindow.webContents.on('console-message', (e) => {
    if (e.level === 'error') {
      console.error(`[renderer console] ${e.sourceId}:${e.lineNumber} ${e.message}`)
    }
  })
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
    projectDir: sandboxDir,
    // refreshable-custom-generative-ui-v1 (FR-001/FR-002/FR-003/FR-006): make an agent-composed
    // surface refreshable IN PLACE. The descriptor is ALREADY validated + secret-screened
    // (target-matched) by UiBridge. The PRIMARY path registers the AGENT's OWN surface: resolve
    // the bind options the `dataSource` implies (the SAME source-of-truth the shells use — no
    // drift, FR-002) and, when the agent's spec is USABLE (non-empty surfaceId + a components
    // array, FR-001), register the descriptor under the AGENT's `spec.surfaceId`, kick the first
    // refresh (token attached in main, FR-003), and return the AGENT's spec AS-IS so its custom
    // layout repaints in place. If the agent supplied no usable spec, FALL BACK to the generic
    // `{path}`-bound SHELL (FR-006). An unknown `dataSource` (no resolver claims it) registers
    // nothing → return the agent's spec unchanged, un-refreshable (FR-015). Closes over the
    // module-scoped `adapterDispatcher` (wired below) so it is live at call time.
    registerAgentSurface: (descriptor, agentSpec, _target) => {
      if (!adapterDispatcher) {
        return { spec: agentSpec, registered: false }
      }
      // The register-vs-shell-vs-skip decision is the PURE planAgentSurfaceRegistration
      // (node-tested with the real resolvers); here we only do the side effects.
      const plan = planAgentSurfaceRegistration(descriptor, agentSpec)
      if (plan.register) {
        adapterDispatcher.register(plan.surfaceId, descriptor, plan.options)
        void adapterDispatcher.refresh(plan.surfaceId) // FR-003: kick the first refresh.
        return { spec: plan.spec, registered: true }
      }
      return { spec: plan.spec, registered: false }
    },
    // refreshable-custom-generative-ui (multi-region): rebind the agent's per-container literal
    // props to region-scoped `{path}` bindings (PURE rebindAgentSurface), then register each
    // region with the dispatcher under its OWN descriptor + cursor and kick its first refresh.
    // Returns the rewritten spec + the literal SEED so UiBridge paints it instantly; `null` when
    // no binding is usable (UiBridge falls back to the single-region descriptor/literal path).
    registerAgentSurfaceBindings: (bindings, agentSpec, _target) => {
      if (!adapterDispatcher) {
        return null
      }
      const result = rebindAgentSurface(agentSpec, bindings)
      if (!result) {
        return null
      }
      const surfaceId = result.spec.surfaceId
      for (const region of result.regions) {
        adapterDispatcher.register(surfaceId, region.descriptor, region.options, region.regionKey)
        void adapterDispatcher.refresh(surfaceId, region.regionKey) // kick each region's first fetch.
      }
      return { spec: result.spec, dataModel: result.dataModel }
    },
    pushDataModel: pushDataModelToRenderer,
    // ui-catalog-pull-spinner-signal-v1 (FR-003/FR-004): forward the EARLY begin-signal
    // (a `get_ui_catalog` pull) to the renderer so the originating tab's spinner turns ON
    // before the surface is composed. Validated + secret-free (target only) at the sink.
    pushGeneratingBegin: pushGeneratingBeginToRenderer
  })
  uiBridge.start()

  // settings-oauth-clients-v1 (FR-006): the encrypted, main-only client-config store.
  // The effectiveClientConfig() resolver and the settings: handlers read/write it; the
  // Atlassian secret it holds never leaves main.
  clientConfigStore = new ClientConfigStore({
    filePath: join(app.getPath('userData'), 'integrations', 'clientConfig.enc'),
    dirPath: join(app.getPath('userData'), 'integrations'),
    safeStorage,
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync }
  })

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

  // Confluence: its own manager (token + cloudId only here, encrypted) serving both the
  // native panel (IPC) and the MCP tools (bridge). Created BEFORE the adapter dispatcher
  // so the composite resolver can include the Confluence read resolver.
  confluenceManager = createConfluenceManager(mainWindow)
  confluenceBridge = new ConfluenceBridge({
    socketPath: confluenceBridgeSocketPath(sandboxDir),
    manager: confluenceManager
  })
  confluenceBridge.start()

  // Google Calendar (Track A): one manager (token only here, encrypted) serving both the
  // native panel (IPC) and the MCP tools (via GoogleCalendarBridge). READ-ONLY — no write
  // path, no action dispatcher. Fully separate from Slack/Atlassian (its own token + socket).
  googleCalendarManager = createGoogleCalendarManager(mainWindow)
  googleCalendarBridge = new GoogleCalendarBridge({
    socketPath: googleCalendarBridgeSocketPath(sandboxDir),
    manager: googleCalendarManager
  })
  googleCalendarBridge.start()

  // jira-generative-adapter-v1 (FR-009/FR-012): the SHARED adapter dispatcher, wired
  // with the JIRA resolver (maps a descriptor → jiraManager READ, token in main). It
  // pushes `updateDataModel` (keyed by surfaceId) on refresh + load-more/pagination and
  // drives the `loading` flag. Channel-independent: only the resolver + the data-model
  // push + the UiBridge cancel — never the ptyManager/agentRunner (FR-012/FR-021).
  // slack-/confluence-generative-adapter-v1 (FR-005): one dispatcher, a COMPOSITE
  // resolver. The Slack, Jira, and Confluence `dataSource` namespaces are disjoint, so the
  // descriptor's source selects the panel resolver; the Slack selector is consulted first,
  // then Confluence, else Jira (an unknown source degrades to a recoverable Jira notice —
  // never throws). Confluence rides the same append-only (lists) + none (detail) infra.
  const jiraResolve = jiraAdapterResolver(jiraManager)
  const slackResolve = slackAdapterResolver(slackManager)
  const confluenceResolve = confluenceAdapterResolver(confluenceManager)
  const compositeResolve: AdapterResolver = (descriptor) => {
    if (slackBindOptionsForSource(descriptor.dataSource) !== null) {
      return slackResolve(descriptor)
    }
    if (confluenceBindOptionsForSource(descriptor.dataSource) !== null) {
      return confluenceResolve(descriptor)
    }
    return jiraResolve(descriptor)
  }
  adapterDispatcher = new AdapterDispatcher({
    resolve: compositeResolve,
    pushDataModel: pushDataModelToRenderer,
    cancelActive: () => uiBridge?.cancelActive()
  })

  // cosmos-conversation-panel-v1 (step 2): mint-or-continue the DEFAULT conversation's
  // PERSISTENT claude session id. Persisted as plain JSON under userData (a non-secret
  // uuid; never logged as a token, never crosses to the renderer). On first launch a
  // fresh id is minted + persisted; on every later run AND after relaunch the SAME id is
  // reused so the default conversation is continuous and `claude` appends to the same
  // transcript jsonl. The sandbox cwd (resolveSandboxDir → `<userData>/sandbox`) is
  // STABLE across runs/restarts, so the cwd-hash-derived transcript path never scatters.
  const agentSessionStore = new AgentSessionStore({
    filePath: join(app.getPath('userData'), 'agent-session.json'),
    dirPath: app.getPath('userData'),
    fs: { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }
  })
  const defaultSession = selectDefaultSessionId(
    agentSessionStore.loadDefaultSessionId(),
    randomUUID
  )
  if (defaultSession.minted) {
    agentSessionStore.saveDefaultSessionId(defaultSession.sessionId)
  }

  // cosmos-conversation-panel-v2 (step 3): the main-only transcript reader for the Cosmos
  // conversation timeline. CONFINED to the one default-session transcript path
  // (`~/.claude/projects/<dir-key>/<defaultSessionId>.jsonl` derived from the stable
  // sandbox cwd) — never a renderer path, never another session (FR-105). Reads are
  // resilient (missing → empty, corrupt → unreadable; never throws — FR-108).
  transcriptReader = new TranscriptReader({
    homeDir: app.getPath('home'),
    sandboxDir,
    loadDefaultSessionId: () => agentSessionStore.loadDefaultSessionId(),
    fs: { existsSync, readFileSync: (p, enc) => readFileSync(p, enc), readdirSync }
  })

  // Generative-UI foundation v1: the headless `claude -p` runner. A SEPARATE
  // channel from the interactive PTY (FR-008) that reaches the SAME UiBridge via
  // the shared render_ui --mcp-config (FR-007). Its render_ui registration targets
  // this `sandboxDir`'s bridge socket — the one the running UiBridge listens on.
  agentRunner = new AgentRunner(
    {
      onStatus: (payload: AgentStatusPayload) => {
        console.log('[agent] status=', payload.state, payload.state === 'error' ? payload.message ?? '' : '')
        // open-prompt-spinner-gating-v1 (FR-001/FR-002): track, per run, whether a
        // `generated-ui` surface was pushed, and stamp it onto the terminal `completed`
        // status as the non-secret `producedSurface` signal so the Open Prompt panel can
        // release a plain-command tab deterministically (FR-004). `started` resets the
        // flag for the new run; `completed` reads it then resets for the next run.
        let outgoing: AgentStatusPayload = payload
        if (payload.state === 'started') {
          renderPushedForRun = false
        } else if (payload.state === 'completed') {
          outgoing = { ...payload, producedSurface: renderPushedForRun }
          renderPushedForRun = false
        }
        // FR-008: validate warn-and-ignore at the main boundary — a non-boolean
        // producedSurface (never expected here, since main sets it) would be dropped and
        // the status still sent; a malformed status is dropped entirely (never crashes).
        const validated = validateAgentStatusPayload(outgoing)
        if (mainWindow && !mainWindow.isDestroyed() && validated) {
          mainWindow.webContents.send(AgentChannel.Status, validated)
        }
        // cosmos-conversation-panel-v2 (step 3, FR-107): on a COMPLETED run, re-read the
        // default-session transcript and push the updated conversation to the Cosmos panel.
        // `claude` has flushed the transcript by completion, so this is the robust live
        // trigger (no racing a partial mid-write). A non-default-target run did not append
        // to the default transcript, so the re-read is idempotent (same content) — harmless.
        if (payload.state === 'completed') {
          pushConversationUpdateToRenderer()
        }
      }
    },
    // cosmos-conversation-panel-v1 (step 2): the persistent default-conversation session
    // id — the runner passes `--session-id <this>` for the default ('generated-ui') target
    // and SERIALIZES default-target submits behind any in-flight run (no id collision).
    // session-id-already-in-use-runtime-v1: thread the SAME registry env the PTY `--resume`
    // path uses so a queued run drained before the prior child released its registry entry
    // retries on a backoff instead of failing "Session ID is already in use".
    {
      sandboxDir,
      defaultSessionId: defaultSession.sessionId,
      sessionLockEnv: claudeSessionLockEnv
    }
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
    // terminal-file-explorer-v1 (FR-016/SC-006): a reload re-mounts every explorer; release
    // ALL fs watchers so none leaks across the navigation (the renderer re-issues watchStart).
    fsExplorer?.stopAll()
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
    // terminal-file-explorer-v1 (FR-016/SC-006): release every fs watcher on window teardown.
    fsExplorer?.stopAll()
    fsExplorer = null
    uiBridge?.stop()
    uiBridge = null
    slackBridge?.stop()
    slackBridge = null
    slackManager = null
    jiraBridge?.stop()
    jiraBridge = null
    jiraManager = null
    jiraActionDispatcher = null
    adapterDispatcher = null
    confluenceBridge?.stop()
    confluenceBridge = null
    confluenceManager = null
    googleCalendarBridge?.stop()
    googleCalendarBridge = null
    googleCalendarManager = null
    clientConfigStore = null
    agentRunner?.dispose()
    agentRunner = null
    mainWindow = null
    // macOS: destroying the last window resets the dock tile to the bundle's default
    // (Electron) icon. The reset happens on the runloop turn AFTER this handler returns,
    // so a synchronous re-stamp here is immediately clobbered by the OS. Defer past the
    // reset instead — two staggered ticks because the exact reset turn is not observable.
    // ponytail: 0/120ms double-tap; if it still flashes Electron, the only real fix is
    // packaging (the dev Electron.app bundle owns the tile), not more runtime re-stamps.
    setTimeout(applyDockIcon, 0)
    setTimeout(applyDockIcon, 120)
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
  applyDockIcon()
  // session-resume-relaunch-v4: reap any orphaned MCP-server processes left by a previous run
  // (abrupt termination / pre-fix orphans) BEFORE spawning fresh sessions, so they can't accumulate
  // and a relaunch starts from a clean process table. Best-effort; never blocks startup.
  reapOrphanMcpServers()
  registerIpcHandlers()
  createWindow()

  // confluence-content-images-v1: install the `cosmos-confluence-img` handler now that the
  // app is ready. The resolver reads the LIVE Confluence auth from the manager (token +
  // cloudId) on each image request; the token is attached only to the handler's outbound
  // `net.fetch` and never crosses into the renderer (FR-002/FR-003). Not connected → null →
  // graceful broken image (FR-010).
  installConfluenceImageProtocol(() => confluenceManager?.currentAuth() ?? null)

  // slack-rich-message-render-v1: install the `cosmos-slack-img` handler. The resolver reads
  // the LIVE Slack auth (token) from the manager on each image request; the token is attached
  // only to the handler's outbound `net.fetch` and never crosses into the renderer (FR-014).
  // Not connected → null → graceful broken image (FR-010).
  installSlackImageProtocol(() => slackManager?.currentAuth() ?? null)

  // terminal-file-explorer-v1 (FR-027/FR-028): install the `cosmos-file` handler. The resolver
  // looks up the tab's root by paneId; the handler confines every read to that subtree (no
  // token, local files only). A forged/out-of-root/missing ref degrades to a broken image.
  installLocalFileProtocol(paneRoot)

  app.on('activate', () => {
    // Re-stamp the cosmos dock icon: after the last window closes macOS keeps the
    // app alive (window-all-closed is guarded below), and the dock can fall back to
    // the dev Electron binary's default icon. Re-applying here keeps the cosmos logo.
    applyDockIcon()
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // session-resume-relaunch-v3: synchronous group teardown so the SIGKILL escalation reaps every
  // MCP-server child before the app may exit — a clean close leaves ZERO `out/main/mcp/*Server.js`
  // orphans.
  ptyManager?.killAllSync()
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
  adapterDispatcher = null
  confluenceBridge?.stop()
  confluenceBridge = null
  confluenceManager = null
  googleCalendarBridge?.stop()
  googleCalendarBridge = null
  googleCalendarManager = null
  clientConfigStore = null
  agentRunner?.dispose()
  agentRunner = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Final safety net: never orphan any PTY or the bridge sockets when quitting.
// session-resume-relaunch-v3: `killAllSync` (group SIGHUP → bounded grace → SIGKILL survivors) so
// claude AND its MCP-server children are reaped before the app exits.
app.on('before-quit', () => {
  ptyManager?.killAllSync()
  uiBridge?.stop()
  slackBridge?.stop()
  jiraBridge?.stop()
  confluenceBridge?.stop()
  googleCalendarBridge?.stop()
  agentRunner?.dispose()
})

// session-resume-relaunch-v1 (orphan prevention, part a): `will-quit` is a SECOND teardown net
// for quit sequences where `before-quit` is missed (some app.quit() / dock-quit paths). Reaping
// the PTYs here releases each `claude`'s `~/.claude/sessions/<pid>.json` registry entry so the next
// launch can resume the recorded ids without colliding with an orphan. Idempotent — a second
// teardown over an already-empty session map is a no-op.
//
// session-resume-relaunch-v3: `killAllSync` group-tears-down (SIGHUP → bounded grace → SIGKILL) so
// the embedded `claude` AND its MCP-server children are reaped, leaving no `out/main/mcp/*Server.js`
// orphans on a clean quit.
//
// NOTE: we deliberately do NOT kill the PTYs on `powerMonitor` `suspend` (Mac sleep). Sleep is the
// case where the user WANTS the session to still be there on wake; suspending the host does not
// quit cosmos, so the natural UX is "wake → keep using the same live claude". Killing on suspend
// would force an exit banner on every wake. The unavoidable residual — a hard SIGKILL/force-quit of
// cosmos, or claude dying without cleanup — leaves a live orphan or stale registry file; that is
// recovered at next launch by the `onSessionInUse` path (kill the holder / remove the stale file,
// then re-`--resume` the SAME id), so resumability is preserved without a fresh id.
app.on('will-quit', () => {
  ptyManager?.killAllSync()
})

// session-resume-relaunch-v1 (orphan prevention, part a): on macOS sleep, surface the registry
// snapshot in the log so a wake-time collision is diagnosable, but leave the live sessions running
// (see the will-quit note above for why we don't kill on suspend).
powerMonitor.on('suspend', () => {
  console.log('[session] system suspend; embedded claude sessions left running for wake')
})
