# Bug: Cosmos timeline shows only a spinner then the final result — agent progress doesn't stream

ID: `cosmos-agent-progress-not-streaming-v1`
Skill: bugfix → Implementation defect (route: `developer`; escalate to `architect` only if a
contract change is genuinely required)
Reported: 2026-06-29

## Symptom (user)

In the Home / Cosmos panel timeline, while the cosmos agent is working, only the "…" TypingIndicator
spinner shows; the intermediate steps (tool calls, assistant text as it is produced) never appear —
ONLY the final result shows up at the end. The user wants the in-between progress to STREAM live so
they can monitor what the agent is doing.

## Root cause (orchestrator-pinned)

The headless agent run does not surface intermediate output:
- `AgentRunner` spawns `claude -p --output-format json` (`src/main/agent/agentRunner.ts:257,273`) —
  a SINGLE final result JSON on stdout. `child.stdout.on('data')` merely ACCUMULATES the bytes into
  a `stdout` string (`:332-333`); it never parses or emits intermediate events.
- `AgentRunnerSinks` exposes ONLY `onStatus` (started / completed / error) (`:53-55`). There is no
  intermediate text / tool-call / surface sink.
- So the renderer sees `onStatus('started')` → the Cosmos timeline shows a `live-generating`
  TypingIndicator (`CosmosTimelineEntry.tsx`) → `onStatus('completed')` → the
  `conversation:update` re-read (`index.ts` ~`:2057-2065`) pushes the FULL transcript at once →
  all the turns appear together at the end.

## Fix approach (contained — reuse existing infra; NO new IPC contract)

`claude` APPENDS to the default-session transcript jsonl INCREMENTALLY during a `-p` run (each
assistant message, `tool_use`, and `tool_result` is written as it happens). The existing
`conversation:update` path already re-reads that transcript (`TranscriptReader` →
`validateConversationResult` → `ConversationChannel.Update`) and the Cosmos timeline already renders
the parsed turns (`parseTranscript` → `reconcileTimeline` → `CosmosTimelineEntry`). Today that
re-read+push fires ONLY on run completion. The fix: re-read + push the transcript WHILE a run is in
flight, so the timeline streams the turns as `claude` writes them.

Concretely:
1. MAIN: while an agent run is in flight, WATCH the default-session transcript file (the path
   `TranscriptReader` already resolves) — `fs.watch` (debounced) or a short poll — and push a
   `conversation:update` on each change. Stop watching when the run completes/errors (the existing
   completion re-read remains the authoritative final push). Guard against partial-line reads
   (`parseTranscript` already skips malformed/partial trailing lines — FR-108) and debounce so a
   burst of appends coalesces. Keep it secret-safe (the same validated, non-secret `Conversation`).
2. RENDERER: a MID-RUN `conversation:update` must NOT clear the live in-flight entry. Today
   `CosmosPanel`'s `conversation.onUpdate` calls `setLive(null)` (it assumed Update == completion),
   which would kill the TypingIndicator on every incremental push. Gate it: only the
   `agent:status 'completed'` (and the final post-completion re-read) clears `live`; an incremental
   update just refreshes `read` so `reconcileTimeline` shows `[turns-so-far] + [live TypingIndicator]`
   — i.e. the streamed steps with the spinner still at the tail until done. Verify the
   reconcile/dedup still shows each turn exactly once (no double-render with the live surface entry).

This reuses the existing `conversation:*` contract, `TranscriptReader`, `parseTranscript`,
`validateConversationResult`, and `reconcileTimeline` — so it is a contained main+renderer wiring
change, NOT a new streaming IPC contract.

NOTE / scope boundary: this streams at MESSAGE / tool-call granularity (claude writes the transcript
per message), which matches "monitor the intermediate process". TRUE token-by-token streaming would
require `--output-format stream-json --verbose` + parsing the event stream + a new text-delta channel
+ timeline delta rendering — a larger, new-contract change. If the user wants token-level streaming,
STOP and escalate to `architect`/`sdd`. Implement the transcript-watch (message-granularity) streaming
first unless told otherwise.

## To do (developer)

1. Confirm the root cause + the transcript-watch approach with codegraph (`AgentRunner`,
   `TranscriptReader`, the `index.ts` completion re-read, `CosmosPanel.onUpdate`, `reconcileTimeline`)
   + `wiki_query` (debugging). Pin `file:line`.
2. Implement the in-flight transcript watch + incremental `conversation:update` push (main) + the
   `setLive` gating so mid-run updates keep the spinner (renderer). Debounced, secret-safe, no new IPC.
3. Tests: node-integration (the transcript-watch → incremental Update push during a run, stops on
   completion, coalesces a burst) + jsdom (CosmosPanel: an incremental `conversation:update` shows the
   accumulating turns WITH the TypingIndicator still present; only `agent:status 'completed'` clears
   live; no double-render). Update `docs/TEST-SCENARIOS.md`.
4. If the clean fix needs a contract change (e.g. conversation:update must carry an "incremental vs
   final" flag, or token-streaming is required), STOP and escalate to `architect`.

## Verification

`npm run typecheck` + `npm test` + `npm run test:integration` + `npm run test:dom` green incl. the new
streaming tests; exercise in `npm run dev` — submit a multi-step prompt in Cosmos and watch the tool
calls / assistant messages appear progressively (not just the final result), with the spinner staying
until completion.
