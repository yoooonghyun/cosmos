# Spec: Jira Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Supersedes**: —
**Related plan**: .sdd/plans/jira-generative-adapter-v1.md

---

## Overview

Today a composed generative-UI surface bakes **literal** data values into A2UI component
props at compose time, so once it is reloaded/restored the data is frozen against whatever
the source returned when it was first composed. This feature introduces an **API→UI
generative adapter**: a surface whose **view is composed once but whose data refreshes**
against the live source. It leverages A2UI 0.9's view/data split — the view binds to a data
model via `{path}`/`TemplateBinding`, and a new persisted, secret-free **adapter descriptor**
captures *how to refetch* so a generic **main-side adapter dispatcher** can re-run it and push
a fresh `updateDataModel` (not a full surface re-push) on refresh triggers and pagination. Jira
is the first of three sibling cycles (Jira → Slack → Confluence); **Jira establishes the shared
infrastructure** the other two reuse, then wires its own search/list and issue-detail surfaces
onto it.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Live data on a restored surface · P1

**As a** cosmos user who composed a Jira surface and relaunched/reactivated the panel
**I want to** see current Jira data rather than the values frozen at compose time
**So that** the surface reflects reality without me re-asking the agent.

**Acceptance criteria:**

- Given a bound Jira surface persisted in the session, when the tab is restored on relaunch,
  then main re-executes the surface's adapter descriptor and the surface's data is replaced by
  a fresh `updateDataModel` (the view is NOT re-composed and the agent is NOT re-invoked).
- Given a restored bound surface, when the panel is re-activated as the rail surface, then the
  adapter re-runs and refreshes the data model.
- Given a bound surface visible in the active tab, when the user activates the explicit refresh
  affordance, then the adapter re-runs and the data model is replaced with fresh values.

### Paginate a bound list · P1

**As a** user viewing a bound Jira issue list
**I want to** load more results or move between pages
**So that** I can browse beyond the first page against live data.

**Acceptance criteria:**

- Given a bound issue list with more results, when the user triggers the reserved append
  ("load more") action, then main fetches the next page with the descriptor's cursor and pushes
  an `updateDataModel` that writes the **full accumulated list** at the bound list path, growing
  the rendered list.
- Given a bound issue list, when the user triggers the reserved page-replace (prev/next) action,
  then main fetches that page and pushes an `updateDataModel` that **replaces** the list value and
  updates the cursor/page state in the data model.
- Given a page-replace list, when there is no next (or no previous) page, then the Next (or Prev)
  control is disabled, driven by a bound boolean over the cursor state (`hasMore`/`hasPrev`).
- Given any pagination or refresh dispatch is in flight, when it has not yet landed, then a bound
  `loading` flag is true (driving a button spinner) and is cleared to false once the data lands.

### Secrets never leave main · P1

**As a** security-conscious operator
**I want to** know the descriptor, data model, and every payload carry no secrets
**So that** tokens can never leak through a snapshot, IPC frame, bridge frame, MCP result, or
surface.

**Acceptance criteria:**

- Given any adapter refresh/pagination, when main fetches, then the token is attached only in
  main and never appears in the descriptor, the `updateDataModel` payload, the session snapshot,
  a bridge frame, an MCP result, or the rendered surface.
- Given the persisted descriptor, when inspected, then it contains only non-secret
  `{ dataSource, query }` values (manager call id + non-secret JQL/params/cursor).

### Jira surfaces are bound, not literal · P1

**As a** user composing or opening Jira search/list and issue-detail surfaces
**I want to** those surfaces to be data-bound
**So that** they participate in refresh and pagination uniformly.

**Acceptance criteria:**

- Given a Jira issue-list surface (default view, JQL search, or utterance-composed) is produced,
  when it renders, then its rows bind to a data path via `TemplateBinding` and main seeds the data
  with an initial `updateDataModel`, rather than baking literal row props.
- Given a Jira issue-detail surface, when it renders, then its display props bind to the data model
  via `{path}` and main seeds the detail with an initial `updateDataModel`.
- Given the existing deterministic `jira.*` write actions and `jiraBackNav` Back restore, when a
  write completes or Back is pressed, then the surfaces still reflect the outcome correctly and no
  prior behavior regresses.

### Safe fallback on adapter failure · P1

**As a** user whose adapter refetch fails or points at gone data
**I want to** a calm, recoverable state instead of a crash, hang, or stale silent surface
**So that** the panel stays usable.

**Acceptance criteria:**

- Given a refresh/pagination fetch fails (network/rate-limited), when it returns, then the surface
  shows a calm recoverable notice and `loading` clears; the prior data is not corrupted.
- Given the descriptor refers to a now-gone issue (404), when re-executed, then the surface
  degrades to a recoverable notice rather than crashing.
- Given a fetch returns an empty page, when applied, then the bound list shows its empty state and
  pagination controls reflect "no more"/"no prev" correctly.
- Given a `reconnect_needed` result, when it returns, then the panel routes to the native
  Connect/Reconnect affordance (existing behavior) rather than pushing a broken surface.

---

## Functional Requirements

> Each FR traces to the chosen design (D1–D6 in the brief). "Shared infra" = reusable by
> Slack/Confluence cycles; "Jira wiring" = this cycle's concrete use.

### Bound surfaces — view/data split (shared convention; Jira wiring)

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST render a bound surface using A2UI 0.9 **`{path}` bindings** (`DynamicString/Number/Boolean/StringList`) and **`TemplateBinding`** list children instead of literal data props (D1). [shared convention] |
| FR-002 | `ActiveTabSurface` MUST process an **`updateDataModel`** message for a surface in addition to `createSurface` + `updateComponents`, applying it to the active tab's surface (D1). Today it sends only `createSurface` + `updateComponents`. [shared infra] |
| FR-003 | A bound surface's composed view MUST be accompanied by an **initial `updateDataModel`** that seeds the data model so the surface renders populated on first paint (D1). [shared convention] |
| FR-004 | The Jira issue-list surfaces (default view, JQL search, utterance-composed list) and the issue-detail surface MUST be re-expressed as bound surfaces per FR-001/FR-003, replacing today's static-prop composition in `jiraSurfaceBuilder` (D1). [Jira wiring] |

### Adapter descriptor (shared schema; Jira wiring)

| ID     | Requirement |
|--------|-------------|
| FR-005 | The system MUST define a persisted, **secret-free** adapter descriptor `{ dataSource, query }` capturing how to refetch a surface's data: `dataSource` identifies the integration manager call; `query` carries only non-secret params (e.g. JQL, cursor, issueKey) (D2). [shared schema] |
| FR-006 | The descriptor MUST be associated with a surface and **persisted in the session snapshot alongside the composed view spec** so a restored surface can re-execute it (D2). [shared infra] |
| FR-007 | The descriptor MUST NOT contain any token, OAuth material, or the Atlassian `client_secret`; it MUST carry only non-secret values (D6). [shared schema] |
| FR-008 | The Jira surfaces MUST emit descriptors whose `dataSource` maps to `JiraManager` reads (`searchIssues` for list/search/default, `getIssue` for detail) and whose `query` carries the JQL/cursor or issueKey (D2). [Jira wiring] |

### Generic adapter dispatcher (shared infra; Jira reconciliation)

| ID     | Requirement |
|--------|-------------|
| FR-009 | The system MUST provide a reusable **main-side adapter dispatcher** that, on a refresh trigger or a reserved pagination action, re-executes a surface's descriptor via the integration manager (tokens stay in main) and pushes an **`updateDataModel`** to that surface — NOT a full surface re-push (D3). [shared infra] |
| FR-010 | The dispatcher MUST key pushed `updateDataModel` messages by **`surfaceId`** so the renderer applies them to the correct surface (D3). [shared infra] |
| FR-011 | The existing Jira deterministic **write-action dispatch** (`jira.*` via `JiraActionDispatcher`) MUST be reconciled with / folded into the generalized adapter path so there is one coherent main-side dispatch path, with the write path's behavior (execute → re-read → reflect outcome) preserved (D3). [Jira reconciliation] |
| FR-012 | The dispatcher MUST be constructed with only the manager subset, a render/data-model push sink, and (where needed) the pending-call cancel hook — no `PtyManager`/`AgentRunner` dependency — so an adapter action can never disturb the TUI or headless runner (preserves the existing channel-independence invariant). [shared infra] |

### Refresh triggers (shared infra; Jira wiring)

| ID     | Requirement |
|--------|-------------|
| FR-013 | The system MUST re-run a bound surface's adapter on **tab restore**, **panel re-activation**, and an **explicit refresh affordance**, each producing a fresh `updateDataModel` (D4). [shared infra + Jira wiring] |
| FR-014 | A refresh MUST replace the surface's data model with fresh values without re-composing the view or re-invoking the agent (D4). [shared infra] |

### Pagination — both shapes (shared infra; Jira wiring)

| ID     | Requirement |
|--------|-------------|
| FR-015 | The system MUST support **append pagination** ("load more"/infinite): a reserved action carries the cursor, main fetches the next page, holds the accumulated list, and pushes an `updateDataModel` that writes the **full accumulated list** at the bound list path (NOT relying on the RFC 6901 `-` append token); `TemplateBinding` re-renders the grown list (D5). [shared infra] |
| FR-016 | The system MUST support **page-replace pagination** (prev/next): the action carries the page/cursor, main fetches, and pushes an `updateDataModel` that **replaces** the list value and updates the cursor/page state in the data model (D5). [shared infra] |
| FR-017 | Prev/Next enabled/disabled MUST be bound to a `DynamicBoolean`/`LogicExpression` over the cursor state (`hasMore`/`hasPrev`) so the controls reflect availability from the data model (D5). [shared convention] |
| FR-018 | A **`loading` flag in the data model** MUST drive the pagination/refresh button spinner: main sets it true on dispatch and false once the data lands (D5). [shared convention] |
| FR-019 | The reserved pagination actions MUST use a reserved adapter-action namespace dispatched deterministically by main at the `ui:action` boundary (paralleling `jira.*`), never returned to the composing agent run (D3/D5). [shared infra] |
| FR-020 | The Jira issue list MUST wire onto append pagination (load-more) and the issue list MAY also expose page-replace where appropriate; the issue-detail surface needs no pagination (D5). [Jira wiring] |

### Security & validation (hard constraints — shared)

| ID     | Requirement |
|--------|-------------|
| FR-021 | All fetching and all tokens MUST stay in **main**; nothing secret may enter an IPC payload, session snapshot, bridge frame, MCP result, or A2UI surface (D6). [shared] |
| FR-022 | All new cross-process payloads (the `updateDataModel` push, the reserved pagination/refresh actions, the persisted descriptor) MUST be defined in the **one typed IPC contract** `src/shared/ipc.ts` (no ad-hoc channel strings) and validated at the **main-process boundary**; an invalid payload MUST be **warned and ignored, never crash** (D6). [shared] |
| FR-023 | A malformed `updateDataModel` received by `ActiveTabSurface` MUST be ignored safely (degrade to the tab's error boundary at worst), never white-screening the panel or affecting sibling tabs (D6). [shared] |

## Edge Cases & Constraints

- **Stale cursor.** A pagination action carrying a cursor that the source no longer accepts MUST
  surface a calm recoverable notice and clear `loading`; the existing list is not corrupted.
- **Descriptor refers to a gone issue.** A refresh whose descriptor points at a deleted/404 issue
  MUST degrade to a recoverable notice, not a crash.
- **Empty page.** An append that returns zero new items MUST leave the list unchanged and set
  "no more" (disable Next/load-more); a page-replace returning empty MUST show the bound empty
  state and update cursor state.
- **Fetch error → safe fallback.** Network/rate-limited failures MUST render a calm recoverable
  notice and clear `loading`; `reconnect_needed`/`not_connected` MUST route to the native
  Connect/Reconnect affordance (existing behavior), not a broken surface.
- **Secret-free invariant.** No token/secret may appear in the descriptor, data model,
  `updateDataModel` payload, snapshot, bridge frame, MCP result, or surface (FR-007/FR-021).
- **Malformed `updateDataModel`.** Warned + ignored at the boundary / safely ignored at the
  renderer — never a crash (FR-022/FR-023).
- **Coexistence with existing Jira features.** The deterministic `jira.*` write dispatch +
  surface reflection, the per-tab default/search/detail unsolicited-frame discipline, and
  `jiraBackNav` Back restore MUST continue to work (no regression). A `composed` (pinned)
  surface snapshot-on-overlay behavior is unchanged.
- **Out of scope (deliberately left to siblings/later):** Slack and Confluence adapter *wiring*
  (their concrete descriptors/surfaces/pagination shapes) — those reuse this cycle's shared infra;
  any write-bearing pagination; real-time/push refresh (refresh is trigger-driven only);
  multi-source descriptors; concurrent headless runs.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A bound Jira surface restored on relaunch shows data fetched fresh at restore time, not the values frozen at compose time. |
| SC-002 | Panel re-activation and the explicit refresh affordance each produce a fresh `updateDataModel` with no view re-compose and no agent invocation. |
| SC-003 | Append pagination grows the bound list (full accumulated list written at the path); page-replace swaps the list and updates cursor/page state; Prev/Next disable correctly via bound booleans. |
| SC-004 | The `loading` flag toggles a button spinner: true on dispatch, false on land. |
| SC-005 | No token/secret appears in any descriptor, data model, `updateDataModel` payload, session snapshot, bridge frame, MCP result, or surface (verified by inspection + tests). |
| SC-006 | A malformed `updateDataModel` / pagination payload is warned + ignored at the main boundary and safely ignored at the renderer — process never crashes, sibling tabs unaffected. |
| SC-007 | Fetch errors, stale cursors, gone issues, and empty pages each degrade to a calm recoverable state with `loading` cleared. |
| SC-008 | Existing Jira behavior (`jira.*` writes, default/search/detail views, `jiraBackNav` Back restore, per-tab correlation) is unchanged — no regression. |
| SC-009 | The shared pieces (generic dispatcher, `updateDataModel` push channel keyed by surfaceId, descriptor schema + persistence, bound-surface composition convention, pagination) are factored so the Slack/Confluence specs can reference them rather than redefine them. |

---

## Open Questions

- [ ] None blocking. Resolved during authoring (see plan §Resolved ambiguities): the reserved
  pagination/refresh action namespace, whether refresh reuses or supersedes the `JiraActionDispatcher`
  class, and how the descriptor attaches to a surface for persistence are design choices captured in
  the plan, all consistent with the brief's constraints and existing patterns.
