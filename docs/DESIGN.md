# DESIGN.md — cosmos design foundation + criteria (single source of truth)

This file is the **authoritative, enforced design foundation** for every cosmos renderer surface:
the **named scale system** (color, typography, spacing, radius, elevation, motion, z-index) AND the
**criteria registry** (the rules learned from recurring visual bugs). It exists for the same reason
`docs/TEST-SCENARIOS.md` exists for tests: so a rule (or a scale) decided once is written down and
never silently re-broken or re-invented by a later change or a different agent/session.

**Owned by the `designer` agent.** The designer MUST read this file BEFORE designing any surface,
and MUST update it whenever it establishes or changes a design standard. `docs/ARCHITECTURE.md`
remains the authoritative *product/architecture* design; this file is the *visual-system* canon —
both the foundation scales and the criteria. When the two disagree, reconcile — don't fork.

Scope note: this is the foundation + criteria + rationale, not a per-feature design spec. Per-feature
specs still live at `.sdd/designs/<feature>-v<N>.md`. This file is the cross-cutting canon those
specs obey.

**Foundation status (design-foundation-v1):** every scale below is realized as a token in
`src/renderer/index.css`; the doc and the stylesheet MUST stay in sync (the §-by-§ token names here
each exist as a `--…` token there, and vice-versa). The foundation is **additive** — it was
authored without restyling any shipped surface. Existing surfaces still carry raw values
(`text-[13px]`, `z-50`, `duration-[450ms]`, …); those are tracked in the **migration backlog**
(`.sdd/plans/design-foundation-v1.md` + `TODO.md`) and moved onto the named tokens incrementally,
NOT in one big-bang. New surfaces MUST use the named tokens from the start.

### Section map

- §1 Foundations · §2 Surface→token map · §3 Brand & active-affordance · §4 Component canon (rules)
- **§7 Color system · §8 Typography ramp · §9 Spacing rhythm · §10 Radius scale · §11 Elevation ramp
  · §12 Motion · §13 Z-index ladder · §14 Primitive component canon · §15 Chat-surface canon** (the formal scales)
- §5 Design Criteria Registry · §6 How the designer maintains this file

---

## 1. Foundations

- **Dark-first, single mode.** cosmos forces `.dark` at runtime; `:root` is only a light fallback.
  Design for the dark palette only.
- **Stack:** Tailwind CSS v4 + shadcn/ui (new-york, Radix-based) under `src/renderer/`.
- **Tokens are the only source of color/spacing/radius.** Surfaces consume CSS-variable tokens
  (defined in `src/renderer/index.css`). **No raw hex outside `index.css`.** A new need that no
  token expresses = extend the token set (designer-owned), never a one-off inline value.
- **Cascade-layer gotcha** (see `docs/DEVELOPMENT.md`): never target a Tailwind-plugin class
  (`.prose`, etc.) from an unlayered `App.css` rule.

## 2. Surface → token map (THE load-bearing table)

Every surface MUST sit on its designated token. This table is the canon; deviating from it is the
single most common source of "this one screen looks off-system" bugs.

| Surface kind | Background token | Hex (dark) | Notes |
|---|---|---|---|
| App shell / editor backdrop / title bar | `bg-background` | `#1e1e1e` | The VS Code editor surface. |
| Panel body (Slack/Jira/Confluence/Calendar/Cosmos) | `bg-card` | `#1b1b1c` | Panels are `border-l border-border bg-card`. |
| **Dialog / modal / popover / dropdown / tooltip** | **`bg-popover`** | **`#252526`** | **The chrome surface. EVERY dialog passes `bg-popover` — see Rule D-1.** |
| Muted fill (skeleton, inert chip) | `bg-muted` | `#252526` | |
| Hover/active accent fill | `bg-accent` | `#2d2d30` | |
| Inset input field | `bg-input` border / `bg-popover` card | `#4a4a4c` border | Composer card body = `bg-popover`. |
| **Cosmos timeline — user prompt bubble** | **`bg-primary`** (`text-primary-foreground`) | **`#e9aee9`** | **Right-aligned filled bubble = the deliberate brand "my message" accent (the universal sent-message convention). The ONE intentional `--primary` surface in chat. Chat-surface canon §15 / D-14.** |
| **Cosmos timeline — prompt context (in-bubble header)** | **on `bg-primary`** (`text-primary-foreground/80` labels) | **`#e9aee9`** | **The breadcrumb is now the STATIC HEADER section INSIDE the user-prompt box (header → `border-primary-foreground/20` divider → body), NOT a free-standing `bg-secondary` pill above the bubble. Labels `text-primary-foreground/80` (≈5.4:1), decoration `opacity-70`, NEVER `text-muted-foreground` on the pink (≈1.9:1 fail). Shares `max-w-chat-bubble` (D-11/D-14/D-18).** |
| **Cosmos timeline — assistant reply** | **none — bare on panel `bg-card`** | `#1b1b1c` | **No bubble; `text-card-foreground`. user-filled-right / assistant-plain-left (D-14).** |
| **Cosmos timeline — tool-call / typing row** | **`bg-muted/40`** | `#252526` @40% | **Quiet inert rows (D-8/D-14).** |

Foreground/semantic tokens: `text-foreground #e0e0e0`, `text-muted-foreground #888888`,
`border-border #333333`, `--ring #d8b4fe`, `destructive #d23f3f` (on `destructive-foreground #ffffff`).

## 3. Brand & active-affordance

- **Brand gradient** (logo only): `--brand-pink #f9a8d4` → `--brand-purple #d8b4fe`.
- **`--primary` = `#e9aee9`** (the logo-matched midpoint) — primary controls / brand accents.
- **`--brand-accent` = `#d8b4fe`** — the SOLID accent for active/selected/connected chrome (rail
  indicator, active-tab pill, Switch on-track, connected dot, focus ring). Active state NEVER
  reverts to the old blue.
- **Focus ring** uses `--ring #d8b4fe`, kept thin (≈1.5px) — not a thick 3px ring.

## 4. Component canon

- **Dialogs**: shadcn `Dialog` with canonical `DialogHeader` > `DialogTitle` (foreground,
  `text-title`) + `DialogDescription` (muted-foreground, `text-body`). NOT an `Alert` card, NOT
  bespoke text styling. There are exactly **two dialog classes** (D-13) — pin every dimension to the
  class, never per-component judgment:

  **Dialog classes (D-13) — the EXACT, enforced spec per class**

  | Dimension | **CONFIRM / ALERT** class (small, decision-forcing) | **UTILITY** class (large, multi-section task) |
  |---|---|---|
  | Examples | `ConfirmDialog` (disconnect/delete) | `SettingsDialog` |
  | Surface | `bg-popover` (#252526) — the primitive default (D-1) | `bg-popover` (#252526) |
  | Width | `sm:max-w-sm` (the ONLY class override) | content-sized large width, e.g. `max-w-[860px]` (always wider than the primitive's `sm:max-w-lg`) |
  | Padding | primitive default `p-6` + `gap-4` | `p-0` with internal sections: header `px-6 pt-6 pb-4 border-b`, footer `px-6 py-3 border-t` |
  | `DialogTitle` | `text-title` (18px) semibold foreground | same |
  | `DialogDescription` | `text-body` (14px) muted-foreground | same |
  | `×` close button | `showCloseButton={false}` (Cancel IS the dismiss) | default (`true`) |
  | Footer container | `DialogFooter` default (`gap-2`, `sm:justify-end`, `flex-col-reverse` on mobile) | `DialogFooter` + section border-t; same `gap-2` / `justify-end` |
  | Footer buttons | `ghost` Cancel (autofocus) + `destructive`/`default`/`cosmos` action — **exactly two** | `ghost` dismiss + primary/`destructive` action |
  | **Footer button SIZE** | **`default` (h-9)** — never `size="sm"` | **`default` (h-9)** |

  **The single button-size rule that ends the divergence:** a dialog **FOOTER action is `default`
  size (h-9) in BOTH classes.** `size="sm"` (h-8) is reserved for **in-body inline row controls**
  (e.g. SettingsDialog's connect/disconnect rows, field reset) — those are NOT footer actions, so
  their smaller size is correct and does NOT make the dialog off-system. Footer = default; in-body
  inline control = sm. No third size.
- **Destructive confirm** (disconnect, delete): `ghost` Cancel (autofocused so a stray Enter can't
  fire the destructive action) + `destructive` confirm Button at **default** size (D-2/D-13); the
  destructive semantic lives ONLY on the confirm Button — not the surrounding text/background.
- **Buttons**: use shadcn variants (`default`/`secondary`/`ghost`/`outline`/`destructive`/`cosmos`).
  `cosmos` = the brand-gradient Send/primary action. Don't invent per-surface button styles.
- **Every state**: a surface is undesigned until loading / empty / populated / error / disabled are
  all specified. Agent-generated (A2UI) surfaces especially must degrade gracefully.
- The full primitive matrix (each component's variants/sizes + usage rule) is the **primitive
  canon, §14**. This section is the cross-cutting rules; §14 is the per-component reference.

---

# Foundation scales (§7–§15)

The named scale system. Each scale is **reconciled from the values already shipped** (it preserves
the current dark look, it does not redesign it) and is realized as a token in `src/renderer/index.css`.
Build every new surface from these names; never a raw arbitrary value.

## 7. Color system

The core palette + the feature families. **No raw hex outside `index.css`** — every color use goes
through a token. (Surface→token mapping is §2; brand/active-affordance is §3; this section is the
full color *system* those two sit inside.)

### 7.1 Core semantic tokens

The shadcn semantic set, mapped to cosmos's VS Code-dark palette in `.dark` (`:root` is the light
fallback only). Each has a `-foreground` pair for on-surface text:

| Token | Dark hex | Role |
|---|---|---|
| `--background` / `-foreground` | `#1e1e1e` / `#e0e0e0` | app shell / editor backdrop |
| `--card` / `-foreground` | `#1b1b1c` / `#e0e0e0` | panel bodies |
| `--popover` / `-foreground` | `#252526` / `#e0e0e0` | dialogs/menus/tooltip chrome |
| `--primary` / `-foreground` | `#e9aee9` / `#2e1065` | primary controls / brand accent (logo midpoint) |
| `--secondary` / `-foreground` | `#3a3a3c` / `#dddddd` | secondary buttons |
| `--muted` / `-foreground` | `#252526` / `#888888` | inert fills / skeletons / meta text |
| `--accent` / `-foreground` | `#2d2d30` / `#e0e0e0` | hover/active fills |
| `--destructive` / `-foreground` | `#d23f3f` / `#ffffff` | destructive action only (§4); a desaturated crimson danger red (NOT the brand pink) — white text for the solid Button fill (D-12) |
| `--border` | `#333333` | hairlines / dividers |
| `--input` | `#4a4a4c` | input field border |
| `--ring` | `#d8b4fe` | focus ring (thin, §3 / D-5) |

### 7.2 Neutral ramp (documented progression)

The dark surfaces form one intentional near-black→gray progression. When a new surface needs a
neutral, pick the **named semantic step** it corresponds to — do NOT introduce a fresh hex between
them:

`#1b1b1c` (card) → `#1e1e1e` (background) → `#252526` (popover/muted) → `#2d2d30` (accent) →
`#333333` (border) → `#3a3a3c` (secondary) → `#4a4a4c` (input).

These are the only sanctioned neutrals. A genuinely new neutral need is a designer decision that
extends this ramp (and this table), never an inline value.

### 7.3 Brand & accent (cross-ref §3)

`--brand-pink #f9a8d4` → `--brand-purple #d8b4fe` (logo gradient only); `--primary #e9aee9` (logo
midpoint, primary controls); `--brand-accent #d8b4fe` (the SOLID active/selected/connected accent —
never blue, rule D-4). See §3 for the full rule.

### 7.4 Feature families (sanctioned semantic extensions)

These are **sanctioned semantic feature families** layered on the core, not violations of "tokens
only." Each is a bounded, dark-tuned palette a feature legitimately needs that the core cannot
express; each ships a `-foreground` for legible on-token text. New feature color needs extend the
*relevant family* (a designer decision recorded here), never an inline value.

| Family | Tokens | Owner / rule |
|---|---|---|
| Jira status | `--status-todo/-progress/-done` (+`-foreground`) | Jira status-category chips; color is reinforcement only — the Badge always shows the status name. |
| Calendar events | `--event-{blue,green,purple,red,amber,gray,teal,cyan,indigo,magenta,pink,olive}` (+`-foreground`) | GCal/shared-calendars hue mapping; the event title always carries meaning. Dot = solid token; all-day bar = token at low alpha + left accent. |
| Glass-dock | `--glass-dock-fill/-edge/-highlight` | the floating detail-dock material knobs (consumed by the `glass-dock` @utility, §11); surfaces apply the `glass-dock` class, never the raw alphas. |

## 8. Typography ramp

A named ramp covering the **real sizes in use** (10/11/12/13/14/16/18px), each pairing a size with a
canonical line-height. Apply a named step — never a raw `text-[Npx]` or arbitrary `leading-[…]`.
Tailwind's `text-xs`(12)/`text-sm`(14)/`text-base`(16) remain valid aliases for the corresponding
body steps; the named tokens ADD the sub-12px dense steps and the title step.

| Step (utility) | Token | Size | Line-height | Used for |
|---|---|---|---|---|
| `text-nano` | `--text-nano` | 10px | 14px | densest chips, overflow counts, `+N more` |
| `text-micro` | `--text-micro` | 11px | 16px | dense panel labels, connection status, calendar event labels |
| `text-caption` | `--text-caption` (≡`text-xs`) | 12px | 16px | footer/meta, select labels |
| `text-body-sm` | `--text-body-sm` | 13px | 20px | primary dense body (tree rows, tab labels, timeline text) |
| `text-body` | `--text-body` (≡`text-sm`) | 14px | 20px | default body / control text |
| `text-base` | `--text-base` (≡`text-base`) | 16px | 24px | inputs, lead paragraphs |
| `text-title` | `--text-title` | 18px | 28px | dialog titles, section headings |

**Weight roles** (the only sanctioned weights): `font-normal` (body), `font-medium` (labels, active
chrome, emphasized rows), `font-semibold` (titles, strong emphasis). No other weights.

**Tracking roles** (only where the product actually uses them): `tracking-wide` on
**uppercase micro-labels** (e.g. the calendar weekday header, the `cosmos` wordmark); `tracking-tight`
on the Alert title. Do NOT introduce other letter-spacing axes.

## 9. Spacing rhythm

cosmos uses Tailwind's native **0.25rem (4px) grid** unchanged — `--spacing` is NOT redefined. Use
Tailwind scale steps (`p-1 p-1.5 p-2 p-2.5 p-3 gap-1.5 gap-2 …`) for all padding/margin/gap. The
foundation names the two **dense-surface step aliases** the panels lean on so they read as sanctioned
rhythm, plus the one true off-scale density value:

| Token | Value | Use |
|---|---|---|
| `--space-density-1` | 6px (≡`1.5`) | dense row padding-y (panel headers, list rows, footers) |
| `--space-density-2` | 10px (≡`2.5`) | dense control padding-x (tab labels, inline error banners) |
| `--space-cal-hour` | 48px | calendar hour-cell height — the ONE sanctioned off-grid density value |

**Rule:** off-scale density (calendar hour cells) goes through a **named density token**, never a bare
`h-[48px]` / `gap-[10px]`. Everything else stays on the Tailwind 4px grid. If a new surface seems to
need a fresh off-grid value, that is a designer decision (add a `--space-*` token here), not an inline
arbitrary value.

## 10. Radius scale

The existing `--radius 0.5rem` base + its derivations, named. Tailwind utilities `rounded-sm/-md/-lg/-xl`
consume these; `rounded-2xl` (chat bubbles) and `rounded-full` (pills, dots, avatars) stay built-ins.

| Step | Token | Value | Surface kind |
|---|---|---|---|
| sm | `--radius-sm` | 0.25rem (4px) | inline chips, code chips, small inset fills, dense event blocks |
| md | `--radius-md` | 0.375rem (6px) | controls (buttons, inputs, list rows, badges), `<pre>`/image blocks |
| lg | `--radius-lg` | 0.5rem (8px) | dialogs, composer card, popovers |
| xl | `--radius-xl` | 0.75rem (12px) | large cards (shadcn `Card`) |

## 11. Elevation / shadow ramp

Four named tiers reconcile the ad-hoc `shadow-xs/sm/md/lg`. cosmos is a **flat, dark tool**: panels
and chrome sit on *color*, not lift — shadow is reserved for things that genuinely float. Each tier's
elevation is consistent with its z-index layer (§13).

| Tier | Token / class | ≈ old class | Belongs to (z-layer §13) |
|---|---|---|---|
| flat | (no shadow) | — | panels, tabs, chrome, file tree (base) |
| control | `--shadow-control` | `shadow-xs` | resting controls: input, textarea, switch, outline button (base) |
| raised | `--shadow-raised` | `shadow-sm` | cards, composer card, `cosmos` button (base) |
| overlay | `--shadow-overlay` | `shadow-lg` | dialog, dropdown/select, floating-composer launch (overlay/composer) |
| floating-dock | the `glass-dock` @utility | bespoke multi-layer | the always-overlay detail docks (dock) |

**floating-dock is its own composed material**, not a flat ramp token: the `glass-dock` @utility
(§7.4 / `index.css`) carries the inset specular rim (`--glass-dock-highlight`) + edge
(`--glass-dock-edge`) + outer depth shadow + the per-dock refraction filter. It is classified as the
floating-dock tier so it is part of this documented ramp — surfaces apply the `glass-dock` class,
they do not hand-roll a dock shadow.

## 12. Motion

Named durations + easings reconcile the ad-hoc `120/200/400/450ms` and the dock/launch curves.
**Every motion usage stays `prefers-reduced-motion`-gated** (`motion-reduce:transition-none` on the
element, or the `@media (prefers-reduced-motion: no-preference)` gate the `cosmos-spinner` keyframes
model). The owning surface's text/`aria-busy` carries meaning when motion is off.

| Token | Value | Use |
|---|---|---|
| `--duration-micro` | 120ms | hover/color reveals (scrollbar reveal, tint) |
| `--duration-fast` | 200ms | overlay enter/exit, dock slide, dialog zoom |
| `--duration-slow` | 400ms | composer launch fade (opacity) |
| `--duration-slower` | 450ms | composer launch scale/filter |
| `--ease-standard` | `cubic-bezier(0,0,0.2,1)` | ease-out — docks, overlays, default transitions |
| `--ease-launch` | `cubic-bezier(0.16,1,0.3,1)` | the composer "launch" (expo-out) curve |

**Canonical recipes** (reference the tokens; do not hand-tune):
- **Overlay enter/exit** (dialog, dropdown, tooltip): `--duration-fast` + the shadcn
  `data-[state]:animate-in/out` fade+zoom; gated by Radix.
- **Dock slide** (detail docks): `transition-transform` at `--duration-fast` + `--ease-standard`,
  with `motion-reduce:transition-none`.
- **Composer launch** (PromptComposer fixed layer): fade at `--duration-slow` + `--ease-launch`;
  scale/filter at `--duration-slower` + `--ease-launch`.
- **Spinner** (`cosmos-spinner-*` keyframes): the orbit/pulse animations behind the reduced-motion
  `@media` gate; static base transform when motion is off.

## 13. Z-index ladder

The named stacking ladder formalizing the current order. Base content is `auto`/`0`; everything above
picks a **named rung**, never a fresh `z-50` literal.

| Rung (token) | Value | What belongs here |
|---|---|---|
| (base) | auto / 0 | terminal, panel bodies, file tree, in-flow content |
| `--z-raised` | 10 | in-panel scrim behind a detail dock, avatar status badge, resize divider |
| `--z-dock` | 20 | the glass detail docks / in-panel overlays |
| `--z-overlay` | 50 | app dialog, dropdown/select content, popover, tooltip |
| `--z-composer` | 50 | the floating PromptComposer fixed drag/logo layer (peer of overlay) |

**Ordering rationale:** `dock (20) < overlay (50)` so an app dialog always covers a panel's own detail
dock. `composer` shares `50` with `overlay` (they are never co-stacked in a way that needs a tiebreak)
but keeps a distinct name so a reader sees the composer layer is intentional, not an accidental third
`z-50`. A new overlay picks the rung that matches what it covers — it does not invent a literal.

## 14. Primitive component canon

The 17 `components/ui/` primitives. Surfaces **compose from these primitives + foundation tokens and
do NOT invent per-surface button/dialog/badge styles** (this is the systemic form of §4). Primitives
are named by **component** (path-resilient — the `components/` tree may move); each row is the variant/
size surface + its usage rule.

| Primitive | Variants / sizes | Usage rule |
|---|---|---|
| **Button** | variants `default · cosmos · destructive · outline · secondary · ghost · link`; sizes `default · xs · sm · lg · icon · icon-xs · icon-sm · icon-lg` | The canonical action. `cosmos` = brand-gradient Send/primary. `destructive` = SOLID `--destructive` crimson (`#d23f3f`) fill + WHITE `--destructive-foreground` text (D-12), never stock `dark:bg-destructive/60`. Destructive-confirm uses `ghost` Cancel + `destructive` confirm at **default size** (§4 / D-2). Never a bespoke button. |
| **Badge** | variants `default · secondary · destructive · outline` (+ feature `--status-*` tints) | Status/meta chips; status color is reinforcement, the label carries meaning. |
| **Card** | (single) header/content/footer slots | shadcn `Card` (radius xl, `--shadow-raised`). Panels are NOT Cards — they are `bg-card` sections (§2). |
| **Dialog** | `DialogContent` + Header/Title/Description/Footer | Belongs to one of the two **dialog classes** (§4 / D-13). `DialogContent` DEFAULTS to `bg-popover` + `shadow-overlay` + `z-overlay` (D-1 root fix, §11/§13); never override the surface back to `bg-background`. Title = `text-title` foreground; Description = `text-body` muted (§8). Footer actions = `default`-size buttons in BOTH classes (D-13). Enter/exit at `duration-fast`. |
| **ConfirmDialog** | (composed Dialog) | The canonical **CONFIRM/ALERT** class (§4 / D-13): `sm:max-w-sm`, `showCloseButton={false}`, `ghost` autofocus Cancel + `destructive` confirm (solid crimson fill, white text, D-12) at **default** size, on the primitive's default `bg-popover` (D-1/D-2). |
| **Tabs** | list/trigger/content | active trigger uses `--brand-accent` (D-4), never blue. |
| **Select** | trigger/content/item/label | overlay z-layer; `bg-popover` content; item text `text-body`/label `text-caption`. |
| **ContextMenu** | trigger/content/item (+ checkbox/radio/label/separator/sub) | The right-click / Shift+F10 menu (built on the unified `radix-ui` `ContextMenu` — NO extra install, D-19). Same chrome as Select: portalled `bg-popover` content at `z-overlay`/`shadow-overlay`/`duration-fast`, `rounded-md`; items + labels + shortcuts are all `text-caption` (12px)/`rounded-sm`/`gap-1.5`/symmetric `px-2 py-1.5` with `focus:bg-accent` hover. A floating menu runs ONE step DENSER than the rows it covers, so it sits TWO type steps tighter than Select (`text-caption` 12px vs Select's `text-body` 14px) — every site is the dense Home/Cosmos surface acting on `text-body-sm` rows (D-15). Used for Home's Pin/Unpin (tree rows + favorite strip tabs). A benign toggle → `variant="default"` items, NOT `destructive`. **Short 1-word toggle items (Pin/Unpin) carry NO leading icon** (a `size-4` glyph + `gap-1.5` ahead of a 1-word label reads strongly left-heavy though the `px-2` box is even; label-only is symmetric — D-19 round-2). |
| **Tooltip** | content/arrow | overlay z-layer; inverted (`bg-foreground text-background`) chip; `--duration-fast` enter. |
| **Switch** | (single) | on-track uses `--brand-accent` (D-4); `control` elevation. |
| **Input** | (single) | `--input` border, `control` elevation, **thin** focus ring (`ring-[1.5px]`, D-5). |
| **Textarea** | (single) | field-sizing; **thin** focus ring (`ring-[1.5px]`) — already canonical. |
| **Label** | (single) | pairs with Input/Switch; `text-body` medium. |
| **Avatar** | image/fallback (+ status badge) | fallback on `--primary`; status badge at `--z-raised`. |
| **Alert** | default/destructive | informational band; NOT a substitute for a Dialog (§4). |
| **Skeleton** | (single) | `bg-muted` loading placeholder; the canonical loading state. |
| **ScrollArea** | (single, Radix hover) | the canonical scroll region. **Every scroll region MUST use one of the two canonical treatments (D-9): the Radix `ScrollArea` primitive (JS-driven themed hover overlay), OR a plain `overflow-*` div carrying the `scrollbar-hover-only` @utility.** Never a bare `overflow-*` div (it ships the raw OS/Chromium scrollbar). The `scrollbar-hover-only` @utility hides the bar at rest, reveals a thin themed thumb on the region's own `:hover`, and reserves track via `scrollbar-gutter: stable` (no content shift). Works on both axes (`overflow-x-auto` strips included). |

**Reconciliation note (migration item, NOT done this cycle):** **Button** and **Badge** ship
`focus-visible:ring-[3px]`, which diverges from the canonical **thin ~1.5px** ring (§3 / D-5; Textarea
already uses `ring-[1.5px]`). Adopt the thin ring as canon; the `ring-[3px]` → `ring-[1.5px]` flip on
Button/Badge (and the `focus-visible:ring-[3px]` on `FileTabStrip`/`PanelTabStrip`/`ResizeDivider`) is
a **migration-backlog** item, deliberately not flipped here.

## 15. Chat-surface canon (the Cosmos timeline)

The Cosmos panel is a **chat conversation**, not a surface-composition body. Its timeline
(`CosmosTimelineEntry`) has a fixed **role → token** mapping so every turn is on-system and the
conversation reads `user-filled-right / assistant-plain-left`. The cardinal rule: **`--primary` is
NEVER used as a GENERIC chat surface tint** — the assistant reply stays BARE on `bg-card`, and the
tool-call / typing rows stay `bg-muted/40`. `--primary` (#e9aee9, the logo pink) is the **action /
brand-accent** color; it is not splashed across arbitrary chat surfaces. The **ONE intentional
exception** is the **user's OWN message bubble**, which IS the brand "my message" accent
(`bg-primary` + `text-primary-foreground`) — a deliberate product choice and the universal
sent-message convention (the user's turn is the one surface allowed to carry the brand accent). The
ORIGINAL defect was not "primary on the bubble" but a FADED `bg-primary/15` 15% tint (an off-system,
washed-out wrong color, "원래 쓰는 색이 아니야"); the fix is the SOLID `bg-primary` paired with its
`text-primary-foreground`, not a watered-down tint (D-14).

| Timeline role | Surface | Text | Radius | Align | Width | Type |
|---|---|---|---|---|---|---|
| **User-prompt box (combined)** | `bg-primary` (#e9aee9) — the brand "my message" accent | `text-primary-foreground` (body) | `rounded-2xl rounded-br-sm`, `overflow-hidden` | right (`justify-end`) | `max-w-chat-bubble` | `text-body-sm` (body) |
| ↳ **context HEADER** (when context present) | inside the box, on `bg-primary` | labels `text-primary-foreground/80`, decoration `opacity-70` | — (static, no toggle) | top section, `px-3 pt-1.5 pb-1` | within box | `text-caption` |
| ↳ **divider** (when context present) | `border-t border-primary-foreground/20` | — | — | full-bleed under header | within box | — |
| ↳ **message BODY** (always) | on `bg-primary` | `text-primary-foreground` | — | below divider, `px-3 py-1.5` | within box | `text-body-sm` |
| **Assistant reply** | none — **bare on panel `bg-card`** | `text-card-foreground` | — | left (inside `AssistantRow`) | `max-w-chat-bubble` | `text-body-sm` |
| **Tool-call row** | `bg-muted/40` + `border-border/60` | `text-muted-foreground` (name = `text-foreground`) | `rounded-md` | left / full-width | — | `text-caption` |
| **Typing indicator** | `bg-muted/40` | dots (D-8) | `rounded-2xl rounded-bl-sm` | left | `w-fit` | — |
| **Assistant avatar** | `Avatar size="sm"` (24px) `bg-muted` circle holding `CosmosGlyphIcon` (= `SURFACE_ICON.cosmos`, the rail-tab glyph; `size-4`, `text-muted-foreground`) | mono logo glyph (`aria-hidden`) | `rounded-full` | left, leading the reply (`flex items-start gap-2`) | — | — |

**Assistant avatar (D-17):** every assistant turn — assistant text AND the in-progress `TypingIndicator` — renders inside an `AssistantRow`: a small MONOCHROME Cosmos logo avatar on the LEFT, then the reply. The avatar is `Avatar size="sm"` (a 24px `bg-muted` circle) holding `CosmosGlyphIcon` — the SAME four-point-sparkle glyph the left rail's Cosmos tab uses (`SURFACE_ICON.cosmos`, the one rail-logo source, D-10), already `currentColor`-monochrome — in `text-muted-foreground`, one quiet neutral glyph in the same `muted` family as the tool-call/typing rows, NEVER the brand gradient or `--primary`. This makes the timeline read `user-accent-right / assistant-logo-left`: the user's own turn carries the brand-pink bubble (D-14); the agent's turns carry its logo.

**Why `primary` for the user bubble (and a QUIET in-bubble header for its context):** the user's
bubble carries the brand **`--primary`** accent because it is the user's OWN sent message — the
conventional "my message = brand accent" bubble, the one surface in the timeline allowed to use the
action/brand color. The captured context is now the **static HEADER section INSIDE that same box**
(header → divider → body, D-11/D-18), not a free-standing pill above it: a prompt and the screen it was
sent from read as ONE self-contained unit. The header stays QUIETER than the message — labels at
**`text-primary-foreground/80`** (≈5.4:1, AA), decoration at `opacity-70`, separated by a
**`border-primary-foreground/20`** inset divider — so **accent message vs quiet context** still holds:
the body is the loud element and the context a calm sub-line, now within one box instead of two stacked
pieces. (The header MUST NOT use `text-muted-foreground`, which was tuned for the old `bg-secondary`
pill and computes to ≈1.9:1 on the pink — see D-18.) The header is STATIC — no toggle, no collapse —
the explicit OPPOSITE of the collapsible `ToolCallRow`, whose sectioned STRUCTURE (header/divider/body)
it borrows but whose `bg-muted/40` color it does NOT. The assistant reply stays bare on `bg-card`, so
the conversation still reads `user-accent-right / assistant-plain-left`. **Shared width token:** the
user-prompt box (header + body), AND the assistant reply (`AssistantRow`) all consume
**`max-w-chat-bubble`**
(`--chat-bubble-max-w` = **2/3** ≈ `66.6667%` in `index.css` `@theme` + the manual `@utility` bridge) —
ONE source of truth so they never drift, and so NEITHER a long user turn NOR a long agent turn ever
exceeds 2/3 of the timeline width (user request: a long cosmos message felt overwhelming). A new chat
role extends this table; only the user's own bubble may
carry `--primary` — every OTHER chat surface uses a real card/secondary/muted token, never `--primary`
and never a raw arbitrary width.

## 5. Design Criteria Registry (enforced rules + why)

Each rule was learned from a real defect or decision. Add a row whenever you establish/repair a
standard. Format: `ID — rule — why — where`.

| ID | Rule | Why (rationale / incident) | Where |
|----|------|----------------------------|-------|
| **D-1** | **The `Dialog` primitive DEFAULTS its `DialogContent` to `bg-popover` (root fix, disconnect-modal-design-foundation-v1); NEVER override a dialog/modal/popover surface back to `bg-background`.** The overlay surface also carries `shadow-overlay` (§11) + `z-overlay` (§13) at the primitive. | The Disconnect confirm modal regressed 5+ times: shadcn's `DialogContent` shipped the WRONG `bg-background` (editor `#1e1e1e`) default, so a dialog that merely OMITTED `bg-popover` rendered on a darker, off-system surface with wrong title/description contrast — invisible to code review because the bug came from an *omitted* class. Making `bg-popover` the primitive DEFAULT removes the omission failure mode entirely (consumers may still pass it as defense-in-depth). | `components/ui/dialog.tsx` (default), `confirm-dialog.tsx`, all `DialogContent` sites |
| **D-2** | Destructive-confirm modals use `ghost` Cancel (autofocus) + `destructive` confirm at default size; destructive semantic on the action only. | Keeps every disconnect/delete prompt uniform; prevents a stray Enter from dropping a connection. | `confirm-dialog.tsx`, `SettingsDialog.tsx` |
| **D-3** | Panels are `bg-card`; any in-flow band docked to a panel (e.g. the Cosmos docked composer) MUST carry the SAME `bg-card` so the panel reads as one continuous color top-to-bottom — never expose `bg-background` underneath. | The docked Open-Prompt composer band was a sibling below the panel `<section>` with no surface of its own, exposing `bg-background` → a visible top/bottom color seam. | `App.tsx` SharedComposer docked branch |
| **D-4** | Active/selected/connected chrome uses `--brand-accent`, never blue. | Brand consistency; the old blue accent kept leaking back in. | rail, tabs, switches, dots |
| **D-5** | `--primary` is `#e9aee9` (logo-matched); focus ring `--ring` thin (~1.5px). | Primary controls must match the logo color; the focus border was too thick. | `index.css`, inputs |
| **D-6** | **New surfaces compose from the named foundation scales (§7–§15), never raw arbitrary values** — typography from §8 (`text-nano…text-title`, no `text-[Npx]`/`leading-[…]`), spacing from §9 (4px grid + `--space-*`, no `px-2.5`/`gap-[…]`), radius §10, elevation §11 (`--shadow-*`/`glass-dock`), motion §12 (`--duration-*`/`--ease-*`, no `duration-[…]`/`ease-[…]`), z-index §13 (named rung, no fresh `z-50`). | The renderer grew components-first: every non-color dimension was assigned ad-hoc per feature (~85 raw arbitrary values across ~26 files), so the same need resolved to different values on different surfaces. Named scales make a new surface on-system by construction. | `index.css` foundation block, all new surfaces; existing drift tracked in the migration backlog |
| **D-7** | **Canonical focus ring is thin ~1.5px** (`ring-[1.5px]`, == Textarea/Input); the `ring-[3px]` on Button/Badge (and `FileTabStrip`/`PanelTabStrip`/`ResizeDivider`) is a migration item, NOT flipped in the foundation cycle. | Reconciles the D-5 thin-ring canon against the components that still ship the thick 3px ring — recorded as backlog so the divergence is tracked, not silently flipped under the appearance-unchanged foundation. | §14, migration backlog |
| **D-8** | **Busy affordance is surface-kind-specific.** A generative panel composing a SURFACE into its tabpanel body uses the full-height, centered `SurfaceSpinner` ("Generating…" + sparkle). A CHAT timeline turn-in-progress (Cosmos panel) uses the inline, LEFT-aligned `TypingIndicator` (three pulsing dots on `bg-muted/40`) that reads as "assistant is composing a reply" — never the centered surface spinner. | The Cosmos panel is a chat conversation, not a surface-composition body; the full-height "Generating…" sparkle read wrong there (vertically-centered, surface-build semantics) for a left-side assistant reply. Two distinct busy semantics → two distinct affordances; don't reuse the surface spinner in chat flow. Both gate motion behind `prefers-reduced-motion: no-preference` with a static legible fallback + `role="status"`/`aria-busy` text carrying the busy meaning (§12). | `app/SurfaceSpinner.tsx` (surface), `cosmos/TypingIndicator.tsx` + `cosmos-typing-dot` keyframes in `index.css` (chat); consumed by `CosmosTimelineEntry` `live-generating` branch |
| **D-9** | **Every scroll region uses a canonical scrollbar treatment — the Radix `ScrollArea` primitive OR a plain `overflow-*` div carrying the `scrollbar-hover-only` @utility — NEVER a bare `overflow-*` div (raw OS scrollbar).** Both render a hidden-at-rest, themed-on-hover thumb; `scrollbar-hover-only` reserves track via `scrollbar-gutter: stable` so revealing the bar never shifts content, and works on both axes. | The `scrollbar-hover-only` @utility shipped only in `slackCatalog`'s per-list scroll, so ~15 other scroll regions (panels, dialogs, file viewers, tab strips, the Select menu) rendered the raw OS/Chromium scrollbar — a visible cross-surface inconsistency that drifted because §ScrollArea *named* the utility but no enforced rule required it. Now a class-string presence is node-testable, so the rule is checkable, not just aspirational. **Carve-out:** a 3rd-party widget that owns its OWN internal scrollbar (Monaco editor in `FileViewer`) keeps its widget scrollbar — the utility applies only to real DOM overflow divs. **Carve-out (transient overlay menus — D-19):** a popover MENU `Content` (`ContextMenuContent`, and the latent same case in `SelectContent`) must NOT use `scrollbar-hover-only`. Its `scrollbar-gutter: stable` reserves a permanent RIGHT-edge gutter that makes item highlights stop short of the right edge → a right-heavy asymmetry; a momentary menu has no "bar-appearing shifts content" problem to solve (the stable-gutter's reason), and these menus essentially never scroll, so they use the platform overlay scrollbar (`overflow-y-auto`, no reserved gutter) for a symmetric inset. **Slack guard:** this is VISUAL ONLY — it MUST NOT alter the Slack per-list scroll STRUCTURE (`SLACK_LIST_SCROLL_CLASS` / `slackCatalog/layout.tsx` flex-row per-list split, `feedback-slack-per-list-scroll`); `slackCatalog` already carries the class. | `index.css` `scrollbar-hover-only` @utility, `components/ui/scroll-area.tsx`, all panel/dialog/file-viewer/tab-strip/Select scroll divs (bug `scrollbar-design-inconsistency-v1`) |
| **D-11** | **A read-only "captured context" affordance REUSES the composer `ContextChip` breadcrumb CONTENT — leading `↳` on the in-view item, per-kind glyph, truncating label + `Tooltip`, `role="note"` + `aria-label="Prompt context: …"` — DROPS every interactive control (no `×`/remove) and collapses its dimensions into ONE single-line breadcrumb (segments joined by a `ChevronRight`), NOT a cluster of separate pills. PLACEMENT (superseded by cosmos-context-message-combined-box-v1): the breadcrumb is the STATIC HEADER section INSIDE the right-aligned `bg-primary` user-prompt box — top to bottom: context HEADER → `border-primary-foreground/20` DIVIDER → message BODY (the combined box; ToolCallRow's sectioned structure, but NOT collapsible and NOT muted). It is NO LONGER a free-standing `Badge variant="secondary"` pill ABOVE the bubble. The header is STATIC (no toggle/`aria-expanded`), the body ALWAYS visible; context is still read BEFORE the prompt it scoped; renders on BOTH the live AND historical turn; null context → plain `bg-primary` bubble (no header, no divider).** On the `bg-primary` fill the breadcrumb tones move to the `primary-foreground` family (labels `text-primary-foreground/80`, decoration `opacity-70`) — NEVER `text-muted-foreground` (the old `bg-secondary`-pill tone, ≈1.9:1 on the pink — see D-18). Panel glyph = `SURFACE_ICON` (D-10), dock-item glyph = composer `PRIMARY_ICON` (SC-009). Shared `max-w-chat-bubble` retained. | The Cosmos timeline must show each user-prompt turn's submit-time context (panel/tab/dock) and read as the SAME product as the composer's "↳ item" chip (SC-009) without re-inventing an idiom. The composer splits dimensions into removable badges because each is editable; a historical/live record has nothing to remove, so a single cohesive breadcrumb is quieter. The chip+bubble were two loosely-stacked pieces; merging the breadcrumb INTO the bubble as a static header makes a prompt and the screen it was sent from read as ONE self-contained unit (cosmos-context-message-combined-box-v1), while keeping the breadcrumb content/idiom so the two chips never fork. | composer `app/ContextChip.tsx`, timeline `cosmos/PromptContextChip.tsx` (extracted `PromptContextBreadcrumb`) + `cosmos/CosmosTimelineEntry.tsx` (`UserMessageBox`); designs `.sdd/designs/cosmos-timeline-prompt-context-v1.md`, `.sdd/designs/cosmos-context-message-combined-box-v1.md` |
| **D-12** | **The `destructive` Button renders `--destructive` crimson (`#d23f3f`) as a SOLID fill with WHITE `--destructive-foreground` (`#ffffff`)** (`bg-destructive text-destructive-foreground hover:bg-destructive/85`) — the conventional white-on-red destructive read; NOT shadcn's stock `dark:bg-destructive/60` translucency. | `--destructive` was a pale rose (`#f3b0b0`) sitting close to the brand pink (`--primary #e9aee9`) and appearing nowhere else as a solid fill, so the disconnect/confirm button "looked like a different modal" (user defect). It is now a real danger red mirroring the light scope's `#dc2626` intent, clearly distinct from the brand, and is the SHARED danger/error role token used across 100+ sites (`text-destructive` / `bg-destructive/15` / `border-destructive/40` error Alerts in every panel). White-on-`#d23f3f` ≈ 4.6:1 (AA for the 14px button label); the foreground flipped near-black→white because the fill is now dark. The destructive semantic stays on the action Button only (D-2). **SHARED-TOKEN tradeoff:** the faded `Alert variant="destructive"` error TEXT consumes the same token as `text-destructive` on dark, where `#d23f3f` ≈ 3.7:1 (AA-large, below 4.5 body) — accepted (no single value satisfies both white-on-fill and red-text-on-dark AA); a future split onto a lighter `--destructive-text` token is BACKLOGGED. | `components/ui/button.tsx` destructive variant; `confirm-dialog.tsx`, `SettingsDialog.tsx` "Save & sign out"; `index.css` `.dark --destructive` |
| **D-13** | **Dialogs belong to exactly ONE of two classes — CONFIRM/ALERT (small) or UTILITY (large) — and EVERY dimension is pinned to the class (§4 table), not chosen per-component. The decisive rule: a dialog FOOTER action Button is `default` size (h-9) in BOTH classes; `size="sm"` (h-8) is ONLY for in-body inline row controls (never a footer action).** CONFIRM/ALERT = `bg-popover` + `sm:max-w-sm` + `p-6 gap-4` + `text-title`/`text-body` header + `ghost` Cancel(autofocus)+`destructive`/`default` action at default size + `showCloseButton={false}`. UTILITY = `bg-popover` + large content width + `p-0` sectioned (header/footer border) + same header steps + `ghost`+action footer at default size. | The disconnect `ConfirmDialog` read "off only here": its color/font/button-size were judged per-component against SettingsDialog with NO single codified spec, so divergence was inevitable (the orchestrator found ConfirmDialog=default, SettingsDialog footer=default, but the connect/disconnect ROWS=sm, with no rule saying which a "dialog button" is). Pinning the two classes — and separating footer actions (default) from in-body inline controls (sm) — makes a dialog on-system BY RULE. The actual confirm/alert surface was already token-aligned post-D-1/D-12; this rule LOCKS it so it can't re-drift. | §4 "Dialog classes", §14 (Dialog/ConfirmDialog), `components/ui/dialog.tsx`, `components/ui/confirm-dialog.tsx`, `app/SettingsDialog.tsx` |
| **D-14** | **The user's OWN message bubble IS the brand `--primary` accent (`bg-primary`/`text-primary-foreground`) — the deliberate "my message" convention; every OTHER Cosmos chat surface NEVER misuses `--primary` as a generic surface tint: assistant reply = BARE on panel `bg-card`/`text-card-foreground` (no bubble), tool-call/typing rows = `bg-muted/40`. The context chip above the bubble stays a quieter `Badge variant="secondary"`. The user bubble + context chip share the ONE `max-w-chat-bubble` token (`--chat-bubble-max-w` = 85%).** *(SUPERSEDES the earlier "user bubble = `bg-secondary`" decision, which the user reverted by product call: "사용자 메세지 bubble 색은 primary color로 가줘.")* | The bubble's ORIGINAL defect was `bg-primary/15` — a FADED 15% logo-pink tint, an off-system washed-out wrong color ("원래 쓰는 색이 아니야"), NOT "primary on the bubble" per se. The product wants the conventional brand "my message = accent" bubble, so the fix is the SOLID `bg-primary` paired with `text-primary-foreground`, not a watered-down tint and not a retreat to `secondary`. The narrowed principle stands: `--primary` is the action/brand-accent color and is NOT splashed across arbitrary chat surfaces — the assistant/tool/typing surfaces use real card/muted tokens; only the user's own turn (the universal sent-message convention) carries the accent. The context chip stays `secondary` so context reads as a calm sub-line, not part of the accented message (accent message vs quiet context). The shared width token kills the duplicated raw `max-w-[85%]` on bubble + chip. | §2 (chat rows), §15 chat-surface canon, `cosmos/CosmosTimelineEntry.tsx` (`UserBubble`), `cosmos/PromptContextChip.tsx`, `index.css` `--chat-bubble-max-w` + `max-w-chat-bubble` @utility |
| **D-15** | **A renderer tree that surveys ANOTHER surface's items (the Cosmos panel-tab list) REUSES `FileTree`'s `role="tree"` roving-tabindex pattern + visual language — never a divergent keymap or a bespoke tree.** `ScrollArea` region (D-9); `h-7` `rounded-sm` rows; `text-body-sm` (§8); the VERBATIM FileTree keymap (↑/↓ + Home/End move focus, →/← expand·descend / collapse·ascend, Enter/Space activate); group header = `SURFACE_ICON[panelId]` glyph (D-10) + `RAIL_LABEL`; leaf row = ONE consistent lucide glyph (`AppWindow` for a tab) + label + Tooltip. The row states stay VISUALLY DISTINCT: hover `bg-accent`; roving focus = thin inset `--ring` (D-7); persistent **selection** = leading `--brand-accent` inset left bar + `bg-accent` + `font-medium` + `aria-selected` (D-4); a "live-but-inactive" marker (the source panel's ACTIVE tab) = a leading `--brand-accent` dot. Empty group = quiet `text-caption` "No open tabs" line (FileTree "Empty" idiom); no groups = one calm centered block; a malformed entry is skipped (warn+skip), never crashes. Reads synchronously (no fetch) ⇒ no loading skeleton. | The cross-panel tab tree needs THREE separable row states (hover ≠ keyboard-focus ≠ the tab chosen as context), one more than FileTree's two; codifying the pattern keeps every future "survey another surface" tree on the SAME keymap + visual language instead of re-inventing one, and pins the brand-accent active/selection affordance (D-4) so a selected/active row never reverts to a stray fill or blue. | `cosmos/PanelTabTree.tsx`, `fileExplorer/FileTree.tsx` (idiom source), design `.sdd/designs/cosmos-panel-tab-list-v1.md` |
| **D-16** | **The context-chip data is a DISCRIMINATED UNION — `ContextChipData = { kind:'item'; primary; secondary? } \| { kind:'panel-tab'; panel; tab }` — and a panel+tab selection renders the D-11 breadcrumb, NOT a 5th item kind.** The `panel-tab` chip renders the SAME `[SURFACE_ICON panel] Panel › [AppWindow] Tab` breadcrumb as the read-only timeline `PromptContextChip` (D-11): `Badge variant="secondary"`, muted `ChevronRight` separator, panel glyph from `SURFACE_ICON` (D-10, the ONE source — NOT `PRIMARY_ICON`), tab glyph lucide `AppWindow`, NO `↳` (the `↳` decorates a dock ITEM only, which a panel+tab has none of). The COMPOSER variant keeps the removable `×` (`ghost` `icon-xs` → `contextDismiss:'all'` clears the selection); the TIMELINE variant is read-only. NON-SECRET labels only (`panel.id/label`, `tab.id/label`) — FR-011. The two chips never fork. | The composer/timeline chip was item-oriented (`primary.kind: jira\|slack-channel\|confluence\|calendar` → `PRIMARY_ICON`/`PRIMARY_NOUN`) and could NOT express a plain panel+tab tree selection — its glyph is PER-PANEL (`SURFACE_ICON`), not a fixed icon, and it heads no `↳` dock item. A union keeps the item chip byte-identical while making the panel+tab chip reuse the breadcrumb idiom the timeline already ships, so the two render identically (one with `×`, one read-only). When OQ-3 (cross-panel dock) lands, a dock segment is added by reusing `PromptContextChip.DockSegment`, no new kind. | `app/viewContextCapture.ts` (`ContextChipData`), `app/ContextChip.tsx` (`panel-tab` branch), `cosmos/cosmosSelectedContext.ts`, `cosmos/PromptContextChip.tsx` (D-11 idiom), design `.sdd/designs/cosmos-panel-tab-list-v1.md` |
| **D-10** | **A rail surface's icon has ONE source of truth — `SURFACE_ICON` (`app/surfaceIcons.tsx`), keyed by `SurfaceId`.** BOTH the left rail (`RAIL_ITEM` in `App.tsx`) and that surface's `PanelFooter` consume it; a `PanelFooter` NEVER passes a hand-picked lucide icon. The Cosmos panel keeps the shared `PanelFooter` name+status strip at the BOTTOM of its `<section>` (after the `flex-1` timeline, above the App-level docked composer band) for parity with the other rail panels. | The footer icon was chosen independently of the rail icon, so the two drifted on every panel (Slack footer showed lucide `MessageSquare` while the rail showed the `SiSlack` brand mark; Jira `SquareKanban` vs `SiJira`; Confluence `BookText` vs `SiConfluence`; Calendar `CalendarDays` vs `SiGooglecalendar`; Terminal `SquareTerminal` vs `ClaudeCodeIcon`), and the Cosmos panel had dropped its footer entirely when the docked composer became its bottom chrome. A single keyed map makes footer == rail BY CONSTRUCTION with no second place to drift. Icons are `currentColor` SVGs taking only `className`, so they inherit the footer's `text-muted-foreground` and render fine at the footer's `size-3`. | `app/surfaceIcons.tsx` (`SURFACE_ICON`), `App.tsx` `RAIL_ITEM`, every `PanelFooter` call site (`TerminalPanel`/`JiraPanel`/`SlackPanel`/`ConfluencePanel`/`GoogleCalendarPanel`/`CosmosPanel`), bug `cosmos-footer-and-icon-unify-v1` |
| **D-18** | **A breadcrumb / caption rendered ON the `bg-primary` user-prompt fill draws from the `primary-foreground` FAMILY, never `text-muted-foreground`: meaningful LABELS at `text-primary-foreground/80` (≈5.4:1, AA for the 12px `text-caption`), `aria-hidden` DECORATION (glyphs/separators) at `opacity-70` relative (≈3:1, graphical AA); the message BODY stays full `text-primary-foreground` (≈8.5:1) so the body reads LOUD and the header QUIET. The in-bubble DIVIDER between the context header and the body is `border-t border-primary-foreground/20` — a quiet inset rule in the same foreground family — NEVER `border-border`/`border-border/60` (the dark line tuned for the muted ToolCallRow box). The combined box is `overflow-hidden` so the full-bleed divider clips to `rounded-2xl rounded-br-sm`. Null context → plain bubble: header + divider appear ONLY when context is present (the divider never appears alone).** | Moving the prompt-context breadcrumb off the `bg-secondary` (#3a3a3c) pill onto the `bg-primary` (#e9aee9 pastel pink) fill broke the legacy `text-muted-foreground` (#888888) glyph tone: on the pink it computes to ≈1.9:1 — below even the 3:1 graphical floor, a near-invisible smear (architect-flagged). Re-tone to the `primary-foreground` family (the body already proves #2e1065 on #e9aee9 = ≈8.5:1) fixes contrast AND preserves the D-11 "quiet context vs loud message" hierarchy via opacity steps of ONE foreground token, no new `--primary-foreground-muted` token for a one-surface need. The divider likewise can't borrow ToolCallRow's `border-border/60` (a foreign dark line on the pink); a low-alpha `primary-foreground` rule reads as part of the box. The shared, tone-neutral `PromptContextBreadcrumb` (labels `currentColor`, decoration `opacity-70`) lets the in-bubble header AND the kept `Badge variant="secondary"` standalone shell each set their own base family from ONE content source, so the two never fork. | §2 (in-bubble header row), §15 chat-surface canon, `cosmos/CosmosTimelineEntry.tsx` (`UserMessageBox`), `cosmos/PromptContextChip.tsx` (`PromptContextBreadcrumb`), `index.css` `--primary`/`--primary-foreground`; design `.sdd/designs/cosmos-context-message-combined-box-v1.md` |
| **D-19** | **The right-click / Shift+F10 menu is the shared shadcn/Radix `ContextMenu` primitive (`components/ui/context-menu.tsx`), built on the ALREADY-INSTALLED unified `radix-ui` package (`import { ContextMenu as ContextMenuPrimitive } from "radix-ui"` — it re-exports `@radix-ui/react-context-menu`; NO `@radix-ui/react-context-menu` install). It shares the `Select` menu's chrome (portalled `bg-popover`/`text-popover-foreground` content at `z-overlay`/`shadow-overlay`/`duration-fast`, `rounded-md`; items `rounded-sm`/`px-2 py-1.5` with `focus:bg-accent text-accent-foreground` hover, disabled = `opacity-50`), NEVER a hand-rolled menu — but its `Content` does NOT carry `scrollbar-hover-only` (see the gutter-asymmetry CORRECTION below; type step + icon rule also corrected there). Home's Pin/Unpin uses it on BOTH a `PanelTabTree` `TabRow` (state-reflective single item: `Pin` when unpinned / `Unpin` when pinned; terminal rows = DISABLED item + a `ContextMenuLabel` reason, FR-040) and a favorite STRIP tab (`Unpin`). Pin/Unpin is a BENIGN toggle → `variant="default"` items, NOT `destructive` (close `X` == unpin, reversible, no confirm). A FAVORITE strip tab reuses `PanelTabStrip` AS-IS plus an additive leading `SURFACE_ICON[source.panelId]` glyph (D-10) + the source label + closeable `X` (= unpin); it is distinguished from the default Cosmos tab by WHICH leading glyph it carries + the presence of the `X` (default = `closeable:false`, FR-011) — NO bespoke tab chrome (tab-strip canon / §14). **cosmos-home-keyboard-tab-nav-v1 (additive):** the pinned default "Cosmos" tab ALSO carries a leading glyph — its rail `SURFACE_ICON.cosmos` (D-10), the same source as the favorites' source-panel glyphs — so the strip reads uniformly (glyph + label on every tab); the two tabs differ by Cosmos-sparkle vs source-panel mark plus the favorite's `X`. A NON-closeable strip tab (the default, `closeable:false`) reserves the SAME width the close `X`'s `icon-xs` slot (`size-6`) would occupy via a trailing inert `aria-hidden` spacer, so a tab WITHOUT an `X` is not visually cramped beside closeable tabs — balanced as `leading glyph + label + reserved trailing slot`, matching closeable tabs' `leading + label + X`. This lives in `PanelTabStrip` (the one place), uses the `size-6`/`icon-xs` token (no raw px), and never affects closeable tabs (they keep the real `X`). A favorite's INLINE content is the source surface mounted through the SAME `ActiveTabSurface` host under the source panel's catalog (a LIVE mirror sharing `requestId`/`surfaceId`, no new contract, no extra cosmos spinner — D-8); its GONE-SOURCE + WAITING states reuse the `PanelTabTree` centered empty-block idiom (`flex-col items-center justify-center gap-2 py-8`, a `size-6 text-muted-foreground` `SURFACE_ICON` glyph, `text-foreground` headline + `text-caption text-muted-foreground` body) — calm, foundation-tokened, NEVER an Alert or `destructive`; the gone state carries an **Unpin** `Button variant="secondary" size="sm"` (an in-body inline control → `sm` is correct, D-13), and the favorite is NEVER auto-dropped (FR-031). CORRECTION (user feedback — a favorite is "literally a shortcut showing the source AS-IS"): a favorite tab is a SINGLE FULL-WIDTH pane — the cross-panel tab TREE + the timeline|tree split render ONLY on the default "Cosmos" tab (a favorite has NO tree, NO `ResizeDivider`) — and it shows the source view "as-is" INCLUDING the source panel's OWN floating Open Prompt: while a favorite is active Home HIDES its docked Cosmos composer (publishes a null `'cosmos'` config so the App-level `SharedComposer` renders nothing) and overlays the SOURCE panel's already-published composer (`useActiveComposerConfig(source.panelId)`) as a floating `PromptComposer` whose submit routes to the SOURCE target. NON-SECRET labels/surface only (FR-023). CORRECTION (menu-item density + icon-induced asymmetry, round-2): ContextMenu items are the DENSE menu treatment — items + labels + shortcuts are ALL `text-caption` (12px) + `gap-1.5` + symmetric `px-2 py-1.5` (no per-item margin; the `p-1` content inset is uniform, not a margin). A floating menu reads ONE step DENSER than the rows it covers, so items run TWO type steps tighter than Select (`text-caption` 12px vs Select's `text-body` 14px), not one — the first pass's `text-body-sm` (13px) still read oversized against the dense Home/Cosmos `text-body-sm` tree/tab rows it floats over (D-15), so the items dropped a further step to `text-caption`. SEPARATELY, the row's left/right whitespace read UNEVEN — the user's report is "오른쪽만 여백" (only the RIGHT has extra margin), and there are TWO causes, the PRIMARY one structural: **(P) `ContextMenuContent` carried `overflow-y-auto scrollbar-hover-only`, and `scrollbar-hover-only` sets `scrollbar-gutter: stable` (`index.css`), which RESERVES an 8px scrollbar gutter on the RIGHT edge ALWAYS — even for a short 2-item menu that never scrolls. So the content box's right inset = `p-1` + reserved gutter while top/left/bottom = just `p-1`, and every item's `focus:bg-accent` highlight stops short of the right edge by the gutter → the WHOLE dropdown reads right-heavy.** FIX (P): a transient overlay MENU must NOT use `scrollbar-hover-only`/`scrollbar-gutter: stable` — that utility is for PERSISTENT scroll regions where a bar appearing would shift content (D-9), not a momentary popover; a menu uses the platform OVERLAY scrollbar (no reserved gutter) so the inset is symmetric L/R, and `overflow-y-auto` alone still scrolls the (Radix-clamped, exceedingly rare) tall menu. Only `ContextMenuContent` carried it — `ContextMenuSubContent` is `overflow-hidden` (no gutter). **(S) secondary:** every Pin/Unpin item also rendered a LEADING `size-4` icon (`Pin`/`PinOff`) + `gap-1.5` ahead of a SHORT 1-word label, so the label's left gap (≈`px-2`8 + icon16 + gap6 ≈ 30px) dwarfed its right gap (`px-2` 8px) → an additional left-heaviness on those items. FIX (S): DROP the leading icon on the Pin/Unpin items (a 2-item reversible toggle needs no glyph) at the CALL SITES (`PanelTabTree` terminal-disabled/Pin/Unpin items + `CosmosPanel` favorite-strip Unpin item) — label-only items are symmetric within the `px-2` box; the primitive keeps its generic `[&_svg]` handling for menus that DO need icons. The first pass missed BOTH: it judged only the per-item CSS padding (symmetric) and never inspected the `Content`'s reserved scrollbar gutter (P, the dominant cause) or the icon gutter on a short label (S).** | The feature needed a menu primitive that did not exist; the plan flagged a possible `@radix-ui/react-context-menu` install, but the repo already depends on the unified `radix-ui` (`^1.6.0`) which re-exports `ContextMenu` (verified in `node_modules/radix-ui/dist/index.d.ts`), so adding it is a pure component-authoring step with no install — and using Radix ContextMenu gives native right-click + Shift+F10 keyboard for free (FR-003) instead of bespoke keyboard code. Pinning the primitive's styling to the Select-menu canon stops a future menu from forking onto a different surface; pinning the favorite tab to the existing strip (glyph-only distinction) and the inline mirror to the existing `ActiveTabSurface` host keeps Home reading as the SAME product as the source panels rather than re-skinning their surfaces, and routes the gone/waiting states onto the already-established calm empty-block idiom (not a red error). | `components/ui/context-menu.tsx` (authored), `cosmos/PanelTabTree.tsx` (tree-row trigger), `tabs/PanelTabStrip.tsx` (favorite glyph + per-tab menu slot), `cosmos/CosmosPanel.tsx` (strip favorites + content switch), `cosmos/FavoriteSurface.tsx` (inline mirror + gone/waiting states), `cosmos/favoriteCatalogHosts.tsx`; design `.sdd/designs/cosmos-home-favorite-tabs-v1.md`; spec/plan `cosmos-home-favorite-tabs-v1` |
| **D-17** | **Every Cosmos timeline ASSISTANT turn (assistant text AND the in-progress `TypingIndicator`) renders inside an `AssistantRow`: a small MONOCHROME Cosmos logo avatar on the LEFT, then the reply — `flex items-start gap-2`. The avatar is `Avatar size="sm"` (a 24px `bg-muted` circle) holding `CosmosGlyphIcon` (`size-4`) in `text-muted-foreground` — one quiet neutral glyph in the `muted` family, NEVER the brand pink→purple gradient or `--primary`. The mark is `aria-hidden` (the timeline conveys the speaker). The user's own turn stays the right-aligned `bg-primary` bubble (D-14) → `user-accent-right / assistant-logo-left`.** | The assistant reply rendered BARE with no speaker affordance, so a long agent turn read as ownerless prose; the user asked for the Cosmos logo as the agent's avatar, and specifically the SAME logo the side rail tab uses ("side tab에 사용한 logo … 그걸로 흑백 아바타"). Reusing `CosmosGlyphIcon` (`SURFACE_ICON.cosmos`, D-10 — the four-point sparkle, already `currentColor`-monochrome) keeps the avatar IDENTICAL to the rail's Cosmos mark — not the pastel-gradient `CosmosMark`, not a hand-rolled SVG — so the agent's avatar and its rail tab are one glyph; `text-muted-foreground` keeps it quiet so it never competes with the user's brand-pink bubble; the `Avatar` primitive + foundation `gap-2`/`muted` tokens keep it on-system. Both the assistant-text and `live-generating` branches share `AssistantRow` so the agent reads as the SAME speaker in-progress and settled. | `app/surfaceIcons.tsx` (`CosmosGlyphIcon`/`SURFACE_ICON.cosmos`), `cosmos/CosmosTimelineEntry.tsx` (`AssistantRow`, assistant-text + live-generating branches), `components/ui/avatar.tsx` (`size="sm"`) |

## 6. How the designer maintains this file

1. **Before** designing any surface: read §2 (surface→token map), §5 (registry), and the relevant
   foundation scale (§7–§15), and design to them. Express every text size / space / radius / shadow /
   transition / stacking decision as a **named token** (D-6) — no raw arbitrary values on new surfaces.
2. When a surface needs something the canon doesn't cover, decide the standard ONCE, apply it, and
   **add/update the row here** (token table, a scale section §7–§15, and/or the registry) so it's
   enforced next time. A genuinely new scale step extends the relevant section + adds the matching
   token to `index.css` — never an inline value.
3. After implementation (design review, design skill Step 6): audit the built surface against §2,
   §5, and §7–§15. Any deviation is a fix, and if it reveals a missing rule, record it here.
4. **Keep the doc and the stylesheet in sync.** Every scale token named in §7–§15 MUST exist in
   `src/renderer/index.css` and vice-versa; keep §2/§5/§7–§15 coherent with `index.css` and
   `docs/ARCHITECTURE.md`. The migration backlog (existing surfaces still on raw values) lives in
   `.sdd/plans/design-foundation-v1.md` + `TODO.md`, not here.
