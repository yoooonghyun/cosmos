# Spec: Calendar Week view + Day view — v1

**Status**: Draft
**Created**: 2026-06-20
**Supersedes**: —
**Related plan**: .sdd/plans/calendar-week-day-views-v1.md
**Issue**: #89

---

## Grounding

Direct investigation run for this spec (tools invoked by the architect, not handed in):

**codegraph_explore**
- `GoogleCalendarPanel CalendarMonthGrid DayCell EventList EventChip eventDetailLogic calendarNav openDetail googleCalendarSurfaceBuilder` — panel owns per-tab `monthIntents` (ephemeral `Map<tabId,{year,month}>`, NOT persisted), the `genUiEvent` detail-dock state hoisted to the panel root, and `handleSurfaceAction` intercepting `calendarNav.openDetail` (renderer-local, never forwarded to main).
- `googleCalendarClient listEvents requestDefaultView hiddenCalendarIds shared googleCalendar DTO ipc googleCalendar channel` — `listEvents(timeMin,timeMax,…,calendarId)` is range-driven; `listAggregatedEvents(window)` fans out per-calendar over ONE window, tags each event `calendarId`. Read-only under existing `calendar.readonly` scope.
- `googleCalendarSurfaceBuilder buildDefaultView buildSharedViewSurface listEventsAllCalendars legend colorToken EventListNode` — `buildSharedViewSurface` emits ONE `EventList` root carrying `events[]` (each tagged `calendarId`), `calendars[]` (resolved legend tokens), `timeMin`/`timeMax`, `hasMore`. The catalog `EventList` buckets the flat events into a month grid via `logic.ts` and owns the renderer-only `hiddenCalendarIds` toggle.
- `handleGoogleCalendarDefaultView googleCalendarDefaultWindow validateGoogleCalendarRequestDefaultView` — `googleCalendarDefaultWindow(target?)` builds `{timeMin,timeMax}` from `{year,month}` (1-based wire). `validateGoogleCalendarRequestDefaultView` returns `{}` (current month) for absent/invalid payloads; only a non-object is dropped. The window is the SINGLE thing that decides what is fetched.

**memory_recall / memory_smart_search**
- `google calendar panel month grid event detail dock multi-calendar color legend hidden calendars` and `calendar surface builder generative UI per-tab nav state range fetch` — no stored observations (agentmemory empty for this area). Architecture facts taken from `docs/ARCHITECTURE.md` §4i (google-calendar-v1, shared-calendars-v1, calendar-month-year-nav-v1, calendar-event-detail-v1).

Takeaway: the fetch range is owned entirely by the main-composed window; the surface root already carries everything week/day rendering needs (flat events tagged by calendar + legend + window bounds). Week/Day is therefore a **window-granularity + layout** change, not a new data path, IPC channel, scope, or detail-dock fork.

---

## Overview

The Google Calendar panel today renders a **month grid only**. This feature adds a **Month / Week / Day view switcher** so the user can also see a **time-of-day schedule** — a vertical hour axis with timed events placed and sized by their start/end times — for the current week (7 day columns) or a single day (1 column), like Google Calendar's week/day views. Week and Day reuse the SAME multi-calendar event data, per-calendar color, legend, hidden-calendar toggles, and the existing event-detail dock; only the visible time range and the layout change. Read-only — no event create/edit (future scope).

## User Scenarios

### Switch to Week view and read my week at a glance · P1

**As a** cosmos user with Google Calendar connected
**I want to** switch the calendar panel from Month to a Week schedule
**So that** I can see my timed events laid out by hour across the 7 days of the current week

**Acceptance criteria:**
- Given the calendar panel is showing the Month grid, when I click "Week" in the view switcher, then the panel renders 7 day columns with a vertical hour axis, the current week (containing today) is shown, and today's column is visually marked.
- Given Week view is showing, when an event has a start and end time, then it appears as a block in its day column positioned at its start time and sized to its duration.
- Given Week view is showing, when an event is all-day (or spans the whole day), then it appears in a top all-day row above the time grid, not inside the hour axis.
- Given Week view is showing across multiple calendars, then each event block is colored by its owning calendar and the legend + hidden-calendar toggles behave exactly as in Month view.

### Switch to Day view for a focused single day · P1

**As a** cosmos user
**I want to** switch to a single-day schedule
**So that** I can focus on one day's timed events on the hour axis

**Acceptance criteria:**
- Given any view is showing, when I click "Day", then the panel renders one day column (today by default) with the same hour axis, all-day row, and timed-event placement as Week view.
- Given Day view is showing, when I navigate previous/next, then the view moves one day at a time.

### Navigate weeks and days · P1

**As a** user
**I want to** move forward/back by week (in Week) or by day (in Day) and jump back to today
**So that** I can review or look ahead on the same schedule layout

**Acceptance criteria:**
- Given Week view, when I click previous/next, then the visible 7-day range shifts by one week and the events for that week load across all visible calendars.
- Given Day view, when I click previous/next, then the visible day shifts by one day and that day's events load.
- Given I have navigated away from the current week/day, when I click "Today", then the view returns to the week/day containing today; when already current, "Today" is a no-op (no re-read).

### Click an event in Week/Day to open its detail · P1

**As a** user
**I want to** click an event block in Week or Day view
**So that** I see the same event-detail dock I get from the month grid

**Acceptance criteria:**
- Given Week or Day view, when I click an event block with a usable id, then the existing right-side event-detail dock (calendar-event-detail-v1) opens showing that event's details (title, time, location, description, attendees, calendar swatch, open-in-Google link), rendered from the event's carried props with no extra fetch.
- Given the dock is open, when I click another event block, then the dock retargets to that event and the previously selected block clears its selected marker.
- Given the dock is open, when I switch view (Month/Week/Day), switch tab, navigate the range, or disconnect, then the dock closes (transient), matching the existing Month behavior.

### Persist my chosen view per tab · P2

**As a** user with multiple calendar tabs
**I want** each tab to remember its own view (Month/Week/Day) and its navigated range while the app is open
**So that** switching tabs does not reset what I was looking at

**Acceptance criteria:**
- Given tab A is in Week view and tab B is in Month view, when I switch between them, then each tab keeps its own view and navigated range.
- Given a fresh `+` tab or an app reload, then the new/restored live tab defaults to Month view at the current month (no week/day state persisted across reload).

### Degrade gracefully when not connected or a read fails · P1

**As a** user
**I want** Week/Day to behave like Month when disconnected, loading, empty, or on a recoverable error
**So that** the panel never crashes or strands me

**Acceptance criteria:**
- Given the account is not connected / reconnect_needed, when any view is selected, then the panel shows the native Connect/Reconnect affordance (the view switcher is inert or hidden), unchanged from Month.
- Given a Week/Day read is in flight, then a loading skeleton appropriate to the schedule layout is shown.
- Given a Week/Day range has no events, then the hour axis renders with an empty (calm) state, no error.
- Given a recoverable read failure (rate_limited/network), then the same recoverable Notice is shown as in Month view.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | The panel MUST offer a Month / Week / Day view switcher, placed in/near the existing default-view nav header, visible ONLY for the live default view (connected, un-composed surface) — composed snapshots and the not-connected state MUST NOT show it. |
| FR-002 | Month MUST remain the default view for a fresh/seeded/restored live tab. |
| FR-003 | The selected view MUST be held PER-TAB and ephemeral (renderer-only, NOT persisted in the session snapshot) — consistent with the existing per-tab `monthIntents`; a fresh `+` tab or app reload starts at Month/current month. |
| FR-004 | Week view MUST render 7 day columns over a vertical hour axis spanning the day, defaulting to the week containing today, with today's column marked. |
| FR-005 | Day view MUST render a single day column over the same hour axis, defaulting to today. |
| FR-006 | A TIMED event MUST be placed in its day column at a vertical offset proportional to its start time and sized proportional to its (end − start) duration; placement/size math MUST live in a pure, node-testable `.ts` helper. |
| FR-007 | An ALL-DAY event MUST render in a top all-day row above the hour axis (per day column), NOT inside the timed grid. |
| FR-008 | When timed events in the same day column overlap, the view MUST lay them out side-by-side within the column, splitting the column width across the concurrent set (a minimal column-packing rule); the rule MUST be deterministic and node-testable. |
| FR-009 | Week view nav MUST step the visible range by one whole week (prev/next) and offer "Today" (returns to the current week; no-op when already current). |
| FR-010 | Day view nav MUST step the visible range by one day (prev/next) and offer "Today" (returns to today; no-op when already current). |
| FR-011 | Week/Day reads MUST fetch events across ALL visible calendars over the view's range (7-day / 1-day window) using the SAME aggregated multi-calendar path as Month — no new OAuth scope, read-only. |
| FR-012 | The range/granularity MUST be expressed through the existing single typed IPC contract by extending the `requestDefaultView` payload (an additive optional granularity + anchor), NOT by inventing a new channel; an absent/invalid payload MUST fall back to the current-month behavior (warn-and-ignore at the main boundary, never crash). |
| FR-013 | Week/Day event blocks MUST be colored by their owning calendar and MUST honor the same legend + hidden-calendar toggles as Month (reusing the surface's `calendars[]` legend and the renderer-only hidden-set). |
| FR-014 | Clicking an event block in Week/Day MUST open the EXISTING event-detail dock (calendar-event-detail-v1) by emitting the SAME `calendarNav.openDetail` renderer-local action carrying the whole event — the dock MUST NOT be forked or refetched. |
| FR-015 | The dock MUST be transient in Week/Day exactly as in Month: it MUST clear on view-switch, tab-switch, range-navigation, and disconnect/reconnect_needed. |
| FR-016 | The view-switch and range-nav MUST re-issue the default-view request for the active tab (marking it loading) so the surface repaints for the new range, reusing the existing latest-wins / stale-read gate so an out-of-order read never paints over a newer selection. |
| FR-017 | This feature MUST remain READ-ONLY: no event creation, editing, or deletion; no new write scope, write IPC, or write MCP tool. |
| FR-018 | No token or secret MAY cross any IPC payload, surface, or render frame introduced here; the payload remains structurally `{ granularity?, anchor… }` only. |
| FR-019 | Week/Day MUST degrade identically to Month for not-connected/reconnect_needed (native Connect/Reconnect, no switcher), loading (a schedule-shaped skeleton), empty range (calm empty axis), and recoverable failure (the existing Notice). |

## Edge Cases & Constraints

- **DST transitions**: a day that is 23 or 25 hours long (spring-forward / fall-back) MUST still render without misplacing or clipping events; the time-axis helper MUST derive offsets from the day's actual local boundaries, not assume a fixed 24×60 minutes.
- **Event crossing midnight** (timed event whose start and end are on different local days): it MUST appear in EACH day column it overlaps, clamped to that day's visible bounds (top/bottom edges), so neither end is lost.
- **Multi-day timed event** (spans 3+ days): same clamping per overlapped day column within the visible range; days outside the range simply do not show it.
- **Empty day / empty week**: the hour axis renders with the all-day row empty and no timed blocks — a calm empty state, not an error.
- **Very dense day** (many overlapping events): the column-packing rule MUST stay deterministic and bounded; a minimal rule (equal-width split across the concurrent group) is acceptable for v1 — heavy lanes may get visually thin but MUST NOT overflow the column or throw.
- **Zero-duration / end-before-start / unparseable times**: degrade to a minimum-height block at the start (or drop from the timed grid if start is unparseable) — never throw; mirrors the existing chip degrade rules.
- **All-day event spanning multiple days** in Week: render across the all-day row of each covered day column (or a single spanning bar) — pick the minimal approach and note it in the plan.
- **Out of scope (explicit)**: event create/edit/delete; drag-to-move/resize; per-event RSVP; agenda/list view; multi-week (e.g. 2-week) layouts; custom week-start preference UI (week-start follows the existing Month convention, Sunday); persisting view choice across app restart.

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-001 | From the Month grid, a user can switch to Week and Day and back; Month is the default and the switcher only appears on the live default view. |
| SC-002 | In Week, the 7 columns show the current week with timed events positioned/sized by start–end and all-day events in the top row; Day shows the same for one day. |
| SC-003 | Prev/next steps one week (Week) or one day (Day); "Today" returns to the current range and is a no-op when already current. |
| SC-004 | Week/Day use the same aggregated multi-calendar events, per-calendar color, legend, and hidden-calendar toggles as Month, with no new OAuth scope. |
| SC-005 | Clicking an event block in Week/Day opens the SAME detail dock (no refetch, no fork), retargets on a second click, and clears on view/tab/range/disconnect changes. |
| SC-006 | The time-axis placement, overlap-packing, and midnight-clamp logic are covered by node tests on a pure helper, including DST and cross-midnight cases. |
| SC-007 | The feature ships with ONE extended typed IPC contract (no new channel), no token in any payload, and no write path. |
| SC-008 | Not-connected, loading, empty, and recoverable-error states behave identically to Month across all three views. |

---

## Open Questions

- [ ] None blocking. Default decisions recorded: Month stays default; view + navigated range are per-tab ephemeral (not persisted across reload); the range is selected by extending `requestDefaultView` with an optional granularity + anchor (main builds the week/day window, mirroring the month window) rather than over-fetching and filtering in the renderer; the overlap rule is a deterministic equal-width split across each concurrent group; week-start follows the existing Sunday convention.
