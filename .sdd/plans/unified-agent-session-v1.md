# Plan: Unified Agent Session — v1

**Status**: Draft
**Created**: 2026-06-27
**Last updated**: 2026-06-27
**Spec**: .sdd/specs/unified-agent-session-v1.md

---

## Grounding

See the spec's Grounding section (same investigation). Key code facts the plan relies on:
- `src/main/agentSessionQueue.ts` — `isPersistentSessionTarget(target)` (`=== 'generated-ui'`),
  `decideSubmit({ running, isPersistentTarget })` returns `spawn` (idle) / `enqueue` (busy +
  persistent) / `drop` (busy + other).
- `src/main/agentRunner.ts` — `run()` calls `decideSubmit` with `isPersistentTarget:
  this.usesPersistentSession(target)`; `usesPersistentSession` = `defaultSessionId !== undefined &&
  isPersistentSessionTarget(target)`; `spawnRun()` pushes `--session-id` only when
  `usesPersistentSession(target)`; `drainQueue()` (FIFO) already exists; `QueuedSubmit` already
  carries `{ utterance, target, viewContext }`.
- `src/main/index.ts` (~2312) constructs `AgentRunner` with `{ sandboxDir, defaultSessionId:
  defaultSession.sessionId }`.
- Render routing + per-tab in-flight is renderer-side (`useGenerativePanelTabs`), keyed on `target`;
  NO change needed there for the session unification.

## Summary

Decouple "which session a run uses" from "which target it renders to" in the headless `AgentRunner`.
Today both are gated on `isPersistentSessionTarget(target)` (`'generated-ui'` only): only that target
passes `--session-id` and only that target enqueues while busy; every other target runs ephemerally
and drops while busy. The change: ALWAYS pass `--session-id <defaultSessionId>` for every target, and
ALWAYS enqueue (never drop) while busy. The `target` is preserved purely for `ui:render` routing.
This is a small, well-contained main-process change concentrated in `agentSessionQueue.ts` (pure
decision logic) and `agentRunner.ts` (apply the session id + queue uniformly), plus an
`ARCHITECTURE.md` §4.10 update. The renderer, transcript reader, IPC contract, and tool grants are
unchanged.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main process) |
| Key dependencies | none new — reuses `claude --session-id`, existing FIFO queue, `AgentSessionStore`, `TranscriptReader` |
| Files to create | none |
| Files to modify | `src/main/agentSessionQueue.ts`, `src/main/agentRunner.ts`, `src/main/agentRunner.test.ts` (extend), `src/main/agentSessionQueue.test.ts` (extend if present), `docs/ARCHITECTURE.md` (§4.10) |

### Design decision: decouple session from render target

- The session id is a property of the RUNNER (it owns one persistent `defaultSessionId`), not of the
  target. Every spawn passes `--session-id <defaultSessionId>` when `defaultSessionId` is defined.
- The `target` flows untouched from `run()` → `spawnRun()` → `--mcp-config`/`--allowedTools`/grounding
  selection and is carried on the emitted render frame, so per-panel routing is unchanged.
- The queue serializes ALL targets because they now share the one session id (mutual exclusion).

## Implementation Checklist

### Phase 1 — Interface (pure decision logic)

- [ ] Read spec; confirm no open questions remain (none blocking).
- [ ] `agentSessionQueue.ts`: change `decideSubmit` so a busy runner ALWAYS returns `enqueue`
      (remove the `isPersistentTarget` branch that returns `drop`). Decision becomes: idle → `spawn`;
      busy → `enqueue`. Drop the `isPersistentTarget` argument (or keep the signature but ignore it —
      prefer simplifying to `decideSubmit({ running })`). Update the JSDoc to state all targets
      serialize on the single shared session.
- [ ] `agentSessionQueue.ts`: keep `selectDefaultSessionId` (create-or-continue) unchanged.
- [ ] `agentSessionQueue.ts`: `isPersistentSessionTarget`/`PERSISTENT_SESSION_TARGET` are now
      effectively unused by the session decision. Either remove them (preferred — they encode the old
      coupling) or, if any other caller exists, leave them but stop using them in `agentRunner`.
      Verify callers via codegraph before deleting.
- [ ] Review types vs spec — no invented properties. `QueuedSubmit` already carries `target` +
      `viewContext` (FR-006), no change needed.

### Phase 2 — Testing

- [ ] `agentSessionQueue.test.ts`: assert `decideSubmit` returns `enqueue` for a non-default target
      while busy (the regression: was `drop`), and `spawn` when idle for any target.
- [ ] `agentRunner.test.ts`: assert a run for a NON-default target (e.g. `'jira'`) passes
      `--session-id <defaultSessionId>` (the core FR-001 change; was absent before).
- [ ] `agentRunner.test.ts`: assert a submit for a non-default target while busy is ENQUEUED and
      drained after the in-flight run completes (FR-004/FR-005), running with its own `target` (FR-006).
- [ ] `agentRunner.test.ts`: assert interleaved multi-target submits drain FIFO and never spawn two
      children concurrently (SC-003 — at most one in-flight child).
- [ ] `agentRunner.test.ts`: assert tool grants are still per-target (a `'jira'` run still uses the
      jira `--mcp-config`/`--allowedTools`, FR-007) — unchanged behavior, guard against regression.

### Phase 3 — Implementation

- [ ] `agentRunner.ts` `run()`: call the simplified `decideSubmit` so EVERY target enqueues while
      busy (delete the `usesPersistentSession`-gated `isPersistentTarget` arg usage).
- [ ] `agentRunner.ts` `spawnRun()`: push `--session-id <defaultSessionId>` whenever
      `this.defaultSessionId !== undefined` (drop the `usesPersistentSession(target)` target check).
      Remove `usesPersistentSession` if now unused.
- [ ] Confirm `drainQueue()` already serializes correctly (it does — only spawns when idle);
      no change beyond the decision/grant edits.
- [ ] Confirm `dispose()` still clears `queue` + kills child (FR-014) — unchanged.
- [ ] `src/main/index.ts`: no change to AgentRunner construction (it already passes
      `defaultSessionId`); verify no caller relied on per-target ephemerality.
- [ ] Renderer: NO change. Confirm `useGenerativePanelTabs` per-tab in-flight already covers a queued
      submit (the originating tab is marked in-flight at send/begin-signal time and released on this
      run's `completed`/`error`/`ui:render`) — FR-008. If a queued run's begin-signal is delayed
      until it actually spawns, verify the panel's "Generating…" path still resolves (it keys on
      `agent:status` for THIS run, emitted when the run truly starts). Note any gap as a deviation.

### Phase 4 — Docs

- [ ] `docs/ARCHITECTURE.md` §4.10: replace the stale "**Single-run guard (sequential).** ... no
      queue, no concurrency" bullet. New text: ALL Open-Prompt targets run against the ONE persistent
      default session (`--session-id <defaultSessionId>` always), so every panel's conversation
      accumulates in the Cosmos panel's transcript; runs SERIALIZE app-wide via the FIFO queue (a
      submit while busy enqueues, never drops); the `target` governs only `ui:render` routing
      (per-panel), decoupled from the session. Note shared cross-panel context as a deliberate product
      property and that security (tokens main-only) is unchanged.
- [ ] `docs/ARCHITECTURE.md` §4.11: the "Why this is valid: runs are sequential" correlation note
      still holds (runs are still strictly sequential — now via the universal queue rather than a
      single-run drop). Adjust the wording from "single-run guard" to "FIFO serialization" so it stays
      accurate.
- [ ] Update this plan with deviations; persist the decoupling decision via `memory_save`.

---

## Deviations & Notes

- 2026-06-27: Plan authored. §4.10's "no queue, no concurrency" wording is already stale relative to
  cosmos-conversation-panel-v1 step 2 (which added the default-target queue); this change generalizes
  the queue to all targets and the doc update corrects both.
