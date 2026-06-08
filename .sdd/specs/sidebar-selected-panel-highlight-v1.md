# Spec: Sidebar Selected-Panel Highlight — v1

**Status**: Draft
**Created**: 2026-06-08
**Supersedes**: none
**Related plan**: .sdd/plans/sidebar-selected-panel-highlight-v1.md (to be authored)

---

## Overview

Make the selected surface in the left icon rail (`src/renderer/App.tsx`) clearly and
obviously highlighted, so the user can tell at a glance which of the five surfaces
(Terminal, Generated UI, Slack, Jira, Confluence) is active. This is purely the visual
selected-state of the rail; the surface-switching logic itself is unchanged and owned by
`.sdd/specs/sidebar-surface-switch-v1.md`.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### Active surface is unmistakably highlighted in the rail · P1

**As a** cosmos user
**I want to** glance at the left rail and immediately see which surface is selected
**So that** I always know which panel I am currently looking at

**Acceptance criteria:**

- Given any surface is selected, when I look at the rail, then that surface's icon is
  rendered at full foreground brightness (visibly brighter than the idle icons), AND the
  active item carries at least one additional non-color affordance (a background fill
  and/or the existing primary left indicator bar) so the selected state does not rely on
  color/brightness alone.
- Given a surface is selected, when I compare its rail item to the four idle items, then
  the difference between active and idle is obvious at a glance (not a subtle one-step
  brightness shift on a small icon).
- Given this holds, when I check each of the five surfaces in turn, then every surface
  produces the same clearly-highlighted active state (no surface is special-cased).

### Exactly one surface is highlighted at a time · P1

**As a** cosmos user
**I want to** see one and only one highlighted rail item
**So that** the selected-state is never ambiguous

**Acceptance criteria:**

- Given the rail, when any surface is selected, then exactly one rail item shows the active
  highlight and the other four show the idle state.
- Given a surface is selected, when I switch to another surface (by click, keyboard, or the
  existing surface:next / surface:prev shortcut), then the highlight moves to the
  newly-selected item and the previously-selected item returns to the idle state.

### Highlight is identical for pointer and keyboard selection · P1

**As a** keyboard or pointer user
**I want to** the same active highlight regardless of how I selected the surface
**So that** the selected-state is consistent across input methods

**Acceptance criteria:**

- Given I select a surface by clicking its rail icon, when it becomes active, then it shows
  the active highlight.
- Given I select a surface via keyboard (Radix vertical Tabs navigation) or the
  surface-switch shortcut, when it becomes active, then it shows the identical active
  highlight — the highlight is driven by the active/selected state, not by hover or focus.

### Focus-visible and active remain distinct states · P2

**As a** keyboard user
**I want to** the focus ring to remain distinguishable from the selected highlight
**So that** I can tell where keyboard focus is independently of which surface is active

**Acceptance criteria:**

- Given keyboard focus lands on a rail item, when I observe it, then the focus-visible
  affordance (the existing focus ring) is still present and is visually distinct from the
  active-selected highlight.
- Given a focused rail item that is not the active one, when I observe it, then it does not
  appear selected merely because it is focused or hovered.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                              |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The selected rail item MUST render its icon at full foreground brightness, visibly brighter than the idle items.                                                         |
| FR-002 | The selected rail item MUST carry at least one non-color affordance in addition to brightness (a background fill and/or the existing primary left indicator bar), so selection is unambiguous without relying on the brightness delta alone. |
| FR-003 | The active-vs-idle visual difference MUST be clearly perceptible at a glance on the dark palette (popover-colored rail), not a single subtle brightness step on a small icon. |
| FR-004 | The highlight MUST apply identically to all five surfaces (Terminal, Generated UI, Slack, Jira, Confluence); no surface may be visually special-cased.                    |
| FR-005 | At any time exactly one rail item MUST show the active highlight; the other four MUST show the idle state.                                                                |
| FR-006 | When the selected surface changes (via click, keyboard, or surface:next / surface:prev shortcut), the highlight MUST move to the newly-selected item and the previous item MUST return to idle. |
| FR-007 | The highlight MUST be driven by the selected/active surface state, NOT by hover or focus; hovering or focusing an idle item MUST NOT make it appear selected. |
| FR-008 | The active highlight MUST be driven by React surface state (`surface === id`), NOT by the trigger's `data-state="active"`. **Verified during implementation:** because each `TabsTrigger` is wrapped by `TooltipTrigger asChild`, Radix spreads the Tooltip's own `data-state` (`closed`/`delayed-open`) AFTER the Tabs `data-state` onto the same `<button>`, so the rendered `data-state` is never `"active"` and `data-[state=active]:*` classes are dead. (Original assumption that `data-state` survives the wrapper was wrong.) |
| FR-009 | The focus-visible affordance MUST remain present and visually distinct from the active-selected highlight.                                                               |
| FR-010 | The active highlight MUST respect the dark palette and maintain adequate contrast for the icon against whatever active background is used.                                |
| FR-011 | The change MUST be scoped to the rail in `src/renderer/App.tsx` and its rail-styling dependencies (the shadcn `Tabs` `line`-variant active classes that currently neutralize the active background). It MUST NOT change the in-panel VS Code tabs. |
| FR-012 | The change MUST be renderer/styling-only: no new IPC channels, no main-process changes, no MCP changes, and no change to the surface-switching logic in `sidebar-surface-switch-v1`. |
| FR-013 | Each rail item MUST retain its tooltip and `aria-label` matching its display name (no regression to the existing accessibility behavior).                                  |

## Edge Cases & Constraints

- **Line-variant active-background neutralization.** The shadcn `TabsTrigger` base
  (`src/renderer/components/ui/tabs.tsx`) hard-codes
  `group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent` plus a `dark:`
  copy, which overrides any active background fill applied from `App.tsx`. Achieving a
  visible active fill MUST account for this so a fill affordance is not silently cancelled.
- **Idle/active brightness delta is small.** On the dark palette the idle icon is
  `--muted-foreground` (`#888888`) and the active icon is `--foreground` (`#e0e0e0`) on a
  `--popover` (`#252526`) rail. This delta alone reads as "not highlighted" on a small icon,
  which is why FR-002/FR-003 require an additional, more legible affordance.
- **Tooltip `asChild` wrapper hijacks `data-state`.** Each `TabsTrigger` is wrapped in
  `TooltipTrigger asChild`; both Radix primitives write a `data-state` attribute and the
  Tooltip's wins (spread last), so the trigger's `data-state` is never `"active"`. The active
  highlight therefore MUST be applied from React state (`surface === id`), not via a
  `data-[state=active]:*` selector (FR-008; see `docs/DEVELOPMENT.md` "Nested Radix triggers").
- **Reduced motion.** Any transition used for the highlight (e.g. a fade/`transition`) MUST
  degrade gracefully under `prefers-reduced-motion`; the selected state MUST still be fully
  legible without animation. The highlight is a static state, not an animation, so reduced
  motion MUST NOT remove the highlight itself.
- **Focus vs active distinction.** Focus-visible (keyboard focus ring) and active-selected
  are separate states and MUST remain visually distinguishable (FR-009); an item can be
  focused without being selected.
- **Out of scope:** the in-panel VS Code-style tabs inside each surface; the
  surface-switching logic, default surface, mount/visibility behavior, and tooltip/aria
  wiring already specified by `sidebar-surface-switch-v1`; persisting selection across
  restarts; any new IPC / main-process / MCP work; hover-state restyling beyond keeping it
  distinct from the active state.

## Success Criteria

| ID     | Criterion                                                                                                                              |
|--------|--------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | For each of the five surfaces, the selected rail item is clearly distinguishable from the idle items at a glance (full-brightness icon plus at least one non-color affordance). |
| SC-002 | At all times exactly one rail item is highlighted; the other four are idle.                                                            |
| SC-003 | Switching surfaces (click, keyboard, or surface:next / surface:prev) moves the highlight to the new surface and returns the old one to idle. |
| SC-004 | The active highlight is identical whether the surface was selected by pointer or by keyboard, and is not produced by hover or focus alone. |
| SC-005 | The keyboard focus ring remains visible and visually distinct from the active-selected highlight.                                      |
| SC-006 | Every rail item retains its tooltip and `aria-label`; no accessibility regression versus the current rail.                             |
| SC-007 | The change touches only the rail styling (App.tsx and the line-variant active classes); the in-panel VS Code tabs and the switching logic are unchanged. |

---

## Open Questions

- [ ] The spec mandates "full-brightness icon plus at least one additional non-color
  affordance (fill and/or the existing primary left bar)" but intentionally does not pick
  the exact visual treatment (fill color/shape, whether to keep or drop the left bar, exact
  contrast values). That is a design decision for the `design` step / designer. If a
  specific visual target is already desired (e.g. a filled rounded-square like a VS Code
  activity-bar selection vs. keeping the thin left bar), confirm it during design rather
  than here.
