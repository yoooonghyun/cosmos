# Plan: Open-Prompt Composer Opens At The Button's Position — v1

**Status**: Draft
**Created**: 2026-06-23
**Last updated**: 2026-06-23
**Spec**: .sdd/specs/open-prompt-open-at-position-v1.md

---

## Summary

Relocate the expanded Open-Prompt composer card so it opens **at the button's live anchor**
(bottom-left of the card co-located with the logo, growing upward) and is **clamped so its full
rendered box stays inside the active panel content box** (`panelRect`). The heart of the feature is
a single new PURE, node-testable helper in `src/renderer/openPromptPosition.ts` —
`clampCardWithinPanel(buttonAnchorPx, buttonSize, cardSize, panelBox) → cardTopLeftPx` — built and
tested FIRST. Then `PromptComposer.tsx` is rewired: the centered-bottom card overlay (the
`absolute inset-x-0 bottom-0 … justify-center` slot) is replaced by a card positioned inside the
SAME `position: fixed` `slotRef` panel-box layer the logo already uses, via a `translate3d`
transform whose top-left comes from the new helper, with the card's own measured size feeding the
clamp and the transform-origin pointed at the anchor corner. Renderer-only; no IPC/MCP/main/persist
change. This supersedes `draggable-open-prompt-button-v1` OQ-4 (card no longer centered).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (renderer, React) |
| Key dependencies  | Existing only — `openPromptPosition.ts` pure helpers, `PromptComposer.tsx` overlay/transform machinery, `ResizeObserver`/window listeners already wired for `restingPx`. No new deps. |
| Files to create   | none (extend existing) |
| Files to modify   | `src/renderer/openPromptPosition.ts` (+ new pure helper), `src/renderer/openPromptPosition.test.ts` (+ node tests), `src/renderer/PromptComposer.tsx` (card placement rewire) |
| Out of scope      | `promptComposerLogic.ts` (composer behavior decisions unchanged), `ActiveComposerProvider.tsx`/`App.tsx` (hoist stays), session persistence, IPC/MCP/main, Terminal/A2UI |

### Concurrency note (sequencing)

`PromptComposer.tsx` and `promptComposerLogic.ts` are **stable right now** — the open-prompt-hoist
(`3fcdfed`, `ActiveComposerProvider`) has landed. Two other agents are editing OTHER files
concurrently — a **Slack-scroll** agent (`slackCatalog/components.tsx`, SlackPanel internals) and a
**Confluence-write** agent (`shared/confluence.ts`, ConfluencePanel internals). **No file overlap**
with this feature (this touches only `openPromptPosition.ts` + its test + `PromptComposer.tsx`).
Still, **sequence implementation to start only after this spec/plan is approved**, and do the pure
math + tests (Story 1) before the `.tsx` wiring (Story 2) so the risky DOM rewire lands on a
green, fully-tested helper.

---

## The math (precise enough to implement directly)

All coordinates are panel-box-relative px (origin = panel content box top-left), the same frame as
the logo's `logoPx`. Inputs:

- `anchor = logoPx` — the button's top-left in panel-box px (`dragPx ?? restingPx`).
- `buttonSize` — `OPEN_PROMPT_BUTTON_SIZE_PX` (48).
- `card = { width, height }` — the card's REAL measured rendered size.
- `panel = { width, height }` — `panelRect` width/height.

**Step 1 — unclamped anchor (FR-002, bottom-left corner = logo, grows up):**
```
cardLeftRaw = anchor.x                       // card left aligns to logo left
cardTopRaw  = anchor.y - card.height         // card bottom sits on logo top → grows UP
```
(If OQ-2 chooses bottom-center instead: `cardLeftRaw = anchor.x + buttonSize/2 - card.width/2`.)

**Step 2 — per-axis clamp into the panel box (FR-003/FR-004/FR-005):**
```
maxLeft = panel.width  - card.width          // largest left that keeps the right edge inside
maxTop  = panel.height - card.height
cardLeft = clampNumber(cardLeftRaw, 0, max(0, maxLeft))
cardTop  = clampNumber(cardTopRaw,  0, max(0, maxTop))
```
- `clampNumber(v, 0, max(0, maxLeft))` shifts the card INWARD by exactly the overflow when the raw
  anchor pushes it past the right/bottom wall, and pins to `0` (panel origin) when it would go past
  the left/top wall (FR-004).
- When `card.width > panel.width` (degenerate), `max(0, maxLeft) = 0`, so `cardLeft` pins to `0`:
  the card's LEFT edge is at the panel origin and the overflow falls off the RIGHT wall only (FR-005,
  "smaller-panel pins origin", consistent with `fractionToPx`). Same per axis for height.
- Non-finite inputs flow through the existing `clampNumber` (non-finite → `lo` = 0), so the helper
  never returns NaN (FR-006).

Returns `{ x: cardLeft, y: cardTop }` — the card's clamped top-left, fed straight into
`translate3d(x, y, 0)`.

---

## Implementation Checklist

> Update as work progresses. Add inline notes when a step deviates.

### Story 1 — Pure anchor+clamp helper + node tests (do FIRST, no DOM)

- [x] Read the spec; OQ-1 = FREEZE, OQ-2 = BOTTOM-LEFT (user-resolved). Implemented bottom-left;
      `buttonSize` param retained (unused via `void`) so a bottom-center re-point is a one-line change.
- [x] In `src/renderer/openPromptPosition.ts`, add a `CardSize`/reuse `PanelBox` type and
      `export function clampCardWithinPanel(anchor: PixelPoint, buttonSize: number, card:
      { width: number; height: number }, panel: PanelBox): PixelPoint` implementing the math above.
      Reuse the existing private `clampNumber`. Document it in the file-header style of the existing
      helpers (cite spec FR-002/FR-003/FR-004/FR-005/FR-006).
- [x] In `src/renderer/openPromptPosition.test.ts`, added `describe('clampCardWithinPanel')` (11 cases):
  - [x] **mid-panel, room on all sides** → `{ x: anchor.x, y: anchor.y - card.height }` (no shift).
  - [x] **right-edge overflow** → `x` shifted left so `x + card.width === panel.width`; `y` unchanged.
  - [x] **bottom/top overflow** → top-edge logo clamps `y` to `0`; short panel clamps `y` so the box
        bottom sits at `panel.height`.
  - [x] **all 4 corners** (top-left, top-right, bottom-left mid-edge, bottom-right) → box inside panel.
  - [x] **degenerate (card wider/taller than panel)** → overflowed axis pins to `0` (FR-005).
  - [x] **non-finite inputs** (NaN anchor + NaN card width / +Inf top) → finite clamped result, no throw.
- [x] Ran `npx vitest run openPromptPosition.test.ts` → 35 pass.

**Acceptance (Story 1):** SC-003. The helper is pure (no DOM/React import), every spec edge case has
a passing node test, and `npm run typecheck` is clean.

### Story 2 — Wire `PromptComposer.tsx` to open the card at the clamped anchor

- [x] Add a card-size measurement: a `useState<{ width: number; height: number }>` seeded with a
      safe fallback (`max-w-2xl` = 42rem = 672px capped to `panelRect.width`, plus a conservative
      height), measured from the `<form>` element via `getBoundingClientRect()` /
      `ResizeObserver` on the form, so the clamp uses the REAL box (FR-009). Re-measure when the
      card content changes (chip shown/hidden, textarea grows).
- [x] Compute the card top-left each render:
      `const cardPx = clampCardWithinPanel(logoPx, OPEN_PROMPT_BUTTON_SIZE_PX, cardSize, { width:
      panelRect.width, height: panelRect.height })` — `logoPx` is the existing `dragPx ?? restingPx`
      (FR-001/FR-008; frozen at open per OQ-1 since the logo is inert while expanded).
- [x] Replace the centered-bottom card overlay (the `<div className="pointer-events-none absolute
      inset-x-0 bottom-0 flex … justify-center px-3 pb-3 pt-2">` at ~line 730) so the `<form>` is
      rendered INSIDE the existing `fixed` `slotRef` panel-box layer (the same layer as the logo),
      positioned by `style={{ transform: \`translate3d(${cardPx.x}px, ${cardPx.y}px, 0)\`,
      transformOrigin: 'bottom left' }}` and anchored `absolute left-0 top-0` (FR-007/FR-002/SC-004).
      Keep the form `pointer-events-auto` only while expanded (it already toggles via `inert`).
- [x] Re-point the card's transform-origin from `origin-bottom` to the ANCHOR corner
      (`bottom left`, FR-002/SC-006) so the launch grow-fade + open/close morph emanate from the
      logo. Keep the existing `transition-[opacity,scale,filter]`, `launching` grow-to-fill, and
      `scale-95` dismiss classes UNCHANGED (FR-010) — only the positioning wrapper + origin change.
- [x] Relocate the "Sent" hint so it still sits near the LOGO (it currently lives in the
      centered-bottom overlay being removed): anchor it to `logoPx` within the same `fixed` layer
      (e.g. just above the logo) so it keeps appearing by the button (FR-010). No behavior change.
- [x] Ensure the card re-clamps on panel/window resize while open: it already recomputes from
      `panelRect` + `logoPx` each render, and `restingPx`/`panelRect` are updated by the existing
      ResizeObserver + window resize/scroll effect — confirm the card's own size re-measures too
      (FR-009/SC-007).
- [x] Verified NO change to: `submit`/`handleKeyDown`/`escDecision`/`shouldCollapseOnOutsideClick`,
      `draftAfterDismiss`/`draftAfterSubmit`, `busy` hiding both states, the error ring, the
      collapsed logo's drag path, `fractionToPx`/`pxToFraction` usage for the logo (FR-010/FR-011).
- [x] `npm run typecheck` (node + web) clean (exit 0); `npx vitest run` green (2194/2194).

**Acceptance (Story 2):** SC-001, SC-002, SC-004, SC-005, SC-006, SC-007. Manual verification: open
the card with the logo at center, all 4 corners, and each mid-edge — the card opens anchored to the
logo and its full box stays inside the panel on every side; submit/Esc/click-outside/draft/Sent
hint/error ring/busy all behave as before.

### Story 3 — Docs + memory

- [ ] Update `docs/ARCHITECTURE.md` Open-Prompt section: the expanded card now opens at the
      button's clamped anchor (supersedes the centered-OQ-4 note), sharing the logo's `panelRect`
      coordinate frame; cite the new `clampCardWithinPanel` helper.
- [ ] `memory_save` the decision: card-opens-at-position + clamp helper + supersession of OQ-4
      (so a future session does not re-introduce the centered overlay).
- [ ] Mark the matching `TODO.md` item (if present) and note any deviations below.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-24** (developer, 3rd follow-up pass): Two changes.
  (1) **OQ-2 → CENTERED-ON-BUTTON (both axes)** per user: the card is now centered over the button
  on BOTH axes (button sits at the card's CENTER, not its bottom edge). `clampCardWithinPanel` vertical
  anchor changed `cardTopRaw = anchor.y - card.height` → `cardTopRaw = anchor.y + buttonSize/2 -
  card.height/2` (horizontal already centered). Per-axis clamp unchanged (still never overflows; at
  walls/corners it shifts inward). View transform-origin `bottom center` → `center` (wrapper inline +
  form class `origin-bottom` → `origin-center`). clampCardWithinPanel node tests rewritten for VOFF
  (-126 for the 400×300 test card): corners now clamp on BOTH axes (e.g. bottom-left y shifts UP off
  the floor), centered-on-button asserts added (card center == button center on both axes).
  (2) **Mid-settle open STILL broken → real root-cause fix.** The prior `resolveLiveAnchor` open path
  read `settleInFlight = (rafId != null || dragPx != null)` AT CLICK time, but the click event
  sequence defeats it: `onLogoPointerDown` runs first and CANCELS the settle rAF (rafId→null) without
  committing the live point; `onLogoPointerUp` (no move ⇒ click) clears `dragPx`. So by `onClick`,
  settleInFlight is already FALSE and `restingPx` is the STALE pre-move end-target ⇒ card opened at
  the pre-move position. Fix: (a) `onLogoPointerDown` now COMMITS the live grab point
  (`setPosition(pxToFraction(anchor))`) when it interrupts a settle, AND synchronously stashes it in a
  new `pendingOpenAnchorRef` (ref, immune to render timing); `onLogoPointerMove` clears the stash once
  a real drag starts (so a drag-end doesn't reuse it). (b) new pure helper `resolveOpenAnchor(stashed,
  settleInFlight, currentPx, restingPx)` (precedence: stashed > in-flight currentPx > restingPx) in
  `openPromptPosition.ts`; `openComposer` consumes + clears the stash. Result: a click mid-glide opens
  the card at the logo's LIVE painted position; an at-rest click still uses restingPx (no regression).
  5 new `resolveOpenAnchor` node tests. typecheck exit 0; full `npx vitest run` 2213/2213.
- **2026-06-23** (developer, follow-up pass): Two changes in one pass.
  (1) **OQ-2 FLIPPED bottom-left → BOTTOM-CENTER** per user: the card is now horizontally centered
  over the logo. `clampCardWithinPanel` now USES `buttonSize` (no longer `void`): `cardLeftRaw =
  anchor.x + buttonSize/2 - card.width/2`; vertical + per-axis clamp unchanged. View transform-origin
  changed `bottom left` → `bottom center` (wrapper inline style + the form's `origin-bottom` class).
  Existing node tests updated for the centered offset (HOFF = -176 for the 400px test card) + a new
  "center-panel logo, no clamp" case.
  (2) **Mid-settle open-anchor bug fix**: clicking the logo to OPEN while the release-settle was still
  gliding anchored the card at the START/resting position, not the live glide position (the committed
  `position` fraction is stale until the spring settles). New pure helper `resolveLiveAnchor(
  settleInFlight, currentPx, restingPx)` in `openPromptPosition.ts` (mirrors the re-grab seeding;
  node-tested). `PromptComposer.tsx`: new `openComposer()` callback (wired into the logo `onClick`)
  captures a frozen `openAnchor` from `resolveLiveAnchor(...)` and, when a settle is in flight, STOPS
  the rAF loop + commits `setPosition(pxToFraction(live))` + clears `dragPx` so the inert logo freezes
  exactly at the live point (OQ-1 FREEZE). `cardPx` now derives from `openAnchor ?? logoPx`;
  `collapse()` clears `openAnchor`. `onLogoPointerDown` refactored to reuse `resolveLiveAnchor`.
  `openPromptPosition.test.ts` now 39 passing; typecheck exit 0; full `npx vitest run` 2205/2205.
- **2026-06-23** (developer): Stories 1 + 2 implemented. **OQ-1 = FREEZE** and **OQ-2 = BOTTOM-LEFT**
  per user. `clampCardWithinPanel(anchor, buttonSize, card, panel)` added to `openPromptPosition.ts`
  (bottom-left anchor, per-axis `clampNumber(raw, 0, max(0, panelDim - cardDim))`, degenerate pins to
  0; `buttonSize` accepted but unused for bottom-left — `void buttonSize` keeps the signature stable
  for a future bottom-center re-point). 11 new node tests (4 corners, all 4 mid-edges, short panel,
  degenerate, non-finite) → `openPromptPosition.test.ts` now 35 passing. `PromptComposer.tsx`: the
  card is now rendered INSIDE the `slotRef` `fixed` panel-box layer via a `translate3d(cardPx)`
  positioning wrapper (`transform-origin: bottom left`), replacing the `absolute inset-x-0 bottom-0
  justify-center` centered overlay; the `<form>` origin changed `origin-bottom` → `origin-bottom-left`
  for the morph. Card size measured from `formRef.offsetWidth/Height` via a `ResizeObserver`
  (re-measures on chip/dismiss change), held in `cardSize` state; `cardReady = panelRect.width > 0 &&
  cardSize != null` gates an `invisible` class so the card never flashes off-anchor before measure
  (hide-until-measured, FR-009). "Sent" hint relocated into the same layer, anchored 20px above
  `logoPx`. All preserved behaviors untouched (submit/launch, Esc/outside-click, draft, error ring,
  busy gate, logo drag/persistence). `npm run typecheck` exit 0; `npx vitest run` 2194/2194 pass.
  Story 3 (docs/ARCHITECTURE.md + memory) left for wrap-up/architect.
- **2026-06-23**: Plan authored. Pending user decisions: **OQ-1** (freeze at open-time vs follow a
  live drag — recommended FREEZE, since the logo is already `inert` while expanded) and **OQ-2**
  (anchor corner bottom-left vs bottom-center — recommended bottom-left). Story 1 (pure helper +
  tests) is not blocked by OQ-2; Story 2's wiring should wait on OQ-1 (it determines whether the
  card position recomputes during a drag). Sequence after approval; no file overlap with the
  concurrent Slack-scroll / Confluence-write agents.
