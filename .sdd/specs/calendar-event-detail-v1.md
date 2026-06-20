# Spec: Google Calendar — Event Detail on Click — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/calendar-event-detail-v1.md

> Issue: #85. User request (2026-06-20): "캘린더에 좀더 많은 액션이 들어가야할거 같은데,
> 일단 이벤트를 클릭해서 상세 정보를 볼수 있으면 좋겠어." (Translation: "The calendar needs
> more actions; first, I'd like to click an event to see its detail.")

---

## Grounding

> Direct investigation run by the architect for this spec (mandatory). Findings drive every
> decision below.

**codegraph_explore / codegraph_search queries:**

- `GoogleCalendarPanel googleCalendarCatalog calendar event DTO events.list` — the panel hosts
  per-tab generative surfaces; the month grid renders from a locked `EventList` root; events are
  NOT clickable today (`EventChip` is a plain `<div>`).
- `GoogleCalendarEvent DTO fields location description attendees htmlLink colorId recurringEventId
  googleCalendarSurfaceBuilder` — **key finding:** `GoogleCalendarEvent` (`src/shared/googleCalendar.ts`)
  carries ONLY `id, calendarId, summary, start, end, allDay, timeZone, location`. It does NOT carry
  `description`, `attendees`, `htmlLink`, `colorId`, or `recurringEventId`.
- `ConfluencePanel page detail click open overlay Back ContentDetailContext ActiveTabSurface
  confluenceCatalog components PageDetailNode openDetail` — the **Confluence detail-nav precedent**:
  a clicked row emits a renderer-local nav action (`CONFLUENCE_OPEN_DETAIL_ACTION`) intercepted via
  the `ActiveTabSurface` `onAction` seam; the panel shows a native `ChevronLeft` Back row + a native
  detail component over the live A2UI host; Back clears the overlay; held per-tab, reset on tab
  switch. Chosen over a surface-push/new-IPC design as less over-engineered.
- `SlackPanel openThread closeThread openThreadFor SlackThreadPanel container/slackbody side dock` —
  the **Slack thread side-dock precedent** (the presentation this revision adopts): the SlackPanel
  body is a `@container/slackbody` horizontal two-pane container — the list on the left, a right-docked
  thread panel on the right that only mounts when a thread is open. Above `32rem` the dock sits
  **side-by-side** (`clamp(18rem,42%,28rem)`, `shrink-0`, `border-l`), and the list keeps its width;
  below `32rem` it becomes an **absolute right-drawer overlay** (`w-full max-w-[22rem]`, `shadow-lg`)
  with a click-away scrim that closes it. The dock is fed by a single renderer-local open-thread state
  (`openThread`), set by both the native row and the generative `SLACK_OPEN_THREAD_ACTION` via the
  `ActiveTabSurface.onAction` seam, and dismissed by an X button (`onClose`) AND the narrow-mode scrim.
  It is **transient** (not part of the back-stack): changing the underlying view closes it.
- `jiraBackNav backNavTarget JiraBackOrigin` — the **Jira ticket-detail precedent**: same overlay
  pattern; tracks the back-origin so a detail opened over a pinned `composed` surface restores it.
- `googleCalendarCatalog logic.ts eventTitle eventTimeLabel isAllDay DayCell MonthGrid
  CalendarNavContext components.tsx EventListNode` — the catalog's pure helpers (`eventTitle`,
  `eventTimeLabel`, `isAllDay`) and the `CalendarNavContext` panel→catalog seam already in place.
- `googleCalendar IPC channels getStatus requestDefaultView GoogleCalendarApi preload events.get
  getEvent` — **key finding:** the IPC surface (`src/shared/ipc/googleCalendar.ts`) has only
  `getStatus/connect/disconnect/listEvents/requestDefaultView/onStatusChanged`. There is **NO
  single-event read** (`events.get`) channel or method.
- `googleCalendarSurfaceBuilder buildDefaultViewSurface CalendarMonthGrid EventList event props
  action click` — `eventRow()` maps each `GoogleCalendarEvent` to the `EventList`'s per-event
  static props, currently dropping everything not in the thin DTO.

**memory_recall / memory_smart_search queries:**

- `google calendar integration detail view event` — no prior results (empty memory store).
- `calendar feature detail nav overlay pattern Jira Confluence` — no prior results.
- (Persisted this spec's core decision via `memory_save` after grounding.)

**Takeaways that shape this spec:**

1. The detail fields the user wants (description, attendees, link to Google) are NOT in the
   already-fetched month page and there is NO existing single-event read — so v1 needs the data to
   be made available (resolved in the plan: enrich the existing `events.list` mapping; no new fetch).
2. cosmos has a settled side-dock pattern (Slack thread panel: `@container/slackbody` two-pane,
   side-by-side ≥32rem / drawer-overlay <32rem, X + scrim dismiss). The calendar dock reuses the
   dock SHELL (drawer width, scrim, X dismiss, transient single-dock retarget) but DIVERGES on one
   point: it is an **always-overlay** drawer at every width (no `@container` side-by-side branch),
   so the dense month grid keeps its full width unchanged whether the dock is open or closed — only
   covered on the right while open. The clicked chip still emits a renderer-local nav action
   intercepted via the same `ActiveTabSurface.onAction` seam — only the **presentation** moves from
   an in-place grid-replacing overlay to the always-overlay right-side dock.

---

## Overview

Clicking an event in the Google Calendar month grid opens that event's full detail (title, time,
location, description, attendees, calendar, link to open in Google) in a **right-side dock that
appears alongside the month grid** within the same panel tab — the grid stays visible, not replaced —
with a dismiss affordance that closes the dock and returns focus to the full grid. The dock mirrors
the Slack thread side-panel pattern the project already ships. This is the first of a planned set of
richer calendar actions; v1 is strictly a **read-only detail view** — no edit, delete, create, or RSVP.

## User Scenarios

> Each scenario is independently testable. Prioritized P1 (must) / P2 (should) / P3 (nice).

### Open an event's detail · P1

**As a** cosmos user viewing my month calendar
**I want to** click an event chip in the grid
**So that** I can read that event's full details alongside the calendar, without losing the grid

**Acceptance criteria:**

- Given a connected calendar showing the month grid, when I click an event chip, then a detail dock
  opens on the right side of the panel **alongside** the grid (same tab), and the grid stays visible.
- Given an event detail dock is open, when I dismiss it (close button, or — in the narrow drawer
  mode — clicking the scrim), then the dock closes and the month grid is shown in full exactly as it
  was (same month, same scroll, no re-fetch).
- Given an event detail dock is open, when I click a different event chip, then the dock re-targets
  to that event (the single dock retargets rather than stacking a second dock).
- Given I clicked an event, then the detail shows at minimum its title and its date/time.

### See the full set of detail fields · P1

**As a** user reading an event detail
**I want to** see title, start/end time (or all-day), location, description, attendees, the owning
calendar, and a link to open the event in Google Calendar
**So that** I have the context I need about the event

**Acceptance criteria:**

- Given a timed event with all fields, when its detail opens, then it shows the title, a start–end
  time range, the location, the description, the attendee list, the owning calendar, and — in the dock
  header — its title rendered as the "open in Google Calendar" external link with an external-link icon.
- Given the dock header title is an external link, when I click it, then the event opens in Google
  Calendar in the system browser (external), not inside cosmos; given an event with no `htmlLink`, the
  title is plain text with no icon and no link (never broken).

### Events with missing optional fields degrade calmly · P1

**As a** user clicking an event that has no location / no description / no attendees
**I want to** see the detail without empty-looking gaps or errors
**So that** a sparse event still reads cleanly

**Acceptance criteria:**

- Given an event with no location, when its detail opens, then the location row is omitted (not shown
  blank).
- Given an event with no description, when its detail opens, then the description section is omitted
  or shows a calm "No description" affordance, never a crash.
- Given an event with no attendees, when its detail opens, then the attendees section is omitted (a
  solo/personal event is normal).
- Given an event whose title is blank, when its detail opens, then it shows "(no title)" (matching the
  grid chip behavior), never an empty heading.

### All-day vs timed formatting · P1

**As a** user clicking either an all-day event or a timed event
**I want to** see the time formatted appropriately for its kind
**So that** I'm not shown a misleading midnight time for an all-day event

**Acceptance criteria:**

- Given an all-day event, when its detail opens, then it shows the date (or date range for a
  multi-day all-day event) labeled as all-day, with no clock time.
- Given a timed event, when its detail opens, then it shows the start and end clock times (and the
  date), in the viewer's locale.
- Given a multi-day timed event, when its detail opens, then both the start date+time and the end
  date+time are shown.

### Recurring event instance · P2

**As a** user clicking one occurrence of a recurring event
**I want to** see that occurrence's detail
**So that** I understand it's that specific instance

**Acceptance criteria:**

- Given a clicked recurring-event instance, when its detail opens, then it shows that occurrence's
  own date/time (not the series master's), and SHOULD indicate it is part of a recurring series.

### Not-connected / reconnect and empty states · P2

**As a** user whose calendar is not connected, needs reconnect, or has no events
**I want to** never reach a broken detail view
**So that** the feature fails safely

**Acceptance criteria:**

- Given the calendar is not connected or needs reconnect, then no event detail can be opened (the
  panel shows its existing Connect / Reconnect affordance, unchanged).
- Given a month with zero events, then there is nothing to click and the existing empty-month note
  shows, unchanged.
- Given an event detail dock is open and the connection drops (disconnect / reconnect_needed), then
  the panel returns to its Connect / Reconnect affordance without a stuck or crashing dock.

### Detail is scoped to its tab · P2

**As a** user with multiple calendar tabs open
**I want to** an open detail dock to stay within the tab it was opened in
**So that** switching tabs never bleeds one tab's detail into another

**Acceptance criteria:**

- Given an event detail dock is open in tab A, when I switch to tab B, then tab B shows its own grid
  with no dock, and switching back to A shows the grid (the open detail dock is reset on tab switch).

---

## Functional Requirements

> "MUST" required, "SHOULD" recommended, "MAY" optional. Each FR traces to the request.

| ID     | Requirement |
|--------|-------------|
| FR-001 | An event in the month grid MUST be clickable; clicking it opens that event's detail view. *(req: "이벤트를 클릭해서 상세 정보를 볼수 있으면")* |
| FR-002 | The detail view MUST open as a **right-side dock that always OVERLAYS the month grid** within the same panel tab — an absolute right-drawer pinned to the right edge floating over a click-away scrim at EVERY width — never a separate rail surface, window, or whole-app view. The grid MUST remain visible behind the dock and MUST keep its **full width unchanged** whether the dock is open or closed (it is simply covered on the right while open); the dock MUST NOT reserve a column or shrink/reflow the grid at any width. The dock + scrim MUST span the **full viewport height of the whole panel** (top to bottom) **independent of the calendar grid's height** — they are anchored to the panel root, not to the (variable-height) calendar content region, so the dock is full-height whether the grid is short or tall. *(req: "상세 정보를 볼수 있으면"; presentation revision — always-overlay so the grid width never changes; revision — full-viewport-height dock, not grid-bound)* |
| FR-003 | The detail dock MUST provide a dismiss affordance (a close/X control AND the click-away scrim) that closes the dock and uncovers the grid **as it was** — same displayed month, no re-fetch, no surface round-trip (the grid's width was never changed). Clicking a different event chip while a dock is open MUST **re-target** the single dock to that event rather than open a second dock. *(req: a way to dismiss the detail; single-dock retarget precedent)* |
| FR-004 | The detail view MUST show the event **title**, degrading a blank/absent title to "(no title)". *(req: "상세 정보" — title)* |
| FR-005 | The detail view MUST show the event's **time**: for a timed event, the start and end clock times plus date(s) in the viewer's locale; for an all-day event, the date (or date range) labeled all-day with no clock time. *(req: detail — start/end, all-day vs timed)* |
| FR-006 | The detail view MUST show the event **location** when present, and MUST omit the location row when absent (never a blank row). *(req: detail — location)* |
| FR-007 | The detail view MUST show the event **description** when present, and MUST degrade an absent description to an omitted section or a calm "No description", never a crash. *(req: detail — description)* |
| FR-008 | The detail view MUST show the event **attendees** when present (display names / emails as supplied), and MUST omit the attendees section when absent. *(req: detail — attendees)* |
| FR-009 | The detail view MUST indicate the event's **owning calendar** (name and/or its legend color) when that information is available. *(req: detail — calendar/color)* |
| FR-010 | The detail view MUST offer a link to **open the event in Google Calendar**, opening it in the system browser (external), not inside cosmos. The link MUST be carried by the **event title in the dock header** (the title itself is the external link, with a navigate/external icon beside it) rather than a separate body link row. When no `htmlLink` is present the title MUST degrade to plain text with no icon and no link (never a broken link); the "(no title)" degrade (FR-004) still applies in both cases. *(req: detail — link to open in Google)* |
| FR-011 | A clicked **recurring-event instance** MUST show that occurrence's own date/time, and SHOULD indicate it belongs to a recurring series. *(req: detail correctness across event kinds)* |
| FR-012 | Opening a detail MUST NOT require posting any token, secret, or token-bearing URL to the renderer or the embedded `claude` sandbox; the external link MUST be a non-secret public Google Calendar URL. *(architecture security invariant)* |
| FR-013 | The feature MUST remain **read-only**: no edit, delete, create, RSVP, or any write control, and MUST NOT request a new OAuth scope. *(req: "일단 … 상세 정보를 볼수 있으면" — first/only this; calendar is read-only today)* |
| FR-014 | An open detail dock MUST be scoped to the tab it was opened in and MUST reset (close) on a tab switch, so it never bleeds across tabs. *(consistency with per-tab nav precedent; the Slack dock is likewise transient and per-tab)* |
| FR-015 | When the calendar is not connected, needs reconnect, or the month is empty, the feature MUST degrade to the existing Connect / Reconnect / empty-month states with no openable detail dock and no crash. *(req: fail safely)* |
| FR-016 | An event whose detail cannot be fully resolved (missing fields, malformed data) MUST still render the fields it has without throwing; a render error inside the dock MUST degrade to the existing per-tab surface error boundary, never a white-screen, and MUST NOT take down the still-visible month grid beside it. *(robustness, matches catalog conventions)* |

## Edge Cases & Constraints

- **All-day exclusive end date.** Google returns an all-day event's `end` as the exclusive day
  after the last day; a multi-day all-day range MUST be presented as the inclusive human range (e.g.
  a 3-day event shows its actual last day, not the day after).
- **Spillover day cells.** Events shown in muted adjacent-month spillover cells (if any) are still
  real events and MUST be clickable like any other.
- **Overflow ("+N more").** v1 detail-on-click applies to the event chips that are actually rendered
  in a cell. Revealing events hidden behind "+N more" is **out of scope** for v1 (no change to the
  overflow affordance).
- **Long description / many attendees.** The detail dock MUST scroll **within the dock** rather than
  overflow it or the panel; very long content MUST not break the side-by-side layout or push the grid.
- **Narrow panel.** When the panel is too narrow for a side-by-side dock, the detail MUST present as
  an absolute right-drawer overlay (with a click-away scrim) over the grid rather than squeezing the
  7-column grid into illegibility — matching the Slack dock's `@container`-gated drawer fallback.
- **Attendee privacy.** Attendee identities come straight from the calendar read; cosmos displays
  them as-is and does not derive or fetch additional identity. Self / organizer MAY be indicated if
  the data distinguishes them, but this is optional.
- **Out of scope (explicit):** editing/deleting/creating events, RSVP / responding, adding
  attendees, viewing the full recurrence rule or other instances, week/day views, attachments,
  conferencing (Meet) join controls beyond the generic open-in-Google link, and any new OAuth scope.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | Clicking any rendered event chip in a connected month grid opens that event's detail in a right-side dock alongside the still-visible grid within ≤1 interaction; dismissing the dock returns the grid to full width with no visible reload; clicking another chip re-targets the single dock. |
| SC-002 | For an event carrying all fields, the detail shows title, time (correctly formatted for all-day vs timed), location, description, attendees, owning calendar, and a working external "Open in Google Calendar" link. |
| SC-003 | For events missing location / description / attendees, the detail renders cleanly with those sections omitted (or a calm placeholder for description) and never crashes. |
| SC-004 | No token, secret, or token-bearing URL appears in any renderer-visible payload or the external link; the feature requests no new OAuth scope. |
| SC-005 | Not-connected, reconnect-needed, and empty-month states expose no openable detail dock and never reach a broken dock; a malformed event degrades to the surface error boundary inside the dock, not a white-screen, and never takes down the grid beside it. |
| SC-006 | An open detail dock stays in its tab: switching tabs shows no dock bleed, and switching back shows the grid (the dock having closed on the switch). |

---

## Open Questions

- [ ] **External link availability.** Opening the event in Google Calendar is most reliable via the
  event's own `htmlLink` (returned by the Google events read). The plan resolves carrying it on the
  event without a new fetch. If, for any event, `htmlLink` is genuinely absent, the detail MUST
  simply omit the link (FR-010 degrades to "no link" rather than constructing a guessed URL). This is
  a degrade rule, not a blocker — **no user decision required.**
- [ ] **Description format.** Google event descriptions MAY contain HTML. v1 SHOULD render the
  description as **plain text** (consistent with the read-only, low-risk posture and avoiding a new
  sanitize surface), matching how the rest of the calendar surface avoids raw HTML. Rich/HTML
  description rendering is deferred. Flagged for confirmation but plain-text is the safe default — the
  plan proceeds with plain text unless the user wants otherwise.

- [ ] **Dock width & breakpoint.** The dock SHOULD reuse the Slack thread dock's proven sizing:
  side-by-side at/above a `@container` width threshold (Slack uses `32rem`) with the dock at
  `clamp(18rem, 42%, 28rem)` and `shrink-0`; below the threshold an absolute right-drawer overlay at
  `w-full max-w-[22rem]` with `shadow-lg`. These are sensible reused defaults — adopted unless the
  designer step tunes them to the calendar's denser 7-column grid. **No user decision required.**
- [ ] **Dismiss affordance.** v1 dismisses the dock via a **close/X control** in the dock header
  (always available) plus the **narrow-mode click-away scrim** (mirroring Slack). Esc-to-close is
  OPTIONAL and MAY be added for keyboard parity but is not required for v1. Default: X + scrim. **No
  user decision required.**

> No open question blocks implementation; each carries a safe default. Surfaced for visibility.
