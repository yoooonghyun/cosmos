# Bug: Cosmos context chip — only shows while generating + should sit ABOVE the message

ID: `cosmos-context-chip-position-and-historical-v1`
Skill: bugfix
Status: In progress (delegated to developer)
Reported: 2026-06-28

## Symptom (user)

1. The prompt-context chip is only visible WHILE the agent is generating (the live turn); it
   disappears once the response lands (the confirmed/historical turn shows no chip).
2. The chip should appear ABOVE the user's message bubble, not below it.

## Analysis (orchestrator)

`CosmosTimelineEntry.tsx` renders `PromptContextChip` in BOTH branches:
- live-generating (`:97-103`): `UserBubble` → `PromptContextChip context={entry.promptContext}` → dots
- historical user-prompt (`:115-120`): `UserBubble` → `PromptContextChip context={turn.context}`

So the historical branch DOES render the chip — it just gets nothing because `turn.context` is
empty. Root cause of #1: the cosmos submit's `<cosmos:context>` marker was NOT in the transcript,
so `transcriptParse` had no marker to parse → `turn.context` undefined → chip null. That is the
exact `CosmosPanel.tsx` context-capture wiring that a parallel agent destroyed via
`git checkout HEAD -- CosmosPanel.tsx` and was just RESTORED (now committed). With the marker
embedded again, a completed run's transcript carries the marker → parsed → historical chip shows.
So #1 is resolved by the restore (needs a dev restart to observe) — but it must be LOCKED with a
test (historical turn with a parsed marker renders the chip), because it was silently lost once.

For #2: the chip currently renders BELOW the bubble in both branches; the user wants it ABOVE
(context first, then the message). This reverses the current design (D-11 said "directly below").

## To do (developer)

1. #2 — move `PromptContextChip` ABOVE `UserBubble` in BOTH the `live-generating` and the historical
   `user-prompt` branches of `CosmosTimelineEntry.tsx` (order: chip → bubble [→ dots]). Update the
   design note / DESIGN.md D-11 to "chip above the bubble" and the chip's own doc comment. Keep the
   null-context case rendering exactly the bare bubble (FR-021).
2. #1 — add a jsdom regression test that a HISTORICAL `user-prompt` turn carrying a parsed
   `context` renders the chip (not live-only), so the live-only regression can't return. Optionally
   a node test confirming `transcriptParse` attaches `context` for a cosmos-style marker (already
   covered — verify). Update the existing `PromptContextChip.dom.test.tsx` / `CosmosLiveBubble.dom.test.tsx`
   ordering assertions to the new chip-above-bubble order.
3. Update `docs/TEST-SCENARIOS.md`.

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green; the new ordering + historical tests
red→green. Note: full live confirmation (real run → transcript → historical chip) needs `npm run dev`.
