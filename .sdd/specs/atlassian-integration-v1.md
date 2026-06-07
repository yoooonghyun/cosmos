# Spec: Atlassian (Jira + Confluence) Integration (read-only) — v1

**Status**: Draft
**Created**: 2026-06-03
**Supersedes**: —
**Related plan**: .sdd/plans/atlassian-integration-v1.md

---

## Overview

cosmos gains two first-class, **read-only** Atlassian integrations — **Jira** and
**Confluence** — modeled on the just-shipped Slack integration. Each is **fully separate**:
its own single **"Connect Jira"** / **"Connect Confluence"** button (a browser OAuth flow —
no tokens are ever pasted or typed), its own connection state machine, its own encrypted
token store entry, its own status, its own native panel, and its own set of read-only MCP
tools the embedded Claude Code can call. The two integrations may share the generic Atlassian
OAuth machinery (authorize/token endpoints, the existing PKCE foundation, cloudId resolution,
token refresh) but are otherwise decoupled — there is no cross-product UI and no unified search.

cosmos uses its OWN registered Atlassian OAuth client (`client_id` from env), owns the OAuth
flow, owns and securely stores the resulting tokens (access + refresh, encrypted at rest), and
brokers every Jira/Confluence request through a single per-integration connection in the main
process. Users do NOT register their own Atlassian app or handle any token.

This reuses the **Third-Party Integration Foundation** (ARCHITECTURE §4.7) that Slack
established, and adds three real divergences from Slack that this spec calls out: (1) Atlassian
issues **expiring access tokens + refresh tokens**, so cosmos must refresh on expiry/401 and
only flip to `reconnect_needed` when refresh itself fails; (2) reads require resolving a
**cloudId** (the Atlassian site identifier) before any Jira/Confluence API call; and (3)
Atlassian's standard 3LO may **require a `client_secret`** at token exchange — so the
secret-less PKCE attempt has a documented, explicit env-var fallback (see FR-A03, Open Questions).

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).
> Scenarios are written generically over "the product" where Jira and Confluence behave
> identically; product-specific read surfaces are split into their own scenarios.

### Connect Jira / connect Confluence · P1

**As a** cosmos user
**I want to** connect my Atlassian Jira (and, separately, my Confluence) to cosmos through a guided sign-in
**So that** cosmos can read Jira/Confluence on my behalf without me handling tokens manually

**Acceptance criteria:**

- Given the Jira panel shows a not-connected state, when I click the single **"Connect Jira"** button (no tokens to paste or type), then cosmos opens the Atlassian authorization page for cosmos's own OAuth client in my system browser and waits for me to approve.
- Given the Confluence panel shows a not-connected state, when I click the single **"Connect Confluence"** button, then the same happens for Confluence, **independently** of Jira (connecting one does not connect the other).
- Given I approve in the browser, when Atlassian redirects back, then cosmos captures the authorization code, exchanges it for an access token + refresh token, resolves my site's **cloudId**, stores the token set securely at rest (encrypted), and the panel switches to a connected state showing my Atlassian site/account.
- Given the request only declares read scopes, when I review the Atlassian consent screen, then the requested permissions are read-only (no create/edit/delete) plus `offline_access` (to obtain a refresh token).

### Cancel or fail the connection gracefully · P1

**As a** cosmos user
**I want to** the app to stay calm if I abandon or fail sign-in
**So that** a cancelled or broken OAuth never leaves cosmos in a bad state

**Acceptance criteria:**

- Given the authorization page is open, when I close it or click "Cancel"/"Deny", then cosmos returns the affected integration to the not-connected state with a clear, non-alarming message and no token is stored.
- Given the redirect returns an error or an unexpected/mismatched state value, when cosmos handles it, then the attempt is rejected, no token is stored, and the panel explains it could not connect.
- Given cosmos is not configured with the required client credentials (env vars unset), when I click Connect, then it fails fast with a clear "not configured" message and the panel stays not-connected (no token is fabricated).

### Search and view Jira issues in the native panel · P1

**As a** cosmos user
**I want to** search my Jira issues and open one to read its details
**So that** I can review work items from inside cosmos

**Acceptance criteria:**

- Given Jira is connected, when I enter a JQL query in the Jira panel, then it lists matching issues (issue key, summary, status, assignee) and lets me page through more results.
- Given a list of results, when I open a single issue, then the panel shows its summary, status, assignee, reporter, description, and comments in order.
- Given I open a Jira panel with no query yet, when the panel loads, then it shows an idle/empty prompt to enter a query (it performs no read until I ask).

### Search and view Confluence content in the native panel · P1

**As a** cosmos user
**I want to** search Confluence content and open a page to read it
**So that** I can review documentation from inside cosmos

**Acceptance criteria:**

- Given Confluence is connected, when I enter a search query in the Confluence panel, then it lists matching content (title, space, excerpt) and lets me page through more results.
- Given a list of results, when I open a single page, then the panel shows its title, space, and body/excerpt.
- Given I open a Confluence panel with no query yet, when the panel loads, then it shows an idle/empty prompt to enter a query (it performs no read until I ask).

### Claude reads Jira / Confluence via MCP tools · P1

**As a** cosmos user
**I want to** the embedded Claude to read Jira (search issues, view an issue) and Confluence (search content, view a page) through tools
**So that** Claude can reason over my Atlassian content as part of a task

**Acceptance criteria:**

- Given Jira is connected, when Claude calls a Jira read tool (search issues by JQL, get one issue), then cosmos services it through the same stored Jira connection and returns the result as the tool result.
- Given Confluence is connected, when Claude calls a Confluence read tool (search content, get one page), then cosmos services it through the same stored Confluence connection and returns the result as the tool result.
- Given the relevant product is NOT connected, when Claude calls any of its tools, then the tool returns a clear "not connected — connect Jira/Confluence in cosmos first" result instead of an error stack or a hang.
- Given a tool result would benefit from interaction, when Claude chooses to, then it MAY render the result through the existing render_ui/A2UI panel (the Atlassian tools and render_ui compose; the Atlassian tools do not introduce a second UI channel).

### Silent token refresh, then reflect a dead connection · P2

**As a** cosmos user
**I want to** cosmos to refresh my Atlassian access token automatically and only prompt me to reconnect when refresh truly fails
**So that** an expiring Atlassian token does not interrupt me unnecessarily, but a dead connection is surfaced clearly

**Acceptance criteria:**

- Given the stored access token is expired (or a read returns 401), when the panel or an MCP tool makes a request, then cosmos transparently refreshes the access token using the stored refresh token, persists the rotated token set, and completes the read without prompting me.
- Given the refresh attempt itself fails (refresh token rejected/expired/revoked), when cosmos handles it, then it surfaces a "reconnect needed" state for that integration (panel prompts re-connect; tool returns a "reconnect needed" result) and does not crash.

### Disconnect · P2

**As a** cosmos user
**I want to** disconnect Jira (or Confluence) from cosmos independently
**So that** my tokens are removed when I no longer want cosmos reading that product

**Acceptance criteria:**

- Given Jira is connected, when I choose "Disconnect" in the Jira panel, then the stored Jira token set is deleted from cosmos, the Jira panel returns to not-connected, and subsequent Jira panel/tool reads report not-connected until I reconnect — **without affecting** the Confluence connection (and vice-versa).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.
> FR groups: **A** = shared Atlassian OAuth/connection foundation; **J** = Jira-specific;
> **C** = Confluence-specific; **X** = cross-cutting consistency.

### Group A — Shared Atlassian OAuth, cloudId, token refresh & connection (foundation reuse)

| ID      | Requirement                                                                                                  |
|---------|--------------------------------------------------------------------------------------------------------------|
| FR-A01  | cosmos MUST own the Atlassian OAuth **authorization-code flow with PKCE (S256)** in the **main process**, reusing the existing generic PKCE foundation (`src/main/integrations/oauthPkce.ts`: loopback `127.0.0.1` ports **7421 → 7422 → 7423**, path `/callback`, `onListening` to assemble the exact `redirect_uri` and open the browser, `exchangeCodeRaw` for the token POST). The renderer and the embedded Claude MUST NOT perform the OAuth exchange themselves. |
| FR-A02  | cosmos MUST open the Atlassian authorization URL in the user's **system browser** (`shell.openExternal`, not inside the renderer/webview) against `https://auth.atlassian.com/authorize`, sending `audience=api.atlassian.com`, `client_id` (from env — FR-A04), `scope` (space-delimited read scopes + `offline_access` — see Scopes), `redirect_uri` (the exact bound loopback URI), `response_type=code`, `prompt=consent`, `state` (per-attempt CSRF value), `code_challenge`, and `code_challenge_method=S256`. cosmos MUST request **read-only** scopes only (plus `offline_access`). |
| FR-A03  | cosmos MUST exchange the authorization code at `https://auth.atlassian.com/oauth/token` server-side in the main process (POST `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`). cosmos MUST **first attempt the exchange WITHOUT a `client_secret`** (public client + PKCE, exactly like Slack). If Atlassian rejects the secret-less exchange, cosmos MUST fall back — as an **explicit, documented branch (never silent)** — to including a `client_secret` read from the `COSMOS_ATLASSIAN_CLIENT_SECRET` environment variable (gitignored `.env`, main-process only) in the token POST ONLY. The `client_secret` MUST NEVER be logged, and MUST NEVER appear in any IPC payload, bridge frame, or MCP tool result. `[NEEDS CLARIFICATION — see Open Questions: Atlassian's standard 3LO documentation states a client_secret is required at token exchange; verify whether secret-less PKCE is accepted for any client type before relying on the no-secret path.]` |
| FR-A04  | The OAuth client's `client_id` MUST be read from the `COSMOS_ATLASSIAN_CLIENT_ID` environment variable (never hardcoded), shared by both Jira and Confluence connections. If `COSMOS_ATLASSIAN_CLIENT_ID` is unset, Connect MUST fail fast with a clear "not configured" message and the panel MUST stay not-connected (no token fabricated). |
| FR-A05  | cosmos MUST generate a PKCE `code_verifier`/`code_challenge` pair (S256) per attempt and a cryptographically random **`state`** per attempt, and MUST reject any callback whose `state` does not match the pending attempt (CSRF / stray-callback protection — provided by the foundation). |
| FR-A06  | cosmos MUST capture the OAuth redirect via the foundation's short-lived loopback `http://127.0.0.1:<port>/callback` listener, trying ports 7421 → 7422 → 7423 in order, using the exact bound port's URI as `redirect_uri`, and MUST shut the listener down once the code arrives or the attempt ends (timeout included — never hold a port open indefinitely). |
| FR-A07  | After a successful token grant, cosmos MUST resolve the Atlassian **cloudId** via `GET https://api.atlassian.com/oauth/token/accessible-resources` (Bearer access token) and persist the chosen cloudId as part of the connected state, so subsequent reads can target `https://api.atlassian.com/ex/jira/{cloudId}/...` (Jira) and `https://api.atlassian.com/wiki/{cloudId}/...` (Confluence). If accessible-resources returns **no** site, Connect MUST fail with a clear message and store no connection. `[NEEDS CLARIFICATION — see Open Questions: which site to use when the grant returns multiple accessible resources; v1 assumption documented below.]` |
| FR-A08  | cosmos MUST persist each integration's token set **at rest encrypted via Electron `safeStorage`** (OS keychain-backed), reusing `src/main/integrations/tokenStore.ts`. The persisted set MUST include the access token, the **refresh token**, the access-token expiry, the granted scopes, the resolved cloudId, and the non-secret account/site identity. The token set MUST NOT be written to disk in plaintext. Jira and Confluence MUST each have their **own separate** encrypted store entry (e.g. distinct file paths), so they connect/disconnect independently. |
| FR-A09  | Atlassian access tokens **expire** (~1h) and Atlassian issues **refresh tokens** (granted via `offline_access`). cosmos MUST refresh the access token using the stored refresh token when the access token is expired (or a read returns 401), persisting the rotated token set (Atlassian rotates the refresh token on each refresh), and MUST complete the in-flight read transparently after a successful refresh — WITHOUT moving to `reconnect_needed`. This is a real divergence from Slack's non-expiring user token. |
| FR-A10  | cosmos MUST flip an integration to **`reconnect_needed`** ONLY when the refresh itself fails (refresh token rejected/expired/revoked) or when no refresh token is available to recover a rejected access token. In `reconnect_needed`, both surfaces MUST prompt/return "reconnect needed" and MUST NOT crash. |
| FR-A11  | The stored tokens (access + refresh) and the `client_secret` MUST NEVER be exposed to the renderer or to the embedded Claude's sandbox in plaintext: the renderer and the MCP tools request **operations**; the main process attaches the token. No connect IPC carries an inbound token (no token is ever sent into cosmos). |
| FR-A12  | cosmos MUST expose each integration's connection status (not-connected, connecting, connected with site/account identity, reconnect-needed, and a `lastError` when a connect attempt ends back at not-connected) and the connect / disconnect operations to the renderer over a typed IPC channel set following the `src/shared/ipc.ts` pattern, surfaced through the `contextBridge` preload as dedicated `window.cosmos.jira` and `window.cosmos.confluence` namespaces (alongside, not merged into, `pty`, `ui`, and `slack`). |
| FR-A13  | For each product, a **single main-process API client + manager MUST be the only place** that product's API is called from; both the native panel (via IPC) and the MCP tools (via the bridge) MUST route through it so they share one connection, one cloudId, and one token. There MUST be **two separate** managers/clients (Jira, Confluence) — they MAY share the generic OAuth/refresh/cloudId helpers but MUST NOT share connection state. |
| FR-A14  | "Disconnect" MUST delete the affected integration's stored token set and return that integration to not-connected, leaving the other integration untouched; after disconnect, that product's panel and tool reads MUST report not-connected until reconnection. |
| FR-A15  | The Atlassian OAuth orchestration MUST be implemented as thin per-product orchestrators over the existing foundation (mirroring `slackOAuth.ts`), reusing the foundation's PKCE/loopback/token-exchange/refresh and `tokenStore` so no OAuth/storage mechanics are re-derived (FR-010/SC-012 of the Slack spec). New shared Atlassian helpers (endpoints, scopes, cloudId resolution, refresh wiring) MAY be added as foundation-level modules used by both products. |

### Group J — Jira (read-only)

| ID      | Requirement                                                                                                  |
|---------|--------------------------------------------------------------------------------------------------------------|
| FR-J01  | The Jira integration MUST request the read-only scopes `read:jira-work`, `read:jira-user`, plus `offline_access` — and NO write/manage scope. |
| FR-J02  | cosmos MUST provide a native **Jira panel** (`src/renderer/JiraPanel.tsx`, React) with its own controls, distinct from the Generated-UI (A2UI) panel and from the Slack/Confluence panels, showing connection state and the Jira read surfaces below. |
| FR-J03  | When not connected, the Jira panel MUST show a connect affordance and MUST NOT attempt Jira reads. |
| FR-J04  | When connected, the Jira panel MUST be able to: **search issues by JQL** (returning issue key, summary, status, and assignee) with pagination, and **open a single issue** to read its summary, status, assignee, reporter, description, and comments (in order). |
| FR-J05  | The Jira panel MUST render loading, idle/empty, and error states for each read surface so a slow or failed Jira call degrades gracefully (never a blank or crashed panel). |
| FR-J06  | cosmos MUST expose a set of **read-only Jira MCP tools** to the embedded `claude` session covering at least: **search issues (JQL)** and **get one issue** (its full detail per FR-J04). Each Jira MCP tool MUST be read-only (no create/transition/edit/delete) and, when Jira is not connected (or reconnect is needed), MUST return a clear, structured "not connected / reconnect needed — connect Jira in cosmos first" result rather than hanging or erroring. |
| FR-J07  | The single Jira API client MUST target `https://api.atlassian.com/ex/jira/{cloudId}/...` using the stored cloudId and Bearer access token (search via Jira's JQL search endpoint; issue detail via Jira's issue endpoint, including comments). It MUST be **read-only** — no method that creates/transitions/edits/deletes. |

### Group C — Confluence (read-only)

| ID      | Requirement                                                                                                  |
|---------|--------------------------------------------------------------------------------------------------------------|
| FR-C01  | The Confluence integration MUST request the read-only scopes `read:confluence-content.all`, `read:confluence-space.summary`, `search:confluence`, plus `offline_access` — and NO write/manage scope. `[NEEDS CLARIFICATION — see Open Questions: confirm these exact "classic" scope strings (and whether granular scopes are required for cosmos's app) against Atlassian's current scope list at exchange time.]` |
| FR-C02  | cosmos MUST provide a native **Confluence panel** (`src/renderer/ConfluencePanel.tsx`, React) with its own controls, distinct from the Generated-UI (A2UI) panel and from the Slack/Jira panels, showing connection state and the Confluence read surfaces below. |
| FR-C03  | When not connected, the Confluence panel MUST show a connect affordance and MUST NOT attempt Confluence reads. |
| FR-C04  | When connected, the Confluence panel MUST be able to: **search content** (returning title, space, and excerpt) with pagination, and **open a single page** to read its title, space, and body/excerpt. |
| FR-C05  | The Confluence panel MUST render loading, idle/empty, and error states for each read surface so a slow or failed Confluence call degrades gracefully (never a blank or crashed panel). |
| FR-C06  | cosmos MUST expose a set of **read-only Confluence MCP tools** to the embedded `claude` session covering at least: **search content** and **get one page** (its detail per FR-C04). Each Confluence MCP tool MUST be read-only and, when Confluence is not connected (or reconnect is needed), MUST return a clear, structured "not connected / reconnect needed — connect Confluence in cosmos first" result rather than hanging or erroring. |
| FR-C07  | The single Confluence API client MUST target `https://api.atlassian.com/wiki/{cloudId}/...` using the stored cloudId and Bearer access token (search via Confluence's search endpoint; page detail via Confluence's content/page endpoint with the body expansion). It MUST be **read-only** — no method that creates/edits/deletes. |

### Group X — Cross-cutting (consistency with cosmos conventions)

| ID      | Requirement                                                                                                  |
|---------|--------------------------------------------------------------------------------------------------------------|
| FR-X01  | Each product MUST expose its read operations as **read-only MCP tools** registered with the embedded session the same way `render_ui` / the Slack tools are — via the main-managed `--mcp-config` (no project-approval gate) — and reaching main over the **same NDJSON-over-Unix-socket bridge pattern** as render_ui/Slack. There MUST be **two MCP servers and two bridges** (one per product), each a sibling to `slackBridge`/`slackMcpServer`, each owning its own pending-call state and threaded its own socket env var. |
| FR-X02  | MCP tool results MUST NOT include any access token, refresh token, `client_secret`, or other secret; they return only Jira/Confluence content/metadata the user could see in the product. |
| FR-X03  | The Atlassian MCP tools MUST be independent of the render_ui channel: they return data as tool results, and Claude MAY separately call `render_ui` to display that data. cosmos MUST NOT introduce a second/competing UI-generation channel for Jira or Confluence. |
| FR-X04  | The main process MUST validate every inbound IPC payload from the renderer and every inbound bridge frame from the MCP tools at the boundary with pure validators (mirroring the `validateSlack*` family); an invalid/missing-field payload MUST log a warning and be safely ignored (no crash, never resolve the wrong call). |
| FR-X05  | The renderer MUST continue to run with `contextIsolation: true` and `nodeIntegration: false`; all new Jira/Confluence capability reaches the renderer ONLY through the `contextBridge` preload. |
| FR-X06  | All Jira/Confluence IPC channel names, bridge op discriminators, MCP tool names, and DTO/param types MUST be centralized in `src/shared/` (e.g. `src/shared/jira.ts`, `src/shared/confluence.ts`, plus additions to `ipc.ts`/`bridge.ts`) — never ad hoc string literals — following the existing single-source-of-truth contract. Each product's read result MUST be a discriminated `Result<T>` (success data or a structured error) mirroring `SlackResult<T>` so both surfaces branch on `ok` and degrade gracefully. |
| FR-X07  | Atlassian API failures (network error, HTTP error, rate-limit `429`) MUST be handled so the panel and the tools degrade gracefully: surface a recoverable error state / structured error result, and on rate-limit respect Atlassian's `Retry-After` rather than tight-looping; never crash the app. A 401 MUST trigger the refresh path (FR-A09) before being treated as an error. |

## OAuth Scopes (read-only)

cosmos requests **read-only** scopes only, plus `offline_access` (to receive a refresh token).
v1 grants no write capability for either product. Each product requests only its own scopes on
its own connection.

### Jira

| Scope            | Purpose in v1                                                            |
|------------------|-------------------------------------------------------------------------|
| `read:jira-work` | Search issues (JQL) and read issue detail incl. comments (FR-J04, FR-J06). |
| `read:jira-user` | Resolve assignee/reporter user info on an issue (FR-J04).               |
| `offline_access` | Obtain a refresh token so cosmos can refresh the expiring access token (FR-A09). |

### Confluence

| Scope                             | Purpose in v1                                              |
|-----------------------------------|-----------------------------------------------------------|
| `read:confluence-content.all`     | Read page content incl. body (FR-C04, FR-C06).            |
| `read:confluence-space.summary`   | Read the space summary shown alongside a page (FR-C04).  |
| `search:confluence`               | Search content (FR-C04, FR-C06).                          |
| `offline_access`                  | Obtain a refresh token (FR-A09).                          |

Notes / assumptions:
- The Confluence scope strings above are Atlassian's **"classic" 3LO scopes**, which Atlassian's
  current documentation recommends and which match this read surface (verified against Atlassian's
  Confluence OAuth scopes doc at spec time). If cosmos's registered app is forced onto **granular
  scopes**, the equivalents are `read:content:confluence` (for `read:confluence-content.all`) and a
  space-details granular scope; this is flagged in Open Questions and must be confirmed against the
  app's actual scope list at exchange time (FR-C01).
- No **cross-product search** is in scope (the user explicitly declined a unified search box). Jira
  search uses JQL against the Jira API; Confluence search uses the Confluence search API; they are
  never combined.

### One-time Atlassian app prerequisites (operability)

The OAuth client behind `COSMOS_ATLASSIAN_CLIENT_ID` must be configured ONCE in its Atlassian
developer-console app, or the flow fails:

1. **Enable OAuth 2.0 (3LO)** and add the **Jira** and **Confluence** APIs with exactly the
   read scopes above (plus `offline_access`).
2. **Allowlist the three loopback callback URLs**: `http://127.0.0.1:7421/callback`,
   `http://127.0.0.1:7422/callback`, `http://127.0.0.1:7423/callback` (the port-fallback set).
3. cosmos must run with `COSMOS_ATLASSIAN_CLIENT_ID=<id>` set. **If** Atlassian rejects the
   secret-less token exchange (FR-A03), cosmos additionally requires `COSMOS_ATLASSIAN_CLIENT_SECRET=<secret>`
   in a gitignored `.env`, read only in the main process and never logged or transmitted off-process.

## Edge Cases & Constraints

- **Not yet connected** → the product's panel shows a connect affordance and performs no reads (FR-J03/FR-C03); every MCP tool for that product returns "not connected" (FR-J06/FR-C06).
- **User cancels / denies OAuth, or closes the browser** → return that product to not-connected with a clear message; no token stored.
- **OAuth `state` mismatch or error redirect** → reject the callback, store nothing, report failure (FR-A05).
- **Loopback callback never arrives (user abandons)** → the temporary listener times out and shuts down; the product returns to not-connected rather than holding a port open (FR-A06).
- **Not configured** (`COSMOS_ATLASSIAN_CLIENT_ID` unset, or secret required but `COSMOS_ATLASSIAN_CLIENT_SECRET` unset on the fallback path) → Connect fails fast with a clear "not configured" message; no token fabricated (FR-A04, FR-A03).
- **Secret-less exchange rejected by Atlassian** → cosmos retries the exchange with the env `client_secret` as an explicit, logged-at-debug (never the secret itself) documented branch; if the secret is also absent/invalid, Connect fails with a clear configuration message (FR-A03).
- **No accessible Atlassian site** (accessible-resources empty) → Connect fails with a clear message and stores no connection (FR-A07).
- **Multiple accessible sites** → v1 uses the first/only site returned and records its cloudId; multi-site selection is deferred (Open Questions, FR-A07).
- **Access token expired / 401 on a read** → cosmos refreshes transparently using the refresh token and retries the read once; the user is not prompted (FR-A09).
- **Refresh fails (refresh token rejected/expired/revoked)** → surface `reconnect_needed` for that product in both surfaces; never crash (FR-A10).
- **Network failure / Atlassian HTTP error** → recoverable error state in the panel; structured error tool result for MCP; no crash (FR-X07).
- **Atlassian rate limit (`429`)** → respect `Retry-After`; surface a "try again shortly" state rather than tight-looping or crashing (FR-X07).
- **Invalid IPC / bridge payload** → warn + ignore at the main boundary; never resolve the wrong call, never crash (FR-X04).
- **Explicitly out of scope (deferred to a later version):**
  - **All write actions** — creating/editing/transitioning/deleting Jira issues, posting comments, creating/editing Confluence pages, labels, etc. v1 is strictly read-only (no write scope is ever requested).
  - **Cross-product / unified search** (explicitly declined by the user).
  - Any **shared** Jira+Confluence UI or a single combined connection — the two integrations are fully separate.
  - Multi-site selection when a grant spans multiple Atlassian sites (v1 uses one cloudId).
  - Jira boards/sprints/agile surfaces, attachments, work logs, custom-field rendering beyond plain description/comments; Confluence attachments, comments, page trees/hierarchy navigation, and macro rendering beyond body/excerpt.
  - Real-time updates / webhooks; v1 reads on demand only.
  - Caching/persistence of Atlassian content beyond what a view needs in-session.

## Success Criteria

| ID      | Criterion                                                                                              |
|---------|-------------------------------------------------------------------------------------------------------|
| SC-001  | From a not-connected state, a user can click a single "Connect Jira" (and, separately, "Connect Confluence") button (no token paste), complete the browser PKCE OAuth flow, resolve a cloudId, and reach a connected state showing their Atlassian site/account — with the access + refresh token set stored encrypted via safeStorage (never plaintext on disk), and the two connections fully independent. |
| SC-002  | Cancelling, denying, timing out, a `state`-mismatched attempt, an unconfigured client, or no accessible site returns that integration to not-connected with a clear message and stores no token. |
| SC-003  | The token exchange first attempts secret-less PKCE; if rejected, it falls back — as an explicit, documented branch — to including `COSMOS_ATLASSIAN_CLIENT_SECRET` in the main-process token POST only, and that secret never appears in any log, IPC payload, bridge frame, or MCP result. |
| SC-004  | A connected user can, in the Jira panel, search issues by JQL (paginated; key/summary/status/assignee) and open one issue to read summary/status/assignee/reporter/description/comments. |
| SC-005  | A connected user can, in the Confluence panel, search content (paginated; title/space/excerpt) and open one page to read title/space/body. |
| SC-006  | The embedded Claude can call the read-only Jira MCP tools (search issues, get issue) and the read-only Confluence MCP tools (search content, get page) and receive results through the matching stored connection. |
| SC-007  | When a product is not connected or its refresh fails, both that product's panel and its MCP tools report a clear "connect / reconnect needed" state — no crash, no hang, no stack trace. |
| SC-008  | An expired access token (or a 401 read) is refreshed transparently with the stored refresh token, the rotated token set is persisted, and the read completes without prompting the user; only a failed refresh flips to reconnect_needed. |
| SC-009  | No access token, refresh token, or client_secret is ever delivered to the renderer or the embedded Claude sandbox; the panels and tools request operations and main attaches the token. |
| SC-010  | Network errors, Atlassian HTTP errors, and `429` rate limits are handled gracefully (recoverable state / structured result, `Retry-After` respected); the app never crashes from an Atlassian failure. |
| SC-011  | "Disconnect" deletes only that product's stored token set; afterwards that product's panel and tools report not-connected until reconnection, and the other product's connection is unaffected. |
| SC-012  | No v1 path performs any Jira/Confluence write/mutation, and no write scope is requested at OAuth time (only the read scopes plus `offline_access`); read-only guarantee for both products. |
| SC-013  | Jira and Confluence reuse the Slack-established integration foundation (PKCE/loopback OAuth, safeStorage token store, single-main-client-serving-both-surfaces, NDJSON socket bridge) without re-implementing OAuth/storage mechanics, adding only Atlassian-specific endpoints/scopes/cloudId/refresh wiring. |

## Architecture Impact (for the Plan step — do not edit ARCHITECTURE.md in Specify)

This feature is the **second and third concrete integrations** built on the §4.7 foundation and
the first to exercise expiring tokens + refresh and cloudId resolution. The Plan step MUST update
`docs/ARCHITECTURE.md` to capture, at minimum:

- A new **§4.9 Atlassian Integrations (Jira + Confluence)** section, parallel to §4.8 Slack,
  describing the two fully-separate connections, the shared Atlassian OAuth/cloudId/refresh
  helpers, the two panels, and the two MCP servers/bridges.
- Generalizing §4.7's token-store note: the foundation now exercises its **refresh-token rotation**
  path (it was previously described but unused, since Slack's token does not expire) and adds
  **cloudId resolution** as a post-grant step a provider may require.
- Confirming the "registry of MCP tools" generalization scales to **two more bridges/servers**
  (render_ui + slack + jira + confluence), each independent.
- The §4.7 update should note the **client_secret fallback** as a sanctioned, env-only,
  main-process-only deviation from the pure public-client model, used solely when a provider
  (Atlassian) rejects secret-less PKCE — without weakening the token-never-leaves-main invariant.

---

## Open Questions

- [x] **RESOLVED (Plan v1) — Atlassian Cloud 3LO requires `client_secret`.** Web-verified against
  `developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps`: Atlassian **Cloud** 3LO is a
  **confidential client** — the token exchange (and refresh) requires `client_secret`. PKCE-only
  public clients are a Server/DC feature, not Cloud. Resolution: cosmos keeps FR-A03's secret-less
  probe FIRST (so the code auto-adapts if Atlassian ever enables public clients) but the
  **`client_secret` branch is the expected active path** on Cloud. `COSMOS_ATLASSIAN_CLIENT_SECRET`
  (main-process only, gitignored `.env`, never logged/transmitted) MUST be set alongside
  `COSMOS_ATLASSIAN_CLIENT_ID`. cosmos still sends `code_challenge`/`code_verifier` (harmless; Cloud
  may ignore them). See `.sdd/plans/atlassian-integration-v1.md` (decision A).
- [ ] [NEEDS CLARIFICATION] **Exact Confluence scope strings / classic vs. granular.** FR-C01 uses
  the "classic" scopes `read:confluence-content.all`, `read:confluence-space.summary`,
  `search:confluence` (matched to Atlassian's Confluence OAuth scopes doc at spec time). Confirm the
  registered app can request classic scopes; if it is forced onto **granular** scopes, substitute
  `read:content:confluence` and the space-details granular scope (no exact 1:1 for `.summary`), and
  re-verify `search:confluence` is still the search scope. Resolve at the Plan step or first real
  consent.
- [ ] [NEEDS CLARIFICATION] **Multi-site (cloudId) selection.** When `accessible-resources` returns
  more than one Atlassian site, v1's assumption (FR-A07) is to use the first/only site and store its
  cloudId. Confirm this is acceptable for v1, or whether a site picker is needed (currently deferred).
- [ ] [NEEDS CLARIFICATION] **Exact Jira/Confluence read endpoints + pagination shape.** The clients
  will target `https://api.atlassian.com/ex/jira/{cloudId}/...` (JQL search + issue-with-comments)
  and `https://api.atlassian.com/wiki/{cloudId}/...` (content search + page-with-body). The precise
  endpoint versions (e.g. Jira `rest/api/3/search` vs. the newer JQL search endpoint; Confluence v1
  `rest/api` vs. v2 `wiki/api/v2`) and their pagination cursors should be pinned during the Plan step;
  they do not affect the behavior this spec defines.
