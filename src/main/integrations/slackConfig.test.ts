import { describe, expect, it } from 'vitest'
import { SLACK_USER_OAUTH_SCOPES } from './slackConfig'

describe('SLACK_USER_OAUTH_SCOPES', () => {
  // slack-attachment-image-broken-v1: files.slack.com attachment downloads need files:read.
  it('requests files:read so auth-gated attachment images can be fetched', () => {
    expect(SLACK_USER_OAUTH_SCOPES).toContain('files:read')
  })

  // slack-rich-message-render-v1: custom emoji need emoji.list.
  it('requests emoji:read for workspace custom emoji', () => {
    expect(SLACK_USER_OAUTH_SCOPES).toContain('emoji:read')
  })

  it('requests the core read scopes (channels, history, users, search)', () => {
    expect(SLACK_USER_OAUTH_SCOPES).toEqual(
      expect.arrayContaining(['channels:read', 'channels:history', 'users:read', 'search:read'])
    )
  })

  // slack-send-message-v1 (FR-007): chat:write is the ONLY write scope requested.
  it('requests chat:write (the only write scope) for sending messages', () => {
    expect(SLACK_USER_OAUTH_SCOPES).toContain('chat:write')
    expect(SLACK_USER_OAUTH_SCOPES.filter((s) => /:write$/.test(s))).toEqual(['chat:write'])
  })
})
