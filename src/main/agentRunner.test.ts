import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { AgentRunner, type AgentRunnerSinks, type SpawnFn } from './agentRunner'
import type { AgentStatusPayload } from '../shared/ipc'

/**
 * A fake `ChildProcess` for the injected spawn: an EventEmitter with `stdout` /
 * `stderr` emitters and a `kill` spy. Tests drive the lifecycle by emitting
 * `close` / `error` / data on these.
 */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

interface Harness {
  runner: AgentRunner
  statuses: AgentStatusPayload[]
  spawn: ReturnType<typeof vi.fn>
  child: ReturnType<typeof makeFakeChild>
  resolveExecutable: ReturnType<typeof vi.fn>
}

const SANDBOX = '/tmp/cosmos-sandbox'

function makeRunner(opts?: {
  resolvable?: boolean
  spawnThrows?: boolean
}): Harness {
  const child = makeFakeChild()
  const spawn = vi.fn(() => {
    if (opts?.spawnThrows) {
      throw new Error('spawn EACCES')
    }
    return child
  }) as unknown as ReturnType<typeof vi.fn>
  const resolveExecutable = vi.fn(() => opts?.resolvable ?? true)
  const statuses: AgentStatusPayload[] = []
  const sinks: AgentRunnerSinks = { onStatus: (p) => statuses.push(p) }
  const runner = new AgentRunner(sinks, {
    sandboxDir: SANDBOX,
    spawn: spawn as unknown as SpawnFn,
    resolveExecutable
  })
  return { runner, statuses, spawn, child, resolveExecutable }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentRunner.run — happy path (SC-001, FR-005, FR-007, FR-011, FR-013)', () => {
  it('spawns claude with the correct argv and emits started then completed on exit 0', () => {
    const h = makeRunner()
    h.runner.run('Build me a login form')

    // (a) spawned exactly once with the headless claude argv.
    expect(h.spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = h.spawn.mock.calls[0]
    expect(command).toBe('claude')
    expect(args).toContain('-p')
    expect(args).toContain('Build me a login form')
    expect(args).toContain('--mcp-config')
    expect(args).toContain('--strict-mcp-config')
    // --permission-mode dontAsk (flag immediately followed by value).
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    // --allowedTools scoped to ONLY render_ui (least-privilege — FR-013).
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__cosmos-render-ui__render_ui')
    // --output-format json so completion/error are detectable.
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')

    // the --mcp-config value is the render_ui-only single-server config (FR-013).
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-render-ui'])

    // cwd is the sandbox; env inherits process.env; NO injected key/token (FR-005).
    expect(options.cwd).toBe(SANDBOX)
    expect(options.env).toBe(process.env)

    // started emitted on spawn; isRunning true during the run.
    expect(h.statuses).toEqual([{ state: 'started' }])
    expect(h.runner.isRunning).toBe(true)

    // exit 0 -> completed; isRunning false after.
    h.child.stdout.emit('data', '{"is_error":false,"result":"done"}')
    h.child.emit('close', 0)
    expect(h.statuses).toEqual([{ state: 'started' }, { state: 'completed' }])
    expect(h.runner.isRunning).toBe(false)
  })

  it("a 'jira'-target run grants the jira render tool + jira tools and registers both jira servers (v2 D2)", () => {
    const h = makeRunner()
    h.runner.run('show my issues', 'jira')

    const [, args] = h.spawn.mock.calls[0]
    // least-privilege: the jira render tool first (NOT the generic render_ui), FR-013.
    expect(args[args.indexOf('--allowedTools') + 1].split(',')[0]).toBe(
      'mcp__cosmos-jira-render-ui__render_jira_ui'
    )
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-jira-render-ui', 'cosmos-jira'])
  })

  it("a 'slack'-target run grants render_slack_ui + read-only slack tools and grounds the run (FR-008..FR-011)", () => {
    const h = makeRunner()
    h.runner.run('show #general', 'slack')

    const [, args] = h.spawn.mock.calls[0]
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
    // Render tool first; read-only slack tools follow; NO generic/jira/confluence render.
    expect(allowed[0]).toBe('mcp__cosmos-slack-render-ui__render_slack_ui')
    expect(allowed).not.toContain('mcp__cosmos-render-ui__render_ui')
    expect(allowed.some((t: string) => t.includes('cosmos-jira'))).toBe(false)
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-slack-render-ui', 'cosmos-slack'])
    // A read-only run is grounded against fabrication (FR-011).
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('Slack')
  })

  it("a 'confluence'-target run grants render_confluence_ui + read-only confluence tools and grounds the run", () => {
    const h = makeRunner()
    h.runner.run('find onboarding docs', 'confluence')

    const [, args] = h.spawn.mock.calls[0]
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
    expect(allowed[0]).toBe('mcp__cosmos-confluence-render-ui__render_confluence_ui')
    expect(allowed).not.toContain('mcp__cosmos-render-ui__render_ui')
    expect(allowed.some((t: string) => t.includes('cosmos-slack'))).toBe(false)
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual([
      'cosmos-confluence-render-ui',
      'cosmos-confluence'
    ])
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('Confluence')
  })

  it("an omitted target defaults to the 'generated-ui' grant (backward-compatible)", () => {
    const h = makeRunner()
    h.runner.run('build a form')
    const [, args] = h.spawn.mock.calls[0]
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__cosmos-render-ui__render_ui')
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-render-ui'])
  })
})

describe('AgentRunner.run — error paths (FR-014)', () => {
  it('emits error with a message when the child exits non-zero', () => {
    const h = makeRunner()
    h.runner.run('do a thing')
    h.child.stderr.emit('data', 'Invalid API key · not logged in')
    h.child.emit('close', 1)

    expect(h.statuses[0]).toEqual({ state: 'started' })
    expect(h.statuses[1].state).toBe('error')
    expect(h.statuses[1].message).toContain('not logged in')
    expect(h.runner.isRunning).toBe(false)
  })

  it('prefers the json "result" message on a non-zero exit', () => {
    const h = makeRunner()
    h.runner.run('do a thing')
    h.child.stdout.emit('data', '{"is_error":true,"result":"the model refused"}')
    h.child.emit('close', 2)

    expect(h.statuses[1].state).toBe('error')
    expect(h.statuses[1].message).toBe('the model refused')
  })

  it('emits error on a spawn "error" event (spawn failure) without throwing', () => {
    const h = makeRunner()
    expect(() => h.runner.run('x')).not.toThrow()
    h.child.emit('error', new Error('ENOENT'))

    expect(h.statuses[0]).toEqual({ state: 'started' })
    expect(h.statuses[1].state).toBe('error')
    expect(h.statuses[1].message).toContain('ENOENT')
    expect(h.runner.isRunning).toBe(false)
  })

  it('emits error and does NOT spawn when the claude binary is unresolvable (Electron PATH caveat)', () => {
    const h = makeRunner({ resolvable: false })
    h.runner.run('x')

    expect(h.spawn).not.toHaveBeenCalled()
    expect(h.statuses).toHaveLength(1)
    expect(h.statuses[0].state).toBe('error')
    expect(h.statuses[0].message).toContain('PATH')
    expect(h.runner.isRunning).toBe(false)
  })

  it('emits error and does not throw when spawn throws synchronously', () => {
    const h = makeRunner({ spawnThrows: true })
    expect(() => h.runner.run('x')).not.toThrow()
    expect(h.statuses).toHaveLength(1)
    expect(h.statuses[0].state).toBe('error')
    expect(h.runner.isRunning).toBe(false)
  })
})

describe('AgentRunner.run — single-run guard (spec Resolved Decision: blocked-while-running)', () => {
  it('ignores a second run while a run is in flight (no second spawn)', () => {
    const h = makeRunner()
    h.runner.run('first')
    h.runner.run('second')

    expect(h.spawn).toHaveBeenCalledTimes(1)
    // Only one started emitted (the second submit was ignored).
    expect(h.statuses.filter((s) => s.state === 'started')).toHaveLength(1)

    // After the first run completes, a new run is allowed again.
    h.child.emit('close', 0)
    h.runner.run('third')
    expect(h.spawn).toHaveBeenCalledTimes(2)
  })

  it('does not spawn for an empty/whitespace utterance (defense in depth — FR-004)', () => {
    const h = makeRunner()
    h.runner.run('   ')
    expect(h.spawn).not.toHaveBeenCalled()
    expect(h.statuses).toHaveLength(0)
  })
})

describe('AgentRunner.dispose — teardown (FR-006, reload/close/quit)', () => {
  it('kills the in-flight child, clears state, and does NOT emit completed/error', () => {
    const h = makeRunner()
    h.runner.run('long run')
    expect(h.runner.isRunning).toBe(true)

    h.runner.dispose()
    expect(h.child.kill).toHaveBeenCalledTimes(1)
    expect(h.runner.isRunning).toBe(false)

    // A late close from the killed child must NOT emit a terminal status.
    h.child.emit('close', 0)
    expect(h.statuses).toEqual([{ state: 'started' }])
  })

  it('is a no-op when idle (no child to kill)', () => {
    const h = makeRunner()
    expect(() => h.runner.dispose()).not.toThrow()
    expect(h.statuses).toHaveLength(0)
  })
})
