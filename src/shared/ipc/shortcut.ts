/**
 * Global tab/window keyboard shortcut IPC surface (Chrome-style). Re-exported
 * (unchanged) through the `src/shared/ipc.ts` barrel.
 *
 * Channel direction legend:
 *   M->R  main process emits to renderer (ipcRenderer.on)
 *   R->M  renderer sends to main process (ipcRenderer.send / invoke)
 */

/**
 * Channel for global tab/window keyboard shortcuts (Chrome-style). Key combos
 * are matched in MAIN (via `before-input-event`) so they fire regardless of DOM
 * focus (incl. an xterm-focused terminal) and can be `preventDefault`'d before
 * the renderer/window sees them; main then forwards the resolved command here.
 */
export const ShortcutChannel = {
  /** M->R: a matched shortcut command (e.g. open a tab, switch surface). */
  Trigger: 'shortcut:trigger'
} as const

export type ShortcutChannelName = (typeof ShortcutChannel)[keyof typeof ShortcutChannel]

/**
 * A resolved tab/window shortcut command, dispatched from main to the renderer.
 *  - `tab:new`      — open a new tab in the active rail surface (Cmd+T).
 *  - `tab:close`    — close the active tab in the active rail surface (Cmd+W).
 *  - `tab:next`     — activate the next tab, wrapping (Ctrl+Tab, Cmd+Opt+Right).
 *  - `tab:prev`     — activate the previous tab, wrapping (Ctrl+Shift+Tab, Cmd+Opt+Left).
 *  - `tab:jump`     — activate the tab at `index` (Cmd+1..8 ⇒ index 0..7).
 *  - `tab:last`     — activate the last tab (Cmd+9).
 *  - `surface:next` — switch to the next left-rail surface (Cmd+Shift+]).
 *  - `surface:prev` — switch to the previous left-rail surface (Cmd+Shift+[).
 */
export type ShortcutCommand =
  | 'tab:new'
  | 'tab:close'
  | 'tab:next'
  | 'tab:prev'
  | 'tab:jump'
  | 'tab:last'
  | 'surface:next'
  | 'surface:prev'

/**
 * M->R. A matched shortcut. `index` is present only for `tab:jump` (0-based: the
 * Nth tab to activate). No other payload — the renderer maps the command onto the
 * active surface's existing tab ops.
 */
export interface ShortcutTriggerPayload {
  /** The resolved command. */
  command: ShortcutCommand
  /** 0-based tab index for `tab:jump`; absent for every other command. */
  index?: number
}

/**
 * Shortcut API exposed to the renderer as `window.cosmos.shortcuts`. Renderer is
 * receive-only here; the key matching lives in main.
 */
export interface ShortcutApi {
  /**
   * M->R. Subscribe to resolved shortcut commands. Returns an unsubscribe fn so
   * subscribers can detach on unmount (avoids leaks / double-binding on HMR).
   */
  onTrigger(listener: (payload: ShortcutTriggerPayload) => void): () => void
}
