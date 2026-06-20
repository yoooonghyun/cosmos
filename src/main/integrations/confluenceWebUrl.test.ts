import { describe, it, expect } from 'vitest'
import { confluenceWebUrl } from './confluenceWebUrl'

/* confluence-detail-weblink-v1 #87 — the pure web-URL assembler (FR-003/FR-004/FR-010).
 * siteUrl + _links.webui → absolute http(s) URL; missing/relative/non-http → undefined
 * (omit the affordance); never throws.
 *
 * 404 fix confluence-link-404-v1 #100 (deeper, v2): the assembler now builds from the
 * persisted SITE WEB ORIGIN (`siteUrl`) + the page's `_links.webui`, NOT the page
 * `_links.base`. The v2 GET /wiki/api/v2/pages/{id} per-page `_links` is `AbstractPageLinks`
 * = { webui, editui, tinyui } — it has NO `base` (that field lives in `MultiEntityLinks`,
 * the LIST-response top-level `_links`). The earlier fix assumed a per-page `base`; on the
 * real v2 single-page shape that produced a wrong/404 URL. The first two tests are the
 * regression guards: they feed the REAL v2 `_links` (webui only, NO base) and the real
 * accessible-resources `siteUrl` (bare origin, NO /wiki) and assert the corrected,
 * resolvable URL with exactly one /wiki segment. */

describe('confluenceWebUrl (FR-003/FR-004/FR-010; #100 404 fix, v2)', () => {
  it('builds <siteUrl>/wiki<webui> from the REAL v2 _links (webui only, NO base) — #100', () => {
    // The live v2 GET /wiki/api/v2/pages/{id} `_links` is AbstractPageLinks: { webui,
    // editui, tinyui } — there is NO `base`. The browsable host comes from the OAuth
    // accessible-resources `siteUrl` (bare origin, e.g. https://acme.atlassian.net), and
    // Confluence is served under /wiki. So the canonical URL is <siteUrl>/wiki<webui>.
    expect(
      confluenceWebUrl('https://acme.atlassian.net', {
        webui: '/spaces/ENG/pages/123/Title',
        editui: '/pages/resumedraft.action?draftId=123',
        tinyui: '/x/AbCdEf'
      })
    ).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title')
  })

  it('does NOT 404: never the /wiki-less URL and never the doubled /wiki — #100 regression', () => {
    const url = confluenceWebUrl('https://acme.atlassian.net', {
      webui: '/spaces/ENG/pages/123/Title'
    })
    // The old #100-v1 join could drop /wiki entirely (the original 404)...
    expect(url).not.toBe('https://acme.atlassian.net/spaces/ENG/pages/123/Title')
    // ...or, if base already carried /wiki and webui did too, DOUBLE it (the still-404 shape).
    expect(url).not.toBe('https://acme.atlassian.net/wiki/wiki/spaces/ENG/pages/123/Title')
    expect(url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title')
  })

  it('does NOT double /wiki when webui already carries the /wiki prefix (some sites) — #100', () => {
    // On some Confluence Cloud sites `webui` is returned WITH the /wiki context path. Joining
    // it onto a site origin must still yield exactly one /wiki, never /wiki/wiki.
    expect(
      confluenceWebUrl('https://acme.atlassian.net', { webui: '/wiki/spaces/ENG/pages/123/Title' })
    ).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title')
  })

  it('tolerates a siteUrl that defensively already ends in /wiki (no double)', () => {
    expect(
      confluenceWebUrl('https://acme.atlassian.net/wiki', { webui: '/spaces/ENG/pages/123/Title' })
    ).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title')
  })

  it('collapses a trailing slash on siteUrl (no double slash)', () => {
    expect(
      confluenceWebUrl('https://acme.atlassian.net/', { webui: '/spaces/ENG/pages/123/Title' })
    ).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Title')
  })

  it('joins a relative (no leading slash) webui under /wiki', () => {
    expect(
      confluenceWebUrl('https://acme.atlassian.net', { webui: 'pages/123/Title' })
    ).toBe('https://acme.atlassian.net/wiki/pages/123/Title')
  })

  it('accepts an http siteUrl (only http(s) is browsable — FR-010)', () => {
    expect(confluenceWebUrl('http://localhost:8090', { webui: '/pages/1' })).toBe(
      'http://localhost:8090/wiki/pages/1'
    )
  })

  it('returns undefined when siteUrl is missing/empty (omit the affordance — FR-004)', () => {
    expect(confluenceWebUrl(undefined, { webui: '/spaces/ENG/pages/123/Title' })).toBeUndefined()
    expect(confluenceWebUrl('', { webui: '/spaces/ENG/pages/123/Title' })).toBeUndefined()
    expect(confluenceWebUrl('   ', { webui: '/spaces/ENG/pages/123/Title' })).toBeUndefined()
  })

  it('returns undefined when webui is missing (omit the affordance — FR-004)', () => {
    expect(confluenceWebUrl('https://acme.atlassian.net', {})).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', { editui: '/x' })).toBeUndefined()
  })

  it('returns undefined for non-string webui / non-string siteUrl', () => {
    expect(confluenceWebUrl('https://acme.atlassian.net', { webui: 99 })).toBeUndefined()
    expect(confluenceWebUrl(42, { webui: '/x' })).toBeUndefined()
  })

  it('returns undefined for empty / whitespace webui', () => {
    expect(confluenceWebUrl('https://acme.atlassian.net', { webui: '' })).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', { webui: '   ' })).toBeUndefined()
  })

  it('returns undefined when siteUrl is not an absolute origin', () => {
    // a relative-only siteUrl cannot form an absolute URL → unparseable → undefined
    expect(confluenceWebUrl('/wiki', { webui: '/pages/1' })).toBeUndefined()
  })

  it('rejects a non-http(s) resolved URL (e.g. javascript:/file: siteUrl) — FR-010', () => {
    expect(confluenceWebUrl('javascript:alert(1)', { webui: '' })).toBeUndefined()
    expect(confluenceWebUrl('file:///etc/', { webui: 'passwd' })).toBeUndefined()
  })

  it('never throws on garbage links input (returns undefined)', () => {
    expect(confluenceWebUrl('https://acme.atlassian.net', undefined)).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', null)).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', 'nope')).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', 123)).toBeUndefined()
    expect(confluenceWebUrl('https://acme.atlassian.net', {})).toBeUndefined()
  })
})
