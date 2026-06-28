# Bug: Cosmos live "…" shows without the user's prompt bubble while generating

ID: `cosmos-live-bubble-missing-while-generating-v1`
Skill: bugfix
Status: In progress (delegated to developer)
Reported: 2026-06-28

## Symptom (user)

In the Cosmos panel, after submitting from the composer, the TypingIndicator ("…") spins but the
user's own prompt bubble is NOT visible — so the user can't tell whether their utterance was
registered. Expected: the user prompt bubble shows FIRST, THEN the "…" below it.

## Orchestrator pre-trace (code path LOOKS correct — confirm at runtime)

- `CosmosPanel.onSubmit` (`src/renderer/cosmos/CosmosPanel.tsx:156-174`) seeds the live entry
  immediately with the RAW utterance: `setLive({ phase: 'generating', promptText: utterance,
  promptContext })` BEFORE submitting; `lastPromptRef.current = utterance`. The
  `agent:status 'started'` handler re-seeds with `promptText: lastPromptRef.current` (also set).
- `reconcileTimeline` (`cosmosConversation.ts:75-81`) maps `generating` → a `live-generating`
  entry carrying `promptText`.
- `CosmosTimelineEntry` (`CosmosTimelineEntry.tsx:97-103`) renders
  `{entry.promptText && <UserBubble/>}` then `<PromptContextChip/>` then `<TypingIndicator/>`.

So statically the bubble SHOULD render with the dots. Two live-only hypotheses:
1. A real runtime timing/state regression (e.g. an early `conversation:onUpdate` or a status
   event clearing/replacing `live` so the seeded `promptText` is lost before paint).
2. STALE dev — the user's `npm run dev` predates these changes (the context feature needs a full
   restart for the new preload surface; this session has had repeated stale-HMR symptoms).

## To do (developer)

This is the crux: a jsdom test that SIMULATES the cosmos submit flow and asserts the user bubble is
present (and precedes the dots) in the live-generating state. node-unit can't see it; the render is
trivially correct in isolation — the catch must exercise the onSubmit → setLive → reconcile → render
flow (publish a cosmos composer config, fire onSubmit, drive `agent:status 'started'`, assert the
bubble text appears AND comes before the `TypingIndicator`, AND survives the 'started' re-seed).
- If the test PASSES: the render+seed are correct → the user's runtime issue is stale dev; report
  that clearly and keep the test as the regression guard.
- If the test FAILS: a real seeding/timing regression exists — fix at root (ensure the seeded
  `promptText` is never dropped before/while generating) and make the test green.

Update `docs/TEST-SCENARIOS.md`. Ground with codegraph + `wiki_query` (agentmemory deprecated).

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green incl. the new jsdom flow test; exercise
in `npm run dev` (after a RESTART) to confirm the bubble shows with the dots.
