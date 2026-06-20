# Design: Shared / Multi-Calendar View (Google Calendar) — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: .sdd/specs/shared-calendars-v1.md
**Plan**: .sdd/plans/shared-calendars-v1.md (Phase 0 — design gate)
**Extends**: .sdd/designs/google-calendar-v1.md (month grid §1, states §2, color tokens §5 stay the base)
**Owns**: this design spec, `src/renderer/index.css` theme-token additions, `src/renderer/components/ui/*`.

---

## Grounding (queries actually run this session)

**Read (verbatim)**
- `.sdd/specs/shared-calendars-v1.md` — fixed contracts: aggregate ALL accessible calendars (FR-001/004), color BY calendar one-color-per-calendar (FR-006), per-calendar legend with show/hide (FR-008/009), initial state from Google `selected` (FR-010), partial-failure resilience (FR-012), single-primary degrade (FR-014), READ-ONLY (FR-018).
- `.sdd/plans/shared-calendars-v1.md` — resolved deferrals I design within: ≤25 calendars fetched, ordering primary→`selected`→rest; `calendarColorToken(calendar)` runs in the surface builder and ships a RESOLVED token NAME per `calendars[]` entry (palette-hex lookup → stable id-hash → `gray` fallback); toggles are renderer-only, re-derived from `selected` each mount; legend lives in the catalog (NOT the panel) for native+agent parity (FR-016).
- `src/renderer/googleCalendarCatalog/components.tsx` + `logic.ts` — existing `EventList`(root)→`CalendarMonthGrid`→`DayCell`→`EventChip`; `EventChip` colors via `eventColorClasses(event.colorId)` (dot for timed, tinted bar for all-day). I retarget color from per-event `colorId` to per-calendar token and add legend + filtering.
- `src/renderer/GoogleCalendarPanel.tsx` — connection states (not-connected / connecting / reconnect_needed), `MonthGridSkeleton`, `Notice`, error row — ALL UNCHANGED and reused; this increment touches only the catalog body (legend + colored chips), not the panel shell.
- `src/renderer/index.css` — current `--event-*` family is exactly SIX tokens (blue, green, purple, red, amber, gray) each with `*-foreground`, registered in `@theme inline` + valued in `:root` (light) and `.dark` (cosmos). I extend this family below.

**memory_recall**
- `Google Calendar panel event color tokens design legend` → empty (no prior multi-calendar decision); standing preference (Tailwind + shadcn, tokens-first, dark-first, color-is-reinforcement) holds. The palette extension below is recorded as the new standard.

---

## 0. Decision: legend placement

**A horizontal, collapsible legend STRIP docked directly ABOVE the month grid, inside the catalog `EventList` root** (not a left sidebar, not the panel chrome).

Justification for this full-width single surface:

1. **The cosmos panel is a narrow vertical rail, not a sidebar app.** Google Calendar web affords a left "My calendars" column because it has a wide two-pane layout. The cosmos Calendar panel is one `bg-card` column (`border-l`, ~the width of Jira/Confluence). Stealing horizontal space for a permanent left column would crush the 7-column grid below legibility. The legend must stack ABOVE the grid and consume vertical, not horizontal, space.
2. **Lives in the catalog root, not `GoogleCalendarPanel.tsx`.** The plan fixes FR-016 parity: both the native default view AND the agent/MCP render path emit the `EventList` root with `calendars[]`. Putting the legend inside the `EventList` component (driven by `calendars[]`) means the agent path gets the same legend for free; putting it in the panel chrome would diverge the two surfaces.
3. **Collapsible to protect the grid.** The strip shows a compact wrap of calendar chips. For many calendars it can wrap to at most 2 rows then collapse behind a `Show all (N)` disclosure, so the grid is never pushed off-screen.

```
┌──────────────────────────────────────────────┐
│ PanelTabStrip                  [⟳ Refresh]     │  ← unchanged
├──────────────────────────────────────────────┤
│ EventList root (catalog, in the content region)│
│  ┌── CalendarLegend (NEW, strip) ───────────┐  │
│  │ Calendars                 [Hide all]      │  │  ← header row
│  │ ●Work  ●Personal  ○Holidays  ●Team  …     │  │  ← wrap of toggles
│  │                         Show all (12) ▸   │  │  ← overflow disclosure
│  └───────────────────────────────────────────┘  │
│  June 2026                                       │  ← month label (existing)
│  ┌───────────── CalendarMonthGrid ───────────┐  │
│  │ Sun Mon Tue Wed Thu Fri Sat               │  │
│  │ … colored event chips (by calendar) …     │  │
│  └───────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│ PromptComposer · PanelFooter (unchanged)       │
└──────────────────────────────────────────────┘
```

---

## 1. Surface & layout

### 1.1 CalendarLegend (NEW catalog component)

A horizontal strip rendered by `EventList` ABOVE `CalendarMonthGrid`, driven by the `calendars[]` the surface builder ships. Container:
`<div role="group" aria-label="Calendars" className="flex flex-col gap-1.5 pb-2">`.

- **Header row**: `flex items-center justify-between`. Left: `<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Calendars</span>`. Right: a single `Hide all` / `Show all` text toggle (`Button variant="ghost" size="xs"`, `text-[11px] text-muted-foreground`) that flips the whole hidden-set at once — convenient with many calendars.
- **Toggle list**: `flex flex-wrap gap-x-3 gap-y-1`. One `CalendarToggle` per calendar.
- **Suppress when trivial**: when `calendars.length <= 1` (single-primary degrade, FR-014) the entire legend strip is **omitted** — no header, no lone chip — so the single-calendar grid renders exactly as today (acceptance: legend "never empty/broken"). The grid renders unchanged.

### 1.2 CalendarToggle (one legend entry)

Each entry is a real toggle control — a checkbox-semantics button mirroring GCal's colored checkbox:

```
<button type="button" role="checkbox" aria-checked={shown}
  className="group flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[12px]
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
             hover:bg-accent/50">
  <span aria-hidden className={cn(
    'size-3 shrink-0 rounded-[3px] border',
    shown
      ? 'bg-event-{token} border-event-{token}'                 // filled colored swatch when shown
      : 'border-event-{token}/70 bg-transparent'                // hollow outline when hidden
  )}/>
  <span className={cn('max-w-[12ch] truncate',
    shown ? 'text-card-foreground' : 'text-muted-foreground line-through/none')}>
    {name}
  </span>
</button>
```

- **Swatch = the calendar's `colorToken`** (the resolved `--event-*` name from the builder) so swatch and chips always agree (SC-002). `size-3 rounded-[3px]` evokes GCal's checkbox.
- **Shown vs hidden styling**: SHOWN = filled swatch + `text-card-foreground`; HIDDEN = hollow outlined swatch (same hue, transparent fill) + `text-muted-foreground` (dimmed, NOT struck-through — dimming is the cleaner "off" cue and keeps the name readable for re-finding). The hue stays visible even when off so the user can still associate the calendar.
- **Primary marker**: the primary calendar's entry gets a small `(you)` suffix in `text-muted-foreground` OR is simply ordered first (builder orders primary→selected→rest); no separate grouping section needed at this width — ordering carries the priority, the name carries the identity.

### 1.3 Many-calendar overflow (up to 25)

The wrap is clamped to **at most 2 rows** by default. When more entries exist than fit:
- The strip renders the first rows then a trailing `Show all (N) ▸` disclosure (`Button variant="ghost" size="xs"`, lucide `ChevronDown`/`ChevronRight`).
- Expanded, the strip grows to show all 25 in the wrap (it lives in the scrollable content region, so it never clips the viewport — the grid scrolls below it). Collapsing restores the 2-row clamp.
- This keeps the default surface compact while remaining fully reachable. (Implementation note: a simple `expanded` renderer-only boolean + `max-h` clamp; no new primitive needed.)

---

## 2. Color treatment

### 2.1 Chip coloring keyed by calendar

The event chip keeps its EXISTING two visual forms (dot+time for timed, tinted bar for all-day, from `google-calendar-v1` §1.2) — only the **color source changes** from `event.colorId` to the event's owning calendar's token:

- `logic.ts` gains `colorTokenFor(event, calendars) → EventColorName` that looks up `event.calendarId` in the `calendars[]` map and returns that calendar's `colorToken`; absent/unmatched ⇒ `gray` fallback. `eventColorClasses` is then called with the token NAME (not a `colorId`), keeping the single dot/bar class table.
- **Timed chip** → leading solid `bg-event-{token}` dot (unchanged form).
- **All-day chip** → `bg-event-{token}/25 border-l-2 border-event-{token}` tinted bar (unchanged form).
- Treatment stays **dot/bar, not a full-filled chip** — full-fill at 25 hues on the dark card would create a noisy quilt and crush title contrast. The dot/bar keeps the title on `bg-accent/60` with `text-card-foreground` (legible regardless of calendar hue) and uses color purely as reinforcement (consistent with the existing stance + FR: color collisions acceptable, the name disambiguates).

### 2.2 Palette extension — how many tokens

Six hues cannot keep up to 25 calendars distinguishable. I extend the `--event-*` family to **TWELVE** distinct hues plus the existing `gray` fallback (13 total). Twelve is the practical ceiling for hues that stay mutually distinguishable as a tiny dot on `--card #1b1b1c` (beyond ~12, adjacent hues are indistinguishable at chip size anyway); the legend NAME is the authoritative signal, color is reinforcement, and collisions past 12 calendars are explicitly acceptable (spec Edge Cases). The plan's `calendarColorToken` stable-hashes the calendar id modulo the **non-gray** token count (now 12) to spread calendars across the wider palette.

**KEEP (already in `index.css`):** `blue`, `green`, `purple`, `red`, `amber`, `gray`.

**ADD six new `--event-*` tokens** (each with a `*-foreground`), registered in `@theme inline` and valued in `:root` (light tint) + `.dark` (muted, legible on `--card #1b1b1c`, harmonizing with `--primary #4a9eff`). Names + intended hue role:

| New token | Hue role | Suggested `.dark` value | Suggested `*-foreground` (dark) | Suggested `:root` (light) | `*-foreground` (light) |
|---|---|---|---|---|---|
| `--event-teal`    | cyan-green, distinct from blue+green | `#3f8f8a` | `#cdeeea` | `#c2eae6` | `#1d6660` |
| `--event-cyan`    | bright sky, distinct from blue | `#3a86a8` | `#cfeaf5` | `#c2e6f2` | `#1d5a72` |
| `--event-indigo`  | deep blue-violet, between blue+purple | `#5a64ad` | `#d6d9f7` | `#cdd2f2` | `#2f3a82` |
| `--event-magenta` | pink-purple, distinct from red+purple | `#a8579e` | `#ffd6f5` | `#f2c2e8` | `#7a2f70` |
| `--event-pink`    | warm rose, distinct from red+magenta | `#b85c78` | `#ffd6e2` | `#f2c2cf` | `#8a2f49` |
| `--event-olive`   | muted yellow-green, distinct from green+amber | `#8a8a3f` | `#eeeec2` | `#e6e6b8` | `#5a5a1d` |

> The hex values above are SUGGESTED; the developer/main session applies + tunes the actual values in `index.css` (designer has no Bash). Each must clear AA-ish contrast for its `*-foreground` text on the muted token background and stay mutually distinguishable as a `size-1.5` dot. Light `:root` values mirror as lighter tints with dark foregrounds, exactly as the existing six do.

**Final non-gray palette order** (the hash maps onto this, 12 entries): `blue, green, purple, red, amber, teal, cyan, indigo, magenta, pink, olive` + one slot — note that's 11; round the set to 12 by including one additional hue if desired, OR keep the GCal palette-hex lookup mapping the well-known Google colors to the original six and let the id-hash spread the rest across all 12. Either way the dot/bar class table (`COLOR_CLASSES`) gains an entry per new token name.

### 2.3 Contrast & a11y of color

- Color is never the sole signal: every event chip carries its title text; every legend entry carries its name. A user who can't distinguish two hues still reads the name and the chip title.
- Swatch/dot contrast: the swatch is a 12px square with a border, so even a low-saturation hue is bounded by `--border`-adjacent edges; the dot is 6px solid token on `bg-accent/60`. Legible without relying on hue discrimination.
- Hidden-swatch is the SAME hue at outline (not removed) so toggling never loses the color association.

---

## 3. States (each explicit)

Connection states (not-connected / connecting / reconnect_needed) and the per-tab `MonthGridSkeleton`, error row, and `Notice` are **REUSED VERBATIM** from `GoogleCalendarPanel.tsx` / `google-calendar-v1` design §2 — this increment adds NO new connection chrome. New/changed states below:

| State | Trigger | Treatment |
|---|---|---|
| **all-shown (default)** | every calendar's `selected !== false` ⇒ empty hidden-set | Full legend strip (all swatches filled), grid shows every accessible calendar's events colored by calendar. The default. |
| **some hidden** | user toggles ≥1 off, OR some calendars arrive `selected:false` (FR-010) | Toggled-off entries render hollow + dimmed; their events vanish from the grid **instantly** (renderer-only filter in `buildMonthGrid` via a `hiddenCalendarIds` set — no reload, no tab loss, FR-009). Grid otherwise unchanged; `+N more` overflow recomputes against the remaining chips. |
| **all hidden (empty grid)** | every calendar toggled off / `selected:false` | Grid renders the EXISTING `MonthEmptyNote` ("Nothing scheduled this month.") — same calm empty treatment as a genuinely empty month (FR-015). Legend stays fully present so the user can toggle calendars back on. NOT an error. |
| **single-calendar degrade** | `calendars.length <= 1` (only primary, FR-014) | Legend strip OMITTED entirely (§1.1); grid renders exactly as today, single calendar's events. |
| **loading** | active tab `loadingDefault` | EXISTING `MonthGridSkeleton`. Add ONE skeleton line above it standing in for the legend strip: a row of 4–5 `Skeleton` pill stand-ins (`h-4 w-16 rounded-sm`) so the layout doesn't jump when the legend lands. `aria-busy` on the wrapper. |
| **partial-failure** | some calendars failed, others succeeded (FR-012) | The grid shows the successful calendars' events normally (NO whole-grid error). A **quiet inline note** above the grid (NOT the destructive `Notice`): `<p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><TriangleAlert className="size-3"/> Some calendars couldn't load.</p>` — informational, muted, non-blocking. Failed calendars' legend entries are still listed (the builder ships them; they simply contribute no events). This degrades softly per FR-012's "render successes, optionally note." |
| **all-failed / connection failed** | every calendar read failed, or account/connection failed | EXISTING recoverable error path: the destructive `Notice` root / reconnect_needed → native Connect affordance, UNCHANGED. |

---

## 4. Interaction & accessibility

- **Legend toggle keyboard path**: each `CalendarToggle` is `role="checkbox"` `aria-checked`, focusable, toggled by `Space`/`Enter` (native button), focus ring `ring-ring` (the shared `--ring`). They sit in the tab order ABOVE the grid (grid is display-only, stays out of tab order per `google-calendar-v1` §6). `Hide all`/`Show all` and `Show all (N)` disclosure are standard `Button`s, keyboard-complete.
- **Announce the toggle**: `aria-checked` flips on toggle so AT announces "Work, checkbox, checked → not checked." The legend container is `role="group" aria-label="Calendars"`. No `aria-live` needed — the count change is conveyed by the grid's existing per-cell `aria-label` recomputation.
- **Swatch is `aria-hidden`** (decorative); the calendar NAME carries identity for AT, never color alone.
- **Grid chips remain `aria-hidden`** (their content is in the `DayCell` `aria-label`, unchanged); per-calendar color adds no new AT surface there.
- **Contrast**: legend names use `text-card-foreground` (shown, ~12:1 on `--card`) / `text-muted-foreground` (hidden, ~4.6:1 — AA for the supplementary dimmed state). Swatch borders bound low-contrast hues.
- **Reduced motion**: no new motion introduced (toggles are instant show/hide, the disclosure is a layout change, not an animation). The only motion remains the shared reduced-motion-gated `SurfaceSpinner`.

---

## 5. Catalog component inventory (developer builds these)

`src/renderer/googleCalendarCatalog/{components.tsx, logic.ts, logic.test.ts, index.ts}` — additive to the existing catalog. `CATALOG_ID` unchanged (`google-calendar`).

| Component (type name) | Kind | Props (from surface node) | Built from |
|---|---|---|---|
| `EventList` (root, CHANGED) | display container | EXISTING `events[]`, `timeMin/timeMax`, `hasMore` **+ NEW** `calendars?: CalendarLegendNode[]` | renders `CalendarLegend` (when `calendars.length>1`) above the existing `CalendarMonthGrid`; passes `calendars` + renderer-only `hiddenCalendarIds` into `buildMonthGrid` |
| `CalendarLegend` (NEW, internal) | display | `calendars: CalendarLegendNode[]`, `hidden: Set<string>`, `onToggle(id)`, `onToggleAll()` | header + wrapping `CalendarToggle[]` + overflow disclosure (§1.1/1.3) |
| `CalendarToggle` (NEW, internal) | control | `name`, `colorToken`, `shown`, `primary?`, `onToggle` | `role="checkbox"` swatch + name (§1.2) |
| `EventChip` (CHANGED) | display | EXISTING + chip now colored via `colorTokenFor(event, calendars)` instead of `event.colorId` | dot/bar forms unchanged; color source swapped |

`logic.ts` NEW/CHANGED pure helpers (node-testable): `calendarColorToken(calendar)` (the plan's deterministic mapping — palette-hex lookup → id-hash mod 12 → `gray`), `colorTokenFor(event, calendars)` (event → owning-calendar token, `gray` fallback), `buildMonthGrid(events, timeMin, now, weekStart, calendars?, hiddenCalendarIds?)` extended to FILTER events whose `calendarId ∈ hiddenCalendarIds`. `eventColorClasses` is RETAINED but now keyed by token NAME (gains entries for the 6 new tokens).

Renderer-only state (in `EventList` or a small hook): `hiddenCalendarIds: Set<string>` seeded each mount from `calendars` where `selected === false` (FR-010/FR-011). Lives inside the catalog root so the agent path gets it too (FR-016). NOT persisted (re-derived each mount, per plan).

**No new shadcn primitive required** — `CalendarLegend`/`CalendarToggle` are plain token-styled `button`/`div`s + the existing `Button` (`variant="ghost" size="xs"`) + lucide `ChevronDown`/`ChevronRight`/`TriangleAlert`. The only design-system addition is the six new `--event-*` tokens (§2.2).

---

## 6. Build wiring the developer/main session must run (designer has no Bash)

- **Token edit** (designer-owned, authored into `src/renderer/index.css`): add the SIX new `--event-*` token pairs to `@theme inline`, `:root` (light tints), and `.dark` (cosmos muted values) per §2.2. Pure CSS token addition — no install, no codegen, no shadcn CLI.
- **No `shadcn add`** — legend is composed from existing primitives.
- **No `SESSION_SCHEMA_VERSION` bump for design reasons** — `calendars[]` + per-event `calendarId` are additive optional surface fields (plan's decision); toggle state is ephemeral. Confirm during implementation (not a design concern).

---

## 7. Open questions

1. **12th hue slot.** §2.2 lists 11 named non-gray hues after the addition (blue, green, purple, red, amber, teal, cyan, indigo, magenta, pink, olive). If a clean 12-way hash split is wanted, add ONE more hue (suggest `--event-brown` `#8a6a4a` or a second blue-shade) so the modulus is 12; OR keep 11 and hash mod 11. Either is fine — color is reinforcement, the name is authoritative. Defaulting to: developer picks 11 or 12 when wiring the hash; mapping CONTRACT (deterministic, bounded, gray fallback) is fixed by the plan regardless.
2. **Partial-failure note copy/placement.** §3 puts a quiet muted note above the grid. If product later wants which-calendars-failed detail, that's a v1.1 enhancement (would need the builder to ship a failed-calendar list); v1 keeps the single muted line per FR-012's "optionally noting it."
3. **Legend default-collapsed threshold.** §1.3 clamps to 2 wrap rows. The exact row/char threshold is a tuning detail for implementation; the CONTRACT is "compact by default, all 25 reachable via Show all, never clips the grid."
