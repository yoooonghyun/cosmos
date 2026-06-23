/**
 * closeTabRouting — the pure focus-aware routing predicate for the Terminal panel's
 * `tab:close` shortcut (terminal-focus-aware-close-tab-v1, FR-008).
 *
 * The Terminal panel routes `Ctrl/Cmd+W` to either the file viewer's ACTIVE open-file tab
 * or the active terminal panel tab, based on whether the (active pane's) file viewer holds
 * focus AND has an open file. This is a single node-testable predicate so the decision is
 * not entangled with React/DOM — the panel calls it at command time with the lifted
 * active-pane state.
 *
 *   - `'file-tab'`  iff the viewer is focused AND ≥1 file is open (FR-002).
 *   - `'panel-tab'` otherwise: not focused (FR-004), or focused but empty (FR-005, OQ-2
 *     default — fall through to the existing panel-tab close rather than a dead no-op).
 */

export interface CloseTargetInput {
  /** True when the active pane's file viewer region holds focus (focus-within). */
  viewerFocused: boolean
  /** The number of files open in the active pane's viewer strip. */
  openFileCount: number
}

export type CloseTarget = 'file-tab' | 'panel-tab'

/**
 * Decide which tab `tab:close` should close. Pure; no DOM, no side effects.
 * Returns `'file-tab'` only when the viewer is focused and has at least one open file.
 */
export function resolveCloseTarget(input: CloseTargetInput): CloseTarget {
  return input.viewerFocused && input.openFileCount >= 1 ? 'file-tab' : 'panel-tab'
}
