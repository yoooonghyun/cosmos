/**
 * closeTabRouting — the pure focus-aware routing predicates for the Terminal panel's
 * focus-sensitive tab shortcuts (terminal-focus-aware-close-tab-v1, FR-008; and the
 * Cmd+Opt+Arrow tab-navigation routing, terminal-focus-aware-tab-nav-v1).
 *
 * The Terminal panel routes a focus-sensitive shortcut to either the file viewer's open-file
 * tabs or the terminal panel tabs, based on whether the (active pane's) file viewer holds
 * focus AND has an open file. These are single node-testable predicates so the decision is
 * not entangled with React/DOM — the panel calls them at command time with the lifted
 * active-pane state.
 *
 *   - `tab:close` (`resolveCloseTarget`): `'file-tab'` iff the viewer is focused AND ≥1 file
 *     is open (FR-002); else `'panel-tab'` (not focused FR-004, or focused-but-empty FR-005,
 *     OQ-2 default — fall through to the existing panel-tab close rather than a dead no-op).
 *   - `tab:next`/`tab:prev` (`resolveTabNavTarget`): `'file-tab'` iff the viewer is focused
 *     AND ≥1 file is open — when the editor/viewer pane holds focus, Cmd+Opt+Arrow must move
 *     the FILE tabs, NOT the terminal tabs (the reported bug). Else `'panel-tab'` so the
 *     terminal-tab shortcut is unchanged when the terminal (or any non-file surface) is focused.
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

/**
 * Decide which tab strip `tab:next`/`tab:prev` (Cmd+Opt+Arrow) should move. Pure; no DOM,
 * no side effects. Returns `'file-tab'` only when the file viewer/editor pane holds focus
 * and has ≥1 open file — so navigation targets the strip the user is actually looking at,
 * instead of always moving the terminal tabs (the reported routing bug). The same input
 * shape as `resolveCloseTarget` so the panel lifts ONE per-pane focus state for both.
 */
export function resolveTabNavTarget(input: CloseTargetInput): CloseTarget {
  return input.viewerFocused && input.openFileCount >= 1 ? 'file-tab' : 'panel-tab'
}
