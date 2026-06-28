import { describe, expect, it } from 'vitest'
import { terminalThemeFromTokens } from './terminalTheme'

/**
 * Regression for terminal-panel-tone-mismatch-v1: the terminal screen must track the
 * `--card` / `--card-foreground` surface tokens (so it matches every other `bg-card`
 * panel), NOT the hardcoded `#1e1e1e` (= `--background`) the old code used. These assert
 * the source token names + trimming + safe fallback — they would FAIL against the old
 * hardcoded behavior.
 */
describe('terminalThemeFromTokens', () => {
  it('maps --card → background and --card-foreground → foreground (NOT --background)', () => {
    const tokens: Record<string, string> = {
      '--card': '#1b1b1c',
      '--card-foreground': '#e0e0e0',
      '--background': '#1e1e1e'
    }
    const theme = terminalThemeFromTokens((name) => tokens[name] ?? '')
    expect(theme.background).toBe('#1b1b1c')
    expect(theme.foreground).toBe('#e0e0e0')
    // The old hardcoded value (= --background) must NOT be used for the screen.
    expect(theme.background).not.toBe('#1e1e1e')
  })

  it('trims surrounding whitespace getComputedStyle may return', () => {
    const tokens: Record<string, string> = {
      '--card': '  #1b1b1c  ',
      '--card-foreground': ' #e0e0e0\n'
    }
    const theme = terminalThemeFromTokens((name) => tokens[name] ?? '')
    expect(theme.background).toBe('#1b1b1c')
    expect(theme.foreground).toBe('#e0e0e0')
  })

  it('falls back to the dark-theme defaults when a token is empty/missing', () => {
    const theme = terminalThemeFromTokens(() => '')
    expect(theme.background).toBe('#1b1b1c')
    expect(theme.foreground).toBe('#e0e0e0')
  })

  it('falls back per-token (a present token still wins)', () => {
    const tokens: Record<string, string> = { '--card': '#222324' }
    const theme = terminalThemeFromTokens((name) => tokens[name] ?? '')
    expect(theme.background).toBe('#222324')
    expect(theme.foreground).toBe('#e0e0e0') // missing → fallback
  })
})
