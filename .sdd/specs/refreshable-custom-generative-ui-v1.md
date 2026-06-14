# Spec: Refreshable Custom Generative UI — v1

**Status**: Approved
**Created**: 2026-06-13
**Supersedes**: the "register-by-shell, replace-the-spec" half of `panel-refresh-v1` (OQ-5 = main-composes); reuses its descriptor + dispatcher + panel-refresh-control infrastructure
**Related plan**: `.sdd/plans/refreshable-custom-generative-ui-v1.md`

---

## Overview

When the agent composes a CUSTOM generative-UI layout against live integration data (e.g. a Jira
kanban board from "칸반보드로 만들어줘"), the panel refresh control must re-fetch that data and repaint
the SAME custom layout — not throw it away. Today a refresh either keeps the custom layout but stays
disabled, or replaces the custom layout with a generic list. This feature makes a custom
agent-composed surface refreshable IN-PLACE through the existing A2UI 0.9 data-model path, by
registering the agent's OWN surface (not a substituted generic shell) with the AdapterDispatcher.

## Background — the defect being fixed

Under `panel-refresh-v1` (OQ-5 = "main-composes"), when the agent attaches a secret-free descriptor
`{ dataSource, query }` to its `render_*_ui` frame, main does NOT push the agent's spec. Instead
`UiBridge.registerDescriptor` → `resolveDescriptorShell` maps `dataSource` to a FIXED generic
`{path}`-bound SHELL (`jira-issue-list`, `jira-issue-detail`, `slack-channels`, …), registers THAT
shell's stable surfaceId, kicks the first refresh, and pushes the shell. The agent's custom kanban
layout is discarded and replaced by a generic list. Conversely, if the agent attaches NO descriptor,
the custom layout renders but the panel refresh control stays disabled (`derivePanelRefreshState`
requires a `surfaceId` + a `descriptor`). So custom layout and refreshability are mutually exclusive.

## Chosen direction (committed)

Make the agent's CUSTOM surface refreshable in place, without replacing it:

1. The agent composes its custom layout using `{path}` bindings (A2UI 0.9) against a DOCUMENTED,
   per-`dataSource` data-model path contract (e.g. `searchIssues` → list at `/items`; `getIssue` →
   detail at `/issue`). The render-tool descriptions teach the agent these paths.
2. When a descriptor is attached, main registers it with the AdapterDispatcher keyed by the AGENT's
   OWN `surfaceId`, using the bind options (listPath + pagination) the `dataSource` implies, kicks
   the first refresh, and pushes the AGENT's spec AS-IS.
3. `adapter.refresh` re-fetches in main (token attached only in main) and emits
   `updateDataModel { surfaceId: <agent's id>, path, value }`, repainting the custom layout in place
   — no full re-push, no agent round-trip.
4. The generic descriptor-shell remains the FALLBACK only when the agent supplied a descriptor but
   NO usable spec (missing/empty `surfaceId` or `components`), so a refresh intent without a layout
   still yields something refreshable.

This generalizes across Jira (proving ground), then Slack and Confluence — the same generative-adapter
infrastructure.

---

## User Scenarios

### Refresh a custom kanban board with live Jira data · P1

**As a** cosmos user who asked the agent for a custom Jira board ("칸반보드로 만들어줘")
**I want to** click the panel refresh control and see my board repaint with current Jira data
**So that** my custom layout stays useful as tickets change, without re-asking the agent

**Acceptance criteria:**

- Given the agent composed a custom `{path}`-bound surface and attached a `searchIssues` descriptor,
  when the surface lands, then the CUSTOM layout (not a generic list) renders and the panel refresh
  control is ENABLED for that tab.
- Given that custom surface is active, when the user clicks refresh, then main re-executes the
  descriptor and pushes `updateDataModel` keyed by the AGENT's surfaceId, and the SAME custom layout
  repaints with fresh data — the component tree is not re-composed.
- Given the refresh re-fetch fails recoverably (network / rate-limited), when it returns, then the
  prior data stays visible, a bound `/error` notice shows, and `/loading` clears — no white screen,
  no agent re-invocation.

### Custom detail surface refreshes in place · P1

**As a** user viewing a custom-composed Jira issue-detail surface bound to `/issue`
**I want to** refresh and see the latest issue state
**So that** the detail reflects changes made elsewhere

**Acceptance criteria:**

- Given a custom surface bound to `getIssue` (`/issue` value + sub-paths), when refreshed, then main
  pushes `updateDataModel` of the single `/issue` value keyed by the agent's surfaceId and the detail
  re-renders in place (pagination `none`).

### Restored custom bound surface re-registers and refreshes · P1

**As a** user who relaunches cosmos with a previously composed custom bound surface in a tab
**I want to** see that surface restored and auto-refreshed with live data
**So that** my saved layout is current, not showing stale persisted data

**Acceptance criteria:**

- Given a `composed: true` custom bound surface (its verbatim spec + secret-free descriptor) was
  persisted, when the session restores it, then the surface re-mounts and ActiveTabSurface fires one
  descriptor-bearing `adapter.refresh`; main LAZILY registers the surface (it never freshly composed
  it this run) under the AGENT's surfaceId from the descriptor's persisted spec, then re-fetches and
  pushes fresh `updateDataModel`.
- Given a pre-bump (stale-schema) snapshot whose bound surface meaning differs, when the session
  loads, then it is treated as unreadable and falls back to a clean session (no broken refresh state).

### Pagination on a custom list surface · P2

**As a** user whose custom surface includes a "load more" control bound to the list path
**I want to** page additional results into the custom layout
**So that** long lists work without re-composing

**Acceptance criteria:**

- Given a custom list surface registered with `pagination: 'append'`, when the user triggers
  `adapter.loadMore`, then main fetches the next page and writes the FULL accumulated list at the
  agent's bound list path, keyed by the agent's surfaceId.
- Given the `dataSource`'s pagination mode is `none` (e.g. a detail), then a load-more/page action is
  a safe no-op (the dispatcher's existing per-mode handling).

---

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | When the agent attaches a valid, secret-free, target-matched descriptor to a `render_*_ui` frame AND the frame's `spec` is a usable A2UI surface (non-empty `surfaceId` + a `components` array), main MUST register the descriptor with the AdapterDispatcher keyed by the AGENT's OWN `spec.surfaceId` (NOT a substituted shell's surfaceId) and push the AGENT's spec AS-IS. |
| FR-002 | The bind options (`listPath` + `pagination`) used to register the agent's surface MUST be resolved from the descriptor's `dataSource` via the existing per-integration bind-option resolvers (`jiraListBindOptions`/`jiraDetailBindOptions`, `slackBindOptionsForSource`, `confluenceBindOptionsForSource`) — the SAME source-of-truth the generic shells use — so the path the tool description tells the agent to bind to and the path the dispatcher writes can never drift. |
| FR-003 | On registration of an agent surface, main MUST kick the first `adapter.refresh` for that surfaceId (token attached in main), producing the initial `updateDataModel` that paints the custom layout's bound data. |
| FR-004 | The render-tool descriptions (`render_ui`, `render_jira_ui`, `render_slack_ui`, `render_confluence_ui`) MUST document, per `dataSource`, the exact data-model path(s) the agent must bind to: Jira `searchIssues`→list at `/items`, `getIssue`→value at `/issue`; Slack `listChannels`→`/channels`, `getHistory`→`/messages`, `search`→`/matches`; Confluence `defaultFeed`→`/feed`, `searchContent`→`/results`, `getPage`→`/page`; plus the shared reserved flag paths `/loading`, `/hasMore`, `/error`. The tool description MUST instruct the agent to compose `{path}` bindings (not literal props) for any data it wants refreshable, against these paths. |
| FR-005 | `adapter.refresh` on a registered agent surface MUST emit `updateDataModel { surfaceId: <agent's surfaceId>, path, value }` and MUST NOT re-push the full surface spec or re-invoke the agent. |
| FR-006 | When the agent attaches a descriptor but the frame's `spec` is NOT a usable surface (missing/empty `surfaceId` or no `components`), main SHOULD fall back to the generic descriptor-shell (`resolveDescriptorShell`): register the shell's surfaceId, kick the first refresh, and push the shell — preserving today's behavior only for the no-usable-layout case. |
| FR-007 | When the agent attaches NO descriptor, main MUST push the agent's spec unchanged and the surface MUST remain non-refreshable (the panel refresh control disabled) — behavior unchanged. |
| FR-008 | The descriptor MUST be secret-free by contract; main MUST validate + secret-strip it at the `UiBridge` boundary (`validateAdapterDescriptor`), screened against the frame's `target` (cross-target rejected). An invalid/cross-target/unknown-source descriptor MUST be warned + ignored, and the agent's literal spec rendered un-refreshably — never a crash. |
| FR-009 | The token MUST be attached only in main at refresh re-execution; it MUST NOT appear in any IPC payload, bridge frame, MCP result, the descriptor, the data model, or the surface. |
| FR-010 | The renderer MUST persist the agent's custom bound surface's verbatim spec AND its secret-free descriptor in the session snapshot (a `composed: true` surface), so a restored custom bound surface is re-instated and refreshable. |
| FR-011 | On restoring a `composed: true` surface that carries a descriptor, ActiveTabSurface MUST fire ONE descriptor-bearing `adapter.refresh`; main MUST lazily register the surface under the surfaceId carried in that restore action's payload (the agent's own surfaceId) before re-executing — main never freshly composed it this run. |
| FR-012 | The panel refresh control MUST enable for a tab whose active surface carries a `descriptor` and a `surfaceId` (existing `derivePanelRefreshState`), which now includes custom agent-composed bound surfaces — no change to that pure logic is required beyond ensuring the agent's surfaceId + descriptor reach the tab. |
| FR-013 | The session schema version decision: persisting the agent's verbatim bound spec beside the descriptor changes the meaning of a persisted descriptor-bearing surface (it is now the agent's own custom spec, registered under the agent's surfaceId, rather than a generic shell). `SESSION_SCHEMA_VERSION` MUST be bumped (3 → 4) so v3 snapshots — which, under the old rule, may pair a descriptor with a spec that would now be wrongly treated as the agent's own bound layout — are treated as unreadable and fall back to a clean session. |
| FR-014 | A `surfaceId` collision (the agent reuses a surfaceId already registered for a different live surface) MUST be tolerated: `AdapterDispatcher.register` already replaces a prior registration for the same id (resetting accumulation/cursors), so the latest registration wins; no crash, no cross-surface data bleed (the data model is keyed by surfaceId, so two tabs that pick the same surfaceId is an agent-authoring hazard documented in the tool description, not a correctness crash). |
| FR-015 | An unknown `dataSource` (no integration's bind-option resolver claims it) MUST yield no registration (warn + ignore), the agent's spec rendered un-refreshably; the refresh control stays disabled for that tab. |

## Edge Cases & Constraints

- **Literal-only spec WITH a descriptor.** The agent attaches a descriptor but composes literal props
  (no `{path}` bindings) against the documented paths. Main still registers the agent's surface and
  refreshes — but the refresh's `updateDataModel` has nothing bound to repaint, so the literal layout
  shows its original data. This is an agent-authoring mistake, not a cosmos failure: the spec stays
  rendered, the control is enabled, refresh is a harmless no-visible-change. The tool description MUST
  steer the agent to use `{path}` bindings for refreshable data. (cosmos does NOT inspect the spec to
  detect bindings vs literals — it trusts the agent + the documented contract; the generic shell is
  the fallback only for a structurally-unusable spec, FR-006.)
- **surfaceId collision across tabs.** Two tabs whose custom surfaces share a surfaceId would have
  refreshes route to whichever registration is current. Documented as an authoring hazard; the agent
  SHOULD mint a unique surfaceId per surface. No correctness crash (FR-014).
- **Restore from session.** A restored bound surface must re-register lazily on its restore refresh
  (FR-011); a stale-schema snapshot falls back to a clean session (FR-013).
- **Pagination on a custom surface.** Works via the dispatcher's existing append/page-replace/none
  handling keyed on the resolved bind options (FR-002); a custom surface inherits the `dataSource`'s
  pagination mode.
- **Unknown dataSource.** Warn + ignore; un-refreshable (FR-015).
- **Out of scope:** per-surface custom pagination modes that differ from the `dataSource`'s implied
  mode; agent-chosen custom list paths that diverge from the documented per-`dataSource` path (the
  contract is fixed per `dataSource` so the dispatcher and the agent agree); inspecting the agent's
  spec to auto-detect which paths are bound; write actions beyond the existing `jira.*` deterministic
  dispatch; any change to the token/secret model.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | A custom agent-composed Jira surface with a `searchIssues` descriptor renders the agent's CUSTOM layout (verified: the pushed `spec.surfaceId` and component tree equal the agent's, not the generic shell's). |
| SC-002 | Clicking refresh on that custom surface produces `updateDataModel` keyed by the agent's surfaceId at the documented path, and the custom layout repaints without a full re-push (no second `ui:render` for the tab). |
| SC-003 | A restored `composed: true` custom bound surface fires exactly one restore `adapter.refresh`, main lazily registers it under the agent's surfaceId, and fresh data lands. |
| SC-004 | No token/secret appears in any descriptor, IPC payload, bridge frame, MCP result, data model, or surface (validated at the main boundary; secret-looking query keys stripped). |
| SC-005 | A v3 snapshot is treated as unreadable after the bump to v4, falling back to a clean session. |
| SC-006 | A descriptor with an unusable spec falls back to the generic shell (FR-006); a descriptor with an unknown `dataSource` is warned + ignored and renders un-refreshably (FR-015); neither crashes the process. |

---

## Open Questions

- [ ] None blocking. One design choice is settled here rather than left open: cosmos trusts the agent
  to bind `{path}`s per the documented contract and does NOT statically detect bound-vs-literal specs;
  the generic shell is the fallback ONLY for a structurally-unusable spec (FR-006). If a future need
  arises to detect literal-only specs and substitute the shell, that is a follow-up, not this cycle.
