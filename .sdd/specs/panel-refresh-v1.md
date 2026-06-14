# Spec: Panel-Level Refresh for Generative-Adapter Surfaces — v1

**Status**: Draft (revised 2026-06-09 — OQ-1 mechanism pivoted to agent-emitted descriptor; see "Revision note")
**Created**: 2026-06-09
**Supersedes**: —
**Related plan**: .sdd/plans/panel-refresh-v1.md

---

## Revision note (2026-06-09)

The registration mechanism for making Slack/Confluence (and any agent-composed) surfaces
refreshable changed after user direction. The original draft proposed a **native
panel-driven bound-compose** path (a new main-side `handle*View` mirroring Jira). That does
NOT fix the user's actual symptom — the broken refresh is on an **agent-composed**
`render_slack_ui` surface. The chosen mechanism is now: **the agent emits an OPTIONAL
secret-free `descriptor { dataSource, query }` alongside its render call**; main validates +
registers it and forwards it in the existing `UiRenderPayload.descriptor` field, so the
surface the agent actually composed becomes refreshable. The follow-up cycle
`agent-bound-surface-descriptor-v1` is therefore pulled INTO this cycle. Revised across the
overview, FR-010..012, and the open questions below.

## Overview

The four generative panels (Generated UI, Slack, Jira, Confluence) render agent- or
main-composed A2UI 0.9 surfaces whose **view is composed once but whose data can refresh**
via the shared generative-adapter infrastructure (`AdapterDispatcher`, secret-free
descriptors, `updateDataModel`). This feature gives each panel a **single panel-level
refresh control in the panel chrome** — not a per-surface or per-section affordance — that
re-fetches the **active tab's** bound surface. It closes the defects that make refresh
unreliable today: agent-composed Slack/Confluence surfaces are never registered with the
dispatcher (so refresh is a no-op for them) because their render call carries no descriptor,
and the renderer's one-shot action guard blocks every repeat of a reusable `adapter.*` action
after the first. The fix lets the composing agent attach a secret-free descriptor to the
surface it renders, so the surface the user is actually looking at becomes refreshable.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### Refresh the active tab's data from the panel chrome · P1

**As a** cosmos user viewing a live data surface (a Jira board, a Slack channel list, a
Confluence feed) in a generative panel
**I want to** click one refresh control in the panel chrome
**So that** the surface shows current data without re-running the agent and without the
view being re-composed

**Acceptance criteria:**

- Given the active tab shows a registered/bound surface, when I click the panel refresh
  control, then its data is re-fetched from the first page and the surface updates in place
  (an `updateDataModel`, never a full re-push, never an agent run).
- Given the refresh is in flight, when I observe the control, then it shows a busy/spinner
  state and ignores further clicks until the fetch settles.
- Given the active tab has no refreshable surface (empty/Untitled tab, native-base browser,
  or a non-adapter surface), when I look at the panel chrome, then the refresh control is
  disabled or absent (it never dispatches a no-op refresh).

### Refresh works repeatedly, every time · P1

**As a** user who refreshes the same surface more than once
**I want to** click refresh again and again and have each click re-fetch
**So that** refresh is a repeatable affordance, not a one-time button that silently dies

**Acceptance criteria:**

- Given I have already refreshed the active surface once, when I click refresh again, then it
  re-fetches again (N consecutive refreshes each produce a fresh fetch).
- Given a terminal `submit` action (the agent's blocking `render_ui` answer) has been sent
  for a surface, when that same surface tries to send another terminal `submit`, then it is
  still blocked once (terminal submit stays one-shot — `adapter.*` actions do not consume it).

### Agent-composed Slack/Confluence surfaces become refreshable · P1

**As a** user viewing a Slack or Confluence surface the agent composed (via
`render_slack_ui` / `render_confluence_ui`)
**I want** the panel refresh control to actually re-fetch the data that surface shows
**So that** the surface I am actually looking at gets live refresh, not just a separate
native view

**Acceptance criteria:**

- Given the agent renders a Slack/Confluence surface and attaches a secret-free descriptor
  `{ dataSource, query }` to that render call, when the surface reaches the renderer, then
  main has registered it with the dispatcher keyed by surfaceId and forwarded the descriptor
  in `UiRenderPayload.descriptor` (so the renderer persists it).
- Given that registered surface is active, when I click the panel refresh control, then its
  data re-fetches in place exactly as Jira's does (re-executing the descriptor in main; the
  token is attached in main; only non-secret data values cross to the renderer).
- Given the agent renders a surface WITHOUT a descriptor (or an invalid one), when it
  reaches the renderer, then the surface still renders normally but is NOT refreshable (the
  panel refresh control is disabled for it) — no crash, no agent round-trip.

### Refresh respects the active tab after a switch · P2

**As a** user with multiple tabs in a panel
**I want** the panel refresh control to act on whichever tab is currently active
**So that** refresh always targets what I am looking at

**Acceptance criteria:**

- Given tab A and tab B both hold refreshable surfaces, when I switch from A to B and click
  refresh, then tab B's surface re-fetches (not A's), and a push for A's surfaceId is ignored
  by B's body.
- Given I switch to a tab with no refreshable surface, when I look at the chrome, then the
  refresh control reflects that tab's state (disabled/absent), not the previous tab's.

### Load-more / pagination stays inside the surface · P1

**As a** user scrolling a paginated list
**I want** "Load more" / pagination to remain inside the list surface (unchanged)
**So that** list paging stays tied to that list's position and is not conflated with a
panel-wide refresh

**Acceptance criteria:**

- Given a paginated list surface, when I use it, then `LoadMoreButton` (and `PaginationBar`
  where used) renders in-surface exactly as before.
- Given the panel refresh control exists in the chrome, when I inspect a composed surface,
  then it no longer contains an in-surface refresh button.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                                                          |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | Each generative panel (Generated UI, Slack, Jira, Confluence) MUST present exactly ONE refresh control, located in the panel chrome (outside the A2UI host), acting on the active tab's surface.       |
| FR-002 | The panel refresh control MUST dispatch the existing reserved `adapter.refresh` action for the active tab's `surfaceId`; main MUST route it through the `AdapterDispatcher` (never to the agent).      |
| FR-003 | The panel refresh control MUST expose three states: idle (actionable), in-flight (busy/spinner, non-actionable), and disabled/absent when the active tab has no refreshable (registered/bound) surface.|
| FR-004 | The control MUST be disabled/absent for: an empty/Untitled tab, a native-base browser view (Slack/Confluence/Jira non-composed chrome with no surface), and any surface lacking an adapter descriptor. |
| FR-005 | A refresh MUST NOT re-compose the view; it re-executes the surface's secret-free descriptor and applies an in-place `updateDataModel` keyed by `surfaceId` (the established adapter contract).          |
| FR-006 | The in-surface catalog `RefreshButton` MUST be removed from every composed surface; composed surfaces MUST NOT render a per-surface refresh affordance.                                                |
| FR-007 | `LoadMoreButton` (append pagination) and `PaginationBar` (page-replace, where used) MUST remain in-surface and unchanged — they are NOT moved to the panel chrome.                                      |
| FR-008 | The renderer's repeat-action guard MUST allow `adapter.*` actions (`adapter.refresh` / `adapter.loadMore` / `adapter.page`) to be sent repeatedly for the same surface/requestId.                      |
| FR-009 | The renderer MUST keep the terminal `submit` (the agent's blocking `render_ui` answer) one-shot per requestId — sending it MUST still be blocked after the first send.                                 |
| FR-010 | The Slack and Confluence render tools (`render_slack_ui`, `render_confluence_ui`) MUST accept an OPTIONAL secret-free `descriptor { dataSource, query }` parameter on a compose call, carrying the same non-secret read params the agent already used to fetch the rendered data. The render tools MAY also accept it (`render_ui`, `render_jira_ui`) for consistency. |
| FR-011 | When a render call carries a descriptor, main MUST validate it at the bridge / `ui:render` boundary, register it with the `AdapterDispatcher` keyed by the surfaceId (with bind options derived from its `dataSource` via the existing composite resolver), and forward it in the existing `UiRenderPayload.descriptor` field so the renderer persists it. |
| FR-012 | An ABSENT, malformed, or unknown descriptor MUST be warned + ignored at the main boundary; the surface MUST still render (un-refreshable). A descriptor MUST NOT block, alter, or crash the compose path. |
| FR-013 | The descriptor MUST be secret-free (a `dataSource` enum + non-secret query params only); it MUST NOT carry a token. Tokens stay in main; a refresh re-executes the descriptor in main (token attached there) and only non-secret data values cross to the renderer. The descriptor MUST NOT appear to carry a secret in any bridge/MCP frame, `updateDataModel` payload, refresh action context, or A2UI surface (existing invariant). |
| FR-014 | A malformed or unknown `adapter.*` payload (missing/invalid `surfaceId`, bad direction) MUST be validated at the main-process boundary and warned + ignored — never crashing, never an agent round-trip.|
| FR-015 | A refresh fired for a `surfaceId` with no registration MUST be a safe no-op (warned, ignored) — the control SHOULD be disabled in that state per FR-003 so this is not normally reachable.              |
| FR-016 | A refresh fired while a refresh for the same surface is already in flight MUST NOT corrupt state; the in-flight fetch is superseded/coalesced per the dispatcher's existing refresh semantics.          |
| FR-017 | Panel-level refresh state MUST be per-tab/active-surface: switching tabs MUST re-derive the control's enabled/in-flight state from the now-active tab's surface.                                        |
| FR-018 | The refresh control MUST be keyboard-accessible and carry an accessible label and busy state (parity with the prior in-surface control's ARIA).                                                        |

## Edge Cases & Constraints

- **No active bound surface:** empty/Untitled tab, native-base browser, or non-adapter
  surface → control disabled/absent (FR-003/FR-004); a stray refresh is a no-op (FR-015).
- **Refresh while one is in flight:** repeated clicks during a fetch are ignored by the busy
  state; the dispatcher's existing refresh restart-from-first-page semantics apply (FR-016).
- **Refresh after tab switch:** the control acts on the active tab's surfaceId; a data push
  for a non-active surfaceId is ignored by the inactive tab's body (FR-017, existing match).
- **Repeated refresh (N times):** each click re-fetches; no one-shot suppression (FR-008).
- **Malformed/ignored payloads stay safe:** boundary validation warns + ignores; the pending
  `render_ui` call is never settled by an `adapter.*` action (FR-014).
- **Tab restore:** a restored bound tab still self-registers + refreshes on mount via the
  existing descriptor-bearing restore refresh; the panel control is an additional manual
  trigger over the same registered surface, not a replacement for restore behavior.
- **Out of scope:** changing pagination semantics; adding write actions to Slack/Confluence;
  auto-refresh / polling / timers; cross-tab or whole-panel (all-tabs) refresh; refreshing a
  non-active tab; any new integration data source.

## Success Criteria

| ID     | Criterion                                                                                                                          |
|--------|----------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | Each of the four generative panels shows exactly one refresh control in its chrome; no composed surface contains an in-surface refresh button. |
| SC-002 | Clicking the panel refresh control on an active bound Jira / Slack / Confluence / Generated UI surface re-fetches its data in place (verified via the dispatched `adapter.refresh` + resulting `updateDataModel`). |
| SC-003 | Refreshing the same surface N consecutive times produces N fetches (no one-shot death); a terminal `submit` remains blocked after its first send. |
| SC-004 | An AGENT-COMPOSED Slack and Confluence surface whose render call carried a descriptor is registered + refreshable end-to-end; one whose render call omitted the descriptor renders normally but is non-refreshable (control disabled). |
| SC-005 | The refresh control is disabled/absent on an empty/Untitled tab, a native-base browser view, and a non-adapter surface, and reflects the active tab after a switch. |
| SC-006 | Malformed `adapter.*` payloads are warned + ignored at the boundary and never crash or trigger an agent run; tokens never appear in any descriptor/payload/surface. |
| SC-007 | `LoadMoreButton` / `PaginationBar` behavior and placement are unchanged (still in-surface). |

---

## Open Questions

- [x] **OQ-1 — Slack/Confluence registration trigger — RESOLVED (2026-06-09).** The agent
  emits an OPTIONAL secret-free `descriptor { dataSource, query }` on its render call; main
  validates + registers it and forwards it in `UiRenderPayload.descriptor`. This makes the
  surface the agent ACTUALLY composed refreshable (the user's symptom), not just a separate
  native view. The previously-deferred follow-up `agent-bound-surface-descriptor-v1` is pulled
  into this cycle. See FR-010..013 and the plan.
- [x] **OQ-2 — Generated UI panel refreshability — RESOLVED (2026-06-09).** A `render_ui`
  surface is refreshable IFF its render call carried a descriptor (FR-010 makes it optional
  there too). When none is supplied the control is disabled (FR-003/FR-004). The panel mounts
  the same shared control; no special-case hide.
- [ ] **OQ-3 — Control placement & affordance.** Exact chrome location (tab strip vs. footer
  vs. a header row) and visual treatment per panel is a design-step decision (this is a
  UI-bearing feature); the spec fixes only "one control, in the chrome, acts on the active
  tab."
- [ ] **OQ-4 — Per-tool descriptor `dataSource` allow-list (design/interface step).** Each
  render tool is target-scoped, so its descriptor's `dataSource` should be constrained to that
  integration's sources (e.g. `render_slack_ui` ⇒ Slack sources only). Confirm main rejects a
  cross-target descriptor (e.g. a Jira `dataSource` on a `target:'slack'` frame) as malformed
  (FR-012). Mechanism decided at interface; the spec requires only that an invalid descriptor
  be ignored safely.
