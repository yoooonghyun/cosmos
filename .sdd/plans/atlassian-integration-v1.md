# Plan: Atlassian (Jira + Confluence) Integration (read-only) — v1

**Status**: Draft
**Created**: 2026-06-03
**Last updated**: 2026-06-03
**Spec**: .sdd/specs/atlassian-integration-v1.md

---

## Summary

Build two fully-separate, read-only Atlassian integrations — **Jira** and **Confluence** —
mirroring the shipped Slack integration (ARCHITECTURE §4.8) on top of the Third-Party
Integration Foundation (§4.7). cosmos runs its OWN registered Atlassian Cloud OAuth 2.0 (3LO)
authorization-code-with-PKCE flow in the main process against `auth.atlassian.com`, exchanges
the code (with `client_secret` — see decision A below — and the PKCE challenge), resolves the
site **cloudId** via `accessible-resources`, and stores each product's `{access, refresh,
expiry, scopes, cloudId, identity}` token set in its **own** `safeStorage`-encrypted blob. Each
product gets a single main-process API client + manager (the sole caller of Atlassian for that
product), serving **both** surfaces — a native React panel over a `window.cosmos.{jira,confluence}`
IPC channel set, and a set of read-only MCP tools reached over a per-product NDJSON Unix-socket
bridge (siblings to `slackBridge`/`slackMcpServer`). This is the **first** feature to exercise the
foundation's refresh-token rotation path (Atlassian access tokens expire ~1h and refresh tokens
rotate on every refresh) and to add **cloudId resolution** as a post-grant step; it generalizes
the foundation slightly (an env-only, main-process-only `client_secret` for token exchange/refresh
and a `Bearer`-auth REST client base) without weakening the token-never-leaves-main invariant.
This is a **UI-bearing feature**: a Design step (Step 2.5, designer agent) precedes Interface for
the two new panels, which must reuse the existing Tailwind + shadcn/ui design system and match the
Slack panel's chrome.

---

## Resolved technical decisions (pinning the spec's open endpoint/scope/pagination items)

> All four spec Open Questions are addressed here. Items A and (most of) B/C/D are resolved from
> Atlassian's developer docs; two items are flagged as "confirm at first real consent" because they
> can only be verified empirically against cosmos's registered app.

### A. OAuth flow shape, and Open Question #1 → RESOLVED (client_secret IS required)

Atlassian **Cloud** 3LO is a **confidential client**: the token endpoint requires `client_secret`.
PKCE-only public clients are a Server/DC feature, not Cloud. Per the user's locked decision and
verified against `developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps`:

- **Authorize** (system browser): `GET https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=…&scope=<space-delimited read scopes + offline_access>&redirect_uri=<exact loopback>&response_type=code&prompt=consent&state=<csrf>&code_challenge=<S256>&code_challenge_method=S256`. (cosmos sends the PKCE challenge even though Cloud may ignore it — harmless, and auto-adapts if Atlassian ever enables public clients.)
- **Token exchange**: `POST https://auth.atlassian.com/oauth/token` form/JSON body `{ grant_type: 'authorization_code', client_id, client_secret, code, redirect_uri }`. Response: `{ access_token, refresh_token, expires_in (~3600), scope }`.
- **Refresh** (rotation): `POST …/oauth/token` `{ grant_type: 'refresh_token', client_id, client_secret, refresh_token }` → a NEW `access_token` AND a NEW `refresh_token` (old refresh token is invalidated — cosmos MUST persist the rotated set each time).
- **accessible-resources**: `GET https://api.atlassian.com/oauth/token/accessible-resources` with `Authorization: Bearer <access_token>` → array of `{ id (=cloudId), name, url, scopes[], avatarUrl }`. v1 uses the **first** entry's `id` as the cloudId (multi-site picker deferred — Open Question #3, accepted for v1).

**Resolution of FR-A03 / Open Question #1**: keep FR-A03's secret-less-first probe (a 1-line
attempt) so the code auto-adapts, but treat the **`client_secret` branch as the expected active
path** for Atlassian Cloud. `COSMOS_ATLASSIAN_CLIENT_SECRET` (gitignored `.env`, main-process
only, never logged/IPC'd/bridged/in MCP results) MUST be set alongside `COSMOS_ATLASSIAN_CLIENT_ID`.
If the secret-less attempt is rejected and no secret is configured, Connect fails fast with a clear
"not configured" message (FR-A04). The spec's Open Questions section is updated to mark #1 RESOLVED
in this same change.

### B. Jira read endpoints + pagination

- **Search**: use the **enhanced JQL search endpoint** `POST /rest/api/3/search/jql` (body `{ jql, maxResults, fields: ['summary','status','assignee'], nextPageToken? }`; response `{ issues[], nextPageToken?, isLast }`).
  **Justification (one line)**: Atlassian has deprecated the legacy `GET/POST /rest/api/3/search` (the unbounded `startAt/total` model) and replaced it with `/search/jql`, whose forward-only **`nextPageToken`** cursor is the path Atlassian now supports — picking it avoids building on a removed endpoint.
- **Single issue + comments**: `GET /rest/api/3/issue/{issueIdOrKey}?fields=summary,status,assignee,reporter,description,comment`.
  **Justification (one line)**: a single GET with `fields=…,comment` returns the issue plus its embedded comment collection in one call, so no second round-trip is needed for FR-J04's "description, and comments in order".
- **Base**: `https://api.atlassian.com/ex/jira/{cloudId}` + the paths above; `Authorization: Bearer`.
- Comments may themselves paginate inside the issue payload (`fields.comment.{comments[],startAt,maxResults,total}`); v1 surfaces the first page returned (deep comment pagination deferred — consistent with the spec's "comments in order" without a comment cursor).

### C. Confluence read endpoints + pagination, and Open Question #2 (scopes)

- **Page read (list + single)**: use Confluence **v2** `GET /wiki/api/v2/pages/{id}?body-format=storage` for the single page (title via `title`, body via `body.storage.value`, space via `spaceId`), and v2 cursor pagination (`limit` + `cursor`; next page from the `Link: …; rel="next"` header / `_links.next`).
  **Justification (one line)**: v2 is Atlassian's current, actively-developed Confluence REST surface with a clean cursor model, so the page-read path should be built on v2 rather than the legacy v1 `wiki/rest/api/content`.
- **Content search (CQL)**: use **v1** `GET /wiki/rest/api/search?cql=<query>&limit=&cursor=` (or `/wiki/rest/api/content/search`), mapping each result to `{ title, space, excerpt }`.
  **Justification (one line)**: CQL search is **not** exposed in the Confluence v2 API, so v1 search is the only first-party way to satisfy FR-C04's "search content"; v1 also returns a cursor in `_links.next`, so pagination stays cursor-based and consistent with the v2 page reads.
- **Net decision**: Confluence v1+v2 **hybrid** — v2 for page reads, v1 for CQL search. The client encapsulates both behind one read-only `ConfluenceClient` so the manager/panel/tools see a single surface. Both halves paginate by **opaque cursor** (mapped into the shared `Page<T>.nextCursor`, exactly like Slack's cursor model).
- **Base correction (carry into ARCHITECTURE)**: Confluence is reached at `https://api.atlassian.com/ex/confluence/{cloudId}/wiki/...` — i.e. `…/ex/confluence/{cloudId}` + (`/wiki/api/v2/…` or `/wiki/rest/api/…`). The spec/FR-C07/FR-A07's `…/wiki/{cloudId}/…` shorthand is corrected to the `…/ex/confluence/{cloudId}/wiki/…` form (verified against the accessible-resources base-URL pattern docs).

**Resolution of FR-C01 / Open Question #2 (scope strings)**: **recommend the classic scopes**
`read:confluence-content.all`, `read:confluence-space.summary`, `search:confluence` (+ `offline_access`)
as the v1 default — they map 1:1 to the read surface (content body, space summary, CQL search) and
are the minimal read-only set. Centralize them in `atlassianConfig.ts` so a swap is one edit.
**Confirm at first real consent**: if cosmos's registered app is forced onto **granular** scopes,
substitute `read:page:confluence` + `read:space:confluence` (for content/space) and keep/verify the
search scope; record the actual granted scopes from `accessible-resources` (they are persisted in
the token set already). This is the one Confluence item that can only be settled against the live app.

### D. Jira scopes

`read:jira-work`, `read:jira-user`, `+ offline_access` (FR-J01) — read-only, no write/manage scope.
No empirical ambiguity; pinned as-is.

---

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (strict), Node (main + MCP entry scripts), React 19 (renderer) |
| Key dependencies  | Existing only: Electron `safeStorage`/`shell`, `node:crypto`/`node:http`/`node:net`, `@modelcontextprotocol/sdk`, `zod`, Tailwind + shadcn/ui, lucide-react. **No new runtime dependency.** Reuses `oauthPkce.ts`, `tokenStore.ts`, `bridge.ts` NDJSON framing. |
| New env vars      | `COSMOS_ATLASSIAN_CLIENT_ID` (shared by both products), `COSMOS_ATLASSIAN_CLIENT_SECRET` (main-process only, gitignored `.env`, never logged/transmitted) |
| Files to create   | `src/shared/jira.ts`, `src/shared/confluence.ts`; `src/main/integrations/atlassianConfig.ts`, `src/main/integrations/atlassianOAuth.ts`, `src/main/integrations/jiraClient.ts`, `src/main/integrations/confluenceClient.ts`; `src/main/jiraManager.ts`, `src/main/confluenceManager.ts`, `src/main/jiraBridge.ts`, `src/main/confluenceBridge.ts`; `src/mcp/jiraMcpServer.ts`, `src/mcp/confluenceMcpServer.ts`; `src/renderer/JiraPanel.tsx`, `src/renderer/ConfluencePanel.tsx`; plus co-located `*.test.ts` for each new pure/main module |
| Files to modify   | `src/shared/ipc.ts` (jira/confluence channel names + `JiraApi`/`ConfluenceApi` + `CosmosApi`), `src/shared/bridge.ts` (jira/confluence socket-path helpers + bridge frames + `encodeBridgeMessage` union), `src/shared/validate.ts` (per-op IPC + bridge-frame validators), `src/preload/index.ts` (`window.cosmos.jira` + `window.cosmos.confluence`), `src/main/index.ts` (managers/bridges/IPC wiring + `--mcp-config` entries + two more socket env vars), `src/renderer/App.tsx` (mount the two panels in the existing tabbed chrome), `docs/ARCHITECTURE.md` (§4.9 new, §4.7 generalized) |

### Shared-vs-duplicated boundary (foundation reuse)

**Genuinely shared (foundation level, used by BOTH products):**
- `oauthPkce.ts` — PKCE pair, `state`, loopback capture (ports 7421→7423), authorize-URL build, token POST. **One additive change**: `exchangeCodeRaw`/`refreshToken` gain an **optional `clientSecret`** param that, when present, is added to the token-POST body (and an `authorizeEndpoint`/`audience`/`prompt` already supported by `buildAuthorizeUrl` via params). The secret-less call path is unchanged; Slack keeps passing no secret.
- `tokenStore.ts` — unchanged structurally; `StoredTokenSet` already carries `refreshToken`/`expiresAtMs`/`scopes`/`extra` (cloudId + identity live in `extra` or dedicated fields). This feature **first exercises** its `isExpired()` + refresh-rotation persistence.
- `atlassianConfig.ts` (NEW, shared) — Atlassian endpoints (authorize/token/accessible-resources), `audience`, per-product scope lists, the `…/ex/jira/{cloudId}` and `…/ex/confluence/{cloudId}/wiki` base builders.
- `atlassianOAuth.ts` (NEW, shared) — thin orchestrator over `oauthPkce`: run flow → exchange (secret-less-first, then `client_secret`) → resolve cloudId via `accessible-resources` → return `{access, refresh, expiresAtMs, scopes, cloudId, accountName/url}`; plus a shared **`refreshAtlassianToken`** helper (rotation) and **`resolveCloudId`** helper. Parameterized by the product's scope list + token-endpoint, so one module serves both connects.

**Duplicated per product (must NOT share connection state — FR-A13):**
- `src/shared/{jira,confluence}.ts` — product DTOs, params, `Result<T>` (each mirrors `SlackResult<T>`), tool-name + op-name maps.
- `{jira,confluence}Client.ts` — the single read-only API client per product (different endpoints, different response mappers; Confluence's client also spans v1 search + v2 pages).
- `{jira,confluence}Manager.ts` — the per-product state machine (`not_connected → connecting → connected → reconnect_needed`), sole caller of its client, owns the refresh-on-expiry/401-then-retry-once logic, its own token-store blob path.
- `{jira,confluence}Bridge.ts` + `{jira,confluence}McpServer.ts` — sibling bridges/entry scripts, each with its own socket, env var, pending-call state, and tool set.
- `{Jira,Confluence}Panel.tsx` — the two native React panels.

> The refresh-on-expiry/401-retry-once logic is the same shape for both managers; factor it into a
> tiny shared helper (e.g. `withRefresh` in `atlassianOAuth.ts` or a `tokenStore` method) that the
> manager calls with its store + refresh runner, so the rotation/persist/`reconnect_needed` rule
> lives in ONE place — but each manager keeps its OWN store + state (no shared connection state).

---

## Implementation Checklist

> Update as work progresses; add inline notes when a step deviates. Ordered to follow the sdd cycle
> (Design → Interface → Test → Implement). Grouped by the spec's FR groups: **A** foundation,
> **J** Jira, **C** Confluence, **X** cross-cutting.

### Phase 0 — Pre-flight

- [x] Read `.sdd/specs/atlassian-integration-v1.md` in full; confirm Open Questions #1 (RESOLVED here) and #3 (multi-site → first site, accepted) are settled, and #2 (Confluence scopes) + the granular-fallback are "confirm at first consent" only.
- [x] Update the spec's Open Questions: mark #1 **RESOLVED** (Atlassian Cloud 3LO requires `client_secret`; secret-less probe retained, secret branch is the active path). *(Architect does this in the same Plan change.)*
- [x] Confirm `.env` gitignore covers `COSMOS_ATLASSIAN_CLIENT_SECRET`; document the one-time Atlassian app setup (enable 3LO; add Jira+Confluence read scopes + `offline_access`; allowlist the three loopback callback URLs).

### Phase 2.5 — Design (designer agent, UI-bearing) — BEFORE Interface

- [x] Design spec `.sdd/designs/atlassian-integration-v1.md` for **JiraPanel** and **ConfluencePanel**, reusing the existing Tailwind + shadcn/ui tokens and `src/renderer/components/ui/` — match the Slack panel chrome (connection bar always present; content region; the five states loading/idle-empty/populated/error/disabled per FR-J05/FR-C05).
- [x] Jira surfaces: JQL search input + results list (key, summary, status, assignee) with "load more" cursor; single-issue view (summary, status, assignee, reporter, description, comments in order). Idle/empty prompt when no query (FR-J04, scenario).
- [x] Confluence surfaces: search input + results list (title, space, excerpt) with cursor; single-page view (title, space, body/excerpt). Idle/empty prompt when no query (FR-C04, scenario).
- [x] No new design tokens unless strictly needed; designer owns tokens + `components/ui/`, developer does any shadcn CLI/install wiring.

### Phase 3 — Interface (shared contracts first; no behavior)

**A — foundation contracts**
- [x] `atlassianConfig.ts`: authorize/token/accessible-resources endpoints, `audience='api.atlassian.com'`, `JIRA_OAUTH_SCOPES`, `CONFLUENCE_OAUTH_SCOPES` (classic; granular noted), `jiraApiBase(cloudId)`, `confluenceApiBase(cloudId)` (`…/ex/confluence/{cloudId}/wiki`).
- [x] `oauthPkce.ts`: add optional `clientSecret` to `ExchangeCodeParams`/`RefreshTokenParams` (added to the POST body only when present); extend `buildAuthorizeUrl`/`AuthorizeUrlParams` to carry `audience`, `prompt`, and a single space-delimited `scope` list (Atlassian sends standard `scope`, not Slack's `user_scope`). Keep Slack's call sites unchanged.
- [x] `atlassianOAuth.ts`: `RunAtlassianOAuthDeps`/`AtlassianOAuthResult` (access, refresh, expiresAtMs, scopes, cloudId, accountName, siteUrl); `runAtlassianOAuth(scopes,…)`, `refreshAtlassianToken(…)`, `resolveCloudId(accessToken, fetch)`; secret-less-first then `client_secret` exchange branch (explicit, never silent).

**J — Jira contracts**
- [x] `src/shared/jira.ts`: `JiraConnectionStatus` (+ site/account identity, `lastError`), `JiraIssueSummary` (key, summary, status, assignee), `JiraIssueDetail` (+ reporter, description, comments[]), `JiraComment`, `JiraPage<T>` (`items`, `nextCursor`), `JiraResult<T>` (mirror `SlackResult`: `not_connected`/`reconnect_needed`/`rate_limited`/`network`), search/get params, `JiraTool` + `JiraOp` maps.
- [x] `ipc.ts`: `JiraChannelName` (getStatus/connect/disconnect/searchIssues/getIssue/statusChanged) + `JiraApi`; add to `CosmosApi`.
- [x] `bridge.ts`: `jiraBridgeSocketPath`, `JiraBridgeCallRequest`/`…ResultResponse`, extend `encodeBridgeMessage` union.

**C — Confluence contracts**
- [x] `src/shared/confluence.ts`: `ConfluenceConnectionStatus`, `ConfluenceSearchResult` (title, space, excerpt), `ConfluencePageDetail` (title, space, body/excerpt), `ConfluencePage<T>`, `ConfluenceResult<T>`, search/get params, `ConfluenceTool` + `ConfluenceOp` maps.
- [x] `ipc.ts`: `ConfluenceChannelName` + `ConfluenceApi`; add to `CosmosApi`.
- [x] `bridge.ts`: `confluenceBridgeSocketPath`, Confluence bridge frames, extend `encodeBridgeMessage` union.

**X — validators (pure)**
- [x] `validate.ts`: per-op IPC validators (`validateJiraSearch`, `validateJiraGetIssue`, `validateConfluenceSearch`, `validateConfluenceGetPage`) + bridge-frame validators (`validateJiraBridgeCall`, `validateConfluenceBridgeCall`) following the `validateSlack*` family exactly.
- [x] `preload/index.ts`: `jiraApi`/`confluenceApi` objects exposed as `window.cosmos.jira` / `window.cosmos.confluence` (invoke for reads, `onStatusChanged` subscription), added to the `CosmosApi` object.

### Phase 4 — Testing (pure + main units, no Electron/network)

- [x] `atlassianOAuth` tests: secret-less attempt → on rejection, retried WITH `client_secret`; cloudId resolved from first `accessible-resources` entry; **no site → error**; secret never appears in any logged/returned value.
- [x] `oauthPkce` regression: Slack call sites (no secret) unchanged; Atlassian path adds `client_secret` to the body only when provided; `refreshToken` rotation maps the new refresh token.
- [x] `tokenStore` (first refresh-rotation exercise): `isExpired()` true past expiry−skew; after refresh, the rotated `{access, refresh, expiresAtMs}` is persisted (ciphertext on disk asserted, never plaintext); separate Jira/Confluence blob paths are independent (disconnect one leaves the other).
- [x] `jiraManager`/`confluenceManager` tests: state machine; **expired/401 → refresh → retry once → success without `reconnect_needed`**; **refresh fails → `reconnect_needed`** (both surfaces); `not_connected` result when no token; `429` maps to `rate_limited` with `Retry-After`; token never in any result.
- [x] `jiraClient`/`confluenceClient` tests: response→DTO mappers (issue+comments; v2 page body; v1 CQL search hits); cursor extraction (Jira `nextPageToken`/`isLast`; Confluence `Link`/`_links.next`); read-only (no mutate method exists); error mapper distinguishes reconnect/rate-limit/network.
- [x] `jiraBridge`/`confluenceBridge` tests: valid frame → manager → typed result; malformed/unknown frame warned + ignored; invalid params → structured error (never crash, never mis-resolve).
- [x] `validate.ts` tests: each new validator (happy / missing-required / wrong-type → null + warn).

### Phase 5 — Implementation

**A — foundation**
- [x] Implement the `oauthPkce` secret/audience/scope additions (Slack-compatible).
- [x] Implement `atlassianConfig.ts` + `atlassianOAuth.ts` (run flow, exchange-with-secret-fallback, resolveCloudId, refresh helper).

**J — Jira**
- [x] `jiraClient.ts`: `POST /rest/api/3/search/jql` (fields summary/status/assignee; `nextPageToken`) and `GET /rest/api/3/issue/{key}?fields=…,comment`; Bearer; error mapper; read-only.
- [x] `jiraManager.ts`: connect (runAtlassianOAuth with Jira scopes), disconnect (clear own blob), `searchIssues`/`getIssue` through `withRefresh` (refresh-on-expiry/401, persist rotation, retry once, else `reconnect_needed`).
- [x] `jiraBridge.ts` + `jiraMcpServer.ts`: tools `jira_search_issues`, `jira_get_issue` (read-only; not-connected/reconnect-needed structured result; results carry no token/secret).

**C — Confluence**
- [x] `confluenceClient.ts`: v1 `GET /wiki/rest/api/search?cql=…` (title/space/excerpt; cursor) and v2 `GET /wiki/api/v2/pages/{id}?body-format=storage`; Bearer; error mapper; read-only.
- [x] `confluenceManager.ts`: mirror jiraManager with Confluence scopes + own blob.
- [x] `confluenceBridge.ts` + `confluenceMcpServer.ts`: tools `confluence_search_content`, `confluence_get_page`.

**Renderer**
- [x] `JiraPanel.tsx` + `ConfluencePanel.tsx` per the design spec; mount in `App.tsx` chrome (alongside Slack/Generated-UI). Panels request operations only — no token ever reaches the renderer.

**X — wiring (`src/main/index.ts`)**
- [x] Build `jiraManager`/`confluenceManager` (each with own `TokenStore` blob path `integrations/jira.token.enc`, `integrations/confluence.token.enc`); read `COSMOS_ATLASSIAN_CLIENT_ID` + `COSMOS_ATLASSIAN_CLIENT_SECRET` in main only; fail fast if id unset.
- [x] Register Jira/Confluence IPC handlers (validated; structured error on bad params); push `statusChanged`.
- [x] Start `jiraBridge`/`confluenceBridge`; add `cosmos-jira`/`cosmos-confluence` to `embeddedMcpConfig` with their own socket env vars; stop both in `closed`/`window-all-closed`/`before-quit`.

### Phase 6 — Docs

- [x] ARCHITECTURE.md §4.9 (new) + §4.7 (generalized) — done in this Plan change (see below); revisit after implementation for any deviation.
- [ ] Update this plan's Deviations log with any endpoint/scope reality discovered at first real consent (esp. classic-vs-granular Confluence scopes, and whether the secret-less probe is ever accepted). *(Pending a real OAuth consent against cosmos's registered Atlassian app — cannot be exercised in unit-level dev.)*
- [ ] `TODO.md` reconciliation handled by wrap-up at iteration end.

---

## Security invariants (carried from the spec — do not weaken)

- Access tokens, refresh tokens, and `COSMOS_ATLASSIAN_CLIENT_SECRET` live ONLY in main, encrypted at rest (`safeStorage`); never in any IPC payload, bridge frame, MCP tool result, or log line.
- Read-only scopes only (no write/manage/transition); no mutate method exists in either client; no write tool exists.
- Every inbound IPC payload and bridge frame validated at the main boundary; invalid → warn + ignore (never crash, never mis-resolve).
- Renderer stays `contextIsolation: true` / `nodeIntegration: false`; capability reaches it only via the `contextBridge` preload namespaces.
- No connect IPC carries an inbound token (no token is ever sent into cosmos); both surfaces request operations and main attaches the token.

---

## Deviations & Notes

- **2026-06-03**: Open Question #1 resolved to "client_secret required for Atlassian Cloud" (web-verified confidential client). Secret-less probe retained per FR-A03 but the secret branch is the active path; `COSMOS_ATLASSIAN_CLIENT_SECRET` is now a required main-process env var on the active path.
- **2026-06-03**: Corrected the Confluence API base from the spec's shorthand `…/wiki/{cloudId}/…` to the actual `https://api.atlassian.com/ex/confluence/{cloudId}/wiki/…` (per the accessible-resources base-URL pattern). FR-C07/FR-A07 shorthand stands semantically; the client uses the corrected base.
- **2026-06-03**: Confluence is a v1+v2 **hybrid** (v2 page reads, v1 CQL search) because CQL search is not in v2; both halves paginate by opaque cursor mapped into the shared `Page<T>.nextCursor`.
- **2026-06-03**: Two items can only be confirmed at first real consent against cosmos's registered app: (a) classic-vs-granular Confluence scopes (FR-C01 / Open Question #2 — classic recommended), and (b) whether the secret-less exchange probe is ever accepted (expected: never, on Cloud).
- **2026-06-03 (developer)**: Added two rollup inputs to `electron.vite.config.ts` (`mcp/jiraMcpServer`, `mcp/confluenceMcpServer`) so the new MCP entry scripts emit to `out/main/mcp/{jira,confluence}McpServer.js` — the paths `embeddedMcpConfig` (src/main/index.ts) registers. Not called out in the plan's "Files to modify" but required for the bundled MCP servers to exist at runtime, exactly mirroring the existing Slack entry.
- **2026-06-03 (developer)**: The lifted Slack panel sub-views (ConnectionBar, ConnectForm, ErrorState, ReconnectState, EmptyLine, initials/formatTs) were factored into a shared `src/renderer/atlassianPanelBits.tsx` (parameterized by a `provider` label) rather than duplicated verbatim into each panel — the design (§0) calls for lifting these shapes; a single shared module avoids two copies while keeping the Slack original untouched. `formatTs` here parses ISO-8601 (Jira/Confluence timestamps) vs Slack's epoch `ts`.
- **2026-06-03 (developer)**: Renderer surfaces (panels) were exercised only via typecheck + production build, not a running OAuth/data round-trip; live panel behavior (real consent, real reads, the five visual states against live data) is unverified in this iteration.
