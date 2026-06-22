# Plan: Draggable Open-Prompt Button (global shared position) — v1

**Status**: Draft
**Created**: 2026-06-22
**Last updated**: 2026-06-22
**Spec**: .sdd/specs/draggable-open-prompt-button-v1.md

---

## Grounding

Same direct investigation as the spec's Grounding section (codegraph_explore on
`PromptComposer` / `SessionSnapshot` / `validateSnapshot sessionRegistry`; Grep `PromptComposer`
→ six panels; `memory_recall` empty → `memory_save` of the decision). Key file pointers confirmed
on-disk:

- `src/renderer/PromptComposer.tsx` — collapsed logo at `absolute bottom-3 left-1/2
  -translate-x-1/2` inside the `pointer-events-none absolute inset-x-0 bottom-0 … justify-center`
  overlay slot (~line 299–357); `onClick` opens (~line 333). Pure logic in
  `promptComposerLogic.ts` (+ `promptComposerLogic.test.ts`).
- `src/shared/ipc/session.ts` — `SESSION_SCHEMA_VERSION = 8` (line 87), `SessionSnapshot` (line
  239), the `calendar-selection-persistence` NO-bump precedent doc (line 78).
- `src/main/sessionSnapshot.ts` — `validateSnapshot` (line 328) assembles the normalized snapshot
  and reads `value.enabled` via `validateEnabled`; `validateHiddenCalendars` is the additive-optional
  normalizer precedent (line 237).
- `src/renderer/sessionRegistry.ts` — `SessionRegistry` with `setEnabled` (line 130) as the
  non-panel contribution precedent; `assembleSnapshot` (line 54).
- `src/renderer/SessionProvider.tsx` — restored snapshot exposed via context; `useRestored*` hooks.

## Summary

Add a globally-shared, persisted position for the collapsed Open-Prompt logo button. The position
is a **normalized fraction** `{ xFrac, yFrac } ∈ [0,1]` of the panel content area (size-independent,
survives resize — OQ-1 recommended). A small app-root **React context store**
(`OpenPromptPositionProvider`, sibling to `SessionProvider`) holds the one shared value; every
panel's `PromptComposer` reads it and writes back on drag, so all six panels stay in sync live.
`PromptComposer` gains pointer-drag handling on the collapsed logo (threshold separates drag from
click) and positions the logo from the fraction via the panel-relative container, clamping with a
pure helper that accounts for the button's own size. Persistence is an **additive OPTIONAL top-level
`openPromptPosition` field on `SessionSnapshot` with NO schema bump** (stays v8), reported through a
new `SessionRegistry.setOpenPromptPosition` path (mirrors `setEnabled`), validated/clamped at the
main boundary by a new `validateOpenPromptPosition`. The drag affordance visuals (cursor, handle vs
whole-button, hover) are handed to the **designer** between this plan and Interface.

## Technical Context

| Item              | Value                                                                                                                                                                  |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (React 19 renderer; node-env pure helpers; main-process validator)                                                                                          |
| Key dependencies  | Existing only — React context, `PromptComposer`, `SessionSnapshot`/`SessionRegistry`/`validateSnapshot`, Tailwind (no new packages). Pointer events (native).          |
| Files to create   | `src/renderer/openPromptPosition.ts` (pure: type + `DEFAULT_OPEN_PROMPT_POSITION`, `clampPosition`, `fractionToPx`, `pxToFraction`, drag-threshold decision); `src/renderer/openPromptPosition.test.ts`; `src/renderer/OpenPromptPositionProvider.tsx` (context store) |
| Files to modify   | `src/shared/ipc/session.ts` (additive optional `openPromptPosition` on `SessionSnapshot` + doc note, NO bump); `src/main/sessionSnapshot.ts` (`validateOpenPromptPosition`, wire into `validateSnapshot`); `src/renderer/sessionRegistry.ts` (`setOpenPromptPosition` + `assembleSnapshot` passes it through); `src/renderer/SessionProvider.tsx` (restore the position into the provider / expose to the store); `src/renderer/PromptComposer.tsx` (consume store, render logo from fraction, pointer-drag handling); `src/renderer/App.tsx` (mount `OpenPromptPositionProvider`); `docs/ARCHITECTURE.md` (§4.4 note: global Open-Prompt position store + additive snapshot field) |

### Position representation (decided — OQ-1)

`OpenPromptPosition = { xFrac: number; yFrac: number }`, each in `[0,1]`, origin top-left of the
panel content area. **Why normalized fraction, not pixel offset or corner+offset:** the panel/window
resizes freely (rail switch keeps panels mounted at varying sizes), and a fraction maps to any size
without drifting off-screen and needs no corner bookkeeping. The pure clamp still subtracts the
button's pixel size from the usable range when converting fraction→px so the whole button body stays
inside (FR-005/FR-012). Default `{ xFrac: 0.5, yFrac: 0.96 }` ≈ the current bottom-center anchor
(FR-011); the designer confirms the exact default y to match `bottom-3`.

### Persistence shape (decided — FR-008, NO schema bump)

Add to `SessionSnapshot` (top-level, additive optional, NOT under `panels` since it is global):

```
openPromptPosition?: { xFrac: number; yFrac: number }
```

`validateOpenPromptPosition(value)` → returns a clamped `{xFrac,yFrac}` when both are finite numbers
(clamped to `[0,1]`), else `undefined` (field omitted ⇒ default on restore). Wired into
`validateSnapshot` exactly like `enabled`/`hiddenCalendars` — present-but-malformed normalizes,
absent stays absent, no version change (`SESSION_SCHEMA_VERSION` remains 8; add a NO-bump doc note in
`session.ts` mirroring the `calendar-selection-persistence` block). `assembleSnapshot` includes it
when the registry holds one; `SessionRegistry.setOpenPromptPosition` is the non-panel contribution
path (mirror `setEnabled`), debounce-saved like any change.

### Renderer state holder (decided — FR-003/FR-004)

`OpenPromptPositionProvider` at the app root (sibling of `SessionProvider`, inside it so it can seed
from the restored snapshot): holds `{ position, setPosition }` over React state; `setPosition`
updates the live value AND reports to the `SessionRegistry` (debounced save). All six panels read it
via a `useOpenPromptPosition()` hook; because the value is one shared state, a drag in any panel
re-renders every mounted `PromptComposer` with the new fraction (live sync). The provider seeds its
initial value from `snapshot.openPromptPosition ?? DEFAULT` on mount.

### Drag handling in PromptComposer (FR-001/FR-002/FR-013/FR-014)

- The collapsed-logo wrapper changes from the fixed `absolute bottom-3 left-1/2 -translate-x-1/2`
  to an `absolute` positioned from the shared fraction, measured against the overlay slot's box
  (a `ref` + `getBoundingClientRect`, the same panel-relative box the slot already spans).
- Pointer-drag: `onPointerDown` on the logo captures the pointer and records the start point; on
  `pointermove` past `DRAG_THRESHOLD_PX` the drag begins (sets a `dragging` flag, suppresses the
  click-to-open); on `pointerup` it converts the final px to a fraction (`pxToFraction` + `clamp`)
  and calls `setPosition`. A release below threshold leaves `dragging` false so the existing
  `onClick` opens the composer (FR-002). Pure decisions (`isDrag(start, current, threshold)`,
  clamp, conversions) live in `openPromptPosition.ts`; only the DOM/pointer binding lives in the
  component (the established split).
- The EXPANDED card stays centered (OQ-4 recommended) — no change to its layout; only the collapsed
  logo's wrapper position is driven by the fraction.
- All existing behavior (`busy` hides both states, Esc/outside-click collapse, tooltip, `aria-label`,
  draft dot) is preserved (FR-015/FR-016).

### Design step (designer-owned, between Plan and Interface)

The drag affordance VISUALS are a UI-bearing change → run the `design` skill (designer agent),
producing `.sdd/designs/draggable-open-prompt-button-v1.md`: the cursor (`grab`/`grabbing`), whether
the whole button is the drag surface vs a handle (OQ-3 recommends whole-button + threshold), the
hover/drag affordance, any subtle "draggable" hint, and the dragging-state visual (e.g. slightly
raised shadow). Reduced-motion respected. No new theme tokens expected; reuse existing
`PromptComposer` chrome. Developer wires any installs (none anticipated).

---

## Implementation Checklist

### Phase 0 — Design (designer agent, after this plan is approved)

- [ ] Designer produces `.sdd/designs/draggable-open-prompt-button-v1.md` resolving OQ-3 (drag
      surface), cursor states, dragging visual, and confirming the default-y matches `bottom-3`.

### Phase 1 — Interface (types + pure logic)

- [ ] Read the spec; confirm OQ-1/OQ-4 resolved (normalized fraction; centered card) and OQ-2/OQ-5
      deferred unless the user said otherwise.
- [ ] Create `src/renderer/openPromptPosition.ts`: `OpenPromptPosition` type,
      `DEFAULT_OPEN_PROMPT_POSITION`, `DRAG_THRESHOLD_PX`, `clampFraction`, `clampPositionPx`
      (size-aware), `fractionToPx`, `pxToFraction`, `isDrag(start, current)`. Pure, no DOM.
- [ ] Add `openPromptPosition?: { xFrac; yFrac }` to `SessionSnapshot` in `src/shared/ipc/session.ts`
      with a NO-bump doc note (mirror `calendar-selection-persistence`); `SESSION_SCHEMA_VERSION`
      stays 8.
- [ ] Review types vs spec — no invented properties (just the two numbers); confirm non-secret.

### Phase 2 — Testing (node-env, `.test.ts`)

- [ ] `openPromptPosition.test.ts`: in-range fraction round-trips through px↔fraction; out-of-range
      clamps to `[0,1]`; size-aware px clamp keeps the whole button inside (button width/height
      subtracted); `isDrag` below threshold → false, at/above → true; default returned for
      absent/garbage. (SC-005)
- [ ] Extend `sessionSnapshot.test.ts`: a valid `openPromptPosition` round-trips; out-of-range
      clamps; non-number/missing → field absent; a pre-feature snapshot (no field) still validates as
      v8 with the field absent (SC-004); on-disk bytes carry only two numbers (SC-006).
- [ ] Extend `sessionRegistry`/assemble tests (if present): `setOpenPromptPosition` lands the field
      in the assembled snapshot and debounce-saves.

### Phase 3 — Implementation

- [ ] `validateOpenPromptPosition` in `src/main/sessionSnapshot.ts`; wire into `validateSnapshot`
      (read `value.openPromptPosition`, set only when defined). (FR-008/FR-009)
- [ ] `SessionRegistry.setOpenPromptPosition` + `assembleSnapshot` pass-through in
      `src/renderer/sessionRegistry.ts` (mirror `setEnabled`). (FR-007)
- [ ] `OpenPromptPositionProvider` + `useOpenPromptPosition` in
      `src/renderer/OpenPromptPositionProvider.tsx`: seed from `snapshot.openPromptPosition ??
      DEFAULT`, expose `{ position, setPosition }`, `setPosition` updates state AND reports to the
      registry. (FR-003/FR-004)
- [ ] Mount `OpenPromptPositionProvider` in `src/renderer/App.tsx` inside `SessionProvider`.
- [ ] `PromptComposer.tsx`: consume `useOpenPromptPosition`; drive the collapsed-logo wrapper from
      the fraction (panel-relative ref + clamp on render so a resize re-clamps — FR-012); add
      pointer-drag handling (threshold separates drag from click — FR-002); keep the expanded card
      centered (OQ-4); preserve `busy`/collapse/tooltip behavior (FR-015/FR-016). Apply the
      designer's cursor/affordance classes.
- [ ] Manual cross-panel check: drag in one panel, confirm all six show the moved button live.
- [ ] All tests pass; `npm run typecheck` clean.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.4 (PromptComposer paragraph): note the global Open-Prompt
      button position — a normalized-fraction value held in an app-root context store, shared by all
      panels, persisted as an additive OPTIONAL `SessionSnapshot.openPromptPosition` field with NO
      schema bump (cite the `calendar-selection-persistence` precedent).
- [ ] Update this plan with any deviations.
- [ ] `wrap-up`: reconcile `TODO.md`.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-22 — FULL-PANEL positioning (user refinement).** The plan/spec scoped the logo
  to the existing overlay slot (`absolute inset-x-0 bottom-0`), which confines it to the
  bottom strip. Per user feedback ("패널 어디든 위치할수 있게"), the draggable area was expanded
  to the WHOLE panel content area. PromptComposer's root is a thin `shrink-0` flex strip, so
  an `inset-0` layer would only cover the bottom; instead the logo's positioning layer is now
  `position: fixed` SIZED to the nearest `<section>` panel ancestor's rect (measured via
  `rootRef.closest('section')` + a `ResizeObserver` + window resize/scroll). The fraction maps
  across the full box (top/middle/corners/sides), and the size-aware clamp keeps the whole
  button in the full bounds. The EXPANDED card + "Sent" hint keep their own separate
  bottom-anchored overlay (card stays centered — OQ-4 unchanged).
- **2026-06-22 — Smooth drag motion (user refinement).** Per user feedback ("자연스러운 모션"),
  the logo is positioned by a `translate3d` TRANSFORM (not per-frame `left/top`, so motion is
  compositor-only, no layout thrash). A `dragging` state toggles the transform transition OFF
  during the active drag (1:1 cursor tracking) and ON otherwise so pickup + the snap-into-bounds
  on release ease smoothly. `will-change-transform` set; `motion-reduce` still instant. The
  drag/click threshold is unchanged.
- **2026-06-22 — Panels untouched for consumption.** Because `PromptComposer` consumes the
  shared position via the `useOpenPromptPosition()` hook directly, the six panels did NOT need
  per-call edits (the plan listed them as "consume the provider/position"); only `App.tsx`
  mounts the provider. JiraPanel.tsx etc. were left untouched.
- **2026-06-22 — `validateOpenPromptPosition` is module-private.** It is not exported; it is
  covered through `validateSnapshot` in `sessionSnapshot.test.ts` (the same pattern as
  `validateHiddenCalendars`). `clampFraction` treats a non-finite component as `0` (the lo
  bound), documented in the helper + asserted in the test.
