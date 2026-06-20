# Design: Google Calendar Integration — v1

**Status**: Draft
**Created**: 2026-06-16
**Spec**: .sdd/specs/google-calendar-v1.md
**Plan**: .sdd/plans/google-calendar-v1.md (Phase D — design gate)
**Owns**: `.sdd/designs/google-calendar-v1.md`, `src/renderer/components/ui/*` + theme token additions only.

---

## Grounding (queries actually run this session)

**codegraph_explore**
- `JiraPanel ConfluencePanel SlackPanel default view connect disconnect refresh loading empty error states A2UIProvider useGenerativePanelTabs PanelTabStrip` → returned verbatim source of the three panels' managers + `useGenerativePanelTabs`. Takeaway: every panel is the SAME shell — `PanelTabStrip` topmost (with `PanelRefreshButton` in `trailing`), an optional connection-only chrome row, a scrollable content region hosting `<A2UIProvider catalog={…}><ActiveTabSurface/></A2UIProvider>` keyed by tab id, a `PromptComposer`, then a `PanelFooter` with `ConnectionStatus` on the right. Default view is an unsolicited `ui:render` frame for the panel's `target`, requested via `requestDefaultInActiveTab(() => window.cosmos.<x>.requestDefaultView())` when `active && connected && tab empty`.

**Read (verbatim)**
- `src/renderer/JiraPanel.tsx` — the closest template (deterministic main-composed default view, `requestDefaultInActiveTab`, `DefaultViewSkeleton`, not-connected `ConnectForm`/`ConnectionStatus`, `SurfaceSpinner` gate, `PanelFooter`). Google Calendar mirrors this minus the JQL search box, detail nav, and write controls (v1 is read-only).
- `src/renderer/jiraCatalog/components.tsx` + `index.ts` + `logic.ts` — catalog shape: thin React shells over pure `logic.ts`, mapped by type-name string in `index.ts`, registered on the panel's own `A2UIProvider`; uses `Card`, `Badge`, `cn`, lucide icons, `--status-*` tokens.
- `src/renderer/index.css` — full token set (`--background #1e1e1e`, `--foreground #e0e0e0`, `--card #1b1b1c`, `--popover #252526`, `--primary #4a9eff`, `--secondary #3a3a3c`, `--muted #252526`, `--muted-foreground #888`, `--accent #2d2d30`, `--border #333`, `--ring`, `--destructive`, `--status-*`, `--brand-*`). Tokens are the only source of color; the `@theme inline` block is where any new token is registered, with `:root` (light fallback) + `.dark` (cosmos) value pairs.
- `src/renderer/App.tsx` — `RAIL_ITEMS` (lucide `Sparkles`, `react-icons/si` brand logos, `simple-icons` Claude mark), `SurfaceId` union, force-mounted `TabsContent`, `useConnectedStatus`.
- `src/renderer/components/ui/badge.tsx` — `Badge` variants `default | secondary | destructive | outline | ghost | link`.

**memory_recall**
- `design system tokens shadcn panel conventions cosmos` → empty (no conflicting prior Google decision); confirms the standing preference (Tailwind + shadcn, tokens-first, dark-first). No new standard introduced here beyond one event-chip token family (recorded below).

---

## 0. Decision: month vs week (resolves Spec OQ1)

**v1 default = MONTH grid of the current month.** Justification:

1. **Matches the panel idiom, not a scheduling app.** cosmos panels are a narrow (~`bg-card` over `border-l`) rail surface composed deterministically in main — a single bounded read painted as a static surface (Jira default board, Confluence feed). A **month grid is read-only, scannable, and fits a narrow column** (7 lean columns × ~5 rows of compact day cells with event chips). A **week/day timeline** needs an hour gutter, vertical time-proportional event blocks, current-time line, and overlap-packing — an interactive heavy calendar that fights the narrow rail and exceeds a deterministic default surface.
2. **Bounded, deterministic read.** The surface builder takes an explicit `{ timeMin, timeMax }` window (plan OQ1). Month = `[firstOfMonth 00:00 local, firstOfNextMonth 00:00 local)` — one `events.list` page, one composed surface, no scroll virtualization.
3. **Overview-first user intent.** FR-012 / SC-002 ask for a "Google-Calendar-web-like **overview**." The month grid answers "what's my month look like" at a glance; per-day depth is satisfied by the `+N more` overflow + the event chip's own detail (title/time), without a second view.

Week view is explicitly a **later enhancement** (a future view-switch segmented control); v1 ships month-only. The builder's `{ timeMin, timeMax }` parameter means adding week later is a window + layout change, not a contract change.

---

## 1. Surface & layout

The Google Calendar panel is the **same shell** as Jira/Confluence/Slack (so it reads as one product). Structure, top → bottom:

```
┌──────────────────────────────────────────────┐
│ PanelTabStrip            [⟳ PanelRefreshButton]│  ← topmost, identical to other panels
├──────────────────────────────────────────────┤
│  MonthHeader: "June 2026"      (today: Jun 16)│  ← connection-only chrome row (hidden when
│                                                │     not-connected / spinner up)
├──────────────────────────────────────────────┤
│  CONTENT REGION (scrollable, p-3)             │
│   • not-connected → Connect CTA                │
│   • loading       → MonthGridSkeleton          │
│   • connected     → CalendarMonthGrid surface  │
│      (A2UIProvider catalog={googleCalendarCatalog})│
├──────────────────────────────────────────────┤
│  PromptComposer "Ask about your calendar…"     │  ← connected only
├──────────────────────────────────────────────┤
│  PanelFooter  [📅 Google Calendar · tab]  [acct ▸ Disconnect] │
└──────────────────────────────────────────────┘
```

- **Outer container**: `<section className="flex h-full min-w-0 flex-col border-l border-border bg-card" aria-label="Google Calendar">` — byte-identical to `JiraPanel`'s root.
- **No native search box** and **no detail/back nav** (v1 read-only, primary calendar only). The connection-only chrome row carries only the **MonthHeader** (month label + a today indicator), NOT a search input.
- **Composer**: keep it (parity, and FR-014's agent path can compose richer surfaces). Placeholder `Ask about your calendar…`, aria `Ask about your Google Calendar`.

### 1.1 CalendarMonthGrid (the default view surface)

A 7-column month grid. The default surface JSON emitted by `googleCalendarSurfaceBuilder` is a single `CalendarMonthGrid` node carrying the month window + the day cells + each cell's events (the builder pre-buckets events into day cells in main; the catalog component does pure layout — no date math beyond what `logic.ts` formats).

Layout (Tailwind, all tokens):

- **Weekday header row**: 7 cells, `grid grid-cols-7`, each `text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-center py-1`, labels `Sun…Sat` (or `Mon…Sun` — builder supplies `weekStart`; default Sunday, matching GCal US default). Bottom hairline `border-b border-border`.
- **Day grid**: `grid grid-cols-7 auto-rows-fr` (or fixed `min-h` rows for a narrow column), `divide-x divide-y divide-border` so cells are separated by 1px `--border` hairlines (the VS-Code grid look). Each cell:
  - `DayCell`: `flex min-h-[64px] flex-col gap-0.5 p-1 text-left`.
  - **Date number** top row: `<span className="text-[11px] leading-none">`. In-month days `text-foreground`; **leading/trailing spillover days** (prev/next month padding) `text-muted-foreground/60` and cell `bg-muted/30` to recede. **Today** → the number sits in a filled chip: `inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold` (the GCal "today is a colored circle" idiom, using `--primary`).
  - **Events**: up to **N=3** `EventChip`s stacked `gap-0.5`; if more, a final **overflow** row `+{n} more` as `text-[10px] text-muted-foreground` (non-interactive in v1 — it's an indication, not a popover; clarified in Open Questions).
- **Empty period** (connected, zero events all month): the grid still renders (FR-017 / SC-008 — never an error), with a single centered unobtrusive `MonthEmptyNote` overlaid/below: `<p className="text-sm text-muted-foreground">No events this month.</p>` plus a small lucide `CalendarDays` glyph, matching Jira's "No issues found." empty treatment. The grid skeleton of day cells still shows (so it reads as a real, empty calendar, not a broken panel).

### 1.2 EventChip

One event = one chip inside a day cell.

- **Timed event**: `<div className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] leading-tight">` with a **2px leading color rail** (`<span className="size-1.5 shrink-0 rounded-full">` dot, color from the event-color token map §5) + time + title: `09:30 Standup`, title `truncate`. Background `bg-accent/60`, text `text-card-foreground`. Time prefix `text-muted-foreground tabular-nums`.
- **All-day / multi-day event**: a **filled bar** rather than a dot+time: `rounded-sm px-1 py-0.5 text-[10px]` with the event color as a **tinted background** (the color token at low alpha, see §5) + a left accent border `border-l-2`. No time prefix; title `truncate`. This visual distinction (filled bar vs dot+time) satisfies FR-016 / SC-008 "all-day vs timed are visually distinguished."
- All chips are **display-only in v1** (no click target / no detail). They get `title={fullTitle}` (native tooltip) for the truncated text, and the cell's full event list is exposed to AT via `aria-label` on the DayCell (§6).

---

## 2. States (FR-017 — all six, each explicit)

Reuse the EXACT treatments the other panels use so states read identically across the product.

| State | Trigger | Treatment |
|-------|---------|-----------|
| **not-connected** | `status.state === 'not_connected'` | Content region shows the centered Connect CTA: lucide `CalendarDays` `size-8 text-muted-foreground`, copy `Connect your Google account to see your calendar in cosmos.`, then `<ConnectForm provider="Google Calendar" …>` (the SAME shared component Jira/Confluence/Slack use — gives the Connect button + inline `lastError`). MonthHeader + composer hidden. Footer shows disconnected `ConnectionStatus`. |
| **connecting** | `status.state === 'connecting'` | Same centered region, but the `ConnectForm` is hidden (matches Jira `status.state !== 'connecting'` guard); show `<SurfaceSpinner/>`-style spinner is NOT used here — instead the shared connecting affordance (button busy spinner inside `ConnectForm` while `busy`). Copy stays. This is the OAuth-in-flight window. |
| **loading** (default-view read in flight) | active tab `loadingDefault === true` | **MonthGridSkeleton** (§2.1) in the content region, `aria-busy`. MonthHeader still shows the target month label (builder window is known) so the chrome doesn't jump. |
| **empty** (connected, no events) | composed surface with zero events | The full month grid renders with the `MonthEmptyNote` (§1.1). NOT an error, NOT a blank panel. |
| **error** (recoverable read/render failure) | active tab `error` set | The `Alert variant="destructive"` notice row at the top of the content region (verbatim Jira treatment: `rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive`, `role="alert"`): `Could not load your calendar: {error}`. If a prior grid exists it stays beneath (data-preserving); otherwise the notice stands alone with a retry via the `PanelRefreshButton`. |
| **reconnect-needed** (token refresh failed) | `status.state === 'reconnect_needed'` | Routed to the **same not-connected content region** as Jira (`!isConnected` covers both `not_connected` and `reconnect_needed`): `ConnectForm` with `reconnect` prop → button reads "Reconnect", copy `Your Google session expired. Reconnect to keep seeing your calendar.` The tab strip + footer stay put. |
| **token-refreshing** (silent proactive refresh) | transient, in main | NO distinct renderer state. A proactive refresh is invisible (the read just succeeds). If it fails it surfaces as `reconnect_needed` above. This matches Jira/Confluence — refresh is a main-process concern; the renderer only sees success or `reconnect_needed`. (Documented so the developer does not invent a spinner for it.) |

### 2.1 MonthGridSkeleton

Mirror `JiraPanel.DefaultViewSkeleton` (shadcn `Skeleton`, `aria-busy`), but shaped as a month grid: the weekday header as 7 `Skeleton h-3 w-8` cells, then `grid grid-cols-7` of ~35 day cells each `min-h-[64px] border border-border p-1` containing a `Skeleton h-3 w-4` (date) + one or two `Skeleton h-3 w-full rounded-sm` event-chip stand-ins on a few random cells. Uses only `Skeleton` + `--border`. No spinner (skeleton conveys load; the `SurfaceSpinner` is reserved for the **compose** send-spinner from the PromptComposer, exactly as in Jira).

---

## 3. Catalog component inventory (developer builds these)

`src/renderer/googleCalendarCatalog/{components.tsx, logic.ts, logic.test.ts, index.ts}` — same structure as `jiraCatalog/`. Thin React shells over pure `logic.ts`; registered by type-name string in `index.ts`; `CATALOG_ID = 'google-calendar'`. The surface builder emits these type names.

| Component (type name) | Kind | Props (from surface node) | Built from |
|---|---|---|---|
| `CalendarMonthGrid` | display container | `monthLabel: string`, `weekStart?: 'sunday'\|'monday'`, `weekdayLabels: string[]` (7), `cells: DayCellNode[]` (length 28–42), `todayKey?: string` (ISO `YYYY-MM-DD`), `empty?: boolean` | `Card`-less `div` grid; renders weekday header + `DayCell[]`; shows `MonthEmptyNote` when `empty` |
| `DayCell` | display | `dateKey: string`, `dateLabel: string` (e.g. `16`), `inMonth: boolean`, `isToday: boolean`, `events: EventChipNode[]`, `overflowCount?: number` | flex column; date chip (today→`--primary`); maps `events` to `EventChip` capped at 3 + `+N more` |
| `EventChip` | display | `title: string`, `timeLabel?: string` (omitted ⇒ all-day), `allDay: boolean`, `colorId?: string` (GCal colorId), `spanStart?: boolean`, `spanEnd?: boolean` (multi-day continuation flags) | timed=dot+time+title; all-day=tinted bar; color via `eventColorClasses(colorId)` from `logic.ts` |
| `MonthEmptyNote` | display | (none) | centered lucide `CalendarDays` + `No events this month.` muted text |
| `Notice` | display | `noticeKind?: 'error'`, `message?: string` | REUSE the Jira `Notice` shape (shared/agent-pushed recoverable notice) — `Alert variant="destructive"` |

Plus the generic passthroughs the builder may need for layout roots (same as Jira): register `Column` and `Row` from `standardCatalog.components` so an agent-emitted layout root never white-screens. `functions: {}`.

**Design-system primitives used** (all already exist in `src/renderer/components/ui/`): `Skeleton` (loading), `Alert`/`AlertDescription` (error/empty notice), `Badge` (none required by month grid, but available), `cn`, lucide `CalendarDays`. **No new shadcn primitive is required** — the month grid is plain `div`/`grid` layout over tokens. The only system addition is one **event-color token family** (§5).

`logic.ts` pure helpers (node-testable, mirrors `jiraCatalog/logic.ts`): `eventColorClasses(colorId?) → { dot: string; bar: string }` (token class strings, never raw hex), `cellEventDisplay(events, max=3) → { shown, overflowCount }`, `isAllDay(event)`, `dayCellAriaLabel(cell)`.

---

## 4. Typography & spacing (all from the existing scale)

- **Month label** (MonthHeader): `text-sm font-medium text-foreground`. Today indicator beside it: `text-xs text-muted-foreground`.
- **Weekday header**: `text-[10px] font-medium uppercase tracking-wide text-muted-foreground`.
- **Date numbers**: `text-[11px]`; in-month `text-foreground`, spillover `text-muted-foreground/60`, today `text-primary-foreground` on the `--primary` chip.
- **Event chip**: `text-[10px] leading-tight`; time prefix `text-muted-foreground tabular-nums`; title `text-card-foreground truncate`.
- **Overflow / empty**: `text-[10px]` / `text-sm text-muted-foreground`.
- **Spacing**: panel content `p-3` (panel parity); cell `p-1`, intra-cell `gap-0.5`; grid hairlines via `divide-border` (1px). Radius: chips `rounded-sm` (`--radius-sm`), today circle `rounded-full`, cards (if any) `rounded-xl` (panel parity).

These match the compact density of the Jira `TicketCard` / Confluence feed so the calendar doesn't feel like a different app.

---

## 5. Event color mapping (GCal colorId → token) — the one system addition

Google Calendar events carry a `colorId` (1–11, Google's named palette: Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato) plus a default (the calendar's own color) when unset. We must NOT inline Google's raw hex on the surface. Instead we add a **bounded, dark-tuned event-color token family** and map colorId → token in `logic.ts`.

**Add to `src/renderer/index.css`** an `--event-*` token set (registered in `@theme inline`, valued in `:root` + `.dark`). To keep the system small and on-palette, collapse Google's 11 hues into a **6-token cosmos-tuned accent set** (the rail can't legibly distinguish 11 near-hues at chip size anyway), each with a `*-fg` foreground and the dot/bar both derivable:

```
--event-blue / --event-blue-foreground      (default + Peacock/Blueberry)
--event-green / --event-green-foreground     (Sage/Basil)
--event-purple / --event-purple-foreground   (Lavender/Grape)
--event-red / --event-red-foreground         (Flamingo/Tomato)
--event-amber / --event-amber-foreground     (Banana/Tangerine)
--event-gray / --event-gray-foreground       (Graphite + unknown fallback)
```

`.dark` values must be muted, legible on `--card #1b1b1c`, and harmonize with `--primary #4a9eff` (suggested, developer may tune): blue `#3b6ea5`/`#cfe2ff`, green `#3f7d57`/`#cdeed8`, purple `#6f5a9e`/`#e3d8ff`, red `#a85757`/`#ffd6d6`, amber `#a8843f`/`#ffe9c2`, gray `#4a4a4c`/`#dddddd`. `:root` (light fallback) mirrors with lighter tints. **The dot** uses the solid token (`bg-[--event-x]`); **the all-day bar** uses the token at low alpha (`bg-[--event-x]/25` + `border-l-2 border-[--event-x]`) with `text-card-foreground`. This is exactly the pattern the `--status-*` Jira chip tokens established (design precedent: bounded semantic token family, color is reinforcement, the title text always carries the meaning).

`eventColorClasses(colorId)` in `logic.ts` is the single mapping table (Google colorId number → token name), fully node-testable, so the surface builder and catalog never drift and no raw hex ever reaches a component.

> **Persist as a standard**: this `--event-*` family becomes the canonical way any future calendar/event surface colors events. Recorded to memory.

---

## 6. Accessibility

- **Connect / Reconnect**: handled by the shared `ConnectForm` (Radix-backed Button, focus ring `--ring`, `lastError` rendered inline and associated). Same keyboard path as the other panels.
- **Grid semantics**: the `CalendarMonthGrid` root carries `role="grid"` + `aria-label="June 2026 calendar"`; the weekday header row `role="row"` with `role="columnheader"` cells; each week `role="row"`; each `DayCell` `role="gridcell"`. The cell's `aria-label` is composed by `dayCellAriaLabel` = `"Monday June 16, today, 3 events: Standup 9:30am, Lunch all day, …"` so a screen-reader user hears the full day without seeing truncated chips. Event chips themselves are `aria-hidden` (their content is in the cell label) to avoid double reading.
- **Keyboard**: v1 grid is **display-only** (no per-cell focus/navigation, no clickable chips), so it stays out of the tab order except the scroll container; the panel's focusable controls are the tab strip, `PanelRefreshButton`, `PromptComposer`, and footer disconnect — all already keyboard-complete. (Arrow-key cell navigation is a week/interactive enhancement, not v1.)
- **Today indicator**: never color-only — the today cell's `aria-label` includes `", today,"` and the visual is a filled `--primary` circle with `--primary-foreground` text (contrast pair already validated for buttons).
- **Contrast on `--card #1b1b1c`**: `--foreground #e0e0e0` (≈12:1) for dates; `--muted-foreground #888` (≈4.6:1) for weekday/time labels meets AA for the small text it carries (labels are supplementary; the title text uses `--card-foreground`). Event-token foregrounds (§5) are the light tints, chosen against the muted token backgrounds (not raw hue), keeping chip text legible.
- **Reduced motion / spinner**: the only motion is the shared `SurfaceSpinner`/`CosmosSpinner` (compose), already reduced-motion-gated in `index.css`. The skeleton is static.
- **`aria-live`**: the loading→loaded transition mirrors Jira (the skeleton's `aria-busy`); an event-count summary can be exposed via the grid's `aria-label` update.

---

## 7. Rail icon (App.tsx wiring)

Use **lucide `CalendarDays`** for the rail. Rationale: there is **no Google-Calendar brand glyph in `react-icons/si`** that matches the others' monochrome-currentColor contract cleanly, and the panel is "Google Calendar" the *capability* (like Generated UI → lucide `Sparkles`). `CalendarDays` is already imported in the panel's empty/connect states, so the rail and the panel share one mark — coherent. It satisfies the `RailIcon = React.ComponentType<{ className?: string }>` contract (lucide accepts `className`, inherits `currentColor`), so the active/idle cascade is identical to the other rail items.

```tsx
// src/renderer/App.tsx
import { CalendarDays, Settings, Sparkles } from 'lucide-react'
// …
const RAIL_ITEMS: { id: SurfaceId; label: string; Icon: RailIcon }[] = [
  { id: 'terminal', label: 'Terminal', Icon: ClaudeCodeIcon },
  { id: 'generated-ui', label: 'Generated UI', Icon: Sparkles },
  { id: 'slack', label: 'Slack', Icon: SiSlack },
  { id: 'jira', label: 'Jira', Icon: SiJira },
  { id: 'confluence', label: 'Confluence', Icon: SiConfluence },
  { id: 'google-calendar', label: 'Google Calendar', Icon: CalendarDays } // append last
]
```

Append **last** so existing rail order/shortcut indices are stable. `SurfaceId` gains `'google-calendar'`; add a force-mounted `TabsContent value="google-calendar"` rendering `<GoogleCalendarPanel active={surface === 'google-calendar'} />`; extend `useConnectedStatus` with a `googleCalendar` key.

---

## 8. Build wiring the developer/main session must run (designer has no Bash)

- **No new shadcn component install needed** — the grid is composed from existing primitives (`Skeleton`, `Alert`, `cn`) + plain token-styled `div`s. Do NOT run `shadcn add` for this feature.
- **One token edit** (designer-owned, will be authored directly into `src/renderer/index.css` — see §5): add the `--event-*` family to `@theme inline`, `:root`, and `.dark`. This is a pure CSS token addition (no install, no codegen). The developer/main session needs no shadcn CLI run for it.
- Standard panel wiring (rail entry, preload restart, rollup MCP input) is the developer's Track-B job per the plan — not a design concern.

---

## 9. Open questions

1. **`+N more` overflow interactivity.** v1 ships it as a **non-interactive indication** (matches the deterministic, display-only default surface and avoids a popover primitive). If product wants a click-to-expand day popover, that needs a `Popover` shadcn primitive (not yet in `components/ui/`) and a per-cell focusable target — flag as a v1.1 enhancement, not a v1 blocker. Defaulting to non-interactive.
2. **Week start (Sun vs Mon).** Defaulting to **Sunday** (GCal US default). The builder emits `weekStart` + `weekdayLabels` so this is a one-line config, not a layout rewrite. Confirm against the user's locale during implementation; if the primary-calendar resource exposes a preference, use it.
3. **Multi-day event rendering.** v1 renders a multi-day event as a chip in **each day it spans** (with `spanStart`/`spanEnd` flags trimming the chip's rounded corners so it reads as continuous), NOT as a true row-spanning ribbon (which needs grid-column-span math in the builder). The continuous-ribbon look is a v1.1 polish; the per-day chip is correct and unambiguous for v1.
