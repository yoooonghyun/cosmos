# Spec: Jira Ticket Detail (click-to-open) — v1

**Status**: Draft
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: .sdd/plans/jira-ticket-detail-v1.md

---

## Overview

In the connected Jira panel, clicking a ticket (a `TicketCard` in an `IssueList`) opens that
ticket's full detail **in place in the active tab** — the list surface is replaced by the ticket's
detail (the same detail surface a post-write re-push already shows: key, status, description,
comments, transition control, add-comment control). A **"back to list" affordance** returns the tab
to the list it came from. This mirrors the Confluence panel's search-result → page-detail drill-in
with a back arrow, and reuses the existing deterministic Jira read/compose/push path — clicking a
ticket runs a native `jira:getIssue` read (NOT the AI agent) and never requires a new OAuth scope.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open a ticket's detail by clicking it · P1

**As a** Jira user in cosmos
**I want to** click a ticket in the issue list
**So that** I can read its full detail (status, description, comments) and act on it

**Acceptance criteria:**

- Given a connected Jira panel showing an issue list (default view or a JQL search result), when I
  click a ticket card, then the active tab's surface is replaced by that ticket's full detail
  surface (key + status, description, comments, transition control, add-comment control) — the same
  detail surface shape a post-write re-push renders.
- Given I clicked a ticket, when the detail read is in flight, then the active tab shows a loading
  indication (the existing per-tab loading state) until the detail lands.
- Given the detail is shown, when I look at it, then a clear "back to list" affordance (e.g.
  "← Back to list") is visible.
- Given a ticket detail is open, when I apply a transition or add a comment (the existing
  deterministic `jira.*` write path), then the post-write re-pushed detail still appears in the
  same tab and the back-to-list affordance is still available afterward.

### Return to the list with "back" · P1

**As a** Jira user viewing a ticket detail
**I want to** click "back to list"
**So that** I return to the issue list I was browsing

**Acceptance criteria:**

- Given I opened a ticket detail from the default view, when I click "back to list", then the active
  tab shows the default-view issue list again.
- Given I opened a ticket detail from a JQL search result, when I click "back to list", then the
  active tab shows that search result's issue list again (the list I clicked from, not the default
  view) — see Open Question OQ-1 on exactness of restore.

### Stay read-only · P1

**As a** Jira user
**I want to** click a ticket without granting new permissions
**So that** browsing detail is safe and requires no reconnect

**Acceptance criteria:**

- Given a connected Jira panel, when I click a ticket to open its detail, then no new OAuth scope is
  required, the click runs a read-only `jira:getIssue` (not a write, not an `AgentRunner` run), and
  no token/secret appears on any IPC payload or rendered surface.

### Detail read fails calmly · P2

**As a** Jira user
**I want to** click a ticket whose detail read fails
**So that** I see a recoverable message instead of a broken panel

**Acceptance criteria:**

- Given I click a ticket and the `jira:getIssue` read fails with a non-`reconnect_needed` kind
  (e.g. `network`, `rate_limited`), then the active tab shows a single calm, recoverable `Notice`
  (never a crash, never a raw stack trace), and I can go back to the list and retry.
- Given the read fails with `reconnect_needed` / `not_connected`, then no surface is pushed and the
  native Connect/Reconnect affordance takes over via `statusChanged` (the existing FR-016 carry-over
  behavior).

### Click does not disturb an in-flight compose · P2

**As a** Jira user
**I want to** click a ticket while a natural-language compose is generating
**So that** neither result is corrupted

**Acceptance criteria:**

- Given an NL compose is awaiting its render frame for this panel, when I click a ticket, then the
  ticket-detail surface does not overwrite or race the awaited compose frame — the detail request is
  ordered against the in-flight compose using the existing fire-or-defer correlation discipline.

## Functional Requirements

> Every requirement traces to a scenario above or an established architecture decision (§4.9/§4.11).

| ID     | Requirement                                                                                                                                                                                                               |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | A `TicketCard` in the Jira panel's `IssueList` MUST be clickable (it is currently display-only). Clicking it MUST carry the card's `issueKey` to the open-detail action. (Traces: "Open a ticket's detail by clicking it".) |
| FR-002 | Clicking a ticket MUST open that ticket's detail **in place in the active tab** — replacing the active tab's current surface with the detail surface. It MUST NOT open a new tab. (Traces: settled product decision; mirrors Confluence in-place drill-in.) |
| FR-003 | Opening the detail MUST run a native, deterministic `jira:getIssue` read for the clicked `issueKey` and compose the result through `JiraSurfaceBuilder.buildIssueDetailSurface` (the existing detail surface — key/status, description, comments, transition + add-comment controls), pushed with `target: 'jira'`. It MUST NOT invoke the AI agent / `AgentRunner`. (Traces: read-only scenario; reuses the deterministic re-read path the post-write dispatcher already uses.) |
| FR-004 | The detail surface MUST present a visible **"back to list"** affordance that returns the active tab to the list it was opened from. (Traces: "Return to the list with back"; settled product decision.) |
| FR-005 | "Back to list" MUST restore the list the detail was opened from: the default view if opened from the default view, or the prior JQL search result if opened from a search result — without requiring the user to re-type a query. (Traces: "Return to the list with back". See OQ-1 for exactness/freshness of the restored list.) |
| FR-006 | While the detail read is outstanding, the active tab MUST show the existing per-tab loading indication (`GenerativeTab.loadingDefault`), cleared when the detail surface (or a Notice) lands. (Traces: in-flight acceptance criterion; reuses the §4.9 default-view/search loading state.) |
| FR-007 | A detail read that fails with a non-`reconnect_needed` kind MUST surface as a single recoverable `Notice` in the active tab (via the existing `buildNoticeSurface` path); the panel MUST NOT crash. (Traces: "Detail read fails calmly".) |
| FR-008 | A detail read that fails with `reconnect_needed` / `not_connected` MUST push no surface; the `JiraManager`'s `statusChanged` routes the panel to the native Connect/Reconnect affordance. (Traces: "Detail read fails calmly"; FR-016 carry-over.) |
| FR-009 | The open-detail request MUST integrate with the existing fire-or-defer discipline so its UNSOLICITED `target:'jira'` frame never races an in-flight NL compose for the shared `originatingTabIdRef` slot: fire immediately when the correlation is idle, otherwise defer and flush when the in-flight run resolves (§4.11). (Traces: "Click does not disturb an in-flight compose".) |
| FR-010 | The open-detail operation MUST be read-only: it requires no new OAuth scope and adds no write path. The renderer MUST send only the issue-key operation over IPC; main attaches the token. No token/secret may appear on any IPC payload, type, or A2UI surface (cosmos-wide token-in-main-only invariant). (Traces: "Stay read-only".) |
| FR-011 | Any new IPC payload MUST be validated at the main-process boundary; an invalid or empty-`issueKey` payload MUST be warned-and-ignored (never crash) — consistent with all cosmos IPC. (Traces: edge cases; cosmos IPC invariant §4.5.) |
| FR-012 | The existing deterministic `jira.*` write path on the detail (transition, comment) MUST continue to work unchanged: a write from the opened detail still re-pushes a fresh detail surface into the same tab, and the back-to-list affordance MUST remain available on the re-pushed detail. (Traces: "Open a ticket's detail" final acceptance criterion; §4.9 write re-push.) |
| FR-013 | The existing NL `PromptComposer` and the native JQL search box MUST remain present and behave unchanged alongside this feature. (Traces: non-regression of §4.9 Jira panel surfaces.) |

## Edge Cases & Constraints

- **Ticket with no/empty key** → the card is not actionable / the open-detail request is
  warned-and-ignored at the IPC boundary (FR-011); the panel does not crash. (`TicketCard.issueKey`
  is optional and may render as "—".)
- **`getIssue` error (`network`/`rate_limited`)** → a single recoverable `Notice` in the active tab
  (FR-007); the user can go back to the list and retry.
- **`reconnect_needed` / `not_connected` mid-click** → push nothing; native Connect/Reconnect takes
  over via `statusChanged` (FR-008).
- **Click while an NL compose is awaiting its frame** → the detail request is fired-or-deferred
  against the shared correlation slot (FR-009); it never overwrites an awaited compose frame.
- **Back-to-list when there is no prior list** (the tab's first surface was a detail with no
  preceding list — e.g. a fresh tab where a detail landed first, or after the prior list state was
  lost) → see OQ-1: the spec requires "back" to never strand the user on the detail with nowhere to
  go; the fallback is the default view. The affordance MUST always lead somewhere (never a dead end).
- **Back-to-list after a post-write re-push** → the re-pushed detail still carries the back
  affordance (FR-012); "back" returns to the same originating list as the pre-write detail did.
- **Clicking a ticket from inside a detail** → a `JiraIssueDetail` carries no nested ticket list
  in its `comments`/controls, so there is no ticket-in-detail click to handle; this is out of scope
  (no list-within-detail exists in the current detail surface).
- **Out of scope:** opening detail in a NEW tab (explicitly rejected — in-place only); a
  forward/redo navigation or a multi-level navigation stack (single back-to-list only); deep-linking
  to a ticket by URL; pagination inside the detail's comment list; any new write capability; routing
  the click through the AI agent.

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | Clicking a ticket in a connected Jira panel replaces the active tab's surface with that ticket's full detail (key/status, description, comments, transition + add-comment controls). |
| SC-002 | The detail surface shows a "back to list" affordance; activating it returns the active tab to the list the detail was opened from (default view or the prior search result). |
| SC-003 | Opening a ticket detail runs a read-only `jira:getIssue` (no agent run, no new OAuth scope) and exposes no token/secret on any payload or surface. |
| SC-004 | A failed detail read (non-reconnect) yields a calm recoverable Notice in the active tab; the app never crashes; the user can return to the list and retry. A reconnect-needed failure routes to the native Connect/Reconnect and pushes no surface. |
| SC-005 | A ticket clicked while an NL compose is awaiting its frame does not corrupt either result (the detail frame is fired-or-deferred per the existing correlation discipline). |
| SC-006 | A `jira.*` write performed on an opened detail still re-pushes a fresh detail into the same tab, and back-to-list remains available afterward. |

---

## Open Questions

- [ ] **OQ-1 — Exactness and freshness of the restored list on "back to list".** The settled
  product decision is "return to the previous list" without re-typing. The clean, consistent options
  the plan must choose between (a plan/how concern, but the *behavioral* choice affects acceptance):
  1. **Re-run the originating read** on back (re-issue the default-view JQL or the last search JQL via
     the existing `jira:requestDefaultView` / `jira:requestSearchView` path). Pro: always lands on a
     valid, fresh list and naturally handles the "no captured list" fallback (default view); reuses
     existing channels with no new state. Con: the list is re-fetched (a brief reload) and may differ
     from what the user clicked from if data changed.
  2. **Restore the captured prior list surface** held in the tab (no re-fetch). Pro: instant, shows
     exactly what the user left. Con: requires the tab to retain the pre-detail surface (the renderer
     currently keeps only one `GenerativeTab.surface`), and needs a defined fallback when no prior
     list was captured.

  Both satisfy the user-visible requirement (FR-004/FR-005) and the no-dead-end constraint (back
  falls back to the default view when no originating list is known). **Recommendation:** option (1)
  (re-run the originating read), because it reuses the established deterministic read/compose/push
  channels, needs no new renderer surface-history state, and the default-view fallback is free. This
  is flagged (not assumed) because it is the one decision the intent did not fully pin down; if the
  user wants an instant no-refetch restore, the plan takes option (2). **This does not block writing
  the plan** — the recommendation is actionable; confirm only if the user prefers (2).

- [ ] **OQ-2 — Surface-builder back affordance carrier.** The "back to list" control is a new
  affordance on the detail surface; whether it is a new catalog component, a prop on the existing
  detail composition, or panel chrome above the A2UI host (paralleling Confluence's native back
  arrow row outside the A2UI surface) is an implementation choice for the plan/design, not a
  behavioral one. Noted here only so the plan resolves it; it does not block the spec.
