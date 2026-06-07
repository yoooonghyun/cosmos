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
import { DEFAULT_UI_RENDER_TARGET, type AgentStatusPayload, type UiRenderTarget } from '../shared/ipc'

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
}

export class AgentRunner {
  private readonly sinks: AgentRunnerSinks
  private readonly sandboxDir: string
  private readonly command: string
  private readonly spawn: SpawnFn
  private readonly resolveExecutable: (command: string) => boolean

  /** The in-flight child, or null when idle (single-run state). */
  private child: ChildProcess | null = null
  /** True while a run is in flight (single-run guard). */
  private running = false

  constructor(sinks: AgentRunnerSinks, options: AgentRunnerOptions) {
    this.sinks = sinks
    this.sandboxDir = options.sandboxDir
    this.command = options.command ?? 'claude'
    this.spawn = options.spawn ?? nodeSpawn
    this.resolveExecutable = options.resolveExecutable ?? isExecutableResolvable
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
   */
  run(utterance: string, target: UiRenderTarget = DEFAULT_UI_RENDER_TARGET): void {
    // Single-run / blocked-while-running: ignore a submit while busy.
    if (this.running) {
      return
    }

    // Defense in depth — the renderer + validator already guard FR-004.
    if (utterance.trim().length === 0) {
      return
    }

    // Electron PATH caveat: a GUI-launched app may not inherit the shell PATH, so
    // `claude` may be unresolvable. Pre-check and fail fast with an `error` status
    // rather than spawning a missing binary (FR-014).
    if (!this.resolveExecutable(this.command)) {
      this.sinks.onStatus({
        state: 'error',
        message: `"${this.command}" was not found on PATH. Install Claude Code or ensure it is on PATH.`
      })
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

    // Per-target grounding (jira): force the run to render only REAL fetched tickets and
    // never fabricate, since the render tool's description carries a placeholder example.
    const groundingPrompt = groundingPromptForTarget(target)
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
    })
  }

  /**
   * Tear down (FR-006, reload/close/quit). Kill any in-flight child and clear
   * state so the runner does not leak. Detaches the child reference FIRST so the
   * `close`/`error` handlers do NOT emit a `completed`/`error` for a teardown
   * kill. NEVER touches the PTY (FR-008 — no PTY dependency exists).
   */
  dispose(): void {
    const active = this.child
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
