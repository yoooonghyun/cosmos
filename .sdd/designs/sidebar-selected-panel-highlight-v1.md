# Design: Sidebar Selected-Panel Highlight — v1

**Status**: Design complete
**Created**: 2026-06-08
**Spec**: .sdd/specs/sidebar-selected-panel-highlight-v1.md
**Plan**: .sdd/plans/sidebar-selected-panel-highlight-v1.md
**Owner**: designer
**Implements**: FR-001..FR-013, SC-001..SC-007

---

## 1. Decision summary

The active rail item gets **three redundant selection cues**, so selection never rests on
the icon-brightness delta alone:

1. **Full-brightness icon** — idle `--muted-foreground` (`#888888`) → active `--foreground`
   (`#e0e0e0`). (Brightness cue — already present, kept.)
2. **A filled rounded-square pill behind the icon** — `--secondary` (`#3a3a3c`) fill on the
   `--popover` (`#252526`) rail. This is the new **shape/fill** non-color affordance: the
   active icon sits in a visibly raised, contained square (the VS Code activity-bar idiom).
3. **A strengthened primary left indicator bar** — the existing 2px `--primary` (`#4a9eff`)
   bar grown to **3px wide and full item height** (top-0 → bottom-0), with a small inset.
   This is the dominant single signal and the one that tints the selection with brand color.

**No new theme token is added.** The existing dark palette expresses the need exactly:
`--secondary #3a3a3c` gives a clear, neutral pill separation from the `#252526` rail, and
`--primary #4a9eff` carries the indicator bar. (`--accent #2d2d30` was rejected as the pill
fill — only ~3 steps off the rail, it reproduces the "too subtle" failure mode the spec
calls out. A primary-tinted fill was rejected as too loud for a persistent state repeated
across five differently-colored icons; the neutral `--secondary` pill lets each surface
icon keep its own identity while the single `--primary` bar provides the accent.)

Why redundant cues and not just a bigger brightness step: FR-002/FR-003 require at least one
non-color affordance and demand the difference be "obvious at a glance." A neutral pill (shape)
+ a thick brand bar (position/color) + full brightness together read as selected instantly and
survive even if a viewer can't resolve the `#888` → `#e0e0e0` brightness step on a small icon.

---

## 2. Surface & layout

**Surface:** the left icon rail in `src/renderer/App.tsx` — a Radix vertical `Tabs`,
`TabsList variant="line"`, 48px (`w-12`) wide, `--popover` (`#252526`) background, right
border `--border` (`#333`). Five `TabsTrigger`s, each `40×40` (`h-10 w-10`), icon via
lucide `<Icon className="size-5" />`, each wrapped in `Tooltip` / `TooltipTrigger asChild`.

**One rail item (the active geometry):**

```
  rail (48px, --popover #252526)
  ┌──┬──────────────────────────┐
  │▌ │   ╭──────────────╮       │   ▌ = 3px --primary bar, full item height,
  │▌ │   │   [ icon ]   │       │       inset ~6px from rail's left edge
  │▌ │   │   pill 40×40 │       │   pill = --secondary #3a3a3c, rounded-md
  │  │   ╰──────────────╯       │   icon = --foreground #e0e0e0, size-5 (20px)
  └──┴──────────────────────────┘
```

- The **pill** is the existing `h-10 w-10 rounded-md` trigger box itself filled with
  `--secondary`. No new element; the fill lands on the `TabsTrigger`'s own background.
- The **bar** is the existing `before:` pseudo-element, restyled from `w-0.5` (2px) to
  `w-[3px]`, and from `top-1 bottom-1` (inset 4px each end) to **`top-0 bottom-0`** (full
  item height) so it reads as a continuous selection edge, not a short tick. Keep
  `before:rounded-full` and the existing `before:left-[-8px]` offset (it sits in the
  rail gutter to the left of the pill; with `gap-1` between items this stays clear).
- The `after:` line-variant indicator stays neutralized (`after:hidden`, already present).

Radius/size unchanged otherwise: `rounded-md` = `--radius-md` = `calc(0.5rem - 2px)` = 6px,
matching the existing trigger and the rest of the rail.

---

## 3. The five states of a rail trigger

All five must stay mutually distinct; **active vs hover vs focus-visible** is the critical
trio (FR-007, FR-009).

| State | Icon color | Pill fill (trigger bg) | Left bar (`before:`) | Focus ring | Notes |
|-------|------------|------------------------|----------------------|-----------|-------|
| **Idle** | `--muted-foreground` `#888888` | none (transparent) | hidden (`opacity-0`) | none | The four non-selected items. |
| **Hover** (idle item) | `--foreground` `#e0e0e0` (existing `hover:text-foreground`) | **none** — no pill | hidden | none | Hover brightens the icon ONLY. No pill, no bar → cannot be mistaken for active. |
| **Active** (selected) | `--foreground` `#e0e0e0` | `--secondary` `#3a3a3c` pill | **shown**, 3px `--primary`, full height | none (unless also focused) | The full treatment from §1. Keyed strictly on `data-[state=active]`. |
| **Focus-visible** (keyboard) | per its own state (idle `#888`, or `#e0e0e0` if it is also the active item) | per its own state | per its own state | **`focus-visible` ring** — `--ring` border + `ring-[3px] ring-ring/50` + `outline-ring` (existing base classes, untouched) | The ring is additive and orthogonal: a focused-but-not-active item shows the ring with NO pill and NO bar. |
| **Disabled** | inherits, at `opacity-50` (`disabled:opacity-50`, existing) | none | hidden | none, `pointer-events-none` | Not used by the rail today (no rail item is disabled), but the base behavior is preserved — do not remove it. |

### Why the three interactive states stay distinct

- **Active = pill + bar + bright icon.** The pill (fill) and bar (3px primary) are present
  ONLY for `data-[state=active]`.
- **Hover = bright icon, nothing else.** Hover deliberately gets no pill and no bar, so
  hovering an idle item never looks selected (FR-007). The only thing hover and active share
  is the bright icon; the pill+bar make active unmistakably "more."
- **Focus-visible = a ring.** The keyboard focus ring is a *border + outer ring* drawn at the
  trigger's edge, a different visual channel from the *filled pill* and the *left bar*. A
  focused idle item shows the ring on a transparent box (no pill); the active item, when it
  is also focused, shows the ring AROUND the pill+bar. Ring ≠ selection (FR-009 satisfied).

---

## 4. Exact tokens used

All existing — **nothing added or changed in `src/renderer/index.css`.**

| Token | Dark value | Role |
|-------|-----------|------|
| `--popover` / `bg-popover` | `#252526` | Rail background (unchanged). |
| `--muted-foreground` / `text-muted-foreground` | `#888888` | Idle icon. |
| `--foreground` / `text-foreground` | `#e0e0e0` | Active **and** hover icon. |
| `--secondary` / `bg-secondary` | `#3a3a3c` | **Active pill fill (the new non-color affordance).** |
| `--primary` / `bg-primary` | `#4a9eff` | Left indicator bar. |
| `--ring` / `ring-ring`, `border-ring`, `outline-ring` | `#4a4a4c` | Focus-visible ring (existing base). |
| `--border` / `border-border` | `#333333` | Rail right border (unchanged). |

> **No `index.css` edit is required for this feature.** Confirmed: `--secondary` gives
> adequate separation from `--popover` (see §6), so a dedicated `--rail-active-*` token is
> not warranted. If a future surface needs a *named* "selected chrome" fill, promote it then;
> do not add it speculatively now.

---

## 5. Class intent for the developer (App.tsx Step 5 — do NOT edit it here)

The developer edits ONLY the rail `TabsTrigger`'s `cn(...)` list in `src/renderer/App.tsx`.
The hard constraint from the spec/plan: the shadcn `line` variant (`tabs.tsx` line 66)
hard-codes
`group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent` **plus a `dark:`
copy**, and because that override is variant-prefixed, `tailwind-merge` cannot dedupe a plain
`data-[state=active]:bg-…` against it — so an un-important fill silently loses at runtime.
**The active background fill MUST win via the Tailwind v4 trailing-`!` important marker.**

Required class changes (intent, not a verbatim diff — keep the existing recenter/`after:hidden`
classes):

1. **Active pill fill — MUST be important.** Replace the current
   `data-[state=active]:bg-transparent` with:
   ```
   data-[state=active]:bg-secondary!
   ```
   The trailing `!` emits `!important`, beating BOTH the base
   `group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent` and its `dark:`
   copy. (This is the same gotcha class as the documented `justify-center` precedent in
   `docs/DEVELOPMENT.md` → Styling.) Without the `!`, the pill will not render.

2. **Active icon brightness — keep.** Keep `data-[state=active]:text-foreground` (no `!`
   needed; nothing competes with it for the line variant). Keep `hover:text-foreground` and
   the base `text-muted-foreground`/idle classes as-is.

3. **Left indicator bar — strengthen.** Update the existing `before:` chain so the bar is
   3px and full height:
   - width `before:w-0.5` → `before:w-[3px]`
   - inset `before:top-1 before:bottom-1` → `before:top-0 before:bottom-0`
   - keep `before:left-[-8px] before:rounded-full before:bg-primary`
   - keep `before:opacity-0 data-[state=active]:before:opacity-100` (bar shows ONLY when
     active — do not key it on hover/focus).
   The `bg-primary` here does **not** need `!` (no line-variant rule targets `before:`).

4. **Do NOT touch** the base `focus-visible:*` classes (border-ring / ring / outline) — the
   focus ring is correct as-is and must remain (FR-009). Do NOT add any
   `hover:bg-*` or `focus-visible:bg-*` — hover/focus must not produce a pill (FR-007).

5. Applies uniformly through the single `RAIL_ITEMS.map` — no per-surface branch (FR-004).

**FR-008 (reaches the trigger through `TooltipTrigger asChild`):** no class work needed —
Radix `Tabs.Trigger` sets `data-state` and `Slot`-merges the className/attributes through
`asChild` onto the rendered `<button>`. The `data-[state=active]:*` classes resolve against
that real element. Developer confirms by inspecting the active `<button>` carries
`data-state="active"` and the `bg-secondary` computed style.

---

## 6. Contrast & accessibility (dark palette)

WCAG ratios (computed against the cosmos dark palette):

- **Active icon on pill** — `--foreground #e0e0e0` on `--secondary #3a3a3c` = **8.6:1**.
  Far exceeds the 3:1 non-text/icon minimum (and the 4.5:1 text minimum). The active icon
  is highly legible inside the pill.
- **Pill vs rail** — `--secondary #3a3a3c` vs `--popover #252526` = **1.35:1**. This is a
  gentle, intentional fill separation; it is reinforcement, not the load-bearing cue. The
  **left bar** is what carries the obvious-at-a-glance weight:
- **Left bar vs rail** — `--primary #4a9eff` vs `--popover #252526` = **5.56:1** — a strong,
  unmistakable edge (the dominant single signal; satisfies FR-003).
- **Idle icon** — `--muted-foreground #888888` on `#252526` = **4.32:1** (legible but
  visibly dimmer than the 11.6:1 of the bright icon on the bare rail — the brightness delta
  is preserved as the third cue).

Net: three independent affordances (shape/fill 8.6:1 legible pill, 5.56:1 brand bar,
brightness delta), so FR-001/FR-002/FR-003/FR-010 all hold without relying on any single
weak signal.

**Tooltip / aria (FR-013):** unchanged — each trigger keeps its `aria-label={label}` and its
`Tooltip`/`TooltipContent side="right"`. No regression.

**Keyboard / focus (FR-009):** the Radix vertical `Tabs` roving-tabindex and the existing
`focus-visible` ring are untouched; the ring remains a distinct channel from the pill+bar
(see §3). Pointer and keyboard selection produce the identical `data-state="active"` →
identical highlight (FR, SC-004).

**Reduced motion:** the highlight is a **static state**, not an animation. The pill fill,
the icon color, and the bar's full opacity are all plain state styles — they do NOT depend
on a transition. The base trigger has `transition-all` (and the `before:`/`after:` have
`transition-opacity`), which only animate the *change* between states; under
`prefers-reduced-motion` the transition collapses to an instant swap but the destination
(pill + bar + bright icon) is fully rendered. **No `prefers-reduced-motion` rule is needed,
and none may remove the highlight.** Do not gate any part of the active treatment behind a
non-reduced-motion media query.

---

## 7. Scope guardrails (from spec)

- Renderer/styling-only. No IPC / main / MCP changes (FR-012).
- Touches ONLY the rail `TabsTrigger` class list in `App.tsx` (and reads, but does not edit,
  `tabs.tsx`'s line-variant override — that override stays; the `!` defeats it at the call
  site) (FR-011).
- Does **not** touch the in-panel VS Code tabs (`PanelTabStrip.tsx`) or the
  surface-switching logic (`sidebar-surface-switch-v1`).

---

## 8. Docs reconciliation note (for wrap-up, not this step)

`docs/ARCHITECTURE.md` §3 currently describes the rail's active state as "foreground icon +
primary left indicator bar." After this feature it is **foreground icon + `--secondary`
filled pill + a strengthened (3px, full-height) `--primary` left indicator bar.** Update that
one clause in §3 at wrap-up to reflect the added fill; no other doc change.

---

## 9. Open questions

None. The spec's single open question (exact visual treatment) is resolved here:
**neutral `--secondary` pill + strengthened `--primary` left bar + full-brightness icon,
all on existing tokens, no `index.css` change.**
