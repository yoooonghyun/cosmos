# Spec: Confluence Page Detail — Right-Side Dock (~half width) — v1

**Status**: Draft
**Created**: 2026-06-23
**Supersedes (presentation only)**: `.sdd/specs/confluence-page-detail-nav-v1.md` "As Built" — that feature opens
the clicked page detail as a **full-panel overlay** (`genUiPage`) that REPLACES the document list. This spec
keeps the same click→open→back behavior but changes the PRESENTATION to a **right-side dock** that keeps the
document list visible on the left. The row-click seam, the read-only `getPage` reuse, and the per-tab reset all
carry over; only the layout (full-panel overlay → two-pane dock) changes.
**Related plan**: `.sdd/plans/confluence-page-detail-dock-v1.md`
**Related design (to author next)**: `.sdd/designs/confluence-page-detail-dock-v1.md` (designer owns dock chrome,
divider, selected-row marker, close affordance, the ~50% width treatment).

**Scope amendment (post-build, user-directed)**: the NATIVE search/default-feed list now ALSO opens the dock. The
original spec (FR-012 / OQ-2) deliberately left the native base's own search → page-detail drill-in as a separate
full-region `view.kind === 'page'` flow. Per a direct user request ("페이지 전환대신 dock" — clicking ANY Confluence
document, native or generated, should open the right-side dock rather than swap the whole region), the native
`ContentList` row click now calls the SAME `setGenUiPage({pageId,title})` overlay the generated-UI path uses. The
full-region native page view (`view.kind === 'page'` header back-row + `<PageDetail>` body) is REMOVED — nothing sets
`view.kind === 'page'` anymore (the `ConfluenceView` `'page'` variant is retained only for type-shape parity with the
shared `confluenceViewContext` mapper). FR-012 and OQ-2 below are revised accordingly.

---

## Grounding

> Direct investigation run for this spec (mandatory handoff section). Exact queries executed:

**codegraph_explore / codegraph_search:**

- `ConfluencePanel confluence list page detail native-overlay click navigation` — returned the verbatim
  `ConfluencePanel.tsx` render. **Takeaways:** (1) the current open-detail path is a renderer-local overlay
  `const [genUiPage, setGenUiPage] = useState<{pageId; title} | null>(null)` (`ConfluencePanel.tsx:388`),
  cleared on tab switch (`useEffect(…, [activeTabId])`, :389). (2) `handleSurfaceAction` (:520) intercepts
  `CONFLUENCE_OPEN_DETAIL_ACTION`, sets `genUiPage`, returns `true` (never forwarded). (3) The detail renders as a
  **whole-content-region branch** `: genUiPage ? ( <native back row> + <PageDetail key={genUiPage.pageId} …/> ) :`
  (:597-627) — this branch REPLACES the native base / generative host while open (the list is gone). (4) `PageDetail`
  is a renderer component (:264) reading `window.cosmos.confluence.getPage` directly, with its own
  loading/empty/error/reconnect states and an `onWebUrl` lift for the "Open in Confluence" header link; the header
  uses `PageDetailTitle`.
- `SlackPanel open thread sidepanel right dock two-pane @container/slackbody message list replies` — returned the
  shipped Slack right-dock. **Takeaway (the pattern to mirror):** the connected body is wrapped
  `<div className="@container/slackbody relative flex min-h-0 flex-1">` (`SlackPanel.tsx:1359/1458`); the list pane is
  `min-w-0 flex-1` and the dock is `<div className="absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] … border-l
  border-border bg-card shadow-lg … @[32rem]/slackbody:relative @[32rem]/slackbody:w-[clamp(18rem,42%,28rem)]
  @[32rem]/slackbody:shrink-0 …">` (:1424/:1484) over a `bg-black/40 … @[32rem]/slackbody:hidden` scrim — side-by-side
  ≥32rem, drawer below. `SlackThreadPanel` (:790) is the dock frame.
- `GoogleCalendarPanel EventDetail dock @container/calbody two-pane selected event detail right-side` — returned the
  calendar `EventDetail` dock + `genUiEvent` per-tab transient state + `closeDetail`. **Takeaway:** the calendar dock
  is the SAME shell, with a per-tab transient `genUiEvent` reset on `activeTabId` change (`GoogleCalendarPanel.tsx:538-547`)
  and a single dock that RETARGETS on a second click. This is structurally identical to what Confluence's `genUiPage`
  already is — it just needs to render BESIDE the list rather than over it.

**Read (precedent specs/designs):**

- `.sdd/specs/confluence-page-detail-nav-v1.md` — the shipped click→detail feature this revises (presentation only).
- `.sdd/designs/jira-ticket-detail-dock-v1.md` — the **direct precedent**: Jira already migrated its detail from a
  full-panel view-swap to a `@container/jirabody` right-side dock (`w-[clamp(18rem,42%,28rem)]`, 32rem breakpoint,
  X + scrim dismiss, selected-row ring). Confluence does the SAME migration. Its one structural difference (Jira's dock
  body is a live A2UI host that fetches) does NOT apply here: Confluence's dock body is the **native `PageDetail`**, which
  already owns its own loading/error/empty states (so no dock-level skeleton design needed — `PageDetail` carries it).
- `.sdd/designs/calendar-event-detail-v1.md` — the overlay→dock template (§1 shell, §5 breakpoint, §3 state table).

**memory_recall / memory_smart_search:**

- `Confluence gen-UI page detail native-overlay reuse two-pane dock` — empty store. Persisted this dock-migration
  decision (width ~50% deviation from the 42% docks) via `memory_save` after authoring.

**ARCHITECTURE.md §4.9** — read the Confluence-panel paragraph describing the shipped `genUiPage` overlay
("makes the panel render a native `ChevronLeft` back row plus the EXISTING native `PageDetail` … keyed on `pageId`").
This spec changes that overlay into a two-pane dock; §4.9 gets a one-sentence update (see plan).

---

## Overview

In the connected Confluence panel, clicking a document row in a **generated-UI list** (an agent-composed
`SearchResultList`) opens that page's full detail in a **right-side dock** that sits **beside** the document list —
the list stays visible on the left and shrinks to share the space; the dock is **about half the panel width**. This
replaces the current full-panel overlay (`genUiPage`) that hides the list while a detail is open. The dock REUSES the
existing native `PageDetail` component verbatim (title, space, ADF/HTML body, content images, emoji, checkboxes) — no
new detail rendering. Clicking another row swaps the dock's content; a close affordance dismisses the dock and returns
the list to full width. This is the Confluence analog of the shipped **Slack thread right-dock** and **Jira
ticket-detail dock** (`jira-ticket-detail-dock-v1`): the same two-pane shell, retargeted to a Confluence page, and
**renderer-only** (no new IPC — `getPage` is already a renderer invoke).

## User Scenarios

> Prioritized P1 (must), P2 (should), P3 (nice to have).

### Open a document in a right-side dock (list stays visible) · P1

**As a** Confluence user in cosmos
**I want to** click a document row in a generated-UI list and see its detail open in a pane on the RIGHT, like Slack
**So that** I can read the document while still seeing the list of documents on the left, instead of losing the list

**Acceptance criteria:**

- Given a connected Confluence panel whose active tab shows a generated-UI list of pages, when I click a row that has a
  page id, then that page's full detail opens in a **dock on the right side** of the panel AND the document list
  **remains visible on the left** (it is NOT replaced) — the list narrows to share the space.
- Given the dock is open, when I look at the panel, then the dock occupies **about half the panel width** (the list and
  the dock together fill the panel), with neither pane collapsing to an unusable width.
- Given the dock is open, when I read it, then it shows the SAME detail content the existing `PageDetail` already renders
  (title, space, readable body including content images, emoji, and checkboxes) — nothing about the detail rendering
  changes.

### Close the dock and return the list to full width · P1

**As a** Confluence user with a document dock open
**I want to** close the dock
**So that** the document list returns to the full panel width

**Acceptance criteria:**

- Given a document dock is open, when I activate the dock's close affordance, then the dock dismisses and the document
  list returns to the full panel width exactly as it was (same scroll position, no re-fetch — the list never moved).

### Swap to another document by clicking another row · P1

**As a** Confluence user with a document dock open
**I want to** click a different document row in the list
**So that** the dock shows that document instead — without stacking a second dock

**Acceptance criteria:**

- Given a document dock is open showing page A, when I click a different row (page B) in the still-visible list, then
  the SAME single dock swaps to show page B (it retargets in place) — it does NOT open a second dock and does NOT
  replace the list.
- Given a dock is open, when I look at the list, then the row whose document the dock is currently showing carries a
  clear **selected** marker (so I can tell which document is open) — like the calendar's selected-event chip and the
  Jira/Slack active-row marking.

### Stay read-only & renderer-local · P1

**As a** Confluence user
**I want to** open a document dock without granting new permissions or routing through the AI agent
**So that** browsing detail is safe, fast, and requires no reconnect

**Acceptance criteria:**

- Given a connected Confluence panel, when I click a page row to open the dock, then no new OAuth scope is required, the
  open is a **renderer-local nav action** intercepted in the panel (never forwarded to main or the agent), the detail is
  the existing read-only `getPage` read, and no token/secret appears on any IPC payload, bridge frame, or rendered
  surface.

### Detail read fails / reconnect — handled by the reused component · P2

**As a** Confluence user
**I want to** open a document whose detail read fails
**So that** I see the existing recoverable state inside the dock instead of a broken panel

**Acceptance criteria:**

- Given I click a page row and the `getPage` read fails with a non-`reconnect_needed` kind, then the **dock body** shows
  the existing `PageDetail` error state (the same one it shows today); the list pane beside it is undisturbed; the app
  does not crash. I can close the dock and re-click to retry.
- Given the read fails with `reconnect_needed` / `not_connected`, then the existing connection-gating behavior applies
  (the panel's native Connect/Reconnect affordance takes over via `confluence:statusChanged`), and no dock is left
  stranded.

## Functional Requirements

> Every requirement traces to a scenario above or a named precedent. FRs that only change PRESENTATION carry over the
> behavior of `confluence-page-detail-nav-v1` and add the dock layout.

| ID     | Requirement |
|--------|-------------|
| FR-001 | Clicking a document row that carries a non-empty page id MUST open that page's detail in a **right-side dock** within the active tab, and the document **list MUST remain mounted and visible on the left** (it MUST NOT be replaced or hidden by the detail). This applies to BOTH a generated-UI `SearchResultList` row AND a NATIVE search/default-feed `ContentList` row (scope amendment) — both call the same `setGenUiPage` dock overlay. (Traces: "Open a document in a right-side dock"; mirrors the Slack thread dock + Jira ticket-detail dock two-pane.) |
| FR-002 | The dock MUST occupy **approximately half the panel width** when open, with the list pane sharing the remaining space; neither pane may collapse to an unusable width (a sensible minimum applies to each). The exact split/min is fixed in the design (see OQ-1). (Traces: "about half the panel width".) |
| FR-003 | The dock body MUST render the page detail by **reusing the existing native `PageDetail` component verbatim** (title, space, sanitized body with content images / emoji / checkboxes, and its own loading / empty-body / error / reconnect states). No new detail-rendering component, no main-side surface builder, no change to how the body is rendered. (Traces: "the SAME detail content"; the design pivot of `confluence-page-detail-nav-v1` — native reuse.) |
| FR-004 | The open-detail action MUST remain a **renderer-local nav action** (`CONFLUENCE_OPEN_DETAIL_ACTION`, non-`confluence.*`) intercepted by the panel's `ActiveTabSurface` `onAction` seam, returning handled, and NEVER forwarded to main or the agent. A row with no/empty page id MUST stay INERT (no cursor, no hover, no keyboard activation, no emit). Any OTHER action MUST still flow through unchanged. (Traces: "Stay read-only & renderer-local"; unchanged from `confluence-page-detail-nav-v1` FR-001/002/003.) |
| FR-005 | The dock MUST carry a **close affordance** that dismisses the dock and returns the document list to the full panel width — same scroll, no re-fetch (the list never moved). (Traces: "Close the dock"; mirrors the Slack/Jira/calendar dock close X.) |
| FR-006 | Clicking a **different** document row while the dock is open MUST **retarget the single dock** to that page (swap its content in place); it MUST NOT open a second dock and MUST NOT replace the list. (Traces: "Swap to another document"; mirrors Jira/calendar single-dock retarget.) |
| FR-007 | While the dock is open, the list row whose document the dock is showing MUST carry a clear **selected** marker; the marker MUST move on retarget. (Traces: "Swap to another document" selected-row criterion; mirrors the calendar selected chip / Jira & Slack active-row marking.) |
| FR-008 | The dock body's loading / empty-body / error / reconnect states MUST be those the reused `PageDetail` already provides; a non-`reconnect_needed` read failure MUST surface **inside the dock body** without disturbing the still-visible list pane and without crashing. A `reconnect_needed` / `not_connected` failure MUST route to the existing native Connect/Reconnect affordance (via `confluence:statusChanged`) with no dock left stranded. (Traces: "Detail read fails / reconnect"; the reused `PageDetail` states + the dock-as-sibling-of-list invariant from the Jira/calendar dock specs.) |
| FR-009 | The dock layout MUST be **responsive to the panel's own width** (a container query, not the viewport): at/above a breakpoint the dock sits **side-by-side** with the narrowed list; below it the dock becomes a **right-drawer overlay** (with a click-away scrim) so it never squeezes the list into illegibility. (Traces: "neither pane may collapse"; mirrors the Slack/Jira/calendar `@container/*body` 32rem breakpoint — the design tunes the exact breakpoint for the ~50% width, OQ-1.) |
| FR-010 | The dock + its open/selected state MUST be **scoped to the active tab and reset on a tab switch / new tab**, so an open dock never bleeds across tabs. (Traces: per-tab consistency; unchanged from `confluence-page-detail-nav-v1` FR-014 — the existing `useEffect(…, [activeTabId])` reset of `genUiPage`.) |
| FR-011 | The open-detail operation MUST be **read-only**: no new OAuth scope, no write path, no token/secret on any IPC payload, type, bridge frame, MCP result, or A2UI surface. The detail read is the existing renderer `getPage` invoke (main attaches the token). (Traces: "Stay read-only"; unchanged invariant.) |
| FR-012 | All existing Confluence panel surfaces MUST remain present and behave unchanged: the NL `PromptComposer` (and its bottom dock), the **native search/default-feed browser base**, per-tab tabs, refresh, and pagination. **REVISED (scope amendment):** the native base's OWN search-result/feed row click now opens the SAME right-side dock (it no longer swaps the whole region to a `view.kind === 'page'` view); that full-region native page flow (header `ChevronLeft` back row + `<PageDetail>` body) is REMOVED. Both native and generated-UI rows therefore share one dock presentation (FR-001/FR-005/FR-006/FR-007 apply to both). (Traces: non-regression for everything except the deliberately-changed native drill-in; see OQ-2.) |

## Edge Cases & Constraints

- **Row with no/empty page id** → inert (no cursor/hover/keyboard), emits no action; the panel does not crash
  (FR-004; unchanged `isOpenDetailEmittable` gate).
- **Narrow panel** → below the container-query breakpoint the dock is a right-drawer overlay (scrim, reduced-motion
  gated) that does not squeeze the list; clicking the scrim closes the dock (FR-009; mirrors Slack/Jira/calendar).
- **`getPage` error / empty body / reconnect** → handled by the reused `PageDetail` inside the dock body; the list
  pane is undisturbed; reconnect routes to the native Connect/Reconnect (FR-008).
- **Retarget** → a second row click swaps the single dock, moves the selected marker, never stacks (FR-006/007).
- **Tab switch while dock open** → the dock + selected state reset on `activeTabId` change; switching back shows the
  list with no dock (FR-010).
- **"Open in Confluence" header link** → the existing `PageDetailTitle` external-link affordance (the `onWebUrl` lift)
  MUST continue to work in the dock header exactly as it does today (no regression of `confluence-link-404-v1`).
- **Out of scope:** opening a detail in a NEW tab; a resizable / user-draggable dock width (recommend fixed ~50% for
  v1 — OQ-3); a forward/redo or multi-level nav stack; deep-linking; routing the click through the AI agent; any new
  write capability; changing the native-base browser's OWN existing search → page-detail drill-in (that already exists
  as a full-region `view.kind === 'page'` flow and stays as-is — OQ-2); any change to how the body is rendered
  (ADF/HTML, images, emoji, checkboxes all unchanged — FR-003).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking a document row (with a page id) in a connected Confluence panel's generated-UI list opens that page's detail in a **right-side dock** while the document list **stays visible on the left** and narrows to share the space. |
| SC-002 | The dock occupies **about half the panel width** when open (side-by-side at normal panel widths); neither pane collapses; below a breakpoint the dock is a right-drawer overlay over the list. |
| SC-003 | The dock body renders the existing `PageDetail` content (title, space, body with content images / emoji / checkboxes) and its existing loading/empty/error/reconnect states — verbatim, no new detail rendering. |
| SC-004 | The dock's close affordance dismisses it and returns the list to full width (same scroll, no re-fetch); clicking a different row retargets the single dock and moves the selected-row marker; the dock never stacks. |
| SC-005 | Opening the dock is a renderer-local nav action (never forwarded to main/agent), runs the read-only `getPage` (no agent run, no new OAuth scope), exposes no token/secret on any payload/frame/surface, and resets per tab. |
| SC-006 | Every existing Confluence surface (NL composer, native search/default-feed browser + its own page-detail drill-in, tabs, refresh, pagination, the "Open in Confluence" header link) continues to work unchanged. |

---

## Open Questions

- [ ] **OQ-1 — Exact dock width + breakpoint (the "~half" treatment).** The shipped Slack/Jira/calendar docks use
  `w-[clamp(18rem,42%,28rem)]` at a `@[32rem]` breakpoint — that caps near ~28rem, which is NARROWER than "half." The
  user explicitly asked for **about half the panel width** ("너비는 화면 반정도는 써야할듯"). **Recommendation:** a
  ~50% dock — e.g. `w-[clamp(20rem,50%,40rem)]` (list keeps `min-w-0 flex-1`) at a slightly larger breakpoint (e.g.
  `@[40rem]/confluencebody`) so the side-by-side split only engages when the panel is wide enough that a ~50% dock and
  the narrowed list are both legible; below it, the right-drawer overlay. The designer fixes the exact clamp/min/
  breakpoint values in the dock design. Not blocking — any value that reads as "about half" with a sane list minimum
  satisfies FR-002.

- [x] **OQ-2 — Replace the full-panel overlay entirely vs. keep it as a fallback. RESOLVED.** The `genUiPage`
  full-panel overlay became the dock. **Additionally (user-directed scope amendment):** the NATIVE-base browser's OWN
  page-detail drill-in (the former full-region `view.kind === 'page'` flow with `ChevronLeft`) was ALSO migrated to the
  dock — the user explicitly asked that clicking ANY document (native or generated) open the right-side dock instead of
  swapping the region. The native `ContentList.onOpen` now calls `setGenUiPage`; the full-region native page header +
  body branches were removed. There is now exactly ONE open-detail UI (the dock) for both row sources.

- [ ] **OQ-3 — Resizable dock?** **Recommendation: NO for v1 — fixed ~50%.** A user-draggable divider is extra
  surface area the user did not ask for; the responsive container-query split already keeps both panes sane. Defer a
  resizable divider to a follow-up if requested.
