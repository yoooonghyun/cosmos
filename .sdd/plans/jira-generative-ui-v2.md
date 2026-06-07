# Plan: Jira Generative UI — v2

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: .sdd/specs/jira-generative-ui-v2.md

---

## Summary

Move the Jira generative surface INTO the native Jira rail panel and swap the standard A2UI
catalog for a Jira **custom catalog** (`catalogId: 'jira'`), reusing v1's write/action plumbing
verbatim. Four mechanisms make this work, one per resolved open question:
(1) **Target routing (OQ1)** — add a `target: 'jira' | 'generated-ui'` field to `UiRenderPayload`
(carried end-to-end: bridge render frame → `UiBridge` → `ui:render`). The Jira panel and the
Generated-UI panel each host their OWN `A2UIProvider` (Jira panel with the `jira` catalog) and each
**filters `ui:render` by `target`**, ignoring the rest. Existing `ui:render`/`ui:action` channels
are reused; no new channel set. (2) **Single shared `AgentRunner` (OQ2)** — thread the run `target`
through `AgentRunner.run()` so the run grants the right render tool and its render is tagged with
the right target; keep the single-run guard (Jira and generic utterances run sequentially). (3) **A
second, Jira-scoped render tool `render_jira_ui` (OQ3)** in a stdio MCP entry script that teaches
the `jira` catalog vocabulary and stamps its bridge render frame with `target: 'jira'`; the standard
`render_ui` is unchanged (`target: 'generated-ui'`). (4) **Per-switch default refresh (OQ4)** — on
every rail switch to the Jira panel, main re-composes the default recent-issues surface
(`jiraSurfaceBuilder` → push `target: 'jira'`), with explicit loading + recoverable-error states and
a single bounded read per switch. The Jira surfaces are emitted (by BOTH the deterministic builder
and the agent) in the Jira custom catalog, whose status components consume the cosmos `--status-*`
tokens for native-panel parity. The custom catalog's COMPONENT CONTRACT is defined here; its VISUAL
design (pixels, token application) is the `designer`'s job in the design step (Step 2.5). All v1
write/scope/dispatch plumbing (`write:jira-work`, `JiraManager.transitionIssue/addComment/
getWriteCapability`, the `jira.*` deterministic binding via `JiraActionDispatcher`, write MCP tools,
validators, `availableTransitions`, PTY independence, `jiraSurfaceBuilder` MAPPING logic) is reused
unchanged — v2 only changes render LOCATION (Jira panel), ENTRY (default view + in-panel prompt +
target routing), and CATALOG (standard → jira). `client_secret`/tokens stay main-only as today.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer + standalone MCP entry script), ES modules                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Key dependencies  | **NO new npm dependency.** Reuses: the existing `UiBridge` + `ui:render`/`ui:action` IPC + bridge render frame (`BridgeRenderRequest`); the single `AgentRunner` + shared `mcpConfig.ts` builder; `@a2ui-sdk/react@0.9` `A2UIProvider`/`A2UIRenderer`/`useA2UIMessageHandler` + its custom-catalog mechanism (`catalog=` prop, or a registered catalog the provider resolves); `JiraManager.searchIssues/getIssue/transitionIssue/addComment/getWriteCapability`; `jiraSurfaceBuilder` mapping; `JiraActionDispatcher`; the `src/shared/jira.ts` resource shapes + `JiraBoundAction` contract. |
| Files to create   | `src/renderer/jiraCatalog/` — the Jira custom A2UI catalog (component contract: TicketCard, StatusBadge, TransitionPicker, IssueList container, CommentRow/CommentList, AddCommentControl; `index.ts` registering them under `catalogId: 'jira'`); its co-located `*.test.tsx` where unit-testable. `src/mcp/jiraRenderUiServer.ts` — the standalone stdio entry script exposing the `render_jira_ui` tool (relays to `UiBridge` with `target: 'jira'`). Co-located tests for any new pure module. (The designer owns the components' PIXELS; this plan/contract owns their props + actions.) |
| Files to modify   | `src/shared/ipc.ts` (add `target: 'jira' \| 'generated-ui'` to `UiRenderPayload`); `src/shared/bridge.ts` (add optional `target` to `BridgeRenderRequest` so the entry script's choice reaches main); `src/mcp/renderUiServer.ts` (stamp `target: 'generated-ui'` on its render frame — or rely on the default); `src/main/uiBridge.ts` (carry `target` from the render frame into the `UiRenderPayload` it pushes; default `'generated-ui'`); `src/main/jiraSurfaceBuilder.ts` (emit `jira`-catalog components; add `buildDefaultViewSurface(page)` for the recent-issues default; the post-write `buildIssueDetailSurface` now emits jira-catalog components); `src/main/jiraActionDispatcher.ts` (tag its re-push `target: 'jira'`); `src/main/agentRunner.ts` (accept a `target` on `run()`; for `'jira'` grant `render_jira_ui` + register the jira render server in its `--mcp-config`); `src/main/mcpConfig.ts` (add a `render_jira_ui` server entry + a builder that grants render_ui OR render_jira_ui by target); `src/main/index.ts` (wire the jira render bridge target into `pushRenderToRenderer`/`UiBridge`; add the jira render server to `embeddedMcpConfig`; a main→renderer trigger for the per-switch default refresh; thread `target` from `agent:submit`); `src/renderer/JiraPanel.tsx` (host its own `A2UIProvider` with the jira catalog, a `SurfaceBridge` filtering `ui:render` by `target: 'jira'`, an in-panel `PromptComposer`, the per-switch default-refresh request + loading/error states); `src/renderer/GeneratedUiPanel.tsx` (filter `ui:render` to `target: 'generated-ui'` only); `electron.vite.config.ts` (add a rollup `input` for `src/mcp/jiraRenderUiServer.ts` → `out/main/mcp/jiraRenderUiServer.js`). |
| Out of scope      | New Jira writes beyond v1 transition + comment; any new OAuth scope; re-speccing v1's write path; Confluence; making the generic Generated-UI panel Jira-aware; a second `AgentRunner`; the custom-catalog VISUAL design (designer owns pixels — Step 2.5); multi-site, bulk ops, offline queueing. |

### Resolved decisions (from the spec's open questions — now decided)

- **D1 — Target routing via a `target` field on `UiRenderPayload`, reusing existing channels
  (OQ1 / FR-004, FR-012).** Add `target: 'jira' | 'generated-ui'` to `UiRenderPayload`
  (`src/shared/ipc.ts`). It is carried end-to-end: a render reaches `UiBridge` over the bridge
  render frame (`BridgeRenderRequest`), so `BridgeRenderRequest` gains an optional `target`
  (default `'generated-ui'` when absent — backward-compatible with the standard `render_ui`).
  `UiBridge.onMessage` copies the frame's `target` into the `UiRenderPayload` it pushes; the
  deterministic `pushRenderToRenderer` callers (default view + post-write re-push) pass
  `target: 'jira'` explicitly. BOTH panels keep their own `A2UIProvider` and each `SurfaceBridge`
  ignores a `ui:render` whose `target` is not its own. No new IPC channel; `ui:action` is unchanged
  (the existing `requestId` + `jira.*` namespace already route actions correctly).

- **D2 — One shared `AgentRunner`; thread `target` through the run (OQ2 / FR-013).** `run()` gains a
  `target: 'jira' | 'generated-ui'` arg. For `'generated-ui'` the run grants `render_ui` (unchanged).
  For `'jira'` the run's `--mcp-config` registers the jira render server and `--allowedTools` grants
  `mcp__cosmos-jira-render-ui__render_jira_ui` (least-privilege; no standard render_ui in a jira
  run). The single-run guard is unchanged: a submit while busy is ignored. `agent:submit` carries
  the `target` (the Jira panel's composer submits `target: 'jira'`; the generic composer submits
  `target: 'generated-ui'`), validated at the boundary.

- **D3 — A separate Jira-scoped render tool `render_jira_ui` (OQ3 / FR-011).** A new stdio entry
  script `src/mcp/jiraRenderUiServer.ts` registers ONE tool, `render_jira_ui(spec)`, whose
  description teaches the `catalogId: 'jira'` vocabulary (TicketCard / StatusBadge / TransitionPicker
  / IssueList / CommentRow / AddCommentControl — name, data inputs, and which `jira.*` action each
  emits). It relays to the SAME `UiBridge` socket as `render_ui` but stamps its bridge render frame
  `target: 'jira'`, so the surface lands in the Jira panel. The standard `render_ui` server is
  unchanged. Heavier-on-MCP acknowledged (a second entry script + rollup input + tool description).
  *Chosen over a single shared render_ui teaching both catalogs because the per-target tool keeps
  each tool's description focused (less prompt confusion) and the routing falls out of which tool
  was granted to the run.*

- **D4 — Per-switch default refresh, main-driven (OQ4 / FR-002, FR-019, FR-020).** The Jira panel
  tells main "I was switched to" and main re-composes + pushes the default view. Mechanism: the
  Jira panel emits a lightweight request on becoming active (a new `jira:requestDefaultView` R→M
  channel, validated at the boundary); main runs ONE bounded `JiraManager.searchIssues` (a default
  recent-issues JQL, single page, no pagination loop — FR-020), composes via
  `jiraSurfaceBuilder.buildDefaultViewSurface`, and pushes `target: 'jira'`. While in flight the
  panel shows a loading state; a `reconnect_needed` routes to the native Connect/Reconnect; any
  other failure shows a recoverable error (FR-019). The rail switch itself never blocks on the read.
  *The request is renderer-driven (not a main-side "tab changed" hook) because the rail/active-tab
  state lives in `App.tsx`'s React state, not in main — the panel is the natural place to detect its
  own activation.*

### Custom-catalog component contract (owned here; PIXELS owned by the designer, Step 2.5)

Each component's data input is a `src/shared/jira.ts` shape (FR-010); each interactive component
emits the v1 `jira.*` bound action with the v1 context contract (FR-008). NO new resource type, NO
new action.

| `jira` component   | Data input (from `src/shared/jira.ts`)                 | Action emitted (v1 contract)                              |
|--------------------|--------------------------------------------------------|----------------------------------------------------------|
| `StatusBadge`      | `{ statusName: string; statusCategory: JiraStatusCategory }` | none (display); colored via `--status-*` (FR-007)   |
| `TicketCard`       | `JiraIssueSummary` (key, summary, status, assignee)    | none in default/list (open = a fresh utterance, as v1)   |
| `TransitionPicker` | `{ issueKey: string; availableTransitions: JiraTransition[] }` | `jira.transition` `{ issueKey, transitionId }`    |
| `IssueList`        | `JiraIssueSummary[]` (container of `TicketCard`s)      | none                                                     |
| `CommentRow` / `CommentList` | `JiraComment[]`                              | none                                                     |
| `AddCommentControl`| `{ issueKey: string }`                                 | `jira.comment` `{ issueKey, body }`                      |

The designer MUST NOT add components or actions beyond this set; this plan MUST NOT specify pixels.

### Build-wiring (FR-011 is heavier than v1 here)

**A new rollup `input` IS needed** for `src/mcp/jiraRenderUiServer.ts` so it builds to
`out/main/mcp/jiraRenderUiServer.js` (the path the new mcp-config entry registers) — unlike v1,
which added no entry. The jira custom catalog lives in the renderer bundle (no rollup change). The
new renderer/main modules bundle via the existing import graphs.

### Architecture decisions to land in `docs/ARCHITECTURE.md` at wrap-up (do NOT edit it now)

Flag for `wrap-up` (these change the system shape):
- **Target-routed, multi-panel A2UI hosting** — `ui:render` now carries a `target` and is consumed
  by MULTIPLE panels (Generated-UI + Jira), each its own `A2UIProvider`/catalog filtering by target.
  §3 / §4.3 / §4.4 / §5 describe a single Generated-UI panel today.
- **A Jira custom A2UI catalog (`catalogId: 'jira'`)** + a **second render tool `render_jira_ui`**
  (a new MCP entry script + bridge `target`) — §4.3's "render_ui is the UI-generation tool" and the
  MCP registry list (§4.7) need the second render tool noted.
- **Per-switch deterministic default-view compose** — main re-composes a Jira surface on rail
  activation (extends the v1 "main can compose surfaces deterministically" note for §4.3/§4.9).

---

## Implementation Checklist

> Ordered for the developer: Interface → Tests → Implement → Docs. Each item traces to a v2 FR.
> A `design` step (Step 2.5, the `designer` agent) sits between this plan and Interface for the
> custom-catalog PIXELS; this plan defines the COMPONENT CONTRACT only.

### Phase 1 — Interface (types & contracts; no behavior)

- [x] Read the v2 spec + this plan; confirm OQ1–OQ4 are resolved (D1–D4). No new npm install.
- [x] **`src/shared/ipc.ts`** — add `target: 'jira' | 'generated-ui'` to `UiRenderPayload` (FR-004).
  Document it: the panel filters `ui:render` by `target`. Add a `jira:requestDefaultView` channel
  name + (empty) payload type for the per-switch refresh request (FR-002), and a `target` field on
  `AgentSubmitPayload` (FR-013) so a run is tagged. No secret-bearing field (FR-017).
- [x] **`src/shared/bridge.ts`** — add an optional `target?: 'jira' | 'generated-ui'` to
  `BridgeRenderRequest` (default treated as `'generated-ui'`) so the render entry script's catalog
  choice reaches `UiBridge` (FR-004, FR-011). Backward-compatible (absent = generic).
- [x] **`src/shared/validate.ts`** — add `validateUiRenderTarget` (or fold into existing validators)
  and a `validateRequestDefaultView` boundary validator; widen `validateAgentPrompt` to accept +
  validate the `target` (default `'generated-ui'` if absent/invalid) (FR-002, FR-013, FR-017).
- [x] **`src/renderer/jiraCatalog/` contract** — declare the component types + props + emitted
  actions per the contract table above (TicketCard, StatusBadge, TransitionPicker, IssueList,
  CommentRow/CommentList, AddCommentControl), registered under `catalogId: 'jira'` for the
  `A2UIProvider`. Types/props only this phase; PIXELS come from the design step (FR-006, FR-008,
  FR-010, FR-018).
- [x] **`src/main/jiraSurfaceBuilder.ts`** — declare `buildDefaultViewSurface(page)` and re-type the
  existing builders to emit `jira`-catalog component names (FR-005, FR-006). Pure mapping, no
  network. Confirm action contexts stay the v1 `jira.*` contract (FR-008).
- [x] **`src/mcp/jiraRenderUiServer.ts`** — declare the `render_jira_ui` tool signature + the bridge
  client that stamps `target: 'jira'` (FR-011). Description string drafted (teaches the jira
  vocabulary) — copy can be refined in Implement.
- [x] **`src/main/agentRunner.ts`** — widen `run(utterance, target)` signature; declare the
  per-target `--mcp-config` + `--allowedTools` selection (FR-013).
- [x] **`src/main/mcpConfig.ts`** — declare a `jiraRenderUiMcpServerEntry` + a target-aware config
  builder (FR-011, FR-013).
- [x] Review all new types against the spec — no invented properties, no parallel Jira resource
  type (FR-010), no secret/token field anywhere (FR-017).

### Phase 2 — Testing (unit; pure seams)

- [x] `validateUiRenderTarget` / `validateRequestDefaultView` / widened `validateAgentPrompt`:
  happy path; absent `target` → defaults `'generated-ui'`; invalid `target` → warn + default; empty
  utterance still starts no run (FR-002, FR-013, FR-017).
- [x] `UiBridge`: a render frame with `target: 'jira'` produces a `UiRenderPayload` with
  `target: 'jira'`; a frame with no `target` defaults to `'generated-ui'` (FR-004).
- [x] `jiraSurfaceBuilder`: `buildDefaultViewSurface(page)` → a `jira`-catalog issue-list/TicketCard
  surface; empty page → calm empty surface; `buildIssueDetailSurface` emits jira-catalog components
  whose TransitionPicker action is `jira.transition` `{issueKey, transitionId}` and AddCommentControl
  is `jira.comment` `{issueKey, body}` (FR-005, FR-006, FR-008); status uses the StatusBadge contract
  (FR-007). Pure — no network.
- [x] `JiraActionDispatcher`: its re-push now carries `target: 'jira'` (FR-004, FR-009); all v1
  behaviors (write → cancel pending → re-read → re-push; error/scope-gap notice; never touches
  PTY/AgentRunner) still hold (FR-009, FR-017).
- [x] `AgentRunner.run(utterance, 'jira')`: builds a `--mcp-config` registering the jira render
  server and `--allowedTools` granting only `render_jira_ui` (not standard render_ui); `'generated-ui'`
  grants only `render_ui`; single-run guard unchanged (FR-013).
- [x] `jiraRenderUiServer` (pure relay seam): a `render_jira_ui` call stamps the bridge frame
  `target: 'jira'` and validates the surfaceUpdate at the boundary like render_ui (FR-011).
- [x] Jira catalog components (where unit-testable without pixels): StatusBadge maps each
  `JiraStatusCategory` to a `--status-*` class incl. an `unknown` fallback; TransitionPicker emits
  `jira.transition` with the selected `transitionId`; AddCommentControl emits `jira.comment` with a
  non-empty body and guards empty/whitespace (FR-006, FR-007, FR-008). Deeper visual assertions are
  the design step's concern.

### Phase 3 — Implementation

- [x] Implement the `src/shared/ipc.ts` + `src/shared/bridge.ts` + `src/shared/validate.ts`
  additions (FR-002, FR-004, FR-011, FR-013, FR-017).
- [x] Implement `UiBridge` carrying `target` from the render frame into the pushed payload; default
  `'generated-ui'` (FR-004).
- [x] Implement `src/mcp/jiraRenderUiServer.ts` (`render_jira_ui`, jira-vocabulary description,
  `target: 'jira'` frame) and add its rollup `input` to `electron.vite.config.ts` so it bundles to
  `out/main/mcp/jiraRenderUiServer.js` (FR-011).
- [x] Implement `mcpConfig.ts` jira render entry + target-aware builder; implement
  `AgentRunner.run(utterance, target)` granting the right tool per target (FR-011, FR-013).
- [x] Implement the Jira custom catalog components in `src/renderer/jiraCatalog/` to the design
  spec's pixels (after Step 2.5), consuming `--status-*` tokens (FR-006, FR-007, FR-008, FR-010).
- [x] Implement `jiraSurfaceBuilder.buildDefaultViewSurface` + re-emit jira-catalog components from
  all builders (FR-002, FR-005, FR-006); tag `JiraActionDispatcher`'s re-push `target: 'jira'`
  (FR-004, FR-009).
- [x] **`src/renderer/JiraPanel.tsx`**: when connected, render its own `A2UIProvider` (jira catalog)
  + a `SurfaceBridge` filtering `ui:render` to `target: 'jira'`; add an in-panel `PromptComposer`
  submitting `agent:submit` with `target: 'jira'`; on becoming the active rail surface, send
  `jira:requestDefaultView` and show the loading state; render the recoverable error / reconnect
  states (FR-001, FR-002, FR-003, FR-004, FR-019). Keep the not-connected Connect affordance
  (FR-016).
- [x] **`src/renderer/GeneratedUiPanel.tsx`**: filter its `SurfaceBridge` to render only
  `target: 'generated-ui'` (default), so a jira-targeted render never lands here; the generic
  composer submits `target: 'generated-ui'` (FR-012, FR-014).
- [x] **`src/main/index.ts`**: add the jira render server to `embeddedMcpConfig`; handle
  `jira:requestDefaultView` (bounded `searchIssues` → `buildDefaultViewSurface` → push
  `target: 'jira'`, with `reconnect_needed`/error handling — FR-002, FR-015, FR-019, FR-020); thread
  `target` from `agent:submit` into `agentRunner.run`; ensure `pushRenderToRenderer` is unchanged
  except payloads now carry `target` (FR-004). Construct nothing that couples the dispatcher/runner
  to the PTY (FR-009).
- [x] All tests pass (`npm test`); typecheck clean (`npm run typecheck`); build succeeds
  (`npm run build`) — confirm the new `electron.vite.config.ts` `input` builds the jira render
  server (FR-011). Manually verify (per `npm run dev`): switch to Jira → fresh default view; type an
  utterance → jira-catalog surface in the Jira panel (not the generic panel); transition/comment →
  real write + re-render in the Jira panel; a generic utterance still renders in the Generated-UI
  panel only (FR-012).
- [x] Reused shared utilities — ONE write implementation (v1 `JiraManager`/dispatcher), ONE surface
  builder (now jira-catalog), ONE `AgentRunner`; no parallel resource types, no second channel set,
  no second runner (FR-009, FR-013, reuse boundary).

### Phase 4 — Docs

- [ ] Mark the item done / add follow-ups in `TODO.md` at wrap-up.
- [x] Update this plan's Deviations with anything that differed.
- [ ] **Reconcile note (do NOT edit ARCHITECTURE.md in this plan):** hand the three architecture
  decisions above (target-routed multi-panel A2UI hosting; the `jira` custom catalog + `render_jira_ui`
  second render tool; the per-switch deterministic default-view compose) to `wrap-up` for landing in
  `docs/ARCHITECTURE.md` §3 / §4.3 / §4.4 / §4.7 / §4.9 / §5.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-06**: Plan authored from the v2 spec (OQ1–OQ4 resolved). Assumptions to confirm during
  implementation:
  (1) `@a2ui-sdk/react@0.9`'s custom-catalog registration API — the v1 design noted the provider
  resolves components against the `catalog=` prop / a registered catalog; confirm the exact
  registration shape for `catalogId: 'jira'` before building `src/renderer/jiraCatalog/` (it
  determines whether the two panels' providers can hold different catalogs cleanly).
  (2) The default recent-issues JQL for `buildDefaultViewSurface` (e.g.
  `assignee = currentUser() ORDER BY updated DESC`) — a single bounded page (FR-020); confirm the
  exact JQL and page size in the design/implement step.
  (3) Whether the per-switch refresh should debounce rapid switches (FR-020 says one bounded read per
  switch and no retry-storm; a trailing-edge guard may be worth adding if rapid toggling is common) —
  confirm during implement.

- **2026-06-06 (implementation, Steps 3–5 complete)**: Interface → Tests → Implement landed. All
  365 tests pass (`npm test`), typecheck clean (`npm run typecheck`), build succeeds (`npm run build`)
  — `out/main/mcp/jiraRenderUiServer.js` (6.90 kB) bundles from the new rollup `input`. `npm run dev`
  boots cleanly (main + preload + renderer + Electron, jira render server present); the Jira-panel
  generative surface was NOT click-verified (no automated UI driver). Resolved assumptions:
  (1) A2UI custom catalog is per-`A2UIProvider` via the `catalog=` prop (no global registry), so the
  Jira and Generated-UI panels host independent providers with different catalogs cleanly; the jira
  catalog reuses the SDK's standard `Column` for child-by-id rendering and permits `Text` passthroughs
  (design §1.1). (2) Default-view JQL is `assignee = currentUser() ORDER BY updated DESC`, a single
  bounded page, no pagination (`JIRA_DEFAULT_VIEW_JQL` in `src/main/index.ts`). (3) No debounce added;
  the panel fires `jira:requestDefaultView` only on the false→true active edge (`wasActiveRef`), which
  already yields one bounded read per switch.
  DEVIATIONS:
  - **Default-view read-failure surface (vs design §9.3):** the design called for a NATIVE
    ErrorState + Retry for a default-view read error. The declared IPC contract has only `ui:render`
    (M→R) as a main-push channel for this path, so main pushes a catalog `Notice` surface
    (`buildNoticeSurface`, `target:'jira'`) for recoverable errors instead of a native retry button.
    `reconnect_needed`/`not_connected` route through the existing `jira:statusChanged` → native
    Connect/Reconnect affordance (no push). This stays within the declared channels and never crashes;
    a native ErrorState+Retry would require a new declared channel (spec-level change — not taken).
  - **`validateRequestDefaultView` requires an object:** the validator does `if (!isObject(raw))`,
    so the preload sends an explicit empty object (`ipcRenderer.send(RequestDefaultView, {})`) rather
    than no payload — otherwise main receives `undefined` and the trigger is always rejected.
  - **v1 dispatcher tests reconciled to the jira catalog:** `jiraActionDispatcher.test.ts` previously
    asserted the v1 standard-catalog output (separate `Icon`/`Text` blocks). v2 composes the outcome
    on a single `Notice` component (`noticeKind` + `message`), so those 5 assertions were updated to
    the v2 shape (behavior unchanged: write → cancel pending → re-read → re-push `target:'jira'`).
