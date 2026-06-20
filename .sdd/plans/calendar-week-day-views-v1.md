# Plan: Calendar Week view + Day view — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/calendar-week-day-views-v1.md
**Issue**: #89

---

## Grounding

Same direct investigation as the spec's Grounding section (codegraph_explore over the panel, catalog, surface builder, client/IPC, and the main default-view handler; agentmemory empty for this area, architecture facts from `docs/ARCHITECTURE.md` §4i). Load-bearing findings driving the plan:

- The fetched range is owned ENTIRELY by `googleCalendarDefaultWindow(target?)` → `listAggregatedEvents(window)`. Changing `{timeMin,timeMax}` is the only lever needed to fetch a week or a day across all calendars. (`src/main/index.ts`)
- The surface root `EventList` already carries flat `events[]` (each tagged `calendarId`), `calendars[]` legend, and `timeMin`/`timeMax`. Week/Day rendering needs no new surface fields — it derives the layout from those same props. (`src/renderer/googleCalendarCatalog/components.tsx`, `src/main/googleCalendarSurfaceBuilder.ts`)
- Per-tab ephemeral nav state already exists as `monthIntents: Map<tabId,{year,month}>` in `GoogleCalendarPanel.tsx`, NOT persisted, surviving the `A2UIProvider key={tab.id}` remount, cleared on disconnect. The view + week/day anchor join this exact pattern.
- The detail dock is panel-root state (`genUiEvent`) opened by `handleSurfaceAction` intercepting `calendarNav.openDetail`. Reuse requires only that Week/Day event blocks dispatch the SAME action — no new seam.
- Nav arithmetic + the latest-wins stale gate live in pure `src/renderer/calendarNavLogic.ts` (`CalendarMonthIntent`, `toWirePayload`, `isSurfaceForIntent`). Week/Day add sibling pure helpers there or in a new pure file.

## Summary

Add a Month / Week / Day switcher to the Google Calendar panel. Week and Day are time-of-day schedule layouts reusing the existing aggregated multi-calendar data, legend, hidden-calendar toggles, and event-detail dock. The fetch range is selected by **extending the existing `requestDefaultView` IPC payload** with an additive optional `view` granularity (`'month' | 'week' | 'day'`) plus the existing year/month anchor extended to a full date anchor; main's `googleCalendarDefaultWindow` builds a month / 7-day / 1-day window accordingly and the existing aggregated fan-out fetches it. The renderer holds the chosen view + anchor PER-TAB (ephemeral, like `monthIntents`), re-issues the default-view request on switch/nav, and the catalog `EventList` root picks its layout (month grid vs. a new schedule layout) from the surface's window span. A new pure `.ts` helper owns all time-axis placement, overlap column-packing, and cross-midnight clamping (node-tested). The detail dock is reused unchanged — Week/Day event blocks dispatch the same `calendarNav.openDetail` action. UI-bearing → a **designer step** precedes implementation.

## Technical Context

| Item | Value |
|------|-------|
| Language | TypeScript (Electron main + React renderer), A2UI 0.9 surfaces |
| Key dependencies | Existing Google Calendar stack only — no new runtime deps, no new OAuth scope, no new MCP server/rollup input (reuses the `google-calendar` target + render server) |
| New IPC channel? | NO — extend the existing `googleCalendar:requestDefaultView` payload + its validator |
| Files to create | `src/renderer/googleCalendarCatalog/scheduleLayout.ts` (pure time-axis + overlap-packing + cross-midnight helpers) and its `.test.ts`; `src/renderer/googleCalendarCatalog/components.tsx` gains the schedule-view components (WeekView/DayView/TimeAxis/EventBlock/AllDayRow) — may split into a `scheduleComponents.tsx` if `components.tsx` grows too large; `.sdd/designs/calendar-week-day-views-v1.md` (designer) |
| Files to modify | `src/shared/ipc/googleCalendar.ts` (extend `GoogleCalendarRequestDefaultViewPayload` with `view?` + date anchor), `src/shared/ipc/googleCalendar.validate.ts` (validate the new fields, warn-and-fallback), `src/preload/index.ts` (pass-through, no shape change beyond the typed param), `src/main/index.ts` (`googleCalendarDefaultWindow` builds month/week/day window; `handleGoogleCalendarDefaultView` takes the granularity), `src/renderer/calendarNavLogic.ts` (week/day anchor + step + toWire helpers, or a sibling pure file), `src/renderer/GoogleCalendarPanel.tsx` (per-tab `view` + anchor state, switcher wiring, nav per granularity, re-issue requests), `src/renderer/googleCalendarCatalog/components.tsx` + `logic.ts` (route `EventList` to month vs schedule layout by window span; the schedule components), `src/renderer/googleCalendarCatalog/navContext.ts` (extend the nav context with view + granularity-aware handlers), `docs/ARCHITECTURE.md` §4i (record the week/day decision) |

### Approach notes (the "how")

- **Range = extend IPC, do NOT over-fetch + filter.** Smallest change: the payload already carries the anchor; main already builds the window. Add `view?: 'month' | 'week' | 'day'` and generalize the anchor to a date (keep `{year, month}` working for month; add an optional day component for week/day, all 1-based on the wire as today). `googleCalendarDefaultWindow` switches on `view` to build the month / week-containing-anchor / single-day window; everything downstream (`listAggregatedEvents`, legend, color, dock) is unchanged. The validator returns the current-month-month fallback for absent/invalid, exactly as today.
- **Renderer view selection.** The catalog `EventList` already receives `timeMin`/`timeMax`. Derive the layout from the window SPAN (≈1 day → Day, ≈7 days → Week, else Month) OR carry an explicit `view` field on the surface root for robustness — prefer an explicit additive `view?` prop on `EventList` set by the surface builder (avoids span-guessing across DST/short months). Pure `logic.ts` maps the surface to the chosen layout.
- **Time-axis math in a pure helper** (`scheduleLayout.ts`): given a day's local start/end boundaries and an event's start/end, compute `{ topPct, heightPct }` clamped to the day; given a day's events, compute overlap groups and assign each a `{ laneIndex, laneCount }` (equal-width split). Cross-midnight/multi-day events are clamped per day column. All pure, node-tested incl. DST (23h/25h day), cross-midnight, zero/negative duration, dense overlap.
- **Per-tab state.** Add a per-tab `view` + (for week/day) a day-granularity anchor to the panel, mirroring `monthIntents` (ephemeral Map, not persisted, cleared on disconnect, survives remount). Reuse `requestDefaultInActiveTab` to re-issue on switch/nav. Reuse `isSurfaceForIntent`-style latest-wins gating generalized to compare the surface's window against the active view+anchor.
- **Detail dock reuse.** Week/Day `EventBlock` renders the same interactive `<button>` and dispatches `CALENDAR_OPEN_DETAIL_ACTION` with the whole event — `handleSurfaceAction` and the panel-root dock are untouched. `CalendarDetailContext` already flows the selected id down for the selected marker.
- **Legend/hidden reuse.** The schedule layout consumes the SAME `calendars[]` legend + renderer-only `hiddenCalendarIds` set already computed in `EventList`; it filters/colors event blocks with the existing `eventColorClassesByCalendar` + hidden-set logic.

## Implementation Checklist

### Phase 0 — Design (designer, REQUIRED — UI-bearing)
- [ ] Designer authors `.sdd/designs/calendar-week-day-views-v1.md`: the view switcher (placement near the month nav header, control style), the time-axis grid (hour gutter, gridlines, day-column headers, today marker), event blocks (timed block, all-day row, overlap lanes, selected/hover states matching the chip), and all states (loading skeleton, empty axis, dense day). Extends existing `--event-*` tokens + shadcn/ui; introduces no raw hex. Confirms week-start = Sunday.

### Phase 1 — Interface
- [ ] Read the spec; confirm no open questions remain.
- [ ] Extend `GoogleCalendarRequestDefaultViewPayload` (`src/shared/ipc/googleCalendar.ts`) with `view?: 'month' | 'week' | 'day'` and the day-granularity anchor (additive, optional; document 1-based wire + no-secret invariant).
- [ ] Add an additive optional `view?` to the `EventList` surface root type (`EventListNode`) and the surface builder output.
- [ ] Define the pure layout types in `scheduleLayout.ts` (DayBounds, PlacedEvent `{ topPct, heightPct, laneIndex, laneCount }`, AllDayItem).
- [ ] Review types vs spec — no invented properties; payload stays `{ view?, anchor… }` only.

### Phase 2 — Testing (write first / alongside)
- [ ] `scheduleLayout.test.ts`: placement (start/duration → top/height), clamping (cross-midnight, multi-day, event outside day), DST 23h/25h day, zero/negative/unparseable duration, overlap packing (disjoint → 1 lane; nested/overlapping → correct laneCount/laneIndex; dense group bounded).
- [ ] `calendarNavLogic`/week-day nav helper tests: week-containing-anchor, step week/day, isCurrent, current-vs-navigated, toWire round-trip (1-based).
- [ ] `validate` tests: valid month payload (back-compat), valid week/day payload, partial/out-of-range/invalid `view` → current-month fallback (warned), non-object → dropped.
- [ ] `googleCalendarDefaultWindow` window-math test (node): month vs week vs day windows for a fixed anchor (consider extracting it to a pure helper if not already test-reachable).

### Phase 3 — Implementation
- [ ] `googleCalendar.validate.ts`: validate `view` + anchor; warn-and-fallback to current month; never crash.
- [ ] `src/main/index.ts`: `googleCalendarDefaultWindow` builds month/week/day window from `{view, anchor}`; thread the view through `handleGoogleCalendarDefaultView`; surface builder sets `view` on the `EventList` root.
- [ ] `preload/index.ts`: pass the extended typed param through `requestDefaultView` (no behavior change).
- [ ] `GoogleCalendarPanel.tsx`: per-tab `view` + week/day anchor (ephemeral Map, cleared on disconnect, survives remount); the Month/Week/Day switcher (live default view only); prev/next/today wired per granularity; re-issue `requestDefaultView` on switch/nav; generalize the latest-wins gate.
- [ ] `googleCalendarCatalog/components.tsx` + `logic.ts`: `EventList` routes to month grid vs schedule layout by `view`; implement WeekView/DayView (TimeAxis, day columns + headers, AllDayRow, EventBlock) consuming `scheduleLayout.ts`; EventBlock is the same interactive button dispatching `calendarNav.openDetail`; color by calendar + honor the hidden-set; empty/skeleton states.
- [ ] `navContext.ts`: extend the nav context to carry the current view + granularity-aware handlers (keep month handlers working).
- [ ] All tests pass; `npm run typecheck` clean.

### Phase 4 — Docs
- [ ] Update `docs/ARCHITECTURE.md` §4i: record the Month/Week/Day switcher, the `requestDefaultView` payload extension (view + date anchor, still no scope/channel/secret added), the pure `scheduleLayout.ts` time-axis + overlap rule, and that the detail dock + multi-calendar legend are reused unchanged.
- [ ] Update `docs/PROJECT-STRUCTURE.md` with the new `scheduleLayout.ts` (+ test) and any new schedule components file.
- [ ] Reconcile `TODO.md` (#89) via wrap-up; mark deviations below.

---

## Deviations & Notes

- **2026-06-20**: Chose to carry an explicit `view?` on the `EventList` surface root rather than have the renderer infer the layout from the window span — robust across DST/short months and keeps the layout decision single-sourced from main. If the implementing session finds span-inference simpler and equally robust, that is an acceptable substitution (note it here).
