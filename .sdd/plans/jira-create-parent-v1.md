# Plan: Jira Create — Parent Ticket Support — v1

**Status**: Draft
**Created**: 2026-06-22
**Last updated**: 2026-06-22
**Spec**: .sdd/specs/jira-create-parent-v1.md

---

## Grounding

Same as the spec's Grounding section (codegraph_explore confirmed the full create path
already exists; memory_recall/smart_search returned empty for parent; an architecture memory
was saved). Key finding: the create path is **one implementation, two callers** — both
`JiraActionDispatcher` (deterministic `jira.create`) and the `jira_create_issue` MCP tool relay
into the SINGLE `JiraManager.createIssue`, which calls the SINGLE `jiraClient.createIssue` that
builds the `POST /rest/api/3/issue` `fields` body. Adding `parentKey` to `JiraCreateParams` and
to `fields.parent` therefore covers BOTH callers automatically — the only per-caller surface area
is the MCP inputSchema (FR-004) and the generative form (FR-007).

## Summary

Add an OPTIONAL `parentKey` to the existing Jira create path so a user can create a Sub-task
under its parent or a Story/Task under an Epic (team-managed). The change threads one new
optional string from the shared payload type, through the boundary validator, into
`JiraManager.createIssue`, and finally into the REST adapter where `fields.parent = { key }` is
added when present. The two callers (deterministic `jira.create` dispatch and the
`jira_create_issue` MCP tool) inherit it through the shared type + validator. The generative
`CreateIssueForm` gains an optional Parent input. No new OAuth scope, no new bridge op/channel,
no new error kind — invalid parents fall through the existing `mapJiraError` recoverable notice.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + shared + renderer; MCP entry script) |
| Key dependencies  | Existing `jira-write-extend-v1` create plumbing; Jira Cloud REST API v3 `POST /rest/api/3/issue` `fields.parent`; zod (MCP inputSchema) |
| Files to create   | none (extends existing modules + their `*.test.ts` siblings) |
| Files to modify   | `src/shared/jira.ts`, `src/shared/ipc/jira.validate.ts`, `src/main/integrations/jiraClient.ts`, `src/mcp/jiraMcpServer.ts`, `src/main/jiraSurfaceBuilder.ts`, `src/renderer/jiraCatalog/components.tsx`, `src/renderer/jiraCatalog/logic.ts`, plus matching `.test.ts` files; `docs/ARCHITECTURE.md` (§4.9) |

### Jira API note (verify before merge)

`jiraClient.createIssue` already POSTs `{ fields: { project, issuetype, summary, description } }`
to `…/ex/jira/{cloudId}/rest/api/3/issue`. Per the Atlassian REST v3 create-issue contract, the
parent is a sibling field: `fields.parent = { key: "PROJ-123" }` (the API also accepts
`{ id: "<numericId>" }`; cosmos uses the user-facing **key** form). For sub-task types Jira
**requires** `parent`; for team-managed projects a Story/Task `parent` may be an Epic. The
implementing developer MUST re-confirm the exact `fields.parent` shape against
`developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post`
(the page is JS-rendered and could not be fetched during planning).

---

## Implementation Checklist

> Ordered so the shared contract lands first, then both callers + REST adapter, then UI, then docs.

### Phase 1 — Shared contract (types + validation)

- [ ] Read the spec; confirm no open questions block (the Epic-Link OQ has a recommended default — proceed with `fields.parent` only).
- [ ] `src/shared/jira.ts`: add `parentKey?: string` to `JiraCreateParams` with a doc comment (optional issue key; sub-task's required parent or a team-managed Epic; non-secret). Update the `JiraBoundAction.Create` context doc comment to mention the optional `parentKey`.
- [ ] `src/shared/ipc/jira.validate.ts` `validateJiraCreate`: after the existing checks, handle `parentKey` — if `raw.parentKey !== undefined` it MUST be a non-empty (post-trim) string else warn + return null; include trimmed `parentKey` in the returned object only when present (spread-when-present, no empty default). Mirror the existing comment-validator's non-whitespace style (FR-003).
- [ ] `src/shared/ipc/jira.validate.test.ts`: add cases — parent present (carried, trimmed), parent absent (omitted), parent present-but-empty/whitespace (rejected → null).

### Phase 2 — REST adapter (the one POST body)

- [ ] `src/main/integrations/jiraClient.ts` `createIssue`: build the `fields` object then conditionally add `...(params.parentKey ? { parent: { key: params.parentKey } } : {})` so an absent parent yields a byte-identical body (FR-002). Re-confirm the `fields.parent` shape against the live Atlassian doc (above).
- [ ] `src/main/integrations/jiraClient.test.ts` (or the existing create test): assert the POST body has `fields.parent = { key }` when `parentKey` is set, and NO `parent` key when absent (SC-001).

### Phase 3 — Callers stay in sync (verify, minimal change)

- [ ] `src/main/jiraManager.ts` `createIssue`: confirm it passes `params` straight through (it already does — `parentKey` rides `JiraCreateParams`; no signature change needed beyond the type). No edit expected; just verify.
- [ ] `src/main/jiraActionDispatcher.ts`: confirm the `jira.create` branch passes `action.params` unchanged into `manager.createIssue` (it already does — `parentKey` flows via the validated params). No edit expected; verify the post-create re-read still uses the returned key.
- [ ] `src/mcp/jiraMcpServer.ts` `JiraTool.CreateIssue`: add `parentKey: z.string().optional()` to inputSchema; extend the description to explain parent (sub-task's required parent / team-managed Epic, by issue key); thread `...(parentKey !== undefined ? { parentKey } : {})` into the `bridge.call(JiraOp.CreateIssue, {...})` payload (FR-004/FR-005).

### Phase 4 — Generative create form (renderer)

- [ ] `src/renderer/jiraCatalog/components.tsx`: add `PATH_CREATE_PARENT_KEY = '/createParentKey'`; add `seededParentKey?: string` to `CreateIssueFormNode`; add a `parentKey` `useFormBinding` seeded `seededParentKey ?? ''`; render an OPTIONAL "Parent" `Input` (placeholder e.g. `PROJ-123`, label "Parent (optional)"); in the `create()` dispatch context add `parentKey: { path: PATH_CREATE_PARENT_KEY }`. Do NOT add parent to the submittable guard (it stays optional — FR-007).
- [ ] `src/main/jiraSurfaceBuilder.ts` `buildCreateIssueSurface` / `JiraCreateSurfaceOpts`: add `defaultParentKey?` and `seed.parentKey?`, and spread `seededParentKey` onto the `CreateIssueForm` component when present (mirrors `seededProjectKey`), so a failed-create re-push re-seeds the parent field (FR-007).
- [ ] `src/renderer/jiraCatalog/logic.ts` + `logic.test.ts`: if `isCreateSubmittable` lives here, confirm it is UNCHANGED (parent not required); add/adjust any path-constant test. No new required-field logic.

### Phase 5 — Docs

- [ ] `docs/ARCHITECTURE.md` §4.9: update the `jira.create` context line (`{ projectKey, issueType, summary, description }` → add optional `parentKey`) and the create REST note (`POST /rest/api/3/issue` now sets optional `fields.parent = { key }`). Keep the "deliberately minimal create" note but record the additive optional parent. Note the deferred classic Epic-Link (`customfield_10014`) caveat.
- [ ] `TODO.md` (via wrap-up): check off if listed; add the deferred classic Epic-Link follow-up.
- [ ] Update this plan's Deviations with anything that differed.

### Phase 6 — Verify

- [ ] `npm run typecheck` (node + web) passes.
- [ ] `npm test` passes; new tests cover parent-present / parent-absent / parent-invalid (SC-003/SC-005).
- [ ] Manual: the create form shows an optional Parent field; setting it on a Sub-task type creates under the parent; omitting it on a sub-task surfaces the recoverable "may require additional fields" notice (SC-004).

---

## Deviations & Notes

- **2026-06-22**: Planned. Found the create path already complete from `jira-write-extend-v1`, so this is a thin additive thread — Phase 3 is mostly verification (the shared type carries `parentKey` to both callers automatically). The only genuinely new surface area is the MCP inputSchema field, the REST `fields.parent`, and the form's optional Parent input. Classic Epic-Link via `customfield_10014` deferred per the spec's recommended default.
