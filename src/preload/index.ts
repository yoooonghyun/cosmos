/**
 * Preload — cosmos PoC milestone 1 (Terminal Panel).
 *
 * FR-006: the ONLY main-process surface exposed to the renderer is the PTY IPC
 * channels, via `contextBridge`. No `ipcRenderer` and no Node APIs leak through.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  PtyChannel,
  UiChannel,
  type CosmosApi,
  type PtyApi,
  type PtyDataPayload,
  type PtyExitPayload,
  type PtyInputPayload,
  type PtyResizePayload,
  type UiApi,
  type UiActionPayload,
  type UiRenderPayload
} from '../shared/ipc'

const ptyApi: PtyApi = {
  sendInput(payload: PtyInputPayload): void {
    ipcRenderer.send(PtyChannel.Input, payload)
  },
  resize(payload: PtyResizePayload): void {
    ipcRenderer.send(PtyChannel.Resize, payload)
  },
  restart(): void {
    ipcRenderer.send(PtyChannel.Restart)
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

const api: CosmosApi = { pty: ptyApi, ui: uiApi }

contextBridge.exposeInMainWorld('cosmos', api)
