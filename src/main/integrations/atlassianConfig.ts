/**
 * Atlassian OAuth + read-scope + endpoint configuration (Atlassian integration v1).
 *
 * Shared foundation used by BOTH the Jira and Confluence connections (FR-A15). It
 * centralizes the authorize/token/accessible-resources endpoints, the `audience`,
 * each product's read-only scope list, and the per-product API base builders so a
 * scope/endpoint swap is one edit (plan §C resolution).
 *
 * Jira generative-UI v1 adds exactly ONE write scope — `write:jira-work` — to the
 * Jira set (least privilege, FR-012/D4) so the existing Connect/Reconnect flow always
 * requests the full read+write set (no second OAuth entry point). Confluence stays
 * READ-ONLY (FR-C01). `offline_access` is included so Atlassian issues a refresh
 * token (FR-A09); it is already present and unchanged.
 */

/** Atlassian authorize endpoint (consent page opened in the system browser). FR-A02. */
export const ATLASSIAN_AUTHORIZE_ENDPOINT = 'https://auth.atlassian.com/authorize'
/** Atlassian token endpoint (code->token exchange + refresh rotation). FR-A03, FR-A09. */
export const ATLASSIAN_TOKEN_ENDPOINT = 'https://auth.atlassian.com/oauth/token'
/** Resolves the granted site's cloudId after the token grant. FR-A07. */
export const ATLASSIAN_ACCESSIBLE_RESOURCES_ENDPOINT =
  'https://api.atlassian.com/oauth/token/accessible-resources'

/** The `audience` Atlassian requires on the authorize + token calls. FR-A02. */
export const ATLASSIAN_AUDIENCE = 'api.atlassian.com'

/**
 * Jira scopes. Reads (`read:jira-work` + user resolution) plus exactly one write
 * scope — `write:jira-work` — added by Jira generative-UI v1 (FR-012/D4) for the
 * transition + comment writes. `offline_access` enables refresh (FR-A09). This is
 * the ONLY write scope (least privilege); no `write:jira-user` or `manage:*`.
 */
export const JIRA_OAUTH_SCOPES = [
  'read:jira-work',
  'read:jira-user',
  'write:jira-work',
  'offline_access'
]

/**
 * Confluence scopes. Classic 3LO read scopes plus exactly one write scope —
 * `write:confluence-content` — for the page-create tool (least privilege). If the
 * registered app is forced onto granular scopes, substitute `read:page:confluence` +
 * `read:space:confluence` for the reads and `write:page:confluence` for the write (one
 * edit). `offline_access` enables refresh (FR-A09). Adding the write scope forces an
 * existing connection to disconnect + reconnect to re-consent.
 */
export const CONFLUENCE_OAUTH_SCOPES = [
  'read:confluence-content.all',
  'read:confluence-space.summary',
  'search:confluence',
  'write:confluence-content',
  'offline_access'
]

/**
 * Jira REST base for a resolved cloudId (FR-J07). Callers append
 * `/rest/api/3/...` paths. `Authorization: Bearer <access token>`.
 */
export function jiraApiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}`
}

/**
 * Confluence REST base for a resolved cloudId (FR-C07, plan §C correction). Callers
 * append `/wiki/api/v2/...` (v2 page reads) or `/wiki/rest/api/...` (v1 CQL search)
 * paths. `Authorization: Bearer <access token>`.
 */
export function confluenceApiBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/confluence/${cloudId}`
}
