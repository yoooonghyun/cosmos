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

/**
 * The subset of xterm's `ITheme` the panel sets — concrete color strings.
 *
 * The three `scrollbarSlider*` keys theme xterm 6's VS-Code-style overlay scrollbar
 * (terminal-broke-scroll-unify-redo-v1, Task 1). They are passed straight into the `Terminal`
 * `theme` option, which only injects a `background:` rule on the slider element (a
 * `position:absolute` overlay) — it does NOT touch the scrollbar WIDTH. xterm's FitAddon reserves
 * a CONSTANT gutter (`overviewRuler?.width || 14`), independent of the slider, so theming the
 * slider colour CANNOT mis-compute cols/rows the way the rolled-back `::-webkit-scrollbar { width }`
 * did. We map all three to `--muted-foreground` at the SAME opacities the panel scrollbars use
 * (45% resting, 70% hover/active) so the terminal bar matches every other panel surface.
 */
export interface TerminalThemeColors {
  background: string
  foreground: string
  /** Resting (visible) slider colour — matches the panel thumb `bg-muted-foreground/45`. */
  scrollbarSliderBackground: string
  /** Slider colour on direct hover — matches the panel thumb `hover:bg-muted-foreground/70`. */
  scrollbarSliderHoverBackground: string
  /** Slider colour while dragging — kept at the hover tint so the bar reads consistently. */
  scrollbarSliderActiveBackground: string
}

/** Dark-theme `--muted-foreground` — the safe fallback for the scrollbar slider tint. */
const FALLBACK_MUTED_FOREGROUND = '#888888'

/** Opacities mirroring the panel scrollbar policy (scroll-area.tsx / `scrollbar-hover-only`). */
const SLIDER_REST_ALPHA = 0.45
const SLIDER_ACTIVE_ALPHA = 0.7

/** Dark-theme defaults (`.dark` surface tokens) — the safe fallback. */
const FALLBACK = {
  background: '#1b1b1c',
  foreground: '#e0e0e0'
}

/**
 * Convert a CSS color to an xterm-parseable `rgba(...)` at the given alpha. xterm's color parser
 * accepts `#rgb`/`#rrggbb`/`#rrggbbaa` and `rgb()/rgba()` (NOT `color-mix`/`oklch`), so we expand a
 * hex token to `rgba()`. A non-hex or malformed value falls back to the dark `--muted-foreground`
 * so the slider is never left with a broken/transparent colour.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = (color || '').trim().replace(/^#/, '')
  let r: number, g: number, b: number
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{8}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    const f = FALLBACK_MUTED_FOREGROUND.replace(/^#/, '')
    r = parseInt(f.slice(0, 2), 16)
    g = parseInt(f.slice(2, 4), 16)
    b = parseInt(f.slice(4, 6), 16)
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
  // terminal-broke-scroll-unify-redo-v1 (Task 1): tint xterm's overlay scrollbar from the SAME
  // `--muted-foreground` token the panel scrollbars use, so the terminal bar matches every panel.
  const muted = (read('--muted-foreground') || '').trim() || FALLBACK_MUTED_FOREGROUND
  return {
    background: card || FALLBACK.background,
    foreground: cardForeground || FALLBACK.foreground,
    scrollbarSliderBackground: withAlpha(muted, SLIDER_REST_ALPHA),
    scrollbarSliderHoverBackground: withAlpha(muted, SLIDER_ACTIVE_ALPHA),
    scrollbarSliderActiveBackground: withAlpha(muted, SLIDER_ACTIVE_ALPHA)
  }
}
