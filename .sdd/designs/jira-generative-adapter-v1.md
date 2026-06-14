# Design: Jira Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Spec**: .sdd/specs/jira-generative-adapter-v1.md
**Plan**: .sdd/plans/jira-generative-adapter-v1.md
**Owner**: designer

---

## Grounding (queries actually run)

- `codegraph_explore "jiraSurfaceBuilder ActiveTabSurface JiraPanel jiraCatalog IssueList TicketCard surface states notice"` — returned verbatim source for the builder, the catalog components (`IssueList`/`TicketCard`/`Notice`/`Text`), `JiraPanel` (tab strip + JQL row + detail back row + content region + skeleton/spinner gating), and `ActiveTabSurface` (createSurface/updateComponents processing, error boundary).
- `memory_smart_search "cosmos design system Jira surface tokens shadcn pagination loading states"` — empty (no prior adapter/pagination design memory); design grounded directly from the live system instead.
- Read `src/renderer/index.css` (full token set + `--status-*` chips + `cosmos-spinner-*` keyframes), `src/renderer/components/ui/{button,badge,skeleton}.tsx` (variants/sizes), and `grep` of `Loader2 animate-spin`/`SurfaceSpinner`/`Skeleton` usage across panels.

**Key takeaway:** the live system already expresses almost every state this feature needs — inline button busy is `Loader2 animate-spin` (8+ call sites: `SlackPanel`, `ConfluencePanel`, `PanelTabStrip`, `atlassianPanelBits`), full-surface busy is `SurfaceSpinner`, first-paint is `Skeleton`/`DefaultViewSkeleton`, recoverable errors are the catalog `Notice` (shadcn `Alert`). The only genuine gaps are **pagination controls** and a **per-surface refresh control** in the Jira catalog vocabulary. No new theme tokens are required.

---

## 1. Scope of this design

This feature moves Jira generative surfaces from static-prop composition to **bound, live, refreshable, paginated** data. Visually that introduces:

1. A **load-more** affordance at the list tail (append pagination) with a bound `loading` state.
2. A **prev/next pagination bar** (page-replace) with `hasPrev`/`hasMore`-bound enable/disable.
3. A **refresh** affordance on the Jira list surface + the transient state while a restore/re-activation/refresh refetch is in flight.
4. Per-region **loading / empty / populated / error / disabled** states for a list whose data updates **in place** via `updateDataModel` (no view re-compose) — so the list must specifically handle *refreshing existing data*, *empty page*, and *fetch error* on top of first paint.

Because these surfaces are A2UI-catalog-rendered, each visual control maps to a **catalog component the developer must build** (flagged in §6). The design reuses existing shadcn primitives, tokens, and patterns wherever the catalog backs them.

Surfaces touched: the Jira **issue list** (default view / JQL search / utterance-composed) and the Jira **issue detail**. Detail has no pagination (FR-020) but does gain refresh + the bound refreshing/error states.

---

## 2. Surfaces & layout

The Jira panel chrome (`JiraPanel.tsx`) is unchanged in structure: tab strip on top, then the connection-only JQL search row (list view) **or** the detail back row, then the scrollable content region hosting the active tab's A2UI surface. This design adds two surface-internal regions and one panel-chrome control.

### 2.1 Issue-list surface (`IssueList`) — bound + paginated

```
┌───────────────────────────────────────────────┐
│  ⟳  3 issues                       (refresh)   │  ← list header row (§4): count (bound) + refresh
├───────────────────────────────────────────────┤
│  [TicketCard]                                  │
│  [TicketCard]                                  │  ← TemplateBinding rows (bound list path)
│  [TicketCard]                                  │
├───────────────────────────────────────────────┤
│         ‹ load more ›  (append)                │  ← §5.1 LoadMoreButton, OR
│   ‹ Prev ›   Page 2   ‹ Next ›  (page-replace) │  ← §5.2 PaginationBar
└───────────────────────────────────────────────┘
```

- **Header row** replaces today's bare `{n} issue(s)` line (`IssueList`, components.tsx:222–224). It becomes a flex row: the count on the left (already `aria-live="polite"`), the **refresh** control on the right. `flex items-center justify-between` so the refresh sits at the row's trailing edge, vertically centered with the count text. Reuse existing spacing: `gap-2`, the count keeps `text-xs text-muted-foreground`.
- **Rows** stay the existing `flex flex-col gap-2` stack of `TicketCard`s inside focusable `<button>` wrappers (the actionable/inert split in components.tsx:242–256 is preserved verbatim — only the data source changes from literal `issues` prop to a `TemplateBinding` over the bound list path).
- **Footer** holds **exactly one** pagination shape per surface (append *or* page-replace, decided by the builder — see §5.3), as the last child of the list `Column`. Append uses a centered full-width-ish load-more button; page-replace uses a 3-segment bar (Prev | page indicator | Next). Margin-top `pt-1` from the last card; the footer is not rendered at all when the list is empty-with-no-more (so an empty list shows only its empty state, §3).

### 2.2 Issue-detail surface (`Column`) — bound, refresh, no pagination

Child order is unchanged from v2 (notice → TicketCard header → description → CommentList → TransitionPicker → AddCommentControl). This design adds:

- A **refresh** control in the detail. Detail has no count header to anchor it; place the refresh as a small trailing control on the **TicketCard header row** of the detail (the row already has `flex items-center justify-between` with the key Badge left and StatusBadge right — the refresh sits as a third trailing item, after StatusBadge, separated by `gap-2`). This keeps refresh discoverable without adding a new chrome row. (Builder passes `refreshable` to the detail's header `TicketCard`; the list's refresh lives in the list header per §2.1, not on its cards.)
- All detail display props (`summary`, `statusName`, `statusCategory`, `assignee`, `description`, `comments`) move from static props to `{path}` bindings; the visual treatment is identical.

---

## 3. The five states (per region) — with the refresh-specific states called out

The load model is the crux: the **view is composed once**, then data is pushed in place via `updateDataModel`. So a region must visually distinguish *first paint* (no data yet) from *refreshing existing data* (stale data still on screen) from *error* (fetch failed, keep prior data). The bound `loading` flag plus the presence/absence of prior data disambiguate them.

### 3.1 Issue-list surface

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (first paint)** | Surface composed, no data seeded yet / restore refetch with no prior list | The existing `DefaultViewSkeleton` (JiraPanel.tsx:62) — panel-owned skeleton, unchanged. The A2UI list itself is not yet mounted, so this is panel chrome, not a catalog state. |
| **Refreshing existing data** | `loading=true` while a prior populated list is on screen (refresh / pagination in flight) | **Keep the current rows visible** (no skeleton flash, no layout shift). Show busyness on the active control only: the refresh control shows its spinner (§4) and/or the load-more button shows its inline `Loader2 animate-spin` (§5.1). The list header count stays as-is until new data lands. `aria-busy="true"` on the list container during `loading`. This is the new state the in-place data model makes possible. |
| **Empty (populated, zero items)** | Bound list resolves to `[]` and not loading | The existing `IssueList` empty block (components.tsx:200–207): centered `SquareKanban` glyph `size-7 text-muted-foreground` + "No issues found." `text-sm text-muted-foreground`, `py-8`. For a page-replace empty page, keep the Prev control (if `hasPrev`) so the user can step back; hide load-more / Next. |
| **Populated** | Bound list has items, not loading | Header row (count + refresh) + `TemplateBinding` rows + footer pagination. Today's look, now bound. |
| **Error (recoverable)** | A refresh/pagination fetch failed (network / rate-limit / 404 gone issue / stale cursor) | A catalog `Notice noticeKind="error"` rendered **above the existing rows** (prior data is NOT cleared — spec edge "prior data is not corrupted"). The Notice is `destructive` Alert + `TriangleAlert` (existing treatment). `loading` clears, so the refresh/load-more control returns to its idle (re-tryable) state. A `reconnect_needed` does NOT render here — it routes to the native Connect/Reconnect via `statusChanged` (existing JiraPanel behavior, FR-016). |
| **Disabled** | `hasMore=false` / `hasPrev=false` | Load-more / Next / Prev controls render in their disabled state (§5). Not a surface-wide state — only the pagination controls. |

### 3.2 Issue-detail surface

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (first paint)** | Detail composed, no data seeded | Panel-owned skeleton (the existing nav skeleton floor + `loadingDefault`, JiraPanel.tsx:184–198) — unchanged. |
| **Refreshing existing data** | `loading=true` over a populated detail | Keep the detail visible; the header `TicketCard`'s refresh control spins (§4). `aria-busy="true"` on the detail root `Column` while loading. No skeleton flash. |
| **Empty** | A field is absent (e.g. empty description, zero comments) | Existing per-field placeholders: description → muted "No description." (builder already does this, now bound); comments → "No comments." (`CommentList`, components.tsx:379). |
| **Populated** | Detail data present | Existing v2 detail layout, now bound. |
| **Error (recoverable)** | Refresh fetch failed / 404 gone issue | A catalog `Notice noticeKind="error"` as the FIRST child of the detail `Column` (the existing notice slot, jiraSurfaceBuilder.ts:177–186), above the stale detail. `loading` clears. |
| **Disabled** | n/a (no pagination) | The detail's write controls keep their own existing disabled logic (TransitionPicker/AddComment submit-gating); refresh is disabled only while `loading=true`. |

---

## 4. Refresh control

A small, quiet **icon button** — manual refresh of the bound surface. Maps to a new catalog component `RefreshButton` (§6).

- **Primitive:** shadcn `Button variant="ghost" size="icon-sm"` with a lucide `RotateCw` glyph `size-4 text-muted-foreground` (hover → `text-foreground` via ghost's `hover:text-accent-foreground`). `aria-label="Refresh"`. `icon-sm` = `size-8`, matching the detail back-row's `Button size="icon-sm"` (JiraPanel.tsx:380–387) so refresh and back read as the same control family.
- **Idle:** `RotateCw` glyph, ghost, enabled.
- **Loading (bound `loading=true`):** swap the glyph for `Loader2 className="size-4 animate-spin"` and set `disabled` (so the button can't be re-fired mid-fetch; `disabled` gives the established `opacity-50` from `buttonVariants`). `aria-busy="true"`. This is the exact inline-spinner pattern used everywhere else (SlackPanel:268, PanelTabStrip:283). Reduced-motion: `Loader2`'s `animate-spin` is a Tailwind utility; the established busy meaning is carried by `aria-busy` + the disabled state, so motion-off users still get the signal.
- **Disabled (not loading):** only when there is genuinely nothing to refresh (never expected for a live surface) — same `disabled` opacity. Default state is enabled.

Placement: list → list header row trailing edge (§2.1); detail → TicketCard header row trailing item (§2.2).

---

## 5. Pagination controls

Two shapes, both new catalog components (§6). Both bind enablement/busyness to the data model so they reflect cursor state without a view re-compose.

### 5.1 Append — `LoadMoreButton` ("load more" / infinite)

The list-tail affordance. Fetches the next page; main writes the **full accumulated list** at the bound path so `TemplateBinding` re-renders the grown list.

- **Primitive:** shadcn `Button variant="outline" size="sm"`, centered in a `flex justify-center pt-1` footer row, text "Load more". `outline` (not `default`) so it reads as a secondary, repeatable action that doesn't compete with the write `default` buttons (Apply/Comment/Save) on the same surface.
- **Idle / enabled (`hasMore=true`, `loading=false`):** "Load more", enabled.
- **Loading (`loading=true`):** leading `Loader2 className="size-3.5 animate-spin"` + text "Loading…", `disabled`. Exact parity with SlackPanel:442 / ConfluencePanel:234 load-more spinners. `aria-busy="true"`.
- **Disabled / exhausted (`hasMore=false`):** the simplest resolution and the most consistent with the existing surfaces — **do not render the button at all** when `hasMore=false` (the list end is implicit; an empty append left the list unchanged and set `hasMore=false` per the spec edge). If a visible "end" marker is later wanted it can be a muted `Text` "No more issues." but v1 keeps it absent to match the calm, chrome-light Jira surfaces.

### 5.2 Page-replace — `PaginationBar` (prev / next)

A 3-segment footer bar. Each control fetches that page; main **replaces** the list value + updates cursor state.

```
┌──────────────────────────────────────────┐
│  ‹ Prev        Page 2          Next ›      │
└──────────────────────────────────────────┘
```

- **Container:** `flex items-center justify-between pt-1` footer row.
- **Prev:** `Button variant="ghost" size="sm"` with leading `ChevronLeft size-4`, text "Prev". `aria-label="Previous page"`. **Disabled** (bound to `hasPrev=false`) → `disabled` opacity-50, not removed (so the bar keeps a stable 3-segment layout). On the first page Prev is disabled.
- **Page indicator (center):** muted `text-xs text-muted-foreground`, e.g. "Page 2" (bound to a page-number path) or simply a dot/range if no page number is available — builder supplies whatever the cursor state exposes; if nothing, render the count instead. Non-interactive, `aria-hidden` not set (it is informative), but not focusable.
- **Next:** `Button variant="ghost" size="sm"` with trailing `ChevronRight size-4`, text "Next". `aria-label="Next page"`. **Disabled** bound to `hasMore=false`.
- **Loading (`loading=true`):** the **just-pressed** control swaps its chevron for `Loader2 size-3.5 animate-spin` and both controls go `disabled` (you can't page again mid-fetch). `aria-busy="true"` on the bar. Page indicator stays put until new data lands.

> Disabled-while-busy and disabled-by-cursor look identical (`opacity-50`), which is correct — both mean "not actionable right now."

### 5.3 One shape per surface

A surface renders **either** `LoadMoreButton` **or** `PaginationBar`, never both — decided by the builder (FR-020: Jira issue list wires append/load-more by default; MAY expose page-replace where appropriate). The footer is a single slot; the builder emits the chosen component as the list `Column`'s last child. Both are absent on the detail surface.

---

## 6. Catalog components the developer must add

These are the genuine system extensions — the existing shadcn primitives can't be *placed into the A2UI surface* without a catalog component wrapping them, because Jira surfaces are catalog-rendered (the agent/builder emits component type names, not raw JSX). Each is a thin shell over existing primitives + tokens (no new tokens, no new shadcn primitive).

| New catalog component | Wraps (existing primitives) | Bindings it reads | Notes |
|-----------------------|-----------------------------|-------------------|-------|
| `RefreshButton` | `Button variant="ghost" size="icon-sm"` + `RotateCw`/`Loader2` lucide | `loading` (`DynamicBoolean`) → spinner + disabled | Emits a reserved `adapter.refresh` action via `useDispatchAction`. §4. |
| `LoadMoreButton` | `Button variant="outline" size="sm"` + `Loader2` | `loading` (spinner+disabled), `hasMore` (render/omit) | Emits reserved `adapter.loadMore`. §5.1. |
| `PaginationBar` | two `Button variant="ghost" size="sm"` + `ChevronLeft`/`ChevronRight`/`Loader2` + muted `Text` page indicator | `hasPrev`/`hasMore` (`DynamicBoolean`/`LogicExpression`) → per-control disabled, `loading` → spinner+disabled-both, page-number path → indicator | Emits reserved `adapter.page` (carrying direction/cursor). §5.2. |

Plus two **changes** to existing catalog components (not new components):

- **`IssueList`** — header row becomes count + `RefreshButton`; rows become a `TemplateBinding` over the bound list path; footer hosts the chosen pagination component; container gets `aria-busy={loading}`. The empty/error blocks per §3.1.
- **`TicketCard`** (detail header use) — accepts an optional `refreshable` flag → renders a trailing `RefreshButton` after `StatusBadge`. (List `TicketCard`s never set it.)
- **`Notice`** — unchanged; reused as the recoverable error surface for both list and detail (§3). No new `noticeKind` needed — the existing `error` kind covers network/rate-limit/404/stale-cursor.

> Action wiring (the reserved `adapter.*` names, how `loading`/`hasMore`/`hasPrev` paths are seeded) is the developer's interface/impl concern; this spec fixes only the visual contract and which binding each control reads.

---

## 7. Tokens used

**No new tokens, no changed tokens.** Everything resolves to the existing cosmos dark palette:

- Surfaces/cards: `--card` / `--card-foreground` (TicketCard, detail), `--background`/`--foreground`.
- Muted text (count, page indicator, "No more", empty copy, labels): `--muted-foreground`.
- Secondary/ghost controls (refresh, prev/next, load-more outline): `--secondary`, `--accent` (ghost hover), `--border` (outline), `--ring` (focus).
- Primary (write buttons only — unchanged): `--primary`.
- Error notice: `--destructive` / `--destructive-foreground` (via `Alert variant="destructive"`).
- Status chips (unchanged): `--status-todo|progress|done(-foreground)`.
- Spinner: `Loader2` inherits `currentColor`; the surface `SurfaceSpinner` uses the existing `cosmos-spinner-*` keyframes (panel-owned, not touched here).

If any of these proves insufficient at build time the developer surfaces it back here — do not introduce a one-off color.

---

## 8. Interaction & accessibility

**Focus order (issue-list surface):** refresh button → each actionable TicketCard `<button>` (existing, top-to-bottom) → footer pagination control(s) (load-more, or Prev → Next; the page indicator is not focusable). This puts refresh first (matches its top-of-surface placement) and pagination last (end of list), so keyboard browsing reads top→bottom naturally.

**Focus order (detail surface):** notice (if present, `role="alert"`, not focusable) → header refresh button → TransitionPicker select → Apply → comment textarea → Comment. Refresh sits in the header, before the write controls.

**Keyboard:** all controls are real `<button>`s / Radix-backed shadcn `Button`s, so Enter/Space activate for free; focus-visible ring is the established `focus-visible:ring-ring` (`buttonVariants`). The page-replace bar's disabled controls are skipped by the browser when `disabled`. No custom key handling.

**ARIA / live regions:**
- List container: `aria-busy={loading}`; the count line keeps its `aria-live="polite"` (components.tsx:223) so a screen reader announces "5 issues" → "12 issues" when an append lands.
- Refresh / load-more / pagination buttons while `loading`: `disabled` + `aria-busy="true"`; their visible label flips to "Loading…" (load-more) or the glyph→spinner swap (refresh/pagination) so the busy state is conveyed beyond color/motion.
- Error: catalog `Notice` is a shadcn `Alert` (`role="alert"`) — announced on appearance.
- Reduced motion: spinners use Tailwind `animate-spin`; busy meaning is redundantly carried by `aria-busy` + disabled + the "Loading…" label, so motion-off users lose nothing (consistent with the `SurfaceSpinner` reduced-motion handling in index.css).

**Contrast:** ghost/outline controls use `--foreground`/`--muted-foreground` on the `--card` (#1b1b1c) / `--background` (#1e1e1e) family — the same combinations the existing Jira surfaces already ship, so contrast is already validated. The destructive Notice uses `--destructive` (#f3b0b0) on the dark Alert, also already in use.

---

## 9. Open questions

- **None blocking.** The page-replace **page indicator** content (numbered "Page N" vs. a range vs. just the item count) depends on what cursor state the Jira `searchIssues` descriptor actually exposes — a data-shape question owned by the developer/architect, not a visual blocker. The `PaginationBar` design accommodates any of them (it renders whatever the bound page-state path provides, falling back to the count); pick at interface time. If `searchIssues` exposes no stable page number, render the bound count in the center segment and ship Prev/Next on `hasPrev`/`hasMore` alone — fully expressible with this design, no redesign needed.
