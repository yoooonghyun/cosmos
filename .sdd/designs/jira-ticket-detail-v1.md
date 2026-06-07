# Design: Jira Ticket Detail (click-to-open) — v1

**Status**: Draft
**Created**: 2026-06-07
**Spec**: .sdd/specs/jira-ticket-detail-v1.md
**Plan**: .sdd/plans/jira-ticket-detail-v1.md
**Owner**: designer

---

## 0. Summary

Two visual additions to the **connected** Jira rail panel:

1. A **`TicketCard` becomes clickable** — a card in the `IssueList` signals it is
   actionable (hover/focus/active treatment + cursor) and, on click or keyboard
   activation, opens that ticket's detail in place. A card with **no `issueKey`** (the
   placeholder `—`) is **not** actionable and must not look or behave clickable.
2. A native **back-to-list row** — panel chrome **outside** the A2UI host, shown only
   while a ticket detail is open, that returns the active tab to the list it came from.
   It is **structurally identical** to Confluence's `ChevronLeft` page-detail back row
   so the two panels read as one product.

This feature adds **no new token and no new shadcn component**. Everything is expressible
in existing primitives: the clickable card reuses the **Slack `ChannelList` clickable-row
pattern** (a real `<button>` wrapper around the display card, with the cosmos focus ring
and a non-interactive fallback for the missing-key case), and the back row reuses the
**Confluence back-row chrome** (a `ghost` `icon-sm` `Button` + `ChevronLeft` + a label in
a `border-b border-border px-2 py-1.5` row). The five detail-surface states are the
EXISTING Jira surfaces (default-view skeleton, the `buildIssueDetailSurface` detail, the
`IssueList` empty state, `buildNoticeSurface` error, native Connect/Reconnect) — nothing
new to draw.

**Flag: tokens added/changed — none. shadcn components added/changed — none.** See §6.

---

## 1. Surfaces & layout

### 1.1 Where things live

`JiraPanel.ConnectedBody` is a vertical flex column. Today (post jira-jql-search-v1):

```
<div className="flex h-full flex-col">
  <PanelTabStrip … />                          ← tab strip
  <JqlSearchBox … />                           ← native JQL search row (shrink-0)
  <div role="tabpanel" …>…A2UI host…</div>     ← per-tab surface (flex-1)
  <PromptComposer … />                         ← NL composer (bottom)
</div>
```

This feature inserts **one new shrink-0 row** — the back-to-list row — **between the
`JqlSearchBox` and the `role="tabpanel"` A2UI host, rendered only when a detail is open**
(`view.kind === 'detail'`):

```
<div className="flex h-full flex-col">
  <PanelTabStrip … />                          ← tab strip (unchanged)
  <JqlSearchBox … />                           ← JQL search row (unchanged)
  {view.kind === 'detail' && <BackToListRow … />}  ← NEW: native back row (shrink-0)
  <div role="tabpanel" …>…A2UI host…</div>     ← per-tab surface (flex-1, unchanged)
  <PromptComposer … />                         ← NL composer, unchanged (bottom)
</div>
```

The clickable `TicketCard` lives **inside** the A2UI host (it is a `jiraCatalog`
component); only its interactive shell + states change — see §2. The detail surface
itself (`buildIssueDetailSurface`) is unchanged; the back row is the only NEW chrome.

Placement rationale (mirrors Confluence): Confluence renders its back row (`ChevronLeft`
+ page title) **above its content region** when `view.kind === 'page'`. Jira's content
region is the A2UI `role="tabpanel"` host, so the back row sits directly above it. The
JQL search row stays visible above the back row while a detail is open (it is panel
chrome that filters the *list* you return to; it does not act on the open detail —
behavioral, invisible to layout). The NL `PromptComposer` stays bottom-docked, unchanged.

> Note on `view` scope: `view` is **panel-level chrome over the active tab**, not stored
> in `GenerativeTab`. The interface step resets `view` to `{ kind: 'list' }` whenever
> `activeTabId` changes (plan Phase 4) so a tab's open-detail chrome does not bleed across
> tabs. This is a behavioral/plan concern; visually it means the back row appears/
> disappears together with the active tab's detail/list state.

### 1.2 The back-to-list row — exact structure (mirrors Confluence)

Confluence's back row today (`ConfluencePanel.tsx`):

```
<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
  <Button type="button" variant="ghost" size="icon-sm" aria-label="Back"
          onClick={() => setView({ kind: 'search' })}>
    <ChevronLeft className="size-4" />
  </Button>
  <span className="truncate text-sm font-medium text-foreground">{view.title}</span>
</div>
```

The Jira back row uses the **same container, the same `ghost` `icon-sm` icon-button, the
same `ChevronLeft className="size-4"`**, with two intentional copy/label adaptations:

```
<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
  <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to list"
          onClick={goBackToList}>
    <ChevronLeft className="size-4" />
  </Button>
  <span className="truncate text-sm font-medium text-foreground">Back to list</span>
</div>
```

Differences from Confluence and why:
- **The label is the literal `Back to list`**, not the open item's title. Confluence shows
  the *page title* beside its back arrow (its detail has no in-surface title chrome). Jira's
  detail surface (`buildIssueDetailSurface`) **already renders the issue key + status badge
  at the top of the A2UI host**, so repeating the key in the back row would duplicate it.
  The spec's required affordance copy is explicitly "← Back to list" (spec acceptance
  criterion + FR-004), so the label states the destination ("list"), not the current item.
  This also makes the affordance read as navigation ("go back to the list"), matching the
  user's mental model from the spec scenario.
- **`aria-label="Back to list"`** on the icon-button (Confluence uses `"Back"`). The longer
  label is more precise about the destination; it is paired with the visible `Back to list`
  text so the button + label read as one control to a sighted user and the icon-button alone
  is self-describing to a screen reader.
- The visible `Back to list` text is **also** a click target? **No** — to stay
  byte-for-byte with Confluence, only the `Button` (the `ChevronLeft`) is the control; the
  trailing `<span>` is a label, not interactive. (Confluence's title span is likewise
  non-interactive.) This keeps a single, unambiguous focus target. See §5.1.

This row is `shrink-0` (a non-`flex-1` child of the column; the `border-b border-border
px-2 py-1.5` container gives it a fixed natural height — identical to Confluence). It
renders **only** when `view.kind === 'detail'`; in the list view it is absent and the
A2UI host sits directly under the JQL search row exactly as today.

### 1.3 The clickable `TicketCard` — interactive shell

Today `TicketCard` is a bare `Card` with no interactivity:

```
<Card className="gap-2 rounded-xl p-3 transition-colors hover:bg-accent/40"> … </Card>
```

The display `Card` body is **unchanged** (key badge, status badge, summary `line-clamp-2`,
assignee `PersonInline`). What changes is the **shell**: an *actionable* card is wrapped in
a real `<button>` (the Slack `ChannelList` precedent), a *non-actionable* card (no
`issueKey`) is rendered exactly as today with no wrapper.

```
// Actionable (issueKey is a non-empty string):
<button
  type="button"
  className="w-full rounded-xl text-left transition-colors
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  aria-label={`Open ${issueKey}`}
  onClick={emitOpenDetail}        // dispatches JIRA_OPEN_DETAIL_ACTION (renderer-local)
>
  <Card className="cursor-pointer gap-2 rounded-xl p-3 transition-colors hover:bg-accent/40 …">
    … unchanged card body …
  </Card>
</button>

// Non-actionable (no/empty issueKey, key renders as '—'):
<Card className="gap-2 rounded-xl p-3 …">     // NO wrapper, NO cursor-pointer, NO hover lift
  … unchanged card body …
</Card>
```

Notes:
- The wrapper is a **real `<button>`** (focusable, Enter/Space-activatable for free) —
  identical structure to `slackCatalog` `ChannelList`'s row button
  (`w-full rounded-… text-left focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-ring`). The card keeps `rounded-xl`, so the wrapper is `rounded-xl`
  too (the focus ring follows the card's corner radius).
- `cursor-pointer` is added to the **actionable** card only. The non-actionable card keeps
  the default cursor (`cursor-default` via the card's non-button context) so the `—`
  placeholder card neither looks nor acts clickable (spec edge case / FR-001).
- The existing `hover:bg-accent/40` stays on the `Card`; on the actionable card it now also
  signals interactivity (it was always there, decoratively — now it has a meaning). The
  non-actionable card **must not** present the hover lift, so `hover:bg-accent/40` is moved
  to only the actionable branch (see §2.1 / §6 build note).

`IssueList` decides actionable-vs-not per item (it already maps each `issue` to a
`TicketCard`); the per-card actionable branch is chosen by `issueKey` being a non-empty
string, mirroring how `ChannelList` branches on `channel.id`.

---

## 2. The TicketCard states (default / hover / focus / active / disabled)

The card has two top-level modes — **actionable** (non-empty `issueKey`) and
**non-actionable** (missing key, `—`). The five interaction states apply to the actionable
card; the non-actionable card is a single inert state.

### 2.1 Actionable card

| State | Visual treatment |
|---|---|
| **Default (rest)** | The card as today: `bg-card` (`#1b1b1c`), `rounded-xl`, `p-3`, key `Badge` (secondary, mono), `StatusBadge`, summary in `--foreground`, assignee in `--muted-foreground`. `cursor-pointer` over the whole card. No ring. |
| **Hover** | `hover:bg-accent/40` — the card surface lifts to `--accent` (`#2d2d30`) at 40% over `bg-card`. `transition-colors` makes it a smooth fade (already on the card). Cursor is the pointer. This is the only color shift; no border/shadow change (keeps it calm against the dark list). |
| **Focus (keyboard)** | The wrapping `<button>` shows the cosmos focus ring: `focus-visible:ring-2 focus-visible:ring-ring` (`--ring` `#4a4a4c`, 2px) hugging the `rounded-xl` corner, `focus-visible:outline-none` to drop the UA outline. The card body does not change; the ring is the focus signal. (Matches the Slack row button exactly.) |
| **Active (pressed)** | Native `<button>` press — no custom `:active` style is added (the Slack row adds none either). The `hover:bg-accent/40` remains during the press; the click immediately drives navigation (the detail read fires), so the press is momentary. Acceptable to leave at the primitive default — no new `active:` token. |
| **"Disabled" / loading** | The card does not carry a per-card disabled state. While the detail read is in flight the **whole active-tab surface** is replaced by the default-view skeleton (§3.1) — the list (and its cards) is unmounted, so there is no half-pressed card to style. No `disabled` attribute is set on the button (a click is a one-shot navigation, not a submit that can double-fire into the same surface). |

### 2.2 Non-actionable card (no/empty `issueKey`, key = `—`)

A single inert state: rendered exactly as today's `Card` with **no `<button>` wrapper, no
`cursor-pointer`, no hover lift, no focus ring, no `aria-label`, no tab stop**. The key
`Badge` shows `—` in `--muted-foreground`-adjacent secondary tone (unchanged). It looks
like a read-only placeholder card and is skipped in tab order — it neither looks nor acts
clickable (spec edge case; FR-001). This mirrors `ChannelList`, which renders a plain
`ChannelRow` (no button) for a channel missing its `id`.

> Why drop `hover:bg-accent/40` on the non-actionable card: a hover lift on a card that
> does nothing is a false affordance. The hover treatment must read as "this responds to
> me," so it belongs only to the actionable branch. (Build note §6.)

---

## 3. The detail-view surface states (all five)

These are the states of the **active-tab content region** (the A2UI `role="tabpanel"`
host) once a ticket is clicked. **Every one reuses an existing Jira surface — nothing new
is drawn.** The back row (§1.2) is present across all of them *except* the
reconnect/Connect case (where the whole connected body is unmounted).

### 3.1 Loading (the `jira:getIssue` read in flight)
- **Surface:** the active tab is marked `loadingDefault: true` by
  `requestDefaultInActiveTab`, so the **existing `DefaultViewSkeleton`** renders in the
  host until the detail surface (or a Notice) lands. This is the SAME per-tab skeleton the
  default view + JQL search already use (FR-006) — no detail-specific skeleton.
- **Back row:** present (`view.kind === 'detail'` is set the moment the click is
  intercepted, before the read resolves), so the user can abandon the load and go back.
- **a11y:** the skeleton container is `aria-busy="true"` (already on `DefaultViewSkeleton`).

> Design note: the skeleton is a **list** skeleton (four card-shaped rows), not a
> detail-shaped skeleton, because the existing per-tab loading state reuses
> `DefaultViewSkeleton` (the plan reuses `loadingDefault` verbatim, FR-006). This is a
> deliberate consistency trade-off — one loading treatment for every in-tab Jira read,
> matching the JQL-search design's same decision. **Not a blocker** (see §8 OQ-A for the
> noted-but-out-of-scope alternative).

### 3.2 Populated (the detail landed)
- **Surface:** `buildIssueDetailSurface(detail)` fills the host — the existing detail
  composition: the issue **key `Badge` + `StatusBadge`** at top, the description (`Text`
  body), the `CommentList`, the `TransitionPicker`, and the `AddCommentControl`. Identical
  rendering to the post-write re-push detail (the spec's required "same detail surface
  shape"). No change to any of these catalog components.
- **Back row:** present above it.

### 3.3 Empty / not-found
- **Surface:** if `getIssue` returns ok but the issue is effectively empty, the existing
  detail composition renders with its own empty sub-states (e.g. `CommentList` "No
  comments.", `TransitionPicker` "No transitions available.", an empty description). There
  is **no** separate "ticket not found" full-surface empty for an `ok` read — a truly
  missing key surfaces as a read **error** (§3.4), not an empty detail, because
  `jira:getIssue` for an unknown key fails rather than returning an empty detail.
- **Back row:** present.

### 3.4 Error (recoverable, non-reconnect)
- **Trigger:** a non-`reconnect_needed` failure of `getIssue` (`network`, `rate_limited`,
  or a thrown error → 4xx/5xx).
- **Surface:** a single calm, recoverable **`Notice` surface** via
  `buildNoticeSurface({ kind: 'error', message })` — the existing destructive-toned catalog
  `Notice` (the `Alert variant="destructive"` with `TriangleAlert`, border `--destructive/40`,
  `role="alert"` via the Alert primitive). Never a raw stack trace, never the panel-level
  "Could not render this surface" red bar (that is for A2UI render failures, not read
  failures).
- **Back row:** present — the user reads the Notice, clicks **Back to list**, and is back on
  a valid list to retry (spec: "I can go back to the list and retry").

### 3.5 Reconnect / Connect (token rejected mid-click)
- **Trigger:** `getIssue` fails with `reconnect_needed` / `not_connected`.
- **Surface:** main pushes **NO surface** (FR-008). `JiraManager.statusChanged` flips the
  panel's `status` so `JiraPanel` renders its existing **native Connect/Reconnect
  affordance** (the `SquareKanban` icon + `ConnectForm`), and the entire `ConnectedBody`
  (tab strip, JQL box, **the back row**, A2UI host, composer) is **unmounted**. No new
  design — this is the established connection-gating behavior shared with every Jira read.
- **Back row:** absent (the connected body is gone). On reconnect the panel returns to its
  default board (a fresh `ConnectedBody` mount), `view` resets to `{ kind: 'list' }`.

---

## 4. Interaction & accessibility

### 4.1 Focus order (top-to-bottom DOM order = tab order)
Within the connected body when a detail is open:
1. `PanelTabStrip` controls (tab buttons, close `X`, trailing `+`).
2. The **JQL search `Input`** (unchanged, still above the host).
3. The **Back-to-list `Button`** (the new back row — the icon-button is the only focusable
   element in the row; its label span is not a tab stop).
4. The **A2UI detail surface** focusables (the `TransitionPicker` `Select` + `Apply`
   button, the `AddCommentControl` `Textarea` + `Comment` button).
5. The NL `PromptComposer` `Textarea`, then its `Send` button (bottom).

Within the **list** view (no detail open), the order is: tab strip → JQL `Input` → each
**actionable `TicketCard` button** (in list order; non-actionable `—` cards are skipped) →
composer. So the natural keyboard path is "tab to a card → Enter to open → tab to Back to
list → Enter to return," exactly the spec's card → detail → back-row → list loop.

> The spec phrases the focus order as "card → detail → back row → back to list." In DOM
> order the back row sits **above** the detail surface (it is chrome over the host), so it
> is reached *before* the detail's inner controls on a fresh detail open. This is the
> Confluence precedent (its back arrow is the first focusable in the page-detail view) and
> is correct: a user opening a detail can immediately Shift-nothing/Tab-once to "Back to
> list" without traversing the whole detail. The *spec's* ordering describes the
> conceptual loop, not strict DOM order; the design resolves DOM order to match Confluence
> (back row before detail content). Flagged in §8 (OQ-B) as a deliberate, non-blocking
> resolution.

### 4.2 Keyboard paths
- **Open a ticket:** Tab to an actionable `TicketCard` (a real `<button>`) → **Enter or
  Space** activates it (native button semantics) → the `JIRA_OPEN_DETAIL_ACTION` is
  emitted and the detail opens in place. No custom key handler needed — the `<button>`
  gives Enter/Space for free (the reason for choosing a real focusable element over a
  `role="button"` div, per the designer-agent "lean on a real focusable element").
- **Return to the list:** Tab to the **Back to list** `Button` → **Enter or Space**
  activates it → `view` returns to `{ kind: 'list' }` and the originating read re-fires.
- **Non-actionable card:** not in tab order, not activatable — there is nothing to open.

### 4.3 ARIA / labels
- Actionable card `<button>`: `aria-label={`Open ${issueKey}`}` (e.g. "Open PROJ-123") —
  a concise accessible name (the visible card content — summary, status — is inside and is
  read after the label; the label gives the screen-reader user the actionable identity up
  front). Mirrors `ChannelList`'s `aria-label={`Open #${name}`}`.
- Non-actionable card: no `aria-label`, no `role`, not a button — announced as plain card
  content only.
- Back-to-list icon-button: `aria-label="Back to list"` (the icon alone is not a text
  label). The visible `Back to list` span is decorative reinforcement, not separately
  focusable. Matches Confluence's `aria-label="Back"` pattern (more precise copy).
- The in-flight skeleton is `aria-busy="true"` (existing). The error `Notice` carries
  `role="alert"` via the `Alert` primitive (existing). The host region keeps its existing
  `role="tabpanel"`.

### 4.4 Contrast (dark palette)
- **Card hover:** `--accent` `#2d2d30` at 40% over `bg-card` `#1b1b1c` — a subtle but
  perceptible lift on the dark list; the same hover the cards already use, validated in
  the live panel. Card text stays `--foreground` `#e0e0e0` (full contrast) for the summary;
  `--muted-foreground` `#888888` for assignee (intentionally secondary).
- **Card focus ring:** `--ring` `#4a4a4c`, 2px (`ring-2`) on the `rounded-xl` button — the
  same focus token every focusable cosmos control uses; visible against `bg-card` and the
  list gaps.
- **Back row:** `--border` `#333333` bottom divider (same as the JQL row's divider and
  every panel divider); the `ghost` icon-button hover is `--accent` (`hover:bg-accent`),
  its `ChevronLeft` and the `Back to list` label are `--foreground` `#e0e0e0` (the icon
  inherits the button's text color, the label is explicit `text-foreground`). All
  AA-legible on the `bg-card`/`bg-popover` chrome.
- No `--status-*` chip tokens are touched by either affordance; the detail surface's status
  badge continues to use them exactly as today.

---

## 5. Interaction details settled

### 5.1 Is the back-row label clickable?
**No.** Only the `ghost` icon-button (the `ChevronLeft`) is the control; the `Back to list`
text span is a non-interactive label. This is byte-for-byte with Confluence (whose title
span is non-interactive) and gives a single unambiguous focus/click target. (If a larger
hit area is ever wanted, the future change is to wrap the whole row in the button — but the
spec/Confluence precedent is icon-button-only, so **do not** widen it now.)

### 5.2 Does the JQL search box stay visible while a detail is open?
**Yes** — it is panel chrome that filters the *list*, present in both `list` and `detail`
views (it does not act on the open detail; submitting it returns to a list view, which is
acceptable and consistent — a search is itself a "go to a list" action). This matches the
JQL-search-v1 decision that the box is "always visible while connected." No new behavior.

### 5.3 Active/pressed treatment
No custom `:active` style is added — the native `<button>` press plus the persistent
`hover:bg-accent/40` is the press feedback, and the click resolves immediately into a
navigation (the skeleton replaces the list). This avoids a new `active:` token for a
momentary state. (Slack's clickable rows add none either.)

### 5.4 Post-write re-push keeps the back row
A `jira.transition` / `jira.comment` write on the open detail re-pushes a fresh detail into
the same tab (FR-012). The renderer `view` stays `{ kind: 'detail' }` across that re-push
(the write does not change `view`), so the **back row persists** and still returns to the
same originating list. No visual change at re-push beyond the detail's own post-write
`Notice` (the existing colored catalog `Notice`, design jira-generative-ui-v2 §9.5).

---

## 6. Consistency notes & build flags (stay on-system)

- **The clickable card = the Slack clickable-row pattern.** A real `<button>` wrapper
  (`w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-ring`) around the unchanged display card, with a non-interactive
  fallback for the missing-key case — identical in spirit to `slackCatalog` `ChannelList`.
  A user who clicks a Slack channel and a Jira ticket gets the same focus ring and the same
  "real button, keyboard-native" behavior.
- **The back row = the Confluence back row.** Same container
  (`flex items-center gap-1.5 border-b border-border px-2 py-1.5`), same `ghost` `icon-sm`
  `Button`, same `ChevronLeft className="size-4"`. Only the copy differs (`Back to list`
  vs. the page title). A user who used Confluence's drill-in back arrow recognizes Jira's
  instantly.
- **No new token, no new `components/ui/` component, no `components.json` change.** The
  feature is fully expressible in `Button` (`variant="ghost" size="icon-sm"`), the
  `Card` primitive, a native `<button>` wrapper, the `ChevronLeft` lucide icon (new import
  in `JiraPanel.tsx`), and existing tokens (`--accent`, `--ring`, `--border`,
  `--foreground`, `--muted-foreground`). **The design system is NOT extended.**

### Build flags for the developer (designer has no Bash — but nothing to install here)
- **No package install, no shadcn-CLI run.** `Button`, `Card`, and the `ChevronLeft`
  lucide icon already exist in the project; `ChevronLeft` is already imported by
  `ConfluencePanel.tsx`/`SlackPanel.tsx` and just needs adding to `JiraPanel.tsx`'s lucide
  import line.
- **`hover:bg-accent/40` move (jiraCatalog/components.tsx `TicketCard`):** today it is on
  the `Card` unconditionally. It must apply **only to the actionable branch** so the
  non-actionable `—` card has no false hover affordance (§2.2). Add `cursor-pointer` to the
  actionable card too. (This is a className placement change inside the existing component —
  not a new component.)
- **Back row chrome (JiraPanel.tsx):** add the `border-b border-border px-2 py-1.5` row with
  the `ghost` `icon-sm` `Button` + `ChevronLeft` + `Back to list` label, rendered only when
  `view.kind === 'detail'`, between `<JqlSearchBox>` and the `<div role="tabpanel">`. Wire
  its `onClick` to the plan's `goBackToList` (re-run the originating read).

---

## 7. Open questions

- **OQ-A (noted, NOT blocking) — list-shaped skeleton for a detail load.** The in-flight
  state reuses `DefaultViewSkeleton` (a four-card *list* skeleton) for what becomes a
  *detail* surface, because the plan reuses the per-tab `loadingDefault` state verbatim
  (FR-006). A detail-shaped skeleton (one title + status + body-line stack, like
  Confluence's `PageDetailSkeleton`) would be a closer shimmer, but it is **out of scope**:
  it requires the renderer to know the in-flight read is a *detail* (not a list), which the
  current single `loadingDefault` flag does not distinguish, and the spec explicitly reuses
  the existing loading state. **Resolution:** ship the existing `DefaultViewSkeleton`
  (consistent with the JQL-search design's same trade-off). If a per-read-kind skeleton is
  later wanted, it is a follow-up that adds a skeleton variant + a read-kind on the loading
  state — a spec/plan change, not this design's call.

- **OQ-B (resolved, noted) — DOM order of the back row vs. detail content.** The spec's
  conceptual loop is "card → detail → back row → list," but DOM-wise the back row is chrome
  **above** the detail host, so on a fresh detail open it is reached **before** the detail's
  inner controls. **Resolution:** follow the Confluence precedent (back row is the first
  focusable in the detail view) — this is the established, consistent pattern and lets a
  user reach "Back to list" without traversing the whole detail. Recorded here so the
  developer does not "fix" the order to literally match the spec sentence.

No blocking open questions. Every surface, state, token, and affordance is resolved against
the approved spec/plan and the existing Slack + Confluence patterns. The design system is
not extended.
