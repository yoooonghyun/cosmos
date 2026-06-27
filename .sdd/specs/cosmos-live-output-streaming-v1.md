# Spec: Cosmos Live Output Streaming — v1

**Status**: Draft
**Created**: 2026-06-27
**Supersedes**: (extends cosmos-conversation-panel-v2; does not supersede it)
**Related plan**: .sdd/plans/cosmos-live-output-streaming-v1.md

---

## Grounding

> Direct investigation run by the architect (codegraph + agentmemory + official docs).

**codegraph_explore**
- `agentRunner spawn claude --output-format json stdout streaming run completed producedSurface`
  → AgentRunner spawns `claude -p … --output-format json`, accumulates ALL stdout into one
  string, and only acts on it at `child.on('close')` (exit code + parsed JSON blob). No
  per-line handling today. `producedSurface` is derived in index.ts from a `renderPushedForRun`
  flag toggled by `ui:render`, NOT from stdout — so it is independent of the output format.
- `transcriptReader transcriptParse CosmosTimelineEntry conversation fetch cosmosConversation re-read on completed`
  → `parseTranscript(lines)` maps jsonl lines (`type:user|assistant`, `message.content`
  blocks: `text`/`tool_use`/`tool_result`) to `ConversationTurn[]`; `reconcileTimeline` merges
  transcript turns with one live in-flight entry; `CosmosTimelineEntry` already renders
  `assistant-text`, collapsible `tool-call`, and inline `surface`.

**Files read:** `src/main/agentRunner.ts`, `src/shared/ipc/conversation.ts`,
`src/renderer/cosmosConversation.ts`, `src/shared/conversation.ts`, `src/renderer/CosmosPanel.tsx`,
`src/main/transcriptParse.ts`, `src/main/index.ts` (runner sinks + `pushConversationUpdateToRenderer`),
`docs/ARCHITECTURE.md` §4.10.

**memory_recall / memory_smart_search**
- `cosmos conversation panel timeline transcript re-read on run completed unified agent session`
  → no prior memory (empty); persisted a new architecture memory on the stream-json switch +
  id-keyed dedup.

**Official docs (knowledge-confirmed; live fetch looped on redirects):** `claude -p`
`--output-format stream-json` emits one JSON object per line — a `system` init message, then
`assistant`/`user` messages whose `message.content` blocks match the Anthropic Messages API
(`text`, `tool_use`, `tool_result`), then a final `result` message (`is_error`/`result`).
`stream-json` requires `--verbose` in print mode. The per-line `message` shape is the SAME one
`transcriptParse.ts` already parses from the transcript jsonl.

---

## Overview

The Cosmos conversation timeline must show the embedded agent's reasoning, tool use, and
output **live as it happens** during a run, instead of only re-reading the transcript after the
run completes. Today a run shows a spinner until completion; this feature streams every model
output message into the timeline in real time while keeping the completed-transcript re-read as
a reconciling backstop.

## User Scenarios

### See reasoning and tool use stream live · P1

**As a** cosmos user who submitted an Open-Prompt utterance
**I want to** watch the agent's assistant text and tool calls appear in the Cosmos timeline as
they are produced
**So that** I understand what the agent is doing during a long run instead of staring at a spinner.

**Acceptance criteria:**
- Given a run is in flight, when the agent emits an assistant text message, then that text
  appears in the Cosmos timeline within ~1s of being produced, before the run completes.
- Given a run is in flight, when the agent invokes a non-render tool, then a collapsed tool-call
  row (name + sanitized arg preview) appears live, and its result preview fills in when the tool
  returns.
- Given a run is in flight, when the agent calls the `render_ui` tool, then the generated surface
  appears inline and interactive (unchanged from today's live `ui:render` path).

### No double-render after completion · P1

**As a** cosmos user
**I want to** see each message exactly once after the run completes
**So that** the live-streamed turns are not duplicated by the completed-transcript re-read.

**Acceptance criteria:**
- Given turns were streamed live during a run, when the run completes and main re-reads the
  transcript, then each turn is shown exactly once (the live entries are superseded by, not
  appended to, the transcript turns), keyed by turn id.
- Given the streamed live turns and the re-read transcript turns, when they are merged, then the
  final order matches the transcript order (chronological).

### A run that errors mid-stream · P2

**As a** cosmos user
**I want to** keep the live turns already streamed when a run fails partway
**So that** I see what the agent did before it failed, plus a calm error indication.

**Acceptance criteria:**
- Given a run streamed some turns then exited non-zero, when the error status arrives, then the
  already-streamed turns remain visible and the in-flight "generating" affordance is cleared
  (error surfaced as today via `agent:status` error).

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST invoke the headless `claude -p` run with a STREAMING output format (`--output-format stream-json`, with `--verbose` as print mode requires) so the run emits one JSON message per line on stdout as work happens. |
| FR-002 | Main MUST parse each stdout line incrementally as it arrives (line-buffered) and map each conversational message to the existing `ConversationTurn` shape (`user-prompt`, `assistant-text`, `tool-call`, `surface`), reusing the established `transcriptParse` mapping + secret-sanitization. |
| FR-003 | Main MUST push each newly-parsed turn to the renderer over a streaming append IPC channel (`conversation:appended`) carrying ONLY the normalized, secret-safe turn(s) for the default session. |
| FR-004 | The Cosmos timeline MUST render appended turns live, reusing the existing `CosmosTimelineEntry` rendering (assistant text, collapsed tool-call rows, inline surfaces) — no new entry rendering. |
| FR-005 | The system MUST keep `conversation:fetch` as the initial full-conversation load (panel mount) and keep the completed-run transcript re-read (`conversation:update`) as a reconciling backstop. |
| FR-006 | The merge of streamed turns and the re-read transcript MUST be idempotent and keyed by turn id (the transcript `uuid`-derived id): a turn already present (by id) MUST NOT be rendered twice and MUST NOT be dropped. |
| FR-007 | The system MUST continue to derive run lifecycle (`started`/`completed`/`error`) and `producedSurface` correctly under the new output format; the streaming format MUST NOT regress the existing `agent:status` consumers (Open-Prompt spinner gating, tab correlation). |
| FR-008 | The system MUST NOT stream any token, OAuth secret, credential, raw `~/.claude` path, or `--mcp-config` content — only model output messages, sanitized through the same `previewArgs`/`SECRET_PATTERNS` bounding as the transcript path (FR-104 of v2). |
| FR-009 | A streamed line that fails to parse, is noise/sidechain, or carries no turn MUST be skipped without crashing main or breaking the stream (mirrors transcript-parse resilience). |
| FR-010 | Streaming MUST remain a single-run-at-a-time concern: because runs serialize on the one default session, at most one run streams into the Cosmos timeline at a time; a queued run begins streaming only after the prior run completes. |
| FR-011 | On a run that errors mid-stream, already-appended turns MUST remain rendered and the in-flight "generating" affordance MUST clear (error surfaced via the existing `agent:status` error). |

## Edge Cases & Constraints

- **Partial trailing line.** A stdout chunk may split a JSON line mid-object; the parser MUST
  buffer until a newline before parsing (never parse a partial line as malformed).
- **Render surface arrives both live and via the stream.** The `render_ui` surface already
  arrives live via `ui:render` (today's path) AND now also as a `tool_use`/`surface` line in the
  stream AND in the completed transcript. The merge MUST show it exactly once (existing
  `reconcileTimeline` suppresses a live surface already in the transcript by `surfaceId`;
  extend the same idea so the streamed `surface` turn and the live `ui:render` entry do not
  both render).
- **Long stream.** A very long run may stream many turns. List virtualization is DEFERRED
  (consistent with v2 deferring virtualization) — out of scope here; only correctness + live
  growth are required.
- **Interleaving with the serialized queue.** Streamed-turn pushes for run N MUST stop when run
  N completes; run N+1's stream begins only after. The append channel carries no run id (runs
  are sequential — same invariant as §4.11 tab correlation); if cosmos ever allows concurrent
  runs this MUST be revisited.
- **Non-default-target runs.** A `jira`/`slack`/`confluence` run also uses the streaming format,
  but its turns append to the SAME default session (unified-agent-session), so they stream into
  the Cosmos timeline too — consistent with v2 (every Open-Prompt run records into the one
  session). This is intended, not a regression.
- **Out of scope:** list virtualization; rich markdown rendering of assistant text (still
  sanitized React text nodes, per v2); streaming the interactive Terminal PTY (untouched);
  per-token / partial-message streaming below the message granularity (we stream whole messages
  as `stream-json` emits them, not delta tokens).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | During a multi-step run, assistant text and tool-call rows appear in the Cosmos timeline before the run completes (observable in `npm run dev`). |
| SC-002 | After completion, no turn is duplicated and none is dropped versus the transcript-only render (id-keyed merge). |
| SC-003 | No token/secret/path ever appears in a `conversation:appended` payload (validated at the main boundary; same sanitization as the transcript path). |
| SC-004 | Existing `agent:status` consumers (Open-Prompt spinner gating `producedSurface`, generative-panel tab correlation) behave identically to before the output-format switch. |
| SC-005 | A run that errors mid-stream leaves its already-streamed turns visible and clears the in-flight affordance. |

---

## Open Questions

- [ ] **OQ-001 (output-format switch risk).** Switching `--output-format json` → `stream-json`
  changes stdout from a single result blob to N lines. `runErrorMessage`/`parseJsonResult` in
  agentRunner currently `JSON.parse` the WHOLE stdout expecting one object — under stream-json
  that parse fails and error text falls back to stderr/exit-code. The plan handles this by
  reading the final `result` line for the error message, but the implementer MUST confirm
  `--output-format stream-json` still exits non-zero on failure and still carries a usable
  `result`/error string in the final line. `producedSurface` is derived from `renderPushedForRun`
  (a `ui:render` flag), NOT stdout, so it is unaffected — but verify in `npm run dev`.
- [ ] **OQ-002 (dedup/merge key).** Confirm that the streamed `assistant`/`user` lines carry the
  SAME `uuid` that `claude` later writes to the transcript jsonl (so a streamed turn and its
  transcript twin share an id and merge idempotently). If the stream `uuid` differs from the
  transcript `uuid`, the merge must key on a stable surrogate (e.g. order + kind + text/tool id)
  — the implementer MUST verify against a real `stream-json` run and pin a fixture.
- [ ] **OQ-003 (verbose requirement).** Confirm `claude -p --output-format stream-json` requires
  `--verbose` in the installed CLI version and that `--verbose` does not leak any extra
  diagnostic content that needs additional sanitization.
