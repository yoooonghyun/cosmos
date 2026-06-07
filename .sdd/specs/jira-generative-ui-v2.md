# Spec: Jira Generative UI — v2

**Status**: Approved (OQ1–OQ4 resolved)
**Created**: 2026-06-06
**Supersedes**: `.sdd/specs/jira-generative-ui-v1.md` (re-frames WHERE Jira surfaces live and HOW
they are entered; REUSES v1's write/action plumbing unchanged — see "Relationship to v1")
**Related plan**: `.sdd/plans/jira-generative-ui-v2.md`

---

## Overview

Turn the **native Jira rail panel itself** into a generative surface: it shows a useful **default
view** on open (recent issues), accepts a **natural-language utterance typed in the panel**, and
**re-composes its own body** in response — rendered with **Jira-specific custom A2UI components**
(`catalogId: 'jira'`: TicketCard, StatusBadge, TransitionPicker, …) so the generated surface has
the same color/design fidelity as the hand-built native panel. Interactions still perform REAL
Jira writes through v1's deterministic `jira.*` action binding. v1 mistakenly left the native Jira
panel static/read-only and put Jira surfaces in the separate "Generated UI" tab; v2 moves the
Jira generative surface into the Jira panel and swaps the standard catalog for the Jira custom
catalog. v2 changes none of v1's write/scope/dispatch plumbing.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open the Jira panel and see a default view · P1

**As a** cosmos user
**I want to** open the Jira panel and immediately see my recent issues, with no typing required
**So that** the panel is useful on open and gives me a starting surface I can act on or refine

**Acceptance criteria:**

- Given Jira is connected, when I switch the rail to the Jira panel, then main **re-composes the
  default Jira surface on every switch** (a fresh recent-issues read → `jiraSurfaceBuilder` default
  surface → push with `target: 'jira'`), so the default view is always current; it is composed from
  the resource shapes in `src/shared/jira.ts`, using the Jira custom catalog.
- Given the per-switch default-view read is in flight, when I look at the panel, then the panel
  shows an explicit **loading state** for the refresh; the prior surface (if any) MAY stay visible
  beneath/until the fresh surface arrives, and the loading state clears when the surface renders.
- Given the default view has rendered, when I have not typed an utterance, then it remains (it is
  not replaced by an empty/idle prompt and does not require an agent run to appear).
- Given Jira is NOT connected, when I switch to the Jira panel, then the panel shows the existing
  Connect/Reconnect affordance (unchanged), does NOT issue the default-view read, and does NOT
  render a generative surface or hang.
- Given the per-switch default-view read fails (rate-limited / reconnect-needed / network), when I
  switch to the panel, then the panel shows a clear, recoverable **error state** instead of the list
  — never a crash, hang, or stack trace.

### Transform the panel by an utterance typed in it · P1

**As a** cosmos user
**I want to** type a request ("show my open bugs", "open PROJ-123") into a prompt input that lives
in the Jira panel
**So that** the panel's body re-composes into the Jira surface I asked for, in place

**Acceptance criteria:**

- Given Jira is connected and a prompt input is present in the Jira panel, when I submit a non-empty
  utterance, then the agent reads Jira via the existing read tools and composes a Jira surface that
  renders **in the Jira panel body** (not in the separate Generated UI panel).
- Given an utterance-driven surface is composed, when it renders, then it uses the **Jira custom
  catalog** (`catalogId: 'jira'`) and presents only the data already abstracted in
  `src/shared/jira.ts` — no parallel Jira resource shapes are invented.
- Given an utterance run is in progress, when I look at the panel, then the panel reflects an
  in-progress state (the prior surface may stay visible) and an empty/whitespace utterance starts
  no run.
- Given the run fails or cannot start, when it returns, then the panel shows a persistent,
  human-readable error and the prompt input stays usable — the panel never hangs or crashes.

### Act on the Jira surface (deterministic write) · P1

**As a** cosmos user
**I want to** transition a ticket or add a comment by interacting with the Jira surface in the panel
**So that** the change is applied in real Jira immediately, without another model round-trip

**Acceptance criteria:**

- Given a ticket surface in the Jira panel offers a transition or comment control whose action is in
  the `jira.*` namespace, when I act on it, then the Electron main process recognizes the bound
  action and executes the write via `JiraManager` WITHOUT re-invoking `claude` (v1 plumbing).
- Given the write resolves, when it completes, then the Jira panel's surface reflects the outcome
  (updated status / appended comment / a clear recoverable error) without Claude re-composing it.
- Given a write needs a scope the stored token lacks (`write:jira-work`), when I attempt it, then the
  surface shows the existing "reconnect to enable Jira actions" outcome and no write is attempted.

### Custom catalog gives native-panel design parity · P2

**As a** cosmos user
**I want to** the generated Jira surface to look like the rest of cosmos (status colors, ticket
cards) rather than color-less text
**So that** the panel reads as one product whether the body is hand-built or agent-composed

**Acceptance criteria:**

- Given a Jira surface renders a status, when I look at it, then status is shown with the cosmos
  `--status-todo/-progress/-done` color treatment (the same vocabulary the native `StatusBadge`
  uses today), not text-and-glyph only.
- Given the default view, an utterance-driven surface, and a post-write re-render, when each
  renders, then all three use the **same** Jira custom-catalog component vocabulary (one component
  contract, regardless of which path composed the surface).

### Generated UI panel stays generic · P3

**As a** cosmos user
**I want to** the separate Generated UI panel to remain a general-purpose generative surface
**So that** Jira has a dedicated home and the generic panel is not Jira-specific

**Acceptance criteria:**

- Given the Jira panel is the home for Jira generative surfaces, when I use the generic Generated UI
  panel, then it continues to render agent-composed surfaces for non-Jira requests as it does today
  (its behavior is unchanged by this feature).

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The native **Jira rail panel** (`src/renderer/JiraPanel.tsx`) MUST become the home for the Jira generative surface: when Jira is connected, the panel body MUST render an A2UI Jira surface (default view, utterance-driven surface, or post-write re-render). The Jira panel MUST NO LONGER be the static read-only browser as its primary connected state. |
| FR-002 | When Jira is connected and no utterance has been submitted, the panel MUST show a **default view** (a recent-issues list) composed deterministically by main (via the existing `jiraSurfaceBuilder`) and pushed with `target: 'jira'` — NOT via an implicit agent run. With no utterance the default view MUST remain (it is not cleared to an idle prompt). **(Resolved OQ4)** Main MUST **RE-COMPOSE the default view on EVERY rail switch to the Jira panel** (a fresh Jira recent-issues read → builder → push), so the surface is always current. The per-switch refresh is governed by FR-019 (loading/error states) and FR-020 (rate-limit / extra-API-call consideration). |
| FR-003 | The Jira panel MUST contain a **prompt input** (an utterance composer) so the user can type a request that re-composes the panel body. An empty/whitespace utterance MUST start no run (consistent with the existing agent-composer guard). |
| FR-004 | **(Resolved OQ1)** An utterance submitted in the Jira panel MUST drive a render that lands in the **Jira panel body**, NOT in the generic Generated UI panel. The render-target discriminator MUST be a `target: 'jira' \| 'generated-ui'` field added to `UiRenderPayload` (`src/shared/ipc.ts`). The Jira panel and the generic Generated-UI panel EACH host their OWN `A2UIProvider` with their OWN catalog, and EACH filters incoming `ui:render` by `target` (rendering only payloads whose `target` matches its panel, ignoring the rest). The EXISTING `ui:render` / `ui:action` IPC channels MUST be reused — NO dedicated Jira channel set. Deterministic default-view and post-write re-pushes set `target: 'jira'`; a generic agent render defaults to `target: 'generated-ui'`. |
| FR-005 | Both compose paths — (a) main composing deterministically (default view + post-write re-render) and (b) the agent composing from an utterance — MUST emit the SAME Jira custom-catalog component vocabulary, so the panel renders them identically regardless of origin. |
| FR-006 | Jira surfaces MUST be rendered with a **Jira custom A2UI catalog** identified by `catalogId: 'jira'`, registered in the renderer via the A2UI provider's `catalog=` prop. The catalog MUST define at least: a **TicketCard** (one issue summary: key, summary, status, assignee), a **StatusBadge** (status name + normalized `JiraStatusCategory`, colored via the cosmos `--status-*` tokens), and a **TransitionPicker** (choose + apply an available transition). The set MAY include additional Jira components (e.g. an issue list container, a comment list/row, an add-comment control) as the surfaces require — every component MUST trace to a real Jira surface need, never invented. |
| FR-007 | The Jira custom-catalog components MUST consume the cosmos `--status-todo/-progress/-done` tokens for status color, achieving native-panel design parity (the v1 standard-catalog surfaces could only convey status as text + glyph; v2 restores color via the custom catalog). |
| FR-008 | Each interactive Jira custom-catalog component MUST emit the existing `jira.*` bound actions with the existing context contract: TransitionPicker (or its submit) emits `jira.transition` with `{ issueKey, transitionId }`; the add-comment control emits `jira.comment` with `{ issueKey, body }`. The bound-action names + context fields are the v1 contract in `src/shared/jira.ts` and MUST NOT change. |
| FR-009 | The deterministic `jira.*` dispatch MUST remain unchanged from v1: main intercepts a `jira.*` `ui:action` at the boundary, executes the write via `JiraManager` (no `claude` re-invocation), settles the pending render call as `cancel`, re-reads the issue, and re-pushes the re-composed surface. v2 only changes that the re-pushed surface targets the Jira panel (FR-004) and uses the Jira catalog (FR-006). |
| FR-010 | The data inputs to every Jira custom-catalog component MUST be the resource shapes already in `src/shared/jira.ts` (`JiraIssueSummary`, `JiraIssueDetail`, `JiraComment`, `JiraUserRef`, `JiraTransition`, normalized `JiraStatusCategory`). NO parallel/duplicate Jira resource type may be introduced for rendering. |
| FR-011 | **(Resolved OQ3)** The agent MUST be taught the Jira custom catalog through a **SEPARATE, Jira-scoped render tool** (a target-scoped render tool, distinct from the standard-catalog `render_ui`) — NOT a single shared `render_ui` that teaches both catalogs. The Jira-scoped tool (named **`render_jira_ui`**) MUST: (a) teach the `catalogId: 'jira'` component vocabulary (TicketCard / StatusBadge / TransitionPicker, etc.) — each component's type name, its data inputs, and which `jira.*` action it emits, so the agent's surfaces match the deterministic builder's vocabulary (FR-005); and (b) route its render to **`target: 'jira'`** so the surface lands in the Jira panel. The standard `render_ui` tool (standard catalog → `target: 'generated-ui'`) is unchanged. This is acknowledged to be **heavier on the MCP entry side** than a single shared tool (a second tool registration + a second tool description). |
| FR-012 | A Jira-panel utterance run MUST NOT be misrouted to the generic Generated UI panel, and a generic Generated-UI utterance MUST NOT be misrouted to the Jira panel (the routing discriminator of FR-004 applies to BOTH the render push and the surface composition). |
| FR-013 | **(Resolved OQ2)** The Jira-panel utterance path and the generic Generated-UI path MUST share the **single existing `AgentRunner`**. No second runner is introduced. The render `target` MUST be threaded through a run so the run's render output is tagged with the correct target (`target: 'jira'` for a Jira-panel utterance via the Jira-scoped tool of FR-011; `target: 'generated-ui'` for a generic utterance). The existing **single-run / blocked-while-running guard** MUST be kept: a submit while a run is in flight is ignored (surfaced as the in-progress state). It is ACCEPTED that a Jira utterance and a generic Generated-UI utterance CANNOT run simultaneously — they run **sequentially**. A submit while busy MUST degrade gracefully (ignored, never crash/hang/lose intent). |
| FR-014 | The generic **Generated UI panel** MUST remain general-purpose and non-Jira-specific: its existing behavior for non-Jira utterances is unchanged, and it is NOT required to render Jira surfaces. The Jira panel is the sole home for Jira generative surfaces. |
| FR-015 | The default view MUST be composable WITHOUT an agent run: main composes it deterministically from a Jira read (recent issues) via the existing builder. A failed default-view read MUST surface a recoverable error in the panel (rate-limited / reconnect-needed / network), never a crash or hang. |
| FR-016 | The panel MUST handle the not-connected and reconnect-needed states as today: when not connected, show the existing Connect affordance and compose no surface; a write or read that returns `reconnect_needed` / `write_not_authorized` MUST point the user to the existing native Connect/Reconnect flow (no second OAuth entry point). |
| FR-017 | **Security (unchanged, non-negotiable):** the Atlassian Cloud 3LO `client_secret` (`COSMOS_ATLASSIAN_CLIENT_SECRET`) MUST remain main-process only, never logged, and never placed in any IPC payload, bridge frame, MCP tool argument/result, or A2UI surface. Jira access + refresh tokens MUST remain main-only (safeStorage-encrypted), never exposed to the renderer, the bridge, the MCP entry script, or the sandboxed `claude` child. Jira surfaces and bound-action payloads carry only non-secret content/identifiers (`issueKey`, `transitionId`, comment body) — never a token. Only `write:jira-work` is added (already done in v1); v2 adds no new scope and no secret-bearing field on any type/surface. |
| FR-018 | The Jira custom catalog's COMPONENT CONTRACT (which components exist, their data inputs, and which `jira.*` actions they emit) is owned by this spec; the components' **visual design** (exact pixels, token application) is owned by the later `design` step (the `designer` agent). This spec MUST NOT specify pixels; the designer MUST NOT add components or actions not in this contract. |
| FR-019 | **(Resolved OQ4 — loading + error states for the per-switch refresh.)** The per-switch default-view refresh (FR-002) MUST present an explicit **loading state** while the recent-issues read is in flight, and a recoverable **error state** if it fails. Loading: the panel reflects an in-progress refresh (a prior surface MAY remain visible until the fresh surface arrives); the loading affordance clears when the surface renders. Error (rate-limited / reconnect-needed / network): a clear, recoverable error state replaces the list — never a crash, hang, or stack trace. A `reconnect_needed` MUST route to the existing native Connect/Reconnect affordance (FR-016). |
| FR-020 | **(Resolved OQ4 — extra-API-call / rate-limit consideration.)** Because the default view re-composes on EVERY rail switch (FR-002), each switch issues an EXTRA Jira recent-issues read. The design MUST account for this cost: a failed/`rate_limited` per-switch read MUST degrade to the FR-019 error state (showing "busy, retry shortly") and MUST NOT crash, retry-storm, or block the rail switch itself (switching to the Jira panel always succeeds; only the surface content is affected). The recent-issues read MUST stay a single, bounded read (no pagination loop, no fan-out) per switch. |

## Edge Cases & Constraints

- **Panel open while not connected** → existing Connect affordance; no surface composed, no
  per-switch read issued (FR-016, FR-002).
- **Default-view read fails (per switch)** → recoverable error state in the panel; no list, no crash
  (FR-015, FR-019). A `reconnect_needed` routes to the native Connect/Reconnect affordance.
- **Rapid rail switching to/from Jira** → each switch-IN triggers one bounded recent-issues read
  (FR-002, FR-020); a `rate_limited` result degrades to "busy, retry shortly" (FR-019/FR-020); the
  switch itself always succeeds (only surface content is affected). No retry-storm, no fan-out.
- **Empty/whitespace utterance** → no run started (FR-003).
- **Utterance run fails / cannot start** → persistent human-readable error, prompt stays usable; the
  default or prior surface is not destroyed by the failure.
- **Concurrent runs (Jira panel + generic Generated UI)** → the single shared `AgentRunner`'s
  single-run guard makes them SEQUENTIAL (FR-013): a submit while a run is in flight is ignored
  (in-progress state shown); no crash/hang/lost intent. A Jira utterance and a generic utterance
  cannot run simultaneously — accepted.
- **Render misrouting** → the `target` discriminator (FR-004) guarantees a Jira-panel render
  (`target: 'jira'`) renders only in the Jira panel and a generic render (`target: 'generated-ui'`)
  only in the Generated UI panel; each panel filters `ui:render` by its own `target` (FR-012).
- **Agent emits an unknown/invalid Jira component** → must degrade to a safe fallback (the renderer's
  existing surface error boundary), never white-screen — mirrors the standard-catalog fallback.
- **Post-write re-render targets a panel the user has switched away from** → the re-pushed Jira
  surface is for the Jira panel; switching rail surfaces keeps panels mounted (App shell forceMount),
  so the updated surface is present when the user returns. The write itself is unaffected.
- **Write failures** (invalid/stale transition, permission, reconnect-needed, rate-limited, network,
  `write_not_authorized`) → surfaced as recoverable surface states via v1's dispatcher; never a
  crash, hang, or token/secret leak (v1 FR-017 reused).
- **Security:** `client_secret` + tokens stay in main only (FR-017); surfaces and bound-action
  payloads carry only non-secret content.
- **Explicitly out of scope for v2:**
  - Any NEW Jira write beyond v1's transition + comment (assign, edit fields, create, delete,
    attachments, worklogs).
  - Any new OAuth scope beyond the v1 `write:jira-work`.
  - Re-speccing v1's write path (scope, `JiraManager` write methods, `jira.*` deterministic binding,
    write MCP tools, `write_not_authorized`/reconnect flow) — REUSED as-is (see Relationship to v1).
  - Confluence (this spec is Jira-only); making the generic Generated UI panel Jira-aware.
  - Multi-site selection, bulk operations, optimistic offline queueing.
  - The exact visual design of the custom-catalog components (the `design` step owns pixels; FR-018).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Switching the rail to the Jira panel while connected (no utterance) RE-COMPOSES and renders a fresh default recent-issues Jira surface in the panel body (on every switch), composed deterministically by main, pushed with `target: 'jira'`, and rendered with the `catalogId: 'jira'` custom catalog; a per-switch loading state shows while the read is in flight and a recoverable error state shows on failure. |
| SC-002 | Submitting an utterance in the Jira panel re-composes the panel body into the requested Jira surface via the Jira-scoped render tool (`render_jira_ui`, `target: 'jira'`), rendered in the Jira panel (not the generic Generated UI panel) with the Jira custom catalog, from the `src/shared/jira.ts` resource shapes; the single shared `AgentRunner` composes it and a generic utterance cannot run simultaneously. |
| SC-003 | The default view, an utterance-driven surface, and a post-write re-render all render with the SAME Jira custom-catalog component vocabulary; status is shown with the cosmos `--status-*` color treatment (native-panel design parity). |
| SC-004 | Acting on a transition or comment control in the Jira panel executes a REAL Jira write via `JiraManager` dispatched in main WITHOUT re-invoking `claude`, and the Jira panel's surface reflects the outcome. |
| SC-005 | A Jira-panel render (`target: 'jira'`) is never misrouted to the generic Generated UI panel and vice versa (each panel filters `ui:render` by `target`); the generic Generated UI panel's behavior for non-Jira utterances is unchanged. |
| SC-006 | A failed default-view read, a failed utterance run, and any write failure each surface a recoverable state in the Jira panel; the app never crashes, hangs, or leaks a token/secret. |
| SC-007 | `client_secret` and tokens remain main-process only across all v2 paths (never logged/IPC/bridge/MCP/surface); v2 adds no new scope and no secret-bearing field. |

---

## Relationship to v1

**REUSED UNCHANGED (the foundation v2 builds on — do NOT re-spec):**

- The `write:jira-work` scope (v1 FR-012) and the re-consent / scope-gap (`write_not_authorized`)
  flow pointing at the existing native Connect/Reconnect affordance (v1 FR-013, D4).
- `JiraManager.transitionIssue` / `addComment` / `getWriteCapability` and the underlying
  `JiraClient` write REST calls (v1 FR-010, FR-011).
- The deterministic `jira.*` action binding: main intercepts a `jira.*` `ui:action` at the boundary,
  executes the write without re-invoking `claude`, settles the pending render call as `cancel`,
  re-reads the issue, and re-pushes the re-composed surface (v1 FR-004–FR-007, FR-016, FR-019; the
  `JiraActionDispatcher`).
- The bound-action name + context contract in `src/shared/jira.ts` (`JiraBoundAction`,
  `JiraTransitionParams`, `JiraCommentParams`, `isJiraBoundActionId`) (v1 FR-005).
- The write MCP tools (`jira_transition_issue`, `jira_add_comment`) and their bridge/manager routing
  (v1 FR-008, FR-009, FR-018).
- The boundary validators (`validateJiraTransition`, `validateJiraComment`,
  `validateJiraBoundAction`) (v1 FR-006).
- The resource shapes in `src/shared/jira.ts`, including `availableTransitions` on `JiraIssueDetail`
  (v1 FR-002, D3).
- Channel independence from the PTY (v1 FR-019).
- The `jiraSurfaceBuilder` MAPPING LOGIC (which Jira resource → which surface) is reused; v2 changes
  its OUTPUT catalog from standard → `jira` custom and adds a default-view (recent-issues) compose.

**SUPERSEDED (re-framed by v2):**

- v1 FR-001 / the v1 design's §1 placement: Jira surfaces rendered in the **Generated UI panel**.
  v2 moves them to the **Jira panel** (FR-001, FR-004).
- v1 FR-003 + the v1 design's §0/§3.1/§3.2/Open-Question-1 decision to use the **standard catalog**
  only (status as text + glyph, no color). v2 brings the **Jira custom catalog** into scope and
  restores `--status-*` color (FR-006, FR-007). The v1 deferral ("StatusBadge custom component the
  right home for category color") is exactly what v2 now implements.
- The v1 entry model (a Jira surface only appears when the user types into the *generic*
  Generated-UI composer). v2 adds a **default view re-composed on every rail switch to the Jira
  panel** + a **prompt input in the Jira panel** with **`target`-based surface routing** to that
  panel (FR-002, FR-003, FR-004, FR-019, FR-020).
- The v1 single shared `render_ui` tool/standard catalog as the only render tool. v2 adds a
  **second, Jira-scoped render tool** (`render_jira_ui`, `target: 'jira'`, jira catalog) alongside
  the unchanged standard `render_ui` (FR-011), both reaching the SAME shared `AgentRunner` (FR-013).

**The deterministic re-push now emits `target: 'jira'` and Jira-custom-catalog components** (FR-004,
FR-006, FR-009) — the only behavioral change to v1's reused dispatch path.

---

## Resolved Decisions

> All four open questions are RESOLVED (decided by the user, 2026-06-06) and folded into the FRs
> above. The first three affect the system shape; flag for `docs/ARCHITECTURE.md` at wrap-up
> (target-routed multi-panel A2UI hosting; the Jira-scoped render tool + custom catalog; the
> per-switch default refresh). Recorded here for traceability.

- **OQ1 — Render-target routing = `target` discriminator + REUSE existing channels (→ FR-004,
  FR-012).** RESOLVED: add a `target: 'jira' | 'generated-ui'` field to `UiRenderPayload`
  (`src/shared/ipc.ts`). The Jira panel and the generic Generated-UI panel each host their OWN
  `A2UIProvider` with their OWN catalog, and each filters incoming `ui:render` by `target`. The
  existing `ui:render` / `ui:action` channels are REUSED — NO dedicated Jira channel set.

- **OQ2 — Single shared `AgentRunner` (→ FR-013).** RESOLVED: share the one existing `AgentRunner`;
  thread the render `target` through a run so the agent's render output is tagged with the right
  target. KEEP the single-run / blocked-while-running guard — accept that a Jira utterance and a
  generic Generated-UI utterance run SEQUENTIALLY (cannot run simultaneously). No second runner.

- **OQ3 — Target-scoped dedicated render tool (→ FR-011).** RESOLVED: a SEPARATE, Jira-scoped render
  tool (`render_jira_ui`) teaches the `catalogId: 'jira'` component vocabulary and routes its render
  to `target: 'jira'`, distinct from the standard-catalog `render_ui` (`target: 'generated-ui'`).
  NOT a single shared `render_ui` teaching both. Acknowledged: heavier on the MCP entry side (a
  second tool registration + description).

- **OQ4 — Default view refreshes on EVERY rail switch to the Jira panel (→ FR-002, FR-019, FR-020).**
  RESOLVED: whenever the user switches the rail to the Jira panel, main RE-COMPOSES the default view
  (fresh Jira read → `jiraSurfaceBuilder` default surface → push with `target: 'jira'`) — always
  current. The per-switch refresh defines a loading state (FR-019) and a recoverable error state
  (FR-019), and accounts for the extra Jira API call / rate-limit cost (FR-020).
