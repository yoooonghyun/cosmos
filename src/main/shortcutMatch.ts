/**
 * Pure tab/window shortcut matcher (no electron imports → node-testable).
 *
 * Maps an Electron `before-input-event` keystroke to a `ShortcutTriggerPayload`,
 * or `null` when the keystroke is not a cosmos shortcut. Keeping this pure lets
 * `shortcutMatch.test.ts` exercise the whole Chrome-style key map without a
 * BrowserWindow.
 *
 * Layout independence: we match on `input.code` (the physical key, e.g. `KeyT`,
 * `Digit1`, `BracketRight`, `ArrowLeft`, `Tab`) NOT `input.key` (the produced
 * character, which shifts with keyboard layout / modifiers). The primary modifier
 * is Cmd on macOS and Ctrl elsewhere; `Ctrl+Tab` cycling is the one combo that is
 * Ctrl on every platform (matching Chrome).
 */

import type { ShortcutCommand, ShortcutTriggerPayload } from '../shared/ipc'

/** The subset of Electron's `Input` we depend on (decoupled for testing). */
export interface KeyInput {
  /** Always `keyDown` for a shortcut; `keyUp`/`char` are ignored. */
  type: string
  /** Physical key code, layout-independent (e.g. `KeyT`, `Digit1`, `Tab`). */
  code: string
  /** Cmd (⌘) on macOS. */
  meta: boolean
  /** Ctrl. */
  control: boolean
  /** Shift. */
  shift: boolean
  /** Alt / Option (⌥). */
  alt: boolean
}

/** The two platforms whose primary modifier differs (mac = Cmd, else = Ctrl). */
export type ShortcutPlatform = 'darwin' | 'other'

/** `Digit1`..`Digit9` → 1..9, else null. */
function digit(code: string): number | null {
  const m = /^Digit([1-9])$/.exec(code)
  return m ? Number(m[1]) : null
}

function payload(command: ShortcutCommand, index?: number): ShortcutTriggerPayload {
  return index === undefined ? { command } : { command, index }
}

/**
 * Resolve a keystroke to a shortcut command, or `null` if it is not one.
 *
 * Chrome-style map (mod = Cmd on darwin, Ctrl elsewhere):
 *  - mod+T                         → tab:new
 *  - mod+W                         → tab:close
 *  - Ctrl+Tab     / mod+Alt+Right  → tab:next
 *  - Ctrl+Shift+Tab / mod+Alt+Left → tab:prev
 *  - mod+1..8                      → tab:jump (index 0..7)
 *  - mod+9                         → tab:last
 *  - mod+Shift+] / mod+Alt+Down    → surface:next
 *  - mod+Shift+[ / mod+Alt+Up      → surface:prev
 */
export function matchShortcut(
  input: KeyInput,
  platform: ShortcutPlatform
): ShortcutTriggerPayload | null {
  if (input.type !== 'keyDown') {
    return null
  }

  const mod = platform === 'darwin' ? input.meta : input.control

  // Ctrl+Tab / Ctrl+Shift+Tab — Ctrl on EVERY platform (Chrome-faithful), and
  // must be checked before the mod-based combos since on non-darwin mod IS Ctrl.
  if (input.code === 'Tab' && input.control && !input.meta && !input.alt) {
    return payload(input.shift ? 'tab:prev' : 'tab:next')
  }

  if (!mod) {
    return null
  }

  // mod+Alt+Arrow navigation (no Shift): horizontal cycles tabs, vertical
  // switches left-rail panels (an additive alias of mod+Shift+bracket).
  if (input.alt && !input.shift) {
    if (input.code === 'ArrowRight') {
      return payload('tab:next')
    }
    if (input.code === 'ArrowLeft') {
      return payload('tab:prev')
    }
    if (input.code === 'ArrowDown') {
      return payload('surface:next')
    }
    if (input.code === 'ArrowUp') {
      return payload('surface:prev')
    }
  }

  // mod+Shift+bracket surface switching.
  if (input.shift && !input.alt) {
    if (input.code === 'BracketRight') {
      return payload('surface:next')
    }
    if (input.code === 'BracketLeft') {
      return payload('surface:prev')
    }
  }

  // Plain mod combos (no Shift, no Alt).
  if (!input.shift && !input.alt) {
    if (input.code === 'KeyT') {
      return payload('tab:new')
    }
    if (input.code === 'KeyW') {
      return payload('tab:close')
    }
    const n = digit(input.code)
    if (n !== null) {
      return n === 9 ? payload('tab:last') : payload('tab:jump', n - 1)
    }
  }

  return null
}
