import { describe, expect, it } from 'vitest'
import { matchShortcut, type KeyInput, type ShortcutPlatform } from './shortcutMatch'

/** Build a keyDown input with all modifiers off, overriding as needed. */
function key(over: Partial<KeyInput>): KeyInput {
  return {
    type: 'keyDown',
    code: '',
    meta: false,
    control: false,
    shift: false,
    alt: false,
    ...over
  }
}

const mac: ShortcutPlatform = 'darwin'
const win: ShortcutPlatform = 'other'

describe('matchShortcut — primary-modifier combos (mac = Cmd)', () => {
  it('Cmd+T → tab:new', () => {
    expect(matchShortcut(key({ code: 'KeyT', meta: true }), mac)).toEqual({ command: 'tab:new' })
  })

  it('Cmd+W → tab:close', () => {
    expect(matchShortcut(key({ code: 'KeyW', meta: true }), mac)).toEqual({ command: 'tab:close' })
  })

  it('Cmd+1..8 → tab:jump with 0-based index', () => {
    for (let n = 1; n <= 8; n++) {
      expect(matchShortcut(key({ code: `Digit${n}`, meta: true }), mac)).toEqual({
        command: 'tab:jump',
        index: n - 1
      })
    }
  })

  it('Cmd+9 → tab:last', () => {
    expect(matchShortcut(key({ code: 'Digit9', meta: true }), mac)).toEqual({ command: 'tab:last' })
  })

  it('Cmd+Shift+] → surface:next, Cmd+Shift+[ → surface:prev', () => {
    expect(matchShortcut(key({ code: 'BracketRight', meta: true, shift: true }), mac)).toEqual({
      command: 'surface:next'
    })
    expect(matchShortcut(key({ code: 'BracketLeft', meta: true, shift: true }), mac)).toEqual({
      command: 'surface:prev'
    })
  })

  it('Cmd+Opt+Right → tab:next, Cmd+Opt+Left → tab:prev', () => {
    expect(matchShortcut(key({ code: 'ArrowRight', meta: true, alt: true }), mac)).toEqual({
      command: 'tab:next'
    })
    expect(matchShortcut(key({ code: 'ArrowLeft', meta: true, alt: true }), mac)).toEqual({
      command: 'tab:prev'
    })
  })

  it('Cmd+Opt+Down → surface:next, Cmd+Opt+Up → surface:prev (panel switch alias)', () => {
    expect(matchShortcut(key({ code: 'ArrowDown', meta: true, alt: true }), mac)).toEqual({
      command: 'surface:next'
    })
    expect(matchShortcut(key({ code: 'ArrowUp', meta: true, alt: true }), mac)).toEqual({
      command: 'surface:prev'
    })
  })
})

describe('matchShortcut — panel switch alias on non-mac (Ctrl as primary modifier)', () => {
  it('Ctrl+Alt+Down → surface:next, Ctrl+Alt+Up → surface:prev', () => {
    expect(matchShortcut(key({ code: 'ArrowDown', control: true, alt: true }), win)).toEqual({
      command: 'surface:next'
    })
    expect(matchShortcut(key({ code: 'ArrowUp', control: true, alt: true }), win)).toEqual({
      command: 'surface:prev'
    })
  })
})

describe('matchShortcut — Ctrl+Tab cycling (Ctrl on every platform)', () => {
  it('Ctrl+Tab → tab:next, Ctrl+Shift+Tab → tab:prev on mac', () => {
    expect(matchShortcut(key({ code: 'Tab', control: true }), mac)).toEqual({ command: 'tab:next' })
    expect(matchShortcut(key({ code: 'Tab', control: true, shift: true }), mac)).toEqual({
      command: 'tab:prev'
    })
  })

  it('Ctrl+Tab → tab:next on non-mac too', () => {
    expect(matchShortcut(key({ code: 'Tab', control: true }), win)).toEqual({ command: 'tab:next' })
  })
})

describe('matchShortcut — non-mac uses Ctrl as the primary modifier', () => {
  it('Ctrl+T → tab:new, Ctrl+W → tab:close', () => {
    expect(matchShortcut(key({ code: 'KeyT', control: true }), win)).toEqual({ command: 'tab:new' })
    expect(matchShortcut(key({ code: 'KeyW', control: true }), win)).toEqual({
      command: 'tab:close'
    })
  })

  it('Cmd (meta) does NOT trigger on non-mac', () => {
    expect(matchShortcut(key({ code: 'KeyT', meta: true }), win)).toBeNull()
  })
})

describe('matchShortcut — non-matches', () => {
  it('ignores keyUp', () => {
    expect(matchShortcut(key({ type: 'keyUp', code: 'KeyT', meta: true }), mac)).toBeNull()
  })

  it('plain key without modifier is not a shortcut', () => {
    expect(matchShortcut(key({ code: 'KeyT' }), mac)).toBeNull()
    expect(matchShortcut(key({ code: 'Digit1' }), mac)).toBeNull()
  })

  it('Cmd+0 is not a shortcut', () => {
    expect(matchShortcut(key({ code: 'Digit0', meta: true }), mac)).toBeNull()
  })

  it('Cmd+Shift+T (reopen) is intentionally unmapped', () => {
    expect(matchShortcut(key({ code: 'KeyT', meta: true, shift: true }), mac)).toBeNull()
  })

  it('bare Cmd+] / Cmd+[ (no Shift) is not a surface switch', () => {
    expect(matchShortcut(key({ code: 'BracketRight', meta: true }), mac)).toBeNull()
    expect(matchShortcut(key({ code: 'BracketLeft', meta: true }), mac)).toBeNull()
  })

  it('Cmd+Alt+Right with Shift is not tab cycling', () => {
    expect(
      matchShortcut(key({ code: 'ArrowRight', meta: true, alt: true, shift: true }), mac)
    ).toBeNull()
  })

  it('Cmd+Alt+Down with Shift is not a surface switch (arm requires no Shift)', () => {
    expect(
      matchShortcut(key({ code: 'ArrowDown', meta: true, alt: true, shift: true }), mac)
    ).toBeNull()
    expect(
      matchShortcut(key({ code: 'ArrowUp', meta: true, alt: true, shift: true }), mac)
    ).toBeNull()
  })

  it('bare Cmd+Down / Cmd+Up (no Alt) is not a surface switch', () => {
    expect(matchShortcut(key({ code: 'ArrowDown', meta: true }), mac)).toBeNull()
    expect(matchShortcut(key({ code: 'ArrowUp', meta: true }), mac)).toBeNull()
  })
})

describe('matchShortcut — pre-existing arrow/bracket bindings unperturbed by the panel alias', () => {
  it('horizontal arrows still map to tab cycling (not surfaces)', () => {
    expect(matchShortcut(key({ code: 'ArrowRight', meta: true, alt: true }), mac)).toEqual({
      command: 'tab:next'
    })
    expect(matchShortcut(key({ code: 'ArrowLeft', meta: true, alt: true }), mac)).toEqual({
      command: 'tab:prev'
    })
  })

  it('Cmd+Shift+bracket still maps to surface switch (the original alias)', () => {
    expect(matchShortcut(key({ code: 'BracketRight', meta: true, shift: true }), mac)).toEqual({
      command: 'surface:next'
    })
    expect(matchShortcut(key({ code: 'BracketLeft', meta: true, shift: true }), mac)).toEqual({
      command: 'surface:prev'
    })
  })
})
