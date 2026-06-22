/**
 * UiBridge settle-by-target tests (Slack + Confluence generative-UI v1, FR-014).
 *
 * The behavior under test: a render frame whose `target` is NOT `'generated-ui'`
 * (`'jira'`, `'slack'`, `'confluence'`) is DISPLAY-ONLY from the composing run's
 * perspective, so main must settle the pending tool call IMMEDIATELY (with a `cancel`
 * action) — otherwise the one-shot headless run blocks forever on `await
 * bridge.render()` and the panel spinner never stops. A `'generated-ui'` frame keeps
 * blocking, awaiting the user's action on its control.
 *
 * These exercise the real socket path (`onMessage`) end-to-end: a fake entry script
 * connects to the bridge socket, sends a render frame, and asserts whether a `result`
 * frame comes back. `pushRender` is captured so we also assert the surface is pushed
 * to the renderer regardless of target.
 */

import { connect, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UiBridge } from './uiBridge'
import {
  bridgeSocketPath,
  encodeBridgeMessage,
  type BridgeRenderRequest,
  type BridgeServerMessage
} from '../shared/bridge'
import type { A2uiSurfaceUpdate, UiRenderPayload, UiRenderTarget } from '../shared/ipc'

/** Open a client socket to the bridge and resolve once connected. */
function dial(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    socket.setEncoding('utf8')
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

/**
 * Send a render frame and wait up to `timeoutMs` for a `result` frame. Resolves the
 * result (or null if none arrives in time — meaning the call is still pending).
 */
function renderAndAwaitResult(
  socket: Socket,
  frame: BridgeRenderRequest,
  timeoutMs = 250
): Promise<BridgeServerMessage | null> {
  return new Promise((resolve) => {
    let buffer = ''
    const onData = (chunk: string): void => {
      buffer += chunk
      const nl = buffer.indexOf('\n')
      if (nl >= 0) {
        const line = buffer.slice(0, nl)
        cleanup()
        resolve(JSON.parse(line) as BridgeServerMessage)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      socket.off('data', onData)
    }
    socket.on('data', onData)
    socket.write(encodeBridgeMessage(frame))
  })
}

function makeFrame(target: UiRenderTarget | undefined, callId: string): BridgeRenderRequest {
  const base = {
    kind: 'render' as const,
    callId,
    spec: { surfaceId: `${target ?? 'default'}-surface`, components: [{ id: 'root', component: 'Text' }] }
  }
  return target ? { ...base, target } : base
}

describe('UiBridge — settle-by-target (FR-014)', () => {
  let dir: string
  let bridge: UiBridge
  let pushed: UiRenderPayload[]
  let socket: Socket | null = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-uibridge-'))
    pushed = []
    bridge = new UiBridge({
      projectDir: dir,
      pushRender: (p) => pushed.push(p),
      warn: vi.fn()
    })
    bridge.start()
  })

  afterEach(() => {
    socket?.destroy()
    socket = null
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it("settles a 'slack' frame immediately with a cancel action (display-only)", async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(socket, makeFrame('slack', 'c-slack'))
    expect(result).not.toBeNull()
    expect(result?.kind).toBe('result')
    expect(result?.callId).toBe('c-slack')
    expect(result?.action).toEqual({ type: 'cancel' })
    // The surface is still pushed to the renderer (the panel renders it).
    expect(pushed).toHaveLength(1)
    expect(pushed[0].target).toBe('slack')
  })

  it("settles a 'confluence' frame immediately with a cancel action (display-only)", async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(socket, makeFrame('confluence', 'c-conf'))
    expect(result?.kind).toBe('result')
    expect(result?.callId).toBe('c-conf')
    expect(result?.action).toEqual({ type: 'cancel' })
    expect(pushed[0].target).toBe('confluence')
  })

  it("does NOT settle a 'generated-ui' frame — the call stays pending awaiting a user action", async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(socket, makeFrame('generated-ui', 'c-gen'))
    // No result frame within the window => the call is still blocking (correct).
    expect(result).toBeNull()
    // The surface was still pushed (the panel shows the interactive control).
    expect(pushed).toHaveLength(1)
    expect(pushed[0].target).toBe('generated-ui')
  })

  it('an omitted target defaults to generated-ui and likewise stays pending', async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(socket, makeFrame(undefined, 'c-default'))
    expect(result).toBeNull()
    expect(pushed[0].target).toBe('generated-ui')
  })
})

/**
 * UiBridge — register-the-agent-surface (refreshable-custom-generative-ui-v1).
 *
 * The behavior under test: when a render frame carries a secret-free descriptor, main calls
 * the injected `registerAgentSurface(descriptor, agentSpec, target)` and pushes the spec it
 * returns. The renderer-facing `descriptor` is forwarded ONLY when something was registered
 * (so the panel refresh control enables for a refreshable tab). These exercise the real socket
 * path; `registerAgentSurface` is a spy whose return we vary to cover each FR branch. A 'jira'
 * target is used so the frame settles immediately (the spy is still invoked first).
 */
describe('UiBridge — registerAgentSurface (FR-001/FR-006/FR-007/FR-008)', () => {
  let dir: string
  let bridge: UiBridge
  let pushed: UiRenderPayload[]
  let warn: ReturnType<typeof vi.fn>
  let socket: Socket | null = null

  const AGENT_SPEC = {
    surfaceId: 'jira-kanban-7',
    components: [{ id: 'root', component: 'IssueList' }]
  }
  const SHELL_SPEC = {
    surfaceId: 'jira-issue-list',
    components: [{ id: 'root', component: 'IssueList' }]
  }

  /** A 'jira'-target render frame carrying `spec` + optional `descriptor`. */
  function boundFrame(
    callId: string,
    spec: unknown,
    descriptor?: unknown
  ): BridgeRenderRequest {
    return {
      kind: 'render',
      callId,
      target: 'jira',
      spec: spec as BridgeRenderRequest['spec'],
      ...(descriptor !== undefined ? { descriptor: descriptor as BridgeRenderRequest['descriptor'] } : {})
    }
  }

  type RegisterFn = (
    d: { dataSource: string; query: Record<string, unknown> },
    s: { surfaceId?: string; components?: unknown },
    t: UiRenderTarget
  ) => { spec: { surfaceId: string }; registered: boolean }

  function makeBridge(registerAgentSurface?: RegisterFn): void {
    warn = vi.fn()
    bridge = new UiBridge({
      projectDir: dir,
      pushRender: (p) => pushed.push(p),
      warn: warn as never,
      // cast: the test fakes the dispatcher-backed dep with a plain spy.
      registerAgentSurface: registerAgentSurface as never
    })
    bridge.start()
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-uibridge-reg-'))
    pushed = []
  })

  afterEach(() => {
    socket?.destroy()
    socket = null
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('FR-001: a descriptor + usable agent spec → pushes the AGENT spec + forwards the descriptor', async () => {
    const register = vi.fn<RegisterFn>(() => ({ spec: AGENT_SPEC, registered: true }))
    makeBridge(register)
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      boundFrame('c1', AGENT_SPEC, { dataSource: 'searchIssues', query: { jql: 'x' } })
    )
    // The helper was called with the validated descriptor + the AGENT's own spec.
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toEqual({ dataSource: 'searchIssues', query: { jql: 'x' } })
    expect((register.mock.calls[0][1] as { surfaceId: string }).surfaceId).toBe('jira-kanban-7')
    // Main pushed the AGENT's spec (NOT a substituted shell), with the descriptor forwarded.
    expect(pushed).toHaveLength(1)
    expect(pushed[0].spec.surfaceId).toBe('jira-kanban-7')
    expect(pushed[0].descriptor).toEqual({ dataSource: 'searchIssues', query: { jql: 'x' } })
  })

  it('FR-006: a descriptor + UNUSABLE spec → pushes the SHELL the helper returns', async () => {
    // The helper does the usable-vs-shell decision; here it returns the shell + registered.
    const register = vi.fn<RegisterFn>(() => ({ spec: SHELL_SPEC, registered: true }))
    makeBridge(register)
    socket = await dial(bridgeSocketPath(dir))
    // An unusable agent spec (no components) still passes the bridge's surfaceId check;
    // the helper decides. We assert the bridge pushes whatever the helper returned.
    await renderAndAwaitResult(
      socket,
      boundFrame('c2', { surfaceId: 'agent-x', components: [] }, { dataSource: 'searchIssues', query: {} })
    )
    expect(pushed[0].spec.surfaceId).toBe('jira-issue-list')
    expect(pushed[0].descriptor).toEqual({ dataSource: 'searchIssues', query: {} })
  })

  it('FR-015: registered:false → pushes the agent spec WITHOUT a descriptor (un-refreshable)', async () => {
    // The helper signals "nothing registered" (e.g. an unknown dataSource its resolver
    // does not claim). The bridge must still push the agent's spec but NOT forward the
    // descriptor, so the panel refresh control stays disabled for the tab. A valid jira
    // source is used so validateAdapterDescriptor passes and the helper is reached.
    const register = vi.fn<RegisterFn>(() => ({ spec: AGENT_SPEC, registered: false }))
    makeBridge(register)
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      boundFrame('c3', AGENT_SPEC, { dataSource: 'searchIssues', query: {} })
    )
    expect(register).toHaveBeenCalledTimes(1)
    expect(pushed[0].spec.surfaceId).toBe('jira-kanban-7')
    // Nothing registered ⇒ the descriptor is NOT forwarded (the tab stays un-refreshable).
    expect(pushed[0].descriptor).toBeUndefined()
  })

  it('FR-007: NO descriptor → the helper is never called; the agent spec is pushed unchanged', async () => {
    const register = vi.fn<RegisterFn>(() => ({ spec: SHELL_SPEC, registered: true }))
    makeBridge(register)
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(socket, boundFrame('c4', AGENT_SPEC))
    expect(register).not.toHaveBeenCalled()
    expect(pushed[0].spec.surfaceId).toBe('jira-kanban-7')
    expect(pushed[0].descriptor).toBeUndefined()
  })

  it('FR-008: an invalid (non-object) descriptor → warned + ignored; helper never called', async () => {
    const register = vi.fn<RegisterFn>(() => ({ spec: AGENT_SPEC, registered: true }))
    makeBridge(register)
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(socket, boundFrame('c5', AGENT_SPEC, 'not-an-object'))
    expect(register).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    // The agent's spec still renders, un-refreshably (no descriptor forwarded).
    expect(pushed[0].spec.surfaceId).toBe('jira-kanban-7')
    expect(pushed[0].descriptor).toBeUndefined()
  })
})

/**
 * UiBridge — no-binding dev warning (bindings-first-generative-ui-v1, FR-008/FR-009).
 *
 * The behavior under test: when a render frame carries NEITHER `bindings` NOR `descriptor` yet
 * its spec paints integration data (a known list rows prop / bound detail prop), main emits ONE
 * informational dev warning and STILL pushes the surface unchanged — it is warn-and-continue, so
 * the render is never blocked or altered. A frame with a descriptor/bindings, or a purely static
 * spec, must NOT trigger the no-binding warning. A 'jira' target settles immediately.
 */
describe('UiBridge — no-binding dev warning (FR-008/FR-009)', () => {
  let dir: string
  let bridge: UiBridge
  let pushed: UiRenderPayload[]
  let warn: ReturnType<typeof vi.fn>
  let socket: Socket | null = null

  /** A spec whose IssueList carries a literal-array rows prop (data-bearing, the seed). */
  const DATA_SPEC = {
    surfaceId: 'jira-list-1',
    components: [{ id: 'root', component: 'IssueList', issues: [{ issueKey: 'P-1' }] }]
  }
  /** A purely static spec (no integration data). */
  const STATIC_SPEC = {
    surfaceId: 'static-1',
    components: [{ id: 'root', component: 'Text', text: 'hello' }]
  }

  /** A 'jira'-target frame carrying `spec` + optional `descriptor`/`bindings`. */
  function frame(
    callId: string,
    spec: unknown,
    extra?: { descriptor?: unknown; bindings?: unknown }
  ): BridgeRenderRequest {
    return {
      kind: 'render',
      callId,
      target: 'jira',
      spec: spec as BridgeRenderRequest['spec'],
      ...(extra?.descriptor !== undefined ? { descriptor: extra.descriptor as BridgeRenderRequest['descriptor'] } : {}),
      ...(extra?.bindings !== undefined ? { bindings: extra.bindings as BridgeRenderRequest['bindings'] } : {})
    }
  }

  /** Count warn() calls whose first arg mentions the no-binding reason. */
  function noBindingWarnings(): number {
    return warn.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('no binding')
    ).length
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-uibridge-warn-'))
    pushed = []
    warn = vi.fn()
    bridge = new UiBridge({
      projectDir: dir,
      pushRender: (p) => pushed.push(p),
      warn: warn as never,
      // A passthrough bindings helper so a `bindings` frame registers and suppresses the warning.
      registerAgentSurfaceBindings: ((_bindings: unknown, spec: unknown) => ({
        spec: spec as A2uiSurfaceUpdate,
        dataModel: []
      })) as never,
      registerAgentSurface: (((_d: unknown, spec: unknown) => ({
        spec: spec as A2uiSurfaceUpdate,
        registered: true
      })) as never)
    })
    bridge.start()
  })

  afterEach(() => {
    socket?.destroy()
    socket = null
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('warns ONCE and still pushes when a data container has no binding/descriptor', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(socket, frame('w1', DATA_SPEC))
    expect(noBindingWarnings()).toBe(1)
    // FR-009: the surface is pushed unchanged (warn-and-continue, render never altered).
    expect(pushed).toHaveLength(1)
    expect(pushed[0].spec.surfaceId).toBe('jira-list-1')
    expect(pushed[0].descriptor).toBeUndefined()
    expect(pushed[0].bindings).toBeUndefined()
  })

  it('does NOT warn when a descriptor is present (the surface is refreshable)', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      frame('w2', DATA_SPEC, { descriptor: { dataSource: 'searchIssues', query: { jql: 'x' } } })
    )
    expect(noBindingWarnings()).toBe(0)
    expect(pushed).toHaveLength(1)
  })

  it('does NOT warn when bindings are present (the surface is refreshable)', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      frame('w3', DATA_SPEC, {
        bindings: [{ componentId: 'root', descriptor: { dataSource: 'searchIssues', query: { jql: 'x' } } }]
      })
    )
    expect(noBindingWarnings()).toBe(0)
    expect(pushed).toHaveLength(1)
  })

  it('does NOT warn on a static-only spec with no binding', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(socket, frame('w4', STATIC_SPEC))
    expect(noBindingWarnings()).toBe(0)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].spec.surfaceId).toBe('static-1')
  })
})

/**
 * UiBridge — re-entrant refresh-kick must not null-deref the late settle
 * (jira-refreshable-detail-nav-crash-and-empty-v1, Defect A).
 *
 * The crash: a refreshable surface frame (carrying `bindings`) is filed; `onMessage`
 * sets `this.active`, then calls `registerAgentSurfaceBindings`, which kicks each
 * region's first refresh. The real AdapterDispatcher.refresh() synchronously calls the
 * injected `cancelActive()` (its FR-013 supersede guard) BEFORE its first await — which
 * settles + NULLS `this.active` re-entrantly. A 'jira' frame is display-only, so
 * `onMessage` then hits the immediate-settle branch; pre-fix it passed `this.active`
 * (now null) to `settle`, null-dereferencing `call.socket` and crashing the main process.
 *
 * This test injects a `registerAgentSurfaceBindings` that does EXACTLY that re-entrant
 * cancel (calling `bridge.cancelActive()` synchronously, mirroring the dispatcher kick),
 * then asserts: no uncaught exception is thrown across the message, and a single `result`
 * frame still comes back. Pre-fix the synchronous `settle(this.active=null)` throws inside
 * the socket 'data' handler (an uncaught exception that crashes the process) and no result
 * is delivered — so this fails. Post-fix `onMessage` settles a captured local, so it is
 * unaffected by the re-entrant null.
 */
describe('UiBridge — re-entrant refresh-kick null-safety (Defect A)', () => {
  let dir: string
  let bridge: UiBridge
  let pushed: UiRenderPayload[]
  let socket: Socket | null = null

  const KANBAN_SPEC = {
    surfaceId: 'jira-kanban-9',
    components: [{ id: 'root', component: 'IssueList' }]
  }

  /** A 'jira'-target frame carrying valid `bindings` (a refreshable kanban). */
  function bindingsFrame(callId: string): BridgeRenderRequest {
    return {
      kind: 'render',
      callId,
      target: 'jira',
      spec: KANBAN_SPEC as BridgeRenderRequest['spec'],
      bindings: [
        { componentId: 'root', descriptor: { dataSource: 'searchIssues', query: { jql: 'x' } } }
      ] as BridgeRenderRequest['bindings']
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-uibridge-reentry-'))
    pushed = []
    bridge = new UiBridge({
      projectDir: dir,
      pushRender: (p) => pushed.push(p),
      warn: vi.fn(),
      // Mirror the real wiring: the bindings register kicks each region's first refresh,
      // and AdapterDispatcher.refresh() synchronously calls cancelActive() before its
      // first await. Reproduce that re-entrancy directly here.
      registerAgentSurfaceBindings: ((_bindings: unknown, spec: unknown) => {
        bridge.cancelActive() // re-entrant: settles + nulls this.active mid-onMessage.
        return { spec: spec as A2uiSurfaceUpdate, dataModel: [] }
      }) as never
    })
    bridge.start()
  })

  afterEach(() => {
    socket?.destroy()
    socket = null
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not crash and still delivers a result when the kick cancels re-entrantly', async () => {
    const uncaught: unknown[] = []
    const onUncaught = (err: unknown): void => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)
    try {
      socket = await dial(bridgeSocketPath(dir))
      const result = await renderAndAwaitResult(socket, bindingsFrame('c-reentry'))
      // The surface still rendered (the re-entrant cancel does not block the push).
      expect(pushed).toHaveLength(1)
      expect(pushed[0].spec.surfaceId).toBe('jira-kanban-9')
      // A single result frame came back (the call settled cleanly) and the late settle
      // did NOT throw a null deref into the socket 'data' handler.
      expect(result?.kind).toBe('result')
      expect(result?.callId).toBe('c-reentry')
      expect(uncaught).toHaveLength(0)
    } finally {
      process.off('uncaughtException', onUncaught)
    }
  })
})

/**
 * UiBridge — the EARLY "UI generation has begun" begin-signal handler
 * (ui-catalog-pull-spinner-signal-v1, FR-003/FR-004). A `{ kind:'generating', target }` frame
 * is fire-and-forget: main forwards the non-secret target to `pushGeneratingBegin`, mints NO
 * requestId, settles NO call (sends NO result frame), and never touches a pending render.
 * Exercises the real socket path; a malformed/unknown frame is ignored.
 */
describe('UiBridge — generating begin-signal (FR-003/FR-004)', () => {
  let dir: string
  let bridge: UiBridge
  let pushed: UiRenderPayload[]
  let begins: { target: UiRenderTarget }[]
  let warn: ReturnType<typeof vi.fn>
  let socket: Socket | null = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-uibridge-gen-'))
    pushed = []
    begins = []
    warn = vi.fn()
    bridge = new UiBridge({
      projectDir: dir,
      pushRender: (p) => pushed.push(p),
      pushGeneratingBegin: (p) => begins.push(p),
      warn: warn as never
    })
    bridge.start()
  })

  afterEach(() => {
    socket?.destroy()
    socket = null
    bridge.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('forwards the target to pushGeneratingBegin, mints no requestId, pushes no render, sends no result', async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(
      socket,
      { kind: 'generating', callId: 'g-1', target: 'jira' } as unknown as BridgeRenderRequest
    )
    // No result frame comes back (fire-and-forget).
    expect(result).toBeNull()
    expect(begins).toEqual([{ target: 'jira' }])
    // No surface pushed, no pending call created.
    expect(pushed).toHaveLength(0)
  })

  it('defaults an absent target to generated-ui', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      { kind: 'generating', callId: 'g-2' } as unknown as BridgeRenderRequest
    )
    expect(begins).toEqual([{ target: 'generated-ui' }])
  })

  it('a subsequent render frame is unaffected — the begin-signal never touched pending state', async () => {
    socket = await dial(bridgeSocketPath(dir))
    await renderAndAwaitResult(
      socket,
      { kind: 'generating', callId: 'g-3', target: 'generated-ui' } as unknown as BridgeRenderRequest
    )
    // A real 'generated-ui' render now blocks (stays pending) exactly as normal — the prior
    // generating frame did not mint/settle anything.
    const result = await renderAndAwaitResult(socket, makeFrame('generated-ui', 'c-after-gen'))
    expect(result).toBeNull()
    expect(pushed).toHaveLength(1)
    expect(pushed[0].target).toBe('generated-ui')
    expect(begins).toHaveLength(1)
  })

  it('ignores an unknown bridge message kind (warn-and-ignore)', async () => {
    socket = await dial(bridgeSocketPath(dir))
    const result = await renderAndAwaitResult(
      socket,
      { kind: 'bogus', callId: 'g-x' } as unknown as BridgeRenderRequest
    )
    expect(result).toBeNull()
    expect(begins).toHaveLength(0)
    expect(pushed).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
  })
})
