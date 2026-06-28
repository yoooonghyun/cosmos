/**
 * Pure persistent-session-id selection + submit-serialization decisions for the
 * unified-agent conversation (unified-agent-session-v1; extends
 * cosmos-conversation-panel-v1 step 2).
 *
 * No Electron / fs / child_process imports — just the create-or-continue id rule
 * and the queue-vs-spawn decision, kept node-testable so the two load-bearing
 * rules are exercised without launching a real `claude`.
 *
 * Why ONE persistent session id for ALL targets: every Open-Prompt submit — from
 * any panel (Jira, Slack, Confluence, Calendar, Generated UI) — runs against the
 * SAME persistent `claude` session, so every conversation accumulates in the one
 * default-session transcript the Cosmos panel reads. For headless `claude -p`,
 * `--session-id <id>` is CREATE-ONLY (it hard-rejects "already in use" once the
 * session jsonl exists) while `--resume <id>` CONTINUES an existing session. So the
 * session is CREATED exactly once with `--session-id` (its first run) and every later
 * run — this launch AND after relaunch, since the id is persisted — CONTINUES it with
 * `--resume` (see {@link sessionFlagForRun}); `claude` records the transcript jsonl on
 * disk for the history reader. The render `target` is decoupled — it governs ONLY which
 * panel a generated surface renders into, never which session a run uses
 * (unified-agent-session-v1 FR-001..FR-003).
 *
 * Why serialize ALL targets: two concurrent `claude -p --session-id <same id>`
 * collide ("Session ID is already in use"). Because every target now shares the one
 * session id, EVERY submit is mutually exclusive — a submit while busy QUEUES behind
 * the in-flight run (FIFO) rather than being dropped (FR-004/FR-005).
 */

/** The outcome of {@link selectDefaultSessionId}. */
export interface SessionIdSelection {
  /** The session id to pass as `--session-id` for the default conversation. */
  sessionId: string
  /** True when a fresh id was minted (caller should persist it); false = reused the persisted id. */
  minted: boolean
}

/**
 * Create-or-continue: pick the default conversation's session id. A previously
 * persisted, non-empty id is REUSED (so the conversation continues across runs and
 * across relaunch); otherwise a fresh id is minted (and the caller persists it so
 * the NEXT launch continues this same conversation). Pure — `mintId` is injected.
 */
export function selectDefaultSessionId(
  persistedId: string | null | undefined,
  mintId: () => string
): SessionIdSelection {
  if (typeof persistedId === 'string' && persistedId.trim().length > 0) {
    return { sessionId: persistedId, minted: false }
  }
  return { sessionId: mintId(), minted: true }
}

/**
 * Pick the CLI flag that continues-or-creates the one persistent default session for a
 * single headless `claude -p` run (agent-session-id-reuse-resume-v1).
 *
 * For `claude -p`, `--session-id <id>` is CREATE-ONLY — once the session jsonl exists it
 * hard-rejects "Session ID is already in use" — whereas `--resume <id>` CONTINUES an
 * existing session (rejecting only while a LIVE process still holds the id). So:
 *
 * - `sessionExists === false` → `--session-id` (the session must be CREATED — its first run).
 * - `sessionExists === true`  → `--resume`     (the session already exists on disk — continue it).
 *
 * The runner flips its tracked `sessionExists` to `true` after the first create, so the
 * persisted id is created exactly once and every later run resumes — exactly how the PTY
 * pane-spawn path selects `--resume` vs `--session-id`.
 *
 * Pure: no I/O, no mutation.
 */
export function sessionFlagForRun(sessionExists: boolean): '--resume' | '--session-id' {
  return sessionExists ? '--resume' : '--session-id'
}

/** What the runner should do with a freshly-received submit. */
export type SubmitDecision = { action: 'spawn' } | { action: 'enqueue' }

/**
 * Decide what to do with a submit given whether a run is in flight.
 *
 * Because every target now shares the ONE persistent session id
 * (unified-agent-session-v1 FR-001..FR-005), the decision no longer depends on the
 * render target — it is purely the in-flight guard:
 *
 * - Idle → `spawn` (run it now), regardless of target.
 * - In flight → `enqueue` (serialize behind the in-flight run; every run is mutually
 *   exclusive on the shared session id, so a busy submit QUEUES, never drops).
 *
 * There is NO `drop` outcome any more: the old per-target ephemeral path (a
 * non-default target dropping while busy) is removed (FR-013). The `target` is
 * carried through purely for `ui:render` routing, decoupled from this decision.
 *
 * Pure: no I/O, no mutation — the caller acts on the returned action.
 */
export function decideSubmit(args: { running: boolean }): SubmitDecision {
  if (!args.running) {
    return { action: 'spawn' }
  }
  return { action: 'enqueue' }
}
