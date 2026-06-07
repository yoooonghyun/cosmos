# Plan: Jira Generative UI — v1

**Status**: Draft
**Created**: 2026-06-06
**Last updated**: 2026-06-06
**Spec**: .sdd/specs/jira-generative-ui-v1.md

---

## Summary

Make Jira surfaces in the Generated-UI panel actionable: a surface action in the reserved
`jira.*` namespace is **deterministically bound** to a real Jira write and dispatched in the
Electron **main** process WITHOUT re-invoking `claude`. The render path is unchanged — Jira
screens are composed via the existing `render_ui` → `UiBridge` → `ui:render` loop using the
A2UI **standard catalog** and the resource types already in `src/shared/jira.ts`. The new write
plumbing is one implementation reached by two callers: (1) **deterministic dispatch** — main
intercepts a `jira.*` action at the existing `ui:action` boundary, routes it to a new **Jira
action dispatcher** that calls new `JiraManager` write methods, resolves the pending `render_ui`
call as `cancel` (no Claude turn), then RE-COMPOSES the Jira surface from the write's
`JiraResult` via a new **main-side Jira surface builder** and re-pushes it through the existing
`ui:render`; and (2) **model-mediated** — new WRITE Jira MCP tools (`jira_transition_issue`,
`jira_add_comment`) in the existing `jiraMcpServer.ts` that relay over the existing `JiraBridge`
to the SAME `JiraManager` write methods. The Jira OAuth scope set gains exactly
`write:jira-work` (in `JIRA_OAUTH_SCOPES`, `src/main/integrations/atlassianConfig.ts` — confirmed
the real location), and a stored token lacking that scope MUST NOT be used for a write: main
detects the scope gap from the persisted `StoredTokenSet.scopes` and surfaces a
"reconnect to enable Jira actions" outcome pointing at the existing Jira Connect/Reconnect
affordance (no second OAuth entry point). `client_secret` and tokens stay main-only as today.

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                     |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron main + React renderer + standalone MCP entry script), ES modules                                                                                                                                                                                                                                                                                                                                                       |
| Key dependencies  | **NO new npm dependency.** Reuses: existing `JiraManager.run()` token/refresh path, the single `JiraClient`, the `JiraResult<T>`/`JiraPage<T>` discipline + DTOs in `src/shared/jira.ts`, the existing `JiraBridge` (NDJSON-over-socket) + `jiraMcpServer.ts` entry, the existing `UiBridge` + `ui:render`/`ui:action` IPC, `@a2ui-sdk/types/0.9` (`A2uiSurfaceUpdate` = `UpdateComponentsPayload`), and `safeStorage`-backed `TokenStore` (`scopes` field). |
| Files to create   | `src/main/jiraActionDispatcher.ts` (new — the `jira.*` deterministic dispatcher); `src/main/jiraSurfaceBuilder.ts` (new — main-side Jira→A2UI standard-catalog surface builder, reused by initial render and post-write update); their co-located `*.test.ts`                                                                                                                                                                                  |
| Files to modify   | `src/shared/jira.ts` (write tool names in `JiraTool`/`JiraOp`; bound-action name + context contract; write param shapes; available-transitions on `JiraIssueDetail`); `src/main/integrations/jiraClient.ts` (`transitionIssue` + `addComment` REST; surface transitions on `getIssue`); `src/main/jiraManager.ts` (`transitionIssue`/`addComment`/`getWriteCapability` via `run()`); `src/main/jiraBridge.ts` (route write ops); `src/mcp/jiraMcpServer.ts` (register 2 write tools); `src/main/integrations/atlassianConfig.ts` (add `write:jira-work` to `JIRA_OAUTH_SCOPES`); `src/main/uiBridge.ts` (intercept `jira.*` before settling) OR `src/main/index.ts`'s `ui:action` handler (see decision D1); `src/shared/validate.ts` (`validateJiraTransition` / `validateJiraComment` / bound-action validator); `src/shared/bridge.ts` (allow Jira write ops on the existing `jira_call` frame — `op` widens to `JiraOpName`, already the type) |
| Out of scope      | Jira custom A2UI catalog (`catalogId:"jira"`, `TicketCard`/`TransitionPicker`); writes beyond transition + comment; any scope beyond `write:jira-work`; a `jira_list_transitions` MCP tool; Confluence writes; multi-site; bulk ops; offline queueing; renderer-side dispatch logic                                                                                                                                                            |

### Resolved decisions (from the spec's open questions — now decided)

- **D1 — Where dispatch intercepts + how the pending `render_ui` call settles (OQ1, option a).**
  Intercept `jira.*` actions in **main at the `ui:action` boundary**. The cleanest seam is the
  existing `ipcMain.on(UiChannel.Action)` handler in `src/main/index.ts` (it already validates
  the payload and calls `uiBridge.resolveAction`). Before resolving, inspect
  `payload.action.actionId`: if it is in the `jira.*` namespace, route to the new
  `JiraActionDispatcher` instead of the normal resolve. The dispatcher:
  1. Validates the bound action (FR-006) — name + required context fields.
  2. Calls the matching `JiraManager` write method → `JiraResult`.
  3. Settles the pending `render_ui` call as **`cancel`** via `uiBridge.cancelActive()` /
     `resolveAction(requestId, { type: 'cancel' })` so the composing headless run does NOT block
     and Claude is NOT re-invoked (FR-016).
  4. Asks `JiraSurfaceBuilder` to RE-COMPOSE the issue surface from the (post-write) data and
     re-pushes it via the existing `pushRenderToRenderer` (`ui:render`) so the surface reflects
     the new status / appended comment / error (FR-007). To get fresh post-write data the
     dispatcher re-reads the issue via `JiraManager.getIssue` (so the rebuilt surface shows the
     real new status from Jira, not an optimistic guess); a read failure after a successful write
     still renders a success notice + best-effort prior data.
  *Reuse `UiBridge` rather than the renderer for interception — keeps deterministic binding fully
  main-side and the renderer dumb (it only emits `ui:action` and renders `ui:render`).*

- **D2 — Reuse `ui:action`; no new renderer-facing dispatch channel (OQ2).** Surfaces already
  emit interactions over `ui:action`; main discriminates on the `jira.*` `actionId`. Surface
  updates reuse `ui:render`. No new IPC channel, no preload change, no `GeneratedUiPanel.tsx`
  change for dispatch. (The panel already maps SDK action `name` → `actionId` and `context` →
  `values`, so a surface whose button `name` is `jira.transition` and whose context is
  `{issueKey, transitionId}` arrives as `actionId:'jira.transition'`, `values:{issueKey,
  transitionId}` with NO renderer change.)

- **D3 — Composing agent resolves `transitionId`; resolve the data-availability gap (OQ3).**
  No `jira_list_transitions` tool in v1. BUT today's `jira_get_issue`/`JiraIssueDetail` does NOT
  surface available transitions, and `transitionId`s are workflow-specific and NOT derivable from
  the normalized `JiraStatusCategory`. **Least-scope resolution: extend the EXISTING
  `getIssue` read** to also fetch and surface the issue's available transitions, adding a small
  `availableTransitions: JiraTransition[]` (`{ id, name, toStatusName?, toStatusCategory? }`) to
  `JiraIssueDetail`. This is one extra field on an endpoint the agent already calls (via
  `expand=transitions` on `GET /issue/{key}` or the dedicated `GET /issue/{key}/transitions`), so
  the agent can emit a concrete, valid `transitionId` from a single read it was already doing —
  no new tool, no new round-trip, and the native Jira panel can later use it too. Main still
  treats an unknown/stale `transitionId` as a write failure (FR-020, FR-017), so a stale id never
  crashes. *Chosen over adding a `jira_list_transitions` tool because it adds zero new tool
  surface and zero extra agent round-trips; chosen over "accept unknown ids as failures with no
  data path" because that would make valid transitions effectively unreachable for the agent.*

- **D4 — Re-consent extends the existing Connect/Reconnect flow (OQ4).** `JIRA_OAUTH_SCOPES`
  gains `write:jira-work`, so the existing Jira Connect/Reconnect button now always requests the
  full read+write scope set — no second OAuth entry point. A write attempted with a token whose
  persisted `scopes` lack `write:jira-work` returns a structured "reconnect to enable Jira
  actions in cosmos" result (a new `JiraErrorKind` value, see Interface) that the surface shows;
  it points the user to the existing Jira panel Connect/Reconnect affordance.

### Build-wiring confirmation (FR-018)

**No new rollup `input` is needed.** The write tools live in the EXISTING
`src/mcp/jiraMcpServer.ts`, which already builds to `out/main/mcp/jiraMcpServer.js` via its
existing rollup `input` in `electron.vite.config.ts`, and is already registered as
`cosmos-jira` in `embeddedMcpConfig` (`src/main/index.ts`). Adding `registerTool` calls to that
same server requires no config change. The new main-only modules
(`jiraActionDispatcher.ts`, `jiraSurfaceBuilder.ts`) are part of `src/main/index.ts`'s import
graph and bundle into `out/main/index.js` without a new input. **`electron.vite.config.ts` —
no change.**

### Architecture decisions to land in `docs/ARCHITECTURE.md` at wrap-up (do NOT edit it in this plan)

Flag for `wrap-up`:
- §4.9 is no longer strictly read-only for Jira: a **`write:jira-work`** scope + write MCP tools
  (`jira_transition_issue`, `jira_add_comment`) + `JiraManager`/`JiraClient` write methods exist.
  The "no mutate method or write scope anywhere" sentence in §4.9 needs revising for Jira
  (Confluence stays read-only).
- A new **deterministic `jira.*` action-binding path** in main: §4.3 / §5 (the render_ui loop)
  gains a documented branch where main intercepts a bound `jira.*` `ui:action`, executes the
  write itself via `JiraManager`, settles the pending `render_ui` call as `cancel` (no Claude
  turn), and re-pushes a main-composed surface. This is a genuinely new flow distinct from the
  "return the action to Claude" contract.
- A new **main-side A2UI surface builder** (`jiraSurfaceBuilder.ts`): main can now compose A2UI
  surfaces deterministically (not just relay agent-composed ones) — note it for §4.3/§4.4.
- The re-consent/scope-gap pattern (capability check from persisted `scopes`) for write features.

---

## Implementation Checklist

> Ordered for the developer: Interface → Tests → Implement. Each item traces to spec FRs.

### Phase 1 — Interface (types & contracts; no behavior)

- [x] Read the spec + this plan; confirm OQ1–OQ4 are resolved (D1–D4 above). No new npm install.
- [x] **`src/shared/jira.ts`** — extend the contract (no parallel resource types — FR-002):
  - Add write tool names to `JiraTool`: `TransitionIssue: 'jira_transition_issue'`,
    `AddComment: 'jira_add_comment'`; and matching `JiraOp` ops
    (`TransitionIssue: 'transitionIssue'`, `AddComment: 'addComment'`) (FR-008, FR-009).
  - Add the **bound-action contract** (FR-005): a `JiraBoundAction` const
    (`Transition: 'jira.transition'`, `Comment: 'jira.comment'`) + the context param shapes
    `JiraTransitionParams { issueKey: string; transitionId: string }` and
    `JiraCommentParams { issueKey: string; body: string }` (reused by deterministic dispatch AND
    the MCP write tools — one shape, both callers).
  - Add `JiraTransition { id: string; name: string; toStatusName?: string; toStatusCategory?: JiraStatusCategory }`
    and add `availableTransitions: JiraTransition[]` to `JiraIssueDetail` (D3, FR-020).
  - Add a `'write_not_authorized'` value to `JiraErrorKind` for the scope-gap case (D4, FR-013),
    with a human-readable "reconnect to enable Jira actions" message contract.
  - Define the write result data types (e.g. transition returns the updated `JiraIssueDetail` or
    `{ ok }`; comment returns the new `JiraComment`) — keep `JiraResult<T>` discipline (FR-010).
  - Review: every added field traces to an FR; no invented properties; no secret-bearing field.
- [x] **`src/shared/validate.ts`** — add boundary validators (FR-006):
  - `validateJiraTransition(raw)` → `{ issueKey, transitionId }` (both non-empty strings) or null+warn.
  - `validateJiraComment(raw)` → `{ issueKey, body }` (non-empty, body not whitespace-only) or null+warn.
  - A `validateJiraBoundAction(action)` that maps a validated `A2uiAction` (`actionId` in
    `jira.*` + `values`) to a discriminated bound-action object, reusing the two validators above;
    unknown name / missing fields → null+warn (no dispatch).
- [x] **`src/main/jiraActionDispatcher.ts`** — define the class signature + deps (inject the
  `JiraManager` subset it needs + a `rebuildSurface`/`pushRender` sink + the `cancelActive` hook),
  so it is unit-testable without Electron (mirrors how `JiraBridge` injects its manager).
- [x] **`src/main/jiraSurfaceBuilder.ts`** — define the builder signature: pure functions
  `buildIssueListSurface(page, …)` and `buildIssueDetailSurface(detail, opts?)` returning an
  `A2uiSurfaceUpdate` (`{ surfaceId, components }`) composed from `src/shared/jira.ts` types using
  the A2UI **standard catalog** only (FR-003); `opts` carries an optional success/error notice for
  the post-write update (FR-007). No Jira API calls in the builder (pure mapping).
- [x] **`src/main/jiraManager.ts`** — declare `transitionIssue(params)` / `addComment(params)`
  (return `JiraResult<…>`) and a `getWriteCapability()` (reads persisted `scopes`, returns whether
  `write:jira-work` is granted) — signatures only this phase.
- [x] **`src/main/integrations/jiraClient.ts`** — declare `transitionIssue(auth, key, transitionId)`,
  `addComment(auth, key, body)`, and a transitions read used by `getIssue` (signatures only).
- [x] Review all new types against the spec — no invented properties; tokens/secrets never appear.

### Phase 2 — Testing (unit; pure seams)

- [x] `validateJiraTransition` / `validateJiraComment` / `validateJiraBoundAction`: happy path;
  missing/empty `issueKey`/`transitionId`/`body`; whitespace-only body; unknown `jira.*` name;
  non-`jira.*` actionId passes through (not treated as bound) — all warn+ignore on invalid (FR-006).
- [x] `mapJiraError` already covers 429/401/403/other for writes — add a test that a write’s
  POST failure maps the same way (FR-011); add `write_not_authorized` mapping if it gets a code path.
- [x] `JiraClient.transitionIssue` / `.addComment` (fake `FetchLike`): POSTs the right URL/body
  (`…/issue/{key}/transitions` with `{ transition: { id } }`; `…/issue/{key}/comment` with the
  ADF/text body), returns `ok` on 2xx, maps 401→`reconnect_needed`/429→`rate_limited`/other→`network`
  (FR-011). `getIssue` now surfaces `availableTransitions` from the transitions read (D3).
- [x] `JiraManager.transitionIssue`/`.addComment` route through `run()` (proactive + one reactive
  refresh on `reconnect_needed`) like reads (FR-010); `getWriteCapability` returns false when
  stored `scopes` lack `write:jira-work` and the write path returns `write_not_authorized` without
  calling the client (D4, FR-013).
- [x] `JiraSurfaceBuilder`: an issue list → standard-catalog surface; a single `JiraIssueDetail`
  with `availableTransitions` → a surface whose transition control’s action `name` is
  `jira.transition` and context `{issueKey, transitionId}`, and whose comment control is
  `jira.comment` `{issueKey, body}` (FR-005); the post-write `opts` notice renders a success/error
  line (FR-007). Pure — no network.
- [x] `JiraActionDispatcher`: a valid `jira.transition` → calls manager.transitionIssue, then
  re-reads + rebuilds + pushes a surface, and cancels the pending render_ui call (FR-007, FR-016);
  a write failure → pushes an error-noticed surface, still cancels the pending call (no hang,
  FR-017); a `write_not_authorized` → pushes the "reconnect to enable Jira actions" surface (D4);
  an invalid/unknown bound action → no dispatch, warn+ignore (FR-006); NEVER touches a PTY or the
  AgentRunner (assert by construction — no such dependency injected) (FR-019).
- [x] `JiraBridge.handleCall`: the two new write ops validate params and forward to the manager
  write methods; an invalid params object returns the structured error result (not a crash) —
  mirrors the existing read-op tests.

### Phase 3 — Implementation

- [x] Implement the `src/shared/jira.ts` additions (tool/op names, bound-action contract, params,
  `JiraTransition` + `availableTransitions`, `write_not_authorized`, write result types) (FR-005/008/009/010/020).
- [x] Implement the `src/shared/validate.ts` validators (FR-006).
- [x] Implement `JiraClient` write REST calls + the transitions read folded into `getIssue`,
  reusing the existing private `call()` + `mapJiraError` (FR-011, D3).
- [x] Implement `JiraManager.transitionIssue`/`.addComment` via `run()` + `getWriteCapability`
  (read persisted `scopes`); short-circuit writes to `write_not_authorized` when the scope is
  absent (FR-010, FR-013).
- [x] Add `write:jira-work` to `JIRA_OAUTH_SCOPES` in `src/main/integrations/atlassianConfig.ts`
  (and update its doc comment — it currently asserts "NO write/manage scope"). Confluence scopes
  unchanged (FR-012, D4).
- [x] Register `jira_transition_issue` + `jira_add_comment` in `src/mcp/jiraMcpServer.ts` (zod
  input schemas from the shared param shapes; descriptions state they MUTATE Jira), relaying via
  `bridge.call(JiraOp.TransitionIssue/AddComment, …)` (FR-008, FR-009).
- [x] Route the two new write ops in `src/main/jiraBridge.ts` `handleCall` switch + widen its
  `JiraBridgeManager` interface to include the write methods (FR-008). `src/shared/bridge.ts`
  `op` is already `JiraOpName`, so the frame type needs no change beyond the new op values.
- [x] Implement `src/main/jiraSurfaceBuilder.ts` (pure Jira→A2UI standard-catalog mapping) (FR-001/003/005/007).
- [x] Implement `src/main/jiraActionDispatcher.ts` (validate → manager write → re-read → rebuild →
  push `ui:render` → settle pending call `cancel`) (FR-004/007/016/017/019).
- [x] Wire dispatch in `src/main/index.ts`: in the `ipcMain.on(UiChannel.Action)` handler, when
  `payload.action.actionId` is in the `jira.*` namespace, hand off to the dispatcher instead of
  `uiBridge.resolveAction`; construct the dispatcher in `createWindow` with the `jiraManager`,
  `uiBridge` (for cancel), and `pushRenderToRenderer`; null it in teardown alongside the others
  (FR-004, FR-019). Do NOT couple it to `ptyManager`/`agentRunner`.
- [x] All tests pass (`npm test`); typecheck clean (`npm run typecheck`); build succeeds
  (`npm run build`). Confirm NO `electron.vite.config.ts` change was needed (FR-018).
- [x] Reused shared utilities — single write implementation (`JiraClient`/`JiraManager`) for both
  callers; the surface builder reused for initial + post-write render; no duplicated logic, no
  second render path, no parallel resource types.

### Phase 4 — Docs

- [ ] Mark the item done / add it in `TODO.md` at wrap-up.
- [ ] Update this plan's Deviations with anything that differed.
- [ ] **Reconcile note (do NOT edit ARCHITECTURE.md in this plan):** hand the four
    architecture decisions above (Jira write scope + tools; the deterministic `jira.*` dispatch
    path; the main-side Jira surface builder; the scope-gap re-consent pattern) to `wrap-up` for
    landing in `docs/ARCHITECTURE.md` §4.3/§4.9/§5.

---

## Deviations & Notes

> Record here anything that differed from the plan during implementation. Date each entry.

- **2026-06-06**: Plan authored. Assumptions to confirm during implementation:
  (1) Jira transitions are applied via `POST /rest/api/3/issue/{key}/transitions` and available
  transitions read via `expand=transitions` on `GET /issue/{key}` (or `GET /issue/{key}/transitions`)
  — the developer should confirm the exact field shape against Atlassian docs before mapping.
  (2) The comment body is sent in the format `addComment` requires (Jira Cloud `POST .../comment`
  accepts an ADF `body`); since the panel composes plain text, the client wraps it minimally as
  ADF — confirm the minimal accepted shape.
  (3) `write_not_authorized` is added to `JiraErrorKind`; the read tools/panel already branch on
  `ok` so adding a kind is additive, but verify no exhaustive switch elsewhere breaks.
- **2026-06-06 (implementation)**: Steps 3–5 complete. Confirmations against the assumptions
  above: (1) transitions read via the dedicated `GET /issue/{key}/transitions` (folded into
  `getIssue`, best-effort → `[]` on failure so it never fails the issue read — FR-020); transition
  applied via `POST /issue/{key}/transitions` with `{ transition: { id } }` (204). (2) Comment
  body wrapped minimally as ADF via a new `plainTextToAdf()` in `atlassianText.ts`
  (`{type:'doc',version:1,content:[paragraph[text]]}`). (3) Adding `write_not_authorized` to
  `JiraErrorKind` widened it past the renderer's local `AtlassianError` union (used by the
  read-only `JiraPanel`/`ErrorState`), causing two TS2322 errors at read-error call sites.
  **Deviation (minimal, in-scope):** widened `AtlassianError.kind` in
  `src/renderer/atlassianPanelBits.tsx` to include `'write_not_authorized'` so a `JiraError`
  assigns cleanly. No new ErrorState branch needed — `write_not_authorized` falls through to the
  generic error fallback, and it can never actually arise on a read path. No spec/scope change.
  Finish gate met: `npm test` 327 passed (23 files); `npm run typecheck` clean;
  `npm run build` succeeds; `electron.vite.config.ts` NOT changed for this feature (the two write
  tools live in the already-registered `jiraMcpServer` input; new main modules bundle via the
  `index.ts` import graph). The dispatcher mints a fresh `requestId` via `randomUUID()` on each
  re-push (Design Q2) since it pushes directly through `pushRenderToRenderer` (UiBridge only mints
  ids on its own render path).
