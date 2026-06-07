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
 * Confluence scopes — GRANULAR. Atlassian's classic content scopes
 * (`read:confluence-content.all` etc.) are granted on a granular-migrated app but no
 * longer authorize the content REST endpoints, which 401 with "scope does not match";
 * only granular scopes work (the v1 CQL search still works under `search:confluence`,
 * which is why search succeeds while a page read fails). So reads use
 * `read:page:confluence` (v2 page read) + `read:space:confluence` (space-key→id lookup
 * for create) and the single write uses `write:page:confluence`. `search:confluence`
 * stays for the CQL search. `offline_access` enables refresh (FR-A09). Changing the
 * scope set forces an existing connection to disconnect + reconnect to re-consent, and
 * the registered app must have these granular scopes enabled in the Atlassian console.
 */
export const CONFLUENCE_OAUTH_SCOPES = [
  'read:page:confluence',
  'read:space:confluence',
  'search:confluence',
  'write:page:confluence',
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
