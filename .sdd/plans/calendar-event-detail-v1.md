# Plan: Google Calendar — Event Detail on Click — v1

**Status**: Draft
**Created**: 2026-06-20
**Last updated**: 2026-06-20
**Spec**: .sdd/specs/calendar-event-detail-v1.md

---

## Grounding

> Same direct investigation as the spec's Grounding section (codegraph_explore on
> `GoogleCalendarPanel`/`googleCalendarCatalog`/`GoogleCalendarEvent`/`googleCalendarSurfaceBuilder` +
> the `SlackPanel` thread side-dock + the Confluence/Jira detail-nav precedents + the `googleCalendar`
> IPC surface; memory_recall/memory_smart_search on the calendar feature + detail-nav patterns — empty
> store). The three load-bearing findings:
>
> 1. **The detail data is NOT already present, and there is no single-event read.** The month-view
>    `GoogleCalendarEvent` carries only `id/calendarId/summary/start/end/allDay/timeZone/location`;
>    the IPC surface has only `listEvents` + `requestDefaultView` (no `events.get`).
> 2. **The clicked-element → renderer-local nav action → `ActiveTabSurface.onAction` seam is shipped
>    several times** (Confluence, Jira, and Slack). This revision keeps that seam unchanged; only the
>    presentation downstream of it changes.
> 3. **The Slack thread side-dock is shipped and is the presentation this revision adopts.**
>    `SlackPanel.tsx` wraps its body in a `@container/slackbody` two-pane flex: the list on the left
>    (`min-w-0 flex-1`) and a right-docked panel that only mounts when a single renderer-local
>    `openThread` state is set. At/above `@[32rem]/slackbody` the dock is **side-by-side**
>    (`relative`, `w-[clamp(18rem,42%,28rem)]`, `shrink-0`, `border-l`, no shadow); below it the dock is
>    an **absolute right-drawer** (`absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] shadow-lg`,
>    `transition-transform`) over a click-away **scrim** (`absolute inset-0 z-10 bg-black/40`, hidden
>    side-by-side). The dock is dismissed by an X (`onClose`) AND the scrim, and is transient (changing
>    the base view closes it). The event detail dock reuses this exact structure.

## Summary

Make month-grid event chips clickable; clicking opens that event's full detail in a **right-side dock
alongside the still-visible month grid** within the panel tab, dismissed by an X (and a narrow-mode
click-away scrim) that returns the grid to full width verbatim. The mechanism is the shipped
**renderer-local nav action → `ActiveTabSurface.onAction`** seam; the **presentation** reuses the
shipped **Slack thread side-dock** (`@container` two-pane: side-by-side when wide, drawer-overlay when
narrow). The clicked `EventChip` becomes a `<button>` emitting a renderer-local nav action
(`calendarNav.openDetail`, NOT a `googleCalendar.*` action), intercepted via the `ActiveTabSurface`
`onAction` seam in `GoogleCalendarPanel`; the panel holds a per-tab single `genUiEvent` open-detail
state (reset on tab switch) that, when set, mounts a right-docked native `EventDetail` panel beside the
grid. Clicking another chip re-targets the single dock; the X/scrim clears the state → the grid returns
to full width with no re-fetch and no surface round-trip.

**No new IPC channel and no new fetch.** The detail fields the user wants beyond the month chip
(`description`, `attendees`, `htmlLink`, plus the owning-calendar color/name) are added by **enriching
the existing `events.list` field mapping** so they ride the already-fetched event objects on the
existing `EventList` surface — exactly as Slack image refs ride the existing message DTO. The bounded
month read already returns full Google event resources; the mapping simply stops dropping these fields.
The detail renders entirely from the clicked event's own props already in the surface — no
`events.get`, no main round-trip, no correlation slot. Read-only throughout: no new OAuth scope, no
write tool, no dispatcher.

## Presentation decision (the main design choice) — RESOLVED (revised 2026-06-20)

**Chosen: right-side dock alongside the grid (Slack thread side-dock precedent).**
**Superseded: in-place overlay that replaced the grid + native Back row.**

The user revised the presentation (2026-06-20) so the grid stays visible and the detail opens in a
right-side dock, mirroring the Slack thread side-panel direction the project is already pursuing. Only
the presentation changes — the renderer-local nav action + `ActiveTabSurface.onAction` seam and the
no-fetch/no-IPC data path are unchanged.

Mechanics (reuse the Slack `SlackPanel.tsx` thread-dock structure verbatim where possible):
- Wrap the connected content region in a **`@container/calbody`** horizontal two-pane flex: the month
  grid on the left (`min-w-0 flex-1`) and the detail dock on the right, mounted only when the per-tab
  `genUiEvent` open-detail state is set.
- **Side-by-side when wide** (`@[<threshold>]/calbody`): the dock is `relative`, `shrink-0`,
  `w-[clamp(18rem,42%,28rem)]`, `border-l`, no shadow; the grid keeps its width and simply gets
  narrower. **Drawer-overlay when narrow**: the dock is `absolute inset-y-0 right-0 z-20 w-full
  max-w-[22rem] shadow-lg` over a click-away scrim (`absolute inset-0 z-10 bg-black/40`, hidden
  side-by-side), so the dense 7-column grid is never squeezed into illegibility.
- **Single dock, retargeted, not stacked.** `genUiEvent` holds the one open event; a second chip click
  replaces it (Slack's `openThreadTransition` retarget precedent). **Dismiss** = an X in the dock
  header (always) + the narrow-mode scrim. **Transient**: a month navigation / disconnect / tab switch
  closes the dock (the grid is the durable thing, the dock is an adjunct).

Why the side-dock fits here: the user wants to keep the calendar in view while reading an event (an
*adjunct*, like the Slack thread pane), and wants visual + structural consistency with the Slack
direction. The `@container`-gated drawer fallback resolves the earlier worry about the dense 7-column
grid on a narrow rail — when there is no room to dock side-by-side, the detail overlays as a drawer
instead of squeezing the grid. Because the data is already on the clicked event's props, the dock needs
**no fetch at all** (lighter than the Slack thread dock, which calls `getReplies`).

## Fetch / IPC decision — RESOLVED

**No new IPC channel; no new `events.get`; no main handler; no surface builder for detail.**
The detail is rendered client-side from the clicked event's props, which now include the enriched
fields. The only main-side change is the pure `eventRow()` mapper (and the read mapping that populates
`GoogleCalendarEvent`) carrying the additional fields. This keeps the feature within the
"unsolicited default-view + renderer-local nav" model already established and avoids fire-or-defer
correlation entirely.

> Why not a per-event `events.get`? It would add a new IPC channel + main handler + a correlation/
> loading state for data we already have in hand. The bounded `events.list` read returns full event
> resources, so enriching the existing mapping is strictly cheaper and matches the precedent of riding
> existing DTOs (Slack image refs).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron: main + renderer), React 19, A2UI `@a2ui-sdk/react` 0.9, Tailwind + shadcn/ui |
| Key dependencies  | Existing `googleCalendarCatalog`, `GoogleCalendarPanel`, `ActiveTabSurface` `onAction` seam, `googleCalendarSurfaceBuilder` `eventRow`, `GoogleCalendarEvent` DTO, the Google events read mapping; the **Slack thread side-dock** structure (`SlackPanel.tsx` `@container/slackbody` two-pane + `SlackThreadPanel` X/scrim dismiss) as the presentation precedent; the Confluence/Jira renderer-local nav-action seam precedent |
| New OAuth scope   | **None** (read-only; `calendar.readonly` already covers full event resources incl. description/attendees/htmlLink) |
| New IPC channel   | **None** |
| Files to create   | `src/renderer/googleCalendarCatalog/eventDetailLogic.ts` (+ `.test.ts`) — pure detail-field derivations (time range, all-day range, attendee list normalization, "(no title)"); a native `EventDetail` dock component (a sibling of the panel, rendered by the panel chrome inside the right dock — NOT a catalog surface node), modeled on `SlackThreadPanel` (header with title + X `onClose`, scrollable body) |
| Files to modify   | `src/shared/googleCalendar.ts` (extend `GoogleCalendarEvent` with optional `description`/`attendees`/`htmlLink` and, if needed, recurring marker); the Google events read mapping in the Calendar client/manager (carry the new fields); `src/main/googleCalendarSurfaceBuilder.ts` (`eventRow` passes the new fields through); `src/renderer/googleCalendarCatalog/components.tsx` (`EventChip` → clickable button emitting the nav action; thread a per-event click handler from `EventList`/`CalendarMonthGrid`/`DayCell`); `src/renderer/GoogleCalendarPanel.tsx` (per-tab `genUiEvent` open-detail state, `onAction` intercept, wrap the connected content region in the `@container/calbody` two-pane layout, mount the `EventDetail` right dock + scrim, X/scrim dismiss); the catalog's open-detail action constant; main IPC validators if the surface payload shape is asserted; `docs/ARCHITECTURE.md` §4i (record the side-dock event-detail decision) |

### Decisions & seams (carry into implementation)

1. **Nav action constant.** Add `CALENDAR_OPEN_DETAIL_ACTION = 'calendarNav.openDetail'` (NON-
   `googleCalendar.*`, mirroring `CONFLUENCE_OPEN_DETAIL_ACTION`), so the panel's `onAction`
   intercept returns `true` (handled, never forwarded to main / the agent). Calendar is read-only with
   no dispatcher, so any other action returns `false` — keep the seam identical to Confluence.
2. **What the action carries.** The clicked `EventChip` already has the full enriched event object as
   its props. Pass the **whole event object** (or the minimal `{ eventId }` plus a lookup) as the
   action context so the dock renders without any fetch. Prefer carrying the event object directly
   (simplest; no re-lookup), validated/narrowed in the panel before use.
3. **Per-tab open-detail state, held PER-TAB.** `GoogleCalendarPanel` holds `genUiEvent:
   GoogleCalendarEvent | null` (or a narrowed detail shape) per active tab, reset on `activeTabId`
   change. **Hold it the way the calendar already holds `monthIntents`** — a `Map<tabId, …>` in the
   PANEL (not the catalog) so it survives the `A2UIProvider key={tab.id}` remount a tab switch forces,
   OR, given the dock is *transient and closes on tab switch* (FR-014), a simpler single
   `genUiEvent`+`useEffect` reset keyed on `activeTabId` (the Slack `openThread`-per-tab precedent)
   suffices — decide during interface. When non-null, the connected content region (now a
   `@container/calbody` two-pane) mounts the `EventDetail` dock on the right **beside** the grid; the
   `A2UIProvider`/grid stays mounted and visible at all times. A second chip click retargets the state
   (no stacking); the X/scrim clears it so the grid returns to full width verbatim — no re-request, no
   skeleton.
4. **EventDetail is a native panel dock component, not a catalog surface node.** Modeled on
   `SlackThreadPanel`: a header (event title + an X `onClose`) over a scrollable body. It is plain
   cosmos React rendered by the panel chrome inside the right dock, fed the clicked event. It uses the
   existing `--event-*` color tokens + the legend color for the owning calendar; it reuses the pure
   helpers (`eventTitle`, plus new range/attendee helpers in `eventDetailLogic.ts`). The dock body
   MUST scroll within the dock (not the panel) so long descriptions/attendee lists never break the
   side-by-side layout or push the grid.
5. **External link.** Render "Open in Google Calendar" as an external link. Opening must go through the
   app's existing external-open path (system browser), never an in-app navigation. The link is the
   event's non-secret `htmlLink`; absent → omit the link (FR-010 degrade). Confirm cosmos's
   external-open mechanism during interface (e.g. an existing `shell.openExternal` IPC or anchor
   handling) and reuse it — do NOT introduce a token-bearing URL.
6. **All-day end normalization.** A multi-day all-day event's `end` is Google's exclusive next-day; the
   pure range helper subtracts a day for the inclusive human label (covered by a unit test).
7. **Recurring marker (FR-011).** If the Google read distinguishes a recurring instance (e.g. presence
   of `recurringEventId`), carry an optional boolean/marker on the DTO so the detail can show a small
   "Recurring" indicator. If wiring this is non-trivial, FR-011's recurrence indicator is a SHOULD and
   MAY be deferred within v1 (the occurrence's own date/time — the MUST — is already satisfied by the
   existing per-instance `start`/`end`). Decide during interface.
8. **Description = plain text (spec OQ).** Render the description as plain text; do NOT introduce an
   HTML sanitize surface in v1. If the read returns HTML, flatten/escape to text in the mapping or
   render as text (no `dangerouslySetInnerHTML`). Keeps the read-only, low-risk posture.
9. **Security.** No token/secret/token-bearing URL on the surface, the action context, or the link
   (architecture invariant + FR-012). The enriched fields (`description`, `attendees`, `htmlLink`) are
   all non-secret event content.
10. **No `SESSION_SCHEMA_VERSION` bump expected.** The change is additive optional fields on an
    in-surface event object + renderer-only open-detail dock state (not persisted). Confirm during interface
    that no persisted snapshot shape changes; if a composed surface now persists larger event objects,
    re-check (still additive/optional → no bump expected).

## Implementation Checklist

> A **designer design step** (`design` skill, `.sdd/designs/calendar-event-detail-v1.md`) SHOULD run
> between this plan and interface: the event detail is a new renderer surface — a right-side **dock**
> (header with title + X, scrollable body carrying time/location/description/attendees/calendar/link,
> all-day vs timed, empty-field degrade) that reuses the Slack thread-dock structure and must match the
> existing calendar + shadcn/ui design system. Then the **developer** implements (interface → tests →
> code). The architect does not implement.

### Phase 0 — Design (designer)

- [x] Design spec for the `EventDetail` **dock** + the clickable-chip affordance (hover/focus/cursor),
      reusing the Slack thread-dock structure: the `@container/calbody` two-pane (side-by-side vs
      drawer-overlay + scrim), dock width (`clamp(18rem,42%,28rem)` side-by-side / `max-w-[22rem]`
      drawer) and breakpoint (Slack's `32rem` as the start point, tuned for the denser 7-column grid),
      the dock header (title + X), all-field and missing-field layouts, all-day vs timed, in-dock
      scrolling, recurring indicator, using the existing `--event-*` tokens + shadcn/ui primitives.

### Phase 1 — Interface (developer)

- [x] Re-read the spec; confirm both open questions resolve to their safe defaults (no blocker).
- [x] Extend `GoogleCalendarEvent` (`src/shared/googleCalendar.ts`) with optional `description?`,
      `attendees?`, `htmlLink?` (and an optional recurring marker if adopted) — documented as
      non-secret, with the same degrade discipline as `location`.
- [x] Add `CALENDAR_OPEN_DETAIL_ACTION` constant in the catalog (alongside the catalog's other
      exports), mirroring `CONFLUENCE_OPEN_DETAIL_ACTION`.
- [x] Define the detail-render prop shape the native `EventDetail` consumes (derived from the event).
- [x] Review new types vs spec — no invented properties; every field traces to an FR.

### Phase 2 — Testing (developer)

- [x] `eventDetailLogic.test.ts`: timed start–end range formatting; all-day single-day; multi-day
      all-day inclusive-range (exclusive-end normalization); "(no title)" degrade; attendee list
      normalization; omit rules for missing location/description/attendees.
- [x] Surface-builder test: `eventRow` carries `description`/`attendees`/`htmlLink`/`calendarId`
      when present and omits them when absent (no `undefined` keys).
- [x] Read-mapping test: the Google events read maps description/attendees/htmlLink onto
      `GoogleCalendarEvent` (and never leaks a token/secret field).
- [x] (Renderer) the nav action open/Back behavior + per-tab reset, to the extent testable per the
      `.ts`/`.test.ts` convention (keep DOM-free logic pure; component behavior as the catalog's tests
      allow).

### Phase 3 — Implementation (developer)

- [x] Read mapping: populate the new `GoogleCalendarEvent` fields from the events read (plain-text
      description; non-secret only).
- [x] `googleCalendarSurfaceBuilder.eventRow`: pass the new fields through (omit-when-absent).
- [x] `EventChip` (and `DayCell`/`CalendarMonthGrid`/`EventList`): make the chip a `<button>` with
      hover/focus/cursor affordances that emits `CALENDAR_OPEN_DETAIL_ACTION` with the event context;
      a chip with no usable id stays inert (no crash).
- [x] `GoogleCalendarPanel`: per-tab `genUiEvent` open-detail state, reset on `activeTabId`; `onAction`
      intercept (return `true` for the open-detail action, `false` otherwise); wrap the connected
      content region in the `@container/calbody` two-pane (grid left, dock right); mount the
      `EventDetail` dock + narrow-mode scrim when `genUiEvent` is set; a second chip click retargets the
      single dock; the X and the scrim clear `genUiEvent` (grid returns to full width verbatim).
- [x] `EventDetail` native dock component (modeled on `SlackThreadPanel`): header (title + X `onClose`)
      over a scrollable body rendering title/time/location/description/attendees/calendar/link with
      all-day vs timed formatting, missing-field omission, in-dock scrolling, optional recurring marker,
      external link via the reused system-browser open path.
- [x] Confirm: not-connected/reconnect/empty states expose no openable detail dock; disconnect (and a
      month navigation / tab switch) while a dock is open closes it cleanly — returns to the
      Connect affordance / full grid with no stuck dock.
- [x] All tests pass; reused shared helpers — no duplicated time/title logic.

### Phase 4 — Docs

- [x] Update `docs/ARCHITECTURE.md` §4i (Google Calendar): record event-detail-on-click — the
      **right-side detail dock** reusing the Slack thread side-dock presentation (`@container`
      two-pane, side-by-side / drawer-overlay + scrim, X dismiss), fed by the renderer-local
      `CALENDAR_OPEN_DETAIL_ACTION` via `ActiveTabSurface.onAction`, the no-new-IPC / no-new-fetch
      enrichment of `events.list` mapping, still read-only (no new scope). Keep it consistent — no drift.
- [x] Mark the item in `TODO.md`.
- [x] Update this plan's Deviations with anything that differed.

---

## Deviations & Notes

- **2026-06-20**: Plan authored. Resolved the two requested decisions: (1) presentation = in-place
  overlay + Back (Confluence/Jira precedent), rejecting the Slack right-dock for the narrow rail /
  drill-in semantics; (2) no new fetch/IPC — enrich the existing `events.list` mapping so detail
  fields ride the already-fetched events, lighter than the Confluence overlay (which still calls
  `getPage`). Scope held to read-only v1 (no edit/delete/create/RSVP, no new OAuth scope).
- **2026-06-20 (revision, same v1)**: User changed the **presentation only** — the detail now opens
  as a **right-side dock alongside the still-visible grid**, reusing the shipped Slack thread side-dock
  (`@container` two-pane: side-by-side when wide, drawer-overlay + click-away scrim when narrow; X
  dismiss; single dock retargets, not stacked; transient — closes on month nav / disconnect / tab
  switch). The `@container`-gated drawer fallback answers the prior "no room on the narrow rail"
  concern (overlay instead of squeezing the grid). The renderer-local nav-action seam and the
  no-new-fetch / no-new-IPC data path are **unchanged**; all detail-content FRs are unchanged. The
  earlier "rejected the Slack right-dock" rationale is superseded by this user decision. Dock width
  (`clamp(18rem,42%,28rem)` side-by-side / `max-w-[22rem]` drawer) and dismiss (X + scrim, Esc
  optional) carry sensible reused defaults and do not block.
- **2026-06-20 (implementation)**: Built per the revised plan. Mechanism notes the plan left to the
  developer:
  - **External link** (FR-010): no renderer-facing `openExternal` IPC exists (the per-integration
    `openExternal` is the OAuth-flow callback, not a channel). Rendered a plain
    `<a target="_blank" rel="noreferrer">` + added `webContents.setWindowOpenHandler` in
    `createWindow` routing `http(s)` target=_blank to `shell.openExternal` and DENYING the in-app
    child window. Standard Electron **window config**, NOT a new IPC channel — honors no-new-IPC while
    opening the system browser. Guarded to `http(s)`.
  - **Action context**: the whole event rides as the renderer-LOCAL action `context` (intercepted by
    `GoogleCalendarPanel.onAction`, never forwarded). The SDK `resolveContext` passes a
    non-`{path}`/non-FunctionCall literal through untouched; a single `as unknown` cast at the
    dispatch site documents that the structured object reaches the handler intact (never crosses IPC).
  - **Per-tab dock state**: a single `genUiEvent` reset on `activeTabId`/`isConnected` change (per-tab
    transience + FR-014 reset on switch/disconnect), not a per-tab `Map`. The selected-chip marker
    flows via a new `CalendarDetailContext` (sibling to `CalendarNavContext`).
  - **Dock swatch/name**: reuses the legend the surface already carries (root `EventList`'s
    `calendars`) + `eventColorClassesByCalendar`, so the Calendar-row swatch matches chip + legend;
    falls back to the GCal `colorId` swatch on the single-primary path.
  - All 1591 tests pass (56 across the three Calendar suites); typecheck (node + web) green.
