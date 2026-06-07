# Spec: New tab shows the panel's base view — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: (to be authored — `.sdd/plans/new-tab-base-view-v1.md`)

---

## Overview

A refinement of panel-tabs v1: when a user opens a NEW tab in a generative rail panel
(Generated UI / Slack / Jira / Confluence) — via the `+` button, or any tab that has not
yet composed a generative-UI surface — the panel MUST show its **base screen** (the same
screen shown when zero tabs are open) instead of a blank panel. This generalizes the
zero-tab base (panel-tabs FR-017 native base / FR-018 idle placeholder) from a
`tabs.length === 0` condition to "the active tab has no composed surface".

This spec is renderer-only and changes no behavior other than what an empty/uncomposed
active tab displays. It does not alter the tab model, the originating-tab correlation,
the composer, integration scopes, or any main/IPC/MCP code.

---

## Definitions

- **Empty/uncomposed active tab** — the state in which a generative panel shows its base.
  Defined as: there is no active tab (`activeTab` is null), OR the active tab has no
  composed surface and no error (`activeTab.surface` is null AND `activeTab.error` is
  undefined). The `GenerativeTab` record (`useGenerativePanelTabs.ts`) is
  `{ id, label, untitled, surface: TabSurface | null, inFlight, error? }`; a `+`-created
  tab starts with `surface: null`, `error: undefined`, so it is empty/uncomposed.
- **Base screen** — per panel family: Slack and Confluence show their native browser
  (the same content as zero tabs); Generated UI shows its idle placeholder; Jira shows
  the agent-generated my-tickets default board view (Jira has no static native browser).

---

## User Scenarios

> Prioritized P1 (must) / P2 (should) / P3 (nice to have).

### Confluence / Slack: new tab shows the native browser base · P1

**As a** user in the Confluence or Slack panel with at least one composed tab open
**I want to** click `+` and land on the panel's native browser (search / channel list)
**So that** a fresh tab is immediately useful instead of a blank panel

**Acceptance criteria:**

- Given a Confluence (or Slack) tab already holds a composed surface, when I click `+`,
  then the new (now active) tab shows the native browser base — identical to the zero-tab
  base — with the composer still available.
- Given that new tab is showing its native base, when I submit an utterance, then the
  composed surface replaces the native base in that same tab (today's fill-active
  behavior, panel-tabs FR-012).
- Given the new tab's run errors, when the error lands, then that tab shows the error
  state (not the base) — panel-tabs FR-015 is unchanged.
- Given a tab is mid-compose (in flight) with no surface yet, when I view it, then it
  shows the base alongside the tab's in-flight indicator (panel-tabs FR-014), not a blank
  panel.

### Generated UI: new tab shows the idle placeholder · P1

**As a** user in the Generated UI panel with at least one composed tab open
**I want to** click `+` and see the idle placeholder ("Describe a UI below and Claude
will build it here.")
**So that** the new tab tells me what to do instead of showing nothing

**Acceptance criteria:**

- Given a Generated UI tab already holds a composed surface, when I click `+`, then the
  new (now active) tab shows the idle placeholder identical to the zero-tab placeholder,
  with the composer still available.
- Given the new tab is showing the placeholder, when I submit an utterance, then the
  composed surface replaces the placeholder in that same tab (panel-tabs FR-012).
- Given the new tab's run errors, when the error lands, then the tab shows the error
  state, not the placeholder.

### Jira: new tab loads the my-tickets default view · P1

**As a** user in the Jira panel with at least one composed tab open
**I want to** click `+` and have the new tab load the my-tickets default board view
**So that** every Jira tab starts from the same useful default, not a blank panel

**Acceptance criteria:**

- Given a Jira tab already holds a surface, when I click `+`, then the new (now active)
  tab requests the my-tickets default view (one `window.cosmos.jira.requestDefaultView()`
  fetch) and shows a loading skeleton until the default board surface lands, then shows
  that board.
- Given that new Jira tab is loading its default view while another Jira tab already has
  a surface, when I view the loading tab, then it shows the skeleton (the loading state is
  correct PER TAB, not cleared by the other tab already having a surface).
- Given the new Jira tab's default-view read fails (rate-limited / network), when the
  recoverable Notice surface lands, then that tab shows the Notice (today's behavior),
  not an endless skeleton.
- Given a headless `AgentRunner` run is already in flight (a compose) when I click `+`,
  when the `+` fires, then the new tab does not hang: it shows the base/loading-or-Notice
  per the graceful-degradation rule below (see Edge Cases), and the panel remains usable.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.
> Every requirement traces to the user request (R) or refines a panel-tabs v1 FR.

### Base-on-uncomposed-tab (all four generative panels)

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | A generative panel MUST show its **base screen** whenever the active tab is empty/uncomposed — `activeTab` is null, OR (`activeTab.surface` is null AND `activeTab.error` is undefined) — not only when zero tabs are open. (R; refines panel-tabs FR-017/FR-018) |
| FR-002 | When the active tab has a **composed surface**, the panel MUST show that tab's surface (today's per-tab A2UI host), NOT the base. (R; preserves panel-tabs FR-019) |
| FR-003 | When the active tab has an **error**, the panel MUST show that tab's error state, NOT the base. (R; preserves panel-tabs FR-015) |
| FR-004 | The **composer** MUST remain available on an empty/uncomposed active tab, and submitting MUST fill that active tab (replacing the base), unchanged from panel-tabs FR-012/FR-016. (preserves panel-tabs FR-012/FR-016) |

### Native-base panels (Slack, Confluence)

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-005 | On an empty/uncomposed active tab, the Slack and Confluence panels MUST show their existing **native browser base** (Slack channel/search browser; Confluence search/page browser) — identical to the zero-tab base. (R; refines panel-tabs FR-017) |

### Idle-placeholder panel (Generated UI)

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-006 | On an empty/uncomposed active tab, the Generated UI panel MUST show its existing **idle placeholder** ("Describe a UI below and Claude will build it here.") — identical to the zero-tab placeholder. (R; refines panel-tabs FR-018) |

### Jira (generated default-view base)

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-007 | Jira has **no static native browser**; its base is the agent-generated my-tickets **default board view**. Opening a NEW Jira tab via `+` MUST request that default view for the newly opened tab — exactly **one** `window.cosmos.jira.requestDefaultView()` fetch per `+`. (SETTLED DECISION D1; refines panel-tabs FR-017) |
| FR-008 | While a Jira tab's default-view read is in flight (before its surface lands), that tab MUST show a **loading skeleton**. (D1) |
| FR-009 | The Jira default-view loading state MUST be tracked **per tab**: a new empty tab loading its default view MUST show the skeleton even while another Jira tab already has a surface. (R; the current panel-wide `loadingDefault` flag — cleared when ANY tab has a surface — is insufficient and MUST become per-tab.) |
| FR-010 | When a Jira tab's default-view read **fails** (rate-limited / network), the recoverable `Notice` surface that lands MUST replace the skeleton in that tab (it arrives as the tab's composed surface); the tab MUST NOT show an endless skeleton. (preserves §4.9 / Jira v2 FR-019) |

### Single-run guard / graceful degradation

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-011 | The Jira `+` default-view request MUST respect the single-run guard (§4.10) and the originating-tab correlation: if a headless `AgentRunner` run (a compose) is **in flight** when `+` is pressed, the `+` action MUST degrade gracefully — the new tab MUST NOT hang waiting forever for a default-view frame, MUST NOT steal the in-flight compose's frame, and the panel MUST remain usable. The new tab shows its base/skeleton and resolves once a default-view frame for it lands (or stays on the base/Notice). (R; preserves panel-tabs FR-027 and §4.11 sequential-runs invariant) |

### Scope guard

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-012 | This feature MUST be **renderer-only**: no new IPC channel, no main-process change, no new panel-tabs primitive. It MUST reuse the existing `window.cosmos.jira.requestDefaultView()` and the existing per-tab surface state (`GenerativeTab.surface` / `.error`). (R) |

## Edge Cases & Constraints

- **Empty tab vs in-flight tab vs errored tab.** Empty/uncomposed (no surface, no error)
  → base (FR-001/FR-005/FR-006/FR-007). In flight with no surface yet → base shown
  together with the tab's in-flight indicator (panel-tabs FR-014) — Jira shows its
  skeleton instead (FR-008). Errored → error state, never the base (FR-003).
- **`+` while a run is in flight (Jira).** The deterministic default-view read
  (`handleJiraDefaultView`) is NOT an `AgentRunner` run and does not consume the single-run
  guard. But its pushed frame is an UNSOLICITED `target: 'jira'` frame, and the shared hook
  files the next matching `ui:render` into the **originating** tab when a compose is in
  flight (`originatingTabIdRef` set), else into the **active** tab. So firing a default-view
  request while a compose is in flight risks the default-view frame being consumed by the
  composing tab (or the compose's frame landing in the wrong tab). The plan MUST resolve
  this so the new tab either gets its default view or remains on its base/skeleton without
  hanging, and the in-flight compose's frame still lands in its originating tab. See
  Open Question OQ-1 — the user has confirmed "degrade gracefully (deferred/ignored per the
  guard, tab shows the base/placeholder rather than hanging)"; the precise mechanism is a
  plan decision.
- **Closing a default-loading Jira tab.** Closing a Jira tab whose default-view fetch is
  still outstanding MUST not crash the panel; the unsolicited frame, if it arrives after
  the close, MUST follow today's behavior (lands in the active tab / auto-creates a tab per
  §4.11) and MUST NOT hang the panel. (preserves panel-tabs FR-027)
- **Switching away and back.** A tab that already composed a surface keeps it (panel-tabs
  FR-003); switching the rail away/back does not re-show the base for a composed tab and
  does not re-request a Jira default view for a tab that already has one.

**Explicitly out of scope (Non-Goals):**

- Any new IPC, main-process, or MCP change (FR-012).
- Any new panel-tabs primitive (`panelTabs.ts` / `usePanelTabs.ts` /
  `useGenerativePanelTabs.ts` shape changes beyond per-tab Jira loading state needed for
  FR-009).
- Changing the tab model, adjacency/close rules, labels, or overflow (panel-tabs v1).
- Adding a per-run id to `UiRenderPayload` / `AgentSubmitPayload` (the §4.11 sequential-run
  invariant stands; this spec does not introduce concurrent runs).
- Any change to what a composed surface does (integration scopes, Jira write path,
  read-only Slack/Confluence generative semantics).

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | In Confluence and Slack, clicking `+` (with a composed tab already open) shows the native browser base in the new tab, with the composer available — never a blank panel. |
| SC-002 | In Generated UI, clicking `+` shows the idle placeholder in the new tab — never a blank panel. |
| SC-003 | In Jira, clicking `+` triggers exactly one default-view fetch and the new tab shows a skeleton then the my-tickets board; a concurrent loading tab shows its skeleton even while another tab already has a surface. |
| SC-004 | An errored or composed active tab shows its error / surface respectively, never the base. |
| SC-005 | Clicking `+` while a run is in flight (Jira) leaves the panel usable: the new tab does not hang and the in-flight compose still lands in its originating tab. |
| SC-006 | The change is renderer-only — no IPC/main/MCP diff — and the existing typecheck + test suite stays green (the three already-done panels are covered by this spec). |

---

## Open Questions

- [x] **OQ-1 — `+` while a compose run is in flight (Jira): the exact mechanism — RESOLVED
  (defer-while-awaiting-a-frame).** A Jira `+` MUST request the default view for the new
  tab ONLY when no compose is currently awaiting a frame — i.e. the originating-tab
  correlation in `useGenerativePanelTabs.ts` is idle (`originatingTabIdRef` is null / no
  in-flight compose). If a compose IS in flight when `+` is pressed, the default-view
  request is DEFERRED: the new (now active) tab shows its base/idle state (not a stuck
  skeleton), and the default-view request fires once the in-flight run completes (observed
  via `agent:status` `completed`/`error`). The new tab MUST never hang. Rationale:
  `requestDefaultView()` is a deterministic main read that pushes an UNSOLICITED
  `target: 'jira'` frame; the hazard is purely the shared `originatingTabIdRef` slot (a
  solicited compose and an unsolicited default-view frame racing for the same correlation
  would swap the two surfaces), NOT the AgentRunner single-run guard. Deferring keeps the
  two frame kinds from racing for the correlation slot. Encoded as FR-011 (and the
  "Single-run guard / graceful degradation" requirements).
