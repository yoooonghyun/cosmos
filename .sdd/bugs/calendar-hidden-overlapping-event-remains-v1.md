# Bug: hiding a calendar leaves some (overlapping) events on the week/day schedule

ID: `calendar-hidden-overlapping-event-remains-v1`
Skill: bugfix → Implementation defect (route: `developer`)
Reported: 2026-06-30

## Symptom (user)

In the Google Calendar panel, when an event's UI overlaps others (the week/day schedule's
lane-split overlap), HIDING that event's calendar in the legend does NOT remove the event — it
stays on the grid. (Original phrasing also mentioned creating/registering an event then it
remaining; clarified repro = "hide calendar → the (overlapping) event remains".)

## Orchestrator grounding (the visibility FILTER itself looks correct — suspect the DATA / id-space)

The week/day schedule already filters by the hidden set BEFORE layout, and the memo is content-keyed
(the prior `calendar-selection-persistence` / week-day-deselect fix):
- `ScheduleView` (`components.tsx:1006-1011`): `visible = useMemo(() => visibleEvents(events,
  hiddenCalendarIds), [events, hiddenKey])`, `hiddenKey = hiddenCalendarsKey(hiddenCalendarIds)`
  (content-keyed, NOT Set identity) — so a toggle re-runs the filter.
- `visibleEvents` (`logic.ts:272-282`): `list.filter(ev => !(typeof ev.calendarId === 'string' &&
  hidden.has(ev.calendarId)))` — drops an event IFF its `calendarId` is a string AND is in the
  hidden set. An event with NO `calendarId`, or whose `calendarId` is NOT in the hidden set, is
  ALWAYS shown (logic.test.ts: "an event with NO calendarId is always visible").
- `buildDayColumn`/`assignLanes` (`scheduleLayout.ts`) consume the ALREADY-filtered list and don't
  re-filter.

So the filter + memo are correct. An event that REMAINS after hiding its calendar can only be one
whose `ev.calendarId` does NOT equal the id that the legend toggle puts into the `hidden` set —
i.e. an ID-SPACE MISMATCH or an ABSENT `calendarId` on the lingering events. The "overlap"
correlation is most likely incidental (the lingering events happen to be the ones the user created /
on a particular calendar, which overlap existing ones) — but CONFIRM that; if overlap is truly
causal, the bug is instead in the lane/render path, not the filter.

Prime suspects for the id mismatch (the owner must reproduce + verify):
- What `calendarId` does each rendered event carry vs what id does the legend toggle add to `hidden`?
  The legend entry id (`CalendarLegendData.id`) and the event's `calendarId` must be the SAME id
  space. Check the surface builder (`src/main/calendar/googleCalendarSurfaceBuilder.ts`) — does it
  stamp every event's `calendarId` with the owning calendar's id, and does the legend carry that
  SAME id? Watch for `primary` vs the account-email id, a shared-calendar address vs an override, or
  a created event coming back without `calendarId`.
- Whether freshly-CREATED events (the original "등록" path) re-fetch with a `calendarId` at all.

## To do (developer)

1. Reproduce (week or day view, two overlapping events on a calendar, hide it) and inspect the
   lingering event's `calendarId` vs the `hidden`-set entry the legend toggle adds. Confirm the real
   cause to `file:line`: id-space mismatch / absent `calendarId` (filter can't match) vs a genuine
   overlap-layout/render-key bug. Ground with codegraph + `wiki_query` (debugging — "google calendar
   visibility hidden week day deselect").
2. Fix at root: make the event's `calendarId` and the legend toggle id share ONE id space so
   `visibleEvents` matches (most likely in the surface builder's stamping, or normalize the id at the
   filter). If instead it's an overlap-layout bug, fix the lane/key path. Keep the existing
   week/day-deselect + persistence behavior intact (don't regress `hiddenCalendarsKey`).
3. Keep secrets in main; the calendar id is non-secret identity (already crosses today).

## Regression test

Node-unit at the layer that reproduces it: `visibleEvents` / the schedule layout with an event whose
`calendarId` matches the hidden id is DROPPED even within an overlap group (and the surface builder
stamps the matching id) — RED before the fix, GREEN after. If the cause is the builder's id
stamping, a `googleCalendarSurfaceBuilder.test.ts` case that every event's `calendarId` equals its
legend calendar id. Update `docs/TEST-SCENARIOS.md`.

## Verification

`npm run typecheck` + `npm test` (+ `npm run test:dom` if a render path) green incl. the new test;
exercise in `npm run dev` — hide a calendar with overlapping events on the week/day view; every one
of its events disappears.
