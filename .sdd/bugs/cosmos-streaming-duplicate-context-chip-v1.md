# Bug: duplicate context chip on the user prompt while the agent streams

ID: `cosmos-streaming-duplicate-context-chip-v1`
Skill: bugfix → Implementation defect (route: `developer` — regression from
`cosmos-agent-progress-not-streaming-v1`, the just-added incremental streaming)
Reported: 2026-06-30

## Symptom (user)

While the cosmos agent's run is STREAMING (the new incremental `conversation:update`), an EXTRA
context chip lingers on the user-prompt side — i.e. the user's prompt shows TWO context chips during
the stream. When streaming ENDS it disappears (back to one chip).

## Root cause (orchestrator-pinned — in the streaming reconcile just shipped)

`reconcileTimeline` generating phase (`src/renderer/cosmos/cosmosConversation.ts:83-97`) suppresses
the live provisional prompt (bubble AND context chip) only when the transcript's LAST user-prompt
text EXACTLY equals `live.promptText`:
```
const transcriptOwnsPrompt =
  live.promptText !== undefined && lastUserPromptText(turns) === live.promptText
```
When `transcriptOwnsPrompt` is TRUE the live entry is pushed with `{}` (no promptText/promptContext)
→ only the spinner, no chip. When FALSE the live entry KEEPS `promptContext` → its chip renders IN
ADDITION TO the transcript user-prompt turn's chip (the marker-parsed one) → DUPLICATE chip. On
completion `live` becomes null, so only the transcript turn remains → single chip (matches "사라짐").

Why the equality is FALSE during a stream (so the dup shows):
- CROSS-PANEL submit (Jira/Slack/Confluence/Calendar): the live-generating seed's `promptText` comes
  from `CosmosPanel`'s `lastPromptRef.current`, which is written ONLY by `CosmosPanel.onSubmit`
  (cosmos submits). For a cross-panel submit it is stale/undefined → `live.promptText !== undefined`
  is false → no suppression → the live `promptContext` chip duplicates the transcript turn's chip.
- Even for a cosmos submit, any text drift (whitespace/normalization between the raw utterance and
  the marker-stripped transcript text) breaks the exact-equality → dup.

So the suppression is correct in intent but keyed on a fragile exact-text match that misses the
cross-panel (undefined promptText) and text-drift cases.

## Fix (developer) — make the provisional-prompt suppression robust

Once the transcript already carries THIS run's user-prompt turn, the live-generating entry must show
ONLY the spinner — never its own prompt bubble OR context chip. Don't gate that on exact
`promptText` equality. Suppress the provisional bubble+chip whenever the transcript has caught up to
the run's user-prompt (e.g. the transcript ends with a `user-prompt` turn — during a run claude
writes the prompt before any assistant/tool turn — or a more robust match that also covers an
undefined `live.promptText`). The transcript `user-prompt` turn owns the bubble + the chip (it parses
the `<cosmos:context>` marker), so the live entry should contribute ONLY the spinner during streaming.
Keep the pre-stream behavior (before the transcript has the prompt) showing the provisional
bubble+chip so the prompt still appears instantly on Enter (FR-024). Minimal change in the pure
`reconcileTimeline` (`cosmosConversation.ts`); do not touch the IPC/streaming contract.

## Regression test (node-unit — `reconcileTimeline` is pure)

In `cosmosConversation.test.ts`: a `generating` live carrying `promptContext` (and/or undefined
`promptText`) + a transcript that ENDS with the run's `user-prompt` turn → the returned
`live-generating` entry carries NO `promptContext` and NO `promptText` (spinner only), so exactly ONE
context chip renders. Cover BOTH the cosmos (matching text) and the CROSS-PANEL (undefined
`promptText`) cases — the cross-panel case is RED before the fix. Update `docs/TEST-SCENARIOS.md`
(extend the COSMOS-STREAM-PROGRESS-01 scenario or add a sibling).

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green incl. the new reconcile case; exercise in
`npm run dev` — submit from Cosmos AND from a panel (Jira/Slack), watch the stream: exactly one
context chip on the user prompt throughout (not two), and it stays after completion.
