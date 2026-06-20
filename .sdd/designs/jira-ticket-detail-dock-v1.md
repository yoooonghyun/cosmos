# Design: Jira Ticket Detail — Right-Side Dock — v1

**Status**: Draft
**Created**: 2026-06-20
**Spec**: .sdd/specs/jira-ticket-detail-v1.md (revised #86 — view-swap → dock)
**Plan**: .sdd/plans/jira-ticket-detail-v1.md (Revision #86, approach **R-A**)
**Owner**: designer
**Supersedes (presentation)**: `.sdd/designs/jira-ticket-detail-v1.md` — that file specs the now-retired
whole-panel view-swap + native `ChevronLeft` "Back to list" row. This file specs the **right-side detail
dock** that replaces it. The clickable-`TicketCard` portion of v1 carries over and is refined in §2 here;
the back-row portion is retired.

> Sits between Plan (Step 2) and Interface (Step 3). The plan fixed the *mechanism* (approach R-A: the
> existing `jira:requestIssueDetail` A2UI frame is routed into a per-tab `detailSurface` slot hosted in a
> SECOND `A2UIProvider` inside the dock; the tab's main list `surface` is never clobbered) and the
> *container shell* (the Slack `@container/slackbody` two-pane reused as `@container/jirabody`). This file
> fixes the *visual contract*: dock anatomy around a **live A2UI host body**, the now-interactive ticket
> row, every state, and the breakpoint behavior — entirely in existing tokens and `components/ui/`
> primitives, dark-only.

---

## Grounding

> Direct investigation run for this design (mandatory). Queries actually executed:

**codegraph_explore / codegraph_search:**

- `SlackThreadPanel slackbody scrim onClose JiraPanel ConnectedBody A2UIProvider ActiveTabSurface
  handleSurfaceAction detailSurface IssueList TicketCard` — returned the verbatim `SlackThreadPanel`
  dock frame, the current `JiraPanel` `ConnectedBody`/`handleSurfaceAction`/`goBackToList`, and the
  clickable `TicketCard`. **Takeaways:** (1) the dock frame to copy is `SlackThreadPanel` — root
  `flex h-full min-w-0 flex-col bg-card`, header `flex items-center gap-2 border-b border-border px-2
  py-1.5` with a leading lucide icon + `flex-1 truncate text-sm font-medium text-foreground` title +
  `Button variant="ghost" size="icon-sm"` X (`aria-label="Close thread"`). (2) JiraPanel today renders
  the active tab's surface inside `<A2UIProvider key={activeTab.id} catalog={jiraCatalog}><ActiveTabSurface
  … onAction={handleSurfaceAction}/></A2UIProvider>` within a `min-h-0 flex-1 p-3 text-card-foreground`
  content div; `handleSurfaceAction` already intercepts `JIRA_OPEN_DETAIL_ACTION` and returns `true`.
  (3) `TicketCard` is already a display card with an `actionable` prop toggling
  `cursor-pointer hover:bg-accent/40`; the `<button>` wrapper + dispatch live in `IssueList`.
- (carried, JiraPanel render region) — the skeleton branch (`DefaultViewSkeleton` / `KanbanBoardSkeleton`)
  is gated by `activeTab.loadingDefault || navLoading || activeTab.autoRefreshing`, the surface error chip
  is `rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive`,
  and `!isConnected` swaps the whole content region to the Connect CTA (`SquareKanban` + `ConnectForm`).
  These are reused verbatim for the dock's in-host states.

**Read (precedent designs):**

- `.sdd/designs/calendar-event-detail-v1.md` — the direct template (an overlay→dock conversion). Its §1
  dock shell, §5 `32rem` breakpoint, and §3 state table are adopted wholesale; the ONE structural
  difference is that the calendar dock body is a **native `EventDetail`** rendered from in-hand props
  (no loading state), whereas the Jira dock body is a **live A2UI `detailSurface` host** that fetches —
  so unlike calendar, the Jira dock HAS a loading skeleton + an error state inside the body (§3).
- `.sdd/designs/jira-ticket-detail-v1.md` — the superseded view-swap design; §2 (clickable card) carries.

**memory_recall / memory_smart_search:**

- `Jira generative UI ticket detail dock design tokens shadcn` — empty store (no prior Jira-dock
  decision). `design system dock side-dock Slack thread tokens` recall in the calendar design was also
  empty. Persisting this dock-reuse decision via `memory_save` after authoring.

**Net:** the feature is fully expressible in existing tokens + the `Button`/`ScrollArea`/`A2UIProvider`
primitives + a verbatim copy of the Slack/calendar dock shell. **No new theme token and no new
`components/ui/` primitive.** The only net-new renderer artifact is the dock shell wiring in
`JiraPanel.tsx` (a panel-chrome sibling that HOSTS the existing A2UI provider) — it consumes the system,
it does not extend it.

---

## 1. Dock container (precedent: the shipped Slack thread dock + the calendar event-detail dock)

The Jira ticket-detail dock is the **same shell** as `SlackThreadPanel` and the calendar `EventDetail`
dock, retargeted to a ticket. Reuse the classes verbatim so all three docks are structurally and visually
identical — uniformity across panels is the whole point of the side-dock idiom; do not invent a third dock
style. **Jira's only twist:** the dock body hosts a **live A2UI `detailSurface`** (the generative ticket
detail with interactive transition/add-comment write controls), not a static native detail component. The
shell is unchanged; only what sits inside the scrollable body differs.

### 1.1 Two-pane body — `@container/jirabody`

Wrap the connected content region (the existing list `A2UIProvider`) in the same container the Slack and
calendar bodies use, renamed to `jirabody`:

```
<div className="@container/jirabody relative flex min-h-0 flex-1">
  <div className="min-w-0 flex-1"> …the existing list A2UIProvider + ActiveTabSurface… </div>
  {detailIssueKey != null && ( …scrim + dock… )}
</div>
```

- **List pane:** `min-w-0 flex-1` — **stays mounted and visible at all times** (FR-002/FR-005). The list
  `A2UIProvider key={activeTab.id}` keeps rendering the tab's MAIN `surface` untouched; side-by-side it
  simply gets narrower, in drawer mode it is unchanged behind the overlay. This is precisely why the
  retired `view` swap, `goBackToList`, `originListRef`, and the `composed`-snapshot machinery are deleted
  (spec §Grounding takeaway 2): nothing clobbers the list, so there is nothing to restore.
- The per-tab loading skeleton, surface-spinner, surface-error chip, and `KanbanBoardSkeleton`/
  `DefaultViewSkeleton` branches that today wrap the list `A2UIProvider` are **untouched** — they belong
  to the LIST pane and keep behaving exactly as today (the in-flight list read still skeletons the list,
  the still-open dock beside it is independent).

### 1.2 Dock shell (copy of the Slack/calendar dock div)

```
<div className="absolute inset-y-0 right-0 z-20 w-full max-w-[22rem] translate-x-0 border-l border-border
                bg-card shadow-lg transition-transform duration-200 ease-out motion-reduce:transition-none
                @[32rem]/jirabody:relative @[32rem]/jirabody:w-[clamp(18rem,42%,28rem)]
                @[32rem]/jirabody:max-w-none @[32rem]/jirabody:shrink-0 @[32rem]/jirabody:shadow-none">
  <JiraDetailDock issueKey={detailIssueKey} surface={detailSurface} … onClose={closeDetail} />
</div>
```

Breakpoint is **`32rem`** (the same start point as Slack and calendar). The Jira issue list is dense
(stacked `TicketCard`s with key + status + summary + assignee), so at `≥32rem` the list keeps `flex-1`
and stays a legible single column beside a `clamp(18rem,42%,28rem)` dock; below `32rem` the drawer
overlays the list rather than squeezing the cards into illegibility (spec Edge Case "Narrow panel").
Keep `32rem` for cross-panel consistency; revisit only if QA shows cards going illegible at the boundary.

### 1.3 Dock frame (copy of the `SlackThreadPanel` / `EventDetail` frame), body = A2UI host

The dock content component (call it `JiraDetailDock` — a panel-chrome sibling, NOT a catalog node) mirrors
the `SlackThreadPanel` frame exactly, with the body holding a **second `A2UIProvider`** instead of a
`MessageList`:

- **Root:** `flex h-full min-w-0 flex-col bg-card`.
- **Header row** (sticky top, non-scrolling): `flex items-center gap-2 border-b border-border px-2 py-1.5`.
  - Leading icon: `SquareKanban` (lucide) — already the Jira panel's idiom (the Connect CTA uses it);
    `size-4 shrink-0 text-muted-foreground`, `aria-hidden="true"`. (Slack uses `MessageSquare`, calendar
    `CalendarDays`; the Jira analog is `SquareKanban`.)
  - Title: `<span className="flex-1 truncate text-sm font-medium text-foreground">` reading the clicked
    **issue key** (e.g. `PROJ-123`) when known, else the literal `Ticket`. The key is the most stable,
    instantly-recognizable label and is already in hand from the click (`detailIssueKey`) — it needs no
    field from the surface, so the header title is correct even during the loading state. The full
    key + summary + status repeat inside the A2UI detail surface, so nothing is lost. `truncate` single
    line.
  - Close: `<Button type="button" variant="ghost" size="icon-sm" aria-label="Close ticket detail"
    onClick={onClose}><X className="size-4" /></Button>` — identical to the Slack/calendar X (FR-004).
- **Body** (scrolls within the dock, never the panel — spec Edge Case "Long detail content"): hosts the
  live A2UI detail surface. Use the existing **`ScrollArea`** primitive
  (`src/renderer/components/ui/scroll-area.tsx`) for the themed thin scrollbar — matching whichever the
  list pane's host resolves to is unnecessary here because the detail can be long (many comments). Inner
  padding `p-3` (matching the list content region's `p-3 text-card-foreground`), so the hosted surface
  has the same gutter it had in the old view-swap. The body is:

  ```
  <ScrollArea className="min-h-0 flex-1">
    <div className="p-3 text-card-foreground">
      {/* §3 loading / populated / error — the SAME branch structure the list region uses */}
      <A2UIProvider key={`${tab.id}:detail`} catalog={jiraCatalog}>
        <ActiveTabSurface surface={detailSurface} catalogId={JIRA_CATALOG_ID}
                           panelName="JiraDetailDock" onAction={handleSurfaceAction} />
      </A2UIProvider>
    </div>
  </ScrollArea>
  ```

  - `key={`${tab.id}:detail`}` keeps the dock host distinct from the list host (`key={tab.id}`) so a
    retarget to another ticket cleanly re-processes the new `detailSurface` (plan R3).
  - `onAction={handleSurfaceAction}` is the **same handler** the list host uses: it intercepts
    `JIRA_OPEN_DETAIL_ACTION` (returns `true`; a detail surface has no nested ticket list so this is
    inert here, spec Edge Case) and returns `false` for everything else, so the detail's `jira.transition`
    / `jira.comment` **write controls still flow to main unchanged** — a write re-pushes a fresh detail
    into the SAME `detailSurface` slot, the dock stays open showing it, and the X stays available
    (FR-012, §3 "After a write").

---

## 2. The now-interactive ticket row (was view-swap, now opens a dock) — FR-001, a11y

Carried from the superseded v1 design §2, with the click target unchanged (the `<button>` wrapper +
`JIRA_OPEN_DETAIL_ACTION` dispatch already live in `IssueList`; `TicketCard` stays display-only with the
`actionable` prop). The treatments below are the visual contract now that a click opens a **dock beside
the list** rather than swapping the view — the row must read as "opens a detail panel", and must mark
which ticket the open dock is currently showing.

- **Affordance (`actionable` card):** keep the current `cursor-pointer hover:bg-accent/40` on the
  `TicketCard` (verbatim, already shipped). The inert `—`-key card keeps NO pointer/hover (spec Edge
  Case "Ticket with no/empty key") — it is not wrapped in a button and is not in tab order.
- **Hover:** `hover:bg-accent/40` (existing) — a gentle lift on the dense card; do not deepen it, the
  list is dense.
- **Focus:** the `<button>` wrapper (in `IssueList`) uses the shared cosmos focus idiom —
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
  focus-visible:ring-offset-card` (the `--ring` `#4a4a4c` ring is legible against the `#1b1b1c` card).
  The button is `block w-full text-left` so it fills the row as the card did.
- **Keyboard:** native `<button>` gives Enter/Space activation + a DOM-order tab stop for free; the
  accessible name is the issue key + summary (the card content). Each actionable card is one tab stop.
- **Active/pressed:** `active:bg-accent/60` (optional) for tactile feedback.
- **Selected / retarget marking (NEW for the dock — recommended):** while a dock is open, the card whose
  ticket the dock is showing carries a faint selected ring + `aria-pressed="true"`:
  `aria-pressed={detailIssueKey === key}` and, when pressed, `ring-1 ring-ring/50 ring-inset` (use
  `ring-inset` so the dense card's ring is not clipped by neighbors). This mirrors Slack's active-row
  marking and the calendar §4 active-chip marking, and makes **retarget** legible — clicking another
  card moves the marker and retargets the single dock (FR-002), never stacking a second dock. The ring
  is reinforcement; the open dock's header key is the primary "which ticket" signal.
- **Focus return on close:** on dock dismiss, return focus to the card that opened it (standard
  dialog-return courtesy), since the card is a real focus target.

---

## 3. States

The dock SHELL (header + X) is always present whenever `detailIssueKey != null`. The dock BODY moves
through loading → populated → error exactly as the list region does — reusing the SAME skeleton + error
chip the list uses, so the two read as one product. (This is the key divergence from the calendar dock,
which renders from in-hand props and therefore has no loading/error body state.)

| State | Treatment |
|-------|-----------|
| **Dock loading** (detail frame in-flight) | The dock shell (header key + X) is shown immediately on click; the body shows the existing per-tab loading skeleton **scoped to the dock body** — the single-region `DefaultViewSkeleton` (the detail is a single-column surface, never a kanban board, so always `DefaultViewSkeleton`, never `KanbanBoardSkeleton`). Gated by the dock's own loading flag (the `loadingDefault`/`navLoading` floor the open-detail read already starts via `requestDefaultInActiveTab`, scoped to the dock now). The still-visible list pane is NOT disturbed — its skeleton flags are independent (FR-006). |
| **Populated** (live A2UI surface) | The body renders the `buildIssueDetailSurface` A2UI surface via the dock's `A2UIProvider`/`ActiveTabSurface`: key + status, description, comments, the transition control, and the add-comment control — the same detail content a post-write re-push renders, now framed by the dock and scrolled within `ScrollArea`. Header key matches the surface. |
| **Detail fetch error** (non-reconnect) | The dock body shows the **same calm error chip** the list region uses: `rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive`, `role="alert"`, reading the recoverable message (FR-007; main pushes `buildNoticeSurface({kind:'error'})` for `network`/`rate_limited`). It is a single chip inside the dock, never a crash, never a raw stack trace; the list pane beside it is untouched (the dock body is a sibling region, not the list's child). The user dismisses the dock (X / scrim) and can re-click to retry. |
| **Reconnect-needed / not-connected mid-click** | No surface is pushed (FR-008). The dock does NOT open with an empty body: `reconnect_needed`/`not_connected` flips `isConnected` false → the whole content region swaps to the existing Connect/Reconnect CTA (`SquareKanban` + `ConnectForm`), and the `@container/jirabody` two-pane (with any open dock) unmounts — so no dock is left stranded (FR-008/FR-014, calendar §3 parity). |
| **List stays visible while dock open** | The list pane (`min-w-0 flex-1`) is mounted and visible at all times — side-by-side it narrows, in drawer mode it sits undisturbed beneath the overlay. No list re-fetch occurs on open or close (FR-005). |
| **After a write in the dock** | A `jira.transition`/`jira.comment` from the dock body reaches main (handler returns `false`), main re-pushes the fresh detail into the SAME `detailSurface` slot; the dock stays open showing the updated detail and the X remains available (FR-012). Brief in-flight may reuse the dock loading skeleton. |
| **Dock dismissed** | X (always) or, in narrow drawer mode, a click on the scrim sets `detailIssueKey = null` (and clears `detailSurface`) → the dock unmounts, the list returns to full width exactly as it was (same scroll, no re-fetch — it never moved), focus returns to the originating card (§2). |
| **Retarget to another ticket** | Clicking a different actionable card sets a new `detailIssueKey` + fires a fresh `requestIssueDetail`; the single dock body shows the new ticket (loading → populated), the header key updates, and the selected-ring marker (§2) moves to the new card. The dock never stacks (FR-002). |
| **Tab switch while dock open** | The dock is per-tab: `detailIssueKey`/`detailSurface` reset to `null`/cleared on `activeTabId` change → the dock closes, the other tab shows its own list with no dock; switching back shows the list (the dock having closed). No cross-tab bleed (FR-014). |
| **Connection drops while dock open** | Transient dock: on `disconnect`/`reconnect_needed` the dock resets to closed and the panel returns to its Connect/Reconnect CTA — no stuck or crashing dock (FR-014). |
| **Connect / empty fallbacks (unchanged)** | Not-connected → the existing Connect CTA owns the whole content region; the `@container/jirabody` two-pane only mounts on the connected list, so no dock is openable. An empty issue list (default board / no search results) shows the existing empty/`buildNoticeSurface` presentation in the list pane; there are no cards to click, so no dock opens. |

---

## 4. Responsive behavior (the `32rem` breakpoint)

- **Wide (`@[32rem]/jirabody` and up): side-by-side.** Dock is `relative shrink-0
  w-[clamp(18rem,42%,28rem)]`, `border-l border-border`, **no shadow**. The dense list keeps `flex-1` and
  narrows to a single legible column. Scrim is `hidden`. This is the default for a normally-sized panel.
- **Narrow (below `32rem`): drawer overlay.** Dock is `absolute inset-y-0 right-0 z-20 w-full
  max-w-[22rem] shadow-lg`, sliding over the list (undisturbed beneath). A **scrim**
  `absolute inset-0 z-10 bg-black/40 @[32rem]/jirabody:hidden` sits behind it; **clicking the scrim
  closes the dock** (FR-004) — same as Slack/calendar. `transition-transform duration-200 ease-out
  motion-reduce:transition-none` for the slide; honors reduced-motion.
- The breakpoint is the **panel's own width** (container query via `@container/jirabody`), not the
  viewport — so a narrow Jira-beside-another-panel split, or a small window, both trigger the drawer
  correctly without crowding the dense card list.

---

## 5. Interaction & a11y summary

- **Open:** click / Enter / Space on any actionable `TicketCard` → dock opens / retargets. Single dock,
  never stacked. The `—`-key card is inert and not a tab stop.
- **Dismiss:** header X (always, `aria-label="Close ticket detail"`); narrow-mode scrim click; **Esc is
  OPTIONAL** for v1 (spec OQ-2) — if added, wire it on the dock root and route focus back to the
  triggering card.
- **Focus order:** the actionable cards are DOM-order tab stops in the list pane; the dock, when open,
  follows in DOM order (header X, then the A2UI body's interactive controls — transition select,
  add-comment input/button). The dock is NOT a focus trap (it is a side-dock, not a modal dialog), so a
  keyboard user can tab between the list and the dock — matching the Slack/calendar docks.
- **Focus return:** on close, return focus to the card that opened the dock.
- **Contrast (dark-only):** all dock text uses `--foreground` (#e0e0e0) / `--muted-foreground` (#888) on
  `--card` (#1b1b1c) — the same pairings the rest of the panel passes with. The detail surface's own
  badges/controls are the existing `jiraCatalog` components (already contrast-checked). The selected-ring
  uses `--ring` (#4a4a4c), legible on the dark card. The error chip uses `--destructive` on a
  `destructive/15` wash (the established Jira error idiom).
- **Scope:** the dock is per-tab and resets on tab switch (FR-014) — no cross-tab bleed.

---

## 6. Tokens & primitives ledger

- **New theme tokens:** none. Reuses `--card`, `--card-foreground`, `--foreground`, `--muted-foreground`,
  `--border`, `--accent`, `--destructive`, `--ring`.
- **New `components/ui/` primitives:** none. Reuses `Button` (`variant="ghost" size="icon-sm"` for the X)
  and `ScrollArea` (themed dock body scroll), plus the existing `A2UIProvider` / `ActiveTabSurface`
  host pair and the `jiraCatalog` catalog (the SAME ones the list uses — the dock just mounts a second
  instance keyed `:detail`).
- **New renderer artifact (developer builds, not a design-system file):** the `JiraDetailDock` dock-shell
  component + the `@container/jirabody` two-pane wrapper and per-tab `detailIssueKey`/`detailSurface`
  state in `JiraPanel.tsx` (plan R2/R3). These consume the system; they do not extend it. The R-A
  `detailSurface`-slot routing seam in `useGenerativePanelTabs` is plan/interface work, not a design-system
  change.

---

## 7. Open questions

- **None blocking.** All spec/plan OQs carry safe defaults adopted here: dock width/breakpoint reuse the
  Slack/calendar `clamp(18rem,42%,28rem)` / `32rem` (spec OQ-1); dismiss is header X + narrow-mode scrim,
  Esc optional (spec OQ-2). The header title uses the in-hand issue key (correct even during loading); the
  selected-ring retarget marker is a recommended-but-optional reinforcement (the open dock's header key is
  the primary signal). The dock body's loading/error states reuse the list region's existing
  `DefaultViewSkeleton` + destructive error chip, so they introduce nothing new.
