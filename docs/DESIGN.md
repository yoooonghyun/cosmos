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
  · §12 Motion · §13 Z-index ladder · §14 Primitive component canon** (the formal scales)
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

Foreground/semantic tokens: `text-foreground #e0e0e0`, `text-muted-foreground #888888`,
`border-border #333333`, `--ring #d8b4fe`, `destructive #f3b0b0` (on `destructive-foreground #1e1e1e`).

## 3. Brand & active-affordance

- **Brand gradient** (logo only): `--brand-pink #f9a8d4` → `--brand-purple #d8b4fe`.
- **`--primary` = `#e9aee9`** (the logo-matched midpoint) — primary controls / brand accents.
- **`--brand-accent` = `#d8b4fe`** — the SOLID accent for active/selected/connected chrome (rail
  indicator, active-tab pill, Switch on-track, connected dot, focus ring). Active state NEVER
  reverts to the old blue.
- **Focus ring** uses `--ring #d8b4fe`, kept thin (≈1.5px) — not a thick 3px ring.

## 4. Component canon

- **Dialogs**: shadcn `Dialog` with canonical `DialogHeader` > `DialogTitle` (foreground, default
  title size) + `DialogDescription` (muted-foreground, default body size). NOT an `Alert` card, NOT
  bespoke text styling.
- **Destructive confirm** (disconnect, delete): `ghost` Cancel (autofocused so a stray Enter can't
  fire the destructive action) + `destructive` confirm Button, both at the app's **default Button
  size** (no off-system `size="sm"`). The destructive semantic lives ONLY on the confirm Button —
  not the surrounding text/background.
- **Buttons**: use shadcn variants (`default`/`secondary`/`ghost`/`outline`/`destructive`/`cosmos`).
  `cosmos` = the brand-gradient Send/primary action. Don't invent per-surface button styles.
- **Every state**: a surface is undesigned until loading / empty / populated / error / disabled are
  all specified. Agent-generated (A2UI) surfaces especially must degrade gracefully.
- The full primitive matrix (each component's variants/sizes + usage rule) is the **primitive
  canon, §14**. This section is the cross-cutting rules; §14 is the per-component reference.

---

# Foundation scales (§7–§14)

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
| `--destructive` / `-foreground` | `#f3b0b0` / `#1e1e1e` | destructive action only (§4) |
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

The 16 `components/ui/` primitives. Surfaces **compose from these primitives + foundation tokens and
do NOT invent per-surface button/dialog/badge styles** (this is the systemic form of §4). Primitives
are named by **component** (path-resilient — the `components/` tree may move); each row is the variant/
size surface + its usage rule.

| Primitive | Variants / sizes | Usage rule |
|---|---|---|
| **Button** | variants `default · cosmos · destructive · outline · secondary · ghost · link`; sizes `default · xs · sm · lg · icon · icon-xs · icon-sm · icon-lg` | The canonical action. `cosmos` = brand-gradient Send/primary. Destructive-confirm uses `ghost` Cancel + `destructive` confirm at **default size** (§4 / D-2). Never a bespoke button. |
| **Badge** | variants `default · secondary · destructive · outline` (+ feature `--status-*` tints) | Status/meta chips; status color is reinforcement, the label carries meaning. |
| **Card** | (single) header/content/footer slots | shadcn `Card` (radius xl, `--shadow-raised`). Panels are NOT Cards — they are `bg-card` sections (§2). |
| **Dialog** | `DialogContent` + Header/Title/Description/Footer | EVERY `DialogContent` MUST set `bg-popover` (D-1). Title = `text-title` foreground; Description = `text-body` muted. overlay z-layer. |
| **ConfirmDialog** | (composed Dialog) | Destructive-confirm canon (D-2): `ghost` autofocus Cancel + `destructive` confirm, default size, `bg-popover`. |
| **Tabs** | list/trigger/content | active trigger uses `--brand-accent` (D-4), never blue. |
| **Select** | trigger/content/item/label | overlay z-layer; `bg-popover` content; item text `text-body`/label `text-caption`. |
| **Tooltip** | content/arrow | overlay z-layer; inverted (`bg-foreground text-background`) chip; `--duration-fast` enter. |
| **Switch** | (single) | on-track uses `--brand-accent` (D-4); `control` elevation. |
| **Input** | (single) | `--input` border, `control` elevation, **thin** focus ring (`ring-[1.5px]`, D-5). |
| **Textarea** | (single) | field-sizing; **thin** focus ring (`ring-[1.5px]`) — already canonical. |
| **Label** | (single) | pairs with Input/Switch; `text-body` medium. |
| **Avatar** | image/fallback (+ status badge) | fallback on `--primary`; status badge at `--z-raised`. |
| **Alert** | default/destructive | informational band; NOT a substitute for a Dialog (§4). |
| **Skeleton** | (single) | `bg-muted` loading placeholder; the canonical loading state. |
| **ScrollArea** | (single, Radix hover) | the canonical scroll region; pair with `scrollbar-hover-only` @utility where a plain `overflow` div is used (Slack per-list scroll). |

**Reconciliation note (migration item, NOT done this cycle):** **Button** and **Badge** ship
`focus-visible:ring-[3px]`, which diverges from the canonical **thin ~1.5px** ring (§3 / D-5; Textarea
already uses `ring-[1.5px]`). Adopt the thin ring as canon; the `ring-[3px]` → `ring-[1.5px]` flip on
Button/Badge (and the `focus-visible:ring-[3px]` on `FileTabStrip`/`PanelTabStrip`/`ResizeDivider`) is
a **migration-backlog** item, deliberately not flipped here.

## 5. Design Criteria Registry (enforced rules + why)

Each rule was learned from a real defect or decision. Add a row whenever you establish/repair a
standard. Format: `ID — rule — why — where`.

| ID | Rule | Why (rationale / incident) | Where |
|----|------|----------------------------|-------|
| **D-1** | **Every `DialogContent` (and modal/popover surface) MUST explicitly set `bg-popover`.** shadcn's `DialogContent` default is `bg-background`, which is the WRONG (editor `#1e1e1e`) surface. | The Disconnect confirm modal regressed 5+ times: its code looked canonical, but it inherited the implicit `bg-background` default while every sibling dialog passes `bg-popover (#252526)` — so it rendered on a darker, off-system surface and the title/description contrast read wrong. Invisible to code review because the wrong surface comes from an *omitted* class. | `components/ui/confirm-dialog.tsx`, all `DialogContent` sites |
| **D-2** | Destructive-confirm modals use `ghost` Cancel (autofocus) + `destructive` confirm at default size; destructive semantic on the action only. | Keeps every disconnect/delete prompt uniform; prevents a stray Enter from dropping a connection. | `confirm-dialog.tsx`, `SettingsDialog.tsx` |
| **D-3** | Panels are `bg-card`; any in-flow band docked to a panel (e.g. the Cosmos docked composer) MUST carry the SAME `bg-card` so the panel reads as one continuous color top-to-bottom — never expose `bg-background` underneath. | The docked Open-Prompt composer band was a sibling below the panel `<section>` with no surface of its own, exposing `bg-background` → a visible top/bottom color seam. | `App.tsx` SharedComposer docked branch |
| **D-4** | Active/selected/connected chrome uses `--brand-accent`, never blue. | Brand consistency; the old blue accent kept leaking back in. | rail, tabs, switches, dots |
| **D-5** | `--primary` is `#e9aee9` (logo-matched); focus ring `--ring` thin (~1.5px). | Primary controls must match the logo color; the focus border was too thick. | `index.css`, inputs |
| **D-6** | **New surfaces compose from the named foundation scales (§7–§14), never raw arbitrary values** — typography from §8 (`text-nano…text-title`, no `text-[Npx]`/`leading-[…]`), spacing from §9 (4px grid + `--space-*`, no `px-2.5`/`gap-[…]`), radius §10, elevation §11 (`--shadow-*`/`glass-dock`), motion §12 (`--duration-*`/`--ease-*`, no `duration-[…]`/`ease-[…]`), z-index §13 (named rung, no fresh `z-50`). | The renderer grew components-first: every non-color dimension was assigned ad-hoc per feature (~85 raw arbitrary values across ~26 files), so the same need resolved to different values on different surfaces. Named scales make a new surface on-system by construction. | `index.css` foundation block, all new surfaces; existing drift tracked in the migration backlog |
| **D-7** | **Canonical focus ring is thin ~1.5px** (`ring-[1.5px]`, == Textarea/Input); the `ring-[3px]` on Button/Badge (and `FileTabStrip`/`PanelTabStrip`/`ResizeDivider`) is a migration item, NOT flipped in the foundation cycle. | Reconciles the D-5 thin-ring canon against the components that still ship the thick 3px ring — recorded as backlog so the divergence is tracked, not silently flipped under the appearance-unchanged foundation. | §14, migration backlog |

## 6. How the designer maintains this file

1. **Before** designing any surface: read §2 (surface→token map), §5 (registry), and the relevant
   foundation scale (§7–§14), and design to them. Express every text size / space / radius / shadow /
   transition / stacking decision as a **named token** (D-6) — no raw arbitrary values on new surfaces.
2. When a surface needs something the canon doesn't cover, decide the standard ONCE, apply it, and
   **add/update the row here** (token table, a scale section §7–§14, and/or the registry) so it's
   enforced next time. A genuinely new scale step extends the relevant section + adds the matching
   token to `index.css` — never an inline value.
3. After implementation (design review, design skill Step 6): audit the built surface against §2,
   §5, and §7–§14. Any deviation is a fix, and if it reveals a missing rule, record it here.
4. **Keep the doc and the stylesheet in sync.** Every scale token named in §7–§14 MUST exist in
   `src/renderer/index.css` and vice-versa; keep §2/§5/§7–§14 coherent with `index.css` and
   `docs/ARCHITECTURE.md`. The migration backlog (existing surfaces still on raw values) lives in
   `.sdd/plans/design-foundation-v1.md` + `TODO.md`, not here.
