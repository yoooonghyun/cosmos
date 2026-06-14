# Design: Slack Generative Adapter — v1

**Status**: Draft
**Created**: 2026-06-09
**Spec**: .sdd/specs/slack-generative-adapter-v1.md
**Plan**: .sdd/plans/slack-generative-adapter-v1.md
**Owner**: designer
**Reuses**: .sdd/designs/jira-generative-adapter-v1.md (shared adapter controls + state model)

---

## Grounding (queries actually run)

- `codegraph_explore "jiraCatalog index.ts adapter controls RefreshButton LoadMoreButton useDataBinding AdapterAction import shared imports useDispatchAction Loader2 RotateCw"` — returned the verbatim, already-BUILT `RefreshButton` / `LoadMoreButton` / `PaginationBar` / `useBound` (they live in `src/renderer/jiraCatalog/components.tsx`, exported), the `AdapterAction` reserved names (`adapter.refresh`/`adapter.loadMore`/`adapter.page`), and `validateAdapterAction`. **Takeaway:** Jira's design is now real code; Slack reuses the same components, not just the same drawings.
- Read `src/renderer/jiraCatalog/components.tsx` (lines 100–550) — exact source of the three adapter controls + `useBound<T>`/`Bound<T>`/`Bind`, plus the bound `IssueList` (header = count + `RefreshButton`, `aria-busy={loading}`, error `Alert` above kept rows, tail `LoadMoreButton`). This is the pattern Slack mirrors.
- Read `src/renderer/slackCatalog/components.tsx` + `logic.ts` + `index.ts` — current `MessageList`/`MessageRow`, `ChannelList`/`ChannelRow`, `SearchResultList`/`SearchResultRow`, `UserChip`, `Notice`, `Text`. These are **display-only today** (literal `messages`/`channels`/`matches` arrays, no `useDataBinding`, the file header even says "no `useDispatchAction` … no action in v1"). `ChannelList` already uses `useDispatchAction` for the local `slack.openChannel` nav — so the dispatch wiring precedent exists.
- Read `src/renderer/index.css` — full token set (`--card #1b1b1c`, `--muted-foreground #888`, `--destructive #f3b0b0`, `--border #333`, `--ring`, `cosmos-spinner-*` keyframes). **Takeaway: no new token is needed**; everything Slack adds resolves to existing tokens, exactly as Jira found.
- `memory_smart_search` — n/a beyond the Jira-cycle finding already recorded; this design is grounded directly from the live system + the shipped Jira design.

**Key takeaway:** Jira already built every control and state Slack needs. The **only** genuine design decision unique to Slack is **(a)** append-only — Slack uses `RefreshButton` + `LoadMoreButton` and **never** `PaginationBar`; and **(b)** the three Slack lists are currently literal-prop and must become bound (mirroring the bound `IssueList`), each gaining a header refresh + a tail load-more. No new token, no new control. I flag **one structural move** (extract the three shared controls + `useBound` to a shared module so Slack imports them verbatim instead of copying — §6).

---

## 1. Scope of this design — the deltas vs. Jira

This feature moves the Slack generative surfaces (channel list, message history, search results) from static-prop composition to **bound, live, refreshable, paginated** data. Visually it reuses the Jira design wholesale; the deltas are:

1. **Append only.** Slack cursors (`conversations.*` `next_cursor`, `search.messages` synthetic `page+1`) are forward-only + opaque — a true prev page is unfetchable (FR-011). So each Slack list gets a **tail `LoadMoreButton`** + a **header `RefreshButton`**, and **never** a `PaginationBar` / prev-next. `hasPrev` is unused.
2. **Read-only.** No write controls, no Jira write-reconciliation notice, no `TransitionPicker`/`AddCommentControl` analog. The only actions any Slack surface emits are the reserved `adapter.refresh` / `adapter.loadMore` (plus the existing renderer-local `slack.openChannel` nav, unchanged).
3. **Three lists, not list+detail.** Slack has no "detail" surface here. The refresh/load-more/state model lands on `MessageList`, `SearchResultList`, and `ChannelList`. Row shapes (`MessageRow`/`SearchResultRow`/`ChannelRow`), `UserChip`, `Notice`, `Text` are **unchanged**.

Because these surfaces are A2UI-catalog-rendered, each control maps to a **catalog component** — but Jira already built them; Slack reuses the same components and re-points its three lists at bound data (flagged in §6).

Surfaces touched: Slack **message history** (`MessageList`), **search results** (`SearchResultList`), **channel list** (`ChannelList`). All inside the existing Slack panel chrome (`SlackPanel.tsx`), which is structurally unchanged.

---

## 2. Surfaces & layout

The Slack panel chrome is unchanged in structure: the panel's existing tab strip / connection state / scrollable content region hosts the active tab's A2UI surface. This design adds, **inside each bound list surface**, a header row (count + refresh) and a tail footer (load-more) — identical placement to Jira's `IssueList`, minus pagination-bar.

### 2.1 Message-history surface (`MessageList`) — bound + append-paginated

```
┌─────────────────────────────────────────────────┐
│  12 messages                        (refresh ⟳)  │  ← header row (§4): count (bound, aria-live) + RefreshButton
├─────────────────────────────────────────────────┤
│  [MessageRow]  avatar · name · ts · text         │
│  [MessageRow]                                    │  ← TemplateBinding rows over the bound list path
│  [MessageRow]                                    │
├─────────────────────────────────────────────────┤
│              ‹ Load more ›                        │  ← §5 LoadMoreButton (append); absent when hasMore=false
└─────────────────────────────────────────────────┘
```

- **Header row** is NEW for `MessageList` (today it renders rows with no count line — only `ChannelList`/`SearchResultList` had a count). It becomes `flex items-center justify-between gap-2`: a bound count on the left (`text-xs text-muted-foreground`, `aria-live="polite"`), the `RefreshButton` on the right (trailing edge, vertically centered). This matches the bound `IssueList` header verbatim.
- **Rows** stay the existing `MessageRow` stack — `flex flex-col` of `MessageRow`s with their `border-b border-border/60` dividers, unchanged visually. Only the data source changes: literal `messages` prop → a `TemplateBinding` over the bound list path (the builder emits `{path}`; the catalog reads it via `useBound`).
- **Footer** holds the `LoadMoreButton` as the list's last child (append only — never a `PaginationBar`). Centered `flex justify-center pt-1`. Absent entirely when `hasMore=false` (the list end is implicit), so the last `MessageRow`'s own `last:border-b-0` remains the visual terminus.

### 2.2 Search-results surface (`SearchResultList`) — bound + append-paginated

Same three-region structure as §2.1. `SearchResultList` already has a count header (`"N results"`, `aria-live`, `components.tsx:232`); this design appends the `RefreshButton` to that existing header row (wrap the count `<p>` + `RefreshButton` in `flex items-center justify-between gap-2`). Rows stay `SearchResultRow` (avatar · name · `#channel` Badge · ts · text), bound via `TemplateBinding`. Tail `LoadMoreButton` for the synthetic forward `page+1` cursor; no prev/next (Slack search exposes only a forward page cursor — FR-011). The `#channel` outline Badge and timestamp treatment are unchanged.

### 2.3 Channel-list surface (`ChannelList`) — bound + append-paginated

Same structure. `ChannelList` already has a count header (`"N channels"`, `aria-live`, `components.tsx:92`) and already dispatches the renderer-local `slack.openChannel` nav per row — **that local nav action is preserved unchanged**; the row `<button>` wrappers + focus ring stay exactly as-is. This design adds the `RefreshButton` to the existing count header (same `justify-between` wrap) and a tail `LoadMoreButton` for the `conversations.list` `next_cursor`. Rows stay `ChannelRow` (`Hash` glyph · name · optional `member` Badge), now bound via `TemplateBinding`.

> The per-row `slack.openChannel` dispatch and the reserved `adapter.*` dispatch coexist: the row `<button>` emits the local nav; the header `RefreshButton` / tail `LoadMoreButton` emit `adapter.refresh` / `adapter.loadMore`. Different components, no collision.

---

## 3. The five states (per region) — including in-place refresh / last-page / fetch-error

The load model is identical to Jira's: the **view is composed once**, then data is pushed in place via `updateDataModel` (no view re-compose). So each list distinguishes *first paint* from *refreshing existing data* from *error*. The bound `loading` flag + presence/absence of prior rows disambiguate them. The table below is the Jira §3.1 state model mapped onto Slack's three lists (substitute Slack's existing empty glyphs/copy). It applies uniformly to `MessageList`, `SearchResultList`, `ChannelList`.

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Loading (first paint)** | Surface composed, no data seeded / restore refetch with no prior rows | Panel-owned first-paint chrome (the existing Slack panel loading state, unchanged — the A2UI list is not yet mounted). A freshly composed surface seeds its own data model and renders populated immediately (FR-003/FR-016), so this is the relaunch-restore case only. **Not a catalog state.** |
| **Refreshing existing data** | `loading=true` while a populated list is on screen (refresh OR load-more in flight) | **Keep the current rows visible — no skeleton flash, no layout shift.** Show busyness on the active control only: the `RefreshButton` swaps `RotateCw`→`Loader2 animate-spin` + `disabled`; the `LoadMoreButton` shows its inline `Loader2` + "Loading…" + `disabled`. The count stays put until new data lands, then updates (and `aria-live` announces e.g. "12 messages" → "24 messages"). `aria-busy={loading}` on the list container. This is the in-place state the data model makes possible — identical to Jira. |
| **Empty (populated, zero items)** | Bound list resolves to `[]` and not loading | The existing Slack empty blocks, unchanged: `ChannelList` → centered `Hash size-7 text-muted-foreground` + "No channels." `py-8`; `MessageList` → "No messages." `px-3 py-6 text-center text-sm text-muted-foreground`; `SearchResultList` → "No results." (same treatment). The `LoadMoreButton` is absent (no `nextCursor`). The header (count + refresh) still renders so the user can re-fetch. |
| **Populated** | Bound list has items, not loading | Header row (count + refresh) + `TemplateBinding` rows + tail `LoadMoreButton` (when `hasMore`). Today's row look, now bound. |
| **Error (recoverable)** | A refresh/load-more fetch failed (network / rate-limited / forbidden / stale cursor / `search_unavailable`) | A catalog `Notice noticeKind="error"` rendered **ABOVE the existing rows** — prior data is NOT cleared (spec edge "prior data is not corrupted"). Reuses the existing Slack `Notice` (destructive `Alert` + `TriangleAlert`, `components.tsx:277`) — **no change to `Notice`, no new `noticeKind`**; the existing `error` kind covers network/rate-limit/forbidden/stale-cursor/`search_unavailable`. `loading` clears, so the active control returns to its idle (re-tryable) state. **`reconnect_needed`/`not_connected` do NOT render here** — they route to the native Slack Connect/Reconnect affordance (existing panel behavior, FR per spec edge), not a broken surface. An empty list WITH an error shows the `Notice` instead of the empty state (mirror `IssueList`: `errorBlock` rendered, empty block suppressed). |
| **Disabled** | `hasMore=false` | The `LoadMoreButton` renders nothing (the end is implicit) — not a surface-wide state. The `RefreshButton` is disabled only while `loading=true`. Slack has no prev control to disable (append-only). |

> This is exactly Jira's §3.1 state model. The only substitutions are Slack's existing empty glyphs/copy and the removal of the page-replace ("keep Prev on an empty page") row, which Slack has no analog for.

---

## 4. Refresh control — reuse `RefreshButton` verbatim

**Reuse the shipped `RefreshButton`** (Jira design §4, built at `jiraCatalog/components.tsx:409`). No redesign. It is a `Button variant="ghost" size="icon-sm"` with a lucide `RotateCw size-4 text-muted-foreground` (hover → `text-foreground`), `aria-label="Refresh"`. Idle = `RotateCw`. Loading (bound `loading=true`) = `Loader2 size-4 animate-spin` + `disabled` + `aria-busy="true"` (so it can't re-fire mid-fetch). It emits the reserved `AdapterAction.Refresh` (`adapter.refresh`) via `useDispatchAction` carrying `{ surfaceId }`.

Placement on every Slack list: the **header row trailing edge** (§2). Slack has no detail surface, so the Jira detail-header `refreshable`-on-`TicketCard` placement does not apply.

---

## 5. Load-more control — reuse `LoadMoreButton` verbatim; NO `PaginationBar`

**Reuse the shipped `LoadMoreButton`** (Jira design §5.1, built at `jiraCatalog/components.tsx:447`). No redesign. It is a `Button variant="outline" size="sm"` centered in a `flex justify-center pt-1` footer, text "Load more". `outline` keeps it a quiet, repeatable secondary action (and on read-only Slack there are no `default` write buttons to compete with). Idle (`hasMore=true`, `loading=false`) = "Load more". Loading = leading `Loader2 size-3.5 animate-spin` + "Loading…" + `disabled` + `aria-busy`. Exhausted (`hasMore=false`) = **renders nothing** (the list end is implicit; an empty append left the list unchanged + set `hasMore=false`, per spec edge). It emits the reserved `AdapterAction.LoadMore` (`adapter.loadMore`) carrying `{ surfaceId }`.

`hasMore` binds to the presence of the page's `nextCursor` (FR-012); when a page returns no `nextCursor`, `hasMore=false` and the button vanishes.

**`PaginationBar` is NOT used by any Slack surface (FR-011/FR-013).** Slack cursors are forward-only + opaque; a backward page is unfetchable. No Slack surface emits `adapter.page`; `hasPrev` is never bound. The footer of each Slack list is a single slot holding **only** the `LoadMoreButton` (or nothing).

---

## 6. Catalog components — reuse + the one structural extraction

Slack adds **no new visual control**. But the three shared adapter controls + the `useBound` helper currently live **inside** `src/renderer/jiraCatalog/components.tsx` (exported there). For Slack to reuse them **verbatim** (not copy-paste — copies would drift and break the "same need → same component" rule), they should be **extracted to a shared catalog module** the Slack catalog imports. This is the single system-extension this design calls for; flag it to the developer.

### 6.1 Structural move (flag to developer)

| Move | What | Why |
|------|------|-----|
| **Extract shared adapter controls** | Lift `RefreshButton`, `LoadMoreButton`, `PaginationBar`, and the `useBound<T>` / `Bound<T>` / `Bind` helpers out of `jiraCatalog/components.tsx` into a shared catalog module (e.g. `src/renderer/adapterCatalog/` or `src/renderer/catalogShared/`), re-exported so **both** the Jira catalog and the Slack catalog import the **same** components. Jira's `jiraCatalog/index.ts` registration is updated to import from the shared module (behavior identical). | The spec/plan say Slack reuses the shared infra **verbatim**; two copies of `LoadMoreButton` would be a uniformity regression. One source = one design. (`PaginationBar` moves too for symmetry even though Slack doesn't register it — it stays Jira-only in the catalog map.) |

> This is a refactor-for-reuse, not a redesign — the controls' visuals/tokens/ARIA are byte-for-byte the shipped Jira ones. If the developer prefers to keep them in `jiraCatalog` and have Slack import across catalog folders, that is acceptable **as long as there is exactly one definition** of each control; the design requirement is single-source, not a specific folder. No Bash/install needed (pure source move).

### 6.2 Slack catalog changes (developer builds — bound variants)

These are **changes to existing Slack catalog components**, registered in `slackCatalog/index.ts`. Each is a thin re-point at bound data + the two shared controls — no new shadcn primitive, no new token.

| Slack catalog component | Change | Bindings it reads | Notes |
|-------------------------|--------|-------------------|-------|
| **`MessageList`** | `messages` prop becomes `Bound<MessageRowNode[]>` (`{path}`), read via `useBound`; gains a NEW header row (bound count + `RefreshButton`); gains a tail `LoadMoreButton`; container gets `aria-busy={loading}`; gains a bound `error` → `Notice` above kept rows. Empty/refresh/error states per §3. | `messages` (list path), `loading` (`DynamicBoolean`) → spinner+disabled+`aria-busy`, `hasMore` → load-more render/omit, `error` (bound string) → `Notice`. | Mirror the bound `IssueList` exactly. `MessageRow` unchanged. |
| **`SearchResultList`** | Same: `matches` → `Bound<…>`; append `RefreshButton` to its existing count header; tail `LoadMoreButton`; `aria-busy`; bound `error` → `Notice`. | `matches` (list path), `loading`, `hasMore`, `error`. | `SearchResultRow` + `#channel` Badge unchanged. |
| **`ChannelList`** | Same: `channels` → `Bound<…>`; add `RefreshButton` to its existing count header; tail `LoadMoreButton`; `aria-busy`; bound `error` → `Notice`. **Preserve** the existing per-row `slack.openChannel` `<button>` dispatch unchanged. | `channels` (list path), `loading`, `hasMore`, `error`. | `ChannelRow` + member Badge + row nav unchanged. |
| **`Notice`** | **Unchanged.** Reused as the recoverable-error surface for all three lists (§3). No new `noticeKind`. | — | Existing `error`/`info` kinds suffice. |
| **`MessageRow` / `SearchResultRow` / `ChannelRow` / `UserChip` / `Text`** | **Unchanged.** Row shapes, `UserChip`, `Text` are not touched (FR-002/FR-004). | — | — |

> The new Slack catalog component-type names the `render_slack_ui` tool must advertise so the agent can emit the controls into a surface: `RefreshButton`, `LoadMoreButton` (register the **shared** components under those type names in `slackCatalog/index.ts`, exactly as `jiraCatalog/index.ts` registers them). **Do NOT register `PaginationBar`** in the Slack catalog (append-only). Action-wiring (how `loading`/`hasMore`/`error` paths are seeded by the builder, the reserved `adapter.*` interception) is the developer's interface/impl concern — this design fixes the visual contract + which binding each control reads.

---

## 7. Tokens used

**No new tokens, no changed tokens** — identical to Jira's §7. Everything resolves to the existing cosmos dark palette:

- Rows / cards: `--card #1b1b1c` / `--card-foreground` (`MessageRow`/`SearchResultRow` text), `--background`/`--foreground`.
- Muted text (count, empty copy, timestamps): `--muted-foreground #888`.
- Ghost / outline controls (`RefreshButton` ghost, `LoadMoreButton` outline): `--accent` (ghost hover), `--border #333` (outline), `--ring` (focus-visible).
- Row dividers: `border-border/60` (existing `MessageRow`/`SearchResultRow` treatment).
- Error notice: `--destructive #f3b0b0` via the existing Slack `Notice` (destructive `Alert`).
- Member / `#channel` Badges: existing `secondary` / `outline` Badge variants — unchanged.
- Spinner: `Loader2` inherits `currentColor` (the shipped inline-busy pattern, 8+ existing call sites).

No Slack brand color, no raw hex — consistent with the existing Slack catalog file header's "cosmos palette only" rule. If any of these proves insufficient at build time the developer surfaces it back here — no one-off color.

---

## 8. Interaction & accessibility

**Focus order (each Slack list surface):** `RefreshButton` (header) → row controls top-to-bottom (`ChannelList`: each channel `<button>`; `MessageList`/`SearchResultList`: rows are non-interactive, skipped) → tail `LoadMoreButton`. Refresh first (top of surface), load-more last (end of list) — keyboard browsing reads top→bottom naturally, mirroring Jira.

**Keyboard:** every control is a real shadcn `Button` (Radix-backed) — Enter/Space activate for free; focus-visible ring is the established `focus-visible:ring-ring`. The `ChannelList` row `<button>`s keep their existing `focus-visible:ring-2 focus-visible:ring-ring`. No custom key handling. A disabled `LoadMoreButton`/`RefreshButton` (while `loading`) is skipped by the browser.

**ARIA / live regions (the in-place-refresh requirement):**
- List container: `aria-busy={loading}` during any refresh/load-more (so AT announces busyness without a skeleton).
- Count line keeps `aria-live="polite"` (existing on `ChannelList`/`SearchResultList`; ADD it to the new `MessageList` count) so a screen reader announces the new total when an append/refresh lands ("12 messages" → "24 messages").
- `RefreshButton`/`LoadMoreButton` while `loading`: `disabled` + `aria-busy="true"`; the load-more's visible label flips to "Loading…" and the refresh glyph swaps to the spinner, so busy is conveyed beyond color/motion.
- Error: the Slack `Notice` is a shadcn `Alert` (`role="alert"`) — announced on appearance.
- Reduced motion: spinners use Tailwind `animate-spin`; busy meaning is redundantly carried by `aria-busy` + `disabled` + the "Loading…" label, so motion-off users lose nothing (consistent with the `cosmos-spinner-*` reduced-motion gating in `index.css`).

**Contrast:** ghost/outline controls use `--foreground`/`--muted-foreground` on the `--card #1b1b1c` / `--background #1e1e1e` family — the same combinations the existing Slack surfaces already ship, already validated. The destructive `Notice` uses `--destructive #f3b0b0` on the dark Alert, also already in use.

---

## 9. Open questions

- **None blocking.** Two non-blocking notes for the developer:
  1. **Shared-control location (§6.1).** The design requires a SINGLE definition of `RefreshButton`/`LoadMoreButton` shared between the Jira and Slack catalogs. Preferred move: extract to a shared module. Acceptable alternative: Slack imports them from `jiraCatalog`. Either satisfies the design; pick at interface time. This is the one flagged system change.
  2. **Bound `error` path on the Slack lists.** The bound `IssueList` already reads a bound `error` string (`jiraCatalog/components.tsx:293`) for the recoverable-`Notice`-above-rows state. Slack's three bound lists should read the same bound `error` shape so the fetch-error state (§3) is wired identically — confirm the Slack resolver's `ok:false` recoverable result flows into that path (resolver detail, owned by developer; the visual contract here is "recoverable notice above un-corrupted prior rows, `loading` cleared").
