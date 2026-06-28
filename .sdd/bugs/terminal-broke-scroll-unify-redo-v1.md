# Bug: terminal broke from naive scroll-unify; redo terminal + panel scroll safely + composer gap

ID: `terminal-broke-scroll-unify-redo-v1`
Skill: bugfix
Status: Fix implemented (developer) — terminal scrollbar themed + composer gap bumped; terminal
needs a real-app (`npm run dev`) eyeball (xterm does not render in jsdom/Vite harness).

## Resolution (developer)

- **Task 1 (terminal scrollbar):** xterm 6 draws a VS-Code OVERLAY scrollbar (`.xterm-scrollable-
  element > .scrollbar > .slider`), themed by `Terminal({ theme })` keys `scrollbarSliderBackground`
  / `…HoverBackground` / `…ActiveBackground`. `terminalTheme.ts` now maps `--muted-foreground` into
  these at the panel opacities (45% rest / 70% hover, via `withAlpha`). COLOUR-only — the slider is
  `position:absolute`, so it never changes the scrollbar WIDTH and so CANNOT mis-fit cols/rows the
  way the rolled-back `::-webkit-scrollbar { width }` did (FitAddon reserves a constant gutter
  `overviewRuler?.width || 14`, independent of the slider). `TerminalPanel.css` left untouched.
  NEEDS REAL-APP CHECK: `npm run dev` → terminal renders correctly (not broken) + the scrollbar
  reads as the muted hover-reveal bar, matching the panels.
- **Task 2 (composer gap):** PROVEN by measurement, not guess. New harness scene `composer-gap`
  (`ComposerGapScene.tsx`) + spec (`composer-gap.visual.spec.ts`): the docked band `pb-5` gave a
  26.25px gap (form bottom → footer top); bumped to `pb-8` → 38.25px (+12px = the pb delta exactly).
  The gap is SOLELY the band's `pb-*`; the user's "그대로" was stale HMR / cramped pb-5. Class guard
  added to `CosmosFooterOrder.dom.test.tsx`.
- **Verify:** `npm run typecheck` clean; `npm test` 2579 pass; `npm run test:dom` 29 pass;
  `npm run test:visual` 7 pass / 1 skip (existing fixme).
Reported: 2026-06-28

## Symptom (user)

1. Terminal screen "all broken" after the scroll-unify attempt.
2. Terminal scrollbar + the panels' scrollbar are still not unified.
3. The Cosmos composer's gap to its footer is unchanged ("그대로") despite the `pb-5` edit.

## What was rolled back (main session)

`TerminalPanel.css`: REMOVED the naive `.terminal-panel__xterm { overflow: hidden }` and the
`.xterm-viewport::-webkit-scrollbar { width: 8px; … }` block. These broke the terminal: defining
`::-webkit-scrollbar` with explicit geometry switches xterm's viewport to a CLASSIC scrollbar and
changes the usable width, so xterm's FitAddon mis-computes cols/rows ⇒ the screen renders wrong
("화면 깨짐"). Reverted to the original (terminal restored).

## Still-correct context (do NOT redo — already in place + verified)

- **Panel scroll unification IS done + verified**: `components/ui/scroll-area.tsx` (Radix thumb =
  `bg-muted-foreground/45` hover `/70`, 8px) + `scroll-area.classes.ts` (`SCROLL_AREA_VIEWPORT_GUTTER
  = 'pr-2'`) make Radix ScrollArea regions visually match the CSS `scrollbar-hover-only` regions
  (verified in the `scroll-policy` harness scene: hover thumb 8px/muted, content insets both 20px).
- **Cosmos composer→footer order** fixed + dom-tested (`CosmosFooterOrder.dom.test.tsx`); the gap is
  controlled SOLELY by the docked band `pb-5` in `app/SharedComposer.tsx` (the docked `<form>` itself
  has no margin). `SharedComposer` was extracted to its own module — it is Monaco-free, so it CAN be
  rendered in the Playwright visual harness.

## To do (developer)

1. **Terminal scrollbar unify — SAFELY (xterm-aware).** Match the terminal scroll to the panel
   hover-reveal policy WITHOUT breaking xterm's fit. The naive `::-webkit-scrollbar { width }` broke
   col-fit. Safer options to evaluate: (a) style ONLY the thumb color on `.xterm-viewport` and keep
   the width at xterm's expected value (don't force a new width); (b) refit (FitAddon) after styling;
   (c) xterm `Terminal` options / theme. MUST be verified in the REAL app (`npm run dev` / e2e) —
   xterm does not render in jsdom or the Vite harness, so flag the exact verification the user must do.
2. **Cosmos composer→footer gap.** The controlling value is `pb-5` (20px) on the docked band in
   `app/SharedComposer.tsx`. User reports no visible change. PROVE code-vs-environment: render
   `SharedComposer` (cosmos surface) in the Playwright harness (it is now Monaco-free) and MEASURE the
   gap between the composer card's bottom and the footer's top; confirm it equals the `pb` value. If
   the code path is correct, the "no change" is the user's stale HMR — say so; if a larger gap is
   wanted, bump `pb-5` and re-measure. Do NOT guess — measure.

## HARD CONSTRAINTS

- Slack per-list scroll lock (`feedback-slack-per-list-scroll`): do NOT touch
  `SLACK_LAYOUT_FILL_CLASS`/`SLACK_LIST_SCROLL_CLASS` structure.
- Do NOT re-break xterm. Real-app visual verification REQUIRED for the terminal part.

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom`; Playwright harness measurement for the composer
gap; real-app (`npm run dev`) eyeball for the terminal bar + that the terminal is no longer broken.
