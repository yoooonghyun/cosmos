# DESIGN.md — cosmos design criteria (single source of truth)

This file is the **authoritative, enforced design criteria** for every cosmos renderer surface.
It exists for the same reason `docs/TEST-SCENARIOS.md` exists for tests: so a rule learned once
(often from a recurring visual bug) is written down and never silently re-broken by a later change
or a different agent/session.

**Owned by the `designer` agent.** The designer MUST read this file BEFORE designing any surface,
and MUST update it whenever it establishes or changes a design standard. `docs/ARCHITECTURE.md`
remains the authoritative *product/architecture* design; this file is the *visual-system criteria*
checklist the designer enforces. When the two disagree, reconcile — don't fork.

Scope note: this is criteria + rationale, not a per-feature design spec. Per-feature specs still
live at `.sdd/designs/<feature>-v<N>.md`. This file is the cross-cutting canon those specs obey.

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

## 6. How the designer maintains this file

1. **Before** designing any surface: read §2 (surface→token map) + §5 (registry) and design to them.
2. When a surface needs something the canon doesn't cover, decide the standard ONCE, apply it, and
   **add/important: update the row here** (token table and/or registry) so it's enforced next time.
3. After implementation (design review, design skill Step 6): audit the built surface against §2 +
   §5. Any deviation is a fix, and if it reveals a missing rule, record it here.
4. Keep §2 and §5 in sync with `src/renderer/index.css` and `docs/ARCHITECTURE.md`.
