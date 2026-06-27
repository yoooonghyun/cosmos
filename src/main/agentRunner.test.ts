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
  defaultSessionId?: string
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
    resolveExecutable,
    ...(opts?.defaultSessionId ? { defaultSessionId: opts.defaultSessionId } : {})
  })
  return { runner, statuses, spawn, child, resolveExecutable }
}

/**
 * As makeRunner but each spawn returns a FRESH fake child (so a queued run gets its
 * own lifecycle). Records every spawned child in order. Used by the serialization tests.
 */
function makeSerialRunner(defaultSessionId: string): {
  runner: AgentRunner
  statuses: AgentStatusPayload[]
  spawn: ReturnType<typeof vi.fn>
  children: ReturnType<typeof makeFakeChild>[]
} {
  const children: ReturnType<typeof makeFakeChild>[] = []
  const spawn = vi.fn(() => {
    const c = makeFakeChild()
    children.push(c)
    return c
  }) as unknown as ReturnType<typeof vi.fn>
  const statuses: AgentStatusPayload[] = []
  const sinks: AgentRunnerSinks = { onStatus: (p) => statuses.push(p) }
  const runner = new AgentRunner(sinks, {
    sandboxDir: SANDBOX,
    spawn: spawn as unknown as SpawnFn,
    resolveExecutable: vi.fn(() => true),
    defaultSessionId
  })
  return { runner, statuses, spawn, children }
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
    // --allowedTools scoped to get_ui_catalog + render_ui (least-privilege — FR-013;
    // ui-catalog-pull-spinner-signal-v1 FR-009 adds the catalog tool grant).
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      'mcp__cosmos-render-ui__get_ui_catalog,mcp__cosmos-render-ui__render_ui'
    )
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
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
    // ui-catalog-pull-spinner-signal-v1 (FR-009): the jira get_ui_catalog grant is first, the
    // jira render tool follows (NOT the generic render_ui); least-privilege, FR-013.
    expect(allowed[0]).toBe('mcp__cosmos-jira-render-ui__get_ui_catalog')
    expect(allowed).toContain('mcp__cosmos-jira-render-ui__render_jira_ui')
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-jira-render-ui', 'cosmos-jira'])
  })

  it("a 'slack'-target run grants render_slack_ui + read-only slack tools and grounds the run (FR-008..FR-011)", () => {
    const h = makeRunner()
    h.runner.run('show #general', 'slack')

    const [, args] = h.spawn.mock.calls[0]
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
    // Catalog tool first (FR-009), then the render tool; read-only slack tools follow; NO
    // generic/jira/confluence render.
    expect(allowed[0]).toBe('mcp__cosmos-slack-render-ui__get_ui_catalog')
    expect(allowed).toContain('mcp__cosmos-slack-render-ui__render_slack_ui')
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
    expect(allowed[0]).toBe('mcp__cosmos-confluence-render-ui__get_ui_catalog')
    expect(allowed).toContain('mcp__cosmos-confluence-render-ui__render_confluence_ui')
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
    // ui-catalog-pull-spinner-signal-v1 (FR-009): the default grant now pairs get_ui_catalog
    // with the generic render tool.
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      'mcp__cosmos-render-ui__get_ui_catalog,mcp__cosmos-render-ui__render_ui'
    )
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-render-ui'])
  })
})

describe('AgentRunner.run — view-context grounding (open-prompt-view-context-v1)', () => {
  it('appends the view-context clause AND the per-target grounding into --append-system-prompt; -p stays the raw utterance (FR-007/SC-003)', () => {
    const h = makeRunner()
    h.runner.run('summarize this ticket', 'jira', { selectedIssueKey: 'PROJ-123' })

    const [, args] = h.spawn.mock.calls[0]
    // SC-003: the -p value is byte-for-byte the user's utterance (no id spliced in).
    expect(args[args.indexOf('-p') + 1]).toBe('summarize this ticket')
    // The system prompt carries BOTH the per-target grounding and the view-context clause.
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('PROJ-123')
    expect(prompt).toContain('Jira') // per-target grounding still present
  })

  it('threads a slack channel + thread into the grounding clause', () => {
    const h = makeRunner()
    h.runner.run('what was decided here', 'slack', {
      selectedChannelId: 'C1',
      selectedChannelName: 'general',
      threadTs: '1700000000.0001'
    })
    const [, args] = h.spawn.mock.calls[0]
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('C1')
    expect(prompt).toContain('1700000000.0001')
  })

  it('does NOT change --allowedTools or --mcp-config when a viewContext is supplied (SC-006)', () => {
    const withCtx = makeRunner()
    withCtx.runner.run('x', 'jira', { selectedIssueKey: 'PROJ-1' })
    const [, ctxArgs] = withCtx.spawn.mock.calls[0]

    const withoutCtx = makeRunner()
    withoutCtx.runner.run('x', 'jira')
    const [, baselineArgs] = withoutCtx.spawn.mock.calls[0]

    expect(ctxArgs[ctxArgs.indexOf('--allowedTools') + 1]).toBe(
      baselineArgs[baselineArgs.indexOf('--allowedTools') + 1]
    )
    expect(ctxArgs[ctxArgs.indexOf('--mcp-config') + 1]).toBe(
      baselineArgs[baselineArgs.indexOf('--mcp-config') + 1]
    )
  })

  it('behaves exactly as baseline when viewContext is omitted (no extra prompt content)', () => {
    const h = makeRunner()
    h.runner.run('show #general', 'slack')
    const [, args] = h.spawn.mock.calls[0]
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    // Only the per-target grounding, no view-context clause (no channel id present).
    expect(prompt).toContain('Slack')
    expect(prompt).not.toContain('currently viewing')
  })

  it('generated-ui carries the catalog-pull grounding (ui-catalog-pull-spinner-signal-v1 FR-009) but no view-context clause', () => {
    // generated-ui never carries a viewContext (FR-003). It DOES now carry the catalog-pull
    // ordering steering (previously it had no grounding at all), so --append-system-prompt is
    // present and contains the get_ui_catalog instruction but not a view-context clause.
    const h = makeRunner()
    h.runner.run('build a form', 'generated-ui', { selectedIssueKey: 'PROJ-1' })
    const [, args] = h.spawn.mock.calls[0]
    expect(args).toContain('--append-system-prompt')
    const prompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(prompt).toContain('get_ui_catalog')
    expect(prompt).not.toContain('currently viewing')
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

describe('AgentRunner.run — in-flight guard (unified-agent-session-v1: serialize, never overlap)', () => {
  it('does not spawn a second child while a run is in flight (the second submit is queued, not concurrent)', () => {
    // makeRunner reuses ONE fake child, so this asserts the in-flight guard only:
    // no second spawn while busy. (FIFO drain is exercised with makeSerialRunner below.)
    const h = makeRunner({ defaultSessionId: 'cosmos-default-id' })
    h.runner.run('first')
    h.runner.run('second')

    expect(h.spawn).toHaveBeenCalledTimes(1)
    // Only one started emitted — the second submit is queued, not run concurrently.
    expect(h.statuses.filter((s) => s.state === 'started')).toHaveLength(1)

    // After the first run completes, the queued submit drains and spawns.
    h.child.emit('close', 0)
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

describe('AgentRunner — persistent default session id (cosmos-conversation-panel-v1 step 2)', () => {
  it('passes --session-id <persistedId> for the DEFAULT target so the conversation is continuous', () => {
    const h = makeRunner({ defaultSessionId: 'cosmos-default-id' })
    h.runner.run('build a form') // default target = generated-ui
    const [, args] = h.spawn.mock.calls[0]
    expect(args[args.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    // Still JSON output (the result/structured output is preserved).
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
  })

  it('reuses the SAME --session-id across sequential default runs (continuity within a launch)', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('first')
    s.children[0].emit('close', 0) // first completes
    s.runner.run('second')
    const [, firstArgs] = s.spawn.mock.calls[0]
    const [, secondArgs] = s.spawn.mock.calls[1]
    expect(firstArgs[firstArgs.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    expect(secondArgs[secondArgs.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
  })

  it('passes the SAME --session-id for a NON-default target (unified-agent-session-v1 FR-001) — integrations now accumulate in the one conversation', () => {
    // The core change: a non-default target (jira/slack/confluence/calendar) USED to run
    // ephemerally (no --session-id); now every target runs against the one persistent
    // session so the Cosmos panel records it.
    for (const target of ['jira', 'slack', 'confluence', 'google-calendar'] as const) {
      const h = makeRunner({ defaultSessionId: 'cosmos-default-id' })
      h.runner.run('show me things', target)
      const [, args] = h.spawn.mock.calls[0]
      expect(args[args.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    }
  })

  it('uses the session id for a non-default target WITHOUT broadening its tool grants (session decoupled from target — FR-002/FR-007)', () => {
    // FR-007 guard: unifying the session must NOT change the per-target least-privilege grants.
    const h = makeRunner({ defaultSessionId: 'cosmos-default-id' })
    h.runner.run('show my issues', 'jira')
    const [, args] = h.spawn.mock.calls[0]
    expect(args[args.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    const allowed = args[args.indexOf('--allowedTools') + 1].split(',')
    // Still the jira-only render grant; no generic render_ui leaked in by the unification.
    expect(allowed).toContain('mcp__cosmos-jira-render-ui__render_jira_ui')
    expect(allowed).not.toContain('mcp__cosmos-render-ui__render_ui')
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1])
    expect(Object.keys(mcpConfig.mcpServers)).toEqual(['cosmos-jira-render-ui', 'cosmos-jira'])
  })

  it('does NOT pass --session-id when no defaultSessionId is configured (pre-feature ephemeral behaviour)', () => {
    const h = makeRunner()
    h.runner.run('build a form')
    const [, args] = h.spawn.mock.calls[0]
    expect(args).not.toContain('--session-id')
  })
})

describe('AgentRunner — submit serialization for the default conversation (step 2)', () => {
  it('QUEUES a default submit while busy and spawns it when the in-flight run completes (no drop, no collision)', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('first')
    expect(s.spawn).toHaveBeenCalledTimes(1)

    // A second default submit while the first is in flight is QUEUED, not spawned, not dropped.
    s.runner.run('second')
    expect(s.spawn).toHaveBeenCalledTimes(1)

    // When the first run closes, the queued run starts — strictly sequential.
    s.children[0].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(2)
    // The queued run carried the second utterance and the SAME session id.
    const [, secondArgs] = s.spawn.mock.calls[1]
    expect(secondArgs[secondArgs.indexOf('-p') + 1]).toBe('second')
    expect(secondArgs[secondArgs.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
  })

  it('drains multiple queued submits in FIFO order, one at a time', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('a')
    s.runner.run('b')
    s.runner.run('c')
    expect(s.spawn).toHaveBeenCalledTimes(1) // only the first spawned; b, c queued

    s.children[0].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(2) // b starts
    expect(s.spawn.mock.calls[1][1][s.spawn.mock.calls[1][1].indexOf('-p') + 1]).toBe('b')

    s.children[1].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(3) // c starts
    expect(s.spawn.mock.calls[2][1][s.spawn.mock.calls[2][1].indexOf('-p') + 1]).toBe('c')
  })

  it('starts the queued run even when the in-flight run FAILS (a failed run never strands the conversation)', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('first')
    s.runner.run('second')
    // First run fails (non-zero exit) — the queue still drains.
    s.children[0].emit('close', 1)
    expect(s.spawn).toHaveBeenCalledTimes(2)
    expect(s.statuses.some((st) => st.state === 'error')).toBe(true)
  })

  it('dispose() clears the queue so a teardown does not later fire a stale queued submit', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('first')
    s.runner.run('queued') // queued behind the in-flight run
    s.runner.dispose() // kills the in-flight child AND clears the queue

    // The disposed child's late close must not drain a now-cleared queue into a new spawn.
    s.children[0].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(1)
  })

  it('ENQUEUES a NON-default submit while busy and drains it after the in-flight run (FR-004/FR-005) — the bug fix: it was dropped before', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('first') // default (generated-ui), in flight
    // A jira submit while busy is now QUEUED (was dropped) — so the integration
    // conversation is never lost and accumulates in the one session.
    s.runner.run('show issues', 'jira', { selectedIssueKey: 'PROJ-9' })
    expect(s.spawn).toHaveBeenCalledTimes(1) // not spawned yet, but not dropped

    s.children[0].emit('close', 0) // first completes -> queued jira run starts
    expect(s.spawn).toHaveBeenCalledTimes(2)
    const [, jiraArgs] = s.spawn.mock.calls[1]
    // The drained run kept its own target (jira grants) AND view-context (FR-006)
    // AND ran on the SAME session id (FR-001).
    expect(jiraArgs[jiraArgs.indexOf('-p') + 1]).toBe('show issues')
    expect(jiraArgs[jiraArgs.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    expect(jiraArgs[jiraArgs.indexOf('--allowedTools') + 1]).toContain('render_jira_ui')
    expect(jiraArgs[jiraArgs.indexOf('--append-system-prompt') + 1]).toContain('PROJ-9')
  })

  it('drains interleaved multi-TARGET submits FIFO and never spawns two children concurrently (SC-003)', () => {
    const s = makeSerialRunner('cosmos-default-id')
    s.runner.run('a', 'generated-ui')
    s.runner.run('b', 'jira')
    s.runner.run('c', 'slack')
    // Only one in-flight child at any time — the others are queued, never overlapping.
    expect(s.spawn).toHaveBeenCalledTimes(1)
    expect(s.children).toHaveLength(1)

    s.children[0].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(2) // b (jira) starts
    expect(s.children).toHaveLength(2)
    expect(s.spawn.mock.calls[1][1][s.spawn.mock.calls[1][1].indexOf('-p') + 1]).toBe('b')

    s.children[1].emit('close', 0)
    expect(s.spawn).toHaveBeenCalledTimes(3) // c (slack) starts
    expect(s.spawn.mock.calls[2][1][s.spawn.mock.calls[2][1].indexOf('-p') + 1]).toBe('c')

    // Every run used the one shared session id (no collision possible — SC-003).
    for (const call of s.spawn.mock.calls) {
      const args = call[1] as string[]
      expect(args[args.indexOf('--session-id') + 1]).toBe('cosmos-default-id')
    }
  })
})
