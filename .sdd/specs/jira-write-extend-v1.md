# Spec: Jira Write Extend — Create & Update — v1

**Status**: Approved
**Created**: 2026-06-06
**Supersedes**: —
**Related plan**: .sdd/plans/jira-write-extend-v1.md

---

## Overview

Add two new Jira write operations — **create a new ticket** and **update an existing
ticket's fields** — to the cosmos Jira integration, reusing the deterministic-binding +
generative-UI plumbing established by Jira generative-UI v1 (the `jira.*` bound-action path,
the write MCP tools) and v2 (the Jira custom A2UI catalog rendered in the Jira rail panel).
A user can ask for a "new ticket" or "edit this ticket" surface, fill a native form, and have
the create/update applied to real Jira by the Electron **main** process without re-invoking
Claude — exactly like transition/comment already work. No new OAuth scope is added:
`write:jira-work` already authorizes create and update.

This spec is scoped to **fixed minimal create fields** (project key + issue type + summary +
description) and **field updates** (summary / description, plus assignee where cheaply
expressible). It deliberately does NOT introduce per-project required-field discovery
(`createmeta`), dynamic field forms, delete, or bulk operations.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Create a ticket from a generative form · P1

**As a** cosmos user
**I want to** ask for a "create ticket" surface, fill a small form (project, type, summary,
description), and submit
**So that** a real Jira issue is created immediately without a model round-trip to apply it

**Acceptance criteria:**

- Given Jira is connected with `write:jira-work`, when I ask for a create-ticket surface, then the headless agent composes the Jira custom-catalog **create form** in the Jira panel via the existing `render_ui` → `UiBridge` → `ui:render` path (rendered with `target: 'jira'`).
- Given the create form, when I supply a project key, an issue type, a summary, and a description and submit, then the surface emits a `jira.create` bound action with context `{ projectKey, issueType, summary, description }`; main recognizes the reserved `jira.*` action and executes the create via `JiraManager` WITHOUT spawning or re-invoking `claude`.
- Given the create succeeds, when it completes, then main re-composes and re-pushes the Jira surface (a success notice plus the new issue's detail / key) with a fresh `requestId` and `target: 'jira'` — without Claude re-composing the surface.
- Given a required minimal field is empty (no project key, no issue type, or an empty/whitespace summary), when I attempt to submit, then no create is dispatched (the surface guards it and main's validator rejects it).

### Update a ticket's fields from a generative form · P1

**As a** cosmos user
**I want to** open an "edit" form for an existing ticket and change its summary / description
(and assignee where available) and submit
**So that** the change is applied to real Jira immediately

**Acceptance criteria:**

- Given a ticket is open/known, when I ask to edit it, then the agent composes the Jira custom-catalog **edit form** seeded from the issue's current fields, in the Jira panel via the existing render path.
- Given the edit form, when I change one or more editable fields and submit, then the surface emits a `jira.update` bound action with context `{ issueKey, fields }` (where `fields` carries only the changed editable fields — summary, description, assignee); main executes the update via `JiraManager` WITHOUT re-invoking `claude`, then re-reads and re-pushes the issue detail with a success notice and fresh `requestId`.
- Given I submit the edit form with NO field actually changed (an empty `fields`), when I submit, then no update is dispatched (the surface/validator rejects an empty edit).
- Given the update succeeds, when the detail re-renders, then it shows the real post-write field values (from the re-read), mirroring the transition/comment post-write flow.

### Create fails because the project requires extra fields · P1

**As a** cosmos user
**I want to** see a clear, non-alarming error when a create is rejected by Jira (because the
target project requires custom required fields beyond the minimal four)
**So that** I understand the create did not happen and can act, without the app crashing

**Acceptance criteria:**

- Given a target project requires required fields beyond project/type/summary/description, when I submit the minimal create form, then the create REST call fails at the Jira layer (a 400) and main surfaces a clear, non-secret error notice on the Jira surface ("Couldn't create the issue — the project may require additional fields") and NO issue is shown as created.
- Given this failure, when it returns, then the app does NOT crash, hang, or leak a token/secret, and cosmos does NOT attempt to discover or dynamically render the project's required fields (no `createmeta` call).

### Update a non-existent or inaccessible issue key · P1

**As a** cosmos user
**I want to** a clear error when I update an issue key that doesn't exist or I can't access
**So that** I'm not left wondering whether the edit applied

**Acceptance criteria:**

- Given an issue key that does not exist (or that the connected account cannot edit), when I submit the edit form, then the update REST call returns a 404/403/400 and main surfaces a recoverable error notice; no field is shown as changed and the app does not crash.

### Re-consent / scope gap on create or update · P1

**As a** cosmos user
**I want to** be prompted to reconnect when my Jira token lacks write permission
**So that** create/update never silently fail and there is no silent scope escalation

**Acceptance criteria:**

- Given my Jira token was granted without `write:jira-work` (e.g. a read-only-era connection), when I attempt a `jira.create` or `jira.update`, then main detects the missing scope, does NOT attempt the write, and re-pushes the surface with the existing `write_not_authorized` notice pointing me at the Jira panel's Connect/Reconnect affordance.
- Given I reconnect and the new token includes `write:jira-work`, when I retry, then create/update proceed; the access token, refresh token, and `client_secret` never leave the main process.

### Create / update fail gracefully · P1

**As a** cosmos user
**I want to** any failed create/update to never hang or crash the app
**So that** I can retry or move on

**Acceptance criteria:**

- Given any `jira.create` / `jira.update` action, when the write fails (rate limited, network, reconnect needed, missing-required-field 400, unknown-key 404, permission 403), then main returns a structured `JiraResult` failure that the surface reflects as a recoverable error notice — never a crash, hang, or stack trace, and never leaking a token/secret.

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID      | Requirement                                                                                                                                                                                                                                                                                                                              |
|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001  | The system MUST support creating a new Jira issue and updating an existing Jira issue's fields, both performed by the Electron **main** process via the EXISTING write plumbing (`JiraManager` → single `JiraClient`), with no second write implementation.                                                                                  |
| FR-002  | Create MUST accept ONLY the fixed minimal fields: `projectKey`, `issueType`, `summary`, `description`. The system MUST NOT call Atlassian's `createmeta` API, MUST NOT discover per-project required fields, and MUST NOT dynamically render arbitrary required fields.                                                                       |
| FR-003  | Update MUST edit an existing issue identified by `issueKey` and MUST support changing `summary` and `description`, plus `assignee` where cheaply expressible (by `accountId`). Update MUST carry only the fields the user actually changed; an update with no changed fields MUST dispatch NO write.                                          |
| FR-004  | Two new bound actions MUST be added to the reserved **`jira.*`** namespace: `jira.create` (context `{ projectKey, issueType, summary, description }`) and `jira.update` (context `{ issueKey, fields }`). They MUST be dispatched deterministically in main via `JiraActionDispatcher`, WITHOUT spawning or re-invoking `claude` — exactly mirroring `jira.transition`/`jira.comment`. |
| FR-005  | The new bound-action names + their required context fields MUST be the single contract shared by main's dispatcher and any surface that emits them — centralized in `src/shared/jira.ts` (extending `JiraBoundAction` / `JiraBoundActionRequest` and adding `JiraCreateParams` / `JiraUpdateParams`), never an ad-hoc string literal.        |
| FR-006  | Main MUST validate every `jira.create` / `jira.update` payload at the boundary (action name + required context fields, correct types, non-empty where required) before dispatch via new pure validators in `src/shared/validate.ts` (e.g. `validateJiraCreate`, `validateJiraUpdate`, wired into `validateJiraBoundAction`). An invalid/unknown action MUST be warned and safely ignored (no write, no crash). |
| FR-007  | After a `jira.create` / `jira.update` resolves, the Jira surface MUST reflect the result WITHOUT Claude re-composing it: the dispatcher MUST settle the pending `render_ui` call as `cancel`, re-read/re-compose via `JiraSurfaceBuilder`, and re-push with a FRESH `requestId` and `target: 'jira'` — identical to the transition/comment post-write flow. A success/error/scope-gap notice MUST be prepended. |
| FR-008  | Two new **write** MCP tools MUST be added to `src/mcp/jiraMcpServer.ts` (`cosmos-jira` server): `jira_create_issue` and `jira_update_issue`, so the model-mediated path MAY also create/update. They MUST relay over the EXISTING `JiraBridge` to the SAME `JiraManager` write methods used by deterministic dispatch — one write implementation, two callers. Their descriptions MUST state they MUTATE Jira. |
| FR-009  | The new tool + op names MUST be centralized in `src/shared/jira.ts` (extending `JiraTool` and `JiraOp`) so the entry script, `JiraBridge`, and `JiraManager` never disagree on a literal. The new ops MUST be routed by `JiraBridge.handleCall` to the matching manager methods.                                                            |
| FR-010  | `JiraManager` MUST gain `createIssue(params)` and `updateIssue(params)` that go through its existing `getWriteCapability()` scope short-circuit and `run()` token/refresh/`reconnect_needed` path, and MUST return the same `JiraResult<T>` discriminated-union discipline as the existing writes so all callers branch on `ok`.             |
| FR-011  | `JiraClient` MUST gain the corresponding REST calls: create via `POST /rest/api/3/issue`, update via `PUT /rest/api/3/issue/{key}`, both against `…/ex/jira/{cloudId}`. The create body MUST send `fields: { project: { key }, issuetype: { name }, summary, description }` (description wrapped via the existing `plainTextToAdf`). The update body MUST send only the changed `fields` (description wrapped as ADF). Both MUST map HTTP failures through the existing `mapJiraError` discipline (429 → `rate_limited`, 401/403 → `reconnect_needed`, else → `network`). |
| FR-012  | A create rejected by Jira because the target project requires additional required fields (a 400 at the REST layer) MUST be surfaced as a clear, recoverable, non-secret error notice on the Jira surface, and MUST NOT crash. The system MUST NOT attempt `createmeta`-driven recovery or dynamic field rendering (FR-002).                  |
| FR-013  | An update against a non-existent or inaccessible issue key (404/403/400) MUST be surfaced as a recoverable error notice; no field MUST be shown as changed and the app MUST NOT crash.                                                                                                                                                       |
| FR-014  | A `jira.create` / `jira.update` attempted with a token lacking `write:jira-work` MUST NOT be attempted: `JiraManager` MUST short-circuit to the existing `write_not_authorized` `JiraResult` (no client call), and the dispatcher MUST re-push the surface with the existing `JIRA_WRITE_NOT_AUTHORIZED_MESSAGE` notice. No new scope may be added; `write:jira-work` + `offline_access` already authorize create + update. |
| FR-015  | The Atlassian Cloud 3LO **`client_secret`** (env `COSMOS_ATLASSIAN_CLIENT_SECRET`) MUST remain main-process only, NEVER logged, and NEVER placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. Adding create/update MUST NOT change this invariant.                                                            |
| FR-016  | Jira access + refresh tokens MUST remain main-process only (encrypted via `safeStorage`), NEVER exposed to the renderer, the bridge, the MCP entry script, or the sandboxed `claude` child. No new type, param, surface node, or tool argument introduced for create/update may carry a secret — every field MUST be non-secret content (`projectKey`, `issueType`, `summary`, `description`, `issueKey`, `assignee.accountId`). |
| FR-017  | All create/update failures (missing-required-field 400, unknown-key 404, permission 403, `reconnect_needed`, `rate_limited`, `network`, `write_not_authorized`) MUST be surfaced as recoverable surface notices and MUST NOT crash, hang, or expose a token/secret/stack trace. A not-connected/reconnect-needed write MUST return the structured "connect/reconnect Jira in cosmos first" result, mirroring the existing writes. |
| FR-018  | Two new generative form components MUST be added to the Jira custom A2UI catalog (`src/renderer/jiraCatalog/`): a **create form** and an **edit form**, registered alongside the existing v2 components and composed by `JiraSurfaceBuilder`. Like the existing input controls, each MUST own its data-model binding (`useFormBinding`) and emit its `jira.*` bound action (`useDispatchAction`), with surface-side submit guards that mirror main's validators. |
| FR-019  | Adding create/update MUST keep the existing Jira read tools (`jira_search_issues`, `jira_get_issue`) and write tools (`jira_transition_issue`, `jira_add_comment`) and their behavior unchanged, and MUST keep the single `jiraMcpServer` entry bundling to `out/main/mcp/jiraMcpServer.js` — the new tools live in the SAME server, so NO new rollup `input` is required.                                  |
| FR-020  | The deterministic create/update dispatch path MUST NOT spawn, kill, write to, or otherwise disturb the interactive Terminal PTY or the headless `AgentRunner` (channel independence, by construction — `JiraActionDispatcher` has no PTY/AgentRunner dependency).                                                                            |

## Edge Cases & Constraints

- **Create rejected — project requires extra required fields** → the `POST /rest/api/3/issue` returns 400; mapped via `mapJiraError` to `network` and surfaced as a recoverable error notice ("Couldn't create the issue — the project may require additional fields"). No `createmeta`, no dynamic form (FR-002, FR-012). No crash.
- **Create with an unknown project key or issue type** → Jira returns 400; surfaced as the same recoverable create-failure notice (FR-012).
- **Update on a non-existent / inaccessible issue key** → 404/403/400; surfaced as a recoverable error notice; nothing shown as changed (FR-013).
- **Update with no changed fields (empty `fields`)** → no write dispatched; the surface guards it and `validateJiraUpdate` rejects an empty `fields` (FR-003, FR-006).
- **Empty/whitespace summary on create, or missing project key / issue type** → no write dispatched (surface guard + `validateJiraCreate`) (FR-002, FR-006).
- **Assignee on update** → supported only as `{ accountId }` (cheaply expressible); resolving display-name-to-accountId search is OUT of scope. When the form has no assignee picker available, the edit form MAY omit assignee entirely.
- **Token granted without `write:jira-work`** → short-circuits to `write_not_authorized`; surface shows the existing reconnect notice; reads keep working (FR-014).
- **Token expired mid-write** → `JiraManager.run()`'s existing proactive/reactive refresh applies to create/update too; only a failed refresh flips to `reconnect_needed`, surfaced as a recoverable error (FR-010, FR-017).
- **Rate limited (429)** → mapped to `rate_limited` with `Retry-After` honored; surface shows "busy, retry shortly" (FR-011, FR-017).
- **Unknown/invalid bound action** (e.g. `jira.create` missing `projectKey`, or `jira.update` with non-object `fields`) → warned + ignored at the main boundary; no write (FR-006).
- **Post-create re-render with no fresh detail** → on a create where the new key cannot be re-read, the dispatcher renders a best-effort notice-bearing surface (mirroring the existing transition/comment re-read-failure fallback) — never a crash (FR-007, FR-017).
- **Security:** `client_secret` + tokens stay in main only (FR-015, FR-016); all new params, surface nodes, and tool arguments carry only non-secret content/identifiers.
- **Explicitly out of scope for v1:**
  - `createmeta`-driven required-field discovery and any dynamic/arbitrary field form (FR-002).
  - Create fields beyond `projectKey` / `issueType` / `summary` / `description` (e.g. priority, labels, components, custom fields, parent/epic links, sprint).
  - Update fields beyond `summary` / `description` / `assignee` (e.g. status — that's `jira.transition`; priority, labels, due date).
  - Assignee resolution by display name / search (assignee is `{ accountId }` only).
  - Delete, clone, bulk create/update, attachments, worklogs, subtask creation.
  - Any new OAuth scope (no `write:jira-user`, no scope beyond the existing `write:jira-work`); `offline_access` is retained.
  - Confluence writes (this spec is Jira-only).

## Success Criteria

| ID      | Criterion                                                                                                                                                  |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001  | Submitting the create form composes the Jira create form via the existing `render_ui` path and a valid `jira.create` executes a REAL Jira issue create via `JiraManager` dispatched in main WITHOUT re-invoking `claude`; the surface re-renders with a success notice and the new issue. |
| SC-002  | Submitting the edit form executes a REAL Jira field update (`PUT /rest/api/3/issue/{key}`) via `JiraManager` dispatched in main WITHOUT re-invoking `claude`, sending only changed fields; the surface re-renders the real post-write values. |
| SC-003  | A create rejected because the project requires extra required fields surfaces a clear recoverable error notice; cosmos makes NO `createmeta` call and renders NO dynamic field form; the app never crashes. |
| SC-004  | An update on a non-existent/inaccessible issue key surfaces a recoverable error notice; nothing is shown as changed; no crash. |
| SC-005  | A create/update attempted with a token lacking `write:jira-work` does NOT execute; the existing `write_not_authorized` notice is shown; after reconnect (no new scope added), the write succeeds. |
| SC-006  | The new write MCP tools (`jira_create_issue`, `jira_update_issue`) are registered in `jiraMcpServer.ts`, route through `JiraBridge` → `JiraManager` to the SAME write methods as deterministic dispatch; the existing read + write tools are unchanged and no new rollup input is added. |
| SC-007  | Across all new create/update paths, `client_secret` and tokens remain main-process only (never logged / in IPC / bridge / MCP / surface); no new param, surface node, or tool argument carries a secret. |
| SC-008  | Executing a `jira.create` / `jira.update` bound action never spawns/kills/writes to the Terminal PTY or the `AgentRunner` (channel independence preserved). |
| SC-009  | A failed create/update (any failure kind) surfaces a recoverable error notice; the app never crashes, hangs, or leaks a token/secret/stack trace. |

---

## Open Questions

- [x] **Post-create re-render target — does the dispatcher re-read the newly created issue, or render a minimal success surface?**
  **Resolved (approved):** On a successful `jira.create`, `JiraClient` returns the new issue key (the `POST /rest/api/3/issue` response includes `key`); the dispatcher re-reads via `JiraManager.getIssue` and re-composes the detail surface (same pattern transition/comment use), prepending an "Issue created" success notice. If the re-read fails, fall back to a minimal notice-bearing surface carrying just the new key.

- [x] **Edit-form change detection — surface-side or dispatcher-side?**
  **Resolved (approved, belt-and-braces):** The edit form binds each editable field to the data model seeded from the issue's current values, and on submit emits `jira.update` with `fields` containing ONLY the entries the user changed (surface computes the diff against the seeded values); main's `validateJiraUpdate` ADDITIONALLY rejects an empty `fields`. Authoritative on both sides, mirroring the existing comment whitespace guard.
