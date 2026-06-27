/**
 * Integration test for the Confluence comment author display-NAME resolution path
 * (confluence-comment-author-name-v1, bugfix: author renders as raw accountId at runtime).
 *
 * Node-unit tests (confluenceClient.test.ts) stub the user-lookup endpoint with a 200 body, so
 * they pass even though resolution is broken at RUNTIME. The break is a SCOPE gap: the granted
 * Confluence OAuth token can read footer-comments (`read:comment:confluence`) but the
 * author-resolution endpoint `GET /wiki/rest/api/user?accountId=…` needs the user-read scope —
 * which was MISSING from CONFLUENCE_OAUTH_SCOPES. At runtime that endpoint 403s, resolveUserName
 * returns undefined, and the renderer falls back to the raw id.
 *
 * This integration test drives the REAL getComments resolution path against a fetch stub that
 * models the runtime gateway: the `/wiki/rest/api/user` call is authorized ONLY when the granted
 * scope set actually carries the user-read scope. So it is RED against the still-broken scope set
 * (author resolves to the raw id) and GREEN once the scope is added (author resolves to the NAME).
 *
 * Covers:
 *   - top-level + reply authors resolve to the display NAME (the runtime-realistic shape:
 *     v2 footer-comment author under `version.authorId`; v1 user body with top-level `displayName`)
 *   - the user lookup goes through the SAME authed fetch path (Bearer token attached)
 *   - raw-id fallback when the user lookup fails (degrade-never-throw)
 */

import { describe, it, expect } from 'vitest'
import { ConfluenceClient, type ConfluenceHttpResponse, type FetchLike } from './integrations/confluenceClient'
import { CONFLUENCE_OAUTH_SCOPES } from './integrations/atlassianConfig'

/** The granular user-read scope the `/wiki/rest/api/user` endpoint requires at runtime. */
const USER_READ_SCOPE = 'read:user:confluence'

const auth = { token: 'at-integration', cloudId: 'cloud-xyz' }

function res(body: unknown, status = 200): ConfluenceHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body
  }
}

/**
 * A REALISTIC v2 footer-comment object (the shape the real GET /pages/{id}/footer-comments
 * returns): the author account id lives under `version.authorId`, NOT a top-level `accountId`.
 */
function footerComment(id: string, authorId: string, html: string): Record<string, unknown> {
  return {
    id,
    status: 'current',
    title: 're: page',
    pageId: '12345',
    version: { number: 1, authorId, createdAt: '2026-06-27T10:00:00.000Z', minorEdit: false },
    body: { storage: { representation: 'storage', value: html } }
  }
}

/** A REALISTIC v1 user object — display name is a TOP-LEVEL field alongside publicName. */
function userBody(accountId: string, displayName: string): Record<string, unknown> {
  return {
    type: 'known',
    accountId,
    accountType: 'atlassian',
    publicName: displayName.toLowerCase().replace(/\s+/g, ''),
    displayName,
    profilePicture: { path: '/x', width: 48, height: 48, isDefault: false }
  }
}

/**
 * A fetch stub that models the runtime Atlassian gateway: a `/wiki/rest/api/user` request is
 * authorized ONLY when `grantedScopes` actually includes the user-read scope (otherwise 403,
 * exactly as the real gateway does for a token missing the scope). Footer-comment + children
 * reads always succeed. Records each url + whether it carried the Bearer token.
 */
function gatewayFetch(opts: {
  grantedScopes: string[]
  names: Record<string, string>
  tops: Record<string, unknown>[]
  children?: (commentId: string) => Record<string, unknown>[]
}): { fetchImpl: FetchLike; userCalls: { url: string; authed: boolean }[] } {
  const userCalls: { url: string; authed: boolean }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const authed = (init?.headers?.['authorization'] ?? '') === `Bearer ${auth.token}`
    if (/\/wiki\/rest\/api\/user\?/.test(url)) {
      userCalls.push({ url, authed })
      // Runtime gateway: 403 the user endpoint when the token lacks the user-read scope.
      if (!opts.grantedScopes.includes(USER_READ_SCOPE)) {
        return res({ message: 'Current user not permitted to use Confluence' }, 403)
      }
      const accountId = new URL(url).searchParams.get('accountId') ?? ''
      const name = opts.names[accountId]
      return name ? res(userBody(accountId, name)) : res({ message: 'not found' }, 404)
    }
    const childMatch = url.match(/footer-comments\/([^/]+)\/children/)
    if (childMatch) {
      const replies = opts.children ? opts.children(decodeURIComponent(childMatch[1])) : []
      return res({ results: replies })
    }
    return res({ results: opts.tops, _links: {} })
  }
  return { fetchImpl, userCalls }
}

describe('Confluence comment author name resolution (runtime path)', () => {
  it('resolves the display NAME on top-level comments AND replies when the user-read scope is granted', async () => {
    const { fetchImpl, userCalls } = gatewayFetch({
      grantedScopes: CONFLUENCE_OAUTH_SCOPES,
      names: { 'acct-top': 'Ada Lovelace', 'acct-reply': 'Grace Hopper' },
      tops: [footerComment('c1', 'acct-top', '<p>top</p>')],
      children: () => [footerComment('c1a', 'acct-reply', '<p>reply</p>')]
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '12345' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const top = result.data.comments[0]
      // The author must surface as the display NAME, not the raw account id.
      expect(top.author.displayName).toBe('Ada Lovelace')
      expect(top.author.accountId).toBe('acct-top')
      const reply = top.replies[0]
      expect(reply.author.displayName).toBe('Grace Hopper')
      expect(reply.author.accountId).toBe('acct-reply')
    }
    // The user lookup went through the SAME authed fetch path (Bearer token attached).
    expect(userCalls.length).toBeGreaterThan(0)
    expect(userCalls.every((c) => c.authed)).toBe(true)
  })

  it('falls back to the raw account id when the user lookup FAILS (degrade-never-throw)', async () => {
    const { fetchImpl } = gatewayFetch({
      grantedScopes: CONFLUENCE_OAUTH_SCOPES,
      names: {}, // no name registered → the user endpoint 404s → no displayName
      tops: [footerComment('c2', 'acct-ghost', '<p>hi</p>')]
    })
    const client = new ConfluenceClient({ fetchImpl })
    const result = await client.getComments(auth, { pageId: '12345' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const top = result.data.comments[0]
      expect(top.author.displayName).toBeUndefined()
      expect(top.author.accountId).toBe('acct-ghost') // renderer falls back to the id
    }
  })

  it('grants the user-read scope so the runtime token can call the user endpoint (the actual fix)', () => {
    // RED before the fix: CONFLUENCE_OAUTH_SCOPES lacks the user-read scope, so at runtime every
    // /wiki/rest/api/user call 403s and the author renders as the raw id. GREEN after the fix.
    expect(CONFLUENCE_OAUTH_SCOPES).toContain(USER_READ_SCOPE)
  })
})
