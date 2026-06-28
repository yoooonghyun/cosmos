# Spec: Design Foundation — v1

**Status**: Draft
**Created**: 2026-06-28
**Supersedes**: (none)
**Related plan**: .sdd/plans/design-foundation-v1.md (to follow)

---

## Grounding

Investigated directly via codegraph + agentmemory before authoring (per architect operating principles):

**codegraph / Grep / Read (code structure):**
- Read `src/renderer/index.css` — the current token set. CONFIRMED: color tokens + radius
  exist (`--background #1e1e1e`, `--foreground #e0e0e0`, `--card #1b1b1c`, `--popover #252526`,
  `--primary #e9aee9`, `--secondary`, `--muted`, `--accent`, `--destructive #f3b0b0`,
  `--border #333`, `--input #4a4a4c`, `--ring #d8b4fe`, `--radius 0.5rem` with sm/md/lg/xl
  derivations) PLUS feature token families: Jira status chips (`--status-todo/-progress/-done`),
  Google-Calendar / shared-calendars event hues (12 `--event-*` + foreground pairs), brand
  (`--brand-pink/-purple/-accent/-foreground`), and the `glass-dock` material knobs
  (`--glass-dock-fill/-edge/-highlight`). The only "scale" present is `--radius`. There is
  NO spacing scale, NO typography scale, NO elevation/shadow token, NO z-index token, NO
  motion token in `@theme inline`. Three custom `@utility`s exist (`prose-cosmos`,
  `scrollbar-hover-only`, `glass-dock`) plus the `cosmos-spinner-*` keyframes (the only
  named-motion in the system).
- Read `src/renderer/components/ui/button.tsx` — the primitive variant/size canon model:
  CVA with variants `default | cosmos | destructive | outline | secondary | ghost | link`
  and sizes `default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`. This is the only
  primitive that exposes a full named size ramp; it is the template for "primitive canon."
- Globbed `src/renderer/components/ui/*.tsx` — primitive set: button, badge, card, tabs,
  avatar, alert, skeleton, tooltip, select, dialog, label, switch, input, textarea,
  scroll-area, confirm-dialog (16 primitives).
- Grep audit of `src/renderer/**` for ad-hoc values — takeaways (the evidence for this spec):
  - **Typography drift:** raw `text-[10px]` / `text-[11px]` / `text-[13px]` (+ a few
    `leading-tight`/`leading-none`/`tracking-wide` one-offs) across ~26 files, ~85 total
    arbitrary-value occurrences. GCal catalog alone has ~17. No named ramp.
  - **Z-index ad-hoc:** scrims at `z-10`, glass docks at `z-20`, dialogs/overlays/tooltips/
    floating composer at `z-50`. No documented ladder; the numbers are repeated literals
    spread across `SlackPanel/JiraPanel/ConfluencePanel/GoogleCalendarPanel/PromptComposer`
    and the `ui/` dialog+tooltip.
  - **Motion ad-hoc:** `duration-200` (dock transitions), `duration-[400ms]`,
    `duration-[450ms]`, and a bespoke `ease-[cubic-bezier(0.16,1,0.3,1)]` in PromptComposer;
    no named duration/easing tokens.
  - **Elevation ad-hoc:** raw `shadow-sm`/`shadow-xs`/`shadow-lg` Tailwind defaults plus the
    glass-dock's inline multi-layer `box-shadow`; no cosmos elevation ramp.
  - **Focus-ring inconsistency:** `button.tsx`/`badge.tsx` use `ring-[3px]`, but DESIGN.md
    rule D-5 declares the canon thin (~1.5px); `textarea.tsx` already uses `ring-[1.5px]`.
    Concrete proof the foundation is unreconciled.
- Read `docs/DESIGN.md` — the just-created criteria canon: §2 surface→token map, §3 brand/
  active-affordance, §4 component canon, §5 Design Criteria Registry (D-1..D-5). Confirmed it
  is criteria + rationale, NOT a scale system — the foundation must extend it, not fork it.
- Grep `docs/ARCHITECTURE.md` — design-system section is thin: it frames the renderer as
  "Tailwind v4 + shadcn/ui (new-york) + index.css tokens" and points to DESIGN.md as the
  visual-system canon. Confirms DESIGN.md is the correct home for the formal foundation.

**agentmemory (prior decisions):**
- `memory_recall` "design system tokens Tailwind shadcn foundation typography spacing" → empty.
- `memory_smart_search` "design tokens index.css palette dark theme z-index overlay glass dock"
  → empty. No prior foundation decision recorded; MEMORY.md index notes the standing preference
  "Design system = Tailwind + shadcn" (real component-library system + design agent, not
  token-only) — this spec is consistent with that.
- Persisted this cycle's framing with `memory_save` (mem_mqx3tvq6_46ecdd7d5846).

---

## Overview

cosmos's renderer grew **components-first**: color tokens and a radius scale exist in
`index.css`, but every other design dimension — typography, spacing, elevation, motion, and
stacking order — was assigned ad-hoc per feature (raw `text-[13px]`, arbitrary `px-2.5`,
repeated `z-50` literals, bespoke easing curves). This feature **establishes a formal,
documented design foundation**: a complete set of named scale tokens (color reconciled +
typography + spacing + radius + elevation + motion + z-index) plus a defined primitive
component canon, all homed in `docs/DESIGN.md` as the authoritative foundation document and
realized in `src/renderer/index.css`. It also produces a **migration audit/backlog** of
existing surfaces that drift from the foundation — but does NOT rewrite them this cycle.

## User Scenarios

> Each scenario is independently testable. P1 = must, P2 = should, P3 = nice to have.

### Build a new surface entirely from named tokens · P1

**As a** designer or developer building a new cosmos surface
**I want to** compose every text size, space, radius, shadow, transition, and stacking
decision from named foundation tokens
**So that** a new feature is visually on-system by construction, with no per-component guesswork.

**Acceptance criteria:**

- Given the established foundation, when I build a new panel/dialog/chip, then I can express
  every typographic style from a named type ramp (no raw `text-[Npx]` / arbitrary `leading-[…]`).
- Given the established foundation, when I lay out spacing, then I use the documented spacing
  rhythm (no arbitrary `px-2.5` / `gap-[…]` one-offs).
- Given an overlay or floating surface, when I assign its stacking, then I pick a named z-index
  layer from the documented ladder (no fresh `z-50` literal).
- Given a transition, when I animate it, then I reference a named duration + easing token (no
  bespoke `duration-[450ms]` / `ease-[cubic-bezier(…)]`).

### One authoritative foundation document · P1

**As a** designer (or any agent) about to design a surface
**I want** `docs/DESIGN.md` to be the single place that defines the full scale system AND the
existing criteria registry
**So that** I read one canon, not a token dump in `index.css` plus a separate criteria doc that
disagree.

**Acceptance criteria:**

- Given DESIGN.md, when I open it, then it documents every foundation area (color, typography,
  spacing, radius, elevation, motion, z-index, primitive canon) with the named tokens and their
  values/usage rules.
- Given the existing §2 surface→token map and §5 Criteria Registry (D-1..D-5), when the
  foundation is added, then those sections are **absorbed/extended in place** — not duplicated
  or contradicted.
- Given DESIGN.md and `index.css`, when I cross-check a token, then the value in the doc matches
  the value in `index.css` (the doc and the stylesheet do not drift).

### Reconcile the existing ad-hoc values · P1

**As a** maintainer
**I want** the foundation to be derived FROM the values already shipped (the VS Code-dark
palette, the `0.5rem` radius, the existing `text-[11px]/[13px]` sizes, the `duration-200`
dock timing), reconciled into clean named scales
**So that** the current look is preserved while the system becomes named and consistent —
the foundation is a rationalization, not a redesign.

**Acceptance criteria:**

- Given the existing palette and radius, when the color + radius systems are formalized, then
  the resulting tokens reproduce the current dark appearance (no visible restyle of shipped
  surfaces from the foundation tokens themselves).
- Given the scattered raw type sizes, when the type ramp is defined, then each existing raw size
  maps to a named step (the ramp covers the real sizes in use, e.g. ~10/11/12/13px → named steps).
- Given the existing focus-ring inconsistency (`ring-[3px]` vs D-5's thin ring), when the
  foundation is set, then the canonical ring width is decided once and the divergence is recorded
  in the migration audit.

### Migration audit / backlog (not a rewrite) · P1

**As a** maintainer
**I want** a concrete, file-level list of existing surfaces that drift from the new foundation
**So that** migration is tracked and incremental — done as follow-up work, not a risky big-bang
in this cycle.

**Acceptance criteria:**

- Given the established foundation, when this cycle completes, then a migration backlog exists
  enumerating the drifting surfaces (the ~26 files / ~85 ad-hoc occurrences) grouped by
  foundation area (typography / spacing / z-index / motion / elevation).
- Given the backlog, when I read it, then no existing component has been mass-refactored in this
  cycle (the foundation is additive; migration items are listed, not executed).

### Feature-specific token families relate cleanly to the core · P2

**As a** designer extending a feature palette (Jira status, GCal events, glass-dock)
**I want** the foundation to define how feature-specific token families relate to the core
**So that** these families are understood as sanctioned extensions of the system, not exceptions
that undermine the "tokens are the only source" rule.

**Acceptance criteria:**

- Given the existing `--status-*`, `--event-*`, `--brand-*`, and `glass-dock-*` families, when
  the foundation documents them, then each is classified as a **semantic feature family** layered
  on the core (with the rule that new feature needs extend the token set, never inline values).
- Given a feature family, when it is documented, then its relationship to the core (which core
  tokens it derives contrast/foreground from, where it may and may not be used) is stated.

## Functional Requirements

> "MUST" required, "SHOULD" recommended, "MAY" optional.

### Color system

| ID     | Requirement |
|--------|-------------|
| FR-001 | The foundation MUST formalize the existing semantic color tokens (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, and their `-foreground` pairs) as the core color system, preserving the current dark values. |
| FR-002 | The foundation MUST reconcile any neutral/accent ramp the system implicitly relies on (e.g. the `#1e1e1e → #1b1b1c → #252526 → #2d2d30 → #333 → #3a3a3c → #4a4a4c` neutral progression) into a documented set, so future neutral choices pick a named step rather than a fresh hex. |
| FR-003 | The foundation MUST keep the rule that **no raw hex appears outside `index.css`**; all color use goes through tokens. |
| FR-004 | The foundation SHOULD document the brand tokens (`--brand-pink/-purple/-accent/-foreground`, `--primary #e9aee9`) and the active-affordance rule (active/selected/connected chrome uses `--brand-accent`, never blue) as part of the color system, consolidating DESIGN.md §3. |

### Typography scale

| ID     | Requirement |
|--------|-------------|
| FR-010 | The foundation MUST define a **named typography ramp** (a small set of named steps, each with a size, line-height, and default weight) that covers the sizes actually in use (~10px, 11px, 12px/`text-xs`, 13px, `text-sm`, `text-base`, and any heading sizes). |
| FR-011 | The type ramp MUST be expressible via Tailwind/token classes so a surface can apply a named step instead of a raw `text-[Npx]` / arbitrary `leading-[…]`. |
| FR-012 | The foundation MUST define the allowed font weights (the system uses `font-medium`, `font-semibold`, normal) as named roles, so weight is a scale choice, not arbitrary. |
| FR-013 | The foundation MAY define `tracking`/letter-spacing roles only where the system actually uses them (e.g. the uppercase `tracking-wide` micro-labels); it MUST NOT invent typographic axes the product does not use. |

### Spacing scale

| ID     | Requirement |
|--------|-------------|
| FR-020 | The foundation MUST document a **spacing rhythm** (the base unit and the allowed steps) for padding, margin, and gaps, aligned to Tailwind's spacing scale, so surfaces use scale steps rather than arbitrary `px-2.5`/`gap-[…]` values. |
| FR-021 | Where the product genuinely needs an off-scale value (e.g. dense calendar cells), the foundation MUST say how to express it (a documented exception or a named density token) rather than leaving a bare arbitrary value. |

### Radius scale

| ID     | Requirement |
|--------|-------------|
| FR-030 | The foundation MUST formalize the existing radius scale (`--radius 0.5rem` → `sm/md/lg/xl` derivations) as the named radius system and document which surface kinds use which step. |

### Elevation / shadow system

| ID     | Requirement |
|--------|-------------|
| FR-040 | The foundation MUST define a **named elevation/shadow ramp** (a small set of levels, e.g. flat → raised control → overlay/dialog → floating dock) reconciling the current ad-hoc `shadow-xs/sm/lg` usage and the glass-dock's bespoke multi-layer shadow. |
| FR-041 | Each elevation level MUST map to the stacking context it belongs with (an overlay's shadow level is consistent with its z-index layer — see FR-050). |
| FR-042 | The glass-dock material MAY remain its own composed treatment, but the foundation MUST classify it as the "floating dock" elevation tier so it is part of the documented ramp, not an unrelated exception. |

### Motion tokens

| ID     | Requirement |
|--------|-------------|
| FR-050 | The foundation MUST define **named duration tokens** (reconciling `duration-150/200/400/450ms` into a small named set, e.g. fast/base/slow) and **named easing tokens** (including the existing `cubic-bezier(0.16,1,0.3,1)` "launch" curve and a standard ease-out). |
| FR-051 | Motion tokens MUST be reduced-motion aware as a documented rule: motion-bearing surfaces gate animation behind `prefers-reduced-motion` (the `cosmos-spinner` keyframes already model this). |
| FR-052 | The foundation MUST document the canonical transition recipe for the common cases (overlay enter/exit, dock slide, composer launch) referencing the named tokens, so new transitions are not hand-tuned. |

### Z-index / layering system

| ID     | Requirement |
|--------|-------------|
| FR-060 | The foundation MUST define a **named z-index ladder** that formalizes the current stacking order: base content → panel chrome → in-panel scrim → glass dock/overlay → app dialog/popover/tooltip → floating composer (and the drag/logo layer). |
| FR-061 | Each named layer MUST have a documented value and a description of what belongs on it, so a new overlay picks a named layer instead of a fresh `z-50` literal. |
| FR-062 | The ladder MUST reconcile the existing literals (`z-10` scrim, `z-20` dock, `z-50` dialog/tooltip/composer) — choosing the canonical layer values and recording any current literal that should move in the migration audit. |

### Primitive component canon

| ID     | Requirement |
|--------|-------------|
| FR-070 | The foundation MUST document the **primitive canon**: the existing `components/ui/` set (button, badge, card, tabs, avatar, alert, skeleton, tooltip, select, dialog, label, switch, input, textarea, scroll-area, confirm-dialog) with each primitive's available variants and sizes (e.g. the Button variant/size matrix) and the usage rule for each. |
| FR-071 | The canon MUST state the rule that surfaces compose from these primitives + tokens and do not invent per-surface button/dialog/badge styles (consolidating DESIGN.md §4). |
| FR-072 | The canon MUST record which primitives are "complete" vs. which need a foundation reconciliation (e.g. the Button/Badge `ring-[3px]` vs. the canonical ring width) as migration items. |

### Document & wiring

| ID     | Requirement |
|--------|-------------|
| FR-080 | `docs/DESIGN.md` MUST become the authoritative home of the foundation: the existing §2 surface→token map and §5 Criteria Registry are absorbed/extended in place, and new sections document every foundation area above. DESIGN.md and `index.css` MUST stay in sync. |
| FR-081 | New scale tokens MUST be added to `src/renderer/index.css` (and any required Tailwind v4 `@theme` wiring) following the existing token conventions; preload/IPC are not involved (pure renderer styling). |
| FR-082 | The cycle MUST produce a **migration audit/backlog** (a tracked list, e.g. in `TODO.md` and/or the plan's checklist) enumerating the drifting surfaces by foundation area, so migration proceeds incrementally as follow-up. |
| FR-083 | `docs/ARCHITECTURE.md` MUST be updated to reference the formal design foundation (DESIGN.md as the scale-system canon) so the architecture doc stays coherent with the new system shape. |

## Edge Cases & Constraints

- **Feature-specific token families** (`--status-*`, `--event-*`, `--brand-*`, `glass-dock-*`):
  these are sanctioned **semantic feature families** layered on the core, not violations of the
  foundation. The foundation documents their relationship to core tokens; it does NOT collapse
  or recolor them.
- **Tailwind v4 cascade-layer gotcha** (DEVELOPMENT.md): foundation utilities/tokens must respect
  the layered-vs-unlayered cascade rules (the `prose-cosmos` / `scrollbar-hover-only` / glass-dock
  `@utility` precedent). Adding tokens to `@theme inline` is safe; new `@utility`/plain rules must
  follow the established layering discipline.
- **Off-scale density needs** (calendar hour cells, dense chips): allowed but must be expressed via
  a documented exception/density token, not a bare arbitrary value.
- **Reduced motion:** every motion token's usage must remain `prefers-reduced-motion`-gated.

### Explicitly out of scope (this cycle)

- **No mass component rewrite.** Existing surfaces are NOT migrated to the new tokens in this
  cycle; drift is captured in the audit/backlog and migrated incrementally as follow-up.
- **No light-mode work.** cosmos stays dark-first / single-mode; `:root` remains only a light
  fallback. The foundation is authored for the dark palette.
- **No new product features / no new panels / no IPC / MCP / main-process changes.** This is a
  pure renderer design-system foundation.
- **No new third-party UI dependency.** The primitive canon documents the existing shadcn set;
  adding new primitives is out of scope (a follow-up uses the design skill if needed).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A new surface can be built using ONLY named foundation tokens for typography, spacing, radius, elevation, motion, and z-index — verifiable by building a sample surface (or reviewing the canon) with zero raw `text-[Npx]`, arbitrary spacing, `z-50` literal, or bespoke `duration-[…]`/`ease-[…]`. |
| SC-002 | `docs/DESIGN.md` documents all eight foundation areas (color, typography, spacing, radius, elevation, motion, z-index, primitive canon) with named tokens whose values match `src/renderer/index.css`. |
| SC-003 | The existing dark appearance of shipped surfaces is unchanged by the foundation tokens themselves (the foundation reconciles, it does not restyle). |
| SC-004 | A migration audit/backlog enumerates the drifting surfaces (~26 files / ~85 ad-hoc occurrences) grouped by foundation area, and is recorded for follow-up. |
| SC-005 | `docs/ARCHITECTURE.md` references the formal foundation so the architecture doc and DESIGN.md stay coherent. |
| SC-006 | The existing feature-specific token families are documented as sanctioned semantic extensions of the core, not exceptions. |

---

## Open Questions

- [ ] **Typography ramp granularity & naming.** The system uses raw 10/11/13px alongside
  Tailwind's `text-xs`(12)/`text-sm`(14)/`text-base`(16). **Recommendation:** define a small
  named ramp (e.g. `caption`/`label`/`body-sm`/`body`/`title`) that *includes* the sub-`text-xs`
  micro sizes (10/11px) as named steps rather than forcing everything onto Tailwind defaults —
  the dense panel/calendar UI genuinely needs sub-12px steps. Final naming is the designer's call
  in the design step; not a blocker.
- [ ] **Canonical focus-ring width (`ring-[3px]` vs `ring-[1.5px]`).** Button/Badge ship `3px`;
  DESIGN.md D-5 + textarea use thin `1.5px`. **Recommendation:** adopt the thin (~1.5px) ring as
  the canon per D-5 and list the Button/Badge `ring-[3px]` reconciliation as a migration item
  (do not silently flip it this cycle). Designer confirms in the design step; not a blocker.
- [ ] **Where the migration backlog lives.** **Recommendation:** capture it as a checklist in the
  implementation plan + promote milestone items into `TODO.md` (the project's living checklist),
  rather than a new tracking doc. Not a blocker.

> None of the above block the design step; each carries a recommendation the designer/developer
> can adopt. No genuinely unresolved behavior remains.
