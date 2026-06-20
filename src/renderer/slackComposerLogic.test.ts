import { describe, it, expect } from 'vitest'
import { canSubmitSlackMessage } from './slackComposerLogic'

describe('canSubmitSlackMessage (slack-send-message-v1, FR-003/FR-012)', () => {
  const base = { text: 'hello', canSend: true, sending: false }

  it('allows submit for non-empty text when send-capable and idle (happy path)', () => {
    expect(canSubmitSlackMessage(base)).toBe(true)
  })

  it('blocks an empty draft (no IPC send for empty text — FR-003)', () => {
    expect(canSubmitSlackMessage({ ...base, text: '' })).toBe(false)
  })

  it.each(['   ', '\n', '\t', '  \n\t '])('blocks whitespace-only draft %p', (text) => {
    expect(canSubmitSlackMessage({ ...base, text })).toBe(false)
  })

  it('blocks while a send is in flight (no double-submit — FR-012)', () => {
    expect(canSubmitSlackMessage({ ...base, sending: true })).toBe(false)
  })

  it('blocks when the scope is missing (canSend false → Reconnect path — FR-010)', () => {
    expect(canSubmitSlackMessage({ ...base, canSend: false })).toBe(false)
  })

  it('keeps surrounding text but trims for the emptiness check', () => {
    expect(canSubmitSlackMessage({ ...base, text: '  hi  ' })).toBe(true)
  })
})
