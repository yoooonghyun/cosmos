/**
 * AgentRunner (Electron main process) — cosmos generative-UI foundation v1.
 *
 * The headless `claude -p` runner: receives a natural-language utterance and
 * processes it by spawning the already-installed, already-logged-in `claude`
 * binary as a NON-PTY child process in headless print mode. The child is granted
 * ONLY the existing render_ui MCP tool (via the SHARED `--mcp-config` builder), so
 * its `render_ui` calls land in the EXISTING `UiBridge → ui:render` path and the
 * surface appears in the Generated-UI panel — no second rendering path.
 *
 * A SEPARATE channel from the interactive Terminal PTY (FR-008): this manager
 * NEVER spawns, kills, writes to, or shares a stream with the PTY. Both run the
 * same `claude` binary and read the same read-mostly `~/.claude` login, but each
 * is an independent child process.
 *
 * Concurrency (unified-agent-session-v1): all targets share ONE persistent session
 * id, so runs are mutually exclusive and SERIALIZE app-wide. A `run()` received while
 * a run is in flight is ENQUEUED (FIFO) and drained when the in-flight run completes —
 * never dropped, never overlapping on `--session-id`.
 *
 * Spec trace: .sdd/specs/generative-ui-foundation-v1.md
 *   FR-005 spawn the `claude` binary headless (`claude -p`), inherit `~/.claude`
 *   FR-006 main-process manager mirroring PtyManager/UiBridge lifecycle
 *   FR-007 grant the shared render_ui MCP tool via --mcp-config
 *   FR-008 separate channel from the interactive PTY (no PTY coupling)
 *   FR-011 emit started/completed/error status (no tokens/secrets/transcript)
 *   FR-013 least-privilege: only render_ui in --mcp-config + --allowedTools
 *   FR-014 a run failure / un-startable run -> error status, never hang/crash
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { isExecutableResolvable } from './ptyManager'
import { allowedToolForTarget, groundingPromptForTarget, renderMcpConfigJsonForTarget } from './mcpConfig'
import { viewContextGroundingClause } from './viewContextGrounding'
import { decideSubmit } from './agentSessionQueue'
import {
  isAlreadyInUseError,
  planResumeRetry,
  type SessionLockEnv
} from './sessionLockRecovery'
import {
  DEFAULT_UI_RENDER_TARGET,
  type AgentStatusPayload,
  type UiRenderTarget,
  type ViewContext
} from '../shared/ipc'

/** Sinks the runner pushes lifecycle status into; wired to IPC by the caller. */
export interface AgentRunnerSinks {
  /** FR-009/FR-011: deliver a run lifecycle/status event to the renderer. */
  onStatus(payload: AgentStatusPayload): void
}

/**
 * The minimal `child_process.spawn` shape the runner depends on. Injected so the
 * runner's lifecycle logic is unit-testable without launching a real `claude`.
 */
export type SpawnFn = typeof nodeSpawn

export interface AgentRunnerOptions {
  /** Working directory for the spawned `claude` child (the isolated sandbox). */
  sandboxDir: string
  /** The command to spawn. Defaults to `claude`. */
  command?: string
  /** Injectable spawn (defaults to `node:child_process.spawn`). For tests. */
  spawn?: SpawnFn
  /**
   * Injectable binary-resolution pre-check (defaults to PtyManager's PATH
   * pre-check). Returns false when `claude` cannot be found — the runner then
   * surfaces an `error` rather than spawning a missing binary (FR-014).
   */
  resolveExecutable?: (command: string) => boolean
  /**
   * unified-agent-session-v1 (extends cosmos-conversation-panel-v1 step 2): the
   * PERSISTENT, create-or-continue session id for the ONE unified conversation. When
   * set, EVERY run — regardless of render target — passes `--session-id <this>` so
   * all panels' Open-Prompt conversations accumulate in ONE continuous `claude`
   * session (each submit builds on the prior context) and `claude` RECORDS the
   * transcript jsonl on disk that the Cosmos panel reads; the caller persists this id
   * so it survives relaunch. The session id is DECOUPLED from the render `target`
   * (the target governs only which panel a surface renders into — FR-001..FR-003).
   * Omit (undefined) to keep the pre-feature ephemeral behaviour (no `--session-id`).
   */
  defaultSessionId?: string
  /**
   * session-id-already-in-use-runtime-v1: injected registry env so the runner can survive the
   * registry-release window. When a queued run is drained the instant the previous `claude` child
   * exits, the prior child may not yet have removed its `~/.claude/sessions/<pid>.json` entry, so the
   * next `claude --session-id <same id>` is hard-rejected "already in use". On that rejection the
   * runner uses {@link planResumeRetry} (the SAME pure helper the PTY `--resume` path uses) to wait a
   * short backoff and re-spawn the SAME queued item, rather than surfacing a terminal error.
   *
   * Optional and defaults to a NO-OP (an env with an empty registry) so existing tests and the
   * PTY-free property are unaffected: with no holder + the budget present, the path is identical to
   * before unless a real "already in use" stderr appears. Wire the real `claudeSessionLockEnv` in
   * `index.ts` so production gets the registry-release retry.
   */
  sessionLockEnv?: SessionLockEnv
}

/** One queued submit (any target), awaiting the in-flight run to finish. */
interface QueuedSubmit {
  utterance: string
  target: UiRenderTarget
  viewContext?: ViewContext
  /**
   * session-id-already-in-use-runtime-v1: 1-based count of registry-release retries already
   * attempted for THIS submit (0 on first spawn). Threaded through {@link planResumeRetry} so the
   * backoff budget is bounded per submit and a permanently-held id eventually surfaces an error.
   */
  inUseAttempts?: number
}

/**
 * A no-op SessionLockEnv (empty registry) — the default when no real env is injected. Keeps the
 * runner PTY-free and leaves existing tests/behaviour unchanged: with no holder found, a retry plan
 * still waits the backoff and re-spawns (the dying-orphan race), but production wires the real env.
 */
const NOOP_SESSION_LOCK_ENV: SessionLockEnv = {
  listRegistryFiles: () => [],
  readEntry: () => null,
  isAlive: () => false,
  killPid: () => {},
  removeFile: () => {}
}

export class AgentRunner {
  private readonly sinks: AgentRunnerSinks
  private readonly sandboxDir: string
  private readonly command: string
  private readonly spawn: SpawnFn
  private readonly resolveExecutable: (command: string) => boolean
  /** Persistent default-conversation session id, or undefined (ephemeral). */
  private readonly defaultSessionId?: string
  /** Injected registry env for the registry-release retry (defaults to a no-op empty registry). */
  private readonly sessionLockEnv: SessionLockEnv

  /** The in-flight child, or null when idle (single-run state). */
  private child: ChildProcess | null = null
  /** True while a run is in flight (single-run guard). */
  private running = false
  /**
   * FIFO of submits (ANY target) waiting for the in-flight run to finish
   * (unified-agent-session-v1). Because every target now shares the one persistent
   * session id, ALL submits SERIALIZE here instead of being dropped — drained one at
   * a time as each run completes, so two `claude -p --session-id <same id>` never
   * collide. Each queued entry keeps its own `target`/`viewContext` so a drained run
   * still renders into the right panel with the right grounding (FR-004..FR-006).
   */
  private readonly queue: QueuedSubmit[] = []

  constructor(sinks: AgentRunnerSinks, options: AgentRunnerOptions) {
    this.sinks = sinks
    this.sandboxDir = options.sandboxDir
    this.command = options.command ?? 'claude'
    this.spawn = options.spawn ?? nodeSpawn
    this.resolveExecutable = options.resolveExecutable ?? isExecutableResolvable
    this.defaultSessionId = options.defaultSessionId
    this.sessionLockEnv = options.sessionLockEnv ?? NOOP_SESSION_LOCK_ENV
  }

  /** True while a headless run is in flight. */
  get isRunning(): boolean {
    return this.running
  }

  /**
   * Process an utterance via a headless `claude -p` run (FR-005). Single-run:
   * ignored if a run is already in flight. Emits `started` on spawn, then
   * `completed` (exit 0) or `error` (non-zero exit / spawn failure / binary not
   * found) — never throws out of `run()`, never hangs the input (FR-014).
   *
   * `target` (Jira generative-UI v2, D2) selects WHICH render tool the run may
   * call: `'jira'` registers ONLY `cosmos-jira-render-ui` + grants ONLY
   * `render_jira_ui` (so the surface lands in the Jira panel via `target: 'jira'`);
   * `'generated-ui'` (the default) registers ONLY `cosmos-render-ui` + grants ONLY
   * `render_ui`. Least-privilege per run (FR-007). The `target` governs ONLY render
   * routing + tool grants — it is DECOUPLED from the session: every run uses the one
   * persistent session id and EVERY submit serializes app-wide (unified-agent-session-v1).
   *
   * `viewContext` (open-prompt-view-context-v1) is the active panel's non-secret current
   * view (the open ticket/channel/thread/page/event). When supplied it is appended to the
   * run's grounding system prompt so deictic utterances resolve — it NEVER touches the
   * user's literal `-p` utterance and NEVER broadens tool grants (FR-007/FR-009).
   */
  run(
    utterance: string,
    target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET,
    viewContext?: ViewContext
  ): void {
    // Defense in depth — the renderer + validator already guard FR-004. Reject an
    // empty utterance BEFORE the busy/queue decision so it never occupies a slot.
    if (utterance.trim().length === 0) {
      return
    }

    // unified-agent-session-v1: a submit while busy is QUEUED regardless of target —
    // every target shares the one persistent session id, so all runs are mutually
    // exclusive and must serialize (never collide on `--session-id`, never be dropped).
    // Idle → spawn now; busy → enqueue behind the in-flight run (FIFO drained on close).
    const decision = decideSubmit({ running: this.running })
    if (decision.action === 'enqueue') {
      this.queue.push({ utterance, target, viewContext })
      return
    }
    this.spawnRun({ utterance, target, viewContext })
  }

  /**
   * Spawn ONE `claude -p` run (the body extracted from {@link run} so the queue can
   * re-invoke it). Assumes the busy/queue decision has already cleared this submit
   * to start now. A pre-check / spawn failure emits `error` and drains the queue so
   * a queued conversation never stalls behind a failed run.
   */
  private spawnRun(submit: QueuedSubmit): void {
    const { utterance, target, viewContext } = submit
    // Electron PATH caveat: a GUI-launched app may not inherit the shell PATH, so
    // `claude` may be unresolvable. Pre-check and fail fast with an `error` status
    // rather than spawning a missing binary (FR-014).
    if (!this.resolveExecutable(this.command)) {
      this.sinks.onStatus({
        state: 'error',
        message: `"${this.command}" was not found on PATH. Install Claude Code or ensure it is on PATH.`
      })
      this.drainQueue()
      return
    }

    const args = [
      '-p',
      utterance,
      '--mcp-config',
      // D2: register ONLY the render server for this target (jira vs generated-ui).
      renderMcpConfigJsonForTarget(this.sandboxDir, target),
      // Only use servers from --mcp-config — ignore any global MCP config so the
      // headless run is isolated to the one render tool (least-privilege; FR-013).
      '--strict-mcp-config',
      // Non-interactive: never block on an approval prompt; auto-deny anything not
      // in --allowedTools.
      '--permission-mode',
      'dontAsk',
      // Least-privilege: grant ONLY the render tool for this target (D2 / FR-013).
      '--allowedTools',
      allowedToolForTarget(target),
      // Single result JSON on stdout so completion/error are detectable.
      '--output-format',
      'json'
    ]

    // unified-agent-session-v1: EVERY run (regardless of target) passes the PERSISTENT
    // `--session-id` so the FIRST run creates the session and every later run (this
    // launch AND after relaunch) CONTINUES it — one continuous conversation across all
    // panels + a recorded transcript jsonl the Cosmos panel reads. `--session-id <id>`
    // is create-or-continue, the same flag the terminal pane-spawn reuse uses. The
    // session id is DECOUPLED from `target`; only its absence (no defaultSessionId)
    // keeps the pre-feature ephemeral behaviour.
    if (this.defaultSessionId !== undefined) {
      args.push('--session-id', this.defaultSessionId)
    }

    // Per-target grounding (jira): force the run to render only REAL fetched tickets and
    // never fabricate, since the render tool's description carries a placeholder example.
    // open-prompt-view-context-v1 (FR-007): append the active panel's view-context clause
    // (the open ticket/channel/thread/page/event) to the SAME system prompt so deictic
    // utterances resolve — the user's literal `-p` utterance above is left untouched.
    const groundingPrompt = composeGroundingPrompt(
      groundingPromptForTarget(target),
      viewContextGroundingClause(target, viewContext)
    )
    if (groundingPrompt) {
      args.push('--append-system-prompt', groundingPrompt)
    }

    let child: ChildProcess
    try {
      child = this.spawn(this.command, args, {
        cwd: this.sandboxDir,
        // Inherit the user's `~/.claude` login — do NOT inject ANTHROPIC_API_KEY
        // or CLAUDE_CODE_OAUTH_TOKEN (FR-005).
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      // A synchronous spawn throw (rare) -> error status, no hang (FR-014).
      this.sinks.onStatus({
        state: 'error',
        message: `Failed to start "${this.command}": ${errorMessage(err)}`
      })
      // The slot never became busy; drain any queued submit so a failed spawn does
      // not strand the conversation.
      this.drainQueue()
      return
    }

    this.running = true
    this.child = child
    this.sinks.onStatus({ state: 'started' })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    // Spawn failure (e.g. ENOENT slipping past the pre-check) -> error status.
    child.on('error', (err: Error) => {
      if (this.child !== child) {
        return // superseded by a dispose/teardown; do not emit
      }
      this.finish()
      this.sinks.onStatus({
        state: 'error',
        message: `Failed to start "${this.command}": ${err.message}`
      })
      this.drainQueue()
    })

    child.on('close', (code: number | null) => {
      if (this.child !== child) {
        return // disposed/killed during teardown; do not emit completed/error
      }
      this.finish()
      console.log(`[agent] run closed code=${code} stdout=${stdout.trim().slice(0, 800)} stderr=${stderr.trim().slice(0, 400)}`)
      if (code === 0) {
        this.sinks.onStatus({ state: 'completed' })
        // unified-agent-session-v1: the run finished and freed the slot — start the next
        // queued submit (any target, if any), serializing so two `--session-id <same id>`
        // runs never overlap.
        this.drainQueue()
        return
      }
      // session-id-already-in-use-runtime-v1: a non-zero exit whose stderr/stdout carries claude's
      // "already in use" rejection is the registry-release race — the just-exited child has not yet
      // removed its `~/.claude/sessions/<pid>.json` entry, so this same-id run was rejected. Mirror
      // the PTY `--resume` path: plan a backoff retry via the shared {@link planResumeRetry} helper
      // and RE-SPAWN the SAME submit after the delay instead of surfacing a terminal error.
      if (
        this.defaultSessionId !== undefined &&
        isAlreadyInUseError(`${stderr}\n${stdout}`)
      ) {
        const nextAttempt = (submit.inUseAttempts ?? 0) + 1
        const plan = planResumeRetry(this.defaultSessionId, nextAttempt, this.sessionLockEnv)
        if (plan.action === 'retry') {
          // Skip the normal error emission AND the drain for this attempt: re-run the SAME queued
          // item after the registry-release backoff.
          // session-id-already-in-use-runtime-v2: re-arm `running` BEFORE the setTimeout so the
          // runner stays "busy" during the backoff gap. Without this, `running` is false from
          // `finish()` above, and a concurrent `submit()` call during the gap spawns a SECOND
          // `claude --session-id <same-id>` child that collides with the pending retry — exactly
          // the collision the serializer was built to prevent. `spawnRun` re-sets `running` again
          // on entry (harmless double-set); no two children are ever alive at once.
          this.running = true
          setTimeout(() => {
            this.spawnRun({ ...submit, inUseAttempts: nextAttempt })
          }, plan.delayMs)
          return
        }
        // give-up: backoff budget exhausted and the id is still rejected — fall through to surface
        // the error and drain normally (the pre-fix behaviour).
      }
      this.sinks.onStatus({
        state: 'error',
        message: runErrorMessage(code, stdout, stderr)
      })
      this.drainQueue()
    })
  }

  /**
   * Start the next queued submit, if any (unified-agent-session-v1). Called once a run
   * frees the slot (`close`/`error`) or a spawn never started it. Only runs when idle,
   * so the conversation stays strictly sequential across ALL targets — one
   * `--session-id <id>` run at a time, never a collision.
   */
  private drainQueue(): void {
    if (this.running) {
      return
    }
    const next = this.queue.shift()
    if (next) {
      this.spawnRun(next)
    }
  }

  /**
   * Tear down (FR-006, reload/close/quit). Kill any in-flight child and clear
   * state so the runner does not leak. Detaches the child reference FIRST so the
   * `close`/`error` handlers do NOT emit a `completed`/`error` for a teardown
   * kill. NEVER touches the PTY (FR-008 — no PTY dependency exists).
   */
  dispose(): void {
    const active = this.child
    // Drop any queued submits (any target) so a teardown (reload/close/quit) does not
    // later fire a stale submit. Clearing BEFORE finish()'s drain path is
    // moot here (dispose never drains), but keeps teardown total.
    this.queue.length = 0
    this.finish()
    if (!active) {
      return
    }
    try {
      active.kill()
    } catch {
      // Already dead; nothing to do.
    }
  }

  /** Clear single-run state. */
  private finish(): void {
    this.running = false
    this.child = null
  }
}

/**
 * Combine the per-target grounding prompt and the per-run view-context clause into a single
 * `--append-system-prompt` string (open-prompt-view-context-v1, FR-007). Either may be
 * empty/undefined; returns the non-empty parts joined by a space, or '' when both are
 * absent (so the caller appends NO `--append-system-prompt` — baseline behaviour).
 */
function composeGroundingPrompt(
  groundingPrompt: string | undefined,
  viewContextClause: string
): string {
  return [groundingPrompt, viewContextClause].filter((p) => !!p && p.length > 0).join(' ')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Derive a human-readable error message for a non-zero run (FR-014). Prefers a
 * `result`/error string from the `--output-format json` stdout, then stderr, then
 * a generic exit-code message. Carries NO tokens/secrets — only the run's own
 * reported failure text (FR-011).
 */
function runErrorMessage(code: number | null, stdout: string, stderr: string): string {
  const fromJson = parseJsonResult(stdout)
  if (fromJson) {
    return fromJson
  }
  const trimmedErr = stderr.trim()
  if (trimmedErr.length > 0) {
    return trimmedErr
  }
  return `claude run exited with code ${code ?? 'unknown'}.`
}

/**
 * Best-effort extract of a human-readable message from the `--output-format json`
 * single-result object (e.g. `{ "is_error": true, "result": "..." }`). Returns
 * null when stdout is not parseable or carries no useful message.
 */
function parseJsonResult(stdout: string): string | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.result === 'string' && obj.result.trim().length > 0) {
        return obj.result
      }
      if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
        return obj.error
      }
    }
  } catch {
    // Not JSON (or partial) — fall back to stderr/exit code.
  }
  return null
}
