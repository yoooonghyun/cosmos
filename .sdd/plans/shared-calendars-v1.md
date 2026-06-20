# Plan: Shared / Multi-Calendar View (Google Calendar) — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/shared-calendars-v1.md

---

## Grounding

**codegraph_explore / Read** (this plan step):
- `googleCalendarCatalog/components.tsx` (Read, verbatim) → `EventList` (root) → `CalendarMonthGrid` → `buildMonthGrid(events,timeMin,now)` → `DayCell` → `EventChip`, which calls `eventColorClasses(event.colorId)`. Color is computed PER CHIP from `EventChipData.colorId`. To color by calendar, the chip needs a per-calendar color token instead, and the grid needs to filter chips by a hidden-calendar set.
- `googleCalendarClient.listEvents` → hardcodes `/calendars/${GOOGLE_PRIMARY_CALENDAR_ID}/events`, one bounded page (`maxResults=50`, `singleEvents=true&orderBy=startTime`, cursor). `getPrimaryCalendar` reads `/calendars/primary`. No `calendarList` method exists yet.
- `handleGoogleCalendarDefaultView` → ONE `manager.listEvents(window)` then `buildDefaultViewSurface(page,window)` → single `EventList` root. Bridge/MCP route through the SAME `manager.listEvents`.
- `SESSION_SCHEMA_VERSION = 6` in `src/shared/ipc.ts`; the persisted snapshot stores the composed surface `spec` (the EventList node), NOT calendar-list or toggle state. The hydrator drops unknown/bad fields gracefully.

**Decisions persisted** via `memory_save` (architecture) in the spec step (aggregate+toggle, color-by-calendar, no new scope). This plan adds the bounds / mapping / persistence resolutions below.

---

## Summary

Expand the Google Calendar panel + agent render path from primary-only to **all accessible
calendars**, merged into the one month grid, with a per-calendar legend/toggle and
color-by-calendar — staying read-only and on the existing `calendar.readonly` scope.
Technical approach: add a `listCalendars()` read (`GET /users/me/calendarList`) to the
client/manager; in `handleGoogleCalendarDefaultView`, read the calendar list, fan out a
**bounded** per-calendar `listEvents` over the same month window, merge (tagging each event
with its `calendarId`), and compose a surface that carries (a) the merged events each tagged
with `calendarId` and (b) a `calendars[]` legend (id, name, color token, `selected`). The
catalog colors each chip by its calendar's token and filters by a renderer-only hidden-set
the new legend drives. Per-calendar **color token** is derived by a deterministic mapping of
the calendar's Google `backgroundColor` (and id as tiebreaker) onto the bounded `--event-*`
family. The `EventList` root gains optional `calendars[]` + per-event `calendarId` (additive,
backward-compatible). Both the IPC default-view and the MCP/render path stay in parity off the
one surface builder + manager. **Step 2.5 design is required** (legend is a new renderer
surface; per-calendar color extends the token system).

## Resolved deferrals (from spec open questions)

- **Read bounds (FR-013).** Fetch at most **25 calendars** per month view; for each, **one bounded page** of events over the month window (the SAME `maxResults=50`, `singleEvents=true&orderBy=startTime` read used today — NO multi-page loop). Calendars are ordered **primary first, then `selected:true`, then the rest**, and the cap is applied AFTER that ordering so the most relevant calendars always win. Per-calendar reads run **concurrently with a small bound** (e.g. `Promise.allSettled`, ≤ 6 in flight) to keep the aggregate read responsive. These are deterministic constants in `googleConfig.ts` so a later tweak is one edit. (No pagination/“Load more” across calendars in v1 — matches today's single-page default view.)
- **Color-token mapping (FR-006/FR-007).** Each calendar resolves to ONE `--event-*` token via a **pure, deterministic function `calendarColorToken(calendar)`** in `logic.ts`: (1) if the calendar's Google `backgroundColor` is a recognized GCal palette hex, map it to the nearest cosmos token via a small fixed lookup; (2) otherwise, **stable-hash the calendar id** (a tiny deterministic string hash) modulo the non-gray token count to pick a token; (3) absent/garbage ⇒ the **`gray` fallback** token. The SAME calendar always yields the SAME token within a view; no raw hex reaches a component. The surface builder calls this and ships the resolved token NAME (e.g. `'blue'`) on each `calendars[]` entry, so the catalog never re-derives and the legend swatch + chip always agree. (The designer owns the concrete palette set + any token additions in Step 2.5; this plan fixes only the mapping CONTRACT and that it emits a bounded token name.)
- **Toggle persistence (FR-010/FR-011).** Manual show/hide toggles are **renderer-only ephemeral**: on each mount the hidden-set is re-derived from each calendar's Google `selected` flag (shown when `selected!==false`). Justification: the surface persisted in the session snapshot is the composed spec, not view chrome; `selected` is the source of truth that already mirrors the web app (FR-010) and re-reads fresh each load, so persisting manual toggles would risk drift against Google and complicate the snapshot for marginal benefit. **No `SESSION_SCHEMA_VERSION` bump is required for toggles.** The snapshot DOES persist the surface spec; because `calendars[]` + per-event `calendarId` are **additive optional** fields the hydrator already tolerates, no bump is needed for the surface either — confirm during implementation that a v6 snapshot lacking these fields still rehydrates (it should: live default view is `composed:false` and re-fetches).

## Technical Context

| Item              | Value |
|-------------------|-------|
| Language          | TypeScript (Electron main + preload + React renderer + plain-Node MCP) |
| Key dependencies  | Existing only — Google Calendar REST v3 (`calendarList`, `events`), `calendar.readonly` scope, A2UI 0.9 custom catalog, vitest. NO new deps, NO new OAuth scope. |
| Files to create   | none required (new symbols land in existing files); possibly a `googleCalendarColor.ts` if `logic.ts` grows too large (optional) |
| Files to modify   | `src/main/integrations/googleCalendarClient.ts`, `src/main/integrations/googleConfig.ts`, `src/main/googleCalendarManager.ts`, `src/main/googleCalendarSurfaceBuilder.ts`, `src/main/index.ts`, `src/shared/googleCalendar.ts`, `src/shared/ipc.ts` (only if a snapshot/IPC shape changes), `src/shared/validate.ts`, `src/renderer/googleCalendarCatalog/logic.ts`, `src/renderer/googleCalendarCatalog/components.tsx`, `src/renderer/googleCalendarCatalog/index.ts` (if a new component registers), `src/renderer/GoogleCalendarPanel.tsx` (only if legend lives in the panel rather than the catalog root), `src/mcp/googleCalendarRenderUiServer.ts` + `src/mcp/googleCalendarMcpServer.ts` (tool description parity), `docs/ARCHITECTURE.md` (§4.9 / §7). Plus matching `*.test.ts`. |

---

## Implementation Checklist

> Phase 1 (Interface) and Phase 2 (Tests) follow the Step 2.5 design. Update as work progresses.

### Phase 0 — Design (Step 2.5, REQUIRED before interface)

- [ ] `designer` produces `.sdd/designs/shared-calendars-v1.md`: the **per-calendar legend** (placement above/below the grid, name + swatch + show/hide control, many-calendar overflow), the **per-calendar color** treatment (chip dot/bar now keyed by calendar token, hidden vs shown styling), and any **`--event-*` palette additions** the mapping needs. Designer owns tokens + `components/ui/`; this plan fixes the mapping contract only.

### Phase 1 — Interface (shared contracts first)

- [x] **`src/shared/googleCalendar.ts`**: added `GoogleCalendar` (id/summary/backgroundColor?/primary?/accessRole?/selected?), `GoogleCalendarColorToken` (12-name union), `GoogleCalendarLegendEntry` (id/summary/colorToken/selected?/primary?); added optional `calendarId?` to `GoogleCalendarEvent` + `GoogleCalendarListEventsParams`. No new op — the legend rides the existing default-view surface.
- [x] **`src/main/integrations/googleConfig.ts`**: added `GOOGLE_CALENDAR_LIST_PATH = '/users/me/calendarList'`, `GOOGLE_CALENDAR_MAX_CALENDARS = 25`, `GOOGLE_CALENDAR_FANOUT_CONCURRENCY = 6`. (calendar.readonly already grants calendarList — no new scope.)
- [x] **`src/main/integrations/googleCalendarClient.ts`**: added `toCalendar(raw)` + `listCalendars(auth)` (GET list path, maps/drops malformed); `listEvents` gained a `calendarId` arg (default `primary`, URL-encoded).
- [x] **`src/main/googleCalendarSurfaceBuilder.ts`**: ADDED `buildSharedViewSurface(view, window)` (rather than mutate `buildDefaultViewSurface` — additive/back-compat) emitting `EventList` with `events` (each tagged `calendarId`), `calendars[]` legend (resolved token), `timeMin/timeMax`, `hasMore:false`. Token resolved via the shared module.
- [x] **`src/renderer/googleCalendarCatalog/logic.ts`**: added `tokenColorName`/`tokenColorClasses`/`colorTokenFor`/`eventColorClassesByCalendar`/`seedHiddenCalendarIds`; extended `buildMonthGrid(...,hiddenCalendarIds?)` to filter hidden-calendar events. Kept the colorId-keyed `eventColorClasses`/`eventColorName` intact (EventRow agent path + existing tests).
- [x] **Confirm no invented properties**: every new field traces to FR-001…FR-018.

> **Deviation**: `calendarColorToken` lives in a NEW shared module `src/shared/googleCalendarColor.ts` (not `logic.ts`) so the main surface builder AND the renderer import ONE implementation — satisfies "resolved ONCE in the builder and carried" while staying node-testable + drift-free. Six new `--event-*` tokens (teal/cyan/indigo/magenta/pink/olive) wired into `src/renderer/index.css` (`@theme inline` + `:root` light + `.dark`).

### Phase 2 — Testing

- [x] `googleCalendarClient.test.ts`: `toCalendar` maps/drops/prefers-summaryOverride; `listCalendars` maps+drops+empty+403; `listEvents(calendarId)` hits the URL-encoded path; primary default back-compat.
- [x] `googleCalendarManager.test.ts`: `orderAndCapCalendars` ordering/cap/non-array; `listAggregatedEvents` tags each event, DEGRADES on one-fails-others-succeed (`anyCalendarFailed`), surfaces error on list-read failure, empty view for no calendars. (Also fixed two existing assertions for the new 5th `calendarId` arg.)
- [x] `googleCalendarColor.test.ts` (NEW): `calendarColorToken` deterministic + bounded + gray fallback (palette hex, normalized case/no-hash, unknown hex id-hash, garbage, absent id); `stableStringHash` stable/non-negative.
- [x] `logic.test.ts`: `tokenColorName`/`tokenColorClasses` narrow+fallback; `colorTokenFor`/`eventColorClassesByCalendar` chip==swatch + gray fallbacks; `seedHiddenCalendarIds` from `selected===false`; `buildMonthGrid` hidden-calendar filter (drops hidden, no-op when empty/absent, never filters calendarId-less events).
- [x] Surface validation: the composed surface flows through structural `validateSurfaceUpdate`; `calendars[]`/`calendarId` are MAIN-composed (not inbound), so no `validate.ts` change needed. `buildSharedViewSurface` test asserts no `#hex`/secret/accesstoken leaks.
- [x] Degrade-to-primary single calendar still renders (asserted in surface-builder test + `colorTokenFor` gray fallback for calendarId-less events).

### Phase 3 — Implementation

- [x] **main**: `handleGoogleCalendarDefaultView` now calls `googleCalendarManager.listAggregatedEvents(window)` and composes via `buildSharedViewSurface`; reconnect/not_connected → push-nothing, rate_limited/network → Notice (unchanged).
- [x] **manager**: chose `listAggregatedEvents` (one-implementation parity, FR-016) — `listCalendars` passthrough + `orderAndCapCalendars` + chunked `Promise.allSettled` fan-out (≤6), tagging events, `anyCalendarFailed` degrade.
- [x] **renderer catalog**: `CalendarLegend`/`CalendarToggle` in the catalog (parity FR-016), renderer-only `hiddenCalendarIds` state seeded from `selected` each legend-identity change (FR-010/FR-011), instant toggle (FR-009), chips colored by calendar token (FR-006). Legend suppressed for ≤1 calendars (single-primary unchanged, FR-014).
- [x] **renderer panel**: NOT changed — legend lives inside the catalog root (preserves agent-path parity).
- [x] **MCP parity**: `googleCalendarRenderUiServer.ts` tool description teaches `EventList.calendars[]` + per-event `calendarId` (bounded token names; still read-only, still one `listEvents` binding).
- [x] All tests pass (typecheck 0; 69 files / 1274 tests). No duplicated color/merge logic — token resolved ONCE in the shared module, carried on the surface.

### Phase 4 — Docs

- [ ] Update `docs/ARCHITECTURE.md` §4.9 / §7 item 4i — **architect-owned; deferred to wrap-up.**
- [x] `SESSION_SCHEMA_VERSION` bump NOT required — confirmed: `calendars[]`/`calendarId` are additive optional surface fields; toggles are renderer-only ephemeral; live default view is `composed:false` and re-fetches, so a v6 snapshot rehydrates unchanged.
- [ ] `wrap-up`: reconcile `TODO.md`; mark this plan Done — **orchestrator-owned.**

---

## Deviations & Notes

- **2026-06-18**: Plan authored. Resolved bounds (≤25 calendars, single bounded page each, ≤6 concurrent), color mapping (palette-hex lookup → stable id-hash → gray fallback, token name resolved in the surface builder), and toggle persistence (renderer-only, re-derived from Google `selected` each mount — no snapshot bump for toggles). Step 2.5 design confirmed REQUIRED (legend = new renderer surface; per-calendar color extends the token system).
- **2026-06-18 (implementation, Steps 3–5)**: Interface → tests-first → implement; typecheck 0, 69 files / 1274 tests green (+ ~45 new assertions across googleCalendarColor/logic/client/manager/surfaceBuilder tests). Deviations:
  - `calendarColorToken` placed in a NEW shared module `src/shared/googleCalendarColor.ts` (not `logic.ts`) so the main builder + renderer share ONE node-testable implementation — keeps the resolved-once-in-the-builder contract drift-free.
  - ADDED `buildSharedViewSurface` alongside the retained `buildDefaultViewSurface` (additive/back-compat) rather than mutating the existing builder.
  - ADDED `listAggregatedEvents` to the manager (chose merge-in-manager for one-implementation parity, FR-016) rather than merging in `index.ts`.
  - Kept the colorId-keyed `eventColorClasses`/`eventColorName` for the EventRow agent path + existing tests; added a parallel token-name-keyed path for per-calendar color.
  - No `validate.ts` change: `calendars[]`/`calendarId` are MAIN-composed onto the surface (not inbound cross-process payloads), so they flow through the existing structural `validateSurfaceUpdate`.
  - GoogleCalendarPanel.tsx NOT changed — legend lives in the catalog root (agent-path parity).
  - `docs/ARCHITECTURE.md` §4.9/§7 update + `TODO.md` reconcile DEFERRED to architect/wrap-up (not developer-owned).
  - **GUI not live-exercised** (no live Google account) — month-grid color/legend/toggle behavior is covered only by the pure `logic`/surface tests; not visually verified in a running app.
