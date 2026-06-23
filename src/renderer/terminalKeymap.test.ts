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
})
