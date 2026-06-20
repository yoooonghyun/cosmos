# Spec: Jira Ticket Detail (click-to-open) — v1

**Status**: Draft (revised 2026-06-20 — presentation changed from in-place view-swap to a right-side dock, #86)
**Created**: 2026-06-07
**Supersedes**: —
**Related plan**: .sdd/plans/jira-ticket-detail-v1.md

> Issue #86 (2026-06-20): change the ticket detail from a **whole-panel view-swap with a back row**
> to a **right-side detail dock that opens alongside the still-visible ticket list**, matching the
> shipped Slack thread side-dock and the calendar event-detail dock. This is a **presentation-only**
> revision: every detail-CONTENT requirement, the read-only deterministic read path, the no-new-scope
> /no-new-IPC posture, and per-tab scoping are unchanged. Only the mechanism FRs that described
> "replace the active tab's surface" + the "back to list" row are rewritten to the dock + dismiss
> idiom. Revised in place (not a v2) because the change is presentation-only on an already-shipped
> feature — the same call the calendar event-detail revision made.

---

## Grounding

> Direct investigation run by the architect for this revision (mandatory).

**codegraph_explore / codegraph_search:**

- `JiraPanel jiraCatalog ticket detail nav ActiveTabSurface onAction detail component` — returned the
  verbatim `JiraPanel`. **Takeaway:** today a clicked `TicketCard`/`IssueList` emits
  `JIRA_OPEN_DETAIL_ACTION`, intercepted in `handleSurfaceAction` (returns `true`, never forwarded);
  the panel flips a renderer-local `view: {kind:'list'} | {kind:'detail';issueKey}` state that swaps
  the WHOLE content region to a native `ChevronLeft` "Back to list" row over the A2UI host, and fires
  `jira:requestIssueDetail` whose unsolicited `target:'jira'` frame OVERWRITES the active tab's
  surface. `originListRef`/`backNavTarget` exist purely because that overwrite destroys the list (a
  `composed` surface is snapshotted to be restored on back). Reset on `activeTabId` change.
- `SlackPanel openThread SlackThreadPanel slackbody scrim onClose dock` (via the calendar spec/design
  grounding) — the canonical side-dock shell: a `@container/slackbody` two-pane body, dock side-by-side
  at `≥32rem` (`w-[clamp(18rem,42%,28rem)] shrink-0 border-l`), an absolute right-drawer
  (`max-w-[22rem] shadow-lg`) over a `bg-black/40` scrim below it, X-close + scrim dismiss, transient
  per-tab.

**memory_recall / memory_smart_search:**

- `Jira ticket detail nav overlay side-dock presentation`, `Jira generative UI detail nav overlay
  action binding` — empty store (no prior Jira detail decision persisted). Persisting this revision's
  dock decision via `memory_save`.

**Takeaways shaping this revision:**

1. The detail data is ALREADY the same surface a post-write re-push renders — no new fetch, no new
   field, no new scope is needed; only the presentation moves.
2. Moving to a dock that keeps the list **mounted beside** the detail **dissolves** the
   `composed`-surface-clobber problem the current overlay had: the detail no longer overwrites the
   tab's list surface, so the `backNavTarget`/snapshot-restore machinery (and the brief re-read on
   "back") is no longer needed — the dismiss just unmounts the dock and the untouched list is revealed.
   The detail is shown in a **native dock component fed by the read result**, not by overwriting the
   tab surface (a plan/how concern; flagged for the plan).

---

## Overview

In the connected Jira panel, clicking a ticket (a `TicketCard` in an `IssueList`) opens that
ticket's full detail in a **right-side detail dock that appears alongside the ticket list** within
the same panel tab — the list **stays visible** (NOT replaced) — showing the same detail content a
post-write re-push already renders: key, status, description, comments, transition control,
add-comment control. A **dismiss affordance** (a header close/X control, plus — in the narrow drawer
mode — a click-away scrim) closes the dock and returns the list to full width. This makes Jira
consistent with the shipped **Slack thread side-dock** and the **calendar event-detail dock** (same
two-pane `@container` shell). It reuses the existing deterministic Jira read/compose path — clicking a
ticket runs a native `jira:getIssue` read (NOT the AI agent) and never requires a new OAuth scope, a
new IPC channel, or a new fetch.

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open a ticket's detail by clicking it · P1

**As a** Jira user in cosmos
**I want to** click a ticket in the issue list
**So that** I can read its full detail (status, description, comments) alongside the list, without
losing the list

**Acceptance criteria:**

- Given a connected Jira panel showing an issue list (default view or a JQL search result), when I
  click a ticket card, then a detail dock opens on the **right side of the panel alongside the list**
  (same tab) showing that ticket's full detail (key + status, description, comments, transition
  control, add-comment control) — the same detail content a post-write re-push renders — and the
  **issue list stays visible** (not replaced).
- Given I clicked a ticket, when the detail read is in flight, then the panel shows a loading
  indication (the existing per-tab loading state) until the detail lands; the still-visible list is
  not disturbed.
- Given a detail dock is open, when I click a different ticket card, then the **single dock retargets**
  to that ticket (it does not stack a second dock).
- Given a ticket detail dock is open, when I apply a transition or add a comment (the existing
  deterministic `jira.*` write path), then the post-write re-pushed detail still appears in the dock
  and the dock and its dismiss affordance remain available afterward.

### Dismiss the detail dock · P1

**As a** Jira user viewing a ticket detail dock
**I want to** dismiss the dock
**So that** I return to the full issue list I was browsing

**Acceptance criteria:**

- Given a ticket detail dock is open, when I activate its close/X control, then the dock closes and
  the issue list returns to full width exactly as it was (same list — default view or the search
  result I was on — same scroll, **no re-fetch**).
- Given the panel is narrow and the dock is showing as a right-drawer overlay with a scrim, when I
  click the scrim (click-away), then the dock closes and the underlying list is shown in full.

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
| FR-002 | Clicking a ticket MUST open that ticket's detail in a **right-side detail dock alongside the issue list** within the same panel tab — the issue list MUST remain visible (not replaced) — not in a new tab, separate window, or whole-app view. The dock MUST reuse the project's existing side-dock pattern (the shipped Slack thread dock / calendar event-detail dock: a `@container`-gated two-pane body — side-by-side when the panel is wide enough, an absolute right-drawer overlay with a scrim when it is narrow). A clicked ticket while a dock is open MUST **re-target** the single dock to that ticket rather than open a second dock. (Traces: "Open a ticket's detail by clicking it"; #86 presentation revision — alignment with the shipped Slack/calendar side-docks.) |
| FR-003 | Opening the detail MUST run a native, deterministic `jira:getIssue` read for the clicked `issueKey` and compose the result through `JiraSurfaceBuilder.buildIssueDetailSurface` (the existing detail surface — key/status, description, comments, transition + add-comment controls), pushed with `target: 'jira'`. It MUST NOT invoke the AI agent / `AgentRunner`. (Traces: read-only scenario; reuses the deterministic re-read path the post-write dispatcher already uses.) |
| FR-004 | The detail dock MUST present a **dismiss affordance** — a close/X control in the dock header (always available) and, in the narrow drawer mode, a click-away scrim — that closes the dock and returns the issue list to full width. (Traces: "Dismiss the detail dock"; Slack/calendar dock dismiss precedent.) |
| FR-005 | Dismissing the dock MUST return the issue list **as it was** — the same list the detail was opened from (default view or the prior JQL search result), with no re-fetch and no surface round-trip — because the list stayed mounted beside the dock. (Traces: "Dismiss the detail dock". Replaces the v1 "back re-runs the originating read"; the dock keeps the list visible so no restore/re-read is needed.) |
| FR-006 | While the detail read is outstanding, the panel MUST show the existing per-tab loading indication (`GenerativeTab.loadingDefault`), cleared when the detail (or a Notice) lands; the still-visible issue list MUST NOT be disturbed by the in-flight read. (Traces: in-flight acceptance criterion; reuses the §4.9 default-view/search loading state.) |
| FR-007 | A detail read that fails with a non-`reconnect_needed` kind MUST surface as a single recoverable `Notice` in the active tab (via the existing `buildNoticeSurface` path); the panel MUST NOT crash. (Traces: "Detail read fails calmly".) |
| FR-008 | A detail read that fails with `reconnect_needed` / `not_connected` MUST push no surface; the `JiraManager`'s `statusChanged` routes the panel to the native Connect/Reconnect affordance. (Traces: "Detail read fails calmly"; FR-016 carry-over.) |
| FR-009 | The open-detail request MUST integrate with the existing fire-or-defer discipline so its UNSOLICITED `target:'jira'` frame never races an in-flight NL compose for the shared `originatingTabIdRef` slot: fire immediately when the correlation is idle, otherwise defer and flush when the in-flight run resolves (§4.11). (Traces: "Click does not disturb an in-flight compose".) |
| FR-010 | The open-detail operation MUST be read-only: it requires no new OAuth scope and adds no write path. The renderer MUST send only the issue-key operation over IPC; main attaches the token. No token/secret may appear on any IPC payload, type, or A2UI surface (cosmos-wide token-in-main-only invariant). (Traces: "Stay read-only".) |
| FR-011 | Any new IPC payload MUST be validated at the main-process boundary; an invalid or empty-`issueKey` payload MUST be warned-and-ignored (never crash) — consistent with all cosmos IPC. (Traces: edge cases; cosmos IPC invariant §4.5.) |
| FR-012 | The existing deterministic `jira.*` write path on the detail (transition, comment) MUST continue to work unchanged: a write from the opened detail still re-pushes the fresh detail, the dock stays open showing it, and the dock's dismiss affordance MUST remain available afterward. (Traces: "Open a ticket's detail" final acceptance criterion; §4.9 write re-push.) |
| FR-013 | The existing NL `PromptComposer` and the native JQL search box MUST remain present and behave unchanged alongside this feature. (Traces: non-regression of §4.9 Jira panel surfaces.) |
| FR-014 | An open detail dock MUST be scoped to the tab it was opened in and MUST reset (close) on a tab switch, so it never bleeds across tabs; if the connection drops (`disconnect`/`reconnect_needed`) while a dock is open, the dock MUST close cleanly and the panel returns to its Connect/Reconnect affordance. (Traces: per-tab nav scoping; the Slack/calendar docks are likewise transient and per-tab.) |

## Edge Cases & Constraints

- **Ticket with no/empty key** → the card is not actionable / the open-detail request is
  warned-and-ignored at the IPC boundary (FR-011); the panel does not crash. (`TicketCard.issueKey`
  is optional and may render as "—".)
- **`getIssue` error (`network`/`rate_limited`)** → a single recoverable `Notice` in the active tab
  (FR-007); the user can go back to the list and retry.
- **`reconnect_needed` / `not_connected` mid-click** → push nothing; native Connect/Reconnect takes
  over via `statusChanged` (FR-008). An open dock closes cleanly (FR-014).
- **Click while an NL compose is awaiting its frame** → the detail request is fired-or-deferred
  against the shared correlation slot (FR-009).
- **Connection drops while a dock is open** → the dock is transient: on `disconnect`/`reconnect_needed`
  it resets to closed and the panel returns to its Connect/Reconnect affordance — no stuck or crashing
  dock (FR-014).
- **Tab switch while a dock is open** → the dock is per-tab; switching tabs closes it and the other
  tab shows its own list with no dock; switching back shows the list (FR-014).
- **Dock retarget after a post-write re-push** → a `jira.*` write re-pushes the fresh detail; the dock
  stays open showing it with its dismiss affordance intact (FR-012).
- **Narrow panel** → when the panel is too narrow for a side-by-side dock, the detail presents as an
  absolute right-drawer overlay (with a click-away scrim) over the list rather than squeezing the
  list into illegibility — matching the Slack/calendar dock's `@container`-gated drawer fallback.
- **Long detail content (many comments / long description)** → the dock MUST scroll **within the dock**
  rather than overflow it or the panel; very long content MUST NOT break the side-by-side layout or
  push the list.
- **Clicking a ticket from inside a detail** → a `JiraIssueDetail` carries no nested ticket list, so
  there is no ticket-in-detail click to handle; out of scope.
- **Out of scope:** opening detail in a NEW tab (explicitly rejected); a multi-level navigation stack
  or forward/redo (single transient dock only); deep-linking to a ticket by URL; pagination inside the
  detail's comment list; any new write capability; routing the click through the AI agent.

## Success Criteria

| ID     | Criterion                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| SC-001 | Clicking a ticket in a connected Jira panel opens that ticket's full detail (key/status, description, comments, transition + add-comment controls) in a right-side dock **alongside the still-visible issue list**; clicking another ticket re-targets the single dock. |
| SC-002 | The detail dock shows a dismiss affordance (header X always; click-away scrim in narrow drawer mode); dismissing it returns the issue list to full width as it was (default view or the prior search result), with no re-fetch. |
| SC-003 | Opening a ticket detail runs a read-only `jira:getIssue` (no agent run, no new OAuth scope) and exposes no token/secret on any payload or surface. |
| SC-004 | A failed detail read (non-reconnect) yields a calm recoverable Notice in the active tab; the app never crashes; the user can return to the list and retry. A reconnect-needed failure routes to the native Connect/Reconnect and pushes no surface. |
| SC-005 | A ticket clicked while an NL compose is awaiting its frame does not corrupt either result (the detail frame is fired-or-deferred per the existing correlation discipline). |
| SC-006 | A `jira.*` write performed on an opened detail still re-pushes the fresh detail into the dock, and the dock + its dismiss affordance remain available afterward. |
| SC-007 | An open detail dock stays in its tab: switching tabs shows no dock bleed and switching back shows the list (the dock having closed on the switch); a connection drop closes the dock cleanly. |

---

## Open Questions

> The #86 revision retires the v1 "back to list" open questions (OQ-1 restore-exactness, OQ-2
> back-affordance carrier): with the dock the list stays mounted beside the detail, so there is no
> restore/re-read and no back-row to carry — dismissing the dock simply reveals the untouched list.
> The remaining questions are dock-styling parity, each with a default adopted from the calendar/Slack
> docks; none blocks the plan.

- [ ] **OQ-1 — Dock width & breakpoint.** The dock SHOULD reuse the Slack/calendar dock's proven
  sizing: side-by-side at/above the `@container` `32rem` threshold with the dock at
  `clamp(18rem, 42%, 28rem)` and `shrink-0` `border-l`; below the threshold an absolute right-drawer
  overlay at `w-full max-w-[22rem]` with `shadow-lg` over a `bg-black/40` scrim. These are the
  cross-panel-consistent defaults — adopted unless the designer step tunes them to the Jira list's
  density. **No user decision required.**
- [ ] **OQ-2 — Dismiss affordance.** v1 dismisses the dock via a **close/X control** in the dock
  header (always available) plus the **narrow-mode click-away scrim** (mirroring Slack/calendar).
  Esc-to-close is OPTIONAL and MAY be added for keyboard parity but is not required. Default: X +
  scrim. **No user decision required.**

> No open question blocks implementation; each carries a safe default reused from the shipped docks.
