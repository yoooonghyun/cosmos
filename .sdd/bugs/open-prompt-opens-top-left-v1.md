# Bug: Open Prompt composer opens at top-left instead of centered (RECURRING)

ID: `open-prompt-opens-top-left-v1`
Skill: bugfix
Status: Fixed (developer) — pending review
Reported: 2026-06-28

## Resolution (developer)

Root cause CONFIRMED: in `PromptComposer.tsx` the card's visibility gate (`cardReady`) and its
position (`cardPx = clampCardWithinPanel(..., cardSize ?? {0,0}, ...)`) were TWO SEPARATE
expressions. When `cardSize` was null/unmeasured the position default passed a `{0,0}` card, whose
clamped top-left collapses onto the raw button anchor (≈0,0) — and only the separate `invisible`
gate hid it, so any drift between the two re-exposed the top-left card.

Fix (single source of truth + belt-and-suspenders):
- `src/renderer/composer/openPromptPosition.ts` — new pure `resolveCardPlacement(anchor, btn,
  cardSize, panel)` returns `{ ready, px }`. `ready` is true ONLY when the panel width > 0 AND the
  card is measured to a REAL non-zero box (`null` or degenerate `{0,0}` ⇒ not ready); `px` is the
  centered-on-button clamp only when ready, else `{0,0}` (a sentinel the caller never paints).
- `src/renderer/composer/PromptComposer.tsx` (~713–727 compute, ~1124 JSX) — consume the helper;
  when NOT ready the card wrapper is BOTH `invisible` AND centered over the panel via
  dimension-independent CSS (`left-1/2 top-1/2 -translate-1/2`), so even if the `invisible` gate is
  ever broken again the card paints CENTERED, never at the top-left anchor.

Tests:
- `src/renderer/composer/openPromptPosition.test.ts` — extended with `resolveCardPlacement` rows
  (not-ready on null / degenerate `{0,0}` / unmeasured panel; ready ⇒ centered, not the anchor).
- `src/renderer/composer/PromptComposerFloatingOpenPosition.dom.test.tsx` — NEW jsdom guard renders
  the REAL `PromptComposer` floating, opens it, asserts UNMEASURED ⇒ hidden + centered fallback and
  MEASURED ⇒ shown at x>0,y>0 (not top-left). Confirmed RED on the reverted wiring, GREEN after.

Verified: `npm run typecheck:web` clean for these files (the only tsc error is in the parallel
dev's untracked `src/shared/promptContext/*`), `npm test` 2583 passing, `npm run test:dom` 31
passing. TEST-SCENARIOS.md row CMP-OPENPOS-01 added.

FOLLOW-UP (open-prompt-card-never-opens-v1): this fix's single `ready` flag (gated on the CARD
measuring) over-gated VISIBILITY and trapped the floating card invisible — see that bug. The fix
was superseded: `resolveCardPlacement` now returns `{ show, anchored, px }` (show = panel measured,
anchored = card measured), so the card always opens AND is never top-left. The top-left guarantee is
preserved by the centered CSS fallback while shown-but-not-anchored.

## Symptom (user)

Clicking the Open Prompt logo button opens the floating Composer card at the TOP-LEFT corner
(≈0,0) instead of CENTERED over the panel. This has REGRESSED multiple times. The user wants it
fixed AND a TEST that catches it at the test stage so it can't silently recur.

## Root cause (area — developer to confirm)

The floating composer card is positioned by the pure `src/renderer/composer/openPromptPosition.ts`
(`clampCardWithinPanel` applies a `-cardW/2,-cardH/2` centering offset). That offset is only
applied when `cardSize` is known. `PromptComposer.tsx` (~209-300) measures the form into
`cardSize` (initial `null`) and is supposed to keep the card INVISIBLE until measured
(hide-until-measured gate). When the card RENDERS before `cardSize` is measured (a measurement /
ref-timing race on open), `clampCardWithinPanel` skips the centering offset → the card sits at the
raw anchor (top-left). The in-file comment at ~288-294 documents a prior "centering fix" for
exactly this — so it is a RECURRING wiring/timing regression, NOT a pure-logic bug.

## Why it keeps recurring (the test gap)

The PURE positioning logic (`openPromptPosition.test.ts`) is GREEN — it tests `clampCardWithinPanel`
WITH a cardSize, so it never sees the null-cardSize-at-open path. The regression lives in the
RENDER/measurement WIRING (cardSize null when the card first paints), which a node-unit test cannot
observe. So the catch MUST be a jsdom (`*.dom.test.tsx`) test that renders the REAL `PromptComposer`
in floating mode, opens it, and asserts it is NOT positioned at top-left (centered, or
hidden-until-measured) — node-unit alone is necessary but NOT sufficient (this is the exact
"green node test, broken runtime" pattern).

## Fix (developer)

Ensure the card can NEVER paint at a non-centered position: keep it invisible until `cardSize` is
measured (enforce the hide-until-measured gate on the open transition), OR have the position
computation default to centered when `cardSize` is null. Fix at the wiring root, not a band-aid.

## Regression test (REQUIRED — the point of this bug)

jsdom `*.dom.test.tsx`: render `PromptComposer` (floating mode), trigger open, assert the card is
centered / not at (0,0) / stays hidden until measured. Must FAIL on the regressed wiring and pass
after. Plus keep/extend the pure `openPromptPosition` node tests. Update `docs/TEST-SCENARIOS.md`.

## Verification

`npm run typecheck`, `npm test`, `npm run test:dom` green incl. the new jsdom guard; exercise the
open in `npm run dev` if possible.
