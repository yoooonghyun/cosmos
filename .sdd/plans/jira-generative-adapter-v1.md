# Plan: Jira Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Last updated**: 2026-06-09
**Spec**: .sdd/specs/jira-generative-adapter-v1.md

---

## Summary

Build the **API→UI generative adapter** pattern, with Jira as the first of three sibling cycles
(Jira → Slack → Confluence) and the owner of the **shared infrastructure**. We exploit A2UI 0.9's
existing view/data split: bound surfaces use `{path}` bindings + `TemplateBinding` instead of
literal props (`jiraSurfaceBuilder`), `ActiveTabSurface` learns to process `updateDataModel`, and
each surface carries a persisted, **secret-free adapter descriptor** `{ dataSource, query }`
(manager call id + non-secret JQL/cursor/issueKey). A reusable **main-side AdapterDispatcher**
re-executes a descriptor on refresh triggers (tab restore, panel re-activation, explicit refresh)
and on reserved pagination actions, pushing a fresh `updateDataModel` (keyed by `surfaceId`) — not
a full surface re-push. The existing deterministic `jira.*` write path (`JiraActionDispatcher`) is
reconciled into this generalized dispatch so there is one coherent main-side action path. Append
pagination writes the full accumulated list at the bound path (main holds the accumulation; no
RFC6901 `-`); page-replace swaps the list and updates cursor state, with Prev/Next bound to a
`LogicExpression` over `hasMore`/`hasPrev` and a `loading` flag driving the button spinner. All
fetching/tokens stay in main; every new payload is in the one typed IPC contract and validated at
the boundary (invalid → warn + ignore). **This is a UI-bearing feature** — the `design` skill runs
after this plan is approved and before interface (the bound surfaces, pagination controls, and
loading/refresh affordances are new visual states).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + React renderer + shared) |
| Key dependencies  | `@a2ui-sdk/types/0.9` + `@a2ui-sdk/react/0.9` (`updateDataModel`, `{path}`, `TemplateBinding`, `DynamicBoolean`/`LogicExpression`); existing `JiraManager`/`JiraClient`, `UiBridge`, `SessionStore`/`sessionSnapshot`, `validate.ts`, `jiraSurfaceBuilder`, `JiraActionDispatcher` |
| Files to create   | `src/main/adapterDispatcher.ts` (shared); `src/shared/adapter.ts` (shared descriptor + reserved action types); adapter descriptor tests; surface-builder binding tests |
| Files to modify   | `src/shared/ipc.ts`, `src/shared/validate.ts`, `src/renderer/ActiveTabSurface.tsx`, `src/main/jiraSurfaceBuilder.ts`, `src/main/jiraActionDispatcher.ts`, `src/main/index.ts`, `src/main/sessionStore.ts` + `src/shared/ipc.ts` snapshot types + `src/renderer/sessionSnapshot.ts`/`useGenerativePanelTabs.ts`, `src/renderer/JiraPanel.tsx`, the Jira custom catalog components (`src/renderer/jiraCatalog/`), `docs/ARCHITECTURE.md` |

### Shared infra vs. Jira-specific wiring (the load-bearing split)

**Shared infra (Slack/Confluence cycles reuse, must NOT be Jira-specific):**

1. **`updateDataModel` processing in `ActiveTabSurface`** — process a third A2UI message kind,
   keyed by `surfaceId`, applied to the active tab's surface. (FR-002/FR-010/FR-023)
2. **`updateDataModel` push channel** — a typed main→renderer payload `{ surfaceId, path?, value? }`
   on the existing `ui:render`-adjacent contract in `src/shared/ipc.ts`, validated at the boundary.
   (FR-009/FR-010/FR-022)
3. **Adapter descriptor schema** `{ dataSource, query }` in `src/shared/adapter.ts`, secret-free,
   with its persistence in the session snapshot beside the composed view spec. (FR-005/FR-006/FR-007)
4. **`AdapterDispatcher`** (`src/main/adapterDispatcher.ts`) — generic: re-execute a descriptor via
   an injected manager-call resolver, hold accumulated lists, push `updateDataModel` (append vs.
   page-replace), manage the `loading` flag, never depend on PtyManager/AgentRunner. (FR-009/FR-012/
   FR-013/FR-014/FR-015/FR-016/FR-018)
5. **Reserved adapter-action namespace** (e.g. `adapter.refresh`, `adapter.loadMore`, `adapter.page`)
   intercepted deterministically at the `ui:action` boundary, paralleling the `jira.*` interception.
   (FR-019)
6. **Bound-surface composition convention** — `{path}` bindings + `TemplateBinding` + initial
   `updateDataModel` + bound `hasMore`/`hasPrev`/`loading`; documented so sibling builders follow it.
   (FR-001/FR-003/FR-017)

**Jira-specific wiring (this cycle's concrete use; siblings re-implement their own analog):**

- `jiraSurfaceBuilder` re-expressed to bound surfaces (list/search/default + detail). (FR-004)
- Jira descriptors: `dataSource → searchIssues|getIssue`, `query → { jql, cursor }|{ issueKey }`.
  (FR-008)
- Reconcile `JiraActionDispatcher` (`jira.*` writes + re-read + reflect) into the generalized
  dispatch path, preserving write behavior. (FR-011)
- Jira issue list wired to append pagination (load-more); detail needs none. (FR-020)
- `JiraPanel` refresh affordance + restore/re-activation triggers calling the adapter. (FR-013)
- Jira catalog components (`IssueList`/`TicketCard`/detail) updated to read bound data + render the
  pagination controls + `loading` spinner. (FR-017/FR-018)

> Siblings (Slack/Confluence) will reference items 1–6 verbatim and supply only their own
> builders, descriptors, manager-call resolvers, and catalog components.

---

## Implementation Checklist

> Note: the **`design` skill runs after this plan is approved and before Phase 1 (interface)** —
> it establishes the bound-surface visual states (pagination controls, load-more, prev/next,
> refresh affordance, per-button loading spinner) in the shared Tailwind + shadcn/ui system and
> produces `.sdd/designs/jira-generative-adapter-v1.md`. Interface work below starts after design.

### Phase 0 — Design (designer, precedes interface)

- [x] Design spec for pagination controls (load-more, prev/next), refresh affordance, and the
  per-button `loading` spinner state, reusing existing Jira catalog chrome + tokens.
  (`.sdd/designs/jira-generative-adapter-v1.md`)

### Phase 1 — Interface (shared first, then Jira)

- [x] Read spec; confirm no open questions remain.
- [x] **[shared]** Define adapter descriptor `{ dataSource, query }` + reserved action namespace +
  `updateDataModel` push payload types in `src/shared/adapter.ts` / `src/shared/ipc.ts` — secret-free,
  no invented fields beyond the spec.
- [x] **[shared]** Extend `SessionSnapshot`/`GenerativeTabSnapshot` (`src/shared/ipc.ts`) to persist a
  bound surface's descriptor beside its `surface.spec`; bump `SESSION_SCHEMA_VERSION`. (→ 2)
- [x] **[shared]** Define boundary validators in `src/shared/validate.ts` (descriptor, reserved
  pagination/refresh actions, `updateDataModel` payload) — pure, injectable logger.
- [x] **[Jira]** Define Jira descriptor shapes mapping to `searchIssues`/`getIssue` in
  `src/shared/jira.ts` (or `adapter.ts`), carrying only non-secret JQL/cursor/issueKey.
- [x] Review types vs spec — no invented properties; trace each to an FR.

### Phase 2 — Testing

- [x] **[shared]** Descriptor validator tests: valid, secret-bearing rejected, malformed → warn+ignore.
- [x] **[shared]** `AdapterDispatcher` tests: refresh → `updateDataModel`; append accumulates full
  list at path; page-replace swaps + updates cursor; `loading` toggles; fetch error → recoverable
  notice + loading cleared; gone-issue/empty-page/stale-cursor edge cases; no PtyManager/AgentRunner
  reachable (by construction).
- [x] **[shared]** `updateDataModel` boundary validator tests (warn+ignore on malformed).
- [x] **[Jira]** `jiraSurfaceBuilder` bound-surface tests: list uses `{path}` bindings + initial
  `updateDataModel` (seed rows + `/loading` + `/hasMore`); detail binds every display value to a
  `/issue` sub-path; bound `hasMore`/`loading`; no literal data props; secret-free descriptor.
  (`src/main/jiraSurfaceBuilder.test.ts`) — list uses append `hasMore` only; detail has no prev/next.
- [x] **[Jira]** Reconciliation tests: `jira.*` write path still executes → re-reads → reflects outcome
  through the generalized dispatch (`src/main/jiraActionDispatcher.test.ts`); `jiraBackNav` Back
  restore unaffected (`src/renderer/jiraBackNav.test.ts`).
- [x] **[renderer]** `ActiveTabSurface` `updateDataModel` apply covered by `dataModelApply.test.ts`
  (malformed payload degrades safely); descriptor round-trip in `sessionSnapshot.test.ts`.
  NOTE: `ActiveTabSurface.tsx` itself (a `.tsx`) is NOT unit-tested in node env (no jsdom); its
  pure apply logic lives in `dataModelApply.ts` per the catalog `.ts`/`.test.ts` split convention.

### Phase 3 — Implementation

- [x] **[shared]** Implement `AdapterDispatcher` (`src/main/adapterDispatcher.ts`): descriptor
  re-execution via injected manager-call resolver, accumulation state, append/page-replace push,
  `loading` management, channel-independent deps only.
- [x] **[shared]** Wire the reserved adapter-action interception at the `ui:action` boundary in
  `src/main/index.ts` (parallel to the existing `jira.*` interception), and the `updateDataModel`
  push sink (guard against destroyed window). Lazy re-registration on `adapter.refresh` carrying a
  restored descriptor (a surface main never freshly composed — a restored tab).
- [x] **[shared]** Implement `ActiveTabSurface` `updateDataModel` processing + initial seed (FR-002),
  via `dataModelApply.ts`; restored-surface refresh fires only when `restored` is set.
- [x] **[shared]** Implement descriptor persistence in `sessionSnapshot`/`useGenerativePanelTabs`
  (restore carries the descriptor → `adapter.refresh` re-registers + re-executes → fresh
  `updateDataModel`, FR-013). Schema bumped to 2; main re-validates/strips the descriptor at load.
- [x] **[Jira]** Re-express `jiraSurfaceBuilder` default-view + detail to bound surfaces +
  initial `updateDataModel` (FR-004) and emit Jira descriptors (FR-008). `buildBoundIssueListSurface`
  / `buildBoundIssueDetailSurface`; `jiraAdapter.ts` resolver + bind options.
- [x] **[Jira]** Reconcile `JiraActionDispatcher` into the generalized path (FR-011) — registration
  persists in the dispatcher map so a write re-push still refreshes; writes unchanged (SC-008).
- [x] **[Jira]** Update Jira catalog components (`src/renderer/jiraCatalog/`) to read bound data via
  `useDataBinding`/`useBound`, render RefreshButton / LoadMoreButton / PaginationBar bound to
  `hasMore`/`hasPrev`, and show the `loading` spinner.
- [~] **[Jira]** Refresh affordance lives in the catalog (RefreshButton in IssueList/TicketCard);
  restore/re-activation triggers fire from `ActiveTabSurface` (not `JiraPanel`) — see deviation.
- [x] All tests pass (804); `npm run typecheck` clean. Reused shared utilities — no duplicated logic.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md`: add the API→UI generative adapter pattern (bound surfaces,
  descriptor, `AdapterDispatcher`, `updateDataModel` push keyed by surfaceId, refresh triggers,
  the two pagination shapes), note the `jira.*`-into-adapter reconciliation, and add an Open
  Questions / Next Steps entry. Keep it consistent with §4.3/§4.4/§4.9/§4.11.
- [ ] Update `TODO.md` (wrap-up) and mark the next-steps item.
- [ ] Update this plan with any deviations.

---

## Resolved ambiguities (decided during authoring; consistent with the brief)

- **Reconcile vs. replace `JiraActionDispatcher`.** The brief says "fold/generalize." Plan keeps the
  proven `JiraActionDispatcher` write behavior (execute → re-read → reflect outcome) but routes it
  through the **generalized main-side dispatch path** so writes and adapter refresh/pagination share
  one `ui:action`-boundary interception and one push discipline. Net: one coherent path, no write
  regression. Final factoring (subsume the class vs. compose them) is an implementation detail left
  to interface/impl, not a spec-level open question.
- **How the descriptor attaches to a surface.** Persisted in `GenerativeTabSnapshot` beside the
  composed `surface.spec` (only `composed:true` surfaces persist today), keyed implicitly by the
  tab; in-flight it is associated by `surfaceId`. No new top-level snapshot key; schema version bump.
- **Reserved action namespace.** A dedicated `adapter.*` reserved namespace (e.g. `adapter.loadMore`,
  `adapter.page`, `adapter.refresh`) mirrors the existing `jira.*` reservation and keeps the
  pagination/refresh actions deterministic (never returned to the agent). Exact names finalized at
  interface.

## What this cycle deliberately leaves to Slack/Confluence

- Their **concrete descriptors** (`dataSource` → Slack/Confluence manager reads; `query` → channel
  cursor / CQL + opaque cursor) and the manager-call resolver wiring for each.
- Their **bound builders + catalog components** (Slack ChannelList/MessageList/SearchResultList;
  Confluence ContentList/PageDetail) re-expressed to `{path}`/`TemplateBinding` + initial
  `updateDataModel`, and which surfaces are append vs. page-replace (Slack/Confluence both paginate
  by opaque cursor — likely append for history/search, page-replace where a prev/next UX is wanted).
- Their **read-only nature**: Slack/Confluence have no write dispatch, so they reuse only the
  refresh + pagination portions of the shared dispatcher, not the write reconciliation.
- Any per-integration refresh-trigger nuances (e.g. Confluence default-feed vs. search source).

## Deviations & Notes

- **2026-06-09**: Initial plan authored. No code written. Design step precedes interface.
- **2026-06-09 (impl)**: **Refresh triggers fire from `ActiveTabSurface`, not `JiraPanel`.** The
  restore/re-activation refresh is panel-agnostic (shared infra), so it belongs on the shared
  `ActiveTabSurface` body keyed on `surface.requestId`, gated by a `restored` flag set only in
  `hydrateGenerativeTabs`. A fresh compose seeds its own data model and must NOT re-fetch (SC-008
  perf). The manual RefreshButton lives in the catalog. No `JiraPanel` change was needed.
- **2026-06-09 (impl)**: **Lazy re-registration via an optional descriptor on `adapter.refresh`.**
  After a restart, main has no surface registration for a restored tab. `AdapterActionRequest`'s
  Refresh variant carries an optional secret-free `descriptor`; main lazily registers (choosing
  bind options by `descriptor.dataSource`) before refreshing. `validateAdapterAction` validates +
  strips secrets from that descriptor (drops it if invalid; the refresh still proceeds).
- **2026-06-09 (impl)**: **`useBound<T>` cast helper in the catalog.** A2UI 0.9 `DynamicValue` does
  not model object/array literals, so binding object/array props (issue, issues, comments,
  availableTransitions) needs a cast to `DynamicValue | undefined` before `useDataBinding`. Recorded
  in `docs/DEVELOPMENT.md`.
- **2026-06-09 (impl)**: **Detail is append-`pagination:'none'`, fully bound.** Every detail display
  value binds to a `/issue` sub-path so a post-write/refresh `updateDataModel` of `/issue`
  re-renders the whole detail in place (no view re-compose, no agent), preserving the write path.
- **Verification**: `npm run typecheck` clean; `npm test` = 41 files / 804 tests pass. Renderer +
  catalog `.tsx` changes were exercised ONLY by typecheck + node-env unit tests of their extracted
  pure logic (`dataModelApply`, `sessionSnapshot`) — NOT live in Electron (no jsdom/E2E here).
