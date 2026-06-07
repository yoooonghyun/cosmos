# Spec: Jira JQL Search Box — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: .sdd/plans/jira-jql-search-v1.md

---

## Overview

Add a native, deterministic JQL search box to the connected Jira rail panel, mirroring the
Confluence panel's native search box. The box's placeholder is the my-tickets JQL
(`assignee = currentUser() ORDER BY updated DESC`); submitting a JQL string runs a native
`jira:searchIssues` read and re-composes the active tab's Jira A2UI surface through the existing
deterministic surface builder. An empty submit returns to the my-tickets default view. The
existing generative natural-language `PromptComposer` ("Ask about your Jira issues…") is kept and
sits alongside the new box. The search path never routes through the AI agent.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Filter my Jira tickets with a JQL query · P1

**As a** Jira user in cosmos
**I want to** type a JQL query into a native search box on the Jira panel
**So that** I can filter the issue list deterministically without asking the agent

**Acceptance criteria:**

- Given the Jira panel is connected, when I look at the panel, then a search box is visible whose
  placeholder text is `assignee = currentUser() ORDER BY updated DESC`.
- Given I type a valid JQL string and submit, then the panel runs a native `jira:searchIssues`
  read for that JQL and replaces the active tab's surface with the resulting issue list
  (the same `IssueList` A2UI surface the default view uses).
- Given the search read is in flight, when I look at the active tab, then a loading skeleton is
  shown until the result lands.
- Given the search returns zero issues, then the active tab shows the catalog's "No issues found."
  empty state (no crash, no error).

### Clear the filter back to my tickets · P1

**As a** Jira user
**I want to** submit an empty search box
**So that** the panel returns to my recently-updated tickets (the default view)

**Acceptance criteria:**

- Given the search box is empty (or whitespace only), when I submit it, then the panel runs the
  my-tickets default-view JQL (`assignee = currentUser() ORDER BY updated DESC`) and the active
  tab shows that default issue list — identical to the per-tab default view.

### Keep asking the agent in natural language · P1

**As a** Jira user
**I want to** still have the "Ask about your Jira issues…" composer
**So that** I can choose between a deterministic JQL filter and a generative NL request

**Acceptance criteria:**

- Given the Jira panel is connected, when I look at the panel, then both the native JQL search box
  and the NL `PromptComposer` are present, with unchanged NL composer behavior (Enter to send,
  Shift+Enter newline, empty no-op, generative run via `AgentRunner`).

### Invalid JQL fails calmly · P2

**As a** Jira user
**I want to** submit a malformed JQL string without breaking the panel
**So that** I can correct it and try again

**Acceptance criteria:**

- Given I submit a JQL string Jira rejects (e.g. a 400), when the read fails with a non-reconnect
  error, then the active tab shows a single calm, recoverable `Notice` (never a crash, never a
  raw stack trace), and I can edit the box and resubmit.

## Functional Requirements

> Every requirement traces to a scenario above or an established architecture decision (§4.9/§4.11).

| ID     | Requirement                                                                                                                                                                                                 |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The connected Jira panel MUST render a native search box (an `<Input>` inside a `<form>`), placed in the panel chrome like the Confluence panel's search box.                                               |
| FR-002 | The search box placeholder MUST be the exact my-tickets JQL string `assignee = currentUser() ORDER BY updated DESC` (the existing `JIRA_DEFAULT_VIEW_JQL`). Visual truncation of the long placeholder is acceptable. |
| FR-003 | Submitting a non-empty JQL string MUST run a native, deterministic `jira:searchIssues` read for that JQL (NOT an `AgentRunner` run, NOT the agent), compose the result through `JiraSurfaceBuilder` (the same `IssueList` surface as the default view), and push it with `target: 'jira'`. |
| FR-004 | The search result surface MUST replace the surface of the ACTIVE tab (it is a filter of the current view). If there is no active tab / zero tabs, one MUST be auto-created to hold it (the existing unsolicited-frame behavior of `useGenerativePanelTabs`). |
| FR-005 | Submitting an empty or whitespace-only search box MUST run the my-tickets default-view JQL (`JIRA_DEFAULT_VIEW_JQL`) and land the default issue list in the active tab — behaviorally identical to `requestDefaultView`. |
| FR-006 | While a search read is outstanding, the active tab MUST show the per-tab default-view loading skeleton (the existing `GenerativeTab.loadingDefault` state), cleared when the surface (or a Notice) lands. |
| FR-007 | A search read that fails with a non-`reconnect_needed` kind (e.g. invalid JQL → 400 → `network`, or `rate_limited`) MUST surface as a single recoverable `Notice` in the active tab via `buildNoticeSurface`; the panel MUST NOT crash. |
| FR-008 | A search read that fails with `reconnect_needed` / `not_connected` MUST push no surface; the `JiraManager`'s `statusChanged` already routes the panel to the native Connect/Reconnect affordance (FR-016 carry-over). |
| FR-009 | The search request MUST integrate with the existing fire-or-defer discipline so its UNSOLICITED `target:'jira'` frame never races an in-flight NL compose for the shared `originatingTabIdRef` slot: fire immediately when correlation is idle, otherwise defer and flush when the in-flight run resolves (the §4.11 single-slot discipline). |
| FR-010 | The existing NL `PromptComposer` MUST remain present and unchanged, alongside the new search box. |
| FR-011 | The search operation MUST be read-only: it requires no new OAuth scope and adds no write path. The renderer MUST send only the JQL operation over IPC; main attaches the token. No token/secret may appear on any IPC payload, type, or A2UI surface (cosmos-wide token-in-main-only invariant). |
| FR-012 | The new IPC payload MUST be validated at the main-process boundary; an invalid payload MUST be warned-and-ignored (never crash) — consistent with all cosmos IPC. |

## Edge Cases & Constraints

- **Empty / whitespace submit** → default-view JQL (FR-005), same as `requestDefaultView`.
- **Invalid JQL** (Jira 400) → a single recoverable `Notice` in the active tab (FR-007), not a crash.
- **Reconnect mid-search** (token rejected during the read) → `reconnect_needed`; push nothing,
  native Connect/Reconnect takes over via `statusChanged` (FR-008).
- **In-flight NL compose race** → the search's unsolicited frame is fired-or-deferred against the
  shared correlation slot (FR-009); it never overwrites an awaited compose frame.
- **Zero tabs / no active tab at submit** → auto-create a tab to hold the result (FR-004).
- **Long placeholder** → may visually truncate inside the box; acceptable (FR-002).
- **Out of scope:** pagination / "Load more" on the search result (the default-view surface is a
  single bounded page today and stays so); routing the JQL through the agent; any Jira write from
  the search box; persisting/recalling past queries; a Jira equivalent of Confluence's page-detail
  drill-in (the Jira surface drill-in is the existing catalog behavior, unchanged); de-bounced
  live-as-you-type search (submit-driven only, like Confluence).

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | A connected Jira panel shows the native search box with the my-tickets JQL placeholder and the NL composer side by side. |
| SC-002 | Submitting a valid JQL replaces the active tab's surface with the matching issue list; an empty submit returns the my-tickets default view. |
| SC-003 | An invalid JQL yields a calm recoverable Notice in the active tab; the app never crashes and the box is editable for a retry. |
| SC-004 | A search submitted while an NL compose is awaiting its frame does not corrupt either result (the search frame is deferred and flushed on resolution). |
| SC-005 | No token or secret appears on the new IPC payload, the new types, or any rendered surface; the feature adds no OAuth scope. |

---

## Open Questions

- None. All decisions called out in the approved intent are resolved above (result lands in the
  active tab; the in-flight race reuses the existing fire-or-defer seam; empty submit ⇒ default
  view; invalid JQL ⇒ Notice; placeholder = `JIRA_DEFAULT_VIEW_JQL`; NL composer kept).
