/**
 * Pure persistent-session-id selection + submit-serialization decisions for the
 * default-agent conversation (cosmos-conversation-panel-v1, step 2).
 *
 * No Electron / fs / child_process imports — just the create-or-continue id rule
 * and the per-session queue-vs-spawn-vs-drop decision, kept node-testable so the
 * two load-bearing rules are exercised without launching a real `claude`.
 *
 * Why a persistent session id: the default-agent (the `'generated-ui'` wire
 * target the Cosmos panel hosts) must be ONE continuous `claude` conversation, so
 * every Open-Prompt submit passes `--session-id <persistedId>`: the first run
 * CREATES the session, every later run (this launch AND after relaunch) CONTINUES
 * it, and `claude` records the transcript jsonl on disk for the later history step.
 *
 * Why serialize: two concurrent `claude -p --session-id <same id>` collide
 * ("Session ID is already in use" — the class the terminal session-lock work hit).
 * A single ongoing conversation is inherently sequential, so default-target
 * submits QUEUE behind the in-flight run rather than being dropped.
 */

import { DEFAULT_UI_RENDER_TARGET, type UiRenderTarget } from '../shared/ipc'

/** The render target whose runs share the one persistent, queued conversation. */
export const PERSISTENT_SESSION_TARGET: UiRenderTarget = DEFAULT_UI_RENDER_TARGET

/** True when `target` is the default conversation that uses the persistent session id. */
export function isPersistentSessionTarget(target: UiRenderTarget): boolean {
  return target === PERSISTENT_SESSION_TARGET
}

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

/** What the runner should do with a freshly-received submit. */
export type SubmitDecision =
  | { action: 'spawn' }
  | { action: 'enqueue' }
  | { action: 'drop' }

/**
 * Decide what to do with a submit given whether a run is in flight and whether the
 * submit targets the persistent (default) conversation.
 *
 * - Idle → `spawn` (run it now), regardless of target.
 * - In flight + persistent-session target → `enqueue` (serialize behind the
 *   in-flight run; a continuous conversation is sequential, never collide on the id).
 * - In flight + any other target → `drop` (today's single-run / blocked-while-busy
 *   behaviour is unchanged for non-default targets).
 *
 * Pure: no I/O, no mutation — the caller acts on the returned action.
 */
export function decideSubmit(args: {
  running: boolean
  isPersistentTarget: boolean
}): SubmitDecision {
  if (!args.running) {
    return { action: 'spawn' }
  }
  if (args.isPersistentTarget) {
    return { action: 'enqueue' }
  }
  return { action: 'drop' }
}
