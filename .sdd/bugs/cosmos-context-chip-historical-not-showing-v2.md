# Bug: historical-turn context chip STILL not showing (v2)

ID: `cosmos-context-chip-historical-not-showing-v2`
Skill: bugfix
Status: In progress — orchestrator traced + EMPIRICALLY verified the data path is correct; one
integration link is untested. Delegated to `test-engineer`.
Reported: 2026-06-28 (recurrence of `cosmos-context-chip-position-and-historical-v1` #1 and
`cosmos-context-chip-crosspanel-and-historical-v1` #1)

## Symptom (user)

"과거턴 칩 여전히 노출안됨" — the historical-turn chip still does not appear at runtime, after the
prior fix + a dev restart was expected.

## Orchestrator investigation (END-TO-END, EMPIRICAL — not just static)

The full data path was traced AND a probe was run against the REAL on-disk default-session
transcript. Every layer is correct on disk:

1. **Submit embeds the marker** — confirmed in the real transcript. The persisted
   `defaultSessionId` (`<userData>/agent-session.json`) = `25023be8-…`, and that exact file has
   **34** `<cosmos:context>` markers. A real user line is a STRING content:
   `"content":"테스트\n\n<cosmos:context>{\"panel\":{\"id\":\"jira\",\"label\":\"Jira\"},\"tab\":{…}}</cosmos:context>"`.
   So the cross-panel fix works on disk (jira + cosmos contexts both recorded).
2. **`parseTranscript` attaches `context`** — ran the REAL `parseTranscript`
   (`src/main/fs/transcriptParse.ts`) over the REAL default transcript via tsx: **49 user-prompt
   turns, 11 carry `context`** (cosmos AND jira). The string-content branch (`:159-176`) parses +
   strips correctly. No parse bug.
3. **`TranscriptReader` reads the RIGHT file** — `loadDefaultSessionId()` → `25023be8` → the
   marker-bearing file. No wrong-session bug.
4. **`reconcileTimeline` passes every turn through** as `{kind:'turn', turn}` (`cosmosConversation.ts:71`)
   — `context` preserved.
5. **`CosmosTimelineEntry` renders the chip** in the historical `user-prompt` branch:
   `<PromptContextChip context={turn.context} />` above the bubble (`CosmosTimelineEntry.tsx:115-120`).
6. **`PromptContextChip` renders** panel + tab for a non-undefined context (`PromptContextChip.tsx:80-124`).
7. **`CosmosPanel` feeds historical turns in** — `conversation.getDefault()` → `setRead(populated)`
   → `reconcileTimeline(turns, live)` → maps to `CosmosTimelineEntry` (`CosmosPanel.tsx:88-117, 197-261`).

### Conclusion: on-disk code is correct; the runtime miss is STALE, not a code defect.

The most likely cause is the CLAUDE.md gotcha: **a new preload surface / a Context-provider shape
change needs a FULL `npm run dev` restart, not HMR.** Two concrete stale modes:
- `window.cosmos.conversation` undefined (preload not fully restarted) → `read='empty'` → NO
  historical turns render at all → only the live in-flight entry shows its chip while generating.
- `ActiveComposerProvider` gained `lastSubmitContextRef` (cross-panel fix); an HMR'd provider keeps
  the OLD shape until a full reload, and a stale `CosmosTimelineEntry`/`PromptContextChip` bundle
  renders the bubble without the chip.

### The genuinely UNTESTED link (why this keeps recurring)

Coverage exists for the pieces but NOT the integration:
- node: `transcriptParse.test.ts:181` exercises real `serializePromptContextMarker` →
  `parseTranscript` (string content) → `context`. ✓
- render-unit: `PromptContextChip.dom.test.tsx` does serialize → parse → render chip. ✓
- **MISSING: a jsdom test that mounts the REAL `CosmosPanel`, mocks
  `window.cosmos.conversation.getDefault()` to return a POPULATED conversation whose user-prompt
  turn carries a `context`, and asserts the HISTORICAL chip is in the DOM** (panel label visible).
  `reconcileTimeline`'s caller (`CosmosPanel`) has "no covering tests". `CosmosCrossPanelLiveContext.dom.test.tsx`
  mounts `CosmosPanel` but only for the LIVE path. So a regression in the
  read→reconcile→render-historical wiring is currently invisible to the suite.

## ROOT CAUSE — CONFIRMED (not stale; a real boundary-validator defect)

User reported (a) a full restart still fails, and (b) "에이전트 응답과 동시에 칩 없어짐" — the chip is
present WHILE generating and DISAPPEARS the instant the agent responds. That timing pinned it:

`validateConversationTurn` (`src/shared/ipc/conversation.validate.ts:47-53`) — the OUTBOUND
boundary validator for the `conversation:*` IPC — rebuilds a `user-prompt` turn as
`{ kind, id, ts, text: raw.text }` and **DROPS `raw.context`**. BOTH main paths run every turn
through it: `conversation:fetch` (mount, `index.ts:1329`) and `conversation:update`
(on a completed run, `index.ts:2060`). So the transcript-sourced (historical) turn ALWAYS arrives
at the renderer with `context` stripped → `PromptContextChip` gets `undefined` → renders null.

Why the chip seemed to "work then vanish": the LIVE in-flight entry's chip is seeded from the
App-root ref (`CosmosPanel` live seed) and NEVER crosses this validator, so it shows while
generating. On `agent:status 'completed'`, `setLive(null)` + the `conversation:update` re-read
replace the live entry with the validated transcript turn (context stripped) → the chip disappears.

Why every prior test missed it: the node `transcriptParse.test.ts` tests the PARSER (which attaches
context correctly — verified empirically) but never crosses `validateConversationTurn`; the jsdom
tests STUB `conversation.getDefault()` with a pre-built context turn, also bypassing the validator.
The validator is pure logic a node-unit test CAN cover — there just isn't one asserting context
carry-through.

## Fix (developer) — route: implementation defect, main/shared boundary layer

1. `validateConversationTurn` must CARRY THROUGH a validated `context` on the `user-prompt` case
   (only that case — `assistant-text` has no context). Validate the `PromptContext` shape
   independently at the boundary (panel required + known id + non-empty label; tab/dock optional,
   each well-formed or the context is dropped — mirror the parser's `validatePayload` rules). A
   malformed context is dropped to no-context (turn still valid), NEVER crashes (FR-118).
2. "One source": the marker parser's internal `validatePayload`
   (`src/shared/promptContext/promptContextMarker.ts`) already encodes the exact PromptContext
   schema. Export it (e.g. `validatePromptContext`) from the shared `promptContext` module and reuse
   it in BOTH the marker parser AND this boundary validator, so the two can never diverge. Keep it
   browser+node safe (no fs/electron import) — `conversation.validate.ts` is shared.
3. Split the `user-prompt`/`assistant-text` case so user-prompt returns `{ kind, id, ts, text,
   ...(ctx ? { context: ctx } : {}) }`.

## To do (test-engineer)

This test is ALSO the diagnostic: write it first, observe the result.
1. Read `docs/TEST-SCENARIOS.md` (don't contradict an existing invariant).
2. Add a jsdom test (`src/renderer/cosmos/CosmosHistoricalContext.dom.test.tsx`): mount the REAL
   `CosmosPanel` under `ActiveComposerProvider`; stub `window.cosmos.conversation.getDefault()` to
   resolve a populated `Conversation` containing a `user-prompt` turn with a `context` built from a
   REAL `parsePromptContextMarker(serializePromptContextMarker(ctx))` round-trip (jira context, so
   the chip is unmistakable — "Jira" + tab label). Also stub `ui.onRender`/`agent.onStatus` as
   no-op unsubscribers. Assert the historical chip (role="note", `Prompt context:` aria) renders
   the panel + tab — with `live=null` (NOT the in-flight path).
3. **Observe:**
   - GREEN immediately → confirms the on-disk wiring is correct and the user's runtime miss is
     STALE DEV. Keep the test as the regression guard for the read→render-historical link. Report
     "stale — full restart required" with certainty.
   - RED → a real read→reconcile→render-historical integration bug exists. Pin `file:line`, hand to
     `developer` to fix at root, re-run to green.
4. Update `docs/TEST-SCENARIOS.md` (new scenario id, e.g. `COSMOS-HIST-CTX-01`).

## Verification

`npm run typecheck` + `npm test` + `npm run test:dom` green incl. the new historical integration
test. If green throughout, the fix for the USER is a full `npm run dev` restart (quit the app
entirely; HMR does not reload the preload or the provider shape) — then a completed turn from any
panel keeps its chip in the timeline.
