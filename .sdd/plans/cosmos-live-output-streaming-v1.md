# Plan: Cosmos Live Output Streaming — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: .sdd/specs/cosmos-live-output-streaming-v1.md

> NOTE: another agent is concurrently editing `src/main/agentRunner.ts`. Implementation of the
> agentRunner changes (Phase 3a) MUST wait until that edit lands. Phases that touch other files
> (IPC contract, parse split, renderer merge) can proceed in parallel.

---

## Grounding

See the spec's Grounding section (same investigation). Key load-bearing facts:
- `agentRunner` accumulates ALL stdout, acting only at `child.on('close')` with `--output-format
  json`. Switching to `stream-json` means line-buffered incremental parsing of stdout.
- `parseTranscript` already maps `type:user|assistant` + `message.content` blocks
  (`text`/`tool_use`/`tool_result`, render_ui → `surface`) to `ConversationTurn[]` with secret
  sanitization. `stream-json` emits the SAME `message` shape per line — so the per-line mapping
  REUSES this logic (factor the per-line mapper out of the whole-file loop).
- `reconcileTimeline` already merges transcript turns + one live entry; extend it to merge an
  ordered list of streamed turns by id.
- `producedSurface` is derived from `renderPushedForRun` (a `ui:render` flag in index.ts), NOT
  from stdout — so the output-format switch does not affect it.

## Summary

Switch the headless `claude -p` run from `--output-format json` to `--output-format stream-json
--verbose` so stdout emits one JSON message per line as the run progresses. In main, line-buffer
stdout and map each conversational line to a `ConversationTurn` by reusing a factored-out
`mapTranscriptLine` (extracted from `parseTranscript`), then push each new turn to the renderer
over a new fire-and-forget `conversation:appended` channel. The Cosmos panel accumulates appended
turns into live timeline state, reusing `CosmosTimelineEntry`. On completion the existing
`conversation:update` transcript re-read remains the authoritative backstop; `reconcileTimeline`
is extended to merge streamed turns + transcript turns idempotently by turn id so nothing
double-renders or drops. Run lifecycle (`completed`/`error`) and `producedSurface` are preserved
by reading the final `result` line + keeping the `ui:render`-driven flag.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer), Vitest |
| Key dependencies  | `node:child_process` (existing spawn), existing `parseTranscript`/`previewArgs`, existing `reconcileTimeline`, typed IPC barrel `src/shared/ipc.ts` |
| Files to create   | (none required — extend existing modules; optionally `src/main/streamJsonLines.ts` for the pure line buffer + its `.test.ts`) |
| Files to modify   | `src/shared/ipc/conversation.ts` (+ barrel re-export), `src/main/transcriptParse.ts` (factor out per-line mapper), `src/main/agentRunner.ts` (stream-json args + line-buffered stdout + onTurn sink) — WAIT for concurrent edit, `src/main/index.ts` (wire onTurn → validate → `conversation:appended`), `src/main/preload/*` conversation API (`onAppended`), `src/renderer/cosmosConversation.ts` (merge streamed turns by id), `src/renderer/CosmosPanel.tsx` (accumulate appended turns into state), validators in `src/shared/*validate*`, `docs/ARCHITECTURE.md` §4.10 |

---

## Technical Approach

### 1. Streaming output format (agentRunner)
- Replace the `--output-format json` arg pair with `--output-format stream-json` plus `--verbose`
  (print-mode requirement). Keep all other args unchanged.
- Replace the "accumulate whole stdout, parse on close" logic with a **line buffer**: append each
  `stdout` chunk to a residual buffer, split on `\n`, parse each complete line, keep the trailing
  partial in the buffer. Pure split/buffer logic goes in `streamJsonLines.ts` (node-unit-tested).
- For each complete line, call the new `mapTranscriptLine(line, ctx)` (below). When it yields one
  or more turns, push them via a new runner sink `onTurn(turns: ConversationTurn[])`. Maintain the
  tool_use_id→tool-call correlation map ACROSS lines for the run so a later `tool_result` line can
  fill `resultPreview` (same correlation `parseTranscript` does in-file). When a `resultPreview`
  is filled on an already-pushed tool-call turn, re-push that turn (same id) so the renderer's
  id-keyed merge updates it.
- On `close`: keep deriving `completed`/`error` from exit code. For the error message, read the
  final `result` line (`is_error`/`result`) from the buffered lines instead of `JSON.parse` of
  the whole stdout. Keep the existing `pushConversationUpdateToRenderer()` re-read on completed as
  the backstop (FR-005).

### 2. Per-line mapper (transcriptParse)
- Extract the per-line body of `parseTranscript`'s loop into an exported pure
  `mapTranscriptLine(line: string, ctx: { toolCallById: Map<string, ToolCallTurn> }): ConversationTurn[]`
  (returns 0..n turns; mutates `ctx.toolCallById` for correlation; applies the SAME noise/sidechain
  skip + secret sanitization). `parseTranscript` is refactored to call it in a loop (behavior
  unchanged — existing tests must still pass). agentRunner's streamer calls the same mapper with a
  per-run `ctx`, guaranteeing live + transcript turns are byte-identical and share ids.

### 3. Streaming IPC contract (`conversation:appended`)
- Add to `ConversationChannel`: `Appended: 'conversation:appended'` (M→R send). Payload: a
  secret-safe `ConversationAppendedPayload { turns: ConversationTurn[] }` (the normalized turns —
  no run id; runs serialize). Add `onAppended(listener)` to `ConversationApi`; expose via preload
  (NEW preload method ⇒ full `npm run dev` restart). Add a boundary validator
  `validateConversationAppendedPayload` (reuse the conversation-turn validation already backing
  `validateConversationResult`); drop a malformed/secret-bearing frame, never send (FR-008/FR-009).
- Keep `Fetch` (initial load) and `Update` (completed re-read backstop) exactly as today.

### 4. Renderer merge (cosmosConversation + CosmosPanel)
- CosmosPanel: add `streamedTurns` state. `onAppended` merges incoming turns into it **by id**
  (replace-or-append, preserving first-seen order). `onUpdate` (completed re-read) and `getDefault`
  set the authoritative transcript turns AND clear `streamedTurns` (the transcript now supersedes
  them — FR-006). `started` resets `streamedTurns` for the new run.
- Extend `reconcileTimeline(transcriptTurns, streamedTurns, live)`: start from transcript turns,
  then append any `streamedTurns` whose id is NOT already in transcript (id-keyed dedup), then the
  existing live-surface/live-generating suppression. Result: during a run the timeline = transcript
  history + streamed in-flight turns; after completion = transcript only (streamed cleared). The
  live-`generating` affordance shows only until the FIRST streamed turn arrives (then real turns
  replace the spinner); `live-surface`/`ui:render` suppression extended so a streamed `surface`
  turn and the live `ui:render` entry never both render (dedup by `surfaceId`).

### 5. Lifecycle / producedSurface (index.ts)
- Wire the new `onTurn` runner sink in index.ts: validate + `webContents.send(Appended, …)`.
- `producedSurface` derivation is unchanged (driven by `renderPushedForRun` toggled on `ui:render`).
  Confirm `agent:status` started/completed/error semantics unchanged under stream-json (OQ-001).

---

## Implementation Checklist

### Phase 1 — Interface
- [ ] Read spec; confirm OQ-001/OQ-002/OQ-003 are resolved (verify a real `stream-json` run) before coding
- [ ] Add `Appended` channel + `ConversationAppendedPayload` + `onAppended` to `src/shared/ipc/conversation.ts`; re-export via `src/shared/ipc.ts` barrel
- [ ] Add `validateConversationAppendedPayload` boundary validator (reuse conversation-turn validation)
- [ ] Add `onTurn(turns: ConversationTurn[])` to `AgentRunnerSinks` (interface only first)
- [ ] Review types vs spec — no invented fields (no run id, no raw line/path)

### Phase 2 — Testing (`.test.ts` siblings, node)
- [ ] `mapTranscriptLine`: per-line mapping for user-prompt / assistant-text / tool_use / render_ui→surface / tool_result correlation across calls; noise + malformed skipped; secret redaction
- [ ] `parseTranscript` existing tests still green after the refactor (no behavior change)
- [ ] `streamJsonLines` buffer: partial trailing line buffered, multiple lines per chunk, blank lines skipped
- [ ] `agentRunner`: stream-json args include `--output-format stream-json --verbose`; per-line stdout drives `onTurn` with mapped turns; `tool_result` line re-pushes the tool-call turn with `resultPreview`; non-zero exit → error from final `result` line; teardown does not emit
- [ ] `reconcileTimeline`: streamed turns appended by id; a streamed turn whose id is in transcript is NOT duplicated; streamed `surface` + live `ui:render` not double-rendered; order matches transcript
- [ ] `validateConversationAppendedPayload`: rejects malformed / secret-shaped payloads

### Phase 3 — Implementation
- [ ] (3b, parallel-safe) Refactor `parseTranscript` to call exported `mapTranscriptLine`
- [ ] (3b) Add `conversation:appended` channel, validator, preload `onAppended`
- [ ] (3b) Extend `reconcileTimeline` + CosmosPanel streamed-turns state + merge/clear wiring
- [ ] (3a, WAIT for concurrent agentRunner edit) stream-json args + line-buffered stdout + `onTurn` sink + final-`result`-line error parse
- [ ] (3a) Wire `onTurn` → validate → `conversation:appended` in index.ts
- [ ] All tests pass; `npm run typecheck` (node + web) clean
- [ ] Reused `parseTranscript` mapping + `previewArgs` sanitization — no duplicated parse logic

### Phase 4 — Docs
- [ ] Update `docs/ARCHITECTURE.md` §4.10: runner now uses `--output-format stream-json --verbose`; main line-buffers stdout and pushes incremental turns over `conversation:appended`; the completed transcript re-read is the reconciling backstop; id-keyed idempotent merge; producedSurface still `ui:render`-driven
- [ ] Update `docs/PROJECT-STRUCTURE.md` if `streamJsonLines.ts` is added
- [ ] Update this plan with deviations; verify SC-001..SC-005 in `npm run dev`

---

## Deviations & Notes

- **2026-06-27**: Plan authored. Phase 3a (agentRunner) gated on a concurrent edit to
  `src/main/agentRunner.ts` — coordinate before touching that file.
