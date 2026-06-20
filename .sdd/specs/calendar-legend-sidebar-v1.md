# Spec: Calendar Legend — Left Sidebar Reposition — v1

**Status**: Draft
**Created**: 2026-06-18
**Supersedes**: — (extends `.sdd/specs/shared-calendars-v1.md`; that spec stays the base contract for the legend's behavior/data — this changes only WHERE the legend sits)
**Related plan**: .sdd/plans/calendar-legend-sidebar-v1.md (to be authored next)

---

## Grounding

> Grounding was performed directly this session with codegraph + agentmemory; the notes in the request were verified against the code, not trusted blindly.

**codegraph_explore** (queries run → one-line takeaways):
- `CalendarLegend CalendarToggle EventList CalendarMonthGrid buildMonthGrid hiddenCalendarIds googleCalendarCatalog components logic` → CONFIRMED: the legend is rendered by the catalog ROOT `EventList` (`src/renderer/googleCalendarCatalog/components.tsx`), NOT the panel. `EventList` wraps `<CalendarLegend>` + `<CalendarMonthGrid>` in a single `flex flex-col gap-2` column, so the legend is a strip ABOVE the grid today. `CalendarLegend` itself is a `flex flex-wrap items-center gap-1.5` of `CalendarToggle` pill buttons (`role="switch"`, color swatch + name). The hidden-set (`hidden: Set<string>`), seed-from-`selected`, `onToggle`, and the `colorTokenFor`/`tokenColorClasses`/`buildMonthGrid` filtering all live in the catalog and are UNCHANGED by a reposition.
- `EventListNode` shape → the surface root carries `events[]`, `timeMin/timeMax`, `hasMore`, and the optional `calendars?: CalendarLegendData[]` legend; each legend entry already ships a surface-RESOLVED `colorToken`, `selected`, `primary`. No data field needs adding to move the legend.

**Read** (verbatim): `src/renderer/googleCalendarCatalog/components.tsx` (`EventList` root layout, `CalendarLegend`, `CalendarToggle`, `CalendarMonthGrid`, `MonthEmptyNote`), `src/renderer/googleCalendarCatalog/logic.ts` (`CalendarLegendData`, `EventChipData`, `colorTokenFor`, `tokenColorName`, `tokenColorClasses`, `seedHiddenCalendarIds`), `src/renderer/GoogleCalendarPanel.tsx` (the panel shell — confirms the panel is one narrow `bg-card` column among up to four side-by-side panels; the legend is NOT in the panel), `.sdd/specs/shared-calendars-v1.md` + `.sdd/designs/shared-calendars-v1.md` (the established legend behavior + the prior decision that the legend is a TOP strip, justified by the narrow panel — this spec revisits that placement per the user's request).

**memory_recall / memory_smart_search** (`shared-calendars legend catalog root parity color token`): hit the stored `shared-calendars-v1` architecture memory — legend lives in the catalog ROOT (not the panel) for FR-016 agent/MCP parity; color mapping is shared via `src/shared/googleCalendarColor.ts`; `hiddenCalendarIds` is renderer-only ephemeral (no `SESSION_SCHEMA_VERSION` bump); legend suppressed for ≤1 calendar. All of this MUST be preserved by the reposition.

---

## Overview

Reposition the Google Calendar shared-calendar legend (the per-calendar color + show/hide
toggle list from `shared-calendars-v1`) from a horizontal strip ABOVE the month grid to a
LEFT SIDEBAR column beside the grid, so a long calendar list is easy to scan and never
pushes the grid down. This is a pure LAYOUT change: it preserves all existing legend
behavior, data, and agent/MCP parity, and adds no new data, scope, or contract.

## User Scenarios

> P1 = must, P2 = should, P3 = nice to have.

### Scan many calendars without losing the grid · P1

**As a** user whose Google account can access many shared/subscribed calendars
**I want** the calendar legend laid out as a LEFT-side column beside the month grid (like Google Calendar web's left "My calendars" rail) instead of a top strip
**So that** when the list grows long it stays easy to scan and does not shove the month grid down or off-screen.

**Acceptance criteria:**
- Given the shared-calendar view with several calendars, when the surface renders, then the legend appears as a column on the LEFT and the month grid fills the remaining width to its RIGHT (the two sit side by side, not stacked).
- Given the legend list is taller than the available height, when it renders, then the legend column scrolls INDEPENDENTLY (its own overflow) and the month grid keeps its position and full height — a long list never pushes the grid down or shrinks it vertically.
- Given I scroll the legend column, when I do, then the month grid does not move with it (and vice versa).

### Keep every legend behavior I already had · P1

**As a** user of the shared-calendar view
**I want** the repositioned legend to behave exactly as before — same colors, same show/hide toggles, same instant filtering
**So that** moving it to the side changes only WHERE it is, not WHAT it does.

**Acceptance criteria:**
- Given the legend is now a sidebar, when I read it, then each entry still shows the calendar's name, its color swatch (matching that calendar's event chips in the grid), and a show/hide control.
- Given I toggle a calendar off in the sidebar, when I do, then that calendar's events disappear from the grid immediately, with no reload, no agent round-trip, and no lost tab — identical to the prior strip behavior.
- Given the view loads, when it does, then the initially-shown/hidden calendars still default from each calendar's Google `selected` preference (all-shown fallback when absent), unchanged from `shared-calendars-v1`.

### Agent-rendered surfaces get the sidebar too · P2

**As a** user who asks the embedded agent about my calendar
**I want** agent-rendered Google Calendar surfaces to show the SAME left-sidebar legend layout as the native panel
**So that** the native panel and the agent path do not diverge.

**Acceptance criteria:**
- Given the embedded `claude` renders a Google Calendar surface that carries the legend data, when it renders, then it shows the legend in the same left-sidebar arrangement as the native default view (because the legend is composed in the catalog root, not the panel), with no data or token change.

### Sidebar degrades gracefully at the edges · P1

**As a** user with 0, 1, or only-just-a-few calendars, or on a narrow panel
**I want** the sidebar to handle those cases cleanly
**So that** the reposition never produces an empty rail, a crushed grid, or a broken layout.

**Acceptance criteria:**
- Given only ONE (primary) calendar, when the view renders, then the sidebar is suppressed entirely and the grid renders full-width exactly as today (the `≤1` suppression from `shared-calendars-v1` FR-014 is preserved).
- Given NO usable calendar legend (the single-primary / no-`calendars[]` path), when the view renders, then there is no empty sidebar — the grid renders full-width.
- Given the calendar panel is narrowed (it is one of up to four side-by-side panels), when horizontal space is constrained, then the layout MUST NOT crush the 7-column grid below legibility — the side-by-side behavior at narrow widths is resolved per the Open Questions (collapsible vs. fixed-minimum vs. wrap-back-to-top) and detailed in the design step.

## Functional Requirements

> "MUST" required, "SHOULD" recommended, "MAY" optional. Layout specifics that are a
> designer's call are deferred to the design step (noted) rather than over-specified here.

| ID     | Requirement |
|--------|-------------|
| FR-001 | The per-calendar legend MUST render as a LEFT-side column placed BEFORE (to the left of) the month grid in the shared-calendar view, replacing today's full-width strip ABOVE the grid. The month grid MUST occupy the remaining horizontal width to the right. |
| FR-002 | When the legend list is taller than the available vertical space, the legend column MUST scroll INDEPENDENTLY (own overflow) and MUST NOT push the month grid down or reduce the grid's height — directly serving the motivating "many calendars are hard to scan" case. |
| FR-003 | The reposition MUST preserve every existing legend behavior from `shared-calendars-v1` unchanged: per-calendar color swatch (the surface-resolved `colorToken`, matching the calendar's event chips), the per-calendar show/hide toggle, the ephemeral renderer-only hidden-set, instant grid filtering with no reload/round-trip/tab-loss, and the initial state seeded from Google `selected`. |
| FR-004 | The legend MUST remain COMPOSED IN THE CATALOG ROOT (the `EventList` surface root), NOT in `GoogleCalendarPanel.tsx`, so that the native default view AND the agent/MCP render path both get the sidebar layout from one implementation (preserving `shared-calendars-v1` FR-016 parity). |
| FR-005 | The single-/zero-calendar suppression MUST be preserved: when there is ≤1 accessible calendar (or no legend data), the sidebar MUST be omitted entirely (no empty rail) and the grid MUST render full-width exactly as today (`shared-calendars-v1` FR-014). |
| FR-006 | The reposition MUST be a PURE LAYOUT change: it MUST NOT add, remove, or alter any cross-process data contract (the `EventList` surface root, `calendars[]`/`CalendarLegendData`, per-event `calendarId`), the IPC/bridge payloads, the MCP read/render path, the surface builder, the OAuth scope, or any token/secret handling. No new data or secret crosses any boundary. |
| FR-007 | At constrained panel widths (the calendar panel is one of up to four side-by-side panels), the sidebar + grid layout MUST degrade so the 7-column month grid stays legible — it MUST NOT crush the grid below readability. The concrete narrow-width behavior (collapsible sidebar, fixed minimum grid width, or wrap-the-legend-back-above-the-grid) is a design-step decision pending the Open Questions; this FR fixes only the legibility guarantee. `[NEEDS CLARIFICATION — see Open Questions: narrow-width behavior]` |
| FR-008 | The empty-grid and partial-failure states MUST be preserved: an all-hidden / empty month still renders the existing calm "Nothing scheduled this month." note in the grid region (NOT the sidebar), and failed-calendar legend entries still appear in the sidebar (they contribute no events), consistent with `shared-calendars-v1` FR-012/FR-015. |
| FR-009 | Legend keyboard/AT behavior MUST be preserved: each toggle stays a focusable `role="switch"` control with `aria-checked`, the legend stays a labeled group, swatches stay decorative (`aria-hidden`), and the legend stays in the tab order ahead of the display-only grid — the reposition MUST NOT regress accessibility. |

## Edge Cases & Constraints

- **Many calendars (the motivating case).** The sidebar scrolls independently; the grid keeps its full height and position (FR-002). The maximum is the existing `shared-calendars-v1` cap (≤25 calendars fetched); the sidebar must scroll cleanly across that range.
- **Exactly one / zero calendars.** Sidebar suppressed; grid full-width (FR-005). No empty rail.
- **Two-or-few calendars.** Sidebar shows; it is short (no scroll needed) and must not look broken or waste excessive horizontal space — exact minimum/auto width is a design-step detail.
- **Narrow panel width (up to four side-by-side panels).** The grid must stay legible (FR-007); the precise degrade (collapse/min-width/wrap-back-to-top) is deferred to the Open Questions + design step.
- **All calendars hidden / empty month.** The existing empty note renders in the GRID region, not the sidebar; the sidebar stays present so calendars can be toggled back on (FR-008).
- **Partial failure (a calendar's read failed).** Failed calendars still get sidebar legend entries; the grid still shows successes; the existing quiet inline note behavior is unchanged (FR-008).
- **Agent/MCP-rendered surface.** Same sidebar layout via the catalog root (FR-004); no contract change (FR-006).
- **Out of scope (this increment):** any change to legend DATA, color mapping, the show/hide semantics, the hidden-set seeding, the MCP/bridge/surface-builder/IPC contract, the OAuth scope, persistence of toggle state, calendar grouping/reordering, a resizable/draggable sidebar splitter, week view, or any write capability. This is layout only.

## Success Criteria

| ID     | Criterion |
|--------|-----------|
| SC-001 | In the shared-calendar view with multiple calendars, the legend renders as a left column with the month grid filling the width to its right (side by side, not stacked). |
| SC-002 | A legend list longer than the available height scrolls within its own column while the month grid stays put at full height — a long list never pushes the grid down. |
| SC-003 | Every legend behavior (color swatch matching chips, show/hide toggle, instant grid filtering with no reload/round-trip/tab-loss, `selected`-seeded initial state) works identically to before the move. |
| SC-004 | A single-/zero-calendar view shows NO sidebar and renders the grid full-width exactly as today. |
| SC-005 | The agent/MCP-rendered Google Calendar surface shows the same left-sidebar layout as the native panel, with no data, scope, or token change. |
| SC-006 | At narrow panel widths the 7-column month grid stays legible (no crush), per the narrow-width behavior settled in the design step. |
| SC-007 | No cross-process contract changed: the surface root, `calendars[]`, `calendarId`, IPC/bridge/MCP payloads, surface builder, and OAuth scope are byte-for-byte unchanged; no token/secret crosses any boundary. |

---

## Design step

This is a UI-bearing, primarily LAYOUT/VISUAL change, so a **design step** (`design` skill,
`designer` agent → `.sdd/designs/calendar-legend-sidebar-v1.md`) follows the plan and will
carry most of the detail: the sidebar's width / min-width, the divider/border treatment, its
independent-scroll affordance, the legend's vertical (rather than wrap) toggle list styling,
the narrow-width degrade (resolving the Open Questions below), and how the two columns share
the catalog root's space. The plan + design must keep the legend in the catalog root and the
data contract untouched (FR-004/FR-006). No `src/renderer/index.css` token additions are
expected (the `--event-*` palette from `shared-calendars-v1` is reused as-is); confirm in
design.

## Open Questions

> These are genuine layout decisions that need user/design input before the design step can
> fix the visual; they are NOT blockers to the spec, but the narrow-width one (FR-007) should
> be resolved before implementation.

- [ ] [NEEDS CLARIFICATION] **Narrow-width behavior (FR-007).** When the calendar panel is squeezed (one of up to four side-by-side panels), should the left sidebar (a) become COLLAPSIBLE — collapse to a thin toggle/handle the user can expand on demand; (b) keep a FIXED minimum width and let the user scroll the panel horizontally / accept a tighter grid down to a legibility floor; or (c) WRAP BACK to the original top strip below a width threshold (responsive fallback to the `shared-calendars-v1` layout)? Recommended default: (c) wrap-back-to-top below a threshold, since it reuses the proven strip layout and never crushes the grid — but this is the user's call.
- [ ] [NEEDS CLARIFICATION] **Fixed vs. user-resizable sidebar width.** Is a single designer-chosen fixed/auto sidebar width sufficient, or does the user want a draggable splitter to resize the sidebar vs. grid? Recommended default: fixed/auto width (no splitter) for v1 — a resizable splitter is a separate, larger increment. Confirm.
