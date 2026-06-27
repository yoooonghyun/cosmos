# Bug: "Session ID is already in use" at runtime (Jira panel submit)

**Status:** Root cause identified — fix recommended below  
**Scope:** agentRunner / session registry only

---

## Symptom

Submitting from the Jira panel (or any generative panel) while a prior run's
`claude` process is still writing its registry file produces:

```
Could not render this surface: Error: Session ID 25023be8-... is already in use.
```

## Root Cause — registry-release timing gap

**File:** `src/main/agentRunner.ts:279-296` (the `close` handler / `drainQueue` call)

The AgentRunner FIFO serializer is correct: it never spawns child N+1 while N
is running. However, "running" is defined by `this.running` — which is cleared
by `finish()` the moment the `close` event fires on child N's process. The
`close` event is the Node.js signal that the child's stdio streams have closed
**and the process has exited**. That is sufficient for the Node.js side but NOT
for claude's session registry.

Claude writes `~/.claude/sessions/<pid>.json` while it is alive and is supposed
to remove it on clean exit. Between the OS reporting the process has exited
(firing `close` in Node.js) and claude having finished its own cleanup
(removing the registry file), there is a short but real window. In that window:

1. Child N exits → Node.js fires `close` event.
2. `finish()` sets `this.running = false`.
3. `drainQueue()` immediately calls `spawnRun` for the next queued item.
4. Child N+1 starts and passes `--session-id <same-id>`.
5. Claude N+1 scans `~/.claude/sessions/` and finds N's entry still present.
6. N's pid is dead (from the OS's view) but the file has not been removed yet.
7. Claude N+1 hard-rejects: "Session ID … is already in use."

**Why the integration test misses it:** The integration test (`agentRunner.integration.test.ts`) uses a fake spawn that returns a fake `EventEmitter` child. Firing `close` on that child is synchronous and instantaneous — there is no real OS process and no real `~/.claude/sessions/` registry. The test confirms the FIFO queue drains in order and that two same-session children are never alive simultaneously, but it cannot observe the registry-release window that only exists when `claude` is a real process managing a real file.

The `sessionLockRecovery.ts` / `planResumeRetry` backoff **already exists** but is wired **only for the PTY `--resume` path** (`onSessionInUseForPane` in `index.ts:484`). The `AgentRunner.spawnRun` path has **no equivalent**: when `claude` exits non-zero with "already in use" on its stderr, `spawnRun` surfaces it as a terminal error and drains the next queued item without retrying.

---

## Evidence

- `src/main/agentRunner.ts:279` — `close` handler calls `finish()` then `drainQueue()` with no registry-release delay.
- `src/main/sessionLockRecovery.ts:70,186` — `ALREADY_IN_USE_RE` and `RESUME_RETRY_BACKOFF_MS` are defined and exported; wired in `index.ts:484` for PTY only.
- `src/main/index.ts:484` — `onSessionInUseForPane` applies `planResumeRetry` with backoff for PTY resumes. No parallel function exists for `AgentRunner`.
- No second independent spawn path: `agentRunner.run()` is the sole caller of `spawnRun`; the PTY path mints its own UUIDs (`randomUUID()` in `paneSpawn.ts:161`) that are completely independent from `defaultSessionId`.

---

## Fix (minimal)

In `src/main/agentRunner.ts`, inside the `close` handler:

1. Detect "already in use" on the combined stdout+stderr (using the existing `isAlreadyInUseError` from `sessionLockRecovery.ts`).
2. If detected AND the run had a `defaultSessionId`, call `planResumeRetry` (injected `SessionLockEnv` via constructor option, defaulting to `null` / no-op so existing tests are unaffected and the agentRunner stays PTY-free).
3. If `retry`, schedule `setTimeout(() => spawnRun(last), delayMs)` with the same item rather than advancing the queue; if `give-up`, surface the error and drain normally.

This mirrors the PTY pattern exactly, reuses all existing pure helpers, and requires:
- ~15 lines added to `agentRunner.ts`
- A new optional `sessionLockEnv?: SessionLockEnv` field in `AgentRunnerOptions`
- Wired with the real `claudeSessionLockEnv` when constructed in `index.ts:2312`

**Lines changed estimate:** < 25 across `agentRunner.ts` (the fix) + 1 in `index.ts` (pass `claudeSessionLockEnv`).

---

## How to test

**Unit/integration (preferred):**  
Extend `agentRunner.integration.test.ts` with an injected `SessionLockEnv` stub (fake registry that returns a dead-pid stale entry). Submit two runs; let child 0 exit with "Session ID is already in use" stderr + code 1. Assert child 1 was NOT spawned immediately (retry path), is spawned after the delay, and the status sequence is `started → error(retrying) → started → completed` (or started → completed if the retry succeeds silently).

**E2E smoke:**  
Submit from the Jira panel while a prior run just finished — the error should no longer appear. Submitting twice rapidly should queue cleanly.

---

## Escalation

Fix is self-contained in `agentRunner.ts` + `index.ts` (< 30 lines, no new contracts, no new IPC). No architect escalation needed. Assign to developer.
