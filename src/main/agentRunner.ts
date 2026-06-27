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
 * Concurrency is single-run / blocked-while-running (spec Resolved Decision): a
 * `run()` received while a run is in flight is ignored.
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
import { decideSubmit, isPersistentSessionTarget } from './agentSessionQueue'
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
   * cosmos-conversation-panel-v1 (step 2): the PERSISTENT, create-or-continue
   * session id for the DEFAULT conversation (the `'generated-ui'` wire target the
   * Cosmos panel hosts). When set, every default-target run passes
   * `--session-id <this>` so the conversation is CONTINUOUS (each submit builds on
   * the prior context) and `claude` RECORDS the transcript jsonl on disk; the
   * caller persists this id so it survives relaunch. Omit (undefined) to keep the
   * pre-feature ephemeral behaviour. NON-DEFAULT targets never use it.
   */
  defaultSessionId?: string
}

/** One queued default-conversation submit, awaiting the in-flight run to finish. */
interface QueuedSubmit {
  utterance: string
  target: UiRenderTarget
  viewContext?: ViewContext
}

export class AgentRunner {
  private readonly sinks: AgentRunnerSinks
  private readonly sandboxDir: string
  private readonly command: string
  private readonly spawn: SpawnFn
  private readonly resolveExecutable: (command: string) => boolean
  /** Persistent default-conversation session id, or undefined (ephemeral). */
  private readonly defaultSessionId?: string

  /** The in-flight child, or null when idle (single-run state). */
  private child: ChildProcess | null = null
  /** True while a run is in flight (single-run guard). */
  private running = false
  /**
   * FIFO of default-conversation submits waiting for the in-flight run to finish
   * (cosmos-conversation-panel-v1 step 2). A continuous conversation is sequential,
   * so default-target submits SERIALIZE here instead of being dropped — drained one
   * at a time as each run completes, so two `claude -p --session-id <same id>` never
   * collide. Non-default targets are never enqueued (today's drop-while-busy).
   */
  private readonly queue: QueuedSubmit[] = []

  constructor(sinks: AgentRunnerSinks, options: AgentRunnerOptions) {
    this.sinks = sinks
    this.sandboxDir = options.sandboxDir
    this.command = options.command ?? 'claude'
    this.spawn = options.spawn ?? nodeSpawn
    this.resolveExecutable = options.resolveExecutable ?? isExecutableResolvable
    this.defaultSessionId = options.defaultSessionId
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
   * `render_ui`. Least-privilege per run; the single-run guard is unchanged.
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

    // cosmos-conversation-panel-v1 (step 2): a submit while busy is QUEUED for the
    // default (persistent-session) conversation — it is one continuous, sequential
    // conversation, so it must not collide on `--session-id` nor be silently dropped.
    // Any other target keeps today's blocked-while-busy DROP. Idle → spawn now.
    const decision = decideSubmit({
      running: this.running,
      isPersistentTarget: this.usesPersistentSession(target)
    })
    if (decision.action === 'drop') {
      return
    }
    if (decision.action === 'enqueue') {
      this.queue.push({ utterance, target, viewContext })
      return
    }
    this.spawnRun({ utterance, target, viewContext })
  }

  /** True when this run uses the persistent default-conversation session id. */
  private usesPersistentSession(target: UiRenderTarget): boolean {
    return this.defaultSessionId !== undefined && isPersistentSessionTarget(target)
  }

  /**
   * Spawn ONE `claude -p` run (the body extracted from {@link run} so the queue can
   * re-invoke it). Assumes the busy/queue decision has already cleared this submit
   * to start now. A pre-check / spawn failure emits `error` and drains the queue so
   * a queued conversation never stalls behind a failed run.
   */
  private spawnRun({ utterance, target, viewContext }: QueuedSubmit): void {
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

    // cosmos-conversation-panel-v1 (step 2): the DEFAULT conversation passes a
    // PERSISTENT `--session-id` so the FIRST run creates the session and every later
    // run (this launch AND after relaunch) CONTINUES it — continuous context + a
    // recorded transcript jsonl. `--session-id <id>` is create-or-continue, the same
    // flag the terminal pane-spawn reuse uses. Non-default targets stay ephemeral.
    if (this.usesPersistentSession(target)) {
      args.push('--session-id', this.defaultSessionId as string)
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
      // The slot never became busy; drain any queued default-conversation submit
      // so a failed spawn does not strand the conversation.
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
      } else {
        this.sinks.onStatus({
          state: 'error',
          message: runErrorMessage(code, stdout, stderr)
        })
      }
      // cosmos-conversation-panel-v1 (step 2): the run finished and freed the slot —
      // start the next queued default-conversation submit (if any), serializing so
      // two `--session-id <same id>` runs never overlap.
      this.drainQueue()
    })
  }

  /**
   * Start the next queued default-conversation submit, if any (cosmos-conversation-
   * panel-v1 step 2). Called once a run frees the slot (`close`/`error`) or a spawn
   * never started it. Only runs when idle, so the conversation stays strictly
   * sequential — one `--session-id <id>` run at a time, never a collision.
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
    // Drop any queued default-conversation submits so a teardown (reload/close/quit)
    // does not later fire a stale submit. Clearing BEFORE finish()'s drain path is
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
