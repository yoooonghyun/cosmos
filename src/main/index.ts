/**
 * Electron main entry — cosmos PoC milestone 1 (Terminal Panel).
 *
 * Creates a secure BrowserWindow (FR-006), wires ipcMain handlers to the
 * PtyManager, validates inbound payloads (FR-010), and tears the PTY down
 * cleanly on reload / quit so it is never orphaned (edge case).
 */

import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PtyChannel, UiChannel, type UiRenderPayload } from '../shared/ipc'
import { validateInput, validateResize, validateUiAction } from '../shared/validate'
import { PtyManager } from './ptyManager'
import { UiBridge } from './uiBridge'

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let uiBridge: UiBridge | null = null

/**
 * FR-009: the project root is the directory the app was launched from / the
 * app's working directory. For the PoC we use process.cwd(), which is the
 * cosmos project root in dev.
 */
function resolveProjectRoot(): string {
  return process.cwd()
}

function createPtyManager(window: BrowserWindow): PtyManager {
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
        if (!window.isDestroyed()) {
          window.webContents.send(PtyChannel.Exit, payload)
        }
      }
    },
    { cwd: resolveProjectRoot() }
  )
}

function registerIpcHandlers(): void {
  // FR-004: forward keyboard input (validated — FR-010).
  ipcMain.on(PtyChannel.Input, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateInput(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    ptyManager?.write(payload.data)
  })

  // FR-005: propagate resize (validated — FR-010).
  ipcMain.on(PtyChannel.Resize, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateResize(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-005)
    }
    ptyManager?.resize(payload)
  })

  // FR-008: restart the session in the same panel.
  ipcMain.on(PtyChannel.Restart, () => {
    ptyManager?.restart()
  })

  // FR-006/FR-010: receive the user's interaction from the Generated-UI panel.
  // Validate at the boundary; an invalid payload is warned + ignored and does
  // NOT resolve any pending render_ui call (SC-006).
  ipcMain.on(UiChannel.Action, (_event: IpcMainEvent, raw: unknown) => {
    const payload = validateUiAction(raw)
    if (!payload) {
      return // invalid -> warned + ignored (SC-006)
    }
    const matched = uiBridge?.resolveAction(payload.requestId, payload.action)
    if (!matched) {
      // FR-012: an action for an unknown/stale requestId is ignored, not
      // mis-applied to another call.
      console.warn('[ui] ignoring ui:action — no pending call for requestId:', payload.requestId)
    }
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // FR-006: secure renderer baseline.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  ptyManager = createPtyManager(mainWindow)

  // FR-004/FR-012: main hosts the render_ui bridge socket and owns surface
  // pushes + pending-call state. Start it with the window.
  uiBridge = new UiBridge({
    pushRender: pushRenderToRenderer,
    projectDir: resolveProjectRoot()
  })
  uiBridge.start()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Edge case: renderer reload MUST NOT orphan the PTY. Kill the old process
  // and respawn a fresh one tied to the reloaded renderer.
  mainWindow.webContents.on('did-start-navigation', (event) => {
    if (event.isSameDocument) {
      return
    }
    ptyManager?.kill()
    // Edge case: a render_ui call pending across a renderer reload MUST NOT hang;
    // resolve it cancel so Claude is not blocked indefinitely (FR-009).
    uiBridge?.cancelActive()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // (Re)spawn `claude` once the renderer is ready to receive output.
    ptyManager?.start()
  })

  mainWindow.on('closed', () => {
    ptyManager?.kill()
    ptyManager = null
    uiBridge?.stop()
    uiBridge = null
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ptyManager?.kill()
  ptyManager = null
  uiBridge?.stop()
  uiBridge = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Final safety net: never orphan the PTY or the bridge socket when quitting.
app.on('before-quit', () => {
  ptyManager?.kill()
  uiBridge?.stop()
})
