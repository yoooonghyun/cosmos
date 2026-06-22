/**
 * Bridge frame encode/round-trip tests (ui-catalog-pull-spinner-signal-v1, FR-003).
 *
 * The new fire-and-forget `BridgeGeneratingNotification` ({ kind:'generating', callId,
 * target? }) must serialize through `encodeBridgeMessage` as one NDJSON frame and parse back
 * byte-for-byte — the same framing as the existing `BridgeRenderRequest`. RED before the
 * change: the `'generating'` kind did not exist on `BridgeClientMessage`.
 */

import { describe, it, expect } from 'vitest'
import {
  encodeBridgeMessage,
  type BridgeGeneratingNotification,
  type BridgeClientMessage
} from './bridge'

describe('encodeBridgeMessage — BridgeGeneratingNotification (FR-003)', () => {
  it('serializes a generating frame as one newline-delimited JSON frame', () => {
    const frame: BridgeGeneratingNotification = {
      kind: 'generating',
      callId: 'c-1',
      target: 'jira'
    }
    const encoded = encodeBridgeMessage(frame)
    expect(encoded.endsWith('\n')).toBe(true)
    // Exactly one frame (no embedded newline before the trailing one).
    expect(encoded.slice(0, -1)).not.toContain('\n')
  })

  it('round-trips with the target present', () => {
    const frame: BridgeGeneratingNotification = {
      kind: 'generating',
      callId: 'c-2',
      target: 'slack'
    }
    const parsed = JSON.parse(encodeBridgeMessage(frame)) as BridgeClientMessage
    expect(parsed).toEqual(frame)
  })

  it('round-trips with the target ABSENT (main defaults it to generated-ui)', () => {
    const frame: BridgeGeneratingNotification = { kind: 'generating', callId: 'c-3' }
    const parsed = JSON.parse(encodeBridgeMessage(frame)) as BridgeClientMessage
    expect(parsed).toEqual({ kind: 'generating', callId: 'c-3' })
    if (parsed.kind === 'generating') {
      expect(parsed.target).toBeUndefined()
    }
  })

  it('carries no secret — only kind/callId/target keys', () => {
    const frame: BridgeGeneratingNotification = {
      kind: 'generating',
      callId: 'c-4',
      target: 'confluence'
    }
    expect(Object.keys(JSON.parse(encodeBridgeMessage(frame)))).toEqual([
      'kind',
      'callId',
      'target'
    ])
  })
})
