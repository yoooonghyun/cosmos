# Spec: Confluence MCP Write (Update Page + Comment) — v1

**Status**: Draft
**Scope decision (2026-06-23)**: The user confirmed the missing write is **two** tools —
`confluence_update_page` (this spec's original body) **and** a page-comment tool
(`confluence_create_comment`, added below in §Comment). Both ship together.
**Created**: 2026-06-23
**Supersedes**: none (extends the existing Confluence MCP write surface: `.sdd/specs/confluence-create-page-v1.md` and `.sdd/specs/atlassian-integration-v1.md`)
**Related plan**: `.sdd/plans/confluence-mcp-write-v1.md`

---

## Grounding

Grounding I ran directly for this spec (tools, not handed context):

**codegraph_explore / Read (code structure):**
- `codegraph_explore "Confluence MCP server tools registration fetch search getPage Atlassian REST client auth token"` → surfaced `confluenceMcpServer.ts`, `confluenceBridge.ts`, `confluenceManager.ts`, `confluenceClient.ts`. **Takeaway: the framing "Confluence MCP is READ-ONLY" is wrong — a `confluence_create_page` WRITE tool already ships end-to-end** (MCP tool → bridge `CreatePage` op → `ConfluenceManager.createPage` → `ConfluenceClient.createPage` → `POST /wiki/api/v2/pages`), with `write:page:confluence` scope gating + `write_not_authorized` short-circuit.
- Read `src/mcp/confluenceMcpServer.ts` — three registered tools today: `confluence_search_content`, `confluence_get_page`, `confluence_create_page` (the last MUTATES; model-mediated MCP tool, NOT the deterministic-action path the older `confluence-create-page-v1` spec proposed — the shipped reality is a real MCP write tool).
- Read `src/main/integrations/confluenceClient.ts` — `getPage` is `GET /wiki/api/v2/pages/{id}?body-format=view`; `createPage` resolves spaceKey→spaceId then `POST /wiki/api/v2/pages` with storage body. The error mapper (`mapConfluenceError`) and `call()` POST plumbing already exist and are directly reusable for an update PUT.
- Read `src/main/confluenceManager.ts` — `run()` token/refresh/`reconnect_needed` path; `getWriteCapability()` reads `write:page:confluence` from stored scopes; `createPage()` short-circuits to `write_not_authorized` without a client call when the scope is absent. An update follows the identical shape.
- Read `src/shared/confluence.ts` — `ConfluenceTool` / `ConfluenceOp` const maps, `ConfluenceCreateParams`/`ConfluenceCreateResult`, `CONFLUENCE_WRITE_SCOPE = 'write:page:confluence'`, `CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE`, `ConfluenceErrorKind` union (incl. `write_not_authorized`). **The write scope an update needs is already granted — no scope change.**
- Read `src/main/confluenceBridge.ts` + `src/shared/ipc/confluence.validate.ts` — bridge `handleCall` switch + `validateConfluenceCreate` pattern to mirror for update; `validateConfluenceBridgeCall` already accepts any op in the `ConfluenceOp` set.
- Read `src/main/integrations/atlassianText.ts` — `plainTextToStorage` (plain text → storage XHTML) is already the create body wrapper and is reused verbatim for update.
- Read `src/main/integrations/atlassianConfig.ts` — `CONFLUENCE_OAUTH_SCOPES` already includes `write:page:confluence` + `read:page:confluence`.
- Read `electron.vite.config.ts` — `confluenceMcpServer` is already a rollup `input`; **no new MCP server file → no new rollup input needed** (the add-a-server gotcha does not apply; this adds a tool to the existing server).

**WebFetch (Confluence Cloud REST API v2):**
- Confirmed `PUT /wiki/api/v2/pages/{id}` exists, OAuth scope `write:page:confluence` (already granted), and the update body carries `id`, `status`, `title`, `body: {representation, value}`, and a `version: { number }` where `number` must be the **current version + 1** (optimistic locking). The exact current-version read is `GET /wiki/api/v2/pages/{id}` (`version.number`). The precise version/conflict shape is pinned in the plan (§C) and flagged as an open question.

**memory_recall / memory_smart_search (prior decisions):**
- `memory_smart_search "Jira write generative UI write:jira-work scope ... Confluence write"` → the canonical Jira write decision: deterministic `jira.*` action binding, `JiraActionDispatcher`, only scope added was `write:jira-work`, **"Confluence stays read-only"** (that note predates the shipped `confluence_create_page` tool — superseded by it). **Takeaway: the precedent for a Confluence write tool already exists in-tree (create); update is a strict, lower-risk extension of it that needs no new scope and no new consent.**

---

## Overview

The Confluence MCP server already exposes a WRITE tool, `confluence_create_page` (it
creates pages and mutates Confluence). It does **not** expose any way to **update an
existing page** — the genuine gap behind the request "Confluence MCP에 write 기능 없는것
같더라 추가해줘". This feature adds a single new model-mediated MCP write tool,
`confluence_update_page`, that replaces the title and/or body of an existing page the
user already has access to, mirroring the existing create tool's auth, scope-gating, and
token-in-main posture. No new OAuth scope is required — the `write:page:confluence` scope
the create tool already requests authorizes the v2 page update.

## User Scenarios

> Each scenario is independently testable. Priorities: P1 (must), P2 (should), P3 (nice to have).

### Update an existing page's body · P1

**As a** user driving the embedded `claude` engine connected to Confluence
**I want to** ask the agent to update an existing Confluence page's content
**So that** I can revise a page without leaving cosmos or opening a browser

**Acceptance criteria:**

- Given Confluence is connected with the write scope and I give the agent a page id and
  new content, when the agent calls `confluence_update_page` with the page id, a title,
  and a new body, then cosmos replaces the page's body (and title) in Confluence and the
  tool result reports the updated page id, title, and the new version number.
- Given the update succeeds, then the agent receives a structured success result it can
  reference (id + title + version), and no token/secret appears in the result.

### Update only the title · P2

**As a** user
**I want to** rename a page without supplying a full new body
**So that** a small correction doesn't force me to re-send the whole body

**Acceptance criteria:**

- Given I supply a page id and a new title but no body, when the agent calls the tool,
  then the page is updated with the new title and its **existing body is preserved**
  (the current stored body is re-sent unchanged), and the result reports the new title and
  incremented version. [Resolution of how body is preserved is pinned in plan §C.]

### Concurrent-edit / stale-version conflict · P1

**As a** user
**I want** a stale update (someone else edited the page since it was read) to fail safely
**So that** I never silently clobber another person's change or crash the app

**Acceptance criteria:**

- Given the page was modified after cosmos last read its version, when the update is
  submitted with a now-stale version number and Confluence rejects it (409/version
  conflict), then the tool returns a recoverable, non-secret "the page changed — re-read
  and try again" error; no crash; no token leak.

### Not connected / reconnect needed / scope gap · P1

**As a** user whose connection is missing, expired, or lacks the write scope
**I want** a clear, recoverable message instead of a hang or crash
**So that** I know to (re)connect Confluence

**Acceptance criteria:**

- Given Confluence is not connected, when the agent calls `confluence_update_page`, then
  the tool returns a structured "connect Confluence in cosmos first" result; no write is
  attempted; no hang.
- Given the stored token lacks `write:page:confluence`, when the agent calls the tool,
  then the manager short-circuits to a `write_not_authorized` result with the existing
  "disconnect and reconnect Confluence to grant write access" message; no write attempted.
- Given the access token expired but refresh succeeds, when the agent calls the tool, then
  the update proceeds transparently; only a failed refresh flips to `reconnect_needed`.

### Unknown page / no permission · P1

**As a** user
**I want** an update to a nonexistent or read-only page to fail safely
**So that** the panel and agent never hang or white-screen

**Acceptance criteria:**

- Given the page id does not exist or the user lacks edit permission, when the agent calls
  the tool, then the tool returns a recoverable, non-secret error notice (mapped from the
  Confluence 403/404), the app does not crash, and no token/secret/stack trace leaks.

### REST failure is recoverable · P1

**As a** user
**I want** a Confluence REST failure to surface as a recoverable result
**So that** the agent flow never hangs

**Acceptance criteria:**

- Given the update REST call fails (400/403/404, 429, network), when the agent calls the
  tool, then the tool returns a recoverable, non-secret error result via the existing
  `mapConfluenceError` discipline (429 → `rate_limited` with Retry-After, 401/403 →
  `reconnect_needed`, else → `network`); no crash, hang, or secret leak.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST add the ability to **update an existing Confluence page**, performed by the Electron **main** process via a single new write path (`ConfluenceManager.updatePage` → a single new `ConfluenceClient.updatePage`), with no second write implementation. |
| FR-002 | Update MUST accept ONLY these fields: **page id** (required), **title** (required by the v2 update), **body** (OPTIONAL plain text — when present it replaces the body; when absent the page's existing body is preserved), and an OPTIONAL **versionMessage** (a short change note). No other fields (move/reparent, labels, restrictions, status transitions, attachments) are in scope. |
| FR-003 | The new write MUST be exposed as a **model-mediated MCP tool** named `confluence_update_page`, registered on the existing `confluenceMcpServer` entry, EXACTLY mirroring how `confluence_create_page` is registered (thin relay forwarding an `op` + params over the Confluence socket bridge to main). It MUST NOT introduce a new MCP server, a new entry script, or a new rollup `input` (the add-a-server gotcha does not apply). |
| FR-004 | The page **body** (when supplied) MUST be accepted as plain text and converted to Confluence **storage format** by the client before the REST call, reusing the existing pure `plainTextToStorage` helper (`src/main/integrations/atlassianText.ts`) unchanged — identical to the create path. |
| FR-005 | The tool name + its op + the param/result shapes MUST be the single contract shared by the entry script, the bridge, and the manager — centralized in `src/shared/confluence.ts` (a new `ConfluenceTool.UpdatePage` entry, a new `ConfluenceOp.UpdatePage`, and `ConfluenceUpdateParams` / `ConfluenceUpdateResult` types mirroring `ConfluenceCreateParams` / `ConfluenceCreateResult`), never an ad-hoc string literal. |
| FR-006 | Main MUST validate every `confluence_update_page` bridge frame at the boundary via a new pure `validateConfluenceUpdate` in `src/shared/ipc/confluence.validate.ts` (required `pageId` non-empty string; required `title` non-empty non-whitespace string; optional `body` a string when present; optional `versionMessage` a string when present). An invalid frame MUST be warned and safely ignored — `ConfluenceBridge.handleCall` MUST return the structured `invalidParams` result, never crash (FR-X04). |
| FR-007 | `ConfluenceBridge.handleCall` MUST route the new `ConfluenceOp.UpdatePage` to `ConfluenceManager.updatePage`, and the `ConfluenceBridgeManager` interface MUST gain an `updatePage` method, so the bridge contract stays the single source of truth (no ad-hoc op string). |
| FR-008 | `ConfluenceManager` MUST gain `updatePage(params)` that goes through the existing `getWriteCapability()` scope short-circuit and the existing `run()` token/refresh/`reconnect_needed` path, returning the same `ConfluenceResult<T>` discriminated union as every other operation. An update attempted with a token lacking `write:page:confluence` MUST short-circuit to `write_not_authorized` (no client call), reusing `CONFLUENCE_WRITE_NOT_AUTHORIZED_MESSAGE`. |
| FR-009 | The `ConfluenceClient` MUST gain `updatePage(auth, params)` issuing the update against **`PUT {base}/wiki/api/v2/pages/{id}`** (`base = https://api.atlassian.com/ex/confluence/{cloudId}`), with a JSON body carrying `id`, `status: 'current'`, `title`, `body: { representation: 'storage', value }`, and a `version: { number, message? }`. HTTP failures MUST be mapped via the existing `mapConfluenceError` discipline. It MUST return the updated page id, title, and the new version number. |
| FR-009a | The v2 update requires the **current version number** (optimistic locking: the submitted `version.number` MUST be current + 1) AND, when no new body is supplied, the existing body. The client MUST therefore first read the page (`GET {base}/wiki/api/v2/pages/{id}` — reusing the existing read plumbing) to obtain the current `version.number` and, when needed, the current body, then submit `version.number + 1`. The exact current-version/body read shape is pinned in plan §C. |
| FR-009b | A **version conflict** (Confluence rejects the update because the version moved underneath the read-then-write window — typically HTTP 409, possibly 400 with a version error) MUST be surfaced as a distinct, recoverable result so the agent can re-read and retry. This MAY reuse `network` with a clear message, or MAY introduce a `version_conflict` `ConfluenceErrorKind` — the choice is pinned in plan §C. Either way it MUST NOT crash or leak a secret. |
| FR-010 | This feature MUST add **NO new OAuth scope**: the v2 page update is authorized by `write:page:confluence`, which `CONFLUENCE_OAUTH_SCOPES` already requests (the create tool added it). Therefore an already-connected, write-capable user needs **NO re-consent / re-auth** to use update; a read-only-era token (granted before the write scope) short-circuits to `write_not_authorized` exactly as create does today. |
| FR-011 | The Atlassian Cloud 3LO **`client_secret`** (env `COSMOS_ATLASSIAN_CLIENT_SECRET`) MUST remain main-process only, NEVER logged, and NEVER placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. Adding update MUST NOT change this invariant. |
| FR-012 | Confluence access + refresh tokens MUST remain main-process only (encrypted via `safeStorage`), NEVER exposed to the renderer, the bridge, the MCP entry script, or the sandboxed `claude` child. No new type, param, or tool result introduced for update may carry a secret — every field MUST be non-secret content/identifier (`pageId`, `title`, `body`, `versionMessage`, the returned `version` number). The MCP entry script requests the OPERATION; main attaches the token. |
| FR-013 | All update failures (unknown/inaccessible page, version conflict, missing-required-field 400, permission 403, 404, `reconnect_needed`, `rate_limited`, `network`, `write_not_authorized`, not-connected) MUST be surfaced as recoverable, structured tool results and MUST NOT crash, hang, or expose a token/secret/stack trace. |
| FR-014 | Adding update MUST keep the existing Confluence tools (`confluence_search_content`, `confluence_get_page`, `confluence_create_page`), the read IPC handlers, the generative read/create surfaces, and the existing rollup inputs unchanged (no new server, no removed tool). |
| FR-015 | The update tool's `description` MUST clearly state that it MUTATES Confluence (replaces an existing page's content), what it needs (page id, title, optional plain-text body), that omitting body preserves the current body, and the recoverable failure states (page not found / no permission, version conflict — re-read and retry, write not authorized — reconnect, reconnect needed) — mirroring the explicit `confluence_create_page` description so the model uses it correctly and only when intended. |

## Edge Cases & Constraints

- **Update body + title** → both replaced; result reports new title + incremented version.
- **Update title only (no body)** → the client re-reads and re-sends the existing body so
  it is preserved (FR-002, FR-009a); the title and version change, the body does not.
- **Empty/whitespace page id or title** → no write dispatched (`validateConfluenceUpdate`
  warns + ignores; the bridge returns the structured `invalidParams` result) (FR-006).
- **Body supplied as empty string** → treated as an explicit "set body to empty"? or
  rejected like create rejects empty body? — pinned in plan §C / open question (default
  proposal: an empty/whitespace `body`, when the key is present, is treated as absent and
  the existing body is preserved, to avoid an accidental content wipe).
- **Unknown / inaccessible page id** → the current-version read (FR-009a) returns
  403/404 → mapped to `reconnect_needed` (403) / `network` (404) recoverable notice; no
  update attempted; never a crash.
- **Version conflict (concurrent edit)** → recoverable "page changed — re-read and retry"
  result (FR-009b); no clobber, no crash.
- **Token granted without `write:page:confluence`** (read-only-era token) →
  short-circuits to `write_not_authorized`; reads keep working (FR-008, FR-010).
- **Token expired mid-update** → `ConfluenceManager.run()`'s existing proactive/reactive
  refresh applies; only a failed refresh flips to `reconnect_needed` (FR-008, FR-013).
- **Rate limited (429)** → mapped to `rate_limited` with `Retry-After` honored (FR-009).
- **Security** → `client_secret` + tokens stay in main only (FR-011, FR-012); all new
  params and the tool result carry only non-secret content/identifiers.

**Explicitly out of scope (deferred):**

- **Delete** a page, **move/reparent**, page restrictions, labels, attachments, comments,
  status transitions (draft↔current), or version history navigation.
- **Append-to-page** as a distinct tool — an update with the full new body covers the
  primary need; a server-side append (read body, concatenate, write) is a possible v2 but
  adds read-merge complexity and is deferred (see Open Questions for the rationale).
- A native panel "Edit page" form / deterministic `confluence.update` action surface — this
  feature is the **MCP tool only** (the create surface work is a separate concern).
- Rich-text / markdown body (plain text → storage paragraphs only, identical to create).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A valid update (body and/or title) replaces the page content in Confluence and the tool result reports the updated id, title, and new version number; no `claude` re-spawn for the write; no token/secret in the result. |
| SC-002 | A title-only update (no body) preserves the existing body and increments the version. |
| SC-003 | A stale-version update surfaces a recoverable conflict result (no clobber, no crash). |
| SC-004 | An update while not-connected, needing-reconnect, or lacking `write:page:confluence` returns a structured, recoverable result and never hangs/crashes; no write attempted in the scope-gap/not-connected cases. |
| SC-005 | An update to an unknown/inaccessible page surfaces a recoverable, non-secret notice; no crash, hang, token, or stack trace leaks. |
| SC-006 | A Confluence REST failure (400/403/404, 429, network) surfaces a recoverable, non-secret result via `mapConfluenceError`. |
| SC-007 | No new type, param, tool result, IPC payload, bridge frame, or log line carries the access token, refresh token, or `client_secret`; and NO new OAuth scope is added (the existing `write:page:confluence` authorizes the update). |
| SC-008 | The new pure validator (`validateConfluenceUpdate`) and the manager/client update logic are unit-testable without Electron/network and never throw on malformed input. |

---

## Comment — `confluence_create_comment` (scope extension, 2026-06-23)

A second model-mediated MCP write tool adds a **footer comment** to an existing page,
mirroring the create/update tools' auth, scope-gating, and token-in-main posture. Unlike
update, comment requires a **NEW OAuth scope** (`write:comment:confluence`) that
`CONFLUENCE_OAUTH_SCOPES` did not previously request.

### Comment a page · P1

**As a** user driving the embedded `claude` engine connected to Confluence
**I want to** ask the agent to add a comment to an existing Confluence page
**So that** I can leave feedback without leaving cosmos

**Acceptance criteria:**

- Given Confluence is connected with the comment scope and I give the agent a page id and
  comment text, when the agent calls `confluence_create_comment` with the page id and a
  non-empty `body`, then cosmos posts a footer comment to that page and the tool result
  reports the new comment id and the page id; no token/secret appears in the result.
- Given the stored token lacks `write:comment:confluence` (any token granted before this
  scope was added), when the agent calls the comment tool, then the manager short-circuits
  to a `write_not_authorized` result with a comment-specific "disconnect and reconnect
  Confluence to grant comment access" message; no write attempted.
- Given the page id does not exist or is read-only, or a REST failure (429/network), when
  the agent calls the tool, then the tool returns a recoverable, non-secret error via the
  existing `mapConfluenceError` discipline; no crash, hang, or secret leak.

### Comment functional requirements

| ID     | Requirement |
|--------|-------------|
| FR-016 | The system MUST add the ability to add a **footer comment** to an existing page via a single new write path (`ConfluenceManager.createComment` → `ConfluenceClient.createComment`), exposed as the model-mediated MCP tool `confluence_create_comment` on the existing `confluenceMcpServer`. No new MCP server / rollup input. |
| FR-017 | The comment tool MUST accept ONLY `pageId` (required, non-empty) and `body` (required plain text, non-empty/non-whitespace, converted to storage XHTML by `plainTextToStorage`). No other fields (inline/anchored comments, threading/`parentCommentId`, blog posts, attachments) are in scope. |
| FR-018 | The client MUST issue `POST {base}/wiki/api/v2/footer-comments` with `{ pageId, body: { representation: 'storage', value } }` and return the new comment id + the page id. HTTP failures map via `mapConfluenceError`. |
| FR-019 | The comment tool MUST add the granular OAuth scope **`write:comment:confluence`** to `CONFLUENCE_OAUTH_SCOPES` (the footer-comment endpoint requires it). This is a **consent change**: every already-connected user (including write-capable ones) MUST disconnect + reconnect ONCE to grant it; until then the comment tool short-circuits to `write_not_authorized` (reads + page writes keep working). |
| FR-020 | `ConfluenceManager` MUST gate the comment on a SEPARATE capability check (`getCommentCapability()` reading `write:comment:confluence`), distinct from `getWriteCapability()` (page writes) — a token with only `write:page:confluence` MUST NOT be able to comment, and vice versa. |
| FR-021 | The comment params, op, tool name, and result MUST be centralized in `src/shared/confluence.ts` (`ConfluenceTool.CreateComment`, `ConfluenceOp.CreateComment`, `ConfluenceCommentParams`, `ConfluenceCommentResult`), validated at the bridge boundary by a new pure `validateConfluenceComment`, never an ad-hoc literal. The `client_secret` + tokens stay main-only and never appear in any param/result/log (FR-011/FR-012 apply unchanged). |

| ID     | Criterion |
|--------|-----------|
| SC-009 | A valid comment posts a footer comment and the result reports the new comment id + page id; no token/secret in the result. |
| SC-010 | A comment attempted without `write:comment:confluence` (a pre-scope token) short-circuits to `write_not_authorized` with the comment-specific message; no write attempted. The page-write scope alone does NOT authorize a comment. |

---

## Open Questions

- [x] **[RESOLVED 2026-06-23 — scope of write to add]** create-page already exists, so the
  missing write is scoped as **update an existing page** AND **add a page comment**. The user
  confirmed BOTH `confluence_update_page` and `confluence_create_comment` should ship (see the
  §Comment section above for the comment FRs). Append/delete remain out of scope.
- [ ] **[NEEDS CLARIFICATION — proposed resolution in plan §C, low risk]** Title-only update
  body preservation: the v2 update requires `title` and replaces content wholesale, so a
  title-only update must re-send the existing body. Proposal: the client always reads the
  page first (it needs the current version number regardless), and when no new body is
  supplied re-sends the current stored (storage-format) body. Confirm the read returns the
  raw storage body (vs. the `view` HTML the current `getPage` requests) — the update read
  MAY need `body-format=storage` rather than `view`. Pinned in plan §C.
- [ ] **[NEEDS CLARIFICATION — proposed resolution in plan §C]** Version-conflict
  representation: reuse `network` with a clear message, or add a dedicated
  `version_conflict` `ConfluenceErrorKind`. Proposal: add `version_conflict` for a precise,
  agent-actionable "re-read and retry" signal (one-line union extension, mirrors how
  `write_not_authorized` was added). Confirm at implementation time against the real
  Confluence 409/400 response shape.
- [ ] **[NEEDS CLARIFICATION — proposed resolution in plan §C]** Empty-body semantics:
  whether a present-but-empty `body` means "wipe the body" or "preserve". Proposal: treat
  empty/whitespace `body` as absent (preserve existing) to prevent an accidental content
  wipe; an intentional wipe is out of scope.
