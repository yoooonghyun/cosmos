/**
 * terminalTheme — PURE mapping from cosmos design tokens to xterm's `theme` colors
 * (bug terminal-panel-tone-mismatch-v1). xterm's `theme` wants concrete color STRINGS
 * (it cannot consume a CSS variable), so the panel reads the computed token values at
 * Terminal-construction time and passes them here. Keeping the mapping pure (a token
 * reader → `{ background, foreground }`) makes it unit-testable in the vitest node env
 * with no DOM import (the `.ts`/`.test.ts` split).
 *
 * The terminal screen must sit on the SAME surface tone as every other panel body, which
 * is `bg-card` = `--card` (NOT `--background`). So background maps to `--card` and
 * foreground to `--card-foreground`. An empty/missing token degrades to the dark-theme
 * default (safe fallback) so a malformed stylesheet never yields a transparent/black void.
 *
 * ponytail: reads `--card`/`--card-foreground` ONCE at construct (cosmos forces `.dark`
 * at startup and has no runtime theme switch — see `main.tsx`). If cosmos ever adds a
 * light/dark toggle, re-read these tokens (and re-set `term.options.theme`) on switch.
 */

/** A token reader: given a CSS custom-property name, return its value (possibly empty). */
export type TokenReader = (name: string) => string

/** The subset of xterm's `ITheme` the panel sets — concrete color strings. */
export interface TerminalThemeColors {
  background: string
  foreground: string
}

/** Dark-theme defaults (`.dark` `--card` / `--card-foreground`) — the safe fallback. */
const FALLBACK: TerminalThemeColors = {
  background: '#1b1b1c',
  foreground: '#e0e0e0'
}

/**
 * Map the cosmos surface tokens to xterm theme colors: `--card` → background (so the
 * terminal screen matches every other `bg-card` panel surface) and `--card-foreground`
 * → foreground. Trims whitespace; an empty/whitespace-only token falls back to the dark
 * default so the terminal is never left with a missing color.
 */
export function terminalThemeFromTokens(read: TokenReader): TerminalThemeColors {
  const card = (read('--card') || '').trim()
  const cardForeground = (read('--card-foreground') || '').trim()
  return {
    background: card || FALLBACK.background,
    foreground: cardForeground || FALLBACK.foreground
  }
}
