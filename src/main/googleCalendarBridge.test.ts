import { describe, it, expect, vi } from 'vitest'
import { GoogleCalendarBridge, type GoogleCalendarBridgeManager } from './googleCalendarBridge'
import { GoogleCalendarOp, type GoogleCalendarResult } from '../shared/types/googleCalendar'

function makeManager(overrides?: Partial<GoogleCalendarBridgeManager>): GoogleCalendarBridgeManager {
  const ok = async (): Promise<GoogleCalendarResult<unknown>> => ({ ok: true, data: { items: [] } })
  return {
    listEvents: vi.fn(ok),
    ...overrides
  }
}

function makeBridge(manager: GoogleCalendarBridgeManager) {
  const warn = vi.fn()
  return new GoogleCalendarBridge({ socketPath: '/tmp/never-gcal.sock', manager, warn })
}

const window = { timeMin: '2026-06-15T00:00:00Z', timeMax: '2026-06-22T00:00:00Z' }

describe('GoogleCalendarBridge.handleCall (read-only relay)', () => {
  it('routes a valid listEvents op to the manager (happy path)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(GoogleCalendarOp.ListEvents, window)
    expect(result.ok).toBe(true)
    expect(manager.listEvents).toHaveBeenCalledWith(window)
  })

  it('threads an optional cursor through', async () => {
    const manager = makeManager()
    await makeBridge(manager).handleCall(GoogleCalendarOp.ListEvents, { ...window, cursor: 'CUR' })
    expect(manager.listEvents).toHaveBeenCalledWith({ ...window, cursor: 'CUR' })
  })

  it('forwards a not_connected structured result (no hang)', async () => {
    const manager = makeManager({
      listEvents: vi.fn(
        async (): Promise<GoogleCalendarResult<unknown>> => ({
          ok: false,
          kind: 'not_connected',
          message: 'Connect Google Calendar in cosmos first.'
        })
      )
    })
    const result = await makeBridge(manager).handleCall(GoogleCalendarOp.ListEvents, window)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('not_connected')
    }
  })

  it('returns a structured error (no crash) when required params are missing', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall(GoogleCalendarOp.ListEvents, {
      timeMin: '2026-06-15T00:00:00Z'
    }) // missing timeMax
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('network')
    }
    expect(manager.listEvents).not.toHaveBeenCalled()
  })

  it('returns a structured error for an unknown op (cannot mis-route)', async () => {
    const manager = makeManager()
    const result = await makeBridge(manager).handleCall('deleteEvent', {})
    expect(result.ok).toBe(false)
    expect(manager.listEvents).not.toHaveBeenCalled()
  })

  it('a successful result carries data but no token field (SC-009)', async () => {
    const manager = makeManager({
      listEvents: vi.fn(
        async (): Promise<GoogleCalendarResult<unknown>> => ({
          ok: true,
          data: { items: [{ id: 'e1', summary: 'A' }] }
        })
      )
    })
    const result = await makeBridge(manager).handleCall(GoogleCalendarOp.ListEvents, window)
    expect(JSON.stringify(result)).not.toMatch(/at-|Bearer/)
  })
})
