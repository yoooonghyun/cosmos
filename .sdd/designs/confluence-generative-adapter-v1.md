# Design: Confluence Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Spec**: .sdd/specs/confluence-generative-adapter-v1.md
**Plan**: .sdd/plans/confluence-generative-adapter-v1.md
**Owner**: designer
**Reuses**: .sdd/designs/jira-generative-adapter-v1.md (shared adapter controls + state model),
.sdd/designs/slack-generative-adapter-v1.md (append-only, read-only sibling — closest analogue)

---

## Grounding (queries actually run)

- Read `src/renderer/catalogShared/controls.tsx` — the SHARED, already-BUILT controls Confluence
  reuses verbatim: `RefreshButton` (ghost `icon-sm`, `RotateCw`↔`Loader2 animate-spin`, emits
  `adapter.refresh`), `LoadMoreButton` (outline `sm`, centered `flex justify-center pt-1`, renders
  **null** when `hasMore=false`, emits `adapter.loadMore`), `PaginationBar` (NOT used here), and the
  `useBound<T>`/`Bound<T>`/`Bind` binding helpers. **Takeaway:** every control + binding hook
  Confluence needs already exists as one source — Confluence adds zero new control.
- Read `src/renderer/confluenceCatalog/{components.tsx,logic.ts,index.ts}` — current display-only
  `SearchResultRow`/`SearchResultList`, `PageDetail`, `Notice`, `Text` (literal `results`/props, no
  `useDataBinding`/`useDispatchAction`; the file header says "no action in v1"). `logic.ts` has only
  `countLabel`/`hasReadableBody`. **Takeaway:** these are the surfaces to re-point at bound data —
  Confluence has NO default-feed list component yet (the feed reuses `SearchResultList`).
- Read `src/renderer/slackCatalog/{components.tsx,logic.ts}` — the BUILT bound-list pattern
  Confluence mirrors: `useBound` rows + `useDataBinding` for `loading`/`error`, `boundRows`,
  `showEmptyState`/`showErrorNotice` gating, a `BoundListError` `Notice`-above-kept-rows shell, a
  `justify-between` header (count `aria-live` + `RefreshButton`), tail `LoadMoreButton`, `aria-busy`
  on the container. **Takeaway:** Confluence's two lists are a 1:1 port of this, minus avatars/
  `UserChip`/`formatTs` (Confluence rows are title/space/excerpt — no user-id, no timestamp).
- Read `src/renderer/index.css` — full token set (`--card #1b1b1c`, `--muted-foreground #888`,
  `--destructive #f3b0b0`, `--border #333`, `--ring`, `--accent`). **Takeaway: no new token** —
  exactly as Jira and Slack found.
- `memory_smart_search` — n/a beyond the Jira/Slack-cycle findings already recorded; this design is
  grounded directly from the live system + the two shipped sibling designs.

**Key takeaway:** Confluence is the **append-only, read-only** sibling — visually identical to Slack
for its two lists, **plus** it owns a refresh-only **detail** surface (page detail) that Slack
lacked but Jira's issue-detail already proved. So this design = Slack's list deltas **+** Jira's
detail-refresh delta, expressed entirely in the shared controls + existing tokens. The single
genuine difference from Slack: the bound `PageDetail` (`pagination:'none'`, refresh-only, no
load-more). No new token, no new control, no `PaginationBar`.

---

## 1. Scope of this design — the deltas vs. Slack/Jira

This feature moves the Confluence generative surfaces from static-prop composition to **bound, live,
refreshable, paginated** data. Visually it reuses the Slack design wholesale for the two lists and
the Jira detail-refresh pattern for the one detail. The deltas are:

1. **Append only (both lists).** Confluence's only paging cursor is the opaque, forward-only
   `_links.next` value (`cursorFromNextLink` → `nextCursor`); there is no backward `_links.prev` and
   no offset/`start` cursor exposed (FR-011). So the **default-feed list** and the **search (CQL)
   results list** each get a **header `RefreshButton`** + a **tail `LoadMoreButton`**, and **never** a
   `PaginationBar` / prev-next. `hasPrev` is unused; no surface emits `adapter.page`.
2. **A refresh-only detail.** The **page-detail** surface (single `ConfluencePageDetail`) registers
   `pagination:'none'` — refresh-only, **no** load-more, **no** count header. This is the one shape
   Slack didn't have; it mirrors Jira's issue-detail-refresh (a header `RefreshButton`, bound
   `{path}` props, `aria-busy` on the root while loading, recoverable `Notice` above stale detail).
3. **Read-only.** No write controls, no Jira write-reconciliation notice, no
   `TransitionPicker`/`AddComment` analog. The only actions any Confluence surface emits are the
   reserved `adapter.refresh` / `adapter.loadMore`. Page creation is a SEPARATE existing feature
   (`confluence-create-page-v1`) — out of scope, untouched (FR-017).
4. **The default feed reuses `SearchResultList`.** Confluence has no separate feed-list component —
   the default activity feed and the CQL search results are both `ConfluencePage<ConfluenceSearchResult>`
   lists of the same row shape (`SearchResultRow`: title · space Badge · excerpt). So the **bound
   `SearchResultList` backs BOTH** the default feed and search results (the builder seeds each with
   its own bound paths + its own descriptor). No new list component.

Because these surfaces are A2UI-catalog-rendered, each control maps to a **catalog component** — but
Jira built `RefreshButton`/`LoadMoreButton` and Slack already extracted them to
`catalogShared/controls.tsx`; Confluence imports the **same** components verbatim and re-points its
list + detail at bound data (flagged in §6).

Surfaces touched: Confluence **default feed** (bound `SearchResultList`), **search/CQL results**
(bound `SearchResultList`), **page detail** (bound `PageDetail`). All inside the existing Confluence
panel chrome (`ConfluencePanel.tsx`), which is structurally unchanged.

---

## 2. Surfaces & layout

The Confluence panel chrome is unchanged in structure: its existing tab strip / connection state /
scrollable content region hosts the active tab's A2UI surface. This design adds, **inside each bound
list surface**, a header row (count + refresh) and a tail footer (load-more) — identical placement to
Slack's bound lists, minus pagination-bar — and, **inside the bound detail surface**, a header
refresh control (mirroring Jira's detail).

### 2.1 Default-feed surface (bound `SearchResultList`) — append-paginated

```
┌─────────────────────────────────────────────────┐
│  12 results                         (refresh ⟳)  │  ← header row (§4): count (bound, aria-live) + RefreshButton
├─────────────────────────────────────────────────┤
│  [SearchResultRow]  title · SPACE · excerpt      │
│  [SearchResultRow]                               │  ← TemplateBinding rows over the bound list path
│  [SearchResultRow]                               │
├─────────────────────────────────────────────────┤
│              ‹ Load more ›                        │  ← §5 LoadMoreButton (append); absent when hasMore=false
└─────────────────────────────────────────────────┘
```

- **Header row** is the existing `SearchResultList` count line (`px-3 py-2`, `text-xs
  text-muted-foreground`, `aria-live="polite"`, `components.tsx:82`) wrapped in `flex items-center
  justify-between gap-2`: the bound count on the left, the `RefreshButton` on the right (trailing
  edge, vertically centered). Verbatim the Slack `SearchResultList` header (`components.tsx:353`).
- **Rows** stay the existing `SearchResultRow` stack — `flex flex-col` of rows with their `border-b
  border-border/60 last:border-b-0` dividers, **visually unchanged** (title · optional `space`
  outline Badge · 2-line-clamped excerpt). Only the data source changes: literal `results` prop → a
  `Bound<SearchResultRowNode[]>` (`{path}`) read via `useBound`.
- **Footer** holds the `LoadMoreButton` as the list's last child (append only — never a
  `PaginationBar`). Centered `flex justify-center pt-1` (its own built-in wrapper). Renders **null**
  when `hasMore=false`, so the last row's `last:border-b-0` remains the visual terminus.

### 2.2 Search (CQL) results surface (bound `SearchResultList`) — append-paginated

**Same component, same three-region structure as §2.1.** Default feed and search results share the
bound `SearchResultList`; they differ only in which descriptor + bound paths the builder seeds (feed
= `confluenceFeedDescriptor`, search = `confluenceSearchDescriptor`). Row shape, count header,
`RefreshButton`, tail `LoadMoreButton`, empty/error/refresh states — all identical. The `space`
outline Badge and excerpt treatment are unchanged.

### 2.3 Page-detail surface (bound `PageDetail`) — refresh-only, no pagination

```
┌─────────────────────────────────────────────────┐
│  Page Title                         (refresh ⟳)  │  ← header: bound title (left) + RefreshButton (right)
│  SPACE                                           │  ← bound space outline Badge
├─────────────────────────────────────────────────┤
│  …bound page body (whitespace-pre-wrap)…         │  ← bound body, or "This page has no readable body."
└─────────────────────────────────────────────────┘
```

- **Header.** The existing `PageDetail` title block (`<h2 text-base font-medium>` + space Badge,
  `components.tsx:106–114`) gains a trailing `RefreshButton`. Mirror Jira's detail: wrap the title
  `<h2>` and the `RefreshButton` in a `flex items-center justify-between gap-2` row so refresh sits
  at the header's trailing edge, vertically centered with the title (the space Badge stays on its own
  line below, unchanged). This keeps refresh discoverable without adding a panel-chrome row.
- **Body + props bound.** `title`, `space`, `body` move from literal props to `Bound<string>`
  (`{path}`) read via `useBound`; the `hasReadableBody` empty-body line ("This page has no readable
  body.") is preserved, now reading the bound body.
- **No footer.** `pagination:'none'` → no `LoadMoreButton`, no `PaginationBar`, no count line.
- **`aria-busy={loading}`** on the detail root `div` while a refresh is in flight (no skeleton
  flash — keep the stale detail visible).

---

## 3. The five states (per region) — including in-place refresh / last-page / fetch-error /
detail-refresh

The load model is identical to Slack/Jira: the **view is composed once**, then data is pushed in
place via `updateDataModel` (no view re-compose). So each region distinguishes *first paint* from
*refreshing existing data* from *error*. The bound `loading` flag + presence/absence of prior
rows/value disambiguate them.

### 3.1 The two bound lists (default feed + search results) — `SearchResultList`

This is Slack's §3 state model verbatim, with Confluence's existing empty copy ("No content
matches."). It applies uniformly to the feed and the search-results uses of `SearchResultList`.

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (first paint)** | Surface composed, no data seeded / restore refetch with no prior rows | Panel-owned first-paint chrome (the existing Confluence panel loading state, unchanged — the A2UI list is not yet mounted). A freshly composed surface seeds its own data model and renders populated immediately (FR-003/FR-016), so this is the relaunch-restore case only. **Not a catalog state.** |
| **Refreshing existing data** | `loading=true` while a populated list is on screen (refresh OR load-more in flight) | **Keep the current rows visible — no skeleton flash, no layout shift.** Show busyness on the active control only: the `RefreshButton` swaps `RotateCw`→`Loader2 animate-spin` + `disabled`; the `LoadMoreButton` shows its inline `Loader2` + "Loading…" + `disabled`. The count stays put until new data lands, then updates (`aria-live` announces e.g. "12 results" → "24 results"). `aria-busy={loading}` on the list container. This is the in-place state the data model makes possible — identical to Slack/Jira. |
| **Empty (populated, zero items)** | Bound list resolves to `[]` and not loading (e.g. a personal feed with no mentions/watches/favorites, or a CQL search with no hits) | The existing Confluence empty block, unchanged: `<p className="px-3 py-6 text-center text-sm text-muted-foreground">No content matches.</p>` (`components.tsx:77`). The `LoadMoreButton` is absent (no `nextCursor`). To keep the re-fetch affordance reachable on an empty feed, the header (count + refresh) still renders above the empty line (mirror Slack's `aria-busy` empty wrapper — the empty `<p>` carries `aria-busy={isLoading}`). |
| **Populated** | Bound list has items, not loading | Header row (count + refresh) + `TemplateBinding` rows + tail `LoadMoreButton` (when `hasMore`). Today's row look, now bound. |
| **Error (recoverable)** | A refresh/load-more fetch failed (`network` / `rate_limited` / stale opaque cursor / forbidden) | A `Notice`-style destructive `Alert` rendered **ABOVE the existing rows** — prior data is NOT cleared (spec edge "prior data is not corrupted"). Reuse Slack's `BoundListError` shell (a destructive `Alert` + `TriangleAlert` + `border-destructive/40 bg-destructive/15`, byte-identical to the existing Confluence `Notice` error treatment) — **no change to `Notice`, no new `noticeKind`**; the existing `error` kind covers network/rate-limit/stale-cursor/forbidden. `loading` clears, so the active control returns to its idle (re-tryable) state. **`reconnect_needed`/`not_connected` do NOT render here** — they route to the native Confluence Connect/Reconnect affordance (existing panel behavior, spec edge), not a broken surface. An empty list WITH an error shows the `Notice` instead of the empty state (`showEmptyState` returns false when an error is present). |
| **Disabled** | `hasMore=false` | The `LoadMoreButton` renders nothing (the end is implicit) — not a surface-wide state. The `RefreshButton` is disabled only while `loading=true`. Confluence has no prev control to disable (append-only). |

### 3.2 The bound detail (`PageDetail`) — refresh-only

This is Jira's §3.2 issue-detail state model, mapped onto the single Confluence page.

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (first paint)** | Detail composed, no data seeded / restore refetch with no prior value | Panel-owned first-paint chrome (the existing Confluence panel loading state) — the A2UI detail is not yet mounted. **Not a catalog state.** A freshly composed detail seeds its own value and renders populated (FR-003). |
| **Refreshing existing data** | `loading=true` over a populated detail | **Keep the detail visible** (no skeleton flash). The header `RefreshButton` spins (`RotateCw`→`Loader2 animate-spin` + `disabled`). `aria-busy={loading}` on the detail root `div`. Title/space/body stay put until the fresh value lands. |
| **Empty** | Bound body is blank/whitespace-only | The existing per-field placeholder, now bound: `hasReadableBody(body)` false → muted "This page has no readable body." (`components.tsx:121`). Title/space render whatever the bound value carries (possibly empty strings, as today). |
| **Populated** | Detail value present | The existing detail layout, now bound (title `<h2>` + space Badge + body `whitespace-pre-wrap`). |
| **Error (recoverable)** | A refresh whose descriptor points at a now-gone/forbidden page fails (the read fails) | A `Notice`-style destructive `Alert` rendered as the **FIRST child** of the detail `div`, ABOVE the stale detail (prior value NOT cleared). Same destructive `Alert`/`TriangleAlert` treatment as the lists. `loading` clears → refresh returns to idle (re-tryable). `reconnect_needed`/`not_connected` route to the native Connect/Reconnect, not here. |
| **Disabled** | n/a (no pagination, no write) | The detail has no pagination control to disable; `RefreshButton` is disabled only while `loading=true`. |

> The detail's bound `error` path is the SAME shape the lists use (a bound `error` string → render
> the destructive `Alert` above un-corrupted prior content) — confirm the resolver's `ok:false`
> recoverable result flows into it (resolver detail, owned by developer; the visual contract here is
> "recoverable notice above un-corrupted prior content, `loading` cleared").

---

## 4. Refresh control — reuse `RefreshButton` verbatim

**Reuse the shipped shared `RefreshButton`** (`catalogShared/controls.tsx:63`). No redesign. It is a
`Button variant="ghost" size="icon-sm"` with a lucide `RotateCw size-4 text-muted-foreground` (hover
→ `text-foreground`), `aria-label="Refresh"`. Idle = `RotateCw`. Loading (bound `loading=true`) =
`Loader2 size-4 animate-spin` + `disabled` + `aria-busy="true"` (can't re-fire mid-fetch). It emits
the reserved `AdapterAction.Refresh` (`adapter.refresh`) via `useDispatchAction` carrying
`{ surfaceId }`.

Placement:
- **Lists** (feed, search) → the **header row trailing edge** (§2.1/§2.2), `justify-between` with the
  bound count.
- **Detail** (page) → the **title header row trailing item** (§2.3), `justify-between` with the bound
  title `<h2>` (the Jira-detail placement — refresh sits with the title, not in a separate chrome
  row).

---

## 5. Load-more control — reuse `LoadMoreButton` verbatim; NO `PaginationBar`

**Reuse the shipped shared `LoadMoreButton`** (`catalogShared/controls.tsx:101`). No redesign. It is
a `Button variant="outline" size="sm"` centered in its own `flex justify-center pt-1` footer, text
"Load more". `outline` keeps it a quiet, repeatable secondary action (and on read-only Confluence
there are no `default` write buttons to compete with). Idle (`hasMore=true`, `loading=false`) =
"Load more". Loading = leading `Loader2 size-3.5 animate-spin` + "Loading…" + `disabled` +
`aria-busy`. Exhausted (`hasMore=false`) = **renders nothing** (the list end is implicit; an empty
append left the list unchanged + set `hasMore=false`, per spec edge). Emits the reserved
`AdapterAction.LoadMore` (`adapter.loadMore`) carrying `{ surfaceId }`.

`hasMore` binds to the presence of the page's `nextCursor` (i.e. `_links.next` present, FR-012); when
a page returns no `nextCursor`, `hasMore=false` and the button vanishes.

**`PaginationBar` is NOT used by any Confluence surface (FR-011/FR-013).** Confluence's cursor is
forward-only + opaque; a backward page is unfetchable. No Confluence surface emits `adapter.page`;
`hasPrev` is never bound. The footer of each Confluence list is a single slot holding **only** the
`LoadMoreButton` (or nothing). The page-detail surface (`pagination:'none'`) has **no** footer slot at
all.

---

## 6. Catalog components — reuse + the bound variants the developer builds

Confluence adds **no new visual control** and **no new shadcn primitive**. It imports the shared
`RefreshButton`/`LoadMoreButton`/`useBound`/`Bound` from `catalogShared/controls.tsx` verbatim
(exactly as the Slack catalog does, `slackCatalog/components.tsx:30`). The remaining work is
re-pointing the existing Confluence catalog components at bound data + the two shared controls. These
are **changes to existing components**, registered in `confluenceCatalog/index.ts` — each a thin
re-point, no new token, no new primitive.

| Confluence catalog component | Change | Bindings it reads | Notes |
|------------------------------|--------|-------------------|-------|
| **`SearchResultList`** (backs BOTH default feed + search results) | `results` prop becomes `Bound<SearchResultRowNode[]>` (`{path}`), read via `useBound`; wrap its existing count line + a `RefreshButton` in `flex items-center justify-between gap-2`; gain a tail `LoadMoreButton`; container gets `aria-busy={loading}`; gain a bound `error` → destructive `Alert` above kept rows. Empty/refresh/error states per §3.1. | `results` (list path), `loading` (`DynamicBoolean`) → spinner+disabled+`aria-busy`, `hasMore` → load-more render/omit, `error` (bound string) → `Notice`. | Mirror the bound Slack `SearchResultList` EXACTLY. `SearchResultRow` unchanged. The builder seeds different bound paths + descriptor for the feed vs. search use, but it is ONE component. |
| **`PageDetail`** | `title`/`space`/`body` props become `Bound<string>` (`{path}`), read via `useBound`; wrap the title `<h2>` + a `RefreshButton` in `flex items-center justify-between gap-2`; gain `aria-busy={loading}` on the root; gain a bound `error` → destructive `Alert` as the first child. NO load-more (`pagination:'none'`). States per §3.2. | `title`/`space`/`body` (bound strings), `loading` → refresh spinner + `aria-busy`, `error` → `Notice`. | The one shape Slack lacked; mirrors Jira's bound issue-detail (refresh-only). `hasReadableBody` empty-body line preserved, now bound. |
| **`SearchResultRow`** | **Unchanged.** Row shape (title · space Badge · excerpt) not touched (FR-002/FR-004). | — | — |
| **`Notice`** | **Unchanged.** Reused (and its destructive treatment re-used inline as the recoverable-error `Alert` above rows/detail, §3). No new `noticeKind`. | — | Existing `error`/`info` kinds suffice. |
| **`Text`** | **Unchanged.** | — | — |

### 6.1 Registration (flag to developer)

Register the **shared** `RefreshButton` + `LoadMoreButton` under those type names in
`confluenceCatalog/index.ts` (import from `catalogShared/controls.tsx`, exactly as the Slack catalog
does), so the `render_confluence_ui` tool can advertise them and the builder can emit them into a
surface. **Do NOT register `PaginationBar`** in the Confluence catalog (append-only). There must be
**exactly one** definition of each shared control (it already lives in `catalogShared/controls.tsx` —
import, do not copy). No new module, no Bash/install needed.

### 6.2 `logic.ts` helpers (flag to developer)

The bound `SearchResultList`/`PageDetail` need the same pure display-gating helpers the Slack catalog
already has: `boundRows`, `showErrorNotice`, `showEmptyState`. Confluence's `logic.ts` currently has
only `countLabel`/`hasReadableBody`. **Add `boundRows`/`showErrorNotice`/`showEmptyState` to
`confluenceCatalog/logic.ts`** (copy the Slack signatures verbatim — they are integration-agnostic
pure functions) so the `.tsx` shells stay thin and the gating is node-testable per the `.ts`/`.test.ts`
split. (These are pure helpers, not visual controls — duplicating the tiny pure functions per-catalog
is the existing convention; `countLabel` already lives in both Slack and Confluence `logic.ts`.)

> Action-wiring (how `loading`/`hasMore`/`error` paths are seeded by the builder, the reserved
> `adapter.*` interception, the descriptor each surface carries) is the developer's interface/impl
> concern — this design fixes the visual contract + which binding each control reads.

---

## 7. Tokens used

**No new tokens, no changed tokens** — identical to Jira's §7 and Slack's §7. Everything resolves to
the existing cosmos dark palette:

- Rows / detail body: `--card-foreground` (`SearchResultRow`/`PageDetail` body text via
  `text-card-foreground`), `--foreground` (title), `--background`.
- Muted text (count, empty copy, excerpt, "no readable body"): `--muted-foreground #888`.
- Ghost / outline controls (`RefreshButton` ghost, `LoadMoreButton` outline): `--accent` (ghost
  hover), `--border #333` (outline), `--ring` (focus-visible).
- Row dividers: `border-border/60` (existing `SearchResultRow` treatment).
- Error notice: `--destructive #f3b0b0` via the destructive `Alert` (`border-destructive/40
  bg-destructive/15`) — the existing Confluence `Notice` error treatment, reused inline above rows/
  detail.
- `space` Badge: existing `outline` Badge variant — unchanged.
- Spinner: `Loader2` inherits `currentColor` (the shipped inline-busy pattern).

No Atlassian brand color, no raw hex — consistent with the existing Confluence catalog file header's
"cosmos palette only" rule. If any of these proves insufficient at build time the developer surfaces
it back here — no one-off color.

---

## 8. Interaction & accessibility

**Focus order (each bound list surface):** `RefreshButton` (header) → rows (non-interactive
`SearchResultRow`s — Confluence list rows carry no per-row action, so they are skipped) → tail
`LoadMoreButton`. Refresh first (top of surface), load-more last (end of list) — keyboard browsing
reads top→bottom naturally, mirroring Slack/Jira.

**Focus order (page-detail surface):** error `Notice` (if present, `role="alert"`, not focusable) →
header `RefreshButton` → (body is non-interactive). Refresh is the only focusable control.

**Keyboard:** every control is a real shadcn `Button` (Radix-backed) — Enter/Space activate for free;
focus-visible ring is the established `focus-visible:ring-ring`. No custom key handling. A disabled
`LoadMoreButton`/`RefreshButton` (while `loading`) is skipped by the browser.

**ARIA / live regions (the in-place-refresh requirement):**
- List container + detail root: `aria-busy={loading}` during any refresh/load-more (so AT announces
  busyness without a skeleton).
- List count line keeps `aria-live="polite"` (existing on `SearchResultList`, `components.tsx:82`) so
  a screen reader announces the new total when an append/refresh lands ("12 results" → "24 results").
- `RefreshButton`/`LoadMoreButton` while `loading`: `disabled` + `aria-busy="true"`; the load-more's
  visible label flips to "Loading…" and the refresh glyph swaps to the spinner, so busy is conveyed
  beyond color/motion.
- Error: the destructive `Alert` is a shadcn `Alert` (`role="alert"`) — announced on appearance,
  both above the lists and as the detail's first child.
- Reduced motion: spinners use Tailwind `animate-spin`; busy meaning is redundantly carried by
  `aria-busy` + `disabled` + the "Loading…" label, so motion-off users lose nothing (consistent with
  the `cosmos-spinner-*` reduced-motion gating in `index.css`).

**Contrast:** ghost/outline controls use `--foreground`/`--muted-foreground` on the `--card #1b1b1c`
/ `--background #1e1e1e` family — the same combinations the existing Confluence surfaces already ship,
already validated. The destructive `Alert` uses `--destructive #f3b0b0` on the dark Alert, also
already in use.

---

## 9. Open questions

- **None blocking.** Three non-blocking notes for the developer:
  1. **Shared controls are already extracted.** `RefreshButton`/`LoadMoreButton`/`useBound`/`Bound`
     live in `catalogShared/controls.tsx` (the structural move Slack flagged is DONE). Confluence
     imports them verbatim — do NOT introduce a Confluence copy (§6.1). This is the single
     reuse-contract requirement; no flagged system change remains for Confluence.
  2. **Bound `error` path (lists + detail).** The bound Slack lists already read a bound `error`
     string → destructive `Alert` above kept rows. Confluence's two lists AND the page-detail should
     read the same bound `error` shape so the fetch-error state (§3) is wired identically — confirm
     the Confluence resolver's `ok:false` recoverable result flows into that path (resolver detail,
     owned by developer; the visual contract here is "recoverable notice above un-corrupted prior
     content, `loading` cleared"). The detail's error is the one place this design extends the
     existing Confluence `PageDetail` beyond Slack's lists — it mirrors Jira's detail-error slot.
  3. **One `SearchResultList` backs two surfaces.** The default feed and CQL search both render the
     bound `SearchResultList`; the builder distinguishes them only by the descriptor +
     bound paths it seeds (feed = cursor-only `confluenceFeedDescriptor` with NO CQL per FR-007;
     search = `confluenceSearchDescriptor(query, cursor?)`). No visual difference; one component. This
     is a builder/descriptor concern, not a visual one — noted so the developer doesn't build a second
     list component.
