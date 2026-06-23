# Spec: Open-Prompt Composer Opens At The Button's Position — v1

**Status**: Draft
**Created**: 2026-06-23
**Supersedes**: `draggable-open-prompt-button-v1` **OQ-4** + **FR-013** (the
"expanded card stays centered, only the logo moves" decision). See "Supersession" below.
**Related plan**: .sdd/plans/open-prompt-open-at-position-v1.md

---

## Grounding

> Direct investigation run by the architect for this spec (mandatory report).

**codegraph_explore / codegraph_search** (code structure):
- `PromptComposer expanded panelRect currentPx position fractionToPx clamp OpenPromptPositionProvider ActiveComposerProvider` — confirmed the position pipeline: the logo's shared `{xFrac,yFrac}` → px via `fractionToPx(position, box, BUTTON_SIZE)` (size-aware: usable range `[0, dim - buttonSize]`), inverse `pxToFraction`, `clampFraction`/`clampNumber`. All pure math lives in `src/renderer/openPromptPosition.ts` (node-tested). The logo is drawn by a `translate3d(logoPx.x, logoPx.y)` transform inside a `position: fixed` layer (`slotRef`) sized to `panelRect` (the panel content box).
- `ActiveComposerProvider` / `App.tsx` `HoistedComposer` — confirmed commit `3fcdfed` (open-prompt-hoist-v1): the composer is ONE App-level instance. It is rendered inside `App.tsx`'s `<div className="pointer-events-none absolute inset-0 flex flex-col justify-end">` over the STABLE `surfaceRef` region; `panelRef={surfaceRef}` is the box it measures. Switching panels does not remount it. The new feature MUST keep this (anchor + clamp within the active panel box = `panelRect`).
- Read `src/renderer/PromptComposer.tsx` lines 124–826 in full — found the two overlays:
  1. The COLLAPSED logo: `translate3d(logoPx.x, logoPx.y)` inside the `fixed` `slotRef` layer sized to `panelRect`. `logoPx = dragPx ?? restingPx`.
  2. The EXPANDED card (line 730): a SEPARATE overlay `<div className="pointer-events-none absolute inset-x-0 bottom-0 flex … justify-center px-3 pb-3 pt-2">` holding the `<form>` `w-full max-w-2xl … origin-bottom`. This is the centered-bottom slot that THIS spec relocates. The card is anchored to `rootRef` (PromptComposer's thin local root), NOT to the `fixed` panel-box layer — so today it has a DIFFERENT coordinate frame than the logo. Unifying the frame (card positioned within the same `panelRect` box as the logo) is core to the feature.
- Read `src/renderer/openPromptPosition.ts` + `src/renderer/promptComposerLogic.ts` in full — confirmed the `.ts`/`.test.ts` split is where new pure math belongs (`openPromptPosition.test.ts` covers `fractionToPx`/`pxToFraction`/`isDrag`/`stepFollow`). The composer behavior decisions (`submitDecision`, `escDecision`, `draftAfterDismiss`, `surfaceSpinnerVisible`, …) are unchanged by this feature.

**memory_recall** (`Open Prompt composer position centered draggable clamp`):
- `draggable-open-prompt-button` architecture memory — position = normalized fraction `{xFrac,yFrac}` of the panel box, size-aware px clamp keeps the whole 48px button in bounds; the expanded card + Sent hint "keep their own separate bottom-anchored overlay (stay centered, OQ-4)". THIS is the decision the new spec supersedes.

---

## Supersession (explicit)

`draggable-open-prompt-button-v1` deliberately deferred card-follows-logo:

- **FR-013** (that spec): *"The expanded composer card MUST remain anchored sensibly relative
  to the moved logo (it MUST NOT open off-screen). See OQ-4 for whether the card follows the
  logo or stays centered."*
- **OQ-4** (that spec, RECOMMENDED + adopted): *"the expanded composer card stays **centered**
  (its current `max-w-2xl` centered overlay) regardless of logo position … Only the collapsed
  logo moves."*

That choice traded fidelity for simplicity. The product now wants the opposite: the composer
must **open at the button's live position**, anchored where the (possibly dragged) logo sits,
and clamped so a wall/corner-docked button never overflows the panel box. This spec **supersedes
OQ-4** (the card no longer stays centered) and **fulfils the open clause of FR-013** (the card is
anchored to the logo AND provably never opens off-screen) by adding a precise clamp. No other
requirement of `draggable-open-prompt-button-v1` is changed: the logo's drag, the normalized
fraction position, persistence, and the size-aware logo clamp all stay exactly as shipped.

---

## Overview

Today, clicking the Open-Prompt logo expands a CENTERED composer card (`max-w-2xl`, horizontally
centered, bottom-anchored) that merely scales up out of the bottom of the panel — its position is
unrelated to where the (draggable) logo sits. This feature makes the expanded card **open at the
button's current position**: the card grows from the logo's live anchor, and its full rendered box
is **clamped to stay fully inside the active panel content box** so that a button docked near an
edge or corner opens a card that shifts inward (off the wall) rather than overflowing.

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### The composer opens where the button is · P1

**As a** user who dragged the Open-Prompt logo to a spot that suits me
**I want to** the composer to expand from that exact spot, not snap to panel-center
**So that** the composer appears under my cursor/eye and the app feels direct and spatial.

**Acceptance criteria:**
- Given the logo sits at an arbitrary position in the panel, when I click it, then the expanded
  card appears anchored to the logo's position (the card's morph origin is the logo), NOT centered
  at the bottom of the panel.
- Given the logo is roughly mid-panel with room on all sides, when I open the composer, then the
  card's anchor corner coincides with the logo and the card does not jump to a different region.

### A wall- or corner-docked button never overflows the panel · P1

**As a** user who docked the logo against a panel edge or into a corner
**I want to** the expanded card to stay fully inside the panel content box
**So that** no part of the composer is clipped by, or spills outside, the panel.

**Acceptance criteria:**
- Given the logo is docked at the right edge, when I open the composer, then the card shifts LEFT
  just enough that its right side sits inside the panel's right wall (fully visible), and its left
  side is still inside the panel.
- Given the logo is docked in the bottom-right corner, when I open the composer, then the card is
  pulled IN from both the right and bottom walls so the whole card box is inside the panel content
  box (no clipping on any side).
- Given the logo is at any of the four corners or mid-edge, when I open the composer, then the
  rendered card box is entirely within the panel content box on all four sides.

### Existing composer behavior is unchanged · P1

**As a** user who relies on the composer's current interactions
**I want to** submit, Esc/click-outside collapse, draft preservation, the "launch" grow-fade on
send, the collapsed-logo error ring, the "Sent" hint, and busy-gating to all behave exactly as
today
**So that** only WHERE the card opens changes — nothing about HOW it behaves.

**Acceptance criteria:**
- Given the composer is open at the button position, when I press Enter on non-empty text, then it
  submits, the card plays the existing grow-to-fill "launch", the draft clears, and it collapses to
  the logo — identical to today.
- Given the composer is open, when I press Esc or click outside, then it collapses with the gentle
  shrink-fade and the draft is preserved — identical to today.
- Given the active panel is `busy`, then both the card and the logo are hidden exactly as today.
- Given a successful plain submit, then the "Sent" hint shows near the logo and the composer stays
  interactive (fire-and-forget) — identical to today.

### Position math is pure and node-testable · P2

**As a** maintainer
**I want to** the anchor + clamp computation to be a pure function in `openPromptPosition.ts`
**So that** it is unit-tested in vitest's node env, matching the project's `.ts`/`.test.ts` split.

**Acceptance criteria:**
- Given a button anchor px, a card size, and a panel box, when I call the new pure helper, then it
  returns the card's top-left in panel-box coords with no DOM access.
- Given degenerate inputs (panel smaller than the card, non-finite numbers), then the helper
  returns a safe clamped result and never throws.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional. `panelRect` denotes the active
> panel content box (the `surfaceRef`/`<section>` rect the hoisted composer already measures).

| ID     | Requirement |
|--------|-------------|
| FR-001 | The expanded composer card MUST be positioned by the SAME live button anchor used for the collapsed logo: the shared `{xFrac,yFrac}` resolved against `panelRect` (i.e. `logoPx = dragPx ?? restingPx`), NOT a fixed centered-bottom overlay. This replaces (supersedes) `draggable-open-prompt-button-v1` OQ-4. |
| FR-002 | The card MUST anchor so the logo's position maps to a defined corner of the card: the card's **bottom edge is co-located with the logo's top edge, and the card's left edge is aligned to the logo's left edge** (the card grows UPWARD out of the logo, bottom-left as the anchor corner), BEFORE clamping. This preserves the existing "grows up out of the logo, `origin-bottom`" feel. The morph/transform-origin MUST be the anchor corner (bottom-left), so the launch/dismiss animation visibly emanates from the logo. |
| FR-003 | The card's FULL rendered box (its real measured width and height, including the effect of `max-w-2xl` and the current content height) MUST be clamped to lie ENTIRELY within `panelRect`: no edge of the card may fall outside the panel content box on any of the four sides. When the unclamped anchor would push the card past a wall, the card MUST shift inward (away from that wall) by exactly the overflow amount. |
| FR-004 | The clamp MUST be applied independently per axis: horizontal overflow shifts the card left/right only; vertical overflow shifts it up/down only. |
| FR-005 | When `panelRect` is SMALLER than the card on an axis (degenerate), the clamp MUST pin that axis to the panel's top-left origin (`0`), so the panel's top/left edge of the card is visible and the overflow spills off the FAR (bottom/right) wall only — a deterministic, documented "smaller-panel-wins-by-pinning-origin" rule consistent with `fractionToPx`'s existing degenerate behavior. |
| FR-006 | The anchor + clamp computation MUST live in a pure, DOM-free, node-testable helper in `src/renderer/openPromptPosition.ts` (the `.ts`/`.test.ts` split), taking `(buttonAnchorPx, buttonSize, cardSize, panelBox)` and returning the clamped card top-left px in panel-box coordinates. Non-finite inputs MUST degrade safely (no throw, no NaN), mirroring the existing helpers. |
| FR-007 | The card MUST be rendered within the SAME coordinate frame as the logo — the `position: fixed` panel-box layer sized to `panelRect` (`slotRef`) — positioned by a `translate3d(cardLeft, cardTop, 0)` transform, so the card and logo share one measured box and the clamp math is exact. |
| FR-008 | On OPEN, the card position MUST be derived from the button's anchor AT THAT MOMENT. Whether the card subsequently FOLLOWS the logo if the user drags while the card is open is OQ-1 (recommended: the logo is INERT while expanded — today it is `inert` when `expanded` — so no drag can occur while open; position is therefore effectively frozen at open-time and the question is moot unless that inertness changes). |
| FR-009 | The card MUST measure its own rendered size (width/height) so the clamp uses the REAL box, not a hard-coded constant. A pre-measure (size unknown) frame MUST fall back to a safe assumption (e.g. its max width `max-w-2xl` = 42rem capped to `panelRect.width`, and a conservative height) and re-clamp once measured, with no visible overflow flash. |
| FR-010 | All existing composer behaviors MUST be preserved UNCHANGED: submit/`escDecision`/`shouldCollapseOnOutsideClick` collapse, `draftAfterDismiss`/`draftAfterSubmit`, the "launch" grow-to-fill vs gentle dismiss, the collapsed-logo error ring, the "Sent" hint, the per-tab `busy` gate that hides both states, and the fire-and-forget interactivity. Only the card's POSITION changes. |
| FR-011 | The logo's existing drag, normalized-fraction position, persistence, size-aware logo clamp, eased follow, and re-grab-mid-settle behavior MUST be untouched. This feature changes ONLY the expanded card's placement. |
| FR-012 | No new IPC channel, MCP server, main-process change, or persisted field is required; this is a renderer-only change (the card reads the same in-memory shared position the logo already uses). |

## Edge Cases & Constraints

- **Button at each of the 4 corners.** Top-left: anchor corner (card bottom-left) at the logo; the
  card grows up and right, clamps so its right/top stay inside. Top-right: card shifts left so its
  right edge is inside; grows up from the logo. Bottom-left: card grows up; left edge at logo;
  bottom edge clamped above the panel floor if needed. Bottom-right: shifts left AND clamps
  vertically so the whole box is inside both far walls. In every corner the clamped box is fully
  inside `panelRect` (FR-003).
- **Button mid-edge.** Right edge: card shifts left by its right overflow. Left edge: bottom-left
  anchor already at the wall, no horizontal shift needed. Top edge: card grows up but is clamped
  down so its top stays inside the panel ceiling. Bottom edge: card grows up out of the logo (the
  natural direction), no vertical shift unless the panel is short.
- **Panel smaller than the card (degenerate).** Per FR-005, the clamp PINS the overflowed axis to
  the panel origin (top-left), so the user sees the card's top-left and the overflow falls off the
  bottom/right. The panel-content-box "wins" by guaranteeing the origin-side of the card is always
  reachable; this matches `fractionToPx`'s existing "pin at 0 on a panel ≤ button size" behavior so
  the two helpers behave consistently. (A scroll/resize of the card content is out of scope.)
- **Drag while expanded.** Today the logo is `inert` + `aria-hidden` + `tabIndex=-1` while
  `expanded` (PromptComposer.tsx ~650), so a drag cannot start while the card is open. Therefore the
  card's position is naturally FROZEN at open-time. This spec keeps the logo inert while expanded
  (recommended), making "does the card follow a drag?" moot. See OQ-1 if the product wants the logo
  draggable while the card is open.
- **Panel/window resize while expanded.** The card SHOULD re-clamp into the (possibly new)
  `panelRect` on resize, exactly as the logo re-clamps today (the same ResizeObserver +
  window resize/scroll listeners already drive `restingPx`). No off-panel drift.
- **Reduced motion.** The transform-origin/anchor still applies; only the morph animation is
  bypassed (instant), matching the existing `motion-reduce` fallback. Unchanged.
- **Out of scope:** any change to the logo's drag/position/persistence; the TUI/Terminal panel; the
  A2UI render pipeline; per-tab surface state; IPC/MCP/main; the visual design of the card or logo
  (sizes, paddings, colors) beyond relocating the card and re-pointing its transform-origin. No new
  keyboard repositioning.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking the logo anywhere in the panel opens the card anchored to the logo (bottom-left corner co-located with the logo), not centered-bottom — visually verified at several positions. |
| SC-002 | With the logo docked at each of the 4 corners and each mid-edge, the opened card's full box is entirely inside `panelRect` on all four sides (no clipping, no overflow). |
| SC-003 | The pure anchor+clamp helper in `openPromptPosition.ts` passes node tests: mid-panel anchor returns the unshifted bottom-left placement; each wall/corner overflow shifts inward by exactly the overflow; a panel smaller than the card pins the overflowed axis to origin `0`; non-finite inputs degrade without throwing. |
| SC-004 | The card and the logo are positioned within the same measured `panelRect` layer via a `translate3d` transform (verified: one coordinate frame; the centered-bottom overlay is removed). |
| SC-005 | Submit/launch, Esc/outside-click dismiss, draft preservation, the "Sent" hint, the error ring, and busy-gating are all unchanged (existing tests still pass; behavior verified). |
| SC-006 | The transform-origin of the card is the anchor corner, so the launch grow-fade and the open/close morph visibly emanate from the logo's position. |
| SC-007 | A panel/window resize while the card is open re-clamps the card into the new box with no off-panel drift. |

---

## Open Questions

- [ ] **OQ-1 — Does the card FOLLOW the button if dragged while open, or freeze at open-time?**
      Today the logo is `inert` while `expanded`, so it CANNOT be dragged while the card is open —
      meaning the position is already effectively **frozen at open-time** and "follow" cannot occur
      without first making the logo draggable while expanded. **Recommended: keep the logo inert
      while expanded → freeze the card position at open-time** (no follow). This is the simplest,
      matches today's inertness, and avoids a moving target while typing. If the product wants the
      card to track a live drag, we must (a) make the logo draggable while expanded and (b) recompute
      the clamped card position each follow frame — added complexity; flag before implementing.
      **DECISION NEEDED from the user.**
- [ ] **OQ-2 — Anchor corner choice (bottom-left vs bottom-center).** FR-002 anchors the card's
      bottom-LEFT to the logo (card grows up and to the right), preserving `origin-bottom` and a
      single clean anchor corner. An alternative is bottom-CENTER (card grows up, centered over the
      logo) which feels more balanced for a mid-panel logo but needs a half-width horizontal offset
      before clamping. **Recommended: bottom-left** (simplest, one corner, exact clamp). Confirm vs
      bottom-center if the product prefers the card centered over the logo. (Either way the clamp in
      FR-003 keeps it on-panel; this only changes the pre-clamp offset.)
