# Bug: disconnect/confirm modal not aligned to the design foundation

ID: `disconnect-modal-design-foundation-v1`
Skill: bugfix → Design defect (route: `designer`, then verify)
Status: In progress (delegated to designer)
Reported: 2026-06-28

## Symptom (user)

The disconnect confirmation modal still looks off. Now that the design foundation (`docs/DESIGN.md`)
exists, the modal should be redesigned ON TOP OF that foundation — named scales + `@theme` tokens,
consistent with every other dialog/surface. This is a RECURRING complaint (a prior pass only swapped
the `DialogContent` background token to `bg-popover`); the user wants a real foundation-based design
pass, not another one-token patch.

## Scope

- Component: `src/renderer/components/ui/confirm-dialog.tsx` (the `ConfirmDialog` primitive).
- Consumer: `src/renderer/app/SettingsDialog.tsx` (integration disconnect / force-disconnect-on-Save).
- Foundation: `docs/DESIGN.md` (named scales + `@theme` tokens — authoritative design criteria).

## Class & route

Design defect — visuals/consistency with the design system; the disconnect LOGIC is correct. Route
to `designer` (owns theme tokens + `src/renderer/components/ui/`). Designer revises the component to
the foundation; verification (typecheck + `test:dom` + visual) runs after (designer has no Bash).

## To do (designer)

Ground yourself: read `docs/DESIGN.md` (the foundation), the current `confirm-dialog.tsx`, the sibling
`Dialog`/`DialogContent` usage in `SettingsDialog.tsx`, and the shared `components/ui/` primitives
(button variants incl. destructive, dialog, tokens). Then bring the confirm/disconnect modal fully
onto the foundation: surface/background/border/elevation tokens, spacing scale, typography scale,
the destructive-action affordance (a disconnect is destructive — the confirm button should read as
such per the foundation), title/description hierarchy, and focus/hover/disabled states. It must be
visually indistinguishable in "system language" from the other dialogs. Update `docs/DESIGN.md` (or
the relevant design note) if you introduce/clarify a dialog or destructive-action criterion. Reuse
existing tokens/variants — do NOT add raw hex or a one-off CSS value.

## Verification

`npm run typecheck` + `npm run test:dom` green; the modal exercised (visual / `npm run dev`) — the
disconnect confirm reads as destructive and matches the other dialogs. Confirm no raw hex / one-off
CSS was introduced.
