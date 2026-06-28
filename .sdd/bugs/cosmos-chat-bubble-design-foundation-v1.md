# Bug: Cosmos chat bubbles not on the design foundation

ID: `cosmos-chat-bubble-design-foundation-v1`
Skill: bugfix → Design defect (route: `designer`, then verify)
Status: In progress (delegated to designer)
Reported: 2026-06-28

## Symptom (user)

The Cosmos panel's chat bubbles don't follow the design foundation (`docs/DESIGN.md`).

## Scope

- Component: `src/renderer/cosmos/CosmosTimelineEntry.tsx` — `UserBubble`, the `assistant-text`
  branch, and the `ToolCallRow`. Current styling uses ARBITRARY off-scale values
  (`text-[13px]`, `text-[12px]`, `rounded-2xl`, `bg-primary/15`, `bg-muted/40`, ad-hoc paddings)
  rather than the foundation's named typography / radius / surface scales.
- Sibling for system language: the `PromptContextChip` (already on `Badge`), the live
  `TypingIndicator`.
- Foundation: `docs/DESIGN.md` (consume — see coordination note).

## Class & route

Design defect — bubble visuals/typography/surface tokens diverge from the system; the timeline
LOGIC is correct. Route to `designer`.

## Coordination (IMPORTANT)

A parallel designer is concurrently redesigning the disconnect modal and MAY edit `docs/DESIGN.md`.
To avoid a write race, THIS task treats `docs/DESIGN.md` as READ-ONLY (consume the existing scales).
If a needed criterion is genuinely missing from the foundation, REPORT it (don't edit DESIGN.md) —
the main session reconciles after both designers finish.

## To do (designer)

Ground: read `docs/DESIGN.md` (read-only), the current `CosmosTimelineEntry.tsx` bubbles, and the
sibling timeline surfaces (`PromptContextChip`, `TypingIndicator`) + the relevant `components/ui/`
tokens. Bring the user bubble, assistant text, and tool-call row onto the foundation: typography
scale (replace `text-[13px]`/`text-[12px]` with named sizes), radius scale, surface/role tokens
(user vs assistant vs tool), spacing scale, and the muted/secondary text criteria. Keep the
right-aligned user / left-aligned assistant conversation pattern. Reuse existing tokens — NO raw hex,
NO arbitrary `[...]` values unless the foundation has no equivalent (flag it if so).

## Verification

`npm run typecheck` + `npm run test:dom` green (note: `PromptContextChip.dom.test.tsx` /
`CosmosHistoricalContext.dom.test.tsx` / `CosmosLiveBubble.dom.test.tsx` assert bubble/chip DOM —
keep their assertions valid or update them with the design change). Exercise visually
(`npm run test:visual` / `npm run dev`). No arbitrary off-scale values remain.
