# Plan: Calendar Month/Year Navigation — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/calendar-month-year-nav-v1.md

---

## Grounding

> Direct investigation performed for this plan (mandatory report). I ran these tools myself
> rather than relying on the orchestrator's notes; the takeaways below are what they actually
> returned on disk.

**codegraph**

- `codegraph_explore("googleCalendarDefaultWindow googleCalendarSurfaceBuilder requestDefaultView validateRequestDefaultView")`
  — confirmed `googleCalendarDefaultWindow()` (src/main/index.ts:1121) takes **no parameter** and hard-computes
  `[first-of-this-month, first-of-next-month)` from `new Date()`. `validateRequestDefaultView` (src/shared/validate.ts:283)
  is **shared with Jira**, returns `{}`, has 2 callers in `src/main/index.ts` (Jira + Calendar both reuse it). The
  Calendar `RequestDefaultView` handler (index.ts:1156) currently calls `validateRequestDefaultView(raw)` then
  `handleGoogleCalendarDefaultView()` with no month argument. ⚠️ no covering tests on either symbol.
- `codegraph_explore("GoogleCalendarPanel requestDefaultInActiveTab useGenerativePanelTabs monthFromWindow buildMonthGrid EventList CalendarMonthGrid buildDefaultViewSurface")`
  — the call flow `CalendarMonthGrid → buildMonthGrid → monthFromWindow`. `monthFromWindow(timeMin, now)`
  (logic.ts:320) derives `{year, month(0-based)}` from the surface's `timeMin`, falling back to `now`. The unsolicited
  `requestDefaultView` frame lands via `useGenerativePanelTabs`'s panel-level `ui:render` subscription (ts:272) into
  the originating-or-active tab; an unsolicited frame sets `composed: false` (ts:346 `composed: wasSolicited`). The
  `EventList` legend hidden-set (components.tsx:377) is the renderer-only ephemeral `useState` precedent — seeded
  from the surface, re-seeded only on a new calendar set, never persisted.
- Read `src/renderer/GoogleCalendarPanel.tsx` — the panel fires `requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView())`
  into an EMPTY connected active tab (line 269). The panel already holds `activeTab`, `update`, and a per-tab
  `loadingDefault` skeleton (`MonthGridSkeleton`).
- Read `src/main/index.ts:1176` `handleGoogleCalendarDefaultView()` — composes via `listAggregatedEvents(window)`
  (shared-calendars-v1) and pushes `buildGoogleCalendarSharedViewSurface(result.data, window)` `target:'google-calendar'`.
  The window is the ONLY month input; everything downstream is window-driven.
- Read `src/renderer/PanelRefreshButton.tsx` + `panelRefreshLogic.ts` — **decisive finding:** the panel refresh
  control dispatches `adapter.refresh` and is `enabled` ONLY when the active surface carries a `descriptor`/`bindings`.
  The live default view is UN-bound (no descriptor), so `derivePanelRefreshState` returns `enabled:false` for it —
  the existing refresh button is **disabled** on the live default view today. Refresh-the-displayed-month (FR-012)
  therefore CANNOT reuse the `adapter.refresh` path; it needs a calendar-specific re-issue of `requestDefaultView`.
- Read `src/preload/index.ts:267` — `requestDefaultView()` sends an explicit `{}` so main's `isObject` boundary
  validator accepts it. Read `src/shared/ipc.ts:700-763` — `GoogleCalendarChannelName.RequestDefaultView`,
  `GoogleCalendarRequestDefaultViewPayload = Record<string, never>`, `GoogleCalendarApi.requestDefaultView(): void`.
- Read `src/renderer/googleCalendarCatalog/logic.ts:370` `buildMonthGrid` — the in-grid `monthLabel` is **English**
  (`${MONTH_NAMES[month]} ${year}`, line 430), NOT the Korean `YYYY년 M월` the spec's nav cluster (FR-001) calls for.
  The nav-cluster label is a NEW element; the Korean label is its own concern (see "Label" note in Phase 3).
- Read `.sdd/plans/ipc-modular-refactor-v1.md` — the refactor moves the Google Calendar contract to
  `src/shared/ipc/googleCalendar.ts` and its validators to `src/shared/ipc/googleCalendar.validate.ts`, behind kept
  `src/shared/ipc.ts` / `src/shared/validate.ts` barrels. `validateRequestDefaultView` is inventoried under **jira**
  (`jira.validate.ts`). This directly informs the coordination + validator-split decisions below.

**agentmemory**

- `memory_recall("google calendar default view month navigation refresh per-tab")` → no results.
- `memory_smart_search("jira default view requestDefaultView validator shared empty payload refresh adapter dispatcher")`
  → no results. (No prior stored decision for the calendar default view or its nav; the codegraph grounding above is
  authoritative.)
- `memory_save(...)` → persisted this plan's load-bearing decisions (target-month param, validator split, per-tab
  renderer-only intent, refresh re-issues `requestDefaultView`, stale-read latest-wins, ipc-refactor sequencing) as
  `mem_mqjlme97_e36b044fc31c` (type: architecture).

---

## Summary

Add month/year navigation (`◀◀ ◀ {YYYY년 M월} ▶ ▶▶ [오늘]`) to the Google Calendar live default-view month grid.
Today the month is fixed: `googleCalendarDefaultWindow()` hard-computes the current month and the grid derives its
month from the pushed surface's `timeMin`. The chosen approach keeps that window-driven render but lets the renderer
**ask main for a specific month** by extending the existing `googleCalendar:requestDefaultView` channel with an
**optional `{ year, month }` target-month payload** (1-based `month`, see Decision 1). `googleCalendarDefaultWindow`
learns to accept an optional target month and compute `[first-of-that-month, first-of-next-month)`; absent the param
it behaves exactly as today (current month). A **new calendar-specific boundary validator**
(`validateGoogleCalendarRequestDefaultView`) range-checks the param and falls back to the current month on anything
invalid (Decision 2) — Jira's shared `validateRequestDefaultView` (returns `{}`) is left untouched. The navigated
month is **renderer-only, per-tab, session-only** ephemeral state held in `GoogleCalendarPanel` (mirroring the
`EventList` legend-hidden-set `useState`), NOT written to the session snapshot and requiring no
`SESSION_SCHEMA_VERSION` bump (Decision 3). The panel's refresh of the live default view **re-issues
`requestDefaultView` for the displayed month** (the existing `adapter.refresh` path is disabled for the un-bound
default view), and a **latest-wins gate** (compare the landed surface's `timeMin` month against the current intent)
prevents an out-of-order older read from painting over a newer navigation. The nav cluster renders ONLY for the live
default view (`composed: false`); composed snapshots stay frozen. Read-only throughout — no new scope, write tool,
or adapter; no token in any payload or surface. This is a UI-bearing feature, so a **`design` step precedes
interface/implementation** (FR-019).

## Technical Context

| Item              | Value                                                                                                                                                                                                                                                                                                       |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Language          | TypeScript (Electron: main + preload + renderer; node + web tsconfig projects)                                                                                                                                                                                                                              |
| Key dependencies  | Existing only — `@a2ui-sdk/react/0.9`, shadcn/ui `Button`, lucide icons. NO new runtime deps, NO new OAuth scope, NO adapter/dispatcher.                                                                                                                                                                     |
| Files to create   | `src/renderer/calendarNavLogic.ts` (pure month-arithmetic + latest-wins helpers) + `src/renderer/calendarNavLogic.test.ts`; nav-cluster component (location decided in design — likely `src/renderer/googleCalendarCatalog/components.tsx` extension or a `CalendarNavCluster.tsx`); validator test additions. |
| Files to modify   | `src/shared/ipc.ts` (payload + Api), `src/shared/validate.ts` (new validator), `src/main/index.ts` (`googleCalendarDefaultWindow` param + handler + boundary call), `src/preload/index.ts` (`requestDefaultView` param), `src/renderer/GoogleCalendarPanel.tsx` (per-tab intent + nav wiring + refresh), `src/renderer/googleCalendarCatalog/components.tsx` (`EventList` exposes/hosts nav). |
| Verification      | `npm run typecheck` (node + web), `npm test` (vitest); manual: navigate months/years, "오늘", tab round-trip, refresh-displayed-month, rapid-click latest-wins, invalid-payload fallback.                                                                                                                       |
| Coordination      | **Shares `src/shared/ipc.ts` + `src/shared/validate.ts` with `.sdd/plans/ipc-modular-refactor-v1.md` — MUST land sequentially, not concurrently** (see "Coordination with the ipc-modular-refactor" below).                                                                                                  |

---

## Resolved Decisions (the three items the spec deferred to the plan)

### Decision 1 — Target-month param convention: `{ year, month }`, 1-based month

The renderer asks for a specific month with a structured pair, **not** a free-form date/ISO string:

```ts
/** R->M. Optional target month for the calendar default view. Absent ⇒ current month (today's behavior). */
export interface GoogleCalendarRequestDefaultViewPayload {
  /** 4-digit calendar year, e.g. 2026. */
  year?: number
  /** 1-based month: 1 = January … 12 = December. */
  month?: number
}
```

- **Why `{ year, month }` not a `timeMin` ISO string:** FR-008 requires the param be range-checkable and
  timezone-safe at the boundary. A `{ year, month }` integer pair lets the validator reject NaN / out-of-range
  cleanly, and lets main build the window with **local** `new Date(year, month-1, 1)` — the exact construction
  `googleCalendarDefaultWindow()` already uses (`new Date(now.getFullYear(), now.getMonth(), 1)`), so there is no
  UTC-shift risk. A `timeMin` ISO string would re-introduce the timezone ambiguity `monthFromWindow`/`eventDayKey`
  already work hard to avoid, and is not cleanly range-checkable.
- **Why 1-based `month`:** the WIRE contract is human-facing (it appears in the validator warn text and is what a
  future agent/MCP caller would supply); 1-based matches the Korean `M월` label and ordinary calendar usage, removing
  an off-by-one trap on the wire. **Conversion happens in exactly one place:** main subtracts 1 when constructing the
  Date (`new Date(year, month - 1, 1)`), symmetric with `googleCalendarDefaultWindow`'s existing 0-based `getMonth()`.
  The renderer's internal intent state (Decision 3) and `monthFromWindow` continue to use JS-native **0-based** months;
  the 1-based form exists ONLY on the wire. `calendarNavLogic.ts` owns the single 0-based↔1-based boundary so the
  convention never leaks.
- **Both fields optional, all-or-nothing semantics:** absent (or partial — only one of the two present) ⇒ fall back
  to the current month (FR-007 "absent the parameter, behave exactly as today"; FR-009 invalid ⇒ current-month
  fallback). The validator treats "neither present" as the valid empty/today payload and "exactly one present" or
  "out of range" as invalid-but-recoverable → current month.

### Decision 2 — Validator split: a NEW calendar-specific validator, same channel

- **Keep the channel** `GoogleCalendarChannelName.RequestDefaultView` (FR-007 "same default-view IPC channel,
  extended with an optional param"). A new channel would fragment the one-trigger-per-panel pattern and force the
  panel/preload to branch.
- **Do NOT touch Jira's `validateRequestDefaultView`.** It is shared with Jira, returns `{}`, and Jira's payload
  contract MUST stay `Record<string, never>`. Widening it would silently change Jira's contract and is rejected.
- **Add `validateGoogleCalendarRequestDefaultView(raw, warn)`** in `src/shared/validate.ts`, returning
  `GoogleCalendarRequestDefaultViewPayload | null`, that:
  - `isObject` guard (warn + ignore non-object, consistent with every sibling validator);
  - if BOTH `year` and `month` are absent → return `{}` (valid "today" payload);
  - if present, require `year` and `month` to be **finite integers** in range (`year` within a sane band, e.g.
    `1970 ≤ year ≤ 9999`; `month` `1..12`). A non-integer / NaN / out-of-range / only-one-present value →
    **warn and return `{}`** (NOT `null`) so the handler proceeds with the current-month fallback rather than dropping
    the trigger entirely. Rationale: FR-009 says invalid ⇒ "warn and IGNORED, falling back to the CURRENT month" — a
    `null` return would drop the whole frame (the tab would hang on `loadingDefault`), whereas returning `{}` honors
    the "fall back to current month" requirement and still repaints. The warn names `googleCalendar:requestDefaultView`.
- The Calendar IPC handler (index.ts:1156) switches from `validateRequestDefaultView` to
  `validateGoogleCalendarRequestDefaultView`, passes the validated `{ year?, month? }` into
  `handleGoogleCalendarDefaultView(target?)`, which threads it to `googleCalendarDefaultWindow(target?)`.
- **Layout under the ipc-modular-refactor:** when the refactor has landed, this validator lives in
  `src/shared/ipc/googleCalendar.validate.ts` (its per-domain home) and the payload type in
  `src/shared/ipc/googleCalendar.ts` — NOT in `jira.validate.ts` where `validateRequestDefaultView` is inventoried.
  See coordination note for ordering.

### Decision 3 — Per-tab navigated-month intent: renderer-only `useState` in `GoogleCalendarPanel`, keyed by tab id

- **Where it lives:** a `Map<tabId, { year, month }>` (0-based month) held as a `useState`/`useRef` in
  `GoogleCalendarPanel` (NOT in the catalog `EventList`, NOT in the `GenerativeTab` record, NOT in the session
  snapshot). The panel already owns the tab collection, `activeTab`, `update`, `requestDefaultInActiveTab`, and the
  default-view trigger — so the intent, the IPC re-issue, and the refresh all sit in one place. This mirrors the
  `EventList` legend hidden-set precedent (renderer-only `useState`, never persisted, no schema bump — FR-010) but is
  hoisted to the PANEL (not the catalog component) because:
  1. it must survive the `A2UIProvider key={activeTab.id}` remount that a tab switch forces (state inside `EventList`
     is torn down on remount; panel state is not) — satisfying FR-010 "survives switching away/back" and
     SC-003/scenario "survives a tab round-trip";
  2. the panel, not the catalog, owns the `requestDefaultView` call and the refresh, which both key on the intent;
  3. per-tab keying (FR-011) is natural at the panel where tab ids exist; a new `+` tab simply has no map entry →
     defaults to the current month.
- **Intent ↔ surface agreement:** the displayed month is encoded TWICE — as the panel's intent map entry AND as the
  landed surface's `timeMin` (via `monthFromWindow`). They must agree. The intent is the **source of truth for what to
  request/refresh**; the surface `timeMin` is the **source of truth for what to render** (the grid already derives
  from it, unchanged). A navigation action updates the intent → issues `requestDefaultView({year,month})` → main reads
  → pushes a surface whose `timeMin` is that month → grid repaints. The intent leads; the surface follows.
- **Default / reset semantics:** no map entry for a tab ⇒ current month (a fresh `+` tab, FR-011). "오늘" clears the
  tab's map entry (or sets it to the current month) and, only if the displayed month is not already current, re-issues
  the request (FR-004/FR-005 no-op when already current). App restart/reload starts with an empty map (renderer state
  is not restored) → current month (FR-010, SC-003). Reconnect: the panel's existing empty-tab default-load effect
  re-fires `requestDefaultView()` with no param (current month), and the intent map is cleared for that tab on
  disconnect so it does not re-request a stale navigated month (FR-016).
- **Refresh wiring (FR-012):** because the live default view is UN-bound, the existing `PanelRefreshButton`
  (`adapter.refresh`, descriptor-gated) is **disabled** for it. The panel must drive refresh of the live default view
  itself: when the active tab holds the live default view (`composed: false`) and its surface is the calendar
  default-view surface, the refresh control re-issues `requestDefaultView(intentForActiveTab)` — re-reading the
  DISPLAYED month, not the current month. The exact refresh-button surface (extend `PanelRefreshButton` to accept an
  optional panel-supplied `onRefresh` override for the un-bound default view, vs. a calendar-local refresh affordance)
  is settled in the design step; the LOGIC (refresh = re-issue request for the intent month) is fixed here. Composed
  surfaces keep refreshing via their own `adapter.refresh` path, unchanged.
- **Stale-read latest-wins (FR-014):** navigated reads can resolve out of order. The panel holds a per-tab
  **expected month** (= the intent it last requested). When an unsolicited `target:'google-calendar'` frame lands for
  a tab, the panel compares the surface's `timeMin` month (via `monthFromWindow`) against that tab's current intent;
  if they DISAGREE the frame is a stale older read and is **dropped** (not painted). Because the intent is updated
  synchronously on click and the surface carries its own month, the latest click always wins. This gate is the
  pure-testable core of `calendarNavLogic.ts` (`isSurfaceForIntent(timeMin, intent, now)`). Note the
  `ui:render` filing happens inside `useGenerativePanelTabs`; the panel cannot intercept there without a hook change.
  Resolution: the panel applies the latest-wins gate at RENDER time, not at file time — it passes its per-tab intent
  to the catalog/grid, and a landed surface whose `timeMin` month ≠ the active tab's intent is treated as stale and
  the grid keeps showing (or re-requests) the intent month. (If the design/interface step finds a cleaner seam — e.g.
  the panel deriving the grid's month from intent and only using the surface's EVENTS — that is an acceptable
  refinement recorded as a deviation; the REQUIREMENT is "latest navigation intent always wins".)

---

## Implementation Checklist

> Update the checklist as work progresses; add inline notes when a step deviates. Order keeps the tree green at each
> step: contract first, then main, then renderer logic (pure + tested), then the UI wiring, with the design step
> gating the visual surface.

### Phase 0 — Design (Step 2.5, REQUIRED before interface — FR-019)

- [ ] Hand off to the `designer` agent (`design` skill) to design the `◀◀ ◀ {YYYY년 M월} ▶ ▶▶ [오늘]` nav cluster as
      a `.sdd/designs/calendar-month-year-nav-v1.md` design spec, conforming to the Tailwind + shadcn/ui design system.
      Design decides: the cluster's component location (catalog `EventList` header vs. a dedicated `CalendarNavCluster`),
      the Korean `YYYY년 M월` label treatment + its relationship to the existing in-grid English `monthLabel`
      (the cluster label likely SUPERSEDES the in-grid `<h2>`), the disabled "오늘" affordance (FR-005), button sizing
      to match panel chrome, the loading/disabled states during an in-flight read (FR-013), and where the
      live-default-view refresh affordance sits relative to the `+`/`PanelRefreshButton` cluster.
- [ ] Confirm the design keeps navigation OFF composed surfaces (FR-017) and OFF the not-connected/reconnect states
      (FR-016).

### Phase 1 — Interface (contract + types)

- [x] Read the spec; confirm no open questions remain (the three deferred items are resolved above).
- [x] In `src/shared/ipc.ts`: widen `GoogleCalendarRequestDefaultViewPayload` from `Record<string, never>` to
      `{ year?: number; month?: number }` (1-based `month`), with a doc comment stating "absent ⇒ current month;
      1-based month; main owns the window construction". Update `GoogleCalendarApi.requestDefaultView` from
      `(): void` to `(params?: GoogleCalendarRequestDefaultViewPayload): void`. **Do NOT change the channel string.**
- [x] In `src/shared/validate.ts`: add `validateGoogleCalendarRequestDefaultView(raw, warn)` per Decision 2 (returns
      the payload, `{}` for absent OR invalid-with-warn, `null` only for a non-object). **Leave Jira's
      `validateRequestDefaultView` untouched.**
- [x] In `src/preload/index.ts`: change `requestDefaultView()` to `requestDefaultView(params?)` — send the validated
      `{ year, month }` object when supplied, else the existing `{}` (so the boundary `isObject` guard still passes
      for the no-param current-month trigger).
- [x] Create `src/renderer/calendarNavLogic.ts` (pure, node-testable, no React/IPC): the month arithmetic and gating
      primitives — `stepMonth(intent, delta)` (±1 month with year carry, FR-002), `stepYear(intent, delta)` (±1 year,
      same month, FR-003), `currentMonth(now)` (FR-004), `isCurrentMonth(intent, now)` (FR-005 no-op gate),
      `toWirePayload(intent)` (0-based intent → 1-based `{year, month}`), and `isSurfaceForIntent(timeMin, intent, now)`
      (latest-wins stale-read gate, FR-014, built on `monthFromWindow` semantics). Intent is `{year, month}` 0-based
      internally; the 0↔1 conversion lives ONLY in `toWirePayload`.
- [x] Review every new type/field against the spec — no invented properties (the payload carries ONLY year+month;
      no token, no surface id, no extra field — FR-018).

### Phase 2 — Testing

- [x] `src/renderer/calendarNavLogic.test.ts`: happy-path month step (mid-year), **year-boundary crossings**
      (Dec→Jan increments year; Jan→Dec decrements year — FR-002), year jump preserves month (FR-003), `currentMonth`
      + `isCurrentMonth` no-op gate (FR-005), `toWirePayload` 0→1-based conversion (Jan = month 1), and
      `isSurfaceForIntent` latest-wins (a surface `timeMin` whose month ≠ intent is rejected as stale; matching is
      accepted — FR-014).
- [x] Validator tests for `validateGoogleCalendarRequestDefaultView` (add to the existing
      `validateGoogleCalendar.test.ts` per that file's conventions): valid `{year, month}` accepted; absent both →
      `{}`; non-object → `null`; out-of-range month (0, 13), absurd/NaN year, non-integer, only-one-field-present →
      warned + `{}` (current-month fallback), never throws (FR-009). Assert the warn fires and the token/secret
      invariant (no secret in the payload) is structurally impossible (FR-018).
- [ ] (If a panel/integration test harness exists for the other panels' default-view flow) a renderer test asserting
      the navigated month survives a simulated tab switch and a new `+` tab loads the current month (FR-010/FR-011) —
      otherwise cover via the pure-logic tests + manual verification noted in Phase 4.

### Phase 3 — Implementation

- [x] `src/main/index.ts`: change `googleCalendarDefaultWindow(target?: { year: number; month: number })` to compute
      `[first-of-target-month, first-of-next-month)` via `new Date(target.year, target.month - 1, 1)` /
      `(…, target.month, 1)` when supplied (note the **-1**: wire is 1-based, JS Date is 0-based), else the current
      month exactly as today. Thread the validated payload from the `RequestDefaultView` handler →
      `handleGoogleCalendarDefaultView(target?)` → `googleCalendarDefaultWindow(target?)`. Keep
      `listAggregatedEvents(window)` + `buildGoogleCalendarSharedViewSurface(data, window)` unchanged (window-driven).
- [x] Switch the `RequestDefaultView` IPC handler to `validateGoogleCalendarRequestDefaultView` and pass the result
      (a `{}` ⇒ no target ⇒ current month).
- [x] `GoogleCalendarPanel.tsx`: add the per-tab navigated-month intent map (`useState`/`useRef`, Decision 3); wire
      the nav cluster's actions (prev/next month, prev/next year, "오늘") to update the intent + call
      `requestDefaultInActiveTab(() => window.cosmos.googleCalendar.requestDefaultView(toWirePayload(intent)))`
      (re-using the existing `loadingDefault` skeleton for the in-flight read — FR-013); clear the intent on a new tab
      / disconnect; offer the cluster ONLY when the active tab holds the live default view (`composed: false`,
      connected) — FR-016/FR-017.
- [x] Wire refresh-the-displayed-month (FR-012): when the active tab is the live default view, the panel's refresh
      affordance re-issues `requestDefaultView(intentForActiveTab)` (NOT `adapter.refresh`, which is disabled for the
      un-bound view). Implement per the design step's chosen affordance (override on `PanelRefreshButton` or a
      calendar-local control).
- [x] Apply the latest-wins gate (FR-014): the panel passes the active tab's intent to the grid/catalog so a landed
      surface whose `timeMin` month disagrees with the latest intent does not paint an older month (per Decision 3 /
      `isSurfaceForIntent`).
- [x] `googleCalendarCatalog/components.tsx`: host/render the nav cluster per the design (the cluster lives where the
      design places it — likely the `EventList` header region, receiving the intent + handlers from the panel, OR a
      panel-level cluster above the grid). The Korean `YYYY년 M월` label is rendered here; reconcile with / supersede
      the existing English in-grid `monthLabel` per the design.
- [x] All tests pass (`npm test`); `npm run typecheck` green (node + web). Reuse `monthFromWindow` /
      `buildMonthGrid` — do NOT duplicate month-derivation logic in the panel.

### Phase 4 — Docs & verification

- [ ] Manual verification matrix: prev/next month (incl. Dec→Jan, Jan→Dec); prev/next year keeps month; "오늘" resets
      + is a no-op/disabled when current; tab round-trip preserves the navigated month; a new `+` tab loads the current
      month; app reload resets to the current month (and confirm NO session-snapshot field, NO `SESSION_SCHEMA_VERSION`
      bump — SC-003); refresh re-reads the DISPLAYED month (SC-004); rapid prev/next never leaves an older month
      painted (SC-005); a failed month read shows the recoverable Notice + keeps controls usable + preserves intent
      (SC-006); an invalid `{year, month}` IPC payload is warned + falls back to the current month with no crash
      (SC-006); no new scope/write/token anywhere (SC-007).
- [ ] Update this plan's Deviations with anything that landed differently (esp. the nav-cluster location + the
      refresh-affordance shape, both finalized in design).
- [ ] **`docs/ARCHITECTURE.md`** (architect, separate pass): record that the Google Calendar default-view trigger now
      carries an OPTIONAL `{ year, month }` target-month (the channel stays single; the default view remains un-bound
      and is refreshed by re-issuing the request, NOT via the adapter dispatcher), and that the navigated month is
      renderer-only/per-tab/session-only (no snapshot field, no schema bump). Note in `docs/PROJECT-STRUCTURE.md` the
      new `src/renderer/calendarNavLogic.ts`. **Defer these edits** while `docs/ARCHITECTURE.md` has concurrent edits
      in flight (per project constraint); do them in a non-concurrent architect pass.

---

## Coordination with the ipc-modular-refactor (sequential, not concurrent)

This feature **adds a payload type + an `Api` method change in `src/shared/ipc.ts` and a new validator in
`src/shared/validate.ts`**. The queued `.sdd/plans/ipc-modular-refactor-v1.md` **physically splits both files** into
per-domain modules under `src/shared/ipc/` behind same-path barrels. Both touch the SAME two files, so they **MUST
land sequentially** — running them concurrently guarantees a merge collision in `ipc.ts` / `validate.ts`.

Recommended ordering and the resulting placement:

- **If the ipc-modular-refactor lands FIRST (preferred):** this feature's changes go to the per-domain homes the
  refactor establishes — the widened `GoogleCalendarRequestDefaultViewPayload` and the `GoogleCalendarApi` change live
  in `src/shared/ipc/googleCalendar.ts`; `validateGoogleCalendarRequestDefaultView` lives in
  `src/shared/ipc/googleCalendar.validate.ts` (alongside `validateGoogleCalendarListEvents`). The barrels
  (`src/shared/ipc.ts`, `src/shared/validate.ts`) re-export them with zero consumer churn. This keeps the new
  validator in its correct per-domain home rather than next to Jira's `validateRequestDefaultView` (which the refactor
  inventories under `jira.validate.ts`).
- **If THIS feature lands first:** make the contract/validator edits in the current monolithic `ipc.ts` /
  `validate.ts`, and the refactor then moves `GoogleCalendarRequestDefaultViewPayload` +
  `validateGoogleCalendarRequestDefaultView` into the `googleCalendar` per-domain modules as part of its verbatim
  move-map (one extra row to its Domain Inventory). Flag this to the refactor's implementer so the new symbols are
  captured in the move.

Either way: **do not run the two implementations in parallel background agents.** The new calendar channel/validator
**follows the per-domain layout** the refactor establishes (`googleCalendar.ts` / `googleCalendar.validate.ts`),
keeping the "one typed IPC contract" rule intact (physically split, logically single).

## Open Questions

- **None blocking.** The three spec-deferred items are resolved above (param convention = `{year, month}` 1-based on
  the wire / 0-based internally; validator = a new calendar-specific `validateGoogleCalendarRequestDefaultView`,
  Jira's untouched; intent = renderer-only per-tab `useState` in `GoogleCalendarPanel` with a `timeMin`-vs-intent
  latest-wins gate). The remaining choices are **visual** (nav-cluster component location, the Korean-label/​in-grid-label
  reconciliation, and the refresh-affordance shape for the un-bound default view) and are intentionally deferred to
  the **design step** (Phase 0), not left unresolved as product behavior.

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. Resolved the three spec-deferred items (target-month param, validator split, per-tab
  intent + refresh + latest-wins). Recorded the ipc-modular-refactor sequencing constraint. Flagged the design step
  (Phase 0) as gating, and the existing in-grid label being English vs. the spec's Korean nav-cluster label as a
  design reconciliation. Persisted the load-bearing decisions to agentmemory (`mem_mqjlme97_e36b044fc31c`).
- **2026-06-18 (implementation, developer)**: Steps 3–5 implemented on the MAIN working tree (ipc per-domain modules
  already landed). Outcomes/deviations:
  - **IPC + validator landed in the per-domain homes** the refactor established: payload type + `Api` change in
    `src/shared/ipc/googleCalendar.ts`; `validateGoogleCalendarRequestDefaultView` in
    `src/shared/ipc/googleCalendar.validate.ts` (re-exported via the kept `ipc.ts` / `validate.ts` barrels). Jira's
    `validateRequestDefaultView` untouched.
  - **Label = English** `MONTH_NAMES[month] year` ("June 2026") + "Today" per the design override (D2). No Korean
    string introduced. The cluster renders the existing `grid.monthLabel`, so the cluster header + grid `aria-label`
    stay in sync (no second formatter).
  - **Nav-cluster threading seam: a React Context, not surface props (deviation from the plan's "props on
    `EventListNode`").** A2UI catalog components are rendered by `A2UIRenderer` from the surface JSON, so the panel
    cannot pass them React props directly. The panel wraps the live-default-view `A2UIProvider` in a new
    `CalendarNavContext.Provider` (`src/renderer/googleCalendarCatalog/navContext.ts`); `EventList`/`CalendarMonthGrid`
    read it via `useCalendarNav()` and render the `CalendarMonthNav` cluster IN the grid header (the design's PREFERRED
    placement — label+controls+grid as one unit), replacing the plain `<h2>`. Context is non-null ONLY for the live
    default view (`isConnected && surface != null && composed === false`), so composed snapshots + disconnected states
    get the plain label and no controls (FR-016/FR-017) — no surface-builder change, agent/MCP render path untouched.
  - **Refresh-the-displayed-month (FR-012):** added an OPTIONAL `onRefresh` override to `PanelRefreshButton`. When the
    active tab is the live default view the panel passes `onRefresh = () => requestDefaultView(toWirePayload(intent))`,
    which ENABLES the (otherwise descriptor-gated, hence disabled) button and re-reads the displayed month. No second
    visual control (design §7). Composed surfaces keep the unchanged `adapter.refresh` path.
  - **Latest-wins (FR-014):** the pure gate `isSurfaceForIntent(timeMin, intent, now)` is implemented + tested in
    `calendarNavLogic.ts`. Runtime enforcement uses the design's intent-leads/skeleton-swap model: every navigation
    sets the intent SYNCHRONOUSLY and marks the tab `loadingDefault` (the whole grid → `MonthGridSkeleton`, cluster
    unmounted), so the last click's request is the last issued and its surface paints last; the grid month derives from
    that landed surface's `timeMin`. A deeper render-time drop of an out-of-order older frame would need a
    `useGenerativePanelTabs` filing-time hook change (flagged in plan Decision 3 as out of the minimal seam); NOT done
    here. The tested `isSurfaceForIntent` is available if a future iteration wants filing-time gating.
  - **Verification:** `npm run typecheck` (node + web) clean; `npm test` 1367 passed (was 1330; +37 new:
    `calendarNavLogic.test.ts` + the `validateGoogleCalendarRequestDefaultView` cases). New file
    `src/renderer/calendarNavLogic.ts` (+ `.test.ts`) and `src/renderer/googleCalendarCatalog/navContext.ts`.
