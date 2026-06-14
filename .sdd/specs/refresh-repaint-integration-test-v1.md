# Spec: Refresh → Data-Model → Repaint Integration Test — v1

**Status**: Approved
**Created**: 2026-06-13
**Supersedes**: none (a new, additive TEST-design cycle within `refreshable-custom-generative-ui-v1`)
**Related plan**: `.sdd/plans/refresh-repaint-integration-test-v1.md`

---

## Overview

Prove — with an automated, node-env test exercising the REAL production functions — that the
`refreshable-custom-generative-ui-v1` mechanism actually works end-to-end: a refresh re-fetches
fresh data through a mock adapter, the `AdapterDispatcher` pushes an `updateDataModel`, and a CUSTOM
agent-composed `{path}`-bound surface (e.g. a kanban whose catalog `IssueList` binds
`issues: { path: "/items" }`) resolves and repaints the new rows in place. A SECOND refresh returning
CHANGED rows must repaint to the changed rows. The test must drive the actual apply + binding-resolve
functions the renderer uses (not hand-rolled copies), so it proves the real drawing structure.

## Background — why this test exists

`refreshable-custom-generative-ui-v1` is implemented and its unit tests are green, but each tested a
single seam in isolation (registration decision, dispatcher push, persistence round-trip). No single
test stitches the full chain — register-under-agent-surfaceId → mock fetch → `updateDataModel` at the
bound path → apply to the surface's data model → `{path}` binding resolves the new rows — so the claim
"데이터를 새로 땡겨서 다시 그림" (re-pull data and redraw) is not yet demonstrated as one continuous flow.
This cycle adds that demonstration. It is a TEST-only addition: it MUST NOT change the feature's
behavior, and MUST NOT introduce any new production seam (every seam it needs already exists).

## The real chain the test must exercise (verified against the codebase)

1. **Registration (main).** `planAgentSurfaceRegistration(descriptor, agentSpec)`
   (`src/main/descriptorRegistration.ts`) decides registration; for a `searchIssues` descriptor + a
   usable custom spec it returns `{ register: true, surfaceId: <agent's spec.surfaceId>, options:
   jiraListBindOptions (listPath "/items", pagination "append"), spec: <agent's spec> }`. The caller
   then `AdapterDispatcher.register(agentSpec.surfaceId, descriptor, options)`.
2. **Fetch (main, mock).** `AdapterDispatcher.refresh(surfaceId)` calls the injected
   `resolve: AdapterResolver`. The REAL resolver is `jiraAdapterResolver(manager)`
   (`src/main/jiraAdapter.ts`), which maps the descriptor to `manager.searchIssues({ jql })`, then
   `jiraIssueRow`-maps each summary to the bound row shape. The test injects a FAKE
   `JiraAdapterManager` (`{ searchIssues, getIssue }`) so the read returns canned rows per call — no
   network, no token.
3. **Push (main).** The dispatcher's `run` emits `updateDataModel { surfaceId, path: "/items", value:
   <rows> }` plus the reserved flag paths (`/loading`, `/hasMore`, `/error`) via `pushDataModel`.
4. **Apply (renderer-pure).** `applyDataModel(processMessage, surfaceId, payload)`
   (`src/renderer/dataModelApply.ts`) validates + re-stamps the payload and forwards it to
   `processMessage` — the exact helper `ActiveTabSurface` calls. The test gives it a node
   `processMessage` that mutates a local data model with the SDK's OWN `setValueByPath`
   (`@a2ui-sdk/utils/0.9`) — byte-for-byte the same store mutation `SurfaceContext.updateDataModel`
   performs in the renderer.
5. **Resolve (renderer-pure).** The catalog `IssueList`'s `issues` binding is resolved by
   `useBound` → `useDataBinding`, whose body calls the pure `resolveValue(source, dataModel, basePath,
   default)` from `@a2ui-sdk/utils/0.9` (which calls `getValueByPath`). The test drives `resolveValue`
   directly against the data model produced in step 4 with the agent spec's actual `issues` binding
   (`{ path: "/items" }`) — proving the bound surface "draws" the new rows.

---

## User Scenarios

### A refresh re-pulls data and the custom bound surface redraws it · P1

**As a** maintainer skeptical that the refresh→data-model→repaint structure actually works
**I want to** an automated test that runs the real registration, fetch, push, apply, and resolve code
**So that** "re-pull data via a mock adapter and the custom `{path}` surface redraws it" is proven, not asserted

**Acceptance criteria:**

- Given a CUSTOM agent spec (a kanban: a Row of Columns, each holding a catalog `IssueList` bound
  `issues: { path: "/items" }`, plus a `searchIssues` descriptor), when the test runs the real
  `planAgentSurfaceRegistration` + `AdapterDispatcher.register`, then the surface is registered under
  the AGENT's own `surfaceId` (not a generic shell's) and the spec to push is the agent's spec.
- Given that registration, when the test calls the real `AdapterDispatcher.refresh(surfaceId)` with the
  real `jiraAdapterResolver` over a fake manager whose first read returns SET A, then an
  `updateDataModel { surfaceId, path: "/items", value: <SET A rows> }` is emitted, and after applying
  the emitted pushes through the real `applyDataModel` + SDK store, resolving the `IssueList`'s
  `issues` binding via the real `resolveValue` yields exactly SET A's rows.
- Given the surface now shows SET A, when a SECOND `refresh` runs with the fake manager returning a
  CHANGED set B, then the emitted `updateDataModel` carries SET B at `/items`, and re-resolving the
  same `issues` binding against the updated data model yields SET B (the repaint proof) — not SET A.

### Reserved flag paths behave across the refresh · P2

**As a** maintainer verifying the surface's loading/error/hasMore affordances stay correct
**I want to** the test to assert the flag paths the surface binds resolve correctly through the chain
**So that** the spinner clears, "load more" gates on a real next page, and a recoverable error surfaces

**Acceptance criteria:**

- Given a successful refresh, when the pushes are applied, then `/loading` resolves to `false` (final),
  `/hasMore` resolves to `true` iff the mock returned a next cursor, and `/error` resolves to undefined.
- Given a refresh whose fake manager returns a recoverable failure (`ok: false`, e.g. `network`), when
  the pushes are applied, then `/error` resolves to the failure's message, `/loading` resolves to
  `false`, and the previously-shown `/items` rows are STILL resolvable (prior data intact, no wipe).

### Negative control — an unbound (literal-prop) surface does NOT repaint · P1

**As a** maintainer who wants the test to prove the BINDING is what makes refresh work
**I want to** the same chain run against a surface whose `IssueList.issues` is a LITERAL array (no `{path}`)
**So that** repaint is shown to depend on the `{path}` binding, not on any incidental side effect

**Acceptance criteria:**

- Given an `IssueList` whose `issues` is a literal array of rows (set L) and NOT a `{path}` binding,
  when the same `updateDataModel { path: "/items", value: <set B> }` is applied to the data model and
  the literal `issues` prop is resolved via the real `resolveValue`, then it still yields set L (the
  literal) — the data-model change does not affect a literal-prop surface, so it does not repaint.

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The test MUST drive the REAL `planAgentSurfaceRegistration` (`src/main/descriptorRegistration.ts`) and assert that, for a `searchIssues` descriptor + a USABLE custom spec, it returns `register: true`, `surfaceId === agentSpec.surfaceId`, `options === jiraListBindOptions` (listPath `/items`, pagination `append`), and `spec === agentSpec` — proving registration keys the AGENT's surfaceId and the spec to push is the agent's own custom spec, not a shell (FR-001/FR-002 of the parent feature). |
| FR-002 | The test MUST register that surface with a REAL `AdapterDispatcher` instance via `AdapterDispatcher.register(agentSpec.surfaceId, descriptor, options)` and MUST construct the dispatcher with the REAL `jiraAdapterResolver(fakeManager)` as its `resolve` — exercising the production resolver mapping (descriptor → `searchIssues` → `jiraIssueRow`), not a stub. |
| FR-003 | The mock fetch MUST be injected as a FAKE `JiraAdapterManager` (`{ searchIssues, getIssue }`) passed to `jiraAdapterResolver`, returning the test-controlled `JiraResult<JiraPage<JiraIssueSummary>>` per call (call 1 → set A, call 2 → set B). No real network, `JiraClient`, OAuth, `JiraManager`, or token may be involved; the fake manager carries no token (FR-009 of the parent feature — token stays in main; here it never exists at all). |
| FR-004 | On the FIRST `AdapterDispatcher.refresh(surfaceId)`, the test MUST capture the emitted `updateDataModel` payloads (via the dispatcher's injected `pushDataModel`) and assert one is `{ surfaceId, path: "/items", value: <set A rows> }`, where the rows equal `setA.map(jiraIssueRow)` — proving the dispatcher writes the mock's fresh data at the documented `searchIssues` list path keyed by the agent's surfaceId (FR-003/FR-005 of the parent feature). |
| FR-005 | The test MUST apply the captured pushes to a surface data model using the REAL `applyDataModel` (`src/renderer/dataModelApply.ts`) with a node `processMessage` that mutates the model via the SDK's OWN `setValueByPath` from `@a2ui-sdk/utils/0.9` — the same store mutation `SurfaceContext.updateDataModel` performs in the renderer. The test MUST NOT hand-roll the apply or the path-set logic. |
| FR-006 | The test MUST resolve the custom `IssueList`'s `issues` binding (the actual `{ path: "/items" }` taken from the agent spec) against the resulting data model using the SDK's OWN `resolveValue` from `@a2ui-sdk/utils/0.9` — the exact pure function `useDataBinding`/`useBound` calls in the renderer — and assert it yields set A's rows. The test MUST NOT hand-roll the binding resolution. |
| FR-007 | After a SECOND `refresh` whose fake manager returns CHANGED set B, the test MUST re-capture + re-apply the new pushes and re-resolve the SAME `issues` binding, asserting it now yields set B (and NOT set A) — the core repaint proof ("데이터를 새로 땡겨서 다시 그림"). |
| FR-008 | The test MUST assert the reserved flag paths resolve correctly through the chain: after a success, `/loading` → `false` (final), `/hasMore` → (mock returned a next cursor), `/error` → undefined; after a recoverable failure, `/error` → the failure message, `/loading` → `false`, and the prior `/items` rows remain resolvable (prior data intact). |
| FR-009 | The test MUST include a NEGATIVE CONTROL: an `IssueList` whose `issues` is a LITERAL array (set L), NOT a `{path}` binding. After applying an `updateDataModel` at `/items` (set B), resolving that literal `issues` via `resolveValue` MUST still yield set L — proving the `{path}` binding is what makes the surface repaint (a data-model change does not move a literal prop). |
| FR-010 | The test MUST run in vitest's NODE env (`*.test.ts`). It MUST NOT import any `.tsx` DOM component (e.g. `IssueList`, `ActiveTabSurface`, `controls.tsx`) into the test, MUST NOT require jsdom, and MUST NOT render React. It drives only the node-pure functions named above (`applyDataModel` is React-free + DOM-free; `resolveValue`/`setValueByPath` are pure SDK utils). |
| FR-011 | The test MUST NOT introduce any new production code or production seam. Every function it drives already exists; if implementation reveals a genuinely missing seam, the implementer MUST stop and surface it rather than adding production code under cover of a test (scope guard). |
| FR-012 | The test MUST assert no token/secret appears in any captured `updateDataModel` payload or in the descriptor used (the fake manager has none; the descriptor is `{ dataSource, query }` only) — a lightweight guard that the proven chain carries no secret (SC-004 of the parent feature). |

## Edge Cases & Constraints

- **Why a fake `JiraAdapterManager`, not a fake `fetchImpl`?** Injecting the fake at the manager
  boundary (`jiraAdapterResolver(fakeManager)`) keeps the REAL resolver mapping in the loop while
  needing zero token/OAuth/`JiraClient` plumbing, and guarantees no token can exist. A `JiraClient`
  `fetchImpl` fake is a valid lower seam but would drag in `JiraManager`/`TokenStore`/`ensureToken`
  for no added proof; it is explicitly NOT chosen. (Documented so the choice is deliberate.)
- **The renderer's React layer is intentionally NOT in the test.** `useDataBinding` is a thin React
  wrapper that (a) reads the surface's data model via `getDataModel(surfaceId)` and (b) calls the pure
  `resolveValue`. `SurfaceContext.updateDataModel` is a thin React wrapper over the pure
  `setValueByPath`. The test substitutes ONLY those thin React shells with direct calls to the same
  pure functions, so the load-bearing logic (validate/restamp in `applyDataModel`, JSON-Pointer
  set/get in the SDK) is the real code. This is the standard cosmos catalog convention (node-testable
  logic in `.ts`, never importing a `.tsx` into a `.test.ts`).
- **Custom layout shape.** The proving spec is a kanban: a `Row` whose children are `Column`s, each
  containing an `IssueList` bound `issues: { path: "/items" }` (all columns read the same list path —
  the documented `searchIssues` contract is one path per `dataSource`). The test asserts the binding
  resolves for the `IssueList` node taken verbatim from that spec; it need not assert the Row/Column
  layout renders (that is React/visual, out of scope), only that the bound node resolves the rows.
- **Out of scope:** the `getIssue`/detail repaint (the same structure; this cycle proves the list/
  `searchIssues` path as the representative case — a `getIssue` variant MAY be added but is not
  required); Slack/Confluence equivalents (same shared infra; Jira is the proving ground); pagination
  (`loadMore`/`page`) repaint (already unit-tested in `adapterDispatcher.test.ts`); any change to the
  feature's behavior, the token model, or the session schema; rendering React or asserting pixels.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | One node-env test file exercises the full chain (register → mock fetch → `updateDataModel` at `/items` → `applyDataModel` → SDK store → `resolveValue`) and passes, with the registration keyed to the agent's surfaceId (FR-001) and the pushed spec being the agent's custom kanban spec (not a shell). |
| SC-002 | Refresh 1 (set A) → the `IssueList`'s `{ path: "/items" }` binding resolves to set A's rows; refresh 2 (changed set B) → the SAME binding resolves to set B and not set A (FR-007). |
| SC-003 | The flag paths resolve correctly: `/loading` ends `false`, `/hasMore` matches the mock cursor, and a recoverable failure surfaces `/error` while keeping prior `/items` rows resolvable (FR-008). |
| SC-004 | The negative-control literal-prop `IssueList` does NOT change when the data model changes — `resolveValue` on the literal still yields set L (FR-009), proving the binding is load-bearing. |
| SC-005 | The test drives the REAL `applyDataModel`, `setValueByPath`, `resolveValue`, `jiraAdapterResolver`, `AdapterDispatcher`, and `planAgentSurfaceRegistration` — no reimplementation of apply/binding/dispatch logic (FR-005/FR-006), runs in node env with no `.tsx`/jsdom import (FR-010), and adds no production code (FR-011). |
| SC-006 | No captured `updateDataModel` payload nor the descriptor contains any token/secret (FR-012). |

---

## Open Questions

- [ ] None blocking. The seams are verified to exist (registration `planAgentSurfaceRegistration`;
  dispatcher injectable `resolve`; resolver `jiraAdapterResolver(manager)` over the
  `JiraAdapterManager` interface; renderer-pure `applyDataModel`; SDK-pure `setValueByPath` +
  `resolveValue`). No new production seam is required. If implementation surfaces a missing seam,
  stop and flag it (FR-011) rather than adding production code in a test cycle.
