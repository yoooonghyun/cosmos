/**
 * TranscriptWatcher (Electron main process) — cosmos-agent-progress-not-streaming-v1.
 *
 * The headless `claude -p` runner emits ONLY started/completed/error status (no intermediate
 * output), so before this watcher the Cosmos timeline saw `started` → a lone spinner →
 * `completed` → ONE conversation:update re-read that dumped every turn at once. The user could
 * not monitor the in-between steps.
 *
 * `claude` APPENDS to the default-session transcript jsonl INCREMENTALLY during a `-p` run (each
 * assistant message, `tool_use`, and `tool_result` is written as it happens). This watcher polls
 * that transcript WHILE a run is in flight and fires {@link TranscriptWatcherDeps.onChange} each
 * time the parsed conversation actually changes, so the existing `conversation:update` path
 * (`TranscriptReader` → `validateConversationResult` → `ConversationChannel.Update`) streams the
 * turns as they land — NO new IPC contract.
 *
 * Design choices:
 *  - POLL (not `fs.watch`): on the FIRST run the session's transcript file (and its parent dir)
 *    does not exist yet — `claude --session-id` creates it mid-run — so `fs.watch` would throw
 *    ENOENT at arm time. A poll degrades gracefully (a missing file reads as `empty`) and is
 *    deterministically testable. {@link TranscriptReader.read} already skips partial/malformed
 *    trailing lines (FR-108), so a mid-write poll is safe.
 *  - COALESCE: each tick compares a cheap signature of the read result and pushes ONLY on a real
 *    change, so a burst of appends between ticks collapses to one push and an unchanged transcript
 *    never re-renders the renderer.
 *  - Secret-safe: the watcher hands the SAME `ConversationResult` the reader produces to
 *    `onChange`; the caller validates it (`validateConversationResult`) before it crosses to the
 *    renderer, exactly as the completion re-read does.
 *  - No leaked timer: {@link stop} clears the interval and resets state; the caller stops it on
 *    completed/error AND on teardown (reload/close/dispose), mirroring `fsExplorer.stopAll()`.
 */

import type { ConversationResult } from '../../shared/ipc/conversation'

/** Default poll cadence (ms) while a run is in flight. */
export const TRANSCRIPT_POLL_MS = 250

type IntervalHandle = ReturnType<typeof setInterval>

export interface TranscriptWatcherDeps {
  /** Read the current default-session conversation snapshot (`TranscriptReader.read`). */
  read: () => ConversationResult
  /**
   * Push a CHANGED snapshot toward the renderer. Called ONLY when the conversation actually
   * changed since the last push (the caller validates + sends; the watcher owns the polling +
   * change-detection, not the boundary).
   */
  onChange: (result: ConversationResult) => void
  /** Injectable interval scheduler (defaults to the global `setInterval`). For tests. */
  setIntervalFn?: (cb: () => void, ms: number) => IntervalHandle
  /** Injectable interval clear (defaults to the global `clearInterval`). For tests. */
  clearIntervalFn?: (handle: IntervalHandle) => void
  /** Poll cadence (ms); defaults to {@link TRANSCRIPT_POLL_MS}. */
  pollMs?: number
}

export class TranscriptWatcher {
  private readonly deps: TranscriptWatcherDeps
  private readonly setIntervalFn: (cb: () => void, ms: number) => IntervalHandle
  private readonly clearIntervalFn: (handle: IntervalHandle) => void
  private readonly pollMs: number

  /** The active poll handle, or null when not watching. */
  private timer: IntervalHandle | null = null
  /** Signature of the last pushed snapshot, so an unchanged poll is coalesced. */
  private lastSignature: string | null = null

  constructor(deps: TranscriptWatcherDeps) {
    this.deps = deps
    this.setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms))
    this.clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h))
    this.pollMs = deps.pollMs ?? TRANSCRIPT_POLL_MS
  }

  /** True while a run's transcript is being watched. */
  get isWatching(): boolean {
    return this.timer !== null
  }

  /**
   * Arm the watch for a run that just STARTED. Idempotent: it first stops any prior watch and
   * RE-BASELINES on the CURRENT transcript so only turns appended DURING this run trigger an
   * incremental push (the prior run's final state was already pushed by the completion re-read).
   */
  start(): void {
    this.stop()
    this.lastSignature = signature(this.safeRead())
    this.timer = this.setIntervalFn(() => this.tick(), this.pollMs)
  }

  /**
   * Disarm the watch (run completed/errored, or teardown). Clears the interval so no watcher
   * leaks across runs or window teardown, and resets the baseline for the next run.
   */
  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer)
      this.timer = null
    }
    this.lastSignature = null
  }

  /** One poll: re-read, and push only when the conversation changed since the last push. */
  private tick(): void {
    const result = this.safeRead()
    const sig = signature(result)
    if (sig === this.lastSignature) {
      return // unchanged since the last push — coalesce a quiet/duplicate poll
    }
    this.lastSignature = sig
    this.deps.onChange(result)
  }

  /** Read defensively — the reader never throws, but never let a tick break the interval. */
  private safeRead(): ConversationResult {
    try {
      return this.deps.read()
    } catch {
      return { ok: false, reason: 'empty' }
    }
  }
}

/** Cheap change signature over the read result (turns + per-turn fields, not just count). */
function signature(result: ConversationResult): string {
  try {
    return JSON.stringify(result)
  } catch {
    return ''
  }
}
