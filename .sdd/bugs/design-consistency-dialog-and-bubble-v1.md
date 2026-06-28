# Bug: dialog + chat-bubble break system consistency — codify exact criteria, then conform

ID: `design-consistency-dialog-and-bubble-v1`
Skill: bugfix → Design defect (route: `designer`)
Status: In progress (delegated to designer)
Reported: 2026-06-28
Supersedes the open design items in `disconnect-modal-design-foundation-v1` +
`cosmos-chat-bubble-design-foundation-v1` (both prior passes were too conservative — they aligned
tokens but did NOT make the surfaces consistent with their siblings, and changed nothing visible
where the user expected a change).

## Symptoms (user)

1. The disconnect modal (`ConfirmDialog`) breaks consistency "여기서만" (only here) — its COLOR,
   FONT SIZE, and BUTTON SIZE differ from the other dialogs (SettingsDialog is the canonical
   reference; match it).
2. The Cosmos chat bubble COLOR is "원래 쓰는 색이 아니야" — not a color the app actually uses. The
   user bubble is `bg-primary/15` (the logo pastel pink at 15%), which is off-system.
3. The prior "fix" did not visibly change the bubble (only `text-[13px]`→`text-body-sm` etc., same
   px) — the user wants the actual color brought onto the system, a VISIBLE correction.
4. USER DIRECTIVE: codify the consistency rules PRECISELY in the design criterion
   (`docs/DESIGN.md`) so they are followed exactly — don't leave it to per-component judgment.

## Orchestrator audit (concrete — starting point, not a substitute for the designer's own grounding)

- Button sizes (`button.tsx`): `default`=h-9 px-4, `sm`=h-8, `xs` smaller, `lg`=h-10. `ConfirmDialog`
  uses DEFAULT. SettingsDialog mixes: the force-disconnect footer (`:568-571`) uses DEFAULT, but the
  per-integration connect/disconnect rows (`:1119/1131/1136`) use `size="sm"`. There is NO single
  codified "dialog action button size" rule → divergence is inevitable.
- `ConfirmDialog` `DialogContent`: `sm:max-w-sm`. SettingsDialog: `max-w-[860px] h-[600px]` (it's a
  big settings surface — a different dialog class). The shared `Dialog` primitive now defaults to
  `bg-popover` + `shadow-overlay` + `z-overlay`, title `text-title`, desc `text-body` (good) — but
  the CONFIRM/ALERT dialog class vs the big SETTINGS dialog class aren't distinguished as criteria.
- Chat-bubble color: `--primary`=#e9aee9 (logo pink). `bg-primary*` is used in 9 places, ALL
  actionable (buttons, badges, avatar, input ring) — it is the ACTION color, NOT a surface. Real
  surfaces by frequency: `bg-card`(36), `bg-popover`(20), `bg-accent`(18), `bg-muted`(14),
  `bg-secondary`(5). So a `bg-primary/15` user bubble misuses the action color as a surface →
  off-system. Assistant text sits bare on `bg-card`; the tool row uses `bg-muted/40`.

## To do (designer) — TWO deliverables

### A. Codify EXACT consistency criteria in `docs/DESIGN.md` (the canon)
Add/extend named criteria so every future surface is uniform by rule, not judgment:
- A DIALOG-CLASS criterion: distinguish the small CONFIRM/ALERT dialog (e.g. `max-w-sm`, the
  destructive/confirm footer) from the large UTILITY dialog (Settings). For EACH class, specify the
  exact: surface token, `DialogTitle` size, `DialogDescription` size, footer button SIZE + the
  variant pairing (ghost Cancel + the primary/destructive action), the footer gap/justify, and
  spacing. Pick ONE button size for confirm/alert dialog actions and name it (audit which the
  siblings use and standardize — don't invent a third).
- A CHAT-SURFACE criterion: the exact role→token mapping for the Cosmos timeline — user bubble
  surface, assistant text surface, tool-call row surface — using REAL app surface tokens (card /
  accent / secondary / muted family), NOT the `primary` action color. Plus the bubble radius,
  max-width, and the typography step. (The bubble max-width is currently `max-w-[85%]` duplicated on
  the bubble AND the context chip — name a single `--chat-bubble-max-w` token so they share one
  source, per the prior bubble report's flagged item.)

### B. Conform the two surfaces to the new criteria (VISIBLE corrections)
- `ConfirmDialog` (`src/renderer/components/ui/confirm-dialog.tsx`): make it match the codified
  confirm/alert dialog class EXACTLY (color, title/desc size, button size + pairing) so it is
  indistinguishable in system language from its siblings.
- Cosmos bubbles (`src/renderer/cosmos/CosmosTimelineEntry.tsx`): replace `bg-primary/15` (and any
  other off-system color) with the codified chat-surface tokens — a real, visible color change onto
  the app's actual palette. Keep the conversation pattern (user right / assistant left / tool quiet).

Reuse existing tokens; introduce a named token ONLY where the criterion needs one (e.g.
`--chat-bubble-max-w`), never raw hex / one-off arbitraries. You own `docs/DESIGN.md` +
`components/ui/` this cycle (no other designer is running — safe to edit DESIGN.md).

## Verification

`npm run typecheck` + `npm run test:dom` green (the cosmos dom tests use `getByText`, not classes —
but re-confirm). Visual / `npm run dev`: the disconnect modal matches SettingsDialog's system
language (color, title/body size, button size); the chat bubbles use the app's real surface colors,
not the pink action tint. No raw hex / one-off arbitrary values introduced. The new DESIGN.md
criteria read as enforceable rules (exact tokens/sizes named).
