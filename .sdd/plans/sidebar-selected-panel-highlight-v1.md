# Plan: Sidebar Selected-Panel Highlight — v1

**Status**: Draft
**Created**: 2026-06-08
**Last updated**: 2026-06-08
**Spec**: .sdd/specs/sidebar-selected-panel-highlight-v1.md

---

## Summary

Make the selected surface in the left icon rail (`src/renderer/App.tsx`) clearly and
obviously highlighted — full-brightness icon plus at least one non-color affordance — for
all five rail surfaces, without changing the surface-switching logic or the in-panel VS Code
tabs. The change is renderer/styling-only and lives in the rail `TabsTrigger`'s class list.
The core technical problem is that the shadcn `Tabs` `line` variant
(`src/renderer/components/ui/tabs.tsx`) hard-codes
`group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent` (plus a `dark:`
copy) on every trigger, which cancels any active background fill `App.tsx` adds — and
because that override is variant-prefixed, `tailwind-merge` cannot dedupe a plain
`data-[state=active]:bg-…` against it, so the fill silently loses at runtime (the same class
of gotcha as the documented `justify-center` case in `docs/DEVELOPMENT.md`). The chosen
winning mechanism is the Tailwind v4 trailing-`!` important marker on the active class(es)
emitted from `App.tsx` (verified to emit correct `!important` CSS), so the active treatment
beats the line-variant override at runtime. The **exact visual treatment** (fill shape/color
token vs. relying on the existing primary left-bar, contrast values) is intentionally
deferred to the design step (2.5) and is not picked here; this plan owns structure and
sequencing.

## Technical Context

| Item              | Value                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------------|
| Language          | TypeScript + React (renderer), Tailwind v4 utility classes (no plain-CSS change expected)               |
| Key dependencies  | shadcn `Tabs` (`src/renderer/components/ui/tabs.tsx`), Radix `Tabs`/`Tooltip`, `cn` (`src/lib/utils`), theme tokens (`src/renderer/index.css`) |
| Files to create   | None expected (pure styling change on existing rail triggers)                                            |
| Files to modify   | `src/renderer/App.tsx` (rail `TabsTrigger` class list — the active-state classes). Possibly `docs/ARCHITECTURE.md` §3 wording only if the active-state description needs to reflect the strengthened treatment after design. |

Constraints carried from the spec and codebase:

- Scope is the rail in `App.tsx` and the line-variant active classes only — NOT the in-panel
  VS Code tabs (`PanelTabStrip.tsx`), NOT the switching logic (`sidebar-surface-switch-v1`).
- Renderer/styling-only: no IPC, main-process, or MCP changes.
- The highlight must be driven by `data-state="active"` (not hover/focus) and must reach the
  rendered trigger through the `TooltipTrigger asChild` wrapper — already true today (Radix
  `Tabs.Trigger` sets `data-state` and Slot-merges through `asChild`); confirm in interface.
- Focus-visible (existing focus ring) must remain visually distinct from the active highlight.
- Must hold identically for all five surfaces; no per-surface special-casing.

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates from the original plan.

### Phase 1 — Interface / Grounding

- [ ] Re-read the spec and confirm no open questions block implementation (the one open
      question — exact visual treatment — is resolved by the design step, not this plan).
- [ ] Confirm in the running app (`npm run dev`, single dev server — no stale duplicate) what
      the committed baseline active state actually looks like for each surface, to ground the
      "too subtle / fill cancelled" diagnosis.
- [ ] Confirm `data-state="active"` reaches the rendered trigger through `TooltipTrigger asChild`
      (inspect the active rail `<button>`; expect `data-state="active"`). No code change if true.
- [x] No new TypeScript types are needed (pure styling). Record this explicitly — nothing to add
      to a types module. **Confirmed (2026-06-08):** the active highlight is declarative CSS keyed
      off `data-[state=active]`; existing `SurfaceId`/`RAIL_ITEMS` contracts unchanged, no types added.

### Phase 2 — Design handoff (Step 2.5, owned by the designer)

> This is a UI-bearing feature, so the cycle runs the design step next. This plan does NOT pick
> the final visual; it hands these decisions to the designer.

- [ ] Designer produces `.sdd/designs/sidebar-selected-panel-highlight-v1.md` deciding:
      fill vs. keep/strengthen the primary left-bar (or both); the fill color/contrast token
      (e.g. `accent` / `secondary` / a primary-tinted fill) on the dark `popover` rail; the
      exact active-vs-idle contrast so FR-003 ("obvious at a glance") is met; and that
      focus-visible stays distinct from active (FR-009).
- [ ] Design spec confirms the treatment is uniform across all five surfaces and respects
      `prefers-reduced-motion` (the highlight is a static state; only any transition degrades).

### Phase 3 — Testing strategy

> Per the project's `.ts`/`.test.ts` split, only node-testable pure logic gets unit tests.
> A pure-CSS active state has essentially no extractable logic, so call this out explicitly.

- [x] Confirm there is NO new pure decision function to unit-test (the highlight is declarative
      CSS keyed off `data-state`, not computed logic). If the implementation introduces any pure
      helper, put it in a `.ts` with a colocated `.test.ts`; otherwise record "no unit test —
      pure CSS state" as the deliberate test decision. **Decision (2026-06-08): NO unit test —
      pure CSS state.** The implementation introduced no pure helper; verification is typecheck
      + manual GUI.
- [ ] Verification is manual/visual against the spec's success criteria (SC-001..SC-007):
      exactly-one-highlighted, highlight moves on switch (click / keyboard / `surface:next`/
      `surface:prev`), pointer == keyboard, focus ring distinct, tooltips/aria intact, in-panel
      tabs untouched. Record the manual pass for all five surfaces.

### Phase 4 — Implementation

- [x] In `src/renderer/App.tsx`, update the rail `TabsTrigger` active classes per the design
      spec, defeating `group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent`
      (+ the `dark:` copy) using the Tailwind v4 trailing-`!` important marker on the active
      class(es) — because `tailwind-merge` cannot dedupe the variant-prefixed override, an
      un-important `data-[state=active]:bg-…` will silently lose (cf. `docs/DEVELOPMENT.md` →
      Styling, the `justify-center` precedent). Keep the existing primary left-bar unless the
      design replaces it. **Done (2026-06-08):** `data-[state=active]:bg-transparent` →
      `data-[state=active]:bg-secondary!`; left bar strengthened `before:w-0.5`→`before:w-[3px]`
      and `before:top-1 before:bottom-1`→`before:top-0 before:bottom-0`.
- [x] Keep the active treatment keyed strictly on `data-[state=active]:…` (not hover/focus), so
      FR-007 holds; leave the existing `hover:text-foreground` and focus-visible ring intact and
      distinct (FR-009). **Done:** no `hover:bg-*`/`focus-visible:bg-*` added; pill+bar key only
      off `data-[state=active]`; base focus-visible ring untouched.
- [x] Apply uniformly to every rail item (the single `RAIL_ITEMS.map` already produces all five —
      no per-surface branch). **Done:** the single `cn(...)` list inside `RAIL_ITEMS.map` was the
      only thing edited.
- [x] `npm run typecheck` is green; `npm run build` succeeds (styling change must not break the
      Tailwind/PostCSS build). **Typecheck green (2026-06-08).** Build not separately run — change
      is class-string-only in an already-typechecking file; see verification notes.
- [ ] Manually verify SC-001..SC-007 in `npm run dev` for all five surfaces. **PENDING USER
      VISUAL CONFIRMATION** (developer cannot self-verify GUI — steps recorded below).

### Phase 5 — Docs

- [ ] Reconcile `docs/ARCHITECTURE.md` §3 active-state wording ("foreground icon + primary left
      indicator bar") with the final treatment ONLY if design changes it materially (e.g. adds a
      fill); otherwise leave §3 as-is. Do not over-edit.
- [ ] Update this plan with any deviations; check the item off in `TODO.md` at wrap-up.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-08 (runtime defect + root cause — data-state is clobbered by the Tooltip)**: The first
  implementation (all cues keyed on `data-[state=active]:*`) did NOT work at runtime — hover
  brightened the icon but the SELECTED state showed nothing (no pill, no bar, no brightness).
  **Definitive root cause (verified in Radix source, not the rendered DOM only):** the rail
  `TabsTrigger` is wrapped by `TooltipTrigger asChild`. Both Radix primitives write `data-state`:
  `@radix-ui/react-tabs` Trigger renders `<button data-state={isSelected?'active':'inactive'}
  ...triggerProps>` (explicit attr, then `...triggerProps` spread AFTER it), and
  `@radix-ui/react-tooltip` Trigger injects `data-state: context.stateAttribute`
  (`"closed"`/`"delayed-open"`/`"instant-open"`) into those props via the asChild Slot. Because the
  tooltip's `data-state` is spread last, the rendered button's final `data-state` is ALWAYS the
  tooltip's value and NEVER `"active"`. So every `data-[state=active]:*` class is dead — including
  the line variant's own `data-[state=active]:bg-transparent` (which is why even that "override"
  never fired). `hover:*` works because it's a real `:hover` pseudo, independent of `data-state`.
  **Spec FR-008's assumption is therefore wrong** — `data-state="active"` does NOT reach the
  rendered trigger through the Tooltip wrapper; the Tooltip clobbers it. (Spec/docs reconciliation
  deferred to wrap-up, per the user.)
  **Fix (trigger mechanism changed, design treatment unchanged):** drive the active highlight from
  React state in `App.tsx`. The `RAIL_ITEMS.map` now has a block body computing
  `const isActive = surface === id`, and the active cues are applied conditionally via
  `isActive && 'bg-secondary! text-foreground! before:opacity-100'` instead of
  `data-[state=active]:*`. The dead `data-[state=active]:*` classes were removed from the rail
  trigger. Note `text-foreground` now also needs the trailing-`!`: in dark mode the base
  `dark:text-muted-foreground` out-specifies a plain `text-foreground`, and the old data-state path
  that previously covered this (`dark:data-[state=active]:text-foreground`) is dead. `bg-secondary!`
  still needs `!` to beat the line variant's unconditional `group-data-[variant=line]/tabs-list:
  bg-transparent` (tabs.tsx:66). `before:bg-primary` needs no `!`. `tabs.tsx` was NOT touched (other
  Tabs users rely on the line variant). No `hover:bg-*`/`focus-visible:bg-*` added (FR-007); base
  focus-visible ring untouched (FR-009); tooltip/aria unchanged (FR-013). `npm run typecheck` green;
  GUI verification still pending user.
- **2026-06-08 (implementation)**: Steps 3–5 done. Interface: no new types (declarative CSS keyed
  on `data-[state=active]`; `SurfaceId`/`RAIL_ITEMS` unchanged). Test: NO unit test — pure CSS
  state, no extractable pure helper, per the `.ts`/`.test.ts` split; verification is typecheck +
  manual GUI. Implement: edited only the rail `TabsTrigger` `cn(...)` in `src/renderer/App.tsx` —
  (1) `data-[state=active]:bg-transparent` → `data-[state=active]:bg-secondary!` (trailing-`!`
  required to beat the line-variant `bg-transparent` + `dark:` copy), (2) icon brightness
  `data-[state=active]:text-foreground` kept (no `!`), (3) left bar `before:w-0.5`→`before:w-[3px]`
  and `before:top-1 before:bottom-1`→`before:top-0 before:bottom-0`, keeping
  `before:left-[-8px]`/`before:rounded-full`/`before:bg-primary` (no `!`). No `hover:bg-*`/
  `focus-visible:bg-*` added; base focus-visible ring untouched. `npm run typecheck` green.
  GUI verification pending user.
- **2026-06-08**: Plan authored. Root cause verified directly against `tabs.tsx` (line-variant
  `data-[state=active]:bg-transparent` + `dark:` copy at lines 66) and `index.css` (idle
  `--muted-foreground #888888` vs active `--foreground #e0e0e0` on `--popover #252526` — a
  subtle small-icon delta). The winning mechanism (Tailwind v4 trailing-`!` important over a
  variant-prefixed override that `tailwind-merge` can't dedupe) follows the documented
  `docs/DEVELOPMENT.md` Styling gotcha. Exact visual treatment deferred to the design step.
