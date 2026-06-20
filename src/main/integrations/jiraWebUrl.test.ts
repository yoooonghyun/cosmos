import { describe, it, expect } from 'vitest'
import { jiraWebUrl } from './jiraWebUrl'

/* jira-dock-autoapply-weblink-v1 (FR-010/FR-011) — the pure browse-URL assembler.
 * `<siteUrl>/browse/<KEY>` → absolute http(s) URL; missing/empty/non-http site → undefined
 * (omit the affordance, degrade-to-omit). Pure; never throws. Mirrors confluenceWebUrl's
 * omit-on-absent contract, but with Jira's origin + `/browse/` + encoded-key join rule. */

describe('jiraWebUrl (FR-010/FR-011)', () => {
  it('assembles the canonical browse URL for a site origin + issue key', () => {
    expect(jiraWebUrl('https://acme.atlassian.net', 'PROJ-1')).toBe(
      'https://acme.atlassian.net/browse/PROJ-1'
    )
  })

  it('collapses the slash seam when the site URL has a trailing slash (no double slash)', () => {
    expect(jiraWebUrl('https://acme.atlassian.net/', 'PROJ-1')).toBe(
      'https://acme.atlassian.net/browse/PROJ-1'
    )
  })

  it('URL-encodes the issue key', () => {
    // A key never legitimately contains spaces/slashes, but a malformed value must not
    // inject path segments — it is encoded into a single segment.
    expect(jiraWebUrl('https://acme.atlassian.net', 'A B/../C')).toBe(
      'https://acme.atlassian.net/browse/A%20B%2F..%2FC'
    )
  })

  it('accepts an http site (only http(s) is browsable — FR-011)', () => {
    expect(jiraWebUrl('http://localhost:8080', 'X-1')).toBe('http://localhost:8080/browse/X-1')
  })

  it('returns undefined when siteUrl is undefined (omit the affordance — FR-011)', () => {
    expect(jiraWebUrl(undefined, 'PROJ-1')).toBeUndefined()
  })

  it('returns undefined for empty / whitespace siteUrl', () => {
    expect(jiraWebUrl('', 'PROJ-1')).toBeUndefined()
    expect(jiraWebUrl('   ', 'PROJ-1')).toBeUndefined()
  })

  it('returns undefined for an empty / whitespace issue key', () => {
    expect(jiraWebUrl('https://acme.atlassian.net', '')).toBeUndefined()
    expect(jiraWebUrl('https://acme.atlassian.net', '   ')).toBeUndefined()
  })

  it('rejects a non-http(s) site URL (e.g. javascript:/file:) — FR-011', () => {
    expect(jiraWebUrl('javascript:alert(1)', 'PROJ-1')).toBeUndefined()
    expect(jiraWebUrl('file:///etc/', 'PROJ-1')).toBeUndefined()
  })

  it('returns undefined for an unparseable / relative-only site URL', () => {
    expect(jiraWebUrl('/acme', 'PROJ-1')).toBeUndefined()
    expect(jiraWebUrl('not a url', 'PROJ-1')).toBeUndefined()
  })
})
