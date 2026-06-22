# Spec: Jira Create — Parent Ticket Support — v1

**Status**: Review
**Created**: 2026-06-22
**Supersedes**: — (extends `jira-write-extend-v1`)
**Related plan**: .sdd/plans/jira-create-parent-v1.md

---

## Grounding

**codegraph_explore** (verbatim source, no re-reads needed):
- `JiraTool.CreateIssue JiraOp.CreateIssue JiraManager.createIssue jira.create createIssue fields parent jiraMcpServer jiraAdapter` — confirmed the full create path already exists end-to-end; `JiraManager.createIssue` is the SINGLE method both callers reach.
- `JiraCreateParams JiraCreateResult jira.create JiraActionDispatcher create jira_create_issue inputSchema validateJiraCreate` — confirmed `JiraCreateParams { projectKey, issueType, summary, description }` (no parent today), the `JiraActionDispatcher.dispatch` create branch, and `validateJiraCreate` shape.
- `jiraSurfaceBuilder CreateForm buildCreateSurface validateJiraBoundAction JiraBoundAction.Create parentKey` — confirmed `buildCreateIssueSurface` / `CreateIssueForm` / `validateJiraBoundAction` wiring and that no `parent` exists anywhere yet.
- Direct reads: `jiraClient.createIssue` (the `fields` object built for `POST /rest/api/3/issue`), `validateJiraCreate`, `jiraMcpServer.ts` CreateIssue inputSchema, `CreateIssueForm` component (binding paths `/createProjectKey` etc. + `jira.create` dispatch context).

**memory_recall / memory_smart_search**: `Jira create issue write scope deterministic action binding generative UI parent` and `Jira create issue parent epic sub-task` — both returned EMPTY (no prior decisions on parent). Saved a new architecture memory for this feature (`jira-create-parent-v1`).

**Jira API**: the Atlassian REST v3 docs are JS-rendered (WebFetch returned no usable body); the `parent` facts below come from the Atlassian REST v3 "Create issue" contract as applied verbatim by the existing `jiraClient.createIssue` (which already POSTs a `fields` object to `/rest/api/3/issue`). Doc anchor: `developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post`. **The implementing developer MUST re-confirm the `fields.parent` shape against that live page before merge** (flagged as a verification step in the plan).

---

## Overview

Today a Jira create takes only `projectKey`, `issueType`, `summary`, and an optional
`description` — there is no way to place the new issue under a parent. This feature adds an
**optional `parentKey`** (an issue key like `PROJ-123`) to the existing create path so a user
can create a **Sub-task under its parent** or a **Story/Task under an Epic** (team-managed
projects). It is a strictly additive extension of `jira-write-extend-v1`: existing parent-less
creates are unchanged, no new OAuth scope is needed (`write:jira-work` already authorizes it),
and the parent key is non-secret.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Create a Sub-task under its parent · P1

**As a** cosmos user
**I want to** create a Sub-task and specify the parent issue it belongs to
**So that** the Sub-task is correctly nested under its parent in Jira (which requires a parent)

**Acceptance criteria:**

- Given Jira is connected with `write:jira-work`, when I create an issue of a sub-task type and supply a `parentKey` (e.g. `PROJ-123`), then the create POST sends `fields.parent = { key: "PROJ-123" }` and the Sub-task is created under that parent.
- Given a sub-task type and NO `parentKey` supplied, when I submit, then Jira rejects the create (sub-task requires a parent) and the surface shows the existing recoverable error notice ("the project may require additional required fields"), never a crash or a silent success.

### Create a Story/Task under an Epic · P2

**As a** cosmos user (team-managed project)
**I want to** create a Story or Task and set its parent Epic
**So that** the new issue is linked under the Epic without a separate step

**Acceptance criteria:**

- Given a team-managed project, when I create a Story/Task with a `parentKey` referencing an Epic, then `fields.parent = { key: "<EPIC-KEY>" }` is sent and the issue is created under that Epic.
- Given an invalid parent for the issue type (e.g. a parent Jira does not allow for that type, or a cross-project parent), when I submit, then the create fails with the existing recoverable error notice carrying Jira's non-secret message — no crash, no leak.

### Existing parent-less create is unchanged · P1

**As a** cosmos user
**I want** the existing create flow (no parent) to behave exactly as before
**So that** adding parent support does not regress current creates

**Acceptance criteria:**

- Given I create an issue WITHOUT a `parentKey`, when I submit, then the create POST contains NO `parent` key in `fields` (byte-for-byte the same body as today), and the issue is created exactly as before.
- Given the `jira.create` deterministic dispatch path and the `jira_create_issue` MCP tool, when each creates WITHOUT a parent, then both behave identically to today (no contract drift).

### Set a parent from the generative create form · P2

**As a** cosmos user
**I want** the create form to offer an optional "Parent" field
**So that** I can set a parent from the native generative surface, not only via the MCP tool

**Acceptance criteria:**

- Given the `CreateIssueForm` surface, when I type a parent key into the optional Parent field and submit, then the emitted `jira.create` bound action's context includes `parentKey` bound to the form's parent path; an empty/whitespace Parent field omits `parentKey` entirely.
- Given a failed create re-push (error/scope-gap), when the form re-appears, then the entered parent value is re-seeded alongside the other fields (it never re-appears blank), mirroring `projectKey`/`summary` re-seed.

### Both callers stay in sync · P1

**As a** maintainer
**I want** the deterministic `jira.create` dispatch and the `jira_create_issue` MCP tool to share ONE create implementation
**So that** parent support is identical no matter which caller invokes it

**Acceptance criteria:**

- Given the contract chain (shared payload type → validator → `JiraManager.createIssue` → REST adapter), when a parent is supplied, then BOTH the deterministic dispatcher and the MCP tool reach the SAME `JiraManager.createIssue` with `parentKey` and the SAME `fields.parent` POST body — one implementation, two callers.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST add an OPTIONAL `parentKey: string` to `JiraCreateParams` (`src/shared/jira.ts`). All existing fields are unchanged. |
| FR-002 | When `parentKey` is present and non-empty, the REST adapter (`jiraClient.createIssue`) MUST set `fields.parent = { key: parentKey }` in the `POST /rest/api/3/issue` body. When absent, the body MUST contain NO `parent` key (identical to today). |
| FR-003 | `validateJiraCreate` MUST treat `parentKey` as optional: when present it MUST be a non-empty string (an empty/whitespace value → the WHOLE create is warned + ignored, per the existing required-field convention) and MUST be trimmed of surrounding whitespace before use; when absent the validated params MUST omit `parentKey` (no empty-string default). |
| FR-004 | The `jira_create_issue` MCP tool inputSchema MUST gain an optional `parentKey: z.string().optional()`, and its description MUST explain it sets the parent (sub-task's required parent or a team-managed Epic, by issue key). |
| FR-005 | The `JiraOp.CreateIssue` bridge payload and `JiraManager.createIssue` signature MUST carry `parentKey` through unchanged (it rides `JiraCreateParams`; no new bridge op or channel). |
| FR-006 | The deterministic `jira.create` bound action (`JiraBoundAction.Create`) MUST accept `parentKey` in its context; `validateJiraBoundAction` → `validateJiraCreate` MUST be the single validator for BOTH callers (no second validation site). |
| FR-007 | The `CreateIssueForm` generative surface (`jiraSurfaceBuilder.buildCreateIssueSurface` + `jiraCatalog` `CreateIssueForm`) MUST offer an OPTIONAL Parent input bound to a new `/createParentKey` path, emit it in the `jira.create` context, and re-seed it on a failed-create re-push. The Parent field MUST NOT be required (submit stays enabled without it). |
| FR-008 | A create that Jira rejects because of the parent (sub-task missing/invalid parent, wrong issue type, cross-project parent) MUST surface through the EXISTING `mapJiraError` discipline (≥400 → `network` → recoverable error notice), never a crash, hang, or token leak. No new error kind is introduced in v1. |
| FR-009 | No new OAuth scope MUST be added; `write:jira-work` already authorizes create-with-parent. The scope short-circuit (`write_not_authorized`) is unchanged. |
| FR-010 | `parentKey` MUST be treated as non-secret content and MUST NOT alter any secret/token handling — it rides the existing non-secret create payload like `projectKey`. |
| FR-011 | The Jira write contract documented in `docs/ARCHITECTURE.md` §4.9 (the `jira.create` context + create REST body) MUST be updated to reflect the new optional `parentKey` / `fields.parent`. |

## Edge Cases & Constraints

- **Empty/whitespace `parentKey`**: treated as "no parent" only after the validator rejects it — per convention an explicitly-present-but-empty `parentKey` warns + ignores the WHOLE create (FR-003); to create without a parent the caller simply omits the field.
- **Sub-task without parent**: not blocked client-side (cosmos does not know issue-type metadata in v1); Jira returns the rejection, surfaced as the existing recoverable notice (FR-008).
- **Invalid/cross-project/wrong-type parent**: surfaced as the existing recoverable notice (FR-008); v1 does NOT pre-validate parent against issue type (would require `createmeta`, explicitly out of scope per `jira-write-extend-v1`).
- **Out of scope (v1)**: company-managed (classic) **Epic Link** via `customfield_10014` (see Open Questions — deferred); per-project required-field discovery (`createmeta`); a parent PICKER / autocomplete (the field is a plain key input); validating the parent exists before POST; changing an existing issue's parent (that is an update, not create).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A create WITH `parentKey` produces a POST body whose `fields.parent` equals `{ key: parentKey }`; a create WITHOUT it produces a body byte-for-byte identical to the pre-feature body (no `parent` key). |
| SC-002 | The deterministic `jira.create` dispatch and the `jira_create_issue` MCP tool both reach `JiraManager.createIssue` with the same `parentKey`, proving one implementation / two callers. |
| SC-003 | `validateJiraCreate` accepts a valid `{ ...required, parentKey }`, omits `parentKey` when absent, and rejects a present-but-empty/whitespace `parentKey` (warn + null). |
| SC-004 | A Jira rejection caused by the parent surfaces as the existing recoverable error notice (not a crash); the token never appears in any payload, log, or surface. |
| SC-005 | `npm run typecheck` and `npm test` pass; new unit tests cover parent-present, parent-absent, and parent-invalid-input cases. |

---

## Open Questions

- [ ] **Company-managed (classic) Epic Link vs team-managed `parent`.** In team-managed
  (next-gen) projects an Epic parent is set via `fields.parent`. In *company-managed* (classic)
  projects the Epic relationship historically used the **Epic Link** custom field
  (`customfield_10014`), though newer Atlassian instances increasingly accept `fields.parent`
  there too. **Recommended default (v1):** support `fields.parent` ONLY — it covers Sub-tasks
  (all project types) and team-managed Epics, the primary user need. A company-managed Epic Link
  that a given instance does NOT accept via `parent` will fall through to the existing recoverable
  error notice. Treat classic Epic-Link-via-`customfield_10014` as a **follow-up** (it needs
  per-instance field discovery, which is the deliberately-deferred `createmeta` work). This is a
  recommended scoping decision, not a blocker — implementation can proceed.
