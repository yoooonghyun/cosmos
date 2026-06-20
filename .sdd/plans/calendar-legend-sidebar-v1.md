# Plan: Calendar Legend — Left Sidebar Reposition — v1

**Status**: Draft
**Created**: 2026-06-18
**Last updated**: 2026-06-18
**Spec**: .sdd/specs/calendar-legend-sidebar-v1.md

---

## Grounding

> Grounding was performed directly this session with codegraph + agentmemory; the
> orchestrator's notes were verified against the on-disk code, not trusted blindly.

**codegraph_explore** (queries run → one-line takeaways):
- `EventList CalendarLegend CalendarToggle CalendarMonthGrid MonthEmptyNote googleCalendarCatalog components seedHiddenCalendarIds CalendarLegendData` → CONFIRMED the legend is composed in the catalog ROOT `EventList` (`src/renderer/googleCalendarCatalog/components.tsx`), not the panel. `EventList` (lines 341-382) stacks `<CalendarLegend>` above `<CalendarMonthGrid>` inside one `flex flex-col gap-2` column — that single container is the entire reposition surface. `CalendarLegend` (231-257) is a `flex flex-wrap items-center gap-1.5` group of `CalendarToggle` pill buttons (`role="switch"`, `aria-checked`, decorative `aria-hidden` swatch). The hidden-set (`useState` + `seedHiddenCalendarIds`), `seedKey` re-seed effect, `toggle`, suppression (`entries.length <= 1 ⇒ null`), and `CalendarMonthGrid` filtering all already live here and are layout-agnostic.
- The `EventListNode` surface root (326-339) carries `events[]`, `timeMin/timeMax`, `hasMore`, optional `calendars?: CalendarLegendData[]` — each entry ships a surface-RESOLVED `colorToken`/`selected`/`primary`. No data field is added or moved.

**Read** (verbatim): `src/renderer/googleCalendarCatalog/components.tsx` (EventList root, CalendarLegend, CalendarToggle, CalendarMonthGrid, MonthEmptyNote), `src/renderer/googleCalendarCatalog/logic.ts` (CalendarLegendData, seedHiddenCalendarIds, colorTokenFor, tokenColorClasses, buildMonthGrid), `src/renderer/googleCalendarCatalog/logic.test.ts` (pure-logic node tests — color tokens, isAllDay, buildMonthGrid, seeding; NO component/layout test exists), `src/renderer/GoogleCalendarPanel.tsx` (panel shell — hosts the A2UI catalog via `A2UIProvider`; the legend is NOT here, so FR-004 stays satisfied by editing only the catalog).

**memory_recall / memory_smart_search** (`shared-calendars legend catalog root parity color token`; `Google Calendar panel generative UI legend EventList catalog`): no stored hits returned this session for the legend specifically; the cross-session decision (legend in catalog root for parity, renderer-only ephemeral hidden-set, `≤1` suppression) is re-confirmed directly from the code above and from `.sdd/specs/shared-calendars-v1.md`. Persisted this session's reposition decision with `memory_save` (mem id `mem_mqjkmj4b_70b1388f5efd`).

---

## Summary

Reposition the Google Calendar shared-calendar legend from a horizontal strip ABOVE the
month grid to a LEFT SIDEBAR column beside the grid, entirely within the catalog ROOT
`EventList` so the native and agent/MCP render paths get it from one implementation
(FR-004). The change is confined to JSX/Tailwind layout in
`src/renderer/googleCalendarCatalog/components.tsx`: `EventList`'s outer
`flex flex-col gap-2` (legend stacked over grid) becomes a side-by-side flex ROW — a
legend column on the left that scrolls independently (its own `overflow-y`, a
designer-chosen max-width) and the month grid filling the width to its right (also a
designer-chosen max-width) — and `CalendarLegend`'s inner `flex flex-wrap` flips to a
vertical `flex flex-col` toggle list. The hidden-set, seeding, instant filtering,
`≤1`-calendar suppression, empty-month note (in the GRID region), and `role="switch"`
accessibility all stay byte-for-byte behaviorally identical; `logic.ts` and
`logic.test.ts` are untouched. NO data/IPC/bridge/MCP/surface-builder/scope/token
contract changes (FR-006). The concrete visual values (sidebar max-width, grid max-width,
divider, scroll affordance, vertical toggle styling) are set in the **design step** that
follows this plan; the user has resolved the spec's Open Questions: no narrow-width
special handling (no collapse, no wrap-back-to-top), sidebar fixed/auto width (not
user-resizable for v1).

## Technical Context

| Item              | Value                  |
|-------------------|------------------------|
| Language          | TypeScript + React (renderer), Tailwind CSS utility classes |
| Key dependencies  | `@a2ui-sdk/react/0.9` (catalog host, unchanged), `cn` (`src/renderer/lib/utils.ts`), existing `--event-*` token palette from `shared-calendars-v1` (reused as-is, no new tokens) |
| Files to create   | none |
| Files to modify   | `src/renderer/googleCalendarCatalog/components.tsx` (sole code change — `EventList` root layout + `CalendarLegend` orientation; possibly a width container around `CalendarMonthGrid`) |
| Files NOT touched  | `logic.ts`, `logic.test.ts`, `index.ts`, `GoogleCalendarPanel.tsx`, all `src/shared/*`, `src/main/*`, `src/mcp/*`, `src/renderer/index.css` (no `--event-*` additions expected) |
| Follow-ups deferred | Design spec `.sdd/designs/calendar-legend-sidebar-v1.md` (max-widths, divider, scroll affordance, vertical list styling); `docs/ARCHITECTURE.md` note (see Deviations & Notes — NOT edited here due to concurrent edits) |

---

## Implementation Checklist

> Update checklist as work progresses. Add inline notes when a step deviates from plan.
> NOTE: a **design step** (`designer` → `.sdd/designs/calendar-legend-sidebar-v1.md`)
> runs AFTER this plan and BEFORE Phase 2 below — it fixes the concrete sidebar max-width,
> grid max-width, divider/border, independent-scroll affordance, and vertical toggle-list
> styling. Phase 2 consumes those decisions; do not hardcode arbitrary widths before then.

### Phase 1 — Confirm scope (no interface/type work)

- [ ] Re-read `.sdd/specs/calendar-legend-sidebar-v1.md`; confirm Open Questions are resolved (narrow-width: NO special handling; sidebar: fixed/auto width, not resizable) — no `[NEEDS CLARIFICATION]` blocks remain for implementation.
- [ ] Confirm NO TypeScript type/interface change is needed: `EventListNode`, `CalendarLegendData`, `EventChipData` are unchanged (this is layout only — FR-006). No edits to `src/shared/*`, `src/main/*`, `src/mcp/*`, the surface builder, IPC, or OAuth scope.
- [ ] Confirm the legend stays composed in the catalog ROOT `EventList` and that `GoogleCalendarPanel.tsx` is NOT edited (FR-004 parity).

### Phase 2 — Implementation (`src/renderer/googleCalendarCatalog/components.tsx`)

- [ ] **`EventList` root → side-by-side row.** Replace the outer `<div className="flex flex-col gap-2">` (legend stacked above grid) with a horizontal flex ROW: legend column FIRST (left), month grid SECOND (right, fills remaining width). Keep the `legend && (...)` conditional so the column is rendered only when legend data is present (FR-005 — no empty rail; the `≤1` suppression inside `CalendarLegend` still returns `null`, so when suppressed the row collapses to a single full-width grid). Use the design step's max-width tokens for both columns (FR-001, FR-007 legibility floor).
- [ ] **Independent legend scroll.** Give the legend column its OWN `overflow-y-auto` (with the design-chosen min/max height behavior) so a long list scrolls within the column and does NOT push or shrink the grid (FR-002, SC-002). The grid column must keep its position and full height when the legend scrolls (and vice versa).
- [ ] **`CalendarLegend` → vertical toggle list.** Change the inner container from `flex flex-wrap items-center gap-1.5` to a vertical `flex flex-col` list (gap + alignment per design). KEEP `role="group" aria-label="Calendars"` and the `entries.length <= 1 ⇒ return null` suppression exactly (FR-005, FR-009). Each `CalendarToggle` stays a `role="switch"` button with `aria-checked`, the decorative `aria-hidden` swatch, and the show/hide label — only its container orientation changes (FR-003, FR-009). The full-width-in-column pill vs. list-row styling is a design-step call; do not change the toggle's semantics.
- [ ] **Month grid stays the grid region.** `CalendarMonthGrid` keeps `MonthEmptyNote` ("Nothing scheduled this month.") INSIDE the grid region, not the sidebar (FR-008). Apply the design-chosen grid max-width via a wrapper or on the grid column so the 7-column grid stays legible (FR-007) — no narrow-mode collapse/wrap logic is added (per resolved Open Question).
- [ ] **Preserve filtering wiring.** Leave `hidden`/`setHidden`, `seedHiddenCalendarIds`, the `seedKey` re-seed effect, `toggle`, and the `hiddenCalendarIds={legend ? hidden : undefined}` / `calendars={legend}` props to `CalendarMonthGrid` unchanged — instant filtering with no reload/round-trip/tab-loss and `selected`-seeded initial state are behavior-identical (FR-003, SC-003).
- [ ] **Tab order.** Ensure the legend column (interactive toggles) precedes the display-only grid in DOM order so it stays ahead in the tab order (FR-009) — placing the legend column first in the row satisfies this naturally.

### Phase 3 — Verification

- [ ] `npm run typecheck` (node + web) passes — no type drift (expected, since no types change).
- [ ] `npm test` passes — `logic.test.ts` is untouched and stays green (the reposition is JSX/class-only; no pure-logic function changes).
- [ ] Manual / visual check in `npm run dev`: (a) multi-calendar view shows legend left + grid right, side by side (SC-001); (b) a long legend scrolls in its own column while the grid stays put at full height (SC-002); (c) toggling a calendar off in the sidebar removes its chips instantly, no reload, no tab loss (SC-003); (d) single-/zero-calendar view shows NO sidebar, grid full-width (SC-004); (e) `selected`-seeded initial hidden state is unchanged (SC-003); (f) all-hidden/empty month shows the empty note in the GRID region with the sidebar still present (FR-008); (g) at narrow panel widths the 7-col grid stays legible per the design step's max-widths (SC-006); (h) keyboard: toggles are reachable `role="switch"` controls ahead of the grid (FR-009).
- [ ] Confirm agent/MCP-rendered Google Calendar surfaces (the embedded `claude` path) render the SAME left-sidebar layout, since the change is in the catalog root (SC-005) — no contract change to verify on the wire (SC-007).

### Phase 4 — Docs & wrap-up

- [ ] Update this plan's **Deviations & Notes** with anything that differed (esp. final width/scroll classes the design step settled).
- [ ] **Follow-up (NOT in this plan — concurrent edits):** note in wrap-up that `docs/ARCHITECTURE.md`'s Google Calendar / shared-calendars section should record that the legend is now a LEFT SIDEBAR (was a top strip) in the catalog root `EventList`. Do NOT edit `docs/ARCHITECTURE.md` here.
- [ ] Reconcile `TODO.md` via the `wrap-up` skill (check off the legend-reposition item, surface any newly found work).

---

## Deviations & Notes

> Record anything that differed from plan during implementation. Date each entry.

- **2026-06-18**: Plan authored. Open Questions resolved by user before the design step:
  (1) Narrow-width behavior (FR-007) — NO special handling (no collapsible sidebar, no
  wrap-back-to-top); the designer picks sensible max-widths for BOTH the legend sidebar
  list AND the month grid, and the legibility guarantee is met by those max-widths alone.
  (2) Sidebar width — a single designer-chosen fixed/auto width, NOT a user-resizable
  splitter for v1. The spec's FR-007 `[NEEDS CLARIFICATION]` is therefore closed for
  implementation purposes.
- **2026-06-18**: `docs/ARCHITECTURE.md` intentionally NOT edited in this plan cycle
  (concurrent edits in progress on that file). The architecture note (legend = left
  sidebar in the catalog root) is recorded as a Phase 4 follow-up for wrap-up.
