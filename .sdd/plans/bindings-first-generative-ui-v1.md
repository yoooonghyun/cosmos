# Plan: Bindings-First Generative UI — v1

**Status**: Draft
**Created**: 2026-06-14
**Last updated**: 2026-06-14
**Spec**: `.sdd/specs/bindings-first-generative-ui-v1.md`

---

## Grounding

Investigation run directly for this plan (mandatory report):

**codegraph_explore**
- `jiraCatalog slackCatalog confluenceCatalog component registration catalogId IssueList SearchResultList MessageList ChannelList PageDetail data-bearing component types` — confirmed each catalog's data containers and their rows props: Jira `IssueList.issues` + `TicketCard.issue` (detail bind); Slack `SearchResultList.matches`, `ChannelList.channels`, `MessageList.messages`; Confluence `SearchResultList.results`, `PageDetail` (bound title/space/body). These read their data through `useBound` and accept either a literal or a `{path}`.
- (prior cycle, carried) `rebindAgentSurface specRebinder planRegions registerAgentSurfaceBindings uiBridge onMessage adapterBindingRegistry LIST_SOURCE_DATA_PROP` — the rebind/seed mechanism is built and intact; `uiBridge.onMessage` runs the `bindings` path with precedence over `descriptor`.

**Reads**
- `src/main/uiBridge.test.ts` — the test harness pattern: a fake entry script dials the bridge socket (`dial`), sends a `BridgeRenderRequest` (`renderAndAwaitResult`), `pushRender` captured into `pushed[]`, `warn` is a `vi.fn()` injected via `UiBridgeDeps`. The existing `registerAgentSurface` suite already varies a spy and asserts `pushed`/`warn` — the no-binding-warning test slots into the SAME harness.
- `src/main/adapterBindingRegistry.ts` (from prior cycle) — `LIST_SOURCE_DATA_PROP` values are the rows props (`issues`, `channels`, `messages`, `matches`, `results`); this is the single source main already owns for "which prop holds a list's rows."
- The four tool-description strings (`JIRA_TOOL_DESCRIPTION`, `SLACK_TOOL_DESCRIPTION`, `CONFLUENCE_TOOL_DESCRIPTION`, `A2UI_TOOL_DESCRIPTION`) read in full during the spec cycle.

**memory_recall** — persisted the cycle decision (`mem_mqdsvrz2_…`): mechanism built, gap is the four tool descriptions teaching the outdated "author {path} yourself / no literal rows" model.

---

## Summary

Reframe the four MCP render-tool descriptions (`render_jira_ui`, `render_slack_ui`,
`render_confluence_ui`, `render_ui`) around a BINDINGS-FIRST model — the agent composes the layout,
may pass fetched rows as literal seed props, and declares one binding per data-bearing container so
EVERY data surface is refreshable — removing the now-incorrect "author the `{path}` yourself / do NOT
pass literal rows / literals can never repaint" instructions that `rebindAgentSurface` made obsolete.
In addition, add a dev-facing, side-effect-free no-binding WARNING at the `UiBridge.onMessage`
boundary: when a frame carries neither `bindings` nor `descriptor` yet its spec contains a
data-bearing container (detected via the rows-prop set main already owns in `LIST_SOURCE_DATA_PROP`
plus the known detail bind props), emit a single `warn()` and continue (never throw, never block, err
toward NOT warning). No new runtime mechanism, no IPC/bridge contract change; the rebind/seed/dispatch
path is untouched.

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Node main + plain-Node MCP entry scripts) |
| Key dependencies  | Existing only — `@modelcontextprotocol/sdk`, `zod`, `vitest`; no new deps |
| Files to create   | `src/main/dataBearingWarning.ts` (pure heuristic helper) + its `.test.ts` (the heuristic is data-only — split `.ts`/`.test.ts` per repo convention) |
| Files to modify   | `src/mcp/jiraRenderUiServer.ts`, `src/mcp/slackRenderUiServer.ts`, `src/mcp/confluenceRenderUiServer.ts`, `src/mcp/renderUiServer.ts` (descriptions); `src/main/uiBridge.ts` (call the heuristic in `onMessage`); `src/main/uiBridge.test.ts` (warning test); `docs/ARCHITECTURE.md` (note: teaching reframed, §4h mechanism unchanged) |

**Design step: SKIPPED.** Per CLAUDE.md the `design` skill / designer agent applies only to
visual/renderer surfaces (theme tokens, `src/renderer/components/ui/`). This feature changes MCP
tool-description strings and a main-side warning log — no renderer UI, no new component, no styling.
Recorded here so the cycle skips Design and proceeds plan → interface → test → implement.

**The no-binding heuristic (FR-008/FR-009), authoritative source of "data-bearing":**
- The set of list rows props is the VALUES of `LIST_SOURCE_DATA_PROP` (`issues`, `channels`,
  `messages`, `matches`, `results`) — main already owns this map, so the heuristic does not duplicate
  or hardcode a parallel list and stays in sync as sources are added.
- The set of detail bind props is the small fixed set the detail catalogs read a bound value from
  (`issue` for Jira `TicketCard`/detail; Confluence `PageDetail`'s bound `body`/`title`/`space`). To
  keep the heuristic CONSERVATIVE and false-positive-free, the helper treats a component as
  data-bearing when it carries any of these data props with a value that is EITHER a literal array
  (list seed) OR a `{path}` binding. A component with no such prop → not data-bearing → silent.
- Detection is over `spec.components` (the flat A2UI list main already has on the frame). It is pure,
  synchronous, allocation-light, and called ONLY when both `message.bindings` and `message.descriptor`
  are undefined (so it never runs on already-refreshable frames).
- Errs toward NOT warning: an unparseable/oddly-shaped spec, an unknown component type, or a prop set
  that does not match the known data-prop names → no warning. The warning is purely informational
  (`[ui] data-bearing surface composed with no binding — it will not be refreshable; declare a binding
  per data container`), dev-facing, and changes nothing about what renders.

---

## Implementation Checklist

> Update as work progresses. Add inline notes when a step deviates.

### Phase 1 — Interface

- [x] Re-read `.sdd/specs/bindings-first-generative-ui-v1.md`; confirm OQ-1 is resolved (warning IS in scope) and no other open question remains.
- [x] Define the pure heuristic surface in new `src/main/dataBearingWarning.ts`: a single exported predicate, e.g. `specHasUnboundDataContainer(spec: unknown): boolean`, that derives its rows-prop set from `LIST_SOURCE_DATA_PROP` (import, do not hardcode) plus a small fixed detail-prop set. No IPC types, no new contract — pure function over the spec shape main already holds.
- [x] Confirm no new fields are added to `BridgeRenderRequest`/`UiRenderPayload`/`src/shared/ipc.ts` — FR-010 (contract unchanged).

### Phase 2 — Tool descriptions (the core; FR-001–FR-006)

- [x] `src/mcp/renderUiServer.ts` `A2UI_TOOL_DESCRIPTION` — reframe bindings-first: (a) compose the layout + pass fetched rows as literal seed props is EXPECTED; (b) declare one binding per data-bearing container to make it refreshable; (c) `bindings` is primary, `descriptor` is the degenerate single-binding form, keep "never both" + note bindings wins; (d) REMOVE "Bind the data-driven props (NOT literals) … so they repaint" and "literals will not change on refresh"; keep the per-`dataSource` valid values + secret-free `query` note (FR-006).
- [x] `src/mcp/jiraRenderUiServer.ts` `JIRA_TOOL_DESCRIPTION` — same reframing; REMOVE step "2) Bind the data-driven props to PATHS … do NOT pass the fetched rows as literal/static props (literals can NEVER repaint)" and the partitioned "Do NOT pass literal rows (they can never repaint)"; replace the refreshable/partitioned examples to show literal seed rows + a declared binding per container (kanban example: literal `issues` arrays + one binding per column).
- [x] `src/mcp/slackRenderUiServer.ts` `SLACK_TOOL_DESCRIPTION` — same reframing; REMOVE "bind the list props to these data-model PATHS … (NOT literal/static values)" and "Any prop left as a literal will NOT change on refresh."
- [x] `src/mcp/confluenceRenderUiServer.ts` `CONFLUENCE_TOOL_DESCRIPTION` — same reframing; REMOVE "bind the data-driven props … (NOT literal/static values)" and "Any prop left as a literal will NOT change on refresh."
- [x] Cross-check all four read uniformly (FR-005): identical model + seeding semantics, differing only in catalog component/type names, `dataSource` values, and rows-prop names. Leave the `AdapterSourcePath`/`AdapterFlagPath` references only where they remain accurate (the agent MAY still bind flags; it just isn't REQUIRED to author the data `{path}`).

### Phase 3 — No-binding dev warning (FR-008/FR-009)

- [x] Implement `specHasUnboundDataContainer` in `src/main/dataBearingWarning.ts`: iterate `spec.components` (guard non-array/non-object), return true on the first component carrying a known data prop (rows-prop from `LIST_SOURCE_DATA_PROP` values, or a detail prop) whose value is a literal array OR a `{path}`; else false. Pure, no throw.
- [x] Wire into `src/main/uiBridge.ts` `onMessage`: AFTER the `bindings`/`descriptor` branches, when BOTH `bindings === undefined` (and nothing got registered) AND `message.descriptor === undefined`, call the predicate on `message.spec`; if true, `this.warn(...)` once. Must run after the existing branches, never alter `spec`, never affect settle/push.

### Phase 4 — Tests

- [x] `src/main/dataBearingWarning.test.ts` (happy + edges): a spec with `IssueList { issues: [...] }` and no binding → true; with a `{path}` and no binding → true; a detail `{ issue: {path} }` → true; a purely static spec (`Text`/`Column` only) → false; an empty/malformed spec → false (no throw); a spec already carrying the rows prop but the frame would have a binding is NOT this unit's concern (predicate is spec-only) — assert predicate purity.
- [x] `src/main/uiBridge.test.ts` add a suite (mirrors the `registerAgentSurface` harness): (a) a `generated-ui`/`jira` frame with NO bindings/descriptor whose spec has a data container → `warn` called once, surface still pushed; (b) a frame WITH a descriptor (or bindings) and a data container → `warn` NOT called for the no-binding reason; (c) a static-only spec with no binding → `warn` NOT called. Reuse `dial`/`renderAndAwaitResult`; assert `pushed` unchanged in every case (FR-009: render never altered).
- [x] Confirm existing `uiBridge` / `specRebinder` / validation tests still pass unchanged (FR-007 — mechanism untouched).

### Phase 5 — Docs

- [x] `docs/ARCHITECTURE.md`: in the generative-UI / §4h "Multi-region refreshable surfaces" area, add a short note that the render-tool TEACHING is bindings-first (agent composes + declares one binding per data container; literal rows are a seed) and that the rebind/seed MECHANISM is UNCHANGED. Add a one-line note about the dev-facing no-binding warning at the `UiBridge` boundary. Do NOT rewrite the §4h mechanism description (it is already correct).
- [x] Reconcile `TODO.md` if this work was tracked there (leave for `wrap-up` if not).
- [x] Update this plan's Deviations section with anything that differed.

### Phase 6 — Verify

- [x] `npm run typecheck` (node + web) clean.
- [x] `npm test` (vitest) green — new + existing.

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-14**: Plan authored. OQ-1 resolved by the orchestrator — the no-binding dev warning IS in
  scope (Phase 3). Design step SKIPPED (no renderer/visual work). The heuristic derives "data-bearing"
  from `LIST_SOURCE_DATA_PROP` (main already owns it) plus a small fixed detail-prop set, rather than
  importing renderer catalog internals into main — keeps the main/renderer boundary clean and the set
  self-updating as list sources are added.
- **2026-06-14 (implementation)**: All 6 phases complete. Notes on what differed / was decided:
  - **Detail-prop set + literal-scalar rule.** `DETAIL_BIND_PROPS = ['issue','title','space','body']`
    (Jira `TicketCard.issue`; Confluence `PageDetail.title/space/body`, confirmed via the catalog
    components). To stay false-positive-free, a DETAIL prop only counts as data-bearing when it holds a
    `{path}` binding — a literal scalar title/body is a static surface and does NOT warn. A LIST rows
    prop counts when it holds a literal array OR a `{path}` (both are what the rebinder seeds/rewrites).
  - **Unused import cleanup.** Reframing the four descriptions removed every `AdapterSourcePath.*`
    reference (the agent no longer hand-authors `{path}`s), so `AdapterSourcePath` was dropped from all
    four MCP imports; `AdapterFlagPath` is retained (still referenced for the optional flag binds).
  - **No contract change (FR-010 confirmed).** No field added to `BridgeRenderRequest`/`UiRenderPayload`/
    `src/shared/ipc.ts`; the warning is a pure main-side log over `message.spec`.
  - **Tests + verify.** New `src/main/dataBearingWarning.test.ts` + a new suite in
    `src/main/uiBridge.test.ts`. `npm run typecheck` clean (node+web); `npx vitest run` = 959 passed,
    0 failed (existing rebind/uiBridge/validation suites untouched, FR-007).

- **2026-06-14 (v2 enforcement — runtime follow-up).** The v1 tool-description reframe shipped but
  was INSUFFICIENT at runtime: a `npm run dev` Jira-kanban run fetched issues BROADLY, partitioned them
  into columns CLIENT-SIDE by status, and called `render_jira_ui` with LITERAL rows and NO
  `bindings`/`descriptor` (refresh disabled; reload repaints stale rows). Main cannot infer the
  bindings — the per-column narrowed JQL is intent only the model knows — so the model MUST declare
  them. Both approved reinforcements were added (NO IPC/contract change, FR-010 preserved):
  - **Fix A — grounding steering.** A uniform `BINDINGS_FIRST_STEERING` clause is appended to all three
    data-bearing `groundingPromptForTarget` branches (`src/main/mcpConfig.ts`): EVERY data container
    must carry a binding whose `query` is that container's OWN narrowed fetch; NEVER partition a broad
    fetch into multiple containers without a per-container narrowed-query binding; literal rows are the
    seed only. Asserted in `src/main/mcpConfig.test.ts`.
  - **Fix B — tool-level rejection.** Each `render_*_ui` handler (renderUiServer/jira/slack/confluence)
    runs the shared `BindingsFirstEnforcer` BEFORE relaying: a data-bearing spec with neither
    `descriptor` nor `bindings` returns an MCP `isError` with an instructive, secret-free message
    naming the offending container, and does NOT render — the model resubmits with bindings. Static
    surfaces and already-bound calls render normally.
  - **Shared-predicate placement.** The predicate `specHasUnboundDataContainer` (plus a new
    `firstUnboundDataContainerId` that names the container, plus `evaluateBindingsFirst` /
    `BindingsFirstEnforcer`) moved to **`src/shared/dataBearingSpec.ts`** so the MCP rollup bundles can
    import it (they cannot import `src/main/`). To satisfy "derive rows props from
    `LIST_SOURCE_DATA_PROP`" without importing main, `LIST_SOURCE_DATA_PROP` itself was moved to
    `src/shared/adapter.ts`; `src/main/adapterBindingRegistry.ts` now re-exports it (existing importers
    unchanged) and `src/main/dataBearingWarning.ts` is a thin re-export of the shared heuristic (main's
    `UiBridge` warning still works). MCP bundles verified via `npm run build` (a shared
    `dataBearingSpec` chunk is emitted into all four `*RenderUiServer.js`).
  - **Retry cap.** `ENFORCEMENT_REJECT_CAP = 2` (in `src/shared/dataBearingSpec.ts`), held as an
    in-memory counter on a per-render-server-process `BindingsFirstEnforcer` instance (the process
    lives exactly one AgentRunner run, so the BridgeClient/enforcer persist across that run's render
    calls). After 2 rejections it falls back to rendering anyway (the warn-and-render behavior) so the
    surface still appears and the run never hangs.
  - **Tests + verify.** New `src/shared/dataBearingSpec.test.ts` (predicate + `firstUnboundDataContainerId`
    + `evaluateBindingsFirst` reject/allow + `BindingsFirstEnforcer` cap/budget) and the steering
    assertion in `src/main/mcpConfig.test.ts`. Existing `dataBearingWarning`/`uiBridge`/`adapterBindingRegistry`
    suites stay green via the re-exports. `npm run typecheck` clean (node+web); `npx vitest run` = 980
    passed, 0 failed; `npm run build` green (all four MCP servers bundle the shared module). No spec
    change needed — the enforcement is a runtime reinforcement of FR-001/FR-008 within the existing
    contract. Not committed.

- **2026-06-14 (v3 — dataSource id vs read-tool name).** A further `npm run dev` run isolated the
  ACTUAL root cause: the v2 steering WORKED (the model fetched per-status with three `jira_search_issues`
  calls and DID pass `bindings`, so the enforcer correctly allowed it), but it set each binding's
  `descriptor.dataSource` to the MCP READ-TOOL name `jira_search_issues` instead of the adapter source
  enum id `searchIssues`. So main's `validateAdapterDescriptor` rejected all three as cross-target
  (`adapterSourceMatchesTarget` fails), stripped the bindings, and the surface landed unbound (dev log:
  `[adapter] ignoring descriptor — dataSource does not belong to the frame target (cross-target):
  jira_search_issues jira`). Two-part fix, NO IPC/contract change:
  - **Schema-level rejection.** Each `render_*_ui` server tightened `DESCRIPTOR_SCHEMA.dataSource`
    from `z.string()` to `z.string().refine(s => VALID_DATA_SOURCES.includes(s), …)`, with
    `VALID_DATA_SOURCES` derived from that target's `*AdapterSource` enum values
    (`JiraAdapterSource` in jira, `SlackAdapterSource` in slack, `ConfluenceAdapterSource` in
    confluence; generic `renderUiServer` = the UNION of all three, mirroring
    `TARGET_ADAPTER_SOURCES['generated-ui']`). A read-tool-name value now fails MCP input validation
    AT the render tool (the model resubmits with the right id) instead of silently passing the
    boundary and being dropped by main. The `.refine` message names the valid ids and warns against
    the read-tool name.
  - **Teaching the exact ids.** All four tool descriptions and `BINDINGS_FIRST_STEERING`
    (`src/main/mcpConfig.ts`) now state the valid per-integration `dataSource` ids (Jira
    `searchIssues`/`getIssue`; Slack `listChannels`/`getHistory`/`search`; Confluence
    `defaultFeed`/`searchContent`/`getPage`) and that `dataSource` is the ADAPTER SOURCE id, NOT the
    MCP read-tool name (`jira_search_issues`/`slack_*`/`confluence_*`).
  - **Exact ids confirmed (via codegraph):** Jira `searchIssues`, `getIssue`; Slack `listChannels`,
    `getHistory`, `search`; Confluence `defaultFeed`, `searchContent`, `getPage`; generic
    `generated-ui` = the union of all eight.
  - **Tests + verify.** Extended `src/main/mcpConfig.test.ts` (the steering names the per-integration
    ids + the "ADAPTER SOURCE id" caveat + the read-tool names called out as wrong) and
    `src/shared/validateAdapter.test.ts` (a read-tool name belongs to NO target — the same membership
    the `.refine` uses — while the adapter source id IS accepted). `npm run typecheck` clean
    (node+web); `npx vitest run` = 982 passed, 0 failed; `npm run build` green (all four MCP servers
    rebundle the enum-derived `VALID_DATA_SOURCES`). Not committed.
