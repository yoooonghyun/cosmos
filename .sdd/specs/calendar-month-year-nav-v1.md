# Spec: Calendar Month/Year Navigation — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: —
**Related plan**: .sdd/plans/calendar-month-year-nav-v1.md (to be authored)

---

## Grounding

**codegraph_explore / codegraph_search queries run (with takeaways):**

- `requestDefaultView googleCalendarSurfaceBuilder GoogleCalendarViewWindow GoogleCalendarListEventsParams EventList CalendarMonthGrid buildMonthGrid GoogleCalendarPanel` — the live default view is an unsolicited `requestDefaultView()` IPC; `GoogleCalendarPanel` (src/renderer/GoogleCalendarPanel.tsx) fires `requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView())` into an EMPTY active tab once shown + connected; the landed `EventList` surface carries `timeMin`/`timeMax`; the rendered month is derived from `timeMin`.
- `useGenerativePanelTabs requestDefaultInActiveTab googleCalendar IPC validators adapterDispatcher refresh` — `requestDefaultInActiveTab` marks the active tab `loadingDefault: true`, clears its error, and fires-or-defers an unsolicited frame against the shared `originatingTabIdRef` slot. A landed surface (or Notice) clears `loadingDefault`. The default-view path is UN-bound (no adapter descriptor), so `adapterDispatcher.refresh` does NOT drive it; the live default view re-fetches via the `requestDefaultView` IPC, not via the descriptor refresh path.
- `monthFromWindow GoogleCalendarViewWindow timeMin timeMax surface builder validateRequestDefaultView` — `buildDefaultViewSurface(page, window)` (src/main/googleCalendarSurfaceBuilder.ts:91) emits a single `EventList` root with `timeMin`/`timeMax` from the window. `monthFromWindow(timeMin, now)` (src/renderer/googleCalendarCatalog/logic.ts:320) derives `{year, month}` from `timeMin`, falling back to `now` on an absent/unparseable `timeMin`. `buildMonthGrid` consumes that to lay out the cells.
- Grep `googleCalendarDefaultWindow` in src/main/index.ts — `googleCalendarDefaultWindow()` (index.ts:1121) computes the CURRENT month window `[first of this month, first of next month)` from `new Date()`, with NO parameter. `handleGoogleCalendarDefaultView` runs the bounded single-page read over that window and pushes `target: 'google-calendar'`.
- Grep `requestDefaultView` in src/shared/ipc.ts — the calendar IPC: `GoogleCalendarChannelName.RequestDefaultView = 'googleCalendar:requestDefaultView'` (ipc.ts:715); payload type `GoogleCalendarRequestDefaultViewPayload = Record<string, never>` (ipc.ts:728); bridge method `requestDefaultView(): void` (ipc.ts:754). The boundary validator `validateRequestDefaultView` (src/shared/validate.ts:283) is SHARED with Jira and today only checks `isObject` then returns `{}`.
- `EventList` renderer-only ephemeral pattern (src/renderer/googleCalendarCatalog/components.tsx:368-415) — the calendar legend hidden-set is a `useState<Set<string>>` seeded from the surface, NEVER persisted, re-seeded only when the calendar set changes. This is the precedent for the session-only / renderer-only navigated-month state.

**memory_recall / memory_smart_search queries run (with takeaways):**

- `memory_recall "google calendar default view shared calendars legend sidebar panel refresh"` — no stored results.
- `memory_smart_search "calendar legend hidden set renderer-only ephemeral state panel refresh target month"` — no stored results.

(No prior agentmemory entries for the calendar default view or nav. The codegraph grounding above is authoritative for the current contract.)

---

## Overview

The Google Calendar panel's default view is locked to the CURRENT month: main computes a fixed `[first-of-this-month, first-of-next-month)` window, reads events, and pushes a month-grid surface whose month is derived from `timeMin`. Users cannot look at any other month. This feature adds month/year navigation controls to the live default-view month grid — previous/next month, previous/next year jump, and a "Today" (오늘) reset — so a user can browse other months and years without leaving the panel.

---

## User Scenarios

### Browse the previous / next month · P1

**As a** cosmos user with Google Calendar connected
**I want to** step the calendar to the adjacent month
**So that** I can review what happened last month or what is coming next month without being stuck on the current month.

**Acceptance criteria:**

- Given the live default view is showing the current month, when I click the next-month (▶) control, then the grid re-reads and repaints the next month's events and the month/year label updates to that month (Korean `YYYY년 M월`).
- Given the live default view is showing some month, when I click the previous-month (◀) control, then the grid re-reads and repaints the previous month and updates the label.
- Given a month read is in flight, then the panel shows its existing loading affordance (the month-grid skeleton / spinner already used for the default read) until the new month's surface lands.

### Jump by a whole year · P1

**As a** cosmos user
**I want to** jump back or forward a full year in one action
**So that** I can reach a distant month quickly without clicking the month arrow twelve times.

**Acceptance criteria:**

- Given the grid is showing `2026년 6월`, when I click the next-year jump (▶▶), then the grid re-reads and repaints `2027년 6월`.
- Given the grid is showing `2026년 6월`, when I click the previous-year jump (◀◀), then the grid re-reads and repaints `2025년 6월`.
- Given a year jump crosses no month boundary (same month number, different year), then only the year in the label changes.

### Return to today · P1

**As a** cosmos user who has navigated away
**I want to** a single "오늘" (Today) control that returns the grid to the current month
**So that** I can get back to "now" without manually stepping back.

**Acceptance criteria:**

- Given I have navigated to a non-current month, when I click "오늘", then the grid re-reads and repaints the CURRENT month (the same month a fresh tab would load).
- Given the grid is already showing the current month, then the "오늘" control is a no-op (or visibly disabled) and triggers no re-read.
- Given I am on the current month, then the "today" day cell continues to carry its today indicator exactly as before.

### Navigated month survives a tab round-trip (session-only) · P1

**As a** cosmos user
**I want to** the navigated month to persist while I switch away from and back to the Calendar tab within the same session
**So that** I do not lose my place when I glance at another panel.

**Acceptance criteria:**

- Given the live default view is showing a navigated month (not the current month), when I switch to another rail surface and back to the same Calendar tab, then the grid still shows that navigated month (it does NOT snap back to the current month).
- Given I open a NEW Calendar tab (the `+`), then that new tab loads the CURRENT month (the navigated month is per-tab and not inherited).
- Given I restart the app (or reload), then every Calendar tab's live default view resets to the current month (the navigated month is NOT persisted to the session snapshot).

### Refresh re-reads the displayed month · P1

**As a** cosmos user viewing a navigated month
**I want to** the panel's refresh control to re-fetch the month I am currently looking at
**So that** I see fresh data for that month, not for the current month.

**Acceptance criteria:**

- Given the live default view is showing a navigated month, when I trigger the panel refresh control, then the panel re-reads THAT SAME month's window and repaints it (it does not jump to the current month).
- Given the live default view is showing the current month, when I refresh, then it re-reads the current month (unchanged from today's behavior).

### Recover from a failed month read · P2

**As a** cosmos user navigating months
**I want to** a clear, recoverable message when a month fails to load
**So that** I can retry without the panel breaking or silently showing the wrong month.

**Acceptance criteria:**

- Given I navigate to a month and its read fails (rate-limited / network / thrown), when the failure lands, then the panel shows the existing recoverable Notice/error affordance and the displayed-month intent is preserved so I can retry/refresh that same month.
- Given a failed month read, then the navigation controls remain usable (I can step to another month or press "오늘").

### Navigation only applies to the live default view · P2

**As a** cosmos user who has an agent-composed calendar surface open in a tab
**I want to** month/year navigation to apply only to the LIVE default-view month grid, not to a frozen composed surface
**So that** an agent's answer to a specific question is not silently mutated by me clicking an arrow.

**Acceptance criteria:**

- Given a tab holds an agent-COMPOSED calendar surface (a snapshot, `composed: true`), then the month/year navigation controls are not offered for that surface (composed surfaces are frozen — out of scope for nav).
- Given a tab holds the live default view (`composed: false`), then the navigation controls are offered.

---

## Functional Requirements

> "MUST" = required, "SHOULD" = recommended, "MAY" = optional.

| ID     | Requirement                                                                                                                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| FR-001 | The live default-view month grid MUST present a navigation control cluster matching the visual target `◀◀ ◀ {YYYY년 M월} ▶ ▶▶ [오늘]`: previous-year jump (◀◀), previous-month (◀), the Korean month/year label, next-month (▶), next-year jump (▶▶), and a "오늘" (Today) reset. |
| FR-002 | Stepping previous/next MONTH MUST move the displayed window by exactly one calendar month, correctly crossing year boundaries (Dec → next Jan; Jan → prev Dec).                                                                                                                |
| FR-003 | The year-jump controls MUST move the displayed window by exactly one calendar year while preserving the month number.                                                                                                                                                         |
| FR-004 | The "오늘" control MUST set the displayed window to the CURRENT month — identical to the window a fresh tab loads.                                                                                                                                                            |
| FR-005 | When the displayed month already equals the current month, the "오늘" control MUST NOT trigger a re-read (no-op), and SHOULD be visibly disabled to signal the no-op.                                                                                                          |
| FR-006 | Each navigation action (month step, year jump, "오늘" when not already current) MUST cause main to RE-FETCH that target month's events window and push a fresh live default-view `EventList` surface for `target: 'google-calendar'`; the rendered grid's month MUST derive from the new surface's `timeMin` (the existing `monthFromWindow` contract). |
| FR-007 | The renderer MUST request a navigated month via the SAME default-view IPC channel, extended with an OPTIONAL target-month parameter (see FR-008). Absent the parameter, the channel MUST behave exactly as today (current month). The single typed IPC contract in `src/shared/ipc.ts` MUST remain the only source of the channel string and payload shape. |
| FR-008 | The target-month parameter MUST identify a month unambiguously and be timezone-safe for deriving `[first-of-month, first-of-next-month)`. The shape SHOULD be a `{ year, month }` pair (year as a 4-digit integer; month as a 1-based or 0-based integer — the plan finalizes the exact convention) rather than a free-form date string, so the boundary validator can range-check it. |
| FR-009 | The target-month parameter MUST be validated at the main-process boundary. An invalid or out-of-range parameter (non-integer, NaN, absurd year, out-of-range month) MUST be warned and IGNORED, falling back to the CURRENT month, and MUST NOT crash — consistent with the project's "invalid payload → warn + ignore" rule. |
| FR-010 | The navigated month MUST be RENDERER-ONLY and SESSION-ONLY ephemeral state, mirroring the calendar legend hidden-set pattern: it survives switching away/back to the tab within the session but is NOT written to the session snapshot, requires NO `SESSION_SCHEMA_VERSION` bump, and resets to the current month on a fresh tab / app restart / reload. |
| FR-011 | The navigated month MUST be PER-TAB: a new Calendar tab MUST load the current month regardless of where another tab is navigated.                                                                                                                                            |
| FR-012 | The panel refresh control MUST re-read the CURRENTLY DISPLAYED month of the live default view (not always the current month). Refreshing a navigated month MUST re-read that same month's window.                                                                              |
| FR-013 | While a navigated-month read is in flight, the panel MUST show its existing loading affordance for the default read (the month-grid skeleton / surface spinner already in the panel), and MUST NOT leave the controls in an indefinitely stuck state if the read fails.        |
| FR-014 | Rapid successive navigation actions MUST NOT paint an older month over a newer request: if reads resolve out of order, the surface shown MUST correspond to the user's LATEST navigation intent, not a stale in-flight read.                                                    |
| FR-015 | A failed navigated-month read MUST surface the existing recoverable Notice/error affordance, MUST preserve the user's displayed-month intent so a retry/refresh re-reads that same month, and MUST keep the navigation controls usable.                                         |
| FR-016 | When the panel is `not_connected` or `reconnect_needed`, the content region MUST continue to route to the native Connect/Reconnect affordance (unchanged); navigation controls MUST NOT be operable in that state. On reconnect, the default view MUST load the current month (the navigated state does not survive a disconnect within this contract). |
| FR-017 | Month/year navigation MUST apply ONLY to the live default view (`composed: false`). Agent-COMPOSED calendar surfaces (frozen snapshots, `composed: true`) MUST NOT expose the navigation controls and MUST NOT be mutated by navigation.                                       |
| FR-018 | The feature MUST remain READ-ONLY: it introduces NO new OAuth scope, write tool, or adapter dispatcher. Navigation is solely reads of different month windows. Tokens/secrets MUST remain in main and never appear in any IPC payload, bridge frame, or surface.               |
| FR-019 | This feature adds a NEW renderer surface element (the navigation control cluster) and therefore REQUIRES a Step 2.5 design pass (`designer` agent / `design` skill) before interface/implementation, so the controls conform to the Tailwind + shadcn/ui design system.        |

## Edge Cases & Constraints

- **Out-of-order resolution (stale read):** A user clicks ▶ several times quickly. Earlier month reads may resolve after later ones. The surface displayed must reflect the LATEST navigation intent, never an older month painted over a newer one (FR-014). The mechanism (request sequencing / latest-wins correlation) is a plan concern.
- **Year boundary crossings:** Dec → Jan increments the year; Jan → Dec decrements it (FR-002). Year jumps keep the month number and shift only the year (FR-003).
- **"오늘" already current:** No-op / disabled, no re-read (FR-005).
- **Failed month read:** Recoverable Notice, displayed-month intent preserved, controls stay usable (FR-015).
- **Not-connected / reconnect-needed mid-navigation:** Content routes to the native Connect/Reconnect affordance; on reconnect the current month loads; navigated state does not survive a disconnect (FR-016).
- **Composed surfaces vs live default view:** Navigation is offered ONLY on the live default view; composed snapshots are frozen (FR-017).
- **Loading affordance reuse:** The in-flight navigated read reuses the panel's existing month-grid skeleton / surface spinner; this feature introduces no new loading widget (FR-013).
- **Invalid target-month param:** Warned + ignored at the main boundary, falls back to the current month, never crashes (FR-009).
- **Spillover day cells:** Adjacent-month spillover cells in the grid stay muted/empty exactly as today; navigation changes only which month is the in-month month.
- **Out of scope:** week/day/agenda view modes; arbitrary date pickers beyond the prev/next/year/today cluster; persisting the navigated month across app restarts; navigating composed surfaces; any write/scope change; multi-month or range views; keyboard-shortcut bindings for navigation (MAY be considered in a later version, not required here).

## Success Criteria

| ID     | Criterion                                                                                                                                               |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| SC-001 | A connected user can reach any past or future month/year from the live default view using only the `◀◀ ◀ … ▶ ▶▶ [오늘]` cluster, and the grid + Korean label update to the chosen month. |
| SC-002 | "오늘" returns the grid to the current month from any navigated state, and is a no-op/disabled when already current.                                     |
| SC-003 | A navigated month survives switching away/back to the same Calendar tab in-session, and resets to the current month on a fresh tab and on app restart/reload (verified with no session-snapshot field and no `SESSION_SCHEMA_VERSION` bump). |
| SC-004 | The panel refresh control re-reads the currently displayed month (verified: navigate, then refresh, and the same month — not the current month — repaints). |
| SC-005 | Rapid prev/next clicking never leaves an older month painted over the user's latest navigation intent.                                                   |
| SC-006 | A failed navigated-month read shows a recoverable Notice, preserves the displayed-month intent, and leaves the controls usable; an invalid target-month IPC payload is warned + ignored with a current-month fallback and no crash. |
| SC-007 | No new OAuth scope, write tool, or adapter dispatcher is added; no token/secret appears in any IPC payload, bridge frame, or surface.                    |

---

## Notes for the architect plan / cross-layer reasoning

> These are architecture observations recorded here (per orchestrator instruction NOT to edit `docs/ARCHITECTURE.md` while concurrent edits are in flight). The plan finalizes the exact shapes.

- **This is a cross-layer change, not a pure renderer re-bucket.** The grid's month derives from the surface's `timeMin`, which main supplies. Today `googleCalendarDefaultWindow()` (src/main/index.ts:1121) hard-computes the CURRENT month from `new Date()` with no parameter. Navigating to another month therefore requires a main-process RE-FETCH of that month's window: renderer nav control → `googleCalendar.requestDefaultView({ year, month })` IPC → main boundary validation → `googleCalendarDefaultWindow(targetMonth?)` → bounded read → fresh `EventList` surface pushed `target: 'google-calendar'`.
- **IPC contract extension (single typed contract rule).** `GoogleCalendarChannelName.RequestDefaultView` stays the channel; extend the payload type `GoogleCalendarRequestDefaultViewPayload` from `Record<string, never>` to carry an OPTIONAL target-month (e.g. `{ year: number; month: number }`), and `GoogleCalendarApi.requestDefaultView` from `(): void` to `(params?: …): void`. Default (no param) MUST behave exactly as today. The boundary validator `validateRequestDefaultView` is currently SHARED with Jira (returns `{}`); the calendar channel needs its OWN calendar-specific validator (or a widened variant gated to the calendar channel) so adding the optional param does not change Jira's empty-payload contract. The plan must resolve this validator split.
- **Renderer-only ephemeral state precedent.** The navigated-month state mirrors the legend hidden-set in `EventList` (src/renderer/googleCalendarCatalog/components.tsx:377): a `useState` value, seeded fresh, never persisted, not in the session snapshot, no schema bump. Per-tab. The plan decides where this state lives (panel vs. tab record vs. catalog surface) given that the displayed month is also encoded in the landed surface's `timeMin` — the renderer's "intent" month and the surface's `timeMin` must agree, and the intent month is what refresh and stale-read sequencing key on.
- **Refresh target.** The live default view is UN-bound (no adapter descriptor), so `adapterDispatcher.refresh` does not drive it; the panel's refresh of the live default view must re-issue `requestDefaultView({ displayed month })` rather than refresh a descriptor. The plan must wire the panel refresh control's behavior for the live default view to the displayed-month intent (FR-012). (Composed surfaces continue to refresh via their own path, unchanged.)
- **Stale-read sequencing.** The unsolicited `requestDefaultView` frame lands via `useGenerativePanelTabs`'s panel-level `ui:render` subscription into the active/originating tab. Because multiple navigated reads can be in flight, the plan needs a latest-wins mechanism so an older month's frame does not overwrite a newer navigation (FR-014). Consider whether the displayed-month intent (held renderer-side) can gate which landed surface is accepted, since the surface's `timeMin` carries its month.
- **Design dependency.** The nav cluster is a new renderer surface element → Step 2.5 design required (FR-019) before interface/test/implement.

---

## Open Questions

- None blocking. Product decisions (controls, session-only/renderer-only persistence, refresh-the-displayed-month) are fixed by the requester. The remaining choices — exact target-month param convention (0- vs 1-based month), the validator split from Jira's shared empty validator, and where the per-tab navigated-month intent lives relative to the surface `timeMin` and the stale-read gate — are implementation decisions deferred to the architect plan, not unresolved product behavior.
