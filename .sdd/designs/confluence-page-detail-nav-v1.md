# Design: Confluence Page Detail (click-to-open) — v1

**Status**: PARTIALLY SUPERSEDED by native-reuse approach — see spec "As Built"
**Created**: 2026-06-14
**Spec**: .sdd/specs/confluence-page-detail-nav-v1.md
**Plan**: .sdd/plans/confluence-page-detail-nav-v1.md
**Owner**: designer

> **Pivot note.** The shipped feature reuses the EXISTING native `PageDetail`
> component (rendered in a renderer-local overlay on row click) rather than a
> main-composed generative page-detail surface. The detail VISUALS here still
> apply (they describe the same `PageDetail` chrome + `ChevronLeft` back row that
> shipped); the surface-push / IPC plumbing this design assumed did not ship. See
> the spec's "As Built" section.

---

## Grounding (direct investigation run for this design)

**codegraph_explore / codegraph_search:**

- `JiraPanel handleSurfaceAction TicketCard actionable IssueList back row ChevronLeft detail view goBackToList jiraBackNav`
  — the shipped Jira precedent verbatim: the clickable `TicketCard`/`IssueList` `<button>`-wrapper
  pattern (`actionable` prop → `cursor-pointer hover:bg-accent/40` on the card, real `<button>` shell
  with `w-full rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring`), and the
  `view.kind === 'detail'` native back row (`flex items-center gap-1.5 border-b border-border px-2
  py-1.5` + `ghost` `icon-sm` `Button` + `ChevronLeft className="size-4"` + a `text-sm font-medium
  text-foreground` label). This is the surface this design mirrors.
- `ConfluencePanel ConfluenceNav view search page ChevronLeft back row PageDetail SearchResultList
  SearchResultRow Notice confluenceCatalog components` — the Confluence panel's EXISTING native back
  row (`view.kind === 'page'`, `ConfluencePanel.tsx:520-535`) is byte-for-byte the same chrome as
  Jira's; the generative catalog already ships `SearchResultRow` (display-only `div`, no interactivity
  today), `SearchResultList`, `PageDetail` (title/space `Badge`/body + "This page has no readable
  body." empty state), and `Notice` (`info`/`error`, destructive-toned).
- `confluenceCatalog SearchResultList PageDetail Notice components useBound RefreshButton` — confirmed
  the Confluence generative `PageDetail` and `Notice` catalog components render exactly the visuals the
  plan's `buildPageDetailSurface` / `buildConfluenceNoticeSurface` will emit (static props via the
  literal branch of `useBound`); the `Notice` is the Slack/Confluence calm destructive Alert.
- `JiraPanel detail back row SurfaceSpinner loadingDefault` + `ConfluencePanel SurfaceSpinner showSpinner
  A2UIProvider ActiveTabSurface onAction` — Confluence's generative content region has a `showSpinner →
  <SurfaceSpinner/>` branch and an `<A2UIProvider><ActiveTabSurface/>` host; **it passes NO `onAction`
  today** (Jira does) and has **NO `loadingDefault`/skeleton region** in the generative path (the native
  `PageDetailSkeleton` belongs to the native base only). This shapes §3.1 (loading) and §1.

**memory_recall / memory_smart_search:**

- `Confluence panel design jira ticket detail nav back row generative UI states` — no stored
  observations (compact). The design-system preference on file (`feedback_design_system`: real Tailwind +
  shadcn component system, not token-only) is honored: no one-off CSS; everything resolves to an existing
  token/primitive. The durable precedent is the on-disk `jira-ticket-detail-v1` design, which this mirrors.

---

## 0. Summary

Three visual additions to the **connected** Confluence rail panel's **generative** surface — each a
verbatim reuse of an existing cosmos pattern, so the Confluence drill-in reads as the same product as
Jira's:

1. A **`SearchResultRow` becomes clickable** inside a generated `SearchResultList`. A row that carries a
   non-empty page **id** signals it is actionable (cursor + hover lift + focus ring) and, on click or
   keyboard activation, opens that page's detail in place. A row with **no id** stays the inert
   display-only row exactly as today — no cursor, no hover, no focus ring, not in tab order.
2. A native **`← Back to list` row** — panel chrome **outside** the A2UI host, shown only while a
   generated-UI page detail is open, that returns the active tab to the generated list it came from. It
   is **structurally identical** to the Confluence native back row (`view.kind === 'page'`) and the Jira
   detail back row, so all three read as one control.
3. The **generated-UI page-detail surface** itself — `buildPageDetailSurface` emits the EXISTING
   Confluence catalog `PageDetail` (title + space `Badge` + plain-text body), with its existing
   "This page has no readable body." empty-body state; failures land as the existing catalog `Notice`.

This feature adds **no new token and no new shadcn component**. The clickable row reuses the Slack
`ChannelList` / Jira `IssueList` clickable-row pattern (a real `<button>` wrapper with the cosmos focus
ring); the back row reuses the Confluence native back row; the detail + error + empty-body surfaces are
the EXISTING catalog `PageDetail` / `Notice` components. The loading state reuses the existing
`SurfaceSpinner` (no detail-shaped skeleton — see §3.1 / §7 OQ-A).

**Flag: tokens added/changed — none. shadcn components added/changed — none.** See §6.

---

## 1. Surfaces & layout

### 1.1 Where things live

`ConfluencePanel`'s connected body is a vertical flex column (`section.flex.h-full.flex-col`).
The relevant region today:

```
<section className="flex h-full flex-col …">
  <PanelTabStrip … />                              ← tab strip
  <div className="… flex-1 …">                     ← content region (flex-1, overflow-auto)
    {showNativeBase && ( native search / page-detail browser base )}   ← native base (its OWN ChevronLeft back row, OQ-2: untouched)
    {showSpinner && <SurfaceSpinner/>}             ← generative send-spinner
    {activeTab.surface && <A2UIProvider><ActiveTabSurface/></A2UIProvider>}  ← generative A2UI host
  </div>
  <PromptComposer … />                             ← NL composer (bottom)
  <PanelFooter … />                                ← connection footer
</section>
```

This feature inserts **one new `shrink-0` row** — the generated-UI back-to-list row — **above the
generative content region (the `A2UIProvider`/`SurfaceSpinner` block), rendered only when the
generated-UI detail chrome is open** (`detailView.kind === 'detail'`):

```
<section className="flex h-full flex-col …">
  <PanelTabStrip … />                              ← unchanged
  {isConnected && !showSpinner && detailView.kind === 'detail' && <BackToListRow … />}  ← NEW (shrink-0)
  <div className="… flex-1 …">                     ← content region (unchanged)
    …native base… / SurfaceSpinner / A2UI host (now PageDetail detail or restored list)
  </div>
  <PromptComposer … />                             ← unchanged
  <PanelFooter … />                                ← unchanged
</section>
```

The clickable `SearchResultRow` lives **inside** the A2UI host (it is a `confluenceCatalog` component);
only its interactive shell changes — see §2. The detail surface itself (`buildPageDetailSurface` →
catalog `PageDetail`) is an existing component; the back row is the only NEW chrome.

> **Two distinct back rows, never co-rendered.** The Confluence panel already has a NATIVE back row for
> its native-base browser drill-in (`view.kind === 'page'`, lines 520-535). That is OQ-2-untouched. The
> NEW back row is for the GENERATED-UI detail path and is keyed on a SEPARATE `detailView` state. They
> are mutually exclusive: the native back row only shows on the native base (`showNativeBase`, which is
> false once a generated surface is present); the new back row only shows over the generative host. The
> plan gates them so they never both appear. Visually they are identical chrome (§1.2) — so even if a
> user moves between the native and generated drill-ins, the back affordance looks the same.

> **`detailView` scope.** `detailView` is panel-level chrome over the active tab (NOT stored in
> `GenerativeTab`). The interface step resets it to `{ kind: 'list' }` on every `activeTabId` change
> (plan Phase 6, FR-014) so an open detail's back row never bleeds across tabs. Visually: the back row
> appears/disappears together with the active tab's generated-UI detail/list state.

### 1.2 The `← Back to list` row — exact structure (mirrors the existing Confluence native back row)

Confluence's native back row today (`ConfluencePanel.tsx:520-535`):

```
<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
  <Button type="button" variant="ghost" size="icon-sm" aria-label="Back"
          onClick={() => setView({ kind: 'search' })}>
    <ChevronLeft className="size-4" />
  </Button>
  <span className="truncate text-sm font-medium text-foreground">{view.title}</span>
</div>
```

The generated-UI back row uses the **same container, the same `ghost` `icon-sm` icon-button, the same
`ChevronLeft className="size-4"`**, with the same two label adaptations the Jira detail back row already
made (so all three rows are one design):

```
<div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
  <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to list"
          onClick={goBackToList}>
    <ChevronLeft className="size-4" />
  </Button>
  <span className="truncate text-sm font-medium text-foreground">Back to list</span>
</div>
```

Differences from the native Confluence row and why:

- **The label is the literal `Back to list`**, not the open page's title. The native Confluence row shows
  the *page title* beside its arrow (it has no in-surface title chrome). The generated-UI detail surface
  (`buildPageDetailSurface` → catalog `PageDetail`) **already renders the page title as an `<h2>` at the
  top of the host**, so repeating it in the back row would duplicate it. The spec's required affordance
  copy is "← Back to list" (spec acceptance criterion + FR-006), so the label states the destination
  ("list"), matching the Jira detail back row exactly.
- **`aria-label="Back to list"`** on the icon-button (the native row uses `"Back"`). Same precise copy as
  the Jira detail back row.
- The visible `Back to list` text is **not** a click target — only the `ghost` icon-button (the
  `ChevronLeft`) is the control; the trailing `<span>` is a non-interactive label. Byte-for-byte with
  both the native Confluence row and the Jira detail back row → a single unambiguous focus/click target.
  See §5.1.

This row is `shrink-0` (a non-`flex-1` child of the column; the `border-b border-border px-2 py-1.5`
container gives it a fixed natural height — identical to the native row). It renders **only** when
`detailView.kind === 'detail'` AND `isConnected && !showSpinner` (blanked to just the spinner during a
compose send, parity with the other panels); in the list view it is absent and the generative host sits
under the tab strip exactly as today.

### 1.3 The clickable `SearchResultRow` — interactive shell

Today `SearchResultRow` is a bare `div` with no interactivity (`confluenceCatalog/components.tsx:61-85`):

```
<div className="flex flex-col gap-1 border-b border-border/60 px-3 py-2 last:border-b-0">
  <div className="flex w-full items-center gap-2">
    <span className="… truncate text-sm font-medium text-foreground">{title}</span>
    {space && <Badge variant="outline" className="… text-[10px]">{space}</Badge>}
  </div>
  {excerpt && <span className="line-clamp-2 … text-xs text-muted-foreground">{excerpt}</span>}
</div>
```

The display row body (title, space `Badge`, excerpt) is **unchanged**. What changes is the **shell**: an
*actionable* row (non-empty `id`) is wrapped in a real `<button>` (the Slack `ChannelList` / Jira
`IssueList` precedent — the `<button>` + dispatch live in the **container** `SearchResultList`, which
has the real `surfaceId`/`componentId`, NOT in the display `SearchResultRow`); a *non-actionable* row (no
`id`) is rendered exactly as today with no wrapper. `SearchResultRow` takes a new
`actionable?: boolean` prop that toggles only the cursor + hover lift on its own `div`:

```
// Inside SearchResultList.map, per item — Slack ChannelList / Jira IssueList pattern:

// Actionable (result.id is a non-empty string — isOpenDetailEmittable(result.id)):
<button
  type="button"
  className="w-full text-left transition-colors
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
             focus-visible:ring-inset"
  aria-label={`Open ${result.title ?? 'page'}`}
  onClick={() => dispatch(surfaceId, componentId,
    { name: CONFLUENCE_OPEN_DETAIL_ACTION, context: { pageId: result.id } })}
>
  <SearchResultRow {...result} actionable surfaceId="" componentId="" />
</button>

// Non-actionable (no/empty id):
<SearchResultRow {...result} surfaceId="" componentId="" />   // NO wrapper, NO actionable, NO cursor/hover/ring
```

And inside `SearchResultRow`, the `actionable` prop toggles the affordance on the existing `div`:

```
<div
  className={cn(
    'flex flex-col gap-1 border-b border-border/60 px-3 py-2 last:border-b-0 transition-colors',
    actionable && 'cursor-pointer hover:bg-accent/40'
  )}
> … unchanged row body … </div>
```

Notes:

- The wrapper is a **real `<button>`** (focusable, Enter/Space-activatable for free) — same structure as
  `slackCatalog` `ChannelList`'s row button and `jiraCatalog` `IssueList`'s card button.
- **Focus ring placement.** Unlike the Jira card (a `rounded-xl` card with a gap-separated `<button>`),
  the Confluence rows are a **flush, full-bleed divided list** (`border-b border-border/60`, no per-row
  rounding, no gap). A standard `ring-2` would be clipped at the row's flush edges and overlap the
  divider, reading badly. So the actionable row button uses **`focus-visible:ring-inset`** (the ring
  draws inside the row's box) with `ring-2 ring-ring` — the ring hugs the row's rectangular bounds
  cleanly within the list. The button is **not** rounded (the row is a flush rectangle); do NOT add
  `rounded-*`. This is the one intentional deviation from the Jira card's `rounded-xl` ring, demanded by
  the flush-list layout — and it is consistent within Confluence (its own list is flush). See §6.
- `cursor-pointer` + `hover:bg-accent/40` apply to the **actionable** row only. The non-actionable row
  keeps the default cursor and no hover lift so a no-id row neither looks nor acts clickable (spec edge
  case / FR-002). `hover:bg-accent/40` is the SAME hover the Jira `TicketCard` actionable card uses, so
  hovering a Confluence result and a Jira ticket lifts identically.
- `SearchResultList` decides actionable-vs-not per item via `isOpenDetailEmittable(result.id)` (a
  non-empty, non-whitespace id), mirroring how `IssueList` branches on `issue.issueKey` and `ChannelList`
  on `channel.id`. The plan's `SearchResultList` already maps each `result` to a `SearchResultRow`; the
  per-row actionable branch is added there.

---

## 2. The SearchResultRow states (default / hover / focus / active / inert)

The row has two top-level modes — **actionable** (non-empty `id`) and **non-actionable** (no/empty `id`).
The interaction states apply to the actionable row; the non-actionable row is a single inert state.

### 2.1 Actionable row

| State | Visual treatment |
|---|---|
| **Default (rest)** | The row as today: full-bleed `px-3 py-2`, `border-b border-border/60` divider, title in `--foreground`, space `Badge variant="outline"` (`text-[10px]`), excerpt `line-clamp-2` in `--muted-foreground`. `cursor-pointer` over the whole row. No ring. |
| **Hover** | `hover:bg-accent/40` — the row tints to `--accent` (`#2d2d30`) at 40% over the panel `bg-card` (`#1b1b1c`). `transition-colors` fades it. The only color shift; no border/shadow change (calm against the dark divided list). Identical to the Jira `TicketCard` hover. |
| **Focus (keyboard)** | The wrapping `<button>` shows the cosmos focus ring INSET: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` (`--ring` `#4a4a4c`, 2px) drawn inside the row's rectangular bounds, `focus-visible:outline-none` dropping the UA outline. The row body does not change; the inset ring is the focus signal. (Inset, not corner-hugging, because the list is flush — §1.3.) |
| **Active (pressed)** | Native `<button>` press — no custom `:active` style (Slack/Jira rows add none). The `hover:bg-accent/40` persists during the press; the click immediately drives navigation (the detail read fires), so the press is momentary. No new `active:` token. |
| **"Disabled" / loading** | No per-row disabled state. While the detail read is in flight the **whole active-tab generative region** shows the `SurfaceSpinner` (§3.1) — the list (and its rows) is replaced, so there is no half-pressed row to style. No `disabled` attr on the button (a click is a one-shot navigation, not a re-submittable form). |

### 2.2 Non-actionable row (no/empty `id`)

A single inert state: the row's `div` is rendered exactly as today with **no `<button>` wrapper, no
`actionable` prop, no `cursor-pointer`, no hover lift, no focus ring, no `aria-label`, no tab stop**. It
looks like a read-only result line and is skipped in tab order — it neither looks nor acts clickable
(spec edge case; FR-002). This mirrors `IssueList`'s inert `—` card and `ChannelList`'s plain
no-`id` row.

> Why drop `hover:bg-accent/40` on the non-actionable row: a hover lift on a row that does nothing is a
> false affordance. The hover treatment must read as "this responds to me," so it belongs only to the
> actionable branch. (Build note §6.)

---

## 3. The detail-view surface states (loading / populated / empty-body / error / reconnect)

These are the states of the **active-tab generative content region** (the A2UI host inside
`<A2UIProvider><ActiveTabSurface/>`) once a page row is clicked. **Every populated/error/empty state
reuses an existing Confluence catalog surface — nothing new is drawn.** The back row (§1.2) is present
across all of them *except* the reconnect/Connect case (where the connected body's generative host gives
way to the native Connect affordance).

### 3.1 Loading (the `getPage` read in flight) · FR-008

- **Surface:** the click marks the active tab `loadingDefault: true` via `requestDefaultInActiveTab`, and
  the panel shows the **existing `SurfaceSpinner`** in the content region (the centered `CosmosSpinner` +
  "Generating…" label, `role="status" aria-live="polite" aria-busy`) until the detail surface (or a
  Notice) lands. This is the SAME busy affordance the Confluence panel already shows during an NL compose
  — so a click-to-open load and a compose load look identical.
  - **Gate detail:** Confluence's `showSpinner` today is driven by `surfaceSpinnerVisible(...)` against
    `inFlight` (NOT `loadingDefault`, which Confluence does not pass). The plan marks the detail read
    `loadingDefault`. The interface step must ensure the in-flight detail read shows the existing spinner
    region — either by feeding `loadingDefault` into Confluence's spinner gate for the detail path, or by
    rendering the existing `SurfaceSpinner` whenever the active tab is `loadingDefault`. The **visual** is
    settled: it is the existing `SurfaceSpinner`, NOT a new skeleton. No detail-shaped skeleton is added
    (see §7 OQ-A). The developer picks the minimal wiring that shows that existing spinner while the
    detail read is outstanding.
- **Back row:** present (`detailView.kind === 'detail'` is set the moment the click is intercepted,
  before the read resolves), so the user can abandon the load and go back. (Suppressed only while
  `showSpinner` blanks the panel to just the spinner — but the moment the surface lands it returns; if
  the developer renders the spinner via `loadingDefault` rather than `inFlight`, keep the back row up
  during the load so the user is never stranded. Settle in interface; behaviorally the back row must be
  reachable whenever a detail is open.)
- **a11y:** the `SurfaceSpinner` is `role="status"` + `aria-live="polite"` + `aria-busy="true"` with its
  "Generating…" label as the accessible name (existing).

### 3.2 Populated (the detail landed) · FR-005, SC-001

- **Surface:** `buildPageDetailSurface(detail)` fills the host with the **existing Confluence catalog
  `PageDetail`** (`confluenceCatalog/components.tsx:188`): the page **title** as an `<h2>` (`text-base
  font-medium leading-snug text-foreground`), the **space** as a `Badge variant="outline"` (`text-[10px]`)
  when present, and the **body** as plain pre-wrapped text (`whitespace-pre-wrap break-words text-sm
  leading-relaxed text-card-foreground`). Static props (no `{path}` binding — a one-shot read). This is
  the SAME `PageDetail` visual the generative adapter already uses and is visually parallel to the native
  base's page detail (same `<h2>` + space `Badge` + pre-wrapped body) — so the generated and native page
  details read as one.
- **Back row:** present above it.

### 3.3 Empty body (the page has no readable body) · spec edge case, SC-001

- **Surface:** when `getPage` returns `ok` but `detail.body` is empty/whitespace, the catalog
  `PageDetail` renders its **existing** empty-body line: `"This page has no readable body."` in
  `text-sm text-muted-foreground`, beneath the title + space `Badge`. This is **NOT** an error — no
  `Notice`, no destructive tone; the title/space chrome stays. (`hasReadableBody(bodyText)` already
  branches this in the catalog component.) Confirmed: styled as a calm muted note, identical to the
  native base's same empty-body line.
- **Back row:** present.

### 3.4 Error (recoverable, non-reconnect) · FR-009, SC-005

- **Trigger:** a non-`reconnect_needed` failure of `getPage` (`network`, `rate_limited`, or a thrown
  error).
- **Surface:** a single calm, recoverable **`Notice` surface** via
  `buildConfluenceNoticeSurface({ kind: 'error', message })` — the **existing** Confluence catalog
  `Notice` (`confluenceCatalog/components.tsx:236`): an `Alert variant="destructive"` with `TriangleAlert`
  in `--destructive`, `border-destructive/40 bg-destructive/15`, `role="alert"` via the Alert primitive,
  message in `text-destructive`. Never a raw stack trace, never the panel-level "Could not render this
  surface" red bar (that is for A2UI render failures, not read failures). This is the same destructive
  Notice the Slack/Confluence generative lists already use for recoverable read errors — calm and
  consistent.
- **Back row:** present — the user reads the Notice, clicks **Back to list**, and is back on a valid list
  to retry (spec: "I can go back to the list and retry").

### 3.5 Reconnect / Connect (token rejected mid-click) · FR-010, SC-005

- **Trigger:** `getPage` fails with `reconnect_needed` / `not_connected`.
- **Surface:** main pushes **NO surface** (FR-010). `ConfluenceManager`'s `confluence:statusChanged`
  flips the panel's `status` so `ConfluencePanel` renders its existing **native Connect/Reconnect
  affordance** (the `BookText`-area Connect CTA + `ConnectForm`), and the connected generative body
  (including the back row) gives way to it. No new design — the established connection-gating behavior
  shared with every Confluence read.
- **Back row:** absent (the connected generative body is gone). On reconnect the panel returns to its
  base, `detailView` resets to `{ kind: 'list' }`.

---

## 4. Interaction & accessibility

### 4.1 Focus order (top-to-bottom DOM order = tab order)

Within the connected body when a generated-UI detail is open:

1. `PanelTabStrip` controls (tab buttons, close `X`, trailing `+`, the `PanelRefreshButton`).
2. The **`Back to list` `Button`** (the new back row — the `ghost` icon-button is the only focusable
   element in the row; its label span is not a tab stop).
3. The **A2UI detail surface** focusables — for a `PageDetail` there are **none** (it is display-only:
   title, space badge, body text), so focus passes straight through to the composer.
4. The NL `PromptComposer` `Textarea`, then its `Send` button (bottom).

Within the **list** view (no detail open), the order is: tab strip → each **actionable
`SearchResultRow` button** (in list order; non-actionable no-id rows are skipped) → the
`LoadMoreButton` (when present) → composer. So the natural keyboard path is "tab to a result → Enter to
open → tab to Back to list → Enter to return," exactly the spec's row → detail → back-row → list loop.

> The back row sits **above** the detail host in DOM order, so on a fresh detail open it is reached
> first — this matches both the native Confluence page-detail view (its back arrow is the first
> focusable) and the Jira detail back row. A user opening a detail can Tab once to "Back to list" without
> traversing the (display-only) detail. Consistent across all three drill-ins.

### 4.2 Keyboard paths

- **Open a page:** Tab to an actionable `SearchResultRow` (a real `<button>`) → **Enter or Space**
  activates it (native button semantics) → `CONFLUENCE_OPEN_DETAIL_ACTION` is emitted and the detail
  opens in place. No custom key handler — the real `<button>` gives Enter/Space for free.
- **Return to the list:** Tab to the **Back to list** `Button` → **Enter or Space** → `detailView`
  returns to `{ kind: 'list' }` and the originating list is restored (verbatim for a composed origin) or
  the base view returns (FR-007).
- **Non-actionable row:** not in tab order, not activatable — there is nothing to open.

### 4.3 ARIA / labels

- Actionable row `<button>`: `aria-label={`Open ${result.title ?? 'page'}`}` (e.g. "Open Release
  Notes") — a concise accessible identity up front; the visible row content (title, space, excerpt) is
  read after. Mirrors `ChannelList`'s `aria-label={`Open #${name}`}` and `IssueList`'s
  `aria-label={`Open ${issueKey}`}`. (The page title is the human-recognizable label here — Confluence
  rows have no short stable key like a Jira issue key, so the title is the right accessible name.)
- Non-actionable row: no `aria-label`, no `role`, not a button — announced as plain row content only.
- Back-to-list icon-button: `aria-label="Back to list"` (the icon alone is not a text label). The visible
  `Back to list` span is decorative reinforcement, not separately focusable. Matches the native
  Confluence row's `aria-label="Back"` pattern (more precise copy).
- The in-flight `SurfaceSpinner` is `role="status" aria-live="polite" aria-busy="true"` (existing). The
  error `Notice` carries `role="alert"` via the `Alert` primitive (existing).

### 4.4 Contrast (dark palette)

- **Row hover:** `--accent` `#2d2d30` at 40% over `bg-card` `#1b1b1c` — a subtle but perceptible lift on
  the dark divided list; the same hover the Jira cards and other lists use, validated live. Row title
  stays `--foreground` `#e0e0e0` (full contrast); excerpt `--muted-foreground` `#888888` (intentionally
  secondary).
- **Row focus ring:** `--ring` `#4a4a4c`, 2px (`ring-2`), drawn **inset** so it stays within the flush
  row and clear of the `border-border/60` divider — the same focus token every focusable cosmos control
  uses, legible against `bg-card`.
- **Back row:** `--border` `#333333` bottom divider (same as the native back row and every panel
  divider); the `ghost` icon-button hover is `--accent`, its `ChevronLeft` + the `Back to list` label are
  `--foreground` `#e0e0e0`. All AA-legible on the `bg-card` chrome.
- **Detail surface:** title `--foreground`, body `--card-foreground`, space `Badge` outline tone — all
  existing `PageDetail` tones, unchanged. Error `Notice`: `--destructive` text/glyph on
  `bg-destructive/15` — the existing destructive Alert contrast.

---

## 5. Interaction details settled

### 5.1 Is the back-row label clickable?

**No.** Only the `ghost` icon-button (the `ChevronLeft`) is the control; the `Back to list` span is a
non-interactive label. Byte-for-byte with both the native Confluence row and the Jira detail back row →
a single unambiguous focus/click target. (Do NOT widen the hit area to the whole row — the precedent is
icon-button-only.)

### 5.2 Does the NL composer stay visible while a detail is open?

**Yes** — the `PromptComposer` is bottom-docked whenever connected, in both list and detail views,
unchanged. A user can ask a follow-up about the open page; that is a compose, handled by the existing
flow. No new behavior.

### 5.3 Active/pressed treatment

No custom `:active` style — the native `<button>` press plus the persistent `hover:bg-accent/40` is the
press feedback, and the click resolves immediately into a navigation (the spinner replaces the list).
Avoids a new `active:` token for a momentary state. (Slack/Jira clickable rows add none.)

### 5.4 Back restores the composed list verbatim (OQ-1)

"Back to list" restores the generated list the detail was opened from. For a `composed` origin it
re-files the snapshotted surface into the active tab verbatim (no re-fetch, no spinner flash); a BOUND
(refreshable) origin is restored `restored: true` so its refresh re-kicks (plan OQ-1). For a `base`
origin (or no captured origin) it returns to the native base view — never a dead end. This is a
behavioral/plan concern; visually it means clicking Back either re-shows the exact generated list (no
loading flash) or returns to the native base — both land in the existing list visuals, no new state.

---

## 6. Consistency notes & build flags (stay on-system)

- **The clickable row = the Slack `ChannelList` / Jira `IssueList` clickable-row pattern.** A real
  `<button>` wrapper around the unchanged display row, with a non-interactive fallback for the no-id case
  — identical in spirit to both. A user who clicks a Slack channel, a Jira ticket, and a Confluence page
  gets the same focus ring and the same "real button, keyboard-native" behavior. The ONE intentional
  deviation is the focus ring is **inset** (not corner-hugging), because the Confluence list is a flush
  divided list rather than rounded gap-separated cards — see §1.3. This keeps the ring clean within
  Confluence's own list and is the correct treatment for a flush list.
- **The back row = the existing Confluence native back row.** Same container
  (`flex items-center gap-1.5 border-b border-border px-2 py-1.5`), same `ghost` `icon-sm` `Button`, same
  `ChevronLeft className="size-4"`. Only the copy differs (`Back to list` vs. the page title) — matching
  the Jira detail back row exactly.
- **The detail / error / empty-body surfaces = the existing Confluence catalog `PageDetail` / `Notice`.**
  No new catalog component; `buildPageDetailSurface` / `buildConfluenceNoticeSurface` (main, plan Phase 3)
  emit the EXISTING component vocabulary. The empty-body state is the catalog `PageDetail`'s own
  `"This page has no readable body."` line — a calm muted note, NOT an error.
- **The loading state = the existing `SurfaceSpinner`.** No detail-shaped skeleton (§7 OQ-A).
- **No new token, no new `components/ui/` component, no `components.json` change.** Fully expressible in
  `Button` (`variant="ghost" size="icon-sm"`), a native `<button>` wrapper, the existing catalog
  `SearchResultRow` / `PageDetail` / `Notice`, `SurfaceSpinner`, the `ChevronLeft` lucide icon (already
  imported in `ConfluencePanel.tsx`), and existing tokens (`--accent`, `--ring`, `--border`,
  `--foreground`, `--muted-foreground`, `--card-foreground`, `--destructive`). **The design system is
  NOT extended.**

### Build flags for the developer (designer has no Bash — but nothing to install here)

- **No package install, no shadcn-CLI run.** `Button`, the `Alert`/`Badge`/`Card` primitives, and the
  `ChevronLeft` lucide icon all already exist; `ChevronLeft` is already imported in `ConfluencePanel.tsx`.
- **`SearchResultRow` (confluenceCatalog/components.tsx):** add an `actionable?: boolean` prop that gates
  `cursor-pointer hover:bg-accent/40 transition-colors` on the row's `div` (via `cn(...)`). The display
  body (title/space/excerpt) is unchanged. `transition-colors` must be on the `div` so the hover fades.
- **`SearchResultList` (confluenceCatalog/components.tsx):** per item, branch on
  `isOpenDetailEmittable(result.id)`. Actionable → wrap the `SearchResultRow` in a real `<button>`
  (`type="button" w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-ring focus-visible:ring-inset`, `aria-label={`Open ${result.title ?? 'page'}`}`,
  `onClick` dispatches `CONFLUENCE_OPEN_DETAIL_ACTION` with `context: { pageId: result.id }`) and pass
  `actionable` to the row. Non-actionable → render the `SearchResultRow` bare (no wrapper, no
  `actionable`). Do **not** add `rounded-*` to the button (the row is a flush rectangle; the inset ring
  hugs its bounds).
- **Back row (ConfluencePanel.tsx):** add the `border-b border-border px-2 py-1.5` row with the `ghost`
  `icon-sm` `Button` + `ChevronLeft` + `Back to list` label, rendered only when
  `detailView.kind === 'detail'` (AND connected, not blanked by `showSpinner`), above the generative
  content region. Wire its `onClick` to the plan's `goBackToList`. Keep it SEPARATE from the native-base
  `view.kind === 'page'` back row (they never co-render — §1.1).
- **Loading wiring (ConfluencePanel.tsx):** ensure the existing `SurfaceSpinner` shows while the detail
  `getPage` read is outstanding (the `loadingDefault` the click sets) — see §3.1; no new spinner/skeleton.

---

## 7. Open questions

- **OQ-A (noted, NOT blocking) — no detail-shaped skeleton for the loading state.** The in-flight state
  reuses the existing `SurfaceSpinner` (the centered "Generating…" spinner Confluence already shows for a
  compose), NOT a detail-shaped skeleton like the native `PageDetailSkeleton`. Confluence's generative
  path has no `loadingDefault` skeleton today (unlike Jira's `DefaultViewSkeleton`); adding a
  detail-shaped skeleton would be net-new loading chrome the spec does not ask for (FR-008 = "the existing
  per-tab loading indication"). **Resolution:** ship the existing `SurfaceSpinner` — consistent with how
  Confluence already signals "busy" during a compose, so a click-load and a compose-load look identical.
  If a detail-shaped shimmer is later wanted, it is a follow-up (a new skeleton + a read-kind on the
  loading state) — a spec/plan change, not this design's call.

- **OQ-B (noted, NOT blocking) — exact mechanism that shows the spinner during the detail read.**
  Confluence's `showSpinner` gate is driven by `inFlight` (it does not consume `loadingDefault`). The
  detail click sets `loadingDefault`. The **visual** is settled (the existing `SurfaceSpinner`), but the
  precise wiring (feed `loadingDefault` into the gate vs. render `SurfaceSpinner` on `loadingDefault`
  directly, and keep the back row reachable during the load) is an interface/how detail for the
  developer, noted in §3.1. Not blocking — any wiring that shows the existing spinner while the read is
  outstanding and keeps the back row reachable satisfies the design.

No blocking open questions. Every surface, state, token, and affordance is resolved against the approved
spec/plan and the existing Slack + Jira + Confluence patterns. The design system is not extended; the one
deviation from the Jira card (inset focus ring) is demanded by Confluence's flush divided list and is
consistent within Confluence.
