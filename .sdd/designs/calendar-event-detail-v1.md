# Design: Google Calendar — Event Detail Dock — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/calendar-event-detail-v1.md
**Plan**: .sdd/plans/calendar-event-detail-v1.md
**Owner**: designer

> Sits between Plan (Step 2) and Interface (Step 3). The plan fixed the *mechanism* (renderer-local
> `CALENDAR_OPEN_DETAIL_ACTION` → `ActiveTabSurface.onAction` → per-tab `genUiEvent` state → a native
> `EventDetail` dock) and the *container shell* (the Slack `@container/slackbody` two-pane reused as
> `@container/calbody`). This spec fixes the *visual contract*: dock anatomy, every field's treatment,
> every state, the now-interactive chip, and the breakpoint behavior — entirely in existing tokens and
> `components/ui/` primitives, dark-only.

---

## Grounding

> Direct investigation run for this design (mandatory). Queries actually executed:

**codegraph_explore / codegraph_search:**

- `SlackPanel slackbody SlackThreadPanel openThread thread dock scrim onClose header body` — returned
  the verbatim Slack dock. **Takeaway:** the dock shell to copy is the `<div className="absolute
  inset-y-0 right-0 z-20 w-full max-w-[22rem] … @[32rem]/slackbody:relative
  @[32rem]/slackbody:w-[clamp(18rem,42%,28rem)] @[32rem]/slackbody:shrink-0 …">` over a
  `bg-black/40 … @[32rem]/slackbody:hidden` scrim; `SlackThreadPanel` itself is
  `flex h-full min-w-0 flex-col bg-card` with a header `flex items-center gap-2 border-b border-border
  px-2 py-1.5` carrying an icon + `flex-1 truncate text-sm font-medium text-foreground` title +
  `Button variant="ghost" size="icon-sm"` X. This is the exact pattern I reuse.
- `googleCalendarCatalog EventChip EventList DayCell MonthGrid eventTitle eventTimeLabel isAllDay
  components.tsx` — returned the chip + grid source. **Takeaway:** `EventChip` is today a plain `<div>`
  (all-day = tinted `colors.bar`; timed = `bg-accent/60` + `colors.dot` + `eventTimeLabel`); titles go
  through `eventTitle` ("(no title)" degrade). The grid lives in `EventList` as
  `flex h-full flex-row … gap-3` (legend `<aside>` + grid `flex-1`).
- `eventColorClasses eventColorClassesByCalendar bar dot swatch` (Grep in logic.ts) — **Takeaway:** the
  owning-calendar color is already a token pair `{ dot: 'bg-event-<hue>', bar: 'bg-event-<hue>/25
  border-l-2 border-event-<hue>' }`. The detail swatch reuses `colors.dot` — no new color token.
- `button.tsx` — **Takeaway:** `Button` has `variant="ghost" size="icon-sm"` (the X), plus built-in
  `focus-visible:ring-[3px] ring-ring/50`. The external link is a plain header-title `<a hover:underline>`
  (§1.3/§2.8), not a `Button`. No new primitive needed.
- `index.css` — **Takeaway:** every color I need exists: `--card`, `--card-foreground`, `--foreground`,
  `--muted-foreground`, `--border`, `--muted`, `--primary`, `--destructive`, `--accent`, plus the full
  `--event-*` family. No raw hex, no new token.

**memory_recall / memory_smart_search:**

- `design system dock side-dock Slack thread tokens calendar panel` — empty store (no prior calendar
  detail decision). Persisted this design's dock-reuse decision via `memory_save` after authoring.

**Net:** the feature is fully expressible in existing tokens + the `Button`/`ScrollArea` primitives + a
verbatim copy of the Slack dock shell. **No new theme token and no new `components/ui/` primitive.** The
only net-new renderer artifact is the native `EventDetail` dock component (a panel-chrome sibling, not a
catalog node), which the developer builds.

---

## 1. Dock container (precedent: the shipped Slack thread side-dock)

The event detail dock is the **same shell** as `SlackThreadPanel`, retargeted to an event. Reuse the
classes verbatim so the two docks are structurally and visually identical — this is the whole point of
the side-dock idiom; do not invent a second dock style.

### 1.1 Positioning context — the panel ROOT (full-viewport-height, always-overlay)

The scrim + dock are anchored to the **panel root** — the outermost `<section>` (made `relative`,
already `flex h-full`), NOT to the calendar content region — so they span the **full viewport height
of the whole panel** (top to bottom, over the tab strip / content / footer) **independent of the
calendar grid's height**. This is a revision from the earlier "wrap the grid in a `relative flex
min-h-0 flex-1` box" approach, whose `inset-y-0` only spanned the (variable-height) content region
and so tied the dock height to the grid. The dock is an absolute overlay at every width — no
side-by-side branch, no container query.

```
<section className="relative flex h-full … flex-col">
  …tab strip / content region / composer / footer…
  {genUiEvent && ( …scrim (absolute inset-0) + dock (absolute inset-y-0 right-0)… )}
</section>
```

- **Grid fills available height (revision).** The connected content `<div role="tabpanel">` is now a
  `flex min-h-0 flex-1 flex-col`; the grid pane inside it is `flex min-h-0 min-w-0 flex-1`. That lets
  the month grid's fill chain (`EventList` `flex h-full` → `CalendarMonthGrid` `flex h-full min-h-0
  flex-col` → bordered box `flex min-h-0 flex-1` → cells grid `grid min-h-0 flex-1 auto-rows-fr`)
  stretch the 6 week rows down to consume the panel's vertical space rather than sit at a small fixed
  height. `DayCell` keeps `min-h-[64px]` and `auto-rows-fr` distributes the extra height evenly;
  day-number + chips layout and "+N more" overflow are unchanged.
- Grid pane: `min-w-0 flex-1` — **stays mounted and keeps its full width at all times** (FR-002). The
  dock NEVER reserves a column or shrinks/reflows the grid; the grid is simply covered on the right
  while the dock is open.
- The legend `<aside>` rail inside `EventList` is untouched — the dock floats over the right of the
  whole panel, outside it.

### 1.2 Dock shell (always-overlay drawer)

The dock reuses the Slack drawer's overlay classes but DROPS the `@[32rem]/…` side-by-side variants —
it is the absolute right-drawer at every width:

```
<div className="absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] translate-x-0 border-l border-border
                bg-card shadow-lg transition-transform duration-200 ease-out motion-reduce:transition-none">
  <EventDetail event={genUiEvent} onClose={closeDetail} />
</div>
```

The drawer is pinned to the right edge (`inset-y-0 right-0`), capped at `max-w-[22rem]`, floating over a
`bg-black/40` click-away scrim (`absolute inset-0 z-10`, always present — no `@[32rem]/…:hidden`). Both
are children of the `relative` panel `<section>` (§1.1), so `inset-y-0`/`inset-0` resolve to the **full
panel height** — the dock is full-viewport-height regardless of how tall/short the grid is. The dense
7-column grid keeps its full width unchanged whether the dock is open or closed, so navigating /
reading the month never reflows when the dock opens.

### 1.3 `EventDetail` component frame (copy of `SlackThreadPanel` frame)

- Root: `flex h-full min-w-0 flex-col bg-card`.
- **Header row** (sticky top, non-scrolling): `flex items-center gap-2 border-b border-border px-2 py-1.5`.
  - Leading icon: `CalendarDays` (lucide), `size-4 shrink-0 text-muted-foreground`, `aria-hidden`.
    (Slack uses `MessageSquare`; the calendar analog is `CalendarDays` — already the panel's idiom.)
  - Title (now the external link, FR-010): `detailTitle(event)` (the same helper the chip uses →
    "(no title)" degrade, FR-004). When `openInGoogleUrl(event)` returns a non-secret http(s) URL the
    title renders as `<a href={link} target="_blank" rel="noreferrer">` (a `flex min-w-0 flex-1
    items-center gap-1.5 … hover:underline` row) carrying a trailing `ExternalLink` (lucide, `size-3.5
    shrink-0 text-muted-foreground`) glyph; the anchor's `target="_blank"` is routed to
    `shell.openExternal` by the window's `setWindowOpenHandler` (NO new IPC). When no link is present
    the title degrades to the plain `<span className="flex-1 truncate text-sm font-medium
    text-foreground">` with no icon and no anchor (never a broken link). Single-line truncate; the full
    title repeats in the body (§2.1) so nothing is lost.
  - Close: `<Button type="button" variant="ghost" size="icon-sm" aria-label="Close event detail"
    onClick={onClose}><X className="size-4" /></Button>` — identical to the Slack X (FR-003).
- **Body** (scrolls within the dock, never the panel — Edge Case "Long description / many attendees"):
  a vertical stack inside a scroll region. Use the existing **`ScrollArea`** primitive
  (`src/renderer/components/ui/scroll-area.tsx`) wrapping the field stack, OR a plain
  `min-h-0 flex-1 overflow-y-auto` div — match whichever the Slack `MessageList` body resolves to for
  consistency; `ScrollArea` is preferred for the themed thin scrollbar. Inner padding `px-3 py-2.5`,
  field rows stacked `flex flex-col gap-3`.

---

## 2. Field treatments

A consistent two-tier row idiom for every field: a tiny muted **label** + the **value** beneath. This
mirrors the calendar legend rail's `text-[11px] font-medium text-muted-foreground` label idiom so the
dock reads as the same product family.

Row label class (shared): `text-[11px] font-medium uppercase tracking-wide text-muted-foreground`.
Each row is omitted entirely when its field is absent (no blank row, FR-006/008) — see §3.

### 2.1 Title (in body)

Repeat the title as the body's lead, larger than the header truncation so a long title wraps fully:
`text-base font-semibold leading-snug text-card-foreground`. Value = `eventTitle(event)`. No label above
the title (it is self-evidently the heading). Recurring badge (§2.7) sits inline after / below it.

### 2.2 Time (FR-005)

- Label: `When`.
- Value: `text-sm text-card-foreground tabular-nums`, derived by a **new pure helper**
  `eventDetailLogic.ts` (per the plan), NOT inline JSX. Cases:
  - **Timed, same day:** `Sat, Jun 20, 2026 · 9:30 – 10:00 AM` (locale `Intl`).
  - **Timed, multi-day:** two lines — `Starts Sat, Jun 20, 2026 · 9:30 AM` / `Ends Sun, Jun 21, 2026
    · 10:00 AM`.
  - **All-day, single:** `Sat, Jun 20, 2026` + a small inline **all-day pill** (`Badge`-style, see
    below); no clock.
  - **All-day, multi-day:** inclusive range `Jun 20 – 22, 2026` (Google exclusive-end corrected in the
    helper, Edge Case) + all-day pill.
  - **All-day pill:** a muted chip — `inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5
    text-[10px] font-medium text-muted-foreground` reading `All day`. (Reuses `--muted`; no Badge import
    needed, but `Badge variant="secondary"` is an acceptable equivalent if already imported.)

### 2.3 Location (FR-006)

- Label: `Where`. Value: `text-sm text-card-foreground break-words`. Optional leading `MapPin`
  `size-3.5 text-muted-foreground` inline. **Omit the whole row if absent** — never a blank "Where".

### 2.4 Description (FR-007)

- Label: `Description`.
- Value: **plain text** (spec OQ resolved to plain text — no HTML, no `dangerouslySetInnerHTML`):
  `text-sm leading-relaxed text-card-foreground whitespace-pre-wrap break-words`. `whitespace-pre-wrap`
  preserves the event's own line breaks; the dock scroll handles length.
- **Absent:** show a calm placeholder row — label `Description` + value
  `text-sm italic text-muted-foreground` reading `No description`. (Spec allows omit OR placeholder;
  the placeholder reads more intentionally in a detail view and matches "No replies."/"No messages yet."
  calm-empty idiom already used in the Slack dock.)

### 2.5 Attendees (FR-008)

- Label: `Attendees` (optionally `Attendees (N)` with the count).
- List: `flex flex-col gap-1`. Each attendee is a row:
  `flex items-center gap-2 text-sm text-card-foreground`.
  - Optional response-status dot (only if the data distinguishes it): `size-1.5 rounded-full` colored
    by `--event-green` (accepted) / `--muted-foreground` (needs-action/unknown) / `--event-red`
    (declined). Color is reinforcement only; never the sole signal.
  - Name/email: `truncate`. Self / organizer MAY get a trailing muted chip
    `text-[10px] text-muted-foreground` (`You` / `Organizer`) — optional per spec.
- **Omit the entire section if absent** (a solo event is normal, FR-008). Long lists scroll within the
  dock body.

### 2.6 Owning calendar (FR-009)

- Label: `Calendar`.
- Value row: `flex items-center gap-2 text-sm text-card-foreground`:
  - **Color swatch** = the owning calendar's solid token, REUSING the existing helper result:
    `<span className={cn('size-2.5 shrink-0 rounded-full', colors.dot)} aria-hidden />` where `colors`
    comes from `eventColorClassesByCalendar(event, calendars)` (the same call the chip already makes) —
    so the swatch matches the legend swatch and the chip dot exactly. **No new color token.**
  - Calendar name: `truncate text-card-foreground`. If only an id is known, show the id (graceful).

### 2.7 Recurring-series indicator (FR-011, SHOULD)

- When the event is a recurring instance, show a small badge near the title (§2.1) or as its own row:
  `inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium
  text-muted-foreground` with a leading `Repeat` icon `size-3` + label `Part of a series`. The
  occurrence's own date/time is already the §2.2 value (the MUST). If the recurring marker is not wired,
  this badge is simply absent (degrade, not error).

### 2.8 External link — the dock-header TITLE is the link (FR-010)

The external "open in Google Calendar" affordance lives in the **dock header title** (§1.3), not a
separate body row. There is no bottom-of-body link block.

- Affordance: the header title itself is the anchor when `openInGoogleUrl(event)` is a non-secret
  http(s) URL — `<a href={link} target="_blank" rel="noreferrer">` carrying the truncated title plus a
  trailing `ExternalLink` (lucide, `size-3.5 shrink-0 text-muted-foreground`) glyph signalling "leaves
  the app". The anchor gets `hover:underline` + a `focus-visible` ring (no `Button` wrapper needed).
- Opens in the **system browser** via cosmos's existing external-open path: the anchor's
  `target="_blank"` is intercepted by the window's `setWindowOpenHandler`, which routes http(s) to
  `shell.openExternal` and denies the in-app window — never in-app, never a token-bearing URL (FR-012),
  NO new IPC channel.
- **Absent `htmlLink`:** the title degrades to plain text (no icon, no anchor) — never a broken or
  disabled link (FR-010 degrade). "(no title)" (FR-004) still applies to the text in both cases.

---

## 3. States

| State | Treatment |
|-------|-----------|
| **Loading** | **None.** The detail renders entirely from the clicked chip's already-in-hand props (plan: no fetch, no `events.get`). The dock appears already populated; there is no skeleton/spinner. (This is the one deliberate divergence from the Slack dock, which fetches replies.) |
| **Populated (all fields)** | Header (icon + title-as-external-link + X) over the scrollable body: Title → When → Where → Description → Attendees → Calendar → recurring badge (if any). The external link is the header title itself (§1.3/§2.8), not a body row. Spacing `gap-3` between rows. |
| **Fields absent (omitted rows)** | Location / attendees rows are **removed entirely** (FR-006/008) — no blank labels, no empty gaps. The stack reflows tightly. |
| **No description** | The calm placeholder row `No description` (§2.4) — italic muted, never a crash. |
| **Malformed event / render error** | The dock content is wrapped so a render throw degrades to the **existing per-tab surface error boundary** inside the dock region (FR-016) — a calm `rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive` message (the same error chip the Slack/A2UI region uses), NOT a white-screen, and it **must not take down the still-visible grid beside it** (the grid pane is a sibling, not a child, of the dock). A chip with no usable event data simply never opens the dock (inert, no crash). |
| **Not connected / reconnect-needed** | Unchanged — the panel's existing Connect / Reconnect CTA owns the whole content region; the relative overlay container only mounts on the connected `EventList`, so **no dock is openable** (FR-015). |
| **Empty month** | Unchanged — the existing empty-month note shows; there are no chips to click, so no dock. |
| **Connection drops while dock open** | The dock is transient: on `disconnect`/`reconnect_needed` (and on month nav / tab switch, FR-014) `genUiEvent` resets to `null` → the dock unmounts cleanly, the panel returns to its Connect CTA / full grid. No stuck or crashing dock. |

---

## 4. EventChip as an interactive `<button>` (FR-001, a11y)

The chip changes from `<div>` to `<button type="button">`, keeping its current visual body verbatim and
adding interactive affordances. Two variants (all-day bar / timed) both become buttons.

- **Base:** keep the existing inner markup (all-day `truncate rounded-sm … colors.bar`; timed `flex
  items-center gap-1 … bg-accent/60 … colors.dot + time + title`). Wrap as a button that is
  `block w-full text-left` (so it fills the cell width as the `<div>` did) and `cursor-pointer`.
- **Hover:** a subtle lift — add `hover:brightness-110` (works on both the tinted bar and the
  `bg-accent/60` timed chip without introducing a new token) OR `hover:bg-accent` on the timed chip /
  `hover:bg-event-<hue>/35` on the bar. Keep it gentle; the grid is dense.
- **Focus:** rely on the shared focus idiom used across cosmos buttons —
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
  focus-visible:ring-offset-card` so a keyboard ring is clearly visible against the `#1b1b1c` card.
  (`--ring` `#4a4a4c` is legible on the dark cell.) The ring must not be clipped — the cell uses
  `overflow-hidden`, so the ring may need `ring-inset` or the chip a hair of internal room; prefer
  `focus-visible:ring-inset` to stay within the cell.
- **Keyboard:** native `<button>` gives Enter/Space activation and tab-stop for free. Tab order follows
  DOM (left-to-right, top-to-bottom through cells) — acceptable for v1. Each chip's accessible name is
  its `eventTitle` (already the `title` attr; promote to the button's text content / `aria-label` so AT
  announces "(no title)" too). The chip stays inert (not a button, or `disabled`) if it has no usable id.
- **Active/pressed:** `active:brightness-95` (optional) for tactile feedback.
- **Open-detail link to dock:** clicking emits `CALENDAR_OPEN_DETAIL_ACTION`; while a dock is open the
  active chip MAY carry a faint selected ring (`aria-pressed` + `ring-1 ring-ring/50`) to show which
  event the dock is showing — mirrors Slack's active-row marking. Optional but recommended for the
  retarget UX (clicking another chip moves the marker).

---

## 5. Responsive behavior (the `32rem` breakpoint)

- **Wide (`@[32rem]/calbody` and up): side-by-side.** Dock is `relative shrink-0
  w-[clamp(18rem,42%,28rem)]`, `border-l border-border`, **no shadow**. The grid keeps `flex-1` and
  narrows. Scrim is `hidden`. This is the default for a normally-sized panel.
- **Narrow (below `32rem`): drawer overlay.** Dock is `absolute inset-y-0 right-0 z-20 w-full
  max-w-[22rem] shadow-lg`, sliding over the grid (which is undisturbed beneath). A **scrim**
  `absolute inset-0 z-10 bg-black/40 @[32rem]/calbody:hidden` sits behind it; **clicking the scrim
  closes the dock** (FR-003) — same as Slack. `transition-transform duration-200 ease-out
  motion-reduce:transition-none` for the slide; honors reduced-motion.
- The breakpoint is the **panel's own width** (container query), not the viewport — so a narrow Slack-
  beside-Calendar split or a small window both trigger the drawer correctly.

---

## 6. Interaction & a11y summary

- **Open:** click / Enter / Space on any rendered chip → dock opens / retargets. Single dock, never
  stacked.
- **Dismiss:** header X (always, `aria-label="Close event detail"`); narrow-mode scrim click; **Esc is
  OPTIONAL** for v1 (spec) — if added, wire it on the dock root for keyboard parity and route focus back
  to the triggering chip.
- **Focus return:** on close, return focus to the chip that opened the dock (standard dialog-return
  courtesy), since the chip is now a real focus target.
- **Contrast (dark-only):** all text uses `--card-foreground` (#e0e0e0) / `--muted-foreground` (#888)
  on `--card` (#1b1b1c) — the same pairings the rest of the panel already passes with. The link uses
  `--primary` (#4a9eff) on card (legible). Color-coded dots (attendee status, calendar swatch) are
  reinforcement only; the text label always carries the meaning.
- **Scope:** the dock is per-tab and resets on tab switch (FR-014) — no cross-tab bleed.

---

## 7. Tokens & primitives ledger

- **New theme tokens:** none. Reuses `--card`, `--card-foreground`, `--foreground`, `--muted`,
  `--muted-foreground`, `--border`, `--primary`, `--accent`, `--destructive`, `--ring`, and the existing
  `--event-*` family (via `eventColorClassesByCalendar`).
- **New `components/ui/` primitives:** none. Reuses `Button` (`variant="ghost" size="icon-sm"` X) and
  `ScrollArea` (themed dock body scroll); the external link is a plain `<a hover:underline>` header
  title (no `Button` wrapper). Optional
  `Badge variant="secondary"` for the all-day / recurring pills (equivalent inline chip given as
  fallback).
- **New renderer artifact (developer builds, not a design-system file):** the native `EventDetail` dock
  component + `eventDetailLogic.ts` time/range/attendee/title helpers. These consume the system; they do
  not extend it.

---

## 8. Open questions

- **None blocking.** All spec/plan OQs carry safe defaults already adopted here: link omits when
  `htmlLink` absent; description is plain text; the dock is an always-overlay drawer (`max-w-[22rem]`,
  no side-by-side breakpoint) anchored to the panel root so it is **full-viewport-height** (not
  grid-bound) while the grid width never changes; dismiss is X + scrim (Esc optional). The recurring
  badge is a SHOULD that degrades to absent if the marker is not wired (plan decision 7) — designer is
  fine either way.
