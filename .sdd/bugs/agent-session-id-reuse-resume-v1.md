# Bug: Cosmos panel chat — "Session ID already in use", every submit fails

ID: `agent-session-id-reuse-resume-v1`
Status: Fixed
Skill: bugfix
Reported: 2026-06-28

## Symptom

Chatting in the Cosmos / Open-Prompt panel does nothing — no run ever completes.
Main log:

```
[agent] submit utterance= "ㅎㅇ" target= generated-ui
[agent] status= started
[agent] run closed code=1 stderr=Error: Session ID 25023be8-f90c-4f48-8aa7-44d2c7404f09 is already in use.
[agent] status= started        ← planResumeRetry backoff, re-spawns same args
[agent] run closed code=1 stderr=Error: Session ID …already in use.
… (×6 retries) …
[agent] status= error  Session ID …already in use.
```

Every submit (first one of the launch included) fails identically; the backoff retries
all hit the same rejection and exhaust to `error`.

## Reproduction

1. Launch the app at least once (mints + persists a default session id, creates the
   session jsonl).
2. Relaunch (or just submit twice in one launch).
3. Submit any utterance from the Open-Prompt / Cosmos panel → "already in use", forever.

Deterministic — not a race; reproduces on the FIRST submit after the session id was ever
created.

## Classification

Implementation defect (main process) → `developer`.
Wrong CLI flag for session continuation. No contract/IPC/schema change. Contained to the
main-process AgentRunner session-arg selection.

## Root cause

`src/main/agent/agentRunner.ts:257-259` passes `--session-id <defaultSessionId>` on EVERY
run, on the belief (comment at :250-256, and `agentSessionQueue.ts:14`) that
`--session-id` is "create-or-continue".

For headless `claude -p` it is NOT. `--session-id <id>` is **create-only**: once the
session jsonl exists it HARD-rejects "Session ID is already in use" (see
`src/main/pty/sessionLockRecovery.ts:12` "`--session-id` hard-rejects",
`:140` `--resume` only rejects while a LIVE process holds the id). The default session id
is persisted across launches and the jsonl is created by the first run, so every
subsequent run re-creating the same id is rejected immediately.

The `session-id-already-in-use-runtime-v1` retry (`agentRunner.ts:335-363` →
`planResumeRetry`/`recoverSessionLock`) misdiagnoses this as a transient registry-release
race. That recovery only removes stale **live-pid** registry entries; here NO process
holds the id — the session merely exists on disk — so the retry can never succeed and
always exhausts to `error`.

The PTY path already does this correctly: it CONTINUES an existing session with `--resume`
(`paneSpawn.ts:100`, `index.ts:556`) and reserves `--session-id` for fresh creation
(`paneSpawn.ts:110-157`).

## Fix (design — for developer)

Select the continuation flag the same way the PTY path does:

- The session must be CREATED exactly once (the freshly-minted id's first run) → `--session-id`.
- Every continuation (later runs this launch, and all runs after relaunch since the id is
  persisted) → `--resume <id>`. `--resume` only rejects while a LIVE process holds the id,
  and the runner already serializes all submits on the one session id (`decideSubmit`), so
  no concurrent holder exists; the existing live-holder backoff retry stays as the safety net.

Concrete:
1. `agentSessionQueue.ts` — add a pure helper, e.g.
   `sessionFlagForRun(sessionExists: boolean): '--resume' | '--session-id'`
   (`exists ? '--resume' : '--session-id'`). Node-testable; node-unit cover both.
2. `agentRunner.ts` —
   - new constructor option `sessionAlreadyExists?: boolean` (default `false`), stored as a
     mutable `private sessionExists`.
   - at :257, push `sessionFlagForRun(this.sessionExists)` instead of the literal
     `'--session-id'`, then set `this.sessionExists = true` (after the first create, every
     later run resumes).
   - safety net: in the "already in use" handler (:340), set `this.sessionExists = true`
     before scheduling the retry, so a mis-classified create on an existing session
     retries as `--resume`.
3. `index.ts:2393-2397` — pass `sessionAlreadyExists: !defaultSession.minted` (persisted id
   ⇒ session already exists ⇒ resume from the first run; freshly-minted ⇒ create first).
4. Fix the stale "create-or-continue" comments in `agentRunner.ts` + `agentSessionQueue.ts`.

## Regression test (for test-engineer)

- node-unit: `sessionFlagForRun` — exists→`--resume`, not-exists→`--session-id`.
- node-integration (`agentRunner.integration.test.ts` with an injected `spawn`): a runner
  built with `sessionAlreadyExists: true` spawns the FIRST run with `--resume <id>` (NOT
  `--session-id`); a runner with a freshly-minted id (`false`) uses `--session-id` on run #1
  and `--resume` on run #2. Must FAIL against the current always-`--session-id` code.

## Verification

`npm run typecheck`, `npm test`, `npm run test:integration` green incl. new tests; then a
live `npm run dev` Cosmos-panel chat: two consecutive submits both complete (no "already in
use").

## Resolution (2026-06-28)

Implemented as designed. `agentRunner.ts:288` now pushes `sessionFlagForRun(this.sessionExists)`
then flips `sessionExists=true`; the "already in use" handler (`:380`) also flips it before the
backoff retry; `index.ts:2401` wires `sessionAlreadyExists: !defaultSession.minted`. Stale
"create-or-continue" comments corrected in `agentRunner.ts` + `agentSessionQueue.ts`.

Verified: `npm run typecheck` + `npm run build` clean; node-unit **2573 passed**;
node-integration **57 passed** (+3 new: `sessionFlagForRun` unit cases + the
`sessionAlreadyExists` first-run-resume integration cases). The 9 old tests that encoded the
buggy always-`--session-id` contract were updated to the create-once-then-`--resume` contract.

Test-authoring note: the new exhaustion test initially failed (2 errors vs 1) because its
simulated stderr `'Session ID is already in use'` omitted the id, so it did NOT match
`ALREADY_IN_USE_RE = /Session ID\s+\S+\s+is already in use/i` — the retry path never engaged and
every close emitted an immediate error. Fixed by using the id-bearing form
`Session ID <id> is already in use` (the exact string `claude` prints, and what the existing
registry-retry test at line 374 already used).

**Live GUI (`npm run dev`) not yet exercised** — needs a real Cosmos-panel chat with two
consecutive submits to confirm no "already in use".
