# Plan: Design Foundation — v1

**Status**: Draft
**Created**: 2026-06-28
**Last updated**: 2026-06-28
**Spec**: .sdd/specs/design-foundation-v1.md

---

## Grounding

Direct investigation re-confirmed for the plan (carried from the spec phase + re-verified):

**codegraph / Glob / Read (code structure):**
- Read `src/renderer/index.css` (the full file) — current token surface: semantic color tokens +
  radius derivations live in `@theme inline`; feature families (`--status-*`, `--event-*`×12,
  `--brand-*`, `glass-dock-*`) and three `@utility`s (`prose-cosmos`, `scrollbar-hover-only`,
  `glass-dock`) + the `cosmos-spinner-*` keyframes (the only named motion). NO typography/spacing/
  elevation/motion/z-index tokens exist. `:root` is the light fallback; `.dark` carries the real
  palette; `@layer base` + unlayered layout rules at the bottom.
- Read `src/renderer/components/ui/button.tsx` — the CVA variant/size matrix that is the template
  for the "primitive canon" documentation (variants `default|cosmos|destructive|outline|secondary|
  ghost|link`, sizes `default|xs|sm|lg|icon|icon-xs|icon-sm|icon-lg`). Note: it ships
  `focus-visible:ring-[3px]` — the OQ-2 divergence from DESIGN.md D-5's thin ring.
- Globbed `src/renderer/components/ui/*.tsx` — 16 primitives (button, badge, card, tabs, avatar,
  alert, skeleton, tooltip, select, dialog, label, switch, input, textarea, scroll-area,
  confirm-dialog).
- Grep audit of `src/renderer/**` — the drift evidence: ~85 ad-hoc arbitrary-value occurrences in
  ~26 files (typography `text-[10px]/[11px]/[13px]`, z-index `z-10/z-20/z-50` literals, motion
  `duration-[400ms]/[450ms]` + bespoke `ease-[cubic-bezier(0.16,1,0.3,1)]`, elevation
  `shadow-xs/sm/lg`). GCal catalog alone ≈17.
- Read `docs/DESIGN.md` — §2 surface→token map + §5 Criteria Registry (D-1..D-5); criteria-only,
  no scale system. Confirmed it is the correct home to EXTEND.
- Globbed `.sdd/specs/*` and `.sdd/plans/*` — no dedicated `*restructure*`/`*structure*` spec/plan
  file exists in `.sdd/`; the src/ tree restructure is an in-flight orchestrator-coordinated track
  (Phase 1 excludes `src/renderer/components/`, Phase 2 handles components later). Coordination is
  captured as a cross-track dependency below, NOT as a hard blocker.

**agentmemory:**
- `memory_recall`/`memory_smart_search` for prior foundation decisions → empty; standing preference
  "Design system = Tailwind + shadcn" (real component library + designer agent) recorded in
  MEMORY.md index. Persisted this cycle's framing via `memory_save` (mem_mqx3tvq6_46ecdd7d5846).

**Adopted OQ resolutions (delegated by user as designer-territory, non-blocking):**
- **OQ-1** — define a small NAMED type ramp that INCLUDES sub-12px steps (dense panels need 10/11px);
  final names are the designer's call in the design step.
- **OQ-2** — adopt the thin ~1.5px canonical focus-ring (DESIGN.md D-5); list the Button/Badge
  `ring-[3px]` flip as a MIGRATION backlog item — do NOT flip it this cycle.
- **OQ-3** — the migration backlog lives in this plan's checklist + `TODO.md`; no new tracking doc.

---

## Summary

Establish cosmos's formal, documented **design foundation** without rewriting existing surfaces.
The heavy lifting is a **DESIGN step**: the `designer` agent authors the actual named scales for all
eight foundation areas (color reconciliation, typography, spacing, radius, elevation, motion,
z-index, primitive canon), writes them into `docs/DESIGN.md` as the authoritative foundation doc
(absorbing/extending the existing §2 surface→token map and §5 Criteria Registry **in place**), and
adds the corresponding scale tokens to `src/renderer/index.css`. The `developer` then wires any
required Tailwind v4 `@theme` config to make those tokens consumable as utility classes, verifies
the build/typecheck, and produces the **migration audit/backlog** (the ~26 files / ~85 ad-hoc
occurrences grouped by foundation area) into this checklist + `TODO.md`. The foundation is strictly
**additive**: shipped surfaces keep their exact dark appearance; drift is recorded for incremental
follow-up migration, not refactored now. cosmos stays dark-first / single-mode; no light-mode work,
no new product features, no IPC/MCP/main changes, no new UI dependency.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | CSS (Tailwind v4 `@theme`/`@utility` in `index.css`), Markdown (`docs/DESIGN.md`), no TS logic |
| Key dependencies  | Tailwind CSS v4, shadcn/ui (new-york), `@tailwindcss/typography` — all already present; NONE added |
| Files to create   | (none — additive edits only) |
| Files to modify   | `src/renderer/index.css` (scale tokens), `docs/DESIGN.md` (foundation sections), `docs/ARCHITECTURE.md` (reference the foundation), `TODO.md` (migration backlog), this plan (audit checklist) |
| Out of process    | No preload / IPC / MCP / main edits → no `npm run dev` restart concern; renderer-CSS only (HMR-friendly) |

---

## Implementation Checklist

> Cycle order for this UI-bearing work: **plan → DESIGN step (designer, heavy lifting) →
> interface/implement (developer wires `@theme` + produces audit) → docs/wrap-up.** Update the
> checklist as work progresses; add inline notes where a step deviates.

### Phase 0 — Pre-flight (any session)

- [ ] Read `.sdd/specs/design-foundation-v1.md`, confirm the three OQs are resolved as above (no
      open questions remain that block the design step).
- [ ] Re-read `docs/DESIGN.md` (§1–§6) and `src/renderer/index.css` so the foundation extends what
      exists rather than re-inventing it.
- [ ] Confirm the cross-track coordination note below before touching `components/ui` (see
      "Cross-track dependency").

### Phase 1 — DESIGN step (owner: `designer`; the heavy lifting) — `.sdd/designs/design-foundation-v1.md`

> The designer establishes the ACTUAL scales for all eight areas and authors them into DESIGN.md +
> index.css. Each scale must be derived FROM the values already shipped (reconcile, don't redesign)
> so the dark appearance is unchanged. No raw hex outside `index.css`.

- [ ] **(1) Color system** — formalize the existing semantic tokens (background/foreground/card/
      popover/primary/secondary/muted/accent/destructive/border/input/ring + `-foreground` pairs) as
      the core, and reconcile the implicit neutral progression (`#1e1e1e → #1b1b1c → #252526 →
      #2d2d30 → #333 → #3a3a3c → #4a4a4c`) into a documented named neutral set. Consolidate the brand/
      active-affordance rules (DESIGN.md §3) into the color section. Values UNCHANGED. (FR-001..004)
- [ ] **(2) Typography scale** — define a small NAMED type ramp (size + line-height + default weight
      per step) that COVERS the real sizes in use, INCLUDING sub-12px steps (10/11px) for dense
      panels (OQ-1). Define the allowed weight roles (normal / medium / semibold) and only the
      tracking roles actually used (uppercase micro-label `tracking-wide`). (FR-010..013)
- [ ] **(3) Spacing scale** — document the base unit + allowed steps (aligned to Tailwind's spacing
      scale) for padding/margin/gap, and the sanctioned way to express genuine off-scale density
      (calendar cells) — a documented exception or density token, not a bare arbitrary value.
      (FR-020..021)
- [ ] **(4) Radius scale** — formalize `--radius 0.5rem` → `sm/md/lg/xl` as the named radius system
      and document which surface kinds use which step. Values UNCHANGED. (FR-030)
- [ ] **(5) Elevation / shadow system** — define a named elevation ramp (flat → raised control →
      overlay/dialog → floating dock) reconciling current `shadow-xs/sm/lg` + the glass-dock's
      bespoke multi-layer shadow; classify glass-dock as the "floating dock" tier; align each level
      with its z-index layer. (FR-040..042)
- [ ] **(6) Motion tokens** — define named duration tokens (reconcile `150/200/400/450ms` → e.g.
      fast/base/slow) and named easing tokens (the existing launch curve `cubic-bezier(0.16,1,0.3,1)`
      + a standard ease-out); document the canonical transition recipes (overlay enter/exit, dock
      slide, composer launch); keep every motion usage `prefers-reduced-motion`-gated. (FR-050..052)
- [ ] **(7) Z-index / layering** — define a NAMED z-index ladder formalizing the current order: base
      content → panel chrome → in-panel scrim (`z-10`) → glass dock/overlay (`z-20`) → app dialog/
      popover/tooltip (`z-50`) → floating composer/drag-logo layer. Give each layer a value + a
      "what belongs here" description; record any current literal that should move as a migration
      item. (FR-060..062)
- [ ] **(8) Primitive component canon** — document the 16 `components/ui/` primitives with each
      primitive's variants/sizes + usage rule (Button matrix is the model); state the
      "compose from primitives + tokens, never invent per-surface styles" rule (consolidate
      DESIGN.md §4); record incomplete/divergent primitives (e.g. Button/Badge `ring-[3px]` vs the
      ~1.5px canon, OQ-2) as migration items — do NOT flip them here. (FR-070..072)
- [ ] **(9) Author DESIGN.md** — add the eight foundation sections to `docs/DESIGN.md`, ABSORBING/
      extending the existing §2 surface→token map and §5 Criteria Registry **in place** (no fork, no
      duplication). DESIGN.md becomes the authoritative foundation doc. (FR-080)
- [ ] **(10) Author index.css tokens** — add the new scale tokens (typography/spacing/elevation/
      motion/z-index, plus any named neutral/radius aliases) to `src/renderer/index.css` following
      existing token conventions (`@theme inline` + `:root`/`.dark`), respecting the Tailwind v4
      cascade-layer discipline (DEVELOPMENT.md). Every value matches what DESIGN.md documents.
      (FR-081)
- [ ] **(11) Design-step self-check** — verify each documented token value in DESIGN.md == the value
      in index.css (no doc/stylesheet drift); verify the foundation tokens reproduce the current dark
      appearance (no restyle).

> Note: the designer has no Bash. Any build wiring / shadcn CLI / verification is the developer's
> in Phase 2. The designer owns the scales + DESIGN.md + index.css token authoring.

### Phase 2 — Interface / wiring + audit (owner: `developer`)

- [ ] **Wire Tailwind `@theme`** — make the new scale tokens consumable as utility classes where
      needed (so a surface can apply a named type/spacing/z/elevation/motion step instead of an
      arbitrary value). Confirm the chosen consumption mechanism for each scale (Tailwind theme key
      vs. utility vs. token var) matches how the designer intends surfaces to apply it. (FR-081)
- [ ] **Build + typecheck green** — `npm run build` and `npm run typecheck` pass; no Tailwind
      cascade-layer regression; no visible restyle of existing surfaces (foundation is additive).
- [ ] **Produce the migration audit/backlog** — enumerate the drifting surfaces (the ~26 files /
      ~85 ad-hoc occurrences) grouped by foundation area, recorded into the "Migration backlog"
      section below AND promoted as milestone items into `TODO.md`. Must include the OQ-2
      Button/Badge `ring-[3px]` → thin-ring flip as an explicit item. (FR-082)
- [ ] **Confirm no component rewrite happened** — verify Phase 2 added tokens/wiring + the audit
      list only; no existing surface was mass-migrated this cycle (SC-004, out-of-scope guard).

### Phase 3 — Docs & wrap-up

- [ ] **Update `docs/ARCHITECTURE.md`** — reference the formal design foundation (DESIGN.md as the
      scale-system canon) so the architecture doc stays coherent with the new system shape.
      (FR-083, SC-005) — architect-owned.
- [ ] **Reconcile `TODO.md`** — migration backlog items present under Next; mark this foundation
      cycle's establish-phase done.
- [ ] **Update this plan** — record any deviations (dated) in the Deviations section.
- [ ] **Persist learnings** — `memory_save` any non-obvious foundation decision (e.g. final ramp
      naming, ring-width canon) for future sessions.

### Verification (success criteria mapping)

- [ ] SC-001 — a sample/new surface expressible with ONLY named tokens (zero raw `text-[Npx]`,
      arbitrary spacing, `z-50` literal, bespoke `duration-[…]`/`ease-[…]`).
- [ ] SC-002 — DESIGN.md documents all eight areas; values match index.css.
- [ ] SC-003 — shipped surfaces' dark appearance unchanged by the foundation tokens.
- [ ] SC-004 — migration backlog enumerated (by area) + recorded; no mass rewrite this cycle.
- [ ] SC-005 — ARCHITECTURE.md references the foundation.
- [ ] SC-006 — feature token families (`--status-*`/`--event-*`/`--brand-*`/`glass-dock-*`)
      documented as sanctioned semantic extensions of the core.

---

## Cross-track dependency (coordinate, NOT blocked)

A SEPARATE in-flight sdd track is restructuring the `src/` directory tree. **Phase 1 of that
restructure EXCLUDES `src/renderer/components/`; Phase 2 moves `components/` later.** This foundation
touches `src/renderer/index.css`, `docs/DESIGN.md`, and references `src/renderer/components/ui/`.

Coordination rules (to avoid path churn — the foundation is NOT blocked by the restructure):

- **`index.css` + `docs/DESIGN.md` are safe to author now** — they are not under the restructure's
  Phase 1 moving set; do the token + DESIGN.md authoring on the current paths.
- **The primitive-canon documentation (which references `components/ui/*` paths)** should be written
  to be path-resilient: prefer naming primitives by component (e.g. "Button", "DialogContent")
  rather than hard-coding fragile relative paths, OR land the DESIGN.md primitive-canon section in a
  coordinated order with the restructure's Phase 2 `components/` move so the path references don't go
  stale immediately. If the restructure's Phase 2 lands first, write the canon against the new paths;
  if the foundation lands first, the restructure track updates the canon's path references as part of
  its Phase 2.
- **The migration audit** lists existing surfaces by FILE — note in the backlog that file paths are
  as-of authoring and may shift when the restructure's Phase 2 moves `components/`; migration work
  consuming the backlog should re-resolve paths against the then-current tree.
- **No `components/` files are edited this cycle** (foundation is additive + audit-only), so there is
  no edit-collision with the restructure — only documentation references to coordinate.

---

## Migration backlog (filled during Phase 2 — incremental follow-up, NOT this cycle)

> Grouped by foundation area. Source: the Phase-2 audit of `src/renderer/**` (~26 files / ~85 ad-hoc
> occurrences). Promote milestone items into `TODO.md`. These are follow-up migrations — the
> foundation cycle does NOT execute them.

- **Typography** — replace raw `text-[10px]/[11px]/[13px]` + ad-hoc `leading-*`/`tracking-*` with the
  named type ramp. Known hotspots: `googleCalendarCatalog/components.tsx` (~17), `PromptComposer.tsx`,
  `ConfluencePanel.tsx`, `SlackPanel.tsx`, `atlassianPanelBits.tsx`, `SurfaceSpinner.tsx`,
  `ActiveTabSurface.tsx`, the Slack/Jira/Confluence catalog rows. (to be enumerated in Phase 2)
- **Z-index** — replace literal `z-10`/`z-20`/`z-50` with named ladder layers across the four panels'
  scrim/dock overlays (`SlackPanel`/`JiraPanel`/`ConfluencePanel`/`GoogleCalendarPanel`),
  `PromptComposer` floating/drag layer, and `ui/dialog`+`ui/tooltip`. (to be enumerated)
- **Motion** — replace `duration-[400ms]/[450ms]` + bespoke `ease-[cubic-bezier(0.16,1,0.3,1)]`
  (`PromptComposer`) and ad-hoc `duration-200` dock transitions with named duration/easing tokens.
- **Elevation** — replace ad-hoc `shadow-xs/sm/lg` with named elevation levels; align dock shadow to
  the documented floating-dock tier.
- **Spacing** — replace arbitrary `px-2.5`/`py-1.5`/`gap-[…]` one-offs with scale steps (or a
  documented density token for genuinely dense cells).
- **Primitive reconciliation (OQ-2)** — flip `components/ui/button.tsx` + `components/ui/badge.tsx`
  `focus-visible:ring-[3px]` → the canonical thin (~1.5px) ring (DESIGN.md D-5), matching
  `textarea.tsx`. Deliberately NOT done this cycle.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-28**: Plan authored. OQ-1/2/3 adopted per the spec's recommendations (user delegated as
  designer-territory). Cross-track restructure coordination captured (no hard block; no `components/`
  edits this cycle). No `.sdd/*restructure*` spec/plan file exists yet — restructure is an in-flight
  orchestrator-coordinated track; revisit the path-coordination note when that track's Phase 2 lands.
