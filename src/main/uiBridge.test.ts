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
import type { UiRenderPayload, UiRenderTarget } from '../shared/ipc'

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
