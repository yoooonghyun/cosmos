import { describe, expect, it } from 'vitest'
import { mapTerminalKey, TERMINAL_KEY_SEQUENCES, type TerminalKeyEvent } from './terminalKeymap'

/** A keydown event with no modifiers, overridden per-case. */
function key(over: Partial<TerminalKeyEvent>): TerminalKeyEvent {
  return {
    key: '',
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    type: 'keydown',
    ...over
  }
}

describe('mapTerminalKey', () => {
  it('Cmd+Left → beginning-of-line (Ctrl-A)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', metaKey: true }))).toBe('\x01')
  })

  it('Cmd+Right → end-of-line (Ctrl-E)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', metaKey: true }))).toBe('\x05')
  })

  it('Option+Left → backward-word (CSI-u-safe Alt+Left, not bare ESC b)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true }))).toBe('\x1b[1;3D')
  })

  it('Option+Right → forward-word (CSI-u-safe Alt+Right, not bare ESC f)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', altKey: true }))).toBe('\x1b[1;3C')
  })

  it('soft newline is CSI-u Shift+Enter', () => {
    expect(TERMINAL_KEY_SEQUENCES.newline).toBe('\x1b[13;2u')
  })

  it('alt soft newline is CSI-u Alt+Enter', () => {
    expect(TERMINAL_KEY_SEQUENCES.altNewline).toBe('\x1b[13;3u')
  })

  it('Shift+Enter keydown → CSI-u Shift+Enter sequence', () => {
    expect(mapTerminalKey(key({ key: 'Enter', shiftKey: true }))).toBe('\x1b[13;2u')
  })

  it('Option+Enter keydown → CSI-u Alt+Enter sequence', () => {
    expect(mapTerminalKey(key({ key: 'Enter', altKey: true }))).toBe('\x1b[13;3u')
  })

  it('Shift+Enter keypress → empty string (suppress xterm \\r leak, send nothing)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', shiftKey: true, type: 'keypress' }))).toBe('')
  })

  it('Option+Enter keypress → empty string (suppress xterm \\r leak, send nothing)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', altKey: true, type: 'keypress' }))).toBe('')
  })

  it('a plain letter is unhandled (null → xterm types it)', () => {
    expect(mapTerminalKey(key({ key: 'a' }))).toBeNull()
  })

  it('plain Enter is unhandled (null → xterm submits)', () => {
    expect(mapTerminalKey(key({ key: 'Enter' }))).toBeNull()
  })

  it('plain arrows are unhandled (null → xterm sends raw arrow)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft' }))).toBeNull()
    expect(mapTerminalKey(key({ key: 'ArrowRight' }))).toBeNull()
  })

  it('keyup for an intercepted chord is ignored (no double-send)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', metaKey: true, type: 'keyup' }))).toBeNull()
  })

  it('Option+Left mid-IME-composition → null (defer to xterm so CompositionHelper commits the syllable)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: true }))).toBeNull()
  })

  it('Option+Right mid-IME-composition → null', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', altKey: true, isComposing: true }))).toBeNull()
  })

  it('Cmd+Left mid-IME-composition → null', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', metaKey: true, isComposing: true }))).toBeNull()
  })

  it('Option+Left not composing → word-left sequence (normal motion still works)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false }))).toBe('\x1b[1;3D')
  })

  it('Option+Left on IME commit-keydown (keyCode 229, isComposing already false) → null (defer so CompositionHelper commits; fixes "마지막 문자로 치환" recurrence)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 229 }))).toBeNull()
  })

  it('Option+Right on IME commit-keydown (keyCode 229) → null', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', altKey: true, isComposing: false, keyCode: 229 }))).toBeNull()
  })

  it('Option+Left with a normal keyCode (37) still maps to word-left (229 guard is exact, not over-broad)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, keyCode: 37 }))).toBe('\x1b[1;3D')
  })

  // --- composing guard (event-tracked, non-sticky IME composition check) ---
  // Covers the macOS/Electron interrupt-keydown: Option+Left fires with isComposing=false
  // and keyCode=37 (not 229) while compositionstart has fired but compositionend has not.
  // Both legacy guards miss it; composing=true (tracked via DOM events in TerminalPanel)
  // is the only non-sticky, always-correct signal.

  it('Option+Left with composing=true → null (defer; fixes "트" corruption on macOS interrupt-keydown)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 37, composing: true }))).toBeNull()
  })

  it('Option+Right with composing=true → null', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', altKey: true, isComposing: false, keyCode: 39, composing: true }))).toBeNull()
  })

  it('Cmd+Left with composing=true → null (line-start also deferred during active composition)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', metaKey: true, isComposing: false, keyCode: 37, composing: true }))).toBeNull()
  })

  it('Cmd+Right with composing=true → null', () => {
    expect(mapTerminalKey(key({ key: 'ArrowRight', metaKey: true, isComposing: false, keyCode: 39, composing: true }))).toBeNull()
  })

  it('Option+Left with composing=false → word-left sequence (guard clears immediately on compositionend)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 37, composing: false }))).toBe('\x1b[1;3D')
  })

  it('Option+Left with composing omitted → word-left sequence (absent = no active composition)', () => {
    expect(mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 37 }))).toBe('\x1b[1;3D')
  })

  // --- regression: Shift+Enter must work after Korean composition ends ---
  // The textareaValue-based guard was sticky: after compositionend the textarea still
  // held "테스트" (xterm only clears it on blur/CR/ETX), so Shift+Enter was permanently
  // blocked. The composing flag clears on compositionend so these chords work again.

  it('Shift+Enter with composing=false → CSI-u newline (not blocked after composition ends)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', shiftKey: true, composing: false }))).toBe('\x1b[13;2u')
  })

  it('Option+Enter with composing=false → CSI-u alt-newline (not blocked after composition ends)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', altKey: true, composing: false }))).toBe('\x1b[13;3u')
  })

  it('Shift+Enter with composing=true → null (defer to xterm during active composition)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', shiftKey: true, composing: true }))).toBeNull()
  })

  it('Option+Enter with composing=true → null (defer to xterm during active composition)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', altKey: true, composing: true }))).toBeNull()
  })

  // --- split guard (from the live IME trace) ---
  // At the Option+Left interrupt-keydown, compositionend has ALREADY fired
  // (composing=false, isComposing=false, keyCode=37) but term.textarea still holds the
  // composed line ("테스트  테스트 "; xterm clears it only on blur/CR). MOTIONS must defer on
  // that sticky textareaValue — intercepting there desyncs xterm and corrupts the line
  // ("테스트"→"트테스"→"스"). ENTER chords must NOT defer on it (that re-broke Shift+Enter).

  it('Option+Left with sticky non-empty textareaValue (composing=false, keyCode=37) → null — the exact trace corruption case', () => {
    expect(
      mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 37, composing: false, textareaValue: '테스트  테스트 ' }))
    ).toBeNull()
  })

  it('Option+Right with sticky non-empty textareaValue → null', () => {
    expect(
      mapTerminalKey(key({ key: 'ArrowRight', altKey: true, isComposing: false, keyCode: 39, composing: false, textareaValue: '테스트' }))
    ).toBeNull()
  })

  it('Cmd+Left with sticky non-empty textareaValue → null (line motion deferred on a composed line)', () => {
    expect(
      mapTerminalKey(key({ key: 'ArrowLeft', metaKey: true, isComposing: false, keyCode: 37, composing: false, textareaValue: '테스트' }))
    ).toBeNull()
  })

  it('Option+Left with empty textareaValue → word-left (pure-ASCII line: motion still works)', () => {
    expect(
      mapTerminalKey(key({ key: 'ArrowLeft', altKey: true, isComposing: false, keyCode: 37, composing: false, textareaValue: '' }))
    ).toBe('\x1b[1;3D')
  })

  it('Shift+Enter with sticky non-empty textareaValue but composing=false → CSI-u newline (Enter ignores the sticky textarea — the regression fix)', () => {
    expect(
      mapTerminalKey(key({ key: 'Enter', shiftKey: true, composing: false, textareaValue: '테스트  테스트 ' }))
    ).toBe('\x1b[13;2u')
  })

  it('Option+Enter with sticky non-empty textareaValue but composing=false → CSI-u alt-newline', () => {
    expect(
      mapTerminalKey(key({ key: 'Enter', altKey: true, composing: false, textareaValue: '테스트' }))
    ).toBe('\x1b[13;3u')
  })

  it('Shift+Enter with composing=true AND textareaValue non-empty → null (active composition still defers Enter)', () => {
    expect(mapTerminalKey(key({ key: 'Enter', shiftKey: true, composing: true, textareaValue: '테' }))).toBeNull()
  })
})
