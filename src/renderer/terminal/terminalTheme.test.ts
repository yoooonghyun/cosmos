import { describe, expect, it } from 'vitest'
import { terminalThemeFromTokens, withAlpha } from './terminalTheme'

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

  // terminal-broke-scroll-unify-redo-v1 (Task 1): the overlay scrollbar slider tracks
  // `--muted-foreground` at the SAME opacities the panel scrollbars use (45% rest, 70% hover/active)
  // so the terminal bar matches every panel surface. These are colour-only keys — they never set a
  // scrollbar WIDTH, so they cannot mis-fit cols/rows the way the rolled-back webkit width did.
  it('maps --muted-foreground → scrollbar slider colours at the panel opacities', () => {
    const tokens: Record<string, string> = {
      '--card': '#1b1b1c',
      '--card-foreground': '#e0e0e0',
      '--muted-foreground': '#888888'
    }
    const theme = terminalThemeFromTokens((name) => tokens[name] ?? '')
    expect(theme.scrollbarSliderBackground).toBe('rgba(136, 136, 136, 0.45)')
    expect(theme.scrollbarSliderHoverBackground).toBe('rgba(136, 136, 136, 0.7)')
    expect(theme.scrollbarSliderActiveBackground).toBe('rgba(136, 136, 136, 0.7)')
  })

  it('falls back the scrollbar slider to the dark --muted-foreground when the token is missing', () => {
    const theme = terminalThemeFromTokens(() => '')
    // Missing token → fallback #888888 → same rgba as the present-token case.
    expect(theme.scrollbarSliderBackground).toBe('rgba(136, 136, 136, 0.45)')
    expect(theme.scrollbarSliderHoverBackground).toBe('rgba(136, 136, 136, 0.7)')
  })
})

describe('withAlpha', () => {
  it('expands a 6-digit hex token to rgba at the given alpha', () => {
    expect(withAlpha('#888888', 0.45)).toBe('rgba(136, 136, 136, 0.45)')
    expect(withAlpha('  #888888\n', 0.7)).toBe('rgba(136, 136, 136, 0.7)') // trims whitespace
  })

  it('expands a 3-digit shorthand hex', () => {
    expect(withAlpha('#888', 0.45)).toBe('rgba(136, 136, 136, 0.45)')
  })

  it('reads only the rgb channels of an 8-digit hex (alpha arg wins)', () => {
    expect(withAlpha('#888888ff', 0.45)).toBe('rgba(136, 136, 136, 0.45)')
  })

  it('falls back to the dark --muted-foreground for a non-hex/malformed colour', () => {
    // color-mix/oklch/empty → xterm-unparseable, so degrade to the safe muted-foreground rgba.
    expect(withAlpha('color-mix(in oklab, x)', 0.45)).toBe('rgba(136, 136, 136, 0.45)')
    expect(withAlpha('', 0.7)).toBe('rgba(136, 136, 136, 0.7)')
  })
})
