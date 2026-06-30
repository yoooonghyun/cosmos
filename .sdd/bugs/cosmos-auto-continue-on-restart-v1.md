# Bug: Cosmos timeline shows "Continue from where you left off." on every restart

- **ID:** cosmos-auto-continue-on-restart-v1
- **Area:** Cosmos default-conversation timeline (Home) / default-session transcript parsing
- **Severity:** Medium (cosmetic-but-confusing; looks like the app auto-issues a command)
- **Classification:** Developer fix (renderer-feeding parser, display layer). NOT an architecture/design change. NOT a spec-level change.
- **Status:** Fixed (pending manual `npm run dev` confirmation).

## Symptom

The Cosmos agent (the default-conversation timeline in Home) shows a user turn
"**Continue from where you left off.**" every time the session/app restarts — as if an
auto-continue command is issued on restart. (Paired with an assistant turn
"No response requested." that also appears.) The user wants this REMOVED, without
losing legitimate session persistence (a restart must still SHOW the prior conversation —
it just must not show an auto "continue" turn).

## Step 0 — what was already verified (and re-confirmed)

- The literal string "Continue from where you left off." is **NOT** anywhere in `src/`,
  `out/`, or `tests/` (re-grepped). Cosmos does not hardcode it and issues no continue command.
- `agentRunner.run(utterance, target, viewContext)` is invoked ONLY from the `agent:submit`
  IPC handler (`src/main/index.ts`). No auto-run on startup. No mount-time `agent.submit` in
  the renderer with a hardcoded/continuation utterance (every `window.cosmos.agent.submit`
  caller passes a user-typed utterance via `buildAgentSubmitWithMarker`).
- No `--continue` / `-c` flag anywhere in `src/main` spawn args (agent runner, paneSpawn,
  ptyManager). The agent runner spawns `claude -p <utterance> ... (--session-id|--resume) <id>`.

## REAL origin (traced to the on-disk transcript)

The phrase is written by the **`claude` binary itself**, not by cosmos. Evidence from the
cosmos default-session transcript jsonl (the file the Cosmos timeline reads):

- Default session id: `agent-session.json` → `defaultSessionId: "5164a077-…"`.
- Transcript: `~/.claude/projects/-Users-…-cosmos-sandbox/5164a077-….jsonl` — contains **8**
  occurrences, each a turn shaped:

  ```jsonc
  { "type":"user", "isMeta":true, "entrypoint":"sdk-cli",
    "message":{"role":"user","content":[{"type":"text","text":"Continue from where you left off."}]} }
  ```

  immediately followed by a synthetic assistant reply:

  ```jsonc
  { "type":"assistant", "entrypoint":"sdk-cli",
    "message":{"model":"<synthetic>","content":[{"type":"text","text":"No response requested."}]} }
  ```

- The FIRST run of the session (`--session-id`, create) has NO such turn; **every later
  `--resume` run injects this synthetic pair before processing the real prompt**. So the count
  tracks resume runs (i.e. roughly every app restart / first submit after relaunch).
- This is generic `claude` CLI behavior, not cosmos-specific: the same `isMeta:true`
  "Continue from where you left off." turn appears in many of the user's OTHER projects'
  transcripts (a2tui, fin-agent, cho-fam, …). It is the meta continuation prompt the print/SDK
  harness records on resume (`entrypoint:"sdk-cli"` = `claude -p`'s SDK harness, which the agent
  runner uses).

### Why it reached the Cosmos timeline (the cosmos-side defect)

`src/main/fs/transcriptParse.ts` → `parseTranscript()` → `isNoiseLine()` dropped only:
- `isSidechain:true` lines, and
- the four bookkeeping `type`s (`permission-mode`, `file-history-snapshot`, `attachment`,
  `queue-operation`).

It did NOT filter `isMeta:true` lines nor synthetic-model lines. So:
- the meta `type:"user"` turn fell through and mapped to a `user-prompt` turn →
  "Continue from where you left off." rendered as a user bubble;
- the paired `type:"assistant"` `model:"<synthetic>"` turn mapped to an `assistant-text` turn →
  "No response requested." rendered as an assistant bubble.

## Dev-vs-binary classification

- **The WRITE** of the synthetic pair is the `claude` binary's inherent `--resume` behavior.
  There is **no cosmos lever** (no spawn flag) to suppress the binary recording it, and we must
  keep `--resume` for legitimate session persistence (it is exactly how the conversation
  continues across runs/relaunch). So we do NOT try to stop the write.
- **The RENDER** is the cosmos lever. The meta/synthetic turns are explicitly tagged by claude
  as internal (`isMeta:true`, `model:"<synthetic>"`) precisely so consumers skip them — the
  transcript parser simply wasn't. This is the minimal, correct cosmos-side fix.

## Fix (minimal, display-only)

`src/main/fs/transcriptParse.ts` — `isNoiseLine()` now ALSO returns `true` for:
- any line with `isMeta === true`, and
- any line whose `message.model === "<synthetic>"`.

Both are dropped like the existing noise types (FR-103). This is a **display-only** filter:
the transcript jsonl on disk is untouched, the session still resumes via `--resume`, and ALL
real prior turns still parse and render — only the injected continuation bookkeeping is hidden.
A restart still SHOWS the prior conversation; it just no longer shows the phantom
"Continue from where you left off." / "No response requested." pair.

No IPC/contract change, no behavior change in the agent runner or session store.

## Regression test (RED → GREEN)

`src/main/fs/transcriptParse.test.ts` — new describe block
"parseTranscript — resume bookkeeping (cosmos-auto-continue-on-restart-v1)":
1. the injected `isMeta:true` "Continue from where you left off." user turn → dropped;
2. the `<synthetic>`-model "No response requested." assistant turn → dropped;
3. a full resume run (meta + synthetic + real prompt + real reply) → ONLY the two real turns.

Confirmed RED before the `isNoiseLine` extension (the meta turn became a `user-prompt`, the
synthetic became an `assistant-text`), GREEN after. Full `transcriptParse` suite: 21 pass.

TEST-SCENARIOS row added: **CONV-RESUME-META-01**.

## Verify

- `npm run typecheck` — green.
- `npm test` / `npx vitest run src/main/fs/` — green.
- Manual `npm run dev`: restart the app and confirm the Cosmos Home timeline shows the prior
  conversation WITHOUT a leading "Continue from where you left off." / "No response requested."
  turn, and that submitting a new prompt still works (resume intact). Note: the parser lives in
  main, so a normal app restart picks it up (no preload-restart caveat for this change).
