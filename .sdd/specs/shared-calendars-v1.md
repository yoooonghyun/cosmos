# Spec: Shared / Multi-Calendar View (Google Calendar) — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: — (extends `.sdd/specs/google-calendar-v1.md`; that spec stays the base contract, this adds the multi-calendar increment)
**Related plan**: .sdd/plans/shared-calendars-v1.md

---

## Grounding

**codegraph_explore** (queries run → one-line takeaways):
- `googleCalendarClient getPrimaryCalendar /calendars/primary/events googleCalendarManager googleCalendarSurfaceBuilder` → `GoogleCalendarClient.listEvents` HARDCODES `/calendars/${GOOGLE_PRIMARY_CALENDAR_ID}/events` (single bounded page, `maxResults=50`, `singleEvents=true&orderBy=startTime`, cursor via `pageToken`); `getPrimaryCalendar` reads `/calendars/primary` for identity. The manager wraps every read in `run()` (proactive+reactive token refresh) and exposes only `listEvents(params)`.
- `googleCalendarSurfaceBuilder buildMonthGrid monthFromWindow GoogleCalendarPanel handleGoogleCalendarDefaultView registerGoogleCalendarIpcHandlers googleCalendarDefaultWindow listEvents client` → main's `handleGoogleCalendarDefaultView()` runs ONE bounded `listEvents(window)` then `buildDefaultViewSurface(page, window)`; the surface is a single `EventList` root `{events,timeMin,timeMax,hasMore}`; the catalog's `buildMonthGrid` buckets events by local day and `eventColorClasses(colorId)` colors each chip from the EVENT's own GCal `colorId` (1–11 → 6-token `--event-*` family). No calendar identity flows today.
- `GoogleCalendarBridge googleCalendarMcpServer googleCalendarRenderUiServer` (Read, verbatim) → the MCP read tool `google_calendar_list_events` and the render tool `render_google_calendar_ui` relay through `GoogleCalendarBridge` → the SAME `manager.listEvents`; the bridge op set is just `listEvents`; the render tool's adapter `dataSource` is `listEvents`, query carries only `{timeMin,timeMax,cursor?}` (non-secret).

**Read** (verbatim): `src/main/integrations/googleConfig.ts` (`calendar.readonly` is the single scope; `GOOGLE_CALENDAR_API_BASE = .../calendar/v3`; comment already notes the scope "grants list/read across the user's calendars"), `src/shared/googleCalendar.ts` (`GoogleCalendarEvent`/`GoogleCalendarEventsPage`/`GoogleCalendarResult`/`GoogleCalendarListEventsParams`/adapter descriptor/tool+op names), `src/renderer/googleCalendarCatalog/logic.ts` (color mapping, `buildMonthGrid`, `EventChipData`), `src/renderer/GoogleCalendarPanel.tsx` (default-view-on-switch + tabs), `.sdd/specs/google-calendar-v1.md` (FR-012 primary-only, "multiple calendars out of scope for v1"), `docs/ARCHITECTURE.md` §4.9/§7 item 4i.

**memory_recall / memory_smart_search**: `google calendar integration panel events color month grid` and `google calendar generative adapter color design surface` → no prior stored decision on multi-calendar; saved a new architecture memory capturing the two fixed decisions (aggregate+toggle, color-by-calendar) and the `calendarList` / no-new-scope finding.

---

## Overview

Expand the Google Calendar panel from showing only the signed-in account's **primary**
calendar to showing **every calendar that account can access** — calendars shared with the
user, subscribed calendars, holiday calendars, and the primary. Events from all accessible
calendars are merged into the single month grid and a per-calendar legend lets the user
show/hide each calendar; every event is colored by the calendar it belongs to. Remains
**read-only** (display only; no event creation, edit, RSVP, or new OAuth scope).

## User Scenarios

> P1 = must, P2 = should, P3 = nice to have.

### See events from all my calendars in one grid · P1

**As a** connected user who has other people's calendars and subscribed calendars shared with my Google account
**I want** the cosmos calendar grid to show events from ALL my accessible calendars, not just my primary one
**So that** cosmos's month view matches what I see on the Google Calendar web app.

**Acceptance criteria:**
- Given I am connected and my account can access several calendars, when the default month view loads, then the grid shows events merged from every accessible calendar for that month, not only the primary calendar.
- Given a calendar I can access has events in the shown month, when the grid renders, then those events appear in their day cells alongside events from my other calendars.
- Given my account has ONLY a primary calendar, when the grid loads, then it renders exactly as today (a single calendar's events), with no empty or broken legend.

### Tell calendars apart by color · P1

**As a** user looking at a merged grid
**I want** each calendar's events drawn in that calendar's own color
**So that** I can tell at a glance which calendar an event belongs to (Work=blue, Personal=green, Holidays=amber, …).

**Acceptance criteria:**
- Given events from multiple calendars are merged into the grid, when they render, then every event chip is colored by the calendar it belongs to (the same color for all events of one calendar), NOT by the event's own per-event color.
- Given a calendar's Google color does not exactly match one of cosmos's palette tokens, when its events render, then they use a stable, deterministic cosmos color derived from that calendar (the same calendar always gets the same cosmos color within a view) and never a raw/arbitrary hex or a wrong-looking swatch.
- Given the legend and the grid are both shown, when I read them, then a calendar's legend swatch matches the color of that calendar's event chips in the grid.

### Show or hide individual calendars · P1

**As a** user with many calendars
**I want** a per-calendar legend with a show/hide toggle for each calendar (like Google Calendar's left-side checkboxes)
**So that** I can declutter the grid to just the calendars I care about right now.

**Acceptance criteria:**
- Given the grid shows multiple calendars, when I view it, then I see a legend listing each accessible calendar with its name, its color swatch, and a show/hide control.
- Given a calendar is currently shown, when I toggle it off, then that calendar's events disappear from the grid immediately and the rest of the grid is unchanged (no reload, no lost tab).
- Given a calendar is currently hidden, when I toggle it back on, then its events reappear in the grid.
- Given I open the view, when it first loads, then the initially-shown calendars reflect each calendar's Google "shown/selected" preference (so the cosmos view starts consistent with the Google Calendar web app), with a sensible all-shown fallback when that preference is unavailable.

### One calendar fails without breaking the rest · P1

**As a** user whose accessible calendars include one that errors (permissions changed, transient failure)
**I want** the grid to still show my other calendars
**So that** a single bad calendar never blanks my whole month.

**Acceptance criteria:**
- Given several calendars are read for the month and one fails while the others succeed, when the grid renders, then it shows the successful calendars' events and does NOT fail the whole grid or show only an error.
- Given EVERY calendar read fails (or the account/connection itself fails), when the read completes, then the panel shows its existing recoverable error / reconnect-needed state (unchanged from today), never a crash or blank surface.

### No new permission prompt · P1

**As a** user who already connected Google Calendar
**I want** the shared-calendar view to work with my existing connection
**So that** I am not forced through OAuth consent again.

**Acceptance criteria:**
- Given I am already connected with the current read-only scope, when shared calendars ship, then the multi-calendar view works with my existing token — no re-consent, no new scope, no disconnect.

### Agent-rendered calendar surfaces stay in parity · P2

**As a** user who asks the embedded agent about my calendar
**I want** agent-rendered calendar surfaces to also reflect multiple calendars + per-calendar color
**So that** the native panel and the agent path don't diverge.

**Acceptance criteria:**
- Given the embedded `claude` composes a Google Calendar surface from calendar data, when it renders, then events carry the per-calendar color/identity the same way the native default view does (the MCP/bridge read path exposes the same calendar data), with no token leaving main.

## Functional Requirements

| ID     | Requirement |
|--------|-------------|
| FR-001 | The system MUST read the list of calendars the signed-in account can access (Google `GET /users/me/calendarList`) and use it as the set of calendars whose events the month view aggregates — replacing today's primary-only behavior. |
| FR-002 | The calendar-list read MUST work under the EXISTING read-only `calendar.readonly` scope: the system MUST NOT request any new OAuth scope and MUST NOT force re-consent or disconnect an already-connected user for this feature. |
| FR-003 | For each accessible calendar, the system MUST capture its non-secret identity for the view: a calendar id, a display name (`summary`/`summaryOverride`), the calendar's Google color (`backgroundColor`), the primary flag, the access role, and Google's per-account "shown" preference (`selected`). No token, secret, or other sensitive field MUST be carried. |
| FR-004 | The default month view MUST aggregate events from ALL accessible calendars: the system MUST read each calendar's events for the SAME month window and merge them into the single month grid the panel already renders. |
| FR-005 | Each merged event MUST carry the identity of the calendar it came from (its calendar id), so the renderer can color it by calendar and a toggle can filter it — this MUST flow main → surface → catalog as non-secret data, never leaking any secret. |
| FR-006 | Every event MUST be colored by its OWNING CALENDAR (one color per calendar, shared by all that calendar's events), replacing today's color-by-per-event-`colorId` behavior in this view. |
| FR-007 | A calendar's Google color MUST map deterministically onto cosmos's bounded design-token color palette (the existing `--event-*` family, extended by the designer as needed): the same calendar MUST always resolve to the same cosmos token within a view, no raw hex MUST reach a component, and an unknown/odd color MUST degrade to a safe fallback token rather than throw or show a wrong hue. (The concrete token set + mapping function are the design/plan step's to fix; this spec fixes only the requirement.) |
| FR-008 | The panel MUST render a per-calendar **legend**: one entry per accessible calendar showing the calendar's name, its color swatch (matching its event chips), and a show/hide control — mirroring the Google Calendar web UI's left-side calendar checkboxes. |
| FR-009 | Toggling a calendar in the legend MUST immediately show/hide that calendar's events in the grid WITHOUT a server reload, without an agent round-trip, and without tearing down or losing the active tab. |
| FR-010 | The legend's initial shown/hidden state MUST default from each calendar's Google `selected` preference (so cosmos starts consistent with the web app); when that preference is absent/unreadable for a calendar, that calendar MUST default to shown. |
| FR-011 | Calendar show/hide toggle state is a renderer-only VIEW concern; it MUST NOT cause secrets or tokens to cross any boundary and MUST NOT be required to round-trip to main to take effect. Whether toggle state survives a tab/session restore is a design choice the plan MAY settle, but the DEFAULT (re-derive from Google `selected` on load) MUST remain correct if it is not persisted. |
| FR-012 | A per-calendar event read that FAILS while others succeed MUST NOT fail the whole grid: the system MUST render the successfully-read calendars' events and skip/omit the failed calendar's events (optionally noting it), consistent with the panel's existing "never a blank or crashing surface" guarantee. Only when there is NO usable data (every calendar failed, or the account/connection itself failed) MUST the panel fall back to its existing error / reconnect-needed state. |
| FR-013 | The aggregated read MUST be **bounded**: the system MUST cap the work it does for one month view (a bounded number of calendars and a bounded events read per calendar — today one page per calendar) so that an account with many calendars cannot make the view do unbounded work or hang. The exact bounds are the plan's to fix; the requirement is that the view stays responsive and bounded. |
| FR-014 | When the account can access only ONE (primary) calendar, the feature MUST DEGRADE to today's behavior: a single calendar's events in the grid, with a legend that is consistent (a single, possibly-suppressible entry) and never empty/broken. |
| FR-015 | An accessible calendar that is empty for the shown month, or initially hidden, MUST be handled gracefully: its legend entry still appears (so it can be toggled), and an empty month across all shown calendars MUST still render the existing empty "no events" grid, not an error. |
| FR-016 | The change MUST preserve PARITY across BOTH surfaces fed by this data: the native panel (IPC default-view path) AND the MCP/agent render path (bridge + surface builder) MUST both carry the multi-calendar + per-calendar-color/identity data. Any change to the shared surface/read contract MUST keep both callers working off one implementation. |
| FR-017 | Every new/changed cross-process payload (the calendar list, the per-calendar event reads, the surface) MUST be validated at the main-process boundary; an invalid payload MUST be warned-and-ignored, never crash the process — consistent with the existing IPC/bridge discipline. |
| FR-018 | The feature MUST remain READ-ONLY: no write scope, no event create/edit/delete, no RSVP, no new write MCP tool, no deterministic action dispatcher. It only reads and displays more calendars. |

## Edge Cases & Constraints

- **Only a primary calendar.** Degrades to today's single-calendar grid (FR-014); the legend must not look broken or empty.
- **One calendar errors, others succeed.** Render the successes; skip the failure; never fail the whole grid (FR-012).
- **All calendars error / connection fails.** Existing recoverable error or reconnect-needed state (unchanged).
- **Many calendars.** The aggregated read is bounded (FR-013) so the view stays responsive; ordering/priority of which calendars are read first (e.g. primary + selected first) is a plan concern, not a behavior promise here.
- **Calendar shown vs hidden in Google.** Initial legend state follows Google `selected` (FR-010); a calendar hidden in Google starts hidden in cosmos but is still toggle-able.
- **Empty / hidden calendar.** Still gets a legend entry; an all-empty/all-hidden month shows the existing empty grid, not an error (FR-015).
- **Color collisions.** Two calendars whose Google colors map to the same cosmos token is acceptable (the bounded palette may collapse colors); the name in the legend disambiguates. Color is reinforcement, not the sole signal (consistent with the existing catalog's stance).
- **Duplicate events across calendars.** The same event visible on more than one accessible calendar (e.g. an invite that also appears on a shared calendar) MAY appear once per calendar; de-duplication is NOT required in v1 (out of scope, can be a later increment).
- **Time zones / all-day vs timed.** Unchanged from `google-calendar-v1` — events still render in the user's local/primary time zone with the existing all-day vs timed handling.
- **Out of scope (this increment):** any write (create/edit/delete/RSVP); a new OAuth scope; choosing/persisting which account; week view; per-event (rather than per-calendar) coloring as a user option; cross-calendar de-duplication; reminders/notifications; calendar reordering or grouping; pagination across many pages per calendar (the bounded single-page-per-calendar read is retained unless the plan revisits it).

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | With an account that can access multiple calendars, the default month grid shows events merged from all accessible calendars — not just the primary — for the shown month. |
| SC-002 | Every event chip is colored by its owning calendar (one color per calendar), and each legend swatch matches that calendar's chips; no raw hex reaches a component and an unknown calendar color degrades to a safe token. |
| SC-003 | A per-calendar legend lists each accessible calendar with name + swatch + a show/hide control; toggling a calendar off hides its events from the grid immediately and toggling it on restores them, with no reload and no lost tab. |
| SC-004 | The legend's initial shown/hidden state matches each calendar's Google `selected` preference, with an all-shown fallback when that preference is unavailable. |
| SC-005 | An already-connected user gets the multi-calendar view with no re-consent, no new scope, and no disconnect. |
| SC-006 | When one accessible calendar's read fails and others succeed, the grid still shows the successful calendars; only an all-calendars/connection failure falls back to the existing error/reconnect state; an invalid payload is warned-and-ignored, never a crash. |
| SC-007 | An account with only a primary calendar renders exactly as today (single-calendar grid, consistent legend); an empty month shows the existing "no events" grid, not an error. |
| SC-008 | Both the native panel default view and the agent/MCP render path carry the multi-calendar + per-calendar-color/identity data off one shared implementation, and no token/secret crosses any boundary. |
| SC-009 | The feature ships with no write capability added: no write scope, no event-mutation tool, no action dispatcher. |

---

## Open Questions

> Resolved below per the two FIXED user decisions + codebase grounding; remaining items are explicitly deferred to the plan/design step, not blockers.

- [x] **Aggregate vs per-calendar switcher.** RESOLVED (fixed user decision): aggregate ALL accessible calendars into the single month grid AND provide a per-calendar legend/toggle. Not re-litigated.
- [x] **Color basis.** RESOLVED (fixed user decision): color by calendar (one color per calendar), replacing today's per-event-`colorId` coloring in this view.
- [x] **New OAuth scope?** RESOLVED (grounding): `calendar.readonly` already grants `calendarList` + per-calendar event reads (`googleConfig.ts` notes the scope "grants list/read across the user's calendars"); NO new scope, NO re-consent (FR-002).
- [ ] **Toggle-state persistence (plan/design).** This spec requires toggles to be renderer-only and to DEFAULT from Google `selected` on each load (FR-010/FR-011). Whether a user's manual toggles also persist across tab/session restore (vs always re-deriving from `selected`) is left to the plan; either choice must keep FR-010's default correct.
- [ ] **Per-calendar read bounds (plan).** FR-013 requires the aggregated read to be bounded; the concrete caps (max calendars read, which calendars to prioritize, page count per calendar) and whether to read calendars concurrently are the plan's to fix.
- [ ] **Color-token palette extension (design).** FR-007 fixes the requirement (deterministic, bounded, token-only, safe fallback); the concrete `--event-*` palette additions and the calendar-color → token mapping function are the designer's to settle, since arbitrary calendar `backgroundColor`s exceed today's 6-token family.
