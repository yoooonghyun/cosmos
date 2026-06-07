# Plan: Jira Write Extend — Create & Update — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: .sdd/specs/jira-write-extend-v1.md

---

## Summary

Add two Jira write operations — **create a new issue** and **update an existing issue's
fields** — by EXTENDING the existing v1/v2 write/action plumbing end-to-end, not duplicating
it. Create takes the fixed minimal fields (`projectKey`, `issueType`, `summary`,
`description`); update edits an existing issue by key (`summary` / `description` / `assignee`,
changed fields only). Both flow through the SAME single-implementation path the existing
transition/comment writes use: shared contract in `src/shared/jira.ts` → pure validators in
`src/shared/validate.ts` → `JiraClient` REST (`POST /rest/api/3/issue`, `PUT /rest/api/3/issue/{key}`)
→ `JiraManager.createIssue/updateIssue` (scope short-circuit + `run()` refresh) reached by
BOTH callers: the deterministic `JiraActionDispatcher` (`jira.create` / `jira.update`, no
Claude re-invoke) and two new MCP tools in the existing `cosmos-jira` server
(`jira_create_issue` / `jira_update_issue`). Two new Jira custom-catalog form components
(`CreateIssueForm` + `EditIssueForm`) are composed by `JiraSurfaceBuilder` and own their
form binding + `jira.*` action emission. **No new rollup input** (tools live in the existing
server) and **no new OAuth scope** (`write:jira-work` + `offline_access` already authorize
create + update). Because this adds two renderer form surfaces, a **design step (Step 2.5)**
is required before interface/implementation.

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript (Electron main + renderer + standalone MCP entry; React 19) |
| Key dependencies  | Existing only — `@a2ui-sdk/react/0.9` (catalog forms), `@modelcontextprotocol/sdk` + `zod` (MCP tools), shadcn/ui components. NO new deps, NO new native module, NO new scope. |
| Files to create   | None required (all new code extends existing files). Optional: a `jiraCatalog/logic.ts` test sibling if new pure helpers warrant their own coverage. |
| Files to modify   | `src/shared/jira.ts`, `src/shared/validate.ts`, `src/main/integrations/jiraClient.ts`, `src/main/jiraManager.ts`, `src/main/jiraBridge.ts`, `src/main/jiraActionDispatcher.ts`, `src/main/jiraSurfaceBuilder.ts`, `src/renderer/jiraCatalog/logic.ts`, `src/renderer/jiraCatalog/components.tsx`, `src/renderer/jiraCatalog/index.ts`, `src/mcp/jiraMcpServer.ts`. Tests: `src/renderer/jiraCatalog/logic.test.ts` + validator/client/manager/dispatcher test siblings. |
| Build wiring      | **No `electron.vite.config.ts` change** — the two MCP tools register in the SAME `cosmos-jira` entry (`jiraMcpServer.ts`), still bundling to `out/main/mcp/jiraMcpServer.js`. |
| OAuth scope       | **Unchanged** — `write:jira-work` already authorizes create + update; `offline_access` retained. No `atlassianConfig.ts` scope edit. |

### Layer map (reuse → extend)

| Layer | File | Change |
|-------|------|--------|
| Shared contract | `src/shared/jira.ts` | Add `JiraCreateParams`, `JiraUpdateParams`, `JiraUpdateFields`, `JiraCreateResult`; extend `JiraTool` (`CreateIssue`/`UpdateIssue`), `JiraOp` (`createIssue`/`updateIssue`), `JiraBoundAction` (`Create`/`Update`), `JiraBoundActionRequest` union. No new error kind (reuse `network`/`write_not_authorized`/…). No secret field. |
| Validators | `src/shared/validate.ts` | Add `validateJiraCreate`, `validateJiraUpdate` (rejects empty `fields`); wire both into `validateJiraBoundAction`. `validateJiraBridgeCall` already gates on `JIRA_OPS` (auto-covers new ops once `JiraOp` grows). |
| REST client | `src/main/integrations/jiraClient.ts` | Add `createIssue(auth, params)` → `POST /rest/api/3/issue` (returns new `key`); `updateIssue(auth, params)` → `PUT /rest/api/3/issue/{key}` (204, use `callNoBody`). Reuse `mapJiraError`, `plainTextToAdf`, `call`/`callNoBody`. |
| Manager | `src/main/jiraManager.ts` | Add `createIssue`/`updateIssue`: `getWriteCapability()` short-circuit → `run()` → client. Same `JiraResult<T>` discipline as transition/comment. |
| Bridge | `src/main/jiraBridge.ts` | Extend `JiraBridgeManager` interface + `handleCall` switch with the two new `JiraOp` cases, validating params first. |
| Dispatcher | `src/main/jiraActionDispatcher.ts` | Extend `JiraActionManager` (add `createIssue`/`updateIssue`); handle `jira.create`/`jira.update` in `dispatch`; for create, re-read the returned key; re-push detail with notice + fresh `requestId` + `target:'jira'`. |
| Surface builder | `src/main/jiraSurfaceBuilder.ts` | Add `buildCreateIssueSurface()` (CreateIssueForm root) and `buildEditIssueSurface(detail)` (EditIssueForm seeded from current fields). Detail re-push already handled by `buildIssueDetailSurface` + `notice`. |
| Catalog logic | `src/renderer/jiraCatalog/logic.ts` | Add pure guards: `isCreateSubmittable(projectKey, issueType, summary)`, `diffUpdateFields(seeded, current)` + `isUpdateSubmittable(fields)`. Node-testable. |
| Catalog components | `src/renderer/jiraCatalog/components.tsx` | Add `CreateIssueForm` + `EditIssueForm` (thin shells over logic; `useFormBinding` + `useDispatchAction`). Add their data-model `PATH_*` constants. |
| Catalog registry | `src/renderer/jiraCatalog/index.ts` | Register the two new component type names in the `jira` catalog map. |
| MCP tools | `src/mcp/jiraMcpServer.ts` | Register `jira_create_issue` + `jira_update_issue` (zod input schemas; MUTATES-Jira descriptions); relay via existing `JiraBridgeClient.call` to the new ops. |

### Component contracts (new catalog forms — FR-018, hand to designer in Step 2.5)

| Component (`catalogId:'jira'`) | Builder-supplied static props (data input) | User-edited fields (form-bound) | Emitted bound action | Submit guard (surface-side, mirrors validator) |
|-------------------------------|----------------------------------------------|----------------------------------|----------------------|-----------------------------------------------|
| `CreateIssueForm` | none (blank form) — optional `defaultProjectKey?` if the agent supplies one | `projectKey`, `issueType`, `summary`, `description` (data-model paths e.g. `/createProjectKey`, `/createIssueType`, `/createSummary`, `/createDescription`) | `jira.create` with `{ projectKey, issueType, summary, description }` | `isCreateSubmittable` — non-empty `projectKey` + `issueType` + non-whitespace `summary` |
| `EditIssueForm` | `issueKey`, seeded current `summary`/`description`/`assignee` (from `JiraIssueDetail`) so fields prefill | `summary`, `description`, `assignee.accountId` (paths e.g. `/editSummary`, `/editDescription`, `/editAssigneeId`) | `jira.update` with `{ issueKey, fields }` where `fields` = ONLY changed entries (diff vs. seeded) | `isUpdateSubmittable` — at least one field changed (non-empty diff) |

> Both forms reuse the v2 catalog rendering host (`<A2UIProvider catalog={jiraCatalog}>`) and the
> renderer→main `ui:action` path proven by v1/v2; assignee is `{ accountId }` only (no display-name
> search). `description` round-trips as plain text (`adfToPlainText` in / `plainTextToAdf` out).

---

## Implementation Checklist

> Update this checklist as work progresses. Add notes inline when a step deviates from the original plan.

### Phase 0 — Spec confirmation

- [x] Spec Approved; both open questions resolved (OQ1 re-read created key; OQ2 belt-and-braces diff).

### Phase 1 — Shared contract & validators (interface)

- [x] `src/shared/jira.ts`: add `JiraCreateParams { projectKey; issueType; summary; description }`.
- [x] `src/shared/jira.ts`: add `JiraUpdateFields { summary?; description?; assignee?: { accountId } }` and `JiraUpdateParams { issueKey; fields: JiraUpdateFields }`.
- [x] `src/shared/jira.ts`: add `JiraCreateResult { key }` (echoes the new issue key from the POST response). Also added `JiraUpdateResult { issueKey }` for the 204 update echo.
- [x] `src/shared/jira.ts`: extend `JiraTool` (`CreateIssue: 'jira_create_issue'`, `UpdateIssue: 'jira_update_issue'`) and `JiraOp` (`CreateIssue: 'createIssue'`, `UpdateIssue: 'updateIssue'`).
- [x] `src/shared/jira.ts`: extend `JiraBoundAction` (`Create: 'jira.create'`, `Update: 'jira.update'`) and the `JiraBoundActionRequest` union with the two new variants.
- [x] `src/shared/jira.ts`: confirm NO secret field added; every new field is non-secret content/identifier (SC-007).
- [x] `src/shared/validate.ts`: add `validateJiraCreate` (require non-empty `projectKey`, `issueType`, non-whitespace `summary`; `description` a string, default `''`).
- [x] `src/shared/validate.ts`: add `validateJiraUpdate` (require non-empty `issueKey`; `fields` a non-empty object of allowed keys only — reject empty `fields`; assignee as `{ accountId }`).
- [x] `src/shared/validate.ts`: wire both into `validateJiraBoundAction` (`jira.create` / `jira.update` cases).
- [x] Confirm `validateJiraBridgeCall` accepts the new ops via `JIRA_OPS` (derived from `JiraOp`) — no extra change needed.
- [x] Review new types against the spec — no invented properties, no createmeta-driven fields (FR-002).

### Phase 2 — Testing

- [x] `validateJiraCreate`: happy path; missing `projectKey`/`issueType`; empty/whitespace `summary` → null. (in `validateJiraWrite.test.ts`)
- [x] `validateJiraUpdate`: happy path (one changed field); empty `fields` → null; unknown field key ignored/rejected; assignee shape. (in `validateJiraWrite.test.ts`)
- [x] `validateJiraBoundAction`: `jira.create` / `jira.update` map to the correct discriminated request; unknown/missing fields → null + warn. (in `validateJiraWrite.test.ts`)
- [x] `jiraCatalog/logic.test.ts`: `isCreateSubmittable`, `diffUpdateFields` (only-changed), `isUpdateSubmittable` (empty diff disables).
- [x] `JiraClient.createIssue`: success returns `{ key }`; 400 (missing required field) → `network` error (FR-012); 429/401 mapped; no-key-returned → `network`.
- [x] `JiraClient.updateIssue`: success (204) via `callNoBody`; 404/403 → mapped error (FR-013); assignee accountId carried.
- [x] `JiraManager.createIssue/updateIssue`: `write_not_authorized` short-circuit (no client call); `run()` refresh path applies; token never leaks.
- [x] `JiraActionDispatcher`: `jira.create` re-reads returned key → detail+success notice; failed-create skips re-read → error notice; `jira.update` re-reads issueKey; fresh `requestId` + `target:'jira'`; channel independence (SC-008).
- [x] `JiraBridge.handleCall`: new ops route to manager; invalid create/update params → structured error result.

### Phase 2.5 — Design (REQUIRED — see "Design step" below)

- [ ] Designer extends `.sdd/designs/jira-generative-ui-v2.md` (or a v-next) covering `CreateIssueForm` + `EditIssueForm` (layout, fields, submit/disabled states, validation hints, success/error notice reuse) consistent with the v2 Jira catalog + shadcn design system.
- [ ] Designer confirms component contract rows above (field set, paths, emitted actions, guards) and owns any new `src/renderer/components/ui/` primitives (e.g. a field/label wrapper) if needed.

### Phase 3 — Implementation

- [x] `JiraClient`: implement `createIssue` (`POST /rest/api/3/issue`, body `fields:{ project:{key}, issuetype:{name}, summary, description: plainTextToAdf(...) }`, return `{ key }`).
- [x] `JiraClient`: implement `updateIssue` (`PUT /rest/api/3/issue/{key}`, body `fields` with only changed keys, description as ADF; `callNoBody`).
- [x] `JiraManager`: implement `createIssue`/`updateIssue` (scope short-circuit + `run()`), returning `JiraResult<JiraCreateResult>` / `JiraResult<JiraUpdateResult>`.
- [x] `JiraBridge`: extend `JiraBridgeManager` interface + `handleCall` switch (validate params, forward).
- [x] `JiraActionDispatcher`: extend `JiraActionManager`; handle `jira.create` (re-read returned key, fallback minimal notice) and `jira.update` (re-read issueKey); reuse `repushSurface`/`noticeFor` (extend `noticeFor` for the two new success messages: "Issue created." / "Issue updated.").
- [x] `jiraSurfaceBuilder`: add `buildCreateIssueSurface()` and `buildEditIssueSurface(detail)`; reuse `JiraSurfaceNotice`/`buildIssueDetailSurface` for post-write re-push.
- [x] `jiraCatalog/logic.ts`: implement the new pure guards/diff.
- [x] `jiraCatalog/components.tsx`: implement `CreateIssueForm` + `EditIssueForm` (thin shells; `useFormBinding` + `useDispatchAction`); add `PATH_*` constants.
- [x] `jiraCatalog/index.ts`: register the two component type names.
- [x] `jiraMcpServer.ts`: register `jira_create_issue` + `jira_update_issue` (zod schemas; MUTATES-Jira descriptions); relay to new ops.
- [x] All tests pass (422); `npm run typecheck` (node + web) green; `npm run build` green.
- [x] Reused shared write/action plumbing — confirm no duplicated REST/validator/dispatch logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.9 (Jira) to note create + update join transition/comment as deterministic-bound writes (no new scope, no createmeta) — the only doc decision this introduces.
- [ ] Reconcile `TODO.md` (wrap-up) — check off create/update, surface any deferred follow-ups.
- [ ] Update this plan with any deviations.

---

## Risks & Constraints

- **No createmeta, ever** (FR-002): a create that fails because the project requires extra fields is a recoverable `network`/400 notice — do NOT add discovery or dynamic forms.
- **No new scope** (FR-014): `write:jira-work` + `offline_access` already authorize create + update; a token lacking the write scope short-circuits to `write_not_authorized` exactly as transition/comment do.
- **No new rollup input** (FR-019): both tools live in the existing `cosmos-jira` server; verify the build still emits `out/main/mcp/jiraMcpServer.js` and the read + existing write tools are unchanged.
- **Secrets stay in main** (FR-015/FR-016, SC-007): no new type, param, surface node, or tool argument may carry the `client_secret` or any token; every new field is non-secret content (`projectKey`, `issueType`, `summary`, `description`, `issueKey`, `assignee.accountId`).
- **Channel independence** (FR-020, SC-008): `JiraActionDispatcher` keeps its no-PTY/no-AgentRunner construction; the create/update paths add no such dependency.

## Design step (Step 2.5) — REQUIRED

This feature adds **two new renderer form surfaces** (`CreateIssueForm`, `EditIssueForm`), so
the sdd cycle's design step is required between plan approval and interface/implementation. Hand
the **component contract rows** above to the **designer** agent to extend the Jira catalog design
spec (`.sdd/designs/jira-generative-ui-v…md`): both forms must stay visually uniform with the v2
Jira catalog and the shared Tailwind + shadcn/ui system (field layout, prefilled/disabled/submit
states, validation hints, and reuse of the existing `Notice` for success/error). The designer owns
theme tokens + `src/renderer/components/ui/`; the developer/main session does any build wiring. The
non-visual layers (shared types, validators, client, manager, bridge, dispatcher, MCP tools) do NOT
depend on the design step and may proceed in parallel for interface/tests.

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-06** — `EditIssueForm`'s `jira.update` emits `context.fields` as a literal nested
  object (the computed diff, design §4.4). The SDK's `Action.context` is typed
  `Record<string, DynamicValue>` and `DynamicValue` models only primitives / `{ path }` /
  `FunctionCall` — it does NOT model a nested literal object. The SDK runtime is looser than its
  type: `resolveContext` → `resolveValue` passes any non-binding literal through verbatim, so the
  nested `fields` object reaches main intact for `validateJiraUpdate`. Resolved with a narrow,
  documented cast at the single dispatch site (`fields: diff as unknown as DynamicValue`,
  importing the type from `@a2ui-sdk/types/0.9`). No contract or behavior change; `CreateIssueForm`
  is unaffected because it emits per-field `{ path }` bindings (each a valid `DynamicValue`).
- **2026-06-06** — Phase 1/2 (shared types, validators, catalog logic + their tests) and Phase 3
  source were largely landed in an earlier session; this session completed the remaining Phase 3
  wiring (catalog registry) and the Phase 2 tests for the 5 lower layers (client, manager, bridge,
  dispatcher, surface builder). Test count: 394 → 422 (+28). Added `JiraUpdateResult { issueKey }`
  (not in the original Phase-1 list) so the 204 update echoes a typed key, mirroring
  `JiraTransitionResult`.
- **Phase 4 (docs)** — `docs/ARCHITECTURE.md` §4.9 + `TODO.md` reconciliation are owned by the
  architect/wrap-up agent and are NOT done in this developer session.
