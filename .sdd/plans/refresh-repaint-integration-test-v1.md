# Plan: Refresh → Data-Model → Repaint Integration Test — v1

**Status**: Draft
**Created**: 2026-06-13
**Last updated**: 2026-06-13
**Spec**: `.sdd/specs/refresh-repaint-integration-test-v1.md`

---

## Summary

Add ONE node-env vitest file that proves the `refreshable-custom-generative-ui-v1` mechanism works
end-to-end by driving the REAL production functions on both the main side (registration + mock fetch +
push) and the renderer-pure side (apply + binding-resolve). The test composes a custom kanban spec (a
`Row` of `Column`s each holding a catalog `IssueList` bound `issues: { path: "/items" }`) + a
`searchIssues` descriptor; runs the real `planAgentSurfaceRegistration` to confirm registration keys
the agent's surfaceId; registers a real `AdapterDispatcher` whose `resolve` is the real
`jiraAdapterResolver` over a FAKE `JiraAdapterManager` (canned rows per call, no network/token);
refreshes; captures the emitted `updateDataModel`s; applies them with the real `applyDataModel` whose
`processMessage` mutates a local data model via the SDK's own `setValueByPath`; and resolves the
`IssueList`'s `{ path: "/items" }` binding with the SDK's own `resolveValue`. A second refresh with
changed rows proves repaint; flag paths and a negative-control literal-prop surface round out the
proof. No production code changes; no new seam.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (vitest, node env) |
| Key dependencies  | All EXISTING. Real fns driven: `planAgentSurfaceRegistration` (`src/main/descriptorRegistration.ts:58`), `AdapterDispatcher` (`src/main/adapterDispatcher.ts:131`, `register` :152 / `refresh` :184), `jiraAdapterResolver` (`src/main/jiraAdapter.ts:105`) over the `JiraAdapterManager` interface (`src/main/jiraAdapter.ts:77`), `jiraIssueRow` (`src/main/jiraAdapter.ts:87`), `jiraListBindOptions` (`src/main/jiraAdapter.ts:47`), `JIRA_LIST_PATH = AdapterSourcePath.searchIssues = "/items"` (`src/main/jiraAdapter.ts:42`), `applyDataModel` (`src/renderer/dataModelApply.ts:30`), and the SDK-pure `setValueByPath` + `getValueByPath` + `resolveValue` from `@a2ui-sdk/utils/0.9` (`node_modules/@a2ui-sdk/utils/dist/0.9/pathUtils.js`, `.../dataBinding.js`). Reference shapes: `AdapterDescriptor` (`src/shared/adapter.ts:143`), `JiraIssueSummary` (`src/shared/jira.ts:84`), `JiraPage` (`src/shared/jira.ts:171`), `JiraSearchParams`/`JiraGetIssueParams` (`src/shared/jira.ts`). |
| Files to create   | `src/renderer/refreshRepaintIntegration.test.ts` (node env; the new integration test). |
| Files to modify   | NONE (test-only cycle; no production change). |

### The two test seams (the REAL apply + binding-resolve functions)

| Half | Real function | File:line | Why it is the right seam |
|------|---------------|-----------|--------------------------|
| **(a) Apply an `updateDataModel` to the surface's data model** | `applyDataModel(processMessage, surfaceId, payload, warn?)` | `src/renderer/dataModelApply.ts:30` | The exact helper `ActiveTabSurface` calls for both the seed and each in-place push (`ActiveTabSurface.tsx:105` and `:151`). React-free + DOM-free. The test supplies a node `processMessage` that, on an `updateDataModel`, calls the SDK's own `setValueByPath(model, path ?? "/", value)` — the SAME mutation `SurfaceContext.updateDataModel` performs (`SurfaceContext.js`: `y = setValueByPath`). So `applyDataModel`'s real validate/restamp logic AND the SDK's real JSON-Pointer set algorithm are both in the loop. |
| **(b) Resolve a component's `{path}` binding against that data model** | `resolveValue(source, dataModel, basePath, default)` (+ `getValueByPath`) from `@a2ui-sdk/utils/0.9` | `node_modules/@a2ui-sdk/utils/dist/0.9/dataBinding.js` (`resolveValue`), `.../pathUtils.js` (`getValueByPath`) | This is exactly what the renderer's `useDataBinding` hook calls: `useDataBinding.js` reads `getDataModel(surfaceId)` then returns `resolveValue(source, model, basePath, default)`. cosmos's `useBound` (`src/renderer/catalogShared/controls.tsx:46`) is a thin cast over `useDataBinding`, and `IssueList` resolves `issues` via `useBound(surfaceId, issues, undefined)` (`src/renderer/jiraCatalog/components.tsx:280`). Driving `resolveValue` with the `IssueList` node's actual `issues` source proves the same resolution the renderer performs. |

### The mock-API injection point (no new production seam)

- **Chosen seam: a FAKE `JiraAdapterManager` passed to the real `jiraAdapterResolver`.**
  `jiraAdapterResolver(manager: JiraAdapterManager): AdapterResolver` (`src/main/jiraAdapter.ts:105`)
  already depends ONLY on the tiny interface `{ searchIssues(params), getIssue(params) }`
  (`src/main/jiraAdapter.ts:77`). The test builds a fake implementing it whose `searchIssues` returns
  a test-controlled `JiraResult<JiraPage<JiraIssueSummary>>` per call (call 1 → set A, call 2 → set
  B; a later call → a recoverable `{ ok: false, kind: 'network', message }`). This exercises the REAL
  resolver mapping (descriptor → `searchIssues` → `jiraIssueRow`-mapped rows + `nextCursor`) with NO
  network, NO `JiraClient`, NO `JiraManager`/`TokenStore`/OAuth, and NO token anywhere.
- The dispatcher consumes that resolver through its already-injectable `resolve: AdapterResolver` dep
  (`AdapterDispatcherDeps.resolve`, `src/main/adapterDispatcher.ts:99`); `pushDataModel` is injected to
  capture the emitted `updateDataModel`s (the harness pattern in `adapterDispatcher.test.ts:38`).
- **Alternative seam (NOT chosen, documented):** a fake `JiraClient` `fetchImpl`
  (`JiraClientDeps.fetchImpl`, `src/main/integrations/jiraClient.ts:183`). Valid lower seam but drags
  in `JiraManager.ensureToken`/`TokenStore` plumbing for no added proof, so the manager-level fake is
  preferred.
- **No new production seam is required.** Every injection point already exists.

---

## Implementation Checklist

### Phase 1 — Interface / fixtures (in the test file)

- [ ] Read the spec; confirm no open questions remain (none blocking).
- [ ] Create `src/renderer/refreshRepaintIntegration.test.ts` (node env — placed under `src/renderer/`
      beside `dataModelApply.ts` since it drives that renderer-pure helper; it imports NO `.tsx`).
- [ ] Fixture: `setA` and `setB` as `JiraIssueSummary[]` (different `key`/`summary`/`statusCategory`),
      and a `failure` result `{ ok: false, kind: 'network', message: 'Could not refresh. Please retry.' }`.
- [ ] Fixture: a FAKE `JiraAdapterManager` whose `searchIssues` returns a queued sequence
      (`[pageOf(setA), pageOf(setB), failure]`) one per call, recording call count; `getIssue` throws
      / returns a benign stub (unused). `pageOf(s) = { ok: true, data: { items: s, nextCursor?: 'cur2' } }`.
- [ ] Fixture: the CUSTOM kanban agent spec — `surfaceId: 'agent-kanban-1'`, `components: [Row → 3×
      Column → each an `IssueList` with `issues: { path: '/items' }`, `loading: { path: '/loading' }`,
      `hasMore: { path: '/hasMore' }`, `error: { path: '/error' }`]`. Keep the IssueList node objects
      retrievable so the test can read each node's `issues` source verbatim.
- [ ] Fixture: the descriptor `{ dataSource: 'searchIssues', query: { jql: 'assignee = currentUser()' } }`.
- [ ] Helper: a node `processMessage(message)` closing over a mutable `let model = {}` that, on
      `message.updateDataModel`, does `model = setValueByPath(model, payload.path ?? '/', payload.value)`
      (import `setValueByPath` from `@a2ui-sdk/utils/0.9`). This mirrors `SurfaceContext.updateDataModel`.
- [ ] Helper: `applyAll(pushes)` = `for (const p of pushes) applyDataModel(processMessage, surfaceId, p)`
      then return the current `model`. (Drives the REAL `applyDataModel`.)
- [ ] Helper: `resolveIssues(model)` = `resolveValue(issuesNode.issues, model, null, undefined)` using
      the SDK's `resolveValue`; reused for binding + flag-path resolution.

### Phase 2 — Test cases (each maps to a spec assertion)

- [ ] **FR-001 (registration keys the agent's surfaceId, push is the agent's spec):** call the REAL
      `planAgentSurfaceRegistration(descriptor, kanbanSpec)`; assert `register === true`,
      `surfaceId === 'agent-kanban-1'`, `options === jiraListBindOptions` (deep `{ listPath: '/items',
      pagination: 'append' }`), and `spec === kanbanSpec` (the agent's spec, not a shell).
- [ ] **FR-002/FR-003 (real dispatcher + real resolver over the fake manager):** construct
      `new AdapterDispatcher({ resolve: jiraAdapterResolver(fakeManager), pushDataModel: capture })`
      and `dispatcher.register('agent-kanban-1', descriptor, jiraListBindOptions)`.
- [ ] **FR-004 (first refresh emits updateDataModel at `/items` with the mock's rows):**
      `await dispatcher.refresh('agent-kanban-1')`; find the captured push with `path === '/items'`;
      assert its `surfaceId === 'agent-kanban-1'` and `value` deep-equals `setA.map(jiraIssueRow)`.
- [ ] **FR-005 + FR-006 (the bound IssueList resolves SET A from the resulting data model):**
      `model = applyAll(capturedPushes)`; assert `resolveValue(issuesNode.issues, model, null,
      undefined)` deep-equals `setA.map(jiraIssueRow)` — the REAL apply + REAL resolve chain.
- [ ] **FR-007 (SECOND refresh → changed rows → repaint proof):** clear captures;
      `await dispatcher.refresh('agent-kanban-1')` (fake now returns set B); re-apply; assert the
      `/items` push value AND the re-resolved binding deep-equal `setB.map(jiraIssueRow)` and are NOT
      equal to set A's rows.
- [ ] **FR-008 (flags behave):** after a success refresh, assert `resolveValue({path:'/loading'},
      model,...) === false`, `resolveValue({path:'/hasMore'}, model,...) === (cursor present)`, and
      `resolveValue({path:'/error'}, model,...) === undefined`. Then drive a THIRD refresh whose fake
      returns `failure`; re-apply; assert `/error` resolves to the message, `/loading` resolves
      `false`, and the prior `/items` rows are STILL resolvable (prior data intact — the dispatcher
      does not write `/items` on a failure).
- [ ] **FR-009 (negative control — literal-prop surface does NOT repaint):** build an `IssueList` node
      with `issues: setL` (a literal `TicketCardNode[]`, NOT a `{path}`); apply an `updateDataModel`
      `{ path: '/items', value: setB.map(jiraIssueRow) }`; assert `resolveValue(literalNode.issues,
      model, null, undefined)` still deep-equals `setL` (the literal passes through; the model change
      does not move it).
- [ ] **FR-012 (no secret in the chain):** assert every captured push payload, JSON-stringified,
      contains no token-looking key (`authorization`, `token`, `accessToken`, `client_secret`,
      `Bearer`), and the descriptor has only `dataSource` + `query` keys.

### Phase 3 — Run + verify

- [ ] `npm test` green (the new file passes; no existing test regresses).
- [ ] `npm run typecheck` (node + web) green.
- [ ] Confirm the test imports ONLY: `vitest`; `applyDataModel` from `../renderer/dataModelApply` (or
      `./dataModelApply`); `setValueByPath`, `getValueByPath`, `resolveValue` from `@a2ui-sdk/utils/0.9`;
      `AdapterDispatcher` from `../main/adapterDispatcher`; `jiraAdapterResolver`, `jiraIssueRow`,
      `jiraListBindOptions`, `JIRA_LIST_PATH` from `../main/jiraAdapter`; `planAgentSurfaceRegistration`
      from `../main/descriptorRegistration`; types from `../shared/adapter` + `../shared/jira`. NO `.tsx`
      import, NO jsdom, NO React render (FR-010).
- [ ] Confirm NO production file changed (FR-011). If a missing seam was discovered, STOP and surface it
      instead of adding production code.

### Phase 4 — Docs

- [ ] Add a one-line note to `docs/ARCHITECTURE.md` (panel-refresh-v1 / OQ-5 / OQ-4h area) that the
      refresh→data-model→repaint chain has an end-to-end integration test
      (`src/renderer/refreshRepaintIntegration.test.ts`) driving the real apply + binding-resolve
      functions, so the "redraw on fresh data" claim is regression-guarded.
- [ ] Update this plan with deviations; reconcile `TODO.md` via wrap-up.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-13**: Plan authored. Verified seams against the codebase: (a) apply half =
  `applyDataModel` (`src/renderer/dataModelApply.ts:30`) with a node `processMessage` using the SDK's
  own `setValueByPath` (the same mutation `SurfaceContext.updateDataModel` runs); (b) resolve half =
  the SDK's own `resolveValue`/`getValueByPath` (`@a2ui-sdk/utils/0.9`), which is exactly what the
  renderer's `useDataBinding` (and cosmos's `useBound`/`IssueList`) calls. Mock-injection point = a
  fake `JiraAdapterManager` into the real `jiraAdapterResolver` — exercises the real resolver mapping
  with no token/network and needs no new production seam. The dispatcher's `resolve` + `pushDataModel`
  deps are already injectable. No production change required.

- **2026-06-13 (implementation)**: Implemented all 6 test cases; `npm test` 932 passed (incl. the new
  6), `npm run typecheck` (node + web) green. TWO deviations from the plan, both test-enabling, no
  production runtime/build code changed:
  1. **Test file path moved `src/renderer/` → `src/main/`** (`src/main/refreshRepaintIntegration.test.ts`).
     The test is inherently CROSS-PROCESS (FR-002 requires value-importing the main-side
     `AdapterDispatcher`/`jiraAdapterResolver`/`planAgentSurfaceRegistration`; FR-005/FR-006 require
     value-importing the renderer-pure `applyDataModel`). cosmos typechecks the two process trees as
     mutually-exclusive composite TS projects (`tsconfig.node.json` = main/shared, `tsconfig.web.json`
     = renderer/shared), so EITHER placement triggers `TS6307` ("file not in the project's file list")
     on the one cross-tree value import. Placing it in `src/main/` (where the heavier deps live) and
     importing `../renderer/dataModelApply` confines the cross-tree edge to a single renderer-PURE file
     (no DOM/React; imports only a `src/shared` type), which the node project can typecheck.
  2. **`tsconfig.node.json` include adds the single file `src/renderer/dataModelApply.ts`** so that one
     cross-tree value import resolves under the node project. This is typecheck-only config — the
     electron-vite build (`electron.vite.config.ts`) does NOT consume these tsconfigs, so production
     bundling is unaffected; and listing the ONE renderer-pure file (not a `src/renderer/**` glob)
     keeps the main↔renderer boundary tight (no general main→renderer import is unlocked). This is the
     "missing seam" FR-011 anticipated — a test-typecheck path for an intentionally cross-process
     integration test — resolved with the least-invasive, non-runtime change rather than new production
     code. Flagged in the implementation report for architect review.
  3. Minor: `resolveBinding` casts the source to the SDK's `FormBindableValue` before `resolveValue`,
     mirroring cosmos's own `useBound` cast (`controls.tsx`), to satisfy the SDK's typed signature.
