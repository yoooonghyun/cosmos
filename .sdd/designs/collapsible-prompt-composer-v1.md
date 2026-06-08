# Design: Collapsible Prompt Composer — v1

**Status**: Shipped (reconciled post-implementation)
**Created**: 2026-06-07
**Owner**: designer
**Spec**: .sdd/specs/collapsible-prompt-composer-v1.md
**Plan**: .sdd/plans/collapsible-prompt-composer-v1.md

---

## 0. Summary (visual approach in one paragraph)

The four generative panels replace their always-on, full-width bottom composer with one shared
`PromptComposer` component that lives in an **overlay slot** (zero in-flow height) anchored just
above the panel footer. Both states are **always mounted** — conditional mount/unmount would skip
the CSS enter/exit transitions. In its **collapsed** (default) state it shows a single centered
cosmos-logo button (`size-12`, `rounded-xl`, opaque `bg-popover` with a border and shadow). Clicking
it **morphs** into the **expanded** composer: a centered `max-w-2xl` opaque card (textarea + footer
row with the hint and the Send button) that grows up from the logo's point. The hidden state is
`inert` + `pointer-events-none` + `tabIndex=-1` so only the visible state receives focus or clicks.
The morph is carried entirely by the **composer** (scale + opacity + blur, `origin-bottom`, 400ms);
the **logo only fades** (no scale), with a `delay-150` stagger on collapse so the composer shrinks
away first and the button blooms in ("chat becomes the button"). A `motion-reduce:` instant-swap
fallback is provided.

---

## 1. Surfaces & layout

There is ONE surface — the shared `PromptComposer` — with two mutually-exclusive visible states
(FR-002). It occupies a **zero-height overlay slot** as the last-but-one child of the panel
`<section className="flex h-full … flex-col">`, directly above `<PanelFooter>`.

The slot structure:

```
 panel section (flex flex-col)
 ┌─────────────────────────────────────────────────────────┐
 │ PanelTabStrip (h-8)                                      │
 ├─────────────────────────────────────────────────────────┤
 │                                                         ▲ │
 │          content region (flex-1, overflow-auto)         │ │
 │                                                         ▼ │
 ├─────────────────────────────────────────────────────────┤
 │ overlay slot: <div className="relative shrink-0">        │  ← zero in-flow height
 │   <div className="pointer-events-none absolute            │
 │         inset-x-0 bottom-0 flex min-h-[4.5rem]           │
 │         items-end justify-center px-3 pb-3 pt-2">         │
 │     [COLLAPSED button OR EXPANDED form — see §1.1/§1.2]  │
 │   </div>                                                  │
 ├─────────────────────────────────────────────────────────┤
 │ PanelFooter (h-7)  ✦ Generated UI            [status]   │
 └─────────────────────────────────────────────────────────┘
```

The overlay's `pointer-events-none` surround means panel content behind stays fully clickable;
only the composer card and logo button are interactive (via scoped `pointer-events-auto`).

### 1.1 Collapsed state — the logo button (default, FR-001)

A horizontally-centered, bottom-aligned cosmos-logo button. It sits `absolute bottom-3
left-1/2 -translate-x-1/2` inside the overlay so it occupies no row of its own.

- **Button:** `Button variant="ghost" size="icon"` overridden to
  `relative size-12 rounded-xl border border-border bg-popover p-0 shadow-md`.
  - Opaque (`bg-popover` = `#252526`) with a visible `border-border` and `shadow-md`.
  - `rounded-xl` — rounded square, NOT `rounded-full` (departs from original spec).
- **Mark:** `<CosmosMark className="size-8" />` — the pastel gradient sparkle, always-on
  brand gradient (not `currentColor`). See §2.

### 1.2 Expanded state — the centered composer card (FR-010)

A centered, constrained-width form card floating in the overlay. Both states share the same
overlay slot and are cross-faded via the `expanded` flag.

- **Card frame:** `<form>` with classes `w-full max-w-2xl rounded-lg border border-input
  bg-popover p-2 shadow-md`.
  - Fully opaque (`bg-popover` = `#252526`) — tickets behind stay visible through the
    transparent surround, not through the card itself.
  - `border-input` for the frame border.
- **Content:** `Textarea` (borderless, transparent bg) + footer row.

### 1.3 Responsive behavior (narrow panel)

Same as original spec: `max-w-2xl` caps width, `w-full` + slot padding floor it.
The hint span truncates (`min-w-0 truncate`) before the Send button ever wraps.

---

## 2. Logo treatment & decisions (reconciled)

The shipped mark is the **pastel gradient variant** (`CosmosMark.tsx` with a `useId()`
per-instance gradient), NOT the `currentColor` variant recommended in the original spec.
This changes the collapsed button's visual behavior:

- **Mark color:** always the brand pink→purple gradient (`--brand-pink` → `--brand-purple`)
  regardless of interactive state or error. The mark does NOT recolor on hover/focus/error.
- **State coloring via the button frame**, not the mark:
  - Hover: `hover:bg-accent hover:shadow-lg` lifts the button; mark stays gradient.
  - Error: `ring-2 ring-destructive/60` ring on the button frame; mark stays gradient.
- **No `currentColor` recoloring.** The original §8 recommendation (use `currentColor` for
  per-state tinting) was superseded — the brand gradient is the identity; state is conveyed
  by the frame, not the fill.
- **`useId()` gradient id is REQUIRED** — all four panels are mounted simultaneously;
  a static id would collide and `url(#id)` could resolve to a hidden panel's `<defs>`,
  leaving the visible mark unpainted. Do NOT remove `useId()`.

---

## 3. Components, variants & states

### 3.1 Collapsed logo button

| Aspect | Shipped |
|--------|---------|
| Component | `Button variant="ghost" size="icon"`, class override to `relative size-12 rounded-xl border border-border bg-popover p-0 shadow-md` |
| Mark | `<CosmosMark className="size-8" />` — pastel gradient, always-on |
| Interactive overrides | `transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-accent hover:shadow-lg active:scale-95` |
| Tooltip | `Tooltip`/`TooltipTrigger asChild`/`TooltipContent side="top"` → "Open prompt" |
| a11y | `type="button"`, `aria-label={collapsedAriaLabel}` (default "Open prompt"), `aria-expanded={false}`, `tabIndex={expanded ? -1 : 0}` |

### 3.2 Collapsed logo button — interactive states

| State | Treatment |
|-------|-----------|
| Resting | Opaque `bg-popover` frame, brand gradient mark, `border-border` border, `shadow-md`. |
| Hover | `hover:bg-accent hover:shadow-lg` — frame brightens and shadow lifts. |
| Focus-visible | `Button` base ring: `focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring`. |
| Active | `active:scale-95` — tactile press. |
| Disabled | Never disabled (open-only; mid-run collapse allowed — OQ-3). |
| Reduced motion | `motion-reduce:transition-none motion-reduce:active:scale-100`. |

### 3.3 Collapsed logo — "populated" (draft preserved) affordance

When a non-empty draft exists while collapsed, a `size-2 rounded-full bg-primary` dot renders
`absolute right-1 top-1` inside the button (decorative, `aria-hidden`). Implemented as shipped.

### 3.4 Collapsed logo — error affordance

When `hasError` is true: `ring-2 ring-destructive/60` on the button frame. The mark stays
gradient. Error clears on next `started`/`completed` agent status event. Implemented as shipped.

### 3.5 Expanded composer — components

| Element | Spec |
|---------|------|
| Card frame | `<form>` with `w-full max-w-2xl rounded-lg border border-input bg-popover p-2 shadow-md` |
| Textarea | `Textarea`, classes `max-h-[9rem] min-h-[2.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0` |
| Hint span | `text-[11px] text-muted-foreground` (see §5 — font-size token decision) |
| Send | `Button variant="cosmos" size="sm"` — the brand-gradient variant, NOT `variant="default"` (departs from original spec) |

### 3.6 Expanded composer — five states

Same logic as original spec §3.6. The Send button in the populated/enabled state uses
`variant="cosmos"` (pastel gradient) instead of `variant="default"` (blue primary).

---

## 4. Animation spec (FR-004, reconciled)

### 4.0 Tailwind v4 gotcha — `scale`/`translate` vs `transform` (CRITICAL)

In Tailwind v4, `scale-*` and `translate-*` utilities compile to the **standalone CSS
`scale:` and `translate:` properties** (not `transform:`). A `transition-[…,transform]` will
**NOT animate them** — you must list `scale` (and `filter` for `blur-*`) explicitly in the
transition property. This was an actual bug during implementation (size jumped instantly,
only opacity faded). The correct declaration is:

```
transition-[opacity,scale,filter]
```

NOT `transition-[opacity,transform,filter]`.

### 4.1 Open / close motion

The COMPOSER carries the full size motion (open: scale up from `scale-[0.08]` at `origin-bottom`;
close: scale back down). The LOGO only fades (no scale on the logo).

| Element | Open (collapsed → expanded) | Close (expanded → collapsed) |
|---------|----------------------------|------------------------------|
| Logo | `opacity-100` → `opacity-0`, no delay | `opacity-0` → `opacity-100`, `delay-150` (blooms in after composer shrinks) |
| Composer | `scale-[0.08] opacity-0 blur-sm` → `scale-100 opacity-100 blur-0` | `scale-100 opacity-100 blur-0` → `scale-[0.08] opacity-0 blur-sm` |

Both logo and composer use the SAME easing and duration:

- **Duration:** `duration-[400ms]` (both states use 400ms — a single shared duration, not
  open-200ms / close-150ms as originally specified).
- **Easing:** `ease-[cubic-bezier(0.16,1,0.3,1)]` — a smooth fast ease-out (not `ease-out` /
  `ease-in` as originally specified). No bounce.
- **Transition properties:** logo: `transition-opacity`; composer:
  `transition-[opacity,scale,filter]` (see §4.0 above — critical).
- **Composer origin:** `origin-bottom` — grows upward from the logo's point.
- **Logo delay on close:** the logo's `delay-150` stagger means the button blooms in after the
  composer has already shrunk most of the way, selling the "chat becomes the button" handoff.

### 4.2 Reduced-motion fallback

`motion-reduce:transition-none` on both the logo and the composer. State changes (focus
management, draft, `inert`) are unaffected — only the visual tween is removed.

### 4.3 New keyframes/tokens added

None. Pure Tailwind `transition` + `opacity`/`scale`/`filter` utilities.

---

## 5. Tokens used (reconciled)

### 5.1 Base tokens (unchanged)

| Token | Where |
|-------|-------|
| `--popover` (`#252526`) | collapsed button bg + expanded card bg |
| `--border` (`#333`) | collapsed button border |
| `--input` (`#4a4a4c`) | expanded card border |
| `--muted-foreground` (`#888`) | hint text |
| `--foreground` (`#e0e0e0`) | textarea text |
| `--accent` (`#2d2d30`) | logo hover bg |
| `--ring` (`#4a4a4c`) | focus ring |
| `--primary` (`#4a9eff`) | preserved-draft dot |
| `--destructive` (`#f3b0b0`) | error ring on collapsed logo |

### 5.2 Brand identity tokens (NEW — added by this reconciliation pass)

Defined in `src/renderer/index.css` in `@theme inline` (as `--color-brand-*`) and in `:root`
and `.dark` blocks (as `--brand-*`). The dark and light values are intentionally identical —
the pastel gradient is a brand constant, not a theme-sensitive surface color.

| Token | Value (both themes) | Where |
|-------|---------------------|-------|
| `--brand-pink` | `#f9a8d4` | `CosmosMark` gradient start, `Button variant="cosmos"` gradient start (`from-brand-pink`) |
| `--brand-purple` | `#d8b4fe` | `CosmosMark` gradient end, `Button variant="cosmos"` gradient end (`to-brand-purple`) |
| `--brand-foreground` | `#2e1065` | `Button variant="cosmos"` text (`text-brand-foreground`) — dark violet on pastels |

### 5.3 Font-size and z-order decisions

**`text-[11px]` hint copy** — retained as an arbitrary value. Rationale: 11px is a deliberate
below-scale choice for the hint copy (it should recede behind the textarea text and the Send
button). The project's Tailwind scale has `text-xs` at 12px and no step below it. Adding a
dedicated type-scale token (`text-2xs` or similar) for a single use site would be premature
generalization. If a second below-xs text context arises, a `text-2xs` / `--text-hint` token
should be added at that time. The arbitrary value is acceptable here.

**Stacking / z-order** — no z-index token or arbitrary `z-*` value is used in the overlay.
The composer floats via the `absolute` positioning within the `relative shrink-0` slot, not by
z-index. This works because the slot is the last-but-one child of the panel's flex column;
the panel's own stacking context ensures the overlay sits above the content region without any
explicit `z-index`. The `pointer-events-none` surround and per-element `pointer-events-auto`
handle hit-testing. No z-index scale is needed.

---

## 6. Interaction & a11y

### 6.1 Focus management

- **On expand:** `useLayoutEffect` moves focus to `textareaRef.current?.focus()` once
  `expanded` flips `true` (FR-011).
- **On collapse:** `pendingLogoFocus` ref gates the focus return — `logoRef.current?.focus()`
  fires only on an explicit collapse (submit / Esc / outside-click), not on first mount (FR-012).

### 6.2 Keyboard paths

| Key | Behavior |
|-----|----------|
| `Enter` (textarea) | submit if non-empty + not running → send + collapse |
| `Shift+Enter` | insert newline |
| `Esc` (composer focused) | collapse, preserve draft |
| `Enter`/`Space` (collapsed logo) | activate → expand |
| `Tab` | normal order within composer (textarea → Send) |

### 6.3 ARIA / AT semantics

- Collapsed logo: `aria-label={collapsedAriaLabel}`, `aria-expanded={false}`. Mark is `aria-hidden`.
- Hidden state: `inert` + `aria-hidden` + `tabIndex=-1`.
- Expanded form: `aria-label={ariaLabel}` (per-panel). Textarea also carries `aria-label`.
- Both states always mounted: `inert` is the AT/focus gate; `aria-hidden` suppresses AT tree
  for the hidden state. This approach is correct — `inert` propagates to all descendants.

### 6.4 Click-outside boundary

`mousedown` (not `click`) listener scoped to `formRef` when `expanded`. Clicks inside the form
do NOT collapse; clicks outside do.

### 6.5 Contrast

- Brand gradient (`#f9a8d4`/`#d8b4fe`) on `--brand-foreground` (`#2e1065`): passes WCAG AA
  (dark violet on pastel pink/purple averages ~7:1).
- Error ring `--destructive` (`#f3b0b0`) on `bg-popover` (`#252526`): visible at `ring-2`.
- Focus ring `--ring` at `ring-[3px]`: visible on dark surface.

---

## 7. shadcn / component additions (reconciled)

One new `Button` variant was added: `cosmos` — the brand-gradient Send control. Defined in
`src/renderer/components/ui/button.tsx` using `from-brand-pink to-brand-purple text-brand-foreground`.

No other `components/ui/` primitive was added. `CosmosMark` lives at `src/renderer/CosmosMark.tsx`
(a brand asset, not a design primitive).

---

## 8. Asset: CosmosMark (reconciled)

`CosmosMark.tsx` is an inline SVG that:

- Accepts `SVGProps<SVGSVGElement>` and is sized by the caller via `className` (e.g. `size-8`).
- Uses `useId()` to generate a per-instance gradient id — required because all four panels are
  mounted simultaneously and a static id would collide.
- References `var(--brand-pink)` and `var(--brand-purple)` for gradient stops — no raw hex.
- Is `aria-hidden` / `focusable="false"` (the owning button carries the accessible name).
- Does NOT use `currentColor` — the brand gradient is always-on. State affordances are on the
  button frame, not the fill.

---

## 9. Per-panel parameterization

| Prop | Generated UI | Jira | Slack | Confluence |
|------|--------------|------|-------|------------|
| `placeholder` | "Describe the UI you want…" | "Ask about your Jira issues…" | "Ask about Slack" | "Ask about Confluence" |
| `ariaLabel` | "Compose generated UI" | "Ask about your Jira issues" | "Ask about Slack" | "Ask about Confluence" |
| `collapsedAriaLabel` | "Open prompt" (default) | same | same | same |

---

## 10. Notes & known gotchas

- **Tailwind v4 `scale`/`translate` are NOT `transform`** (§4.0): must use
  `transition-[opacity,scale,filter]` not `transition-[opacity,transform,filter]`. This was
  a real bug — scale jumped instantly until corrected.
- **`useId()` gradient id in `CosmosMark`** (§8): MUST NOT be removed. Multi-mount collision
  leaves the mark unpainted.
- **Brand tokens are theme-invariant** (§5.2): `--brand-pink`/`--brand-purple`/`--brand-foreground`
  have the same value in `:root` and `.dark`. This is intentional — the gradient is a brand
  constant, not a palette surface.
- **`tw-animate-css` is NOT installed** (pre-existing gap): the `animate-in`/`fade-in-0` classes
  in `tooltip.tsx`/`select.tsx` are inert. If the team wants shadcn enter/exit animations to run,
  install `tw-animate-css` and `@import` it in `index.css`. Out of scope here.
- **R-1 (error ring):** the collapsed-logo error ring is implemented, driven by `agent.onStatus`.
- **R-2 (draft dot):** implemented as `absolute right-1 top-1 size-2 rounded-full bg-primary
  ring-2 ring-background` inside the relative button.
