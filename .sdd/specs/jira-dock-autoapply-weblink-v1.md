# Spec: Jira ticket dock — auto-apply status + ticket web link — v1

**Status**: Draft
**Created**: 2026-06-21
**Supersedes**: —
**Related plan**: .sdd/plans/jira-dock-autoapply-weblink-v1.md (to follow)

---

## Grounding

Direct investigation performed for this spec (tools run by the architect):

**codegraph_explore**
- `jiraCatalog components.tsx logic.ts status transition dropdown Apply handler action binding` → found the `TransitionPicker` (Select + **Apply** button; `useFormBinding` for `transitionId`; `apply()` dispatches `JiraBoundAction.Transition`) and `isTransitionSubmittable` guard.
- `TransitionPickerNode JiraPanel onAction jira.transition dispatch JiraIssueDetail issueKey site baseUrl` → confirmed `TransitionPicker` props bind `issueKey` + `availableTransitions` to `{path}` into the bound issue; `JiraPanel.handleSurfaceAction` only intercepts the renderer-local `JIRA_OPEN_DETAIL_ACTION` and lets `jira.*` writes fall through to main; a re-pushed detail frame lands back in the dock slot (`onUnsolicitedFrame` → `isDetailSurfaceSpec`).
- `confluenceWebUrl joinBaseAndWebui setWindowOpenHandler shell.openExternal confluence title link` → the established external-link idiom: main assembles a non-secret `webUrl` (returns `undefined` to omit), the renderer re-validates `http(s)` and renders an anchor.
- `PageDetail webUrl ExternalLink … confluenceCatalog components.tsx` → `PageDetailTitle` is the exact link affordance to mirror: `<a href target="_blank" rel="noreferrer">` + `<ExternalLink>` icon, gated by `isOpenableWebUrl`, plain text when absent.
- `jiraSurfaceBuilder buildBoundIssueDetailSurface TransitionPicker TicketCard root` → the dock's detail surface: header is a `TicketCard` bound to the whole issue at `JIRA_DETAIL_PATH`; `TransitionPicker` bound to `…/key` + `…/availableTransitions`. The ticket KEY shows in the `TicketCard` header `Badge`.
- `JiraIssueDetail interface fields … jiraManager getIssue auth cloudId` → `JiraIssueDetail` has NO `webUrl`/site field today; `JiraClient.getIssue` builds it from `…/ex/jira/{cloudId}` (an API host, NOT browsable); `jiraApiBase` confirms the API base.
- `siteUrl` grep (`src/main`) → the stored token set's `extra.siteUrl` (e.g. `https://acme.atlassian.net`, captured from OAuth `accessible-resources`) IS already persisted and read in main — this is the browse-URL host.

**ARCHITECTURE.md** (Deterministic Jira action binding) → `jira.transition` is intercepted in **main** at `ui:action`, executed by `JiraActionDispatcher` **without re-invoking claude**, then the issue is **re-read** and the detail surface **re-pushed with a fresh `requestId` + notice**. So the displayed status after a transition is a **confirmed server re-read**, never optimistic.

**memory_recall / memory_smart_search** (`Jira generative-UI direction … #86 dock`, `transition apply confluence weblink`) → no prior stored observations returned (empty); the Jira generative-UI direction (deterministic action binding + `write:jira-work`) is confirmed from ARCHITECTURE.md and the code above instead. The settled decisions for THIS feature were persisted with `memory_save` during this pass.

---

## Overview

Two refinements to the existing Jira ticket-detail side-dock (built in jira-ticket-detail-v1, #86):
(1) changing a ticket's status applies the moment a value is picked in the status dropdown — the
separate "Apply" button is removed; and (2) the ticket key shown in the dock becomes a link that
opens that ticket's Jira web page, with an external-link icon affordance. Both keep the existing
deterministic, secret-free Jira write/read model unchanged.

## User Scenarios

### Apply a status change by selecting it · P1

**As a** cosmos user viewing a ticket in the Jira detail dock
**I want to** change the ticket's status by simply picking the new status in the dropdown
**So that** I move a ticket without the extra step of pressing an Apply button

**Acceptance criteria:**

- Given the dock is open on a ticket with available transitions, when I open the status dropdown and select a status different from the placeholder, then the transition is applied immediately with no further click.
- Given a transition is in flight, when I look at the dropdown, then it is in a disabled/busy state and shows that the change is being applied, so I cannot pick a second status until it settles.
- Given the transition succeeds, when it settles, then the dock re-renders the ticket showing its new (server-confirmed) status, and no Apply button is present anywhere in the picker.
- Given the transition fails (e.g. stale/invalid transition, network), when it settles, then the dock shows a recoverable error notice and the ticket's status remains its prior value (the dropdown does not falsely show the not-applied target).
- Given I rapidly attempt to change the status twice, when the first change is still in flight, then only one transition is dispatched (the second selection is prevented until the first settles).

### Open the ticket's Jira web page from the dock · P1

**As a** cosmos user viewing a ticket in the dock
**I want to** click the ticket key to open that ticket in its Jira web page
**So that** I can jump to the full ticket in Jira when I need the browser

**Acceptance criteria:**

- Given the dock is open on a ticket whose web URL can be built, when I view the ticket key in the dock header, then it is presented as a link with a visible external-link icon affordance beside it.
- Given the ticket-key link is present, when I activate it, then that ticket's Jira web page opens in the system browser (a new browser context, not inside the cosmos app window).
- Given the ticket's web URL cannot be built (no site URL available, or it is not an absolute `http(s)` URL), when I view the dock header, then the ticket key renders as plain non-interactive text with no icon and no broken link.

### Keyboard and assistive-tech access · P2

**As a** keyboard / screen-reader user
**I want to** the ticket-key link and status dropdown to be reachable and labelled
**So that** the dock's new affordances are usable without a mouse

**Acceptance criteria:**

- Given the ticket-key link is present, when I navigate by keyboard, then it is focusable, has a visible focus ring consistent with the cosmos design system, and exposes an accessible name conveying it opens the ticket in Jira.
- Given the status dropdown, when a transition is in flight, then its busy/disabled state is conveyed to assistive tech (not by color alone).

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

### Auto-apply status transition

| ID     | Requirement                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The status picker in the ticket-detail dock MUST apply the selected transition immediately upon selection of a valid (non-placeholder) status; there MUST be no separate Apply button. |
| FR-002 | Selecting a transition MUST dispatch exactly the existing deterministic `jira.transition` bound write carrying the issue key and the selected transition id — the action contract and the main-side write path are UNCHANGED. |
| FR-003 | While a dispatched transition is in flight, the picker MUST be disabled and present a busy/loading state, and MUST prevent dispatching a second transition until the first settles (no double-dispatch). |
| FR-004 | The displayed status after a transition MUST reflect the server-confirmed value obtained by main's re-read + detail re-push (confirmed update), NOT an optimistic client guess. |
| FR-005 | On a failed transition, the dock MUST surface the existing recoverable error/scope-gap notice and the ticket MUST continue to display its prior (unchanged) status; the picker MUST return to an idle, re-selectable state. |
| FR-006 | Selecting the placeholder / a no-op (the currently-selected value) MUST NOT dispatch a transition. |
| FR-007 | When the ticket has no available transitions, the picker MUST continue to show the existing "no transitions available" empty treatment and dispatch nothing. |
| FR-008 | The change MUST NOT alter the `write:jira-work` scope model: a transition attempted without the write scope MUST still short-circuit to the existing `write_not_authorized` notice, with no client call. |

### Ticket-number web link

| ID     | Requirement                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-010 | The ticket detail MUST carry a non-secret canonical web URL for the issue, assembled in the MAIN process as the connected site's browse URL for the issue key (`<siteUrl>/browse/<KEY>`), using the site URL already held in the connection (no new secret, no token in any payload). |
| FR-011 | The web URL MUST be omitted (absent) when the site URL is unavailable or the assembled value does not parse to an absolute `http(s)` URL — degrade-to-omit, mirroring the Confluence web-link behavior. |
| FR-012 | In the dock, the ticket key MUST render as a link with a visible external-link icon affordance when (and only when) a valid web URL is present; otherwise the ticket key MUST render as plain, non-interactive text with no icon. |
| FR-013 | Activating the ticket-key link MUST open the ticket's Jira web page in the system browser (external), reusing the established external-link idiom; it MUST NOT navigate the cosmos app window or open an in-app webview. |
| FR-014 | The renderer MUST re-validate that the web URL is an absolute `http(s)` URL before rendering the link, so a malformed bound value can never become a live link. |
| FR-015 | The ticket-key link MUST be keyboard-focusable with a visible focus ring and an accessible name indicating it opens the ticket in Jira; the external-link icon is decorative (not the sole carrier of meaning). |

### Shared / non-regression

| ID     | Requirement                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-020 | Both changes MUST be confined to the ticket-detail dock surface and its data shape; the list/board, search, compose, and tab behaviors MUST be unaffected. |
| FR-021 | No secret (token, client secret) may appear in any IPC payload, bridge frame, MCP result, or A2UI surface as a result of these changes; the web URL is a non-secret browse URL only. |
| FR-022 | The web URL MUST also be present on the post-write detail re-push, so after an auto-applied transition the ticket-key link remains correct and present. |

## Edge Cases & Constraints

- **Stale transition id.** If the selected transition is no longer valid by the time main executes it, the existing write-failure path applies: error notice + status unchanged (FR-005). No special-casing beyond the standard recoverable failure.
- **Rapid re-selection / double-click.** Only one transition is in flight at a time; the picker is locked until the re-pushed detail surface settles (FR-003). The re-push arrives as a fresh detail frame that re-renders the picker in its idle state.
- **Transition that does not change the visible status.** A transition whose destination equals the current status still dispatches if it is a distinct, valid transition; the re-read simply shows the same status. Selecting the already-selected value is a no-op (FR-006).
- **No available transitions.** Picker shows the existing empty state; nothing dispatches (FR-007).
- **Missing site URL.** A connection whose stored identity lacks a site URL yields no web URL → plain-text key, no icon (FR-011/FR-012). This is a graceful omission, not an error.
- **Key vs. icon as the link.** The link affordance covers the ticket key text together with the icon (a single anchor), so the whole key is clickable — matching the Confluence title-link pattern.
- **Out of scope:** changing the deterministic write architecture or the `jira.*` action contract; adding optimistic status rendering; a confirmation dialog before applying a transition (the user explicitly asked for no Apply button — see Open Questions); making the list/board ticket cards link out (this feature is the dock only); any new OAuth scope; opening the ticket inside an in-app browser.

## Success Criteria

| ID     | Criterion                                                                                                                  |
|--------|--------------------------------------------------------------------------------------------------------------------------|
| SC-001 | A status change in the dock requires exactly one interaction — selecting the value — with no Apply button present.        |
| SC-002 | While a transition is in flight, no second transition can be dispatched, and the picker visibly indicates the busy state. |
| SC-003 | A successful transition shows the new server-confirmed status; a failed transition shows an error notice with the status unchanged. |
| SC-004 | When a valid web URL exists, the dock ticket key is an external link (with icon) that opens the correct Jira ticket page in the system browser. |
| SC-005 | When no valid web URL exists, the dock ticket key is plain text with no icon and no broken link.                          |
| SC-006 | No secret appears in any payload, surface, or log as a result of these changes; the web URL is a non-secret browse URL.   |
| SC-007 | The Jira list/board, search, compose, and tab behaviors are unchanged by this feature.                                    |

---

## Open Questions

- [ ] **Confirm "no confirmation step" for auto-apply.** The request explicitly asks to drop the Apply button so a status change applies on selection. A status transition is a real (if non-destructive) mutation, so select-to-apply means a stray click commits a workflow move. This spec DEFAULTS to immediate apply with no confirmation per the explicit request (recoverable via re-selecting the prior status). If the user instead wants a lightweight guard (e.g. an inline "applying…/undo" affordance), that is a scope change to settle before planning. No other behavior is blocked on this; planning may proceed under the immediate-apply default unless the user objects.
