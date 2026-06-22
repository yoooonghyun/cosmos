import { describe, it, expect } from 'vitest'
import { mapSlackTokenResponse } from './slackOAuth'

/**
 * `mapSlackTokenResponse` is the pure mapper from Slack's `oauth.v2.access` payload to a
 * `SlackOAuthResult`. The slack-oauth-keeps-unlinking-v1 bug was that it dropped the rotation
 * fields (`authed_user.refresh_token` / `authed_user.expires_in`), so a rotating short-lived
 * token could not be refreshed and the connection kept lapsing into reconnect_needed.
 */
describe('mapSlackTokenResponse (slack-oauth-keeps-unlinking-v1)', () => {
  it('maps a classic non-rotating grant with NO refresh token or expiry (unchanged)', () => {
    const result = mapSlackTokenResponse({
      authed_user: { access_token: 'xoxp-classic', scope: 'channels:read,search:read' },
      team: { id: 'T1', name: 'Acme' }
    })
    expect(result.userToken).toBe('xoxp-classic')
    expect(result.scopes).toEqual(['channels:read', 'search:read'])
    expect(result.teamId).toBe('T1')
    expect(result.teamName).toBe('Acme')
    expect(result.refreshToken).toBeUndefined()
    expect(result.expiresInSeconds).toBeUndefined()
  })

  it('captures the rotation refresh token + expiry when the grant rotates (the fix)', () => {
    const result = mapSlackTokenResponse({
      authed_user: {
        access_token: 'xoxe.xoxp-rotating',
        scope: 'channels:read',
        refresh_token: 'xoxe-1.refresh',
        expires_in: 43200
      },
      team: { id: 'T1', name: 'Acme' }
    })
    expect(result.userToken).toBe('xoxe.xoxp-rotating')
    expect(result.refreshToken).toBe('xoxe-1.refresh')
    expect(result.expiresInSeconds).toBe(43200)
  })

  it('ignores a non-string refresh token / non-number expiry (defensive)', () => {
    const result = mapSlackTokenResponse({
      authed_user: {
        access_token: 'xoxp-1',
        scope: '',
        refresh_token: 123,
        expires_in: 'soon'
      }
    })
    expect(result.userToken).toBe('xoxp-1')
    expect(result.scopes).toEqual([])
    expect(result.refreshToken).toBeUndefined()
    expect(result.expiresInSeconds).toBeUndefined()
  })

  it('throws when the user access token is missing (FR: connect fails, nothing stored)', () => {
    expect(() => mapSlackTokenResponse({ authed_user: { scope: 'channels:read' } })).toThrow(
      /missing user access token/
    )
  })
})
