# Spec: Confluence Create Page — v1

**Status**: Draft
**Created**: 2026-06-06
**Supersedes**: none (extends the read-only Confluence integration: `.sdd/specs/atlassian-integration-v1.md`, `.sdd/specs/slack-confluence-generative-ui-v1.md`)
**Related plan**: `.sdd/plans/confluence-create-page-v1.md`

---

## Overview

Add the ability to **create a Confluence page** from the cosmos Confluence panel. The
user opens a create form, fills space key + title + body (plus an optional parent page
id to create a child page), and submits; cosmos creates the page in Confluence and the
panel re-composes to show a confirmation / the created page. This is the **first
Confluence write** and departs from Confluence's read-only posture (Jira added writes the
same way). The write is triggered by a **deterministic form action** (`confluence.create`)
intercepted in main — never a model-mediated MCP tool — exactly mirroring the Jira
`jira.create` write path.

## User Scenarios

> Each scenario is independently testable. Priorities: P1 (must), P2 (should), P3 (nice to have).

### Create a page (no parent) · P1

**As a** cosmos user connected to Confluence
**I want to** create a new top-level page in a space from the Confluence panel
**So that** I can author content without leaving cosmos

**Acceptance criteria:**

- Given I am connected to Confluence with the write scope and I open the create form,
  when I enter a valid space key, title, and body and submit, then cosmos creates the page
  in Confluence and the Confluence panel re-composes to a fresh surface showing a success
  confirmation and the created page (title + space + body), with a new requestId.
- Given the create succeeds, then no `claude` process is spawned or re-invoked to perform
  the write or to compose the result surface.

### Create a child page (with parent) · P1

**As a** cosmos user
**I want to** create a page as a child of an existing page
**So that** the new page is nested under the right parent

**Acceptance criteria:**

- Given I supply a valid parent page id in addition to space key + title + body, when I
  submit, then cosmos creates the page as a child of that parent and the re-composed
  surface confirms the created page.
- Given I leave the parent id empty, when I submit, then cosmos creates a top-level page
  (no error, no warning attributable to the missing optional parent).

### Required field missing / invalid · P1

**As a** cosmos user
**I want** an empty or whitespace-only required field to be safely rejected
**So that** I never trigger a broken or partial create

**Acceptance criteria:**

- Given the space key, title, or body is empty/whitespace-only, when I submit, then no
  create is attempted; the form guards it surface-side and main's validator rejects it
  (warn + ignore), and the app does not crash.

### Not connected / reconnect needed / scope gap · P1

**As a** cosmos user whose connection is missing, expired, or lacks the write scope
**I want** a clear, recoverable message instead of a hang or crash
**So that** I know to (re)connect Confluence

**Acceptance criteria:**

- Given Confluence is not connected, when I submit a create, then the surface shows a
  structured "connect Confluence in cosmos first" notice; no write is attempted; no hang.
- Given the stored token lacks the Confluence write scope, when I submit a create, then
  the manager short-circuits to a `write_not_authorized` result and the surface shows a
  recoverable "reconnect Confluence to enable creating pages" notice pointing at the
  native Connect/Reconnect affordance; no write is attempted.
- Given the access token expired but refresh succeeds, when I submit, then the write
  proceeds transparently; only a failed refresh flips to `reconnect_needed` and surfaces a
  recoverable notice.

### REST failure is recoverable · P1

**As a** cosmos user
**I want** a Confluence REST failure to surface as a recoverable notice
**So that** the panel never hangs or white-screens

**Acceptance criteria:**

- Given the create REST call fails (e.g. invalid space, 400/403/404, 429, network), when
  I submit, then the surface re-composes with a recoverable, non-secret error notice; the
  app does not crash, hang, or leak a token/secret/stack trace.

### Open the create form · P2

**As a** cosmos user
**I want** an obvious way to open the create-page form from the Confluence panel
**So that** I can start authoring without typing an utterance

**Acceptance criteria:**

- Given I am connected to Confluence, when I activate the panel's "New page" affordance,
  then an empty create-page form surface is composed and rendered in the Confluence panel
  (deterministically, without invoking `claude`).
- Given I am not connected, then the "New page" affordance is disabled/hidden, consistent
  with the panel's existing connection-gated controls.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST support creating a new Confluence page, performed by the Electron **main** process via a single new write path (`ConfluenceManager.createPage` → the single `ConfluenceClient.createPage`), with no second write implementation. Confluence currently has NO write methods; these are the first. |
| FR-002 | Create MUST accept ONLY these fields: **space key** (required), **title** (required), **body** (required, plain text), and an **OPTIONAL parent page id**. When the parent id is supplied, the page MUST be created as a child of that parent; when absent, a top-level page is created in the space. No other fields (labels, restrictions, draft/publish status beyond default, templates) are in scope. |
| FR-003 | The page **body** MUST be submitted by the user as plain text and converted to Confluence **storage format** by the client before the REST call — mirroring how Jira's create converts plain text → ADF (`plainTextToAdf`). A new pure `plainTextToStorage` helper MUST live in `src/main/integrations/atlassianText.ts` (the inverse of the existing `storageToPlainText`), be unit-testable, and never throw on any input. |
| FR-004 | The create MUST be triggered by a **deterministic form action**, NOT a model-mediated MCP tool. A new bound action `confluence.create` MUST be added to a reserved **`confluence.*`** namespace (context `{ spaceKey, title, body, parentId? }`). It MUST be intercepted in **main at the `ui:action` boundary** and executed by a new **`ConfluenceActionDispatcher`**, WITHOUT spawning or re-invoking `claude` — exactly mirroring `JiraActionDispatcher` / `jira.create`. |
| FR-005 | The bound-action name + its required/optional context fields MUST be the single contract shared by main's dispatcher and the surface that emits it — centralized in `src/shared/confluence.ts` (a `ConfluenceBoundAction` const + an `isConfluenceBoundActionId` test + a `ConfluenceBoundActionRequest` type, mirroring `JiraBoundAction`), never an ad-hoc string literal. |
| FR-006 | Main MUST validate every `confluence.create` payload at the boundary (required `spaceKey`, `title`, `body` are non-empty/non-whitespace strings; optional `parentId` is a string when present) before dispatch, via new pure validators in `src/shared/validate.ts` (`validateConfluenceCreate`, wired into a `validateConfluenceBoundAction`). An invalid/unknown action MUST be warned and safely ignored (no write, no crash). |
| FR-007 | After a `confluence.create` resolves, the Confluence surface MUST reflect the result WITHOUT Claude re-composing it: the dispatcher MUST settle the pending render call as `cancel`, compose a result surface via a new **`ConfluenceSurfaceBuilder`**, and re-push `ui:render` with a FRESH `requestId` and `target: 'confluence'`. A success/error/scope-gap notice MUST be carried on the surface. On success the surface MUST show the created page (title + space + body, re-read where possible — mirroring the Jira post-write re-read). |
| FR-008 | `ConfluenceManager` MUST gain `createPage(params)` that goes through a new `getWriteCapability()` scope short-circuit and the existing `run()` token/refresh/`reconnect_needed` path, and MUST return the same `ConfluenceResult<T>` discriminated-union discipline as the existing reads so all callers branch on `ok`. A create attempted with a token lacking the Confluence write scope MUST short-circuit to a `write_not_authorized` `ConfluenceResult` (no client call). |
| FR-009 | The `ConfluenceClient` MUST gain `createPage(auth, params)` — the FIRST Confluence mutation — issuing the create against the Confluence Cloud REST API endpoint **`POST {base}/wiki/api/v2/pages`** (`base = https://api.atlassian.com/ex/confluence/{cloudId}`), with a JSON body carrying `spaceId`, `title`, `body` (storage representation), and `parentId` when present. HTTP failures MUST be mapped via the existing `mapConfluenceError` discipline (429 → `rate_limited`, 401/403 → `reconnect_needed`, else → `network`). It MUST return the created page id (and title) for the post-create re-read. |
| FR-009a | The Confluence v2 create endpoint requires the **numeric `spaceId`**, not the human space **key**. The client MUST resolve the user-supplied `spaceKey` to its `spaceId` before the create, via a v2 spaces lookup (**`GET {base}/wiki/api/v2/spaces?keys={spaceKey}`**), and surface an unknown/inaccessible key as a recoverable error notice (no crash). [NEEDS CLARIFICATION confirmed in plan §C.] |
| FR-010 | A new `confluence.*` op (`ConfluenceOp.CreatePage`) MUST be added to `src/shared/confluence.ts` and routed by `ConfluenceBridge.handleCall` to the manager's `createPage` — so the bridge contract stays the single source of truth. (No new MCP **tool** is added: Confluence MCP tools remain read-only; the write reaches main only via the deterministic IPC/bridge action path, per the read-only-MCP posture.) |
| FR-011 | A new generative **`CreatePageForm`** component MUST be added to the Confluence custom A2UI catalog (`src/renderer/confluenceCatalog/`), composed by `ConfluenceSurfaceBuilder`. Mirroring the Jira `CreateIssueForm`: each input MUST own its data-model binding (`useFormBinding`) and the submit MUST emit the `confluence.create` bound action (`useDispatchAction`), with surface-side submit guards that mirror main's validators (required fields non-empty; parent optional). |
| FR-012 | The Confluence panel (`src/renderer/ConfluencePanel.tsx`) MUST surface a way to **open** the create form (a connection-gated "New page" affordance) that composes an empty `CreatePageForm` surface deterministically in main (via a new `confluence:requestCreateForm` IPC → `ConfluenceSurfaceBuilder` → push `target: 'confluence'`), WITHOUT invoking `claude`. The panel's `SurfaceBridge` MUST allow a `confluence.create` action to reach main over the existing `ui:action` path (the existing handler already forwards actions; Confluence surfaces are otherwise display-only — this action is the deliberate exception, exactly like Jira). |
| FR-013 | This feature MUST add exactly ONE new OAuth scope: the Confluence write scope **`write:confluence-content`**, added to `CONFLUENCE_OAUTH_SCOPES` in `src/main/integrations/atlassianConfig.ts` alongside the existing read scopes + `offline_access` (all retained). No other scope may be added. `getWriteCapability()` MUST be true iff the stored token's granted scopes include `write:confluence-content`. |
| FR-014 | Because the granted scope set changes, an existing Confluence connection MUST be **disconnected + reconnected to re-consent** before a create can succeed (a read-only-era token lacks the write scope and short-circuits to `write_not_authorized`). This re-consent requirement, and registering `write:confluence-content` in the Atlassian developer console, MUST be documented as an explicit operational requirement (Jira added `write:jira-work` the same way). |
| FR-015 | The Atlassian Cloud 3LO **`client_secret`** (env `COSMOS_ATLASSIAN_CLIENT_SECRET`) MUST remain main-process only, NEVER logged, and NEVER placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. Adding the Confluence write MUST NOT change this invariant. |
| FR-016 | Confluence access + refresh tokens MUST remain main-process only (encrypted via `safeStorage`), NEVER exposed to the renderer, the bridge, the MCP entry script, or the sandboxed `claude` child. No new type, param, surface node, or action context introduced for create may carry a secret — every field MUST be non-secret content/identifier (`spaceKey`, `title`, `body`, `parentId`, the resolved `spaceId`/page id). The renderer/catalog requests the OPERATION; main attaches the token. |
| FR-017 | All create failures (invalid/unknown space key, missing-required-field 400, permission 403, 404, `reconnect_needed`, `rate_limited`, `network`, `write_not_authorized`, not-connected) MUST be surfaced as recoverable surface notices and MUST NOT crash, hang, or expose a token/secret/stack trace. A not-connected/reconnect-needed write MUST return the structured "connect/reconnect Confluence in cosmos first" result. |
| FR-018 | The create render MUST be treated as **display-only** (like all `target !== 'generated-ui'` renders): `UiBridge` settles it immediately on push so the composing path never blocks; the `confluence.create` action reaches main independently over `ui:action` (the same mechanism Jira relies on — the action still arrives after the render call settled). The dispatcher MUST verify this matches the Jira mechanism so the form action is never lost. |
| FR-019 | Adding create MUST keep the existing Confluence read tools (`confluence_search_content`, `confluence_get_page`), the read IPC handlers, and the generative read surface unchanged, and MUST keep the existing single `confluenceMcpServer` entry + `confluenceRenderUiServer` builds unchanged (no new rollup `input` — no new MCP server is introduced). |
| FR-020 | The deterministic create dispatch path MUST NOT spawn, kill, write to, or otherwise disturb the interactive Terminal PTY or the headless `AgentRunner` (channel independence, by construction — `ConfluenceActionDispatcher` is constructed with only the manager subset, a `cancelActive` hook, and a `pushRender` sink, mirroring `JiraActionDispatcher`). |

## Edge Cases & Constraints

- **Create with no parent** → top-level page in the space; the optional `parentId` is
  simply omitted from the REST body (FR-002). No error, no warning.
- **Create with parent** → child page under `parentId`; an invalid/inaccessible parent
  returns a recoverable error notice (FR-017), never a crash.
- **Unknown / inaccessible space key** → the `spaceKey`→`spaceId` resolution (FR-009a)
  fails (no match / 403/404); surfaced as a recoverable "couldn't find that space" notice;
  no create attempted.
- **Empty/whitespace space key, title, or body** → no write dispatched (surface guard +
  `validateConfluenceCreate`) (FR-002, FR-006).
- **Token granted without `write:confluence-content`** (read-only-era token) →
  short-circuits to `write_not_authorized`; surface shows the reconnect notice; reads keep
  working (FR-008, FR-014).
- **Token expired mid-create** → `ConfluenceManager.run()`'s existing proactive/reactive
  refresh applies to the create too; only a failed refresh flips to `reconnect_needed`
  (FR-008, FR-017).
- **Rate limited (429)** → mapped to `rate_limited` with `Retry-After` honored; surface
  shows "busy, retry shortly" (FR-009, FR-017).
- **REST 400 (invalid body / missing required)** → mapped via `mapConfluenceError` to
  `network`; surfaced as a recoverable create-failure notice; no crash (FR-017).
- **Unknown/invalid bound action** (e.g. `confluence.create` missing `title`) → warned +
  ignored at the main boundary; no write (FR-006).
- **Post-create re-render with no fresh detail** → if the new page id cannot be re-read,
  the dispatcher composes a best-effort notice-bearing surface carrying the success notice
  + submitted title (mirroring the Jira re-read-failure fallback) — never a crash (FR-007,
  FR-017).
- **Display-only settle vs. the action path** → the create render is settled on push
  (FR-018); the `confluence.create` action still reaches main over `ui:action` because
  that channel is independent of the (already-settled) render call — verified to match the
  Jira mechanism.
- **Security** → `client_secret` + tokens stay in main only (FR-015, FR-016); all new
  params, surface nodes, and action context carry only non-secret content/identifiers.

**Explicitly out of scope (deferred):**

- Editing/updating or deleting existing Confluence pages, page restrictions, labels,
  attachments, comments, or moving/reordering pages.
- A model-mediated Confluence **write** MCP tool (Confluence MCP tools stay read-only;
  the write is deterministic-action-only).
- Rich-text/markdown rendering of the body (plain text → storage paragraphs only,
  mirroring Jira's plain-text ADF).
- Multi-site selection, draft vs. publish workflows beyond a default published page, and
  template-based creation.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A valid create (with or without parent) creates the page in Confluence and re-composes a `target: 'confluence'` surface with a fresh requestId showing a success confirmation + the created page; no `claude` is spawned for the write or the result. |
| SC-002 | A create with an empty/whitespace required field (space/title/body) dispatches no write and does not crash (surface guard + `validateConfluenceCreate`). |
| SC-003 | A create with a missing optional parent produces a top-level page with no error or warning. |
| SC-004 | A create while not-connected, needing-reconnect, or lacking `write:confluence-content` returns a structured, recoverable notice and never hangs/crashes; no write is attempted in the scope-gap/not-connected cases. |
| SC-005 | A Confluence REST failure (invalid space, 400/403/404, 429, network) surfaces a recoverable, non-secret error notice; no crash, hang, token, or stack trace leaks. |
| SC-006 | The create render settles immediately on push (display-only), yet the `confluence.create` action still reaches main and is dispatched — verified to match the Jira settle-then-action mechanism. |
| SC-007 | No new type, param, surface node, action context, IPC payload, bridge frame, or log line carries the access token, refresh token, or `client_secret`; only `write:confluence-content` is added to the scope set, with all existing scopes + `offline_access` retained. |
| SC-008 | The new pure helpers/validators (`plainTextToStorage`, `validateConfluenceCreate`, `validateConfluenceBoundAction`) and the dispatcher are unit-testable without Electron/network and never throw on malformed input. |

---

## Open Questions

- [ ] [NEEDS CLARIFICATION — proposed resolution in plan §C, low risk] The exact
  Confluence write **scope string**: this spec adopts **`write:confluence-content`** (the
  classic 3LO write scope, the write analog of the existing classic read scopes
  `read:confluence-content.all` / `read:confluence-space.summary` / `search:confluence`).
  If the registered Atlassian app is forced onto **granular** scopes, substitute
  `write:page:confluence` (the granular page-write scope) — a one-line edit in
  `atlassianConfig.ts`, exactly as the read scopes already note for their granular
  substitutes. Confirm against the Atlassian developer console at implementation time.
- [ ] [NEEDS CLARIFICATION — proposed resolution in plan §C] The v2 create endpoint
  (`POST /wiki/api/v2/pages`) takes a numeric **`spaceId`**, but the user supplies a space
  **key**. The plan resolves this by a v2 spaces lookup (`GET /wiki/api/v2/spaces?keys=`)
  before the create. If a single round-trip is preferred, the alternative is the v1
  `POST /wiki/rest/api/content` (which accepts `space.key` directly) — but v1 content
  create is the legacy path; v2 is the current API and is chosen here for forward
  consistency with the existing v2 page read. Confirm the spaces-lookup shape at
  implementation time.
