# Design: Slack Generative Message Parity — v1

**Status**: Draft
**Created**: 2026-06-18
**Spec**: .sdd/specs/slack-generative-message-parity-v1.md
**Plan**: .sdd/plans/slack-generative-message-parity-v1.md
**Owner**: designer

> Coordination note: a second designer is concurrently editing the design system. This pass therefore
> does NOT touch `src/renderer/index.css` or anything in `src/renderer/components/ui/`. Every token and
> primitive named below already exists and is reused verbatim. No new token or primitive is required
> (see §7). If the developer later finds a genuine gap, it must be added serially — not in this pass.

---

## Grounding

> Investigated directly via codegraph + agentmemory against HEAD before authoring (CLAUDE.md SDD rule).
> Each load-bearing fact below is from a codegraph read of the current on-disk source, not the prompt.

**codegraph_explore / codegraph_search queries run (one-line takeaways):**

- `SlackPanel MessageRow MessageList MessageSkeletons EmptyLine thread view native ScrollArea reactions
  attachments avatar timestamp` → the native `MessageRow` (`SlackPanel.tsx:191`) and catalog `MessageRow`
  (`slackCatalog/components.tsx:187`) are byte-for-byte the SAME JSX except the reply affordance: native
  uses `Button variant="link" size="xs" className="px-0"` (interactive, calls `onOpenThread`), catalog
  uses a dead `<p className="text-xs text-muted-foreground">`. Both wrap with
  `whitespace-pre-wrap break-words text-sm text-card-foreground` inside `min-w-0 flex-1`. NEITHER row
  renders reactions or attachments — message bodies are text-only today (`SlackMessage` carries no
  reactions/files in the row props), so "reactions/attachments" are NOT part of the v1 canonical row.
- `SlackPanel MessageSkeletons MessageList loading Skeleton JiraPanel ConfluencePanel skeleton rows` →
  native `MessageSkeletons` (`SlackPanel.tsx:97`) = `<div className="flex flex-col gap-3 p-3" aria-busy>`
  holding 4 rows, each `flex gap-2.5` with a `Skeleton size-6 shrink-0 rounded-full` circle + a
  `flex flex-1 flex-col gap-1.5` column of two bars (`h-3 w-24` name, `h-3 w-full` body). The native
  `MessageList` gating is `error?.kind==='reconnect_needed'` → reconnect, then `loading` → skeletons,
  then `error` → ErrorState, then `loaded && items.length===0` → `EmptyLine`, else rows. THIS is the
  rule the catalog list must mirror.
- `Button buttonVariants variant link ghost size xs sm Avatar AvatarFallback Badge variant outline` →
  `buttonVariants` (`button.tsx:7`) already has `variant: link` ("text-primary underline-offset-4
  hover:underline") and `size: xs` (`h-6 gap-1 rounded-md px-2 text-xs … [&_svg…]:size-3`), plus a
  built-in `disabled:opacity-50 disabled:pointer-events-none` and `focus-visible:ring-[3px]
  focus-visible:ring-ring/50`. The reply affordance needs NO new variant — it is literally the native
  row's existing `Button variant="link" size="xs" className="px-0"`.
- `slackCatalog components … Skeleton skeleton component decodeSlackText reactions` → `Skeleton`
  (`components/ui/skeleton.tsx`) = `animate-pulse rounded-md bg-accent`. The catalog has NO skeleton
  component yet. `decodeSlackText` runs upstream in main at the single client mapping point, so
  newlines arrive in the data on BOTH surfaces (this is layout, not decode).
- `BoundListError showEmptyState boundRows countLabel` (Grep) → catalog list gating is
  `showEmptyState(rowCount, error) = rowCount===0 && !showErrorNotice(error)` (`logic.ts:92`); `loading`
  is read into `isLoading` but only drives `aria-busy`, never the empty-vs-skeleton choice. The error
  Notice (`BoundListError`, destructive `Alert`) renders ABOVE kept rows and supersedes the empty state.

**memory_recall / memory_smart_search queries run (takeaways):**

- `slack message row skeleton loading refresh empty state catalog generative parity design system shadcn`
  → empty. No prior design records for this feature area. Sibling designs
  (`confluence-generative-adapter-v1.md`, `slack-generative-adapter-v1.md`) confirm the house verdict
  **"no new token"** for Slack/Jira/Confluence catalog surfaces — this design holds that line.

**Design-system facts that drive this spec:**

1. The two `MessageRow`s are already visually identical *except* the reply affordance. The "unified row"
   is therefore a presentation-faithful extraction, not a redesign: the canonical visual = today's row
   with the catalog's dead `<p>` reply label upgraded to the native interactive `Button variant="link"`.
2. The reply affordance, the wrap classes, the skeleton shapes, and the empty/error states ALL already
   exist on the dark cosmos palette via existing tokens. This pass adds zero tokens and zero primitives.

---

## 1. Surfaces & layout

This feature touches one shared presentational component plus the three catalog list shells that consume
it. Where it lives in the app:

| Surface | Where | What changes |
|---------|-------|--------------|
| **`SlackMessageRow`** (new shared presentational row) | `src/renderer/slackCatalog/SlackMessageRow.tsx` — imported by BOTH `SlackPanel.tsx` (native) and `slackCatalog/components.tsx` (generated catalog node) | The single canonical message-row visual: avatar · name · timestamp · wrapped body · replies affordance. |
| Native `MessageRow` (`SlackPanel.tsx:191`) | History list + thread view, native Slack panel | Becomes a thin adapter that spreads `message.*` into `SlackMessageRow` and passes `onOpenThread`. Visual is unchanged (parity baseline). |
| Catalog `MessageRow` (`components.tsx:187`) | Agent-composed `catalogId:'slack'` surfaces inside the plain `overflow-auto` host | Maps node props (incl. new `channelId`/`threadTs`) into `SlackMessageRow`; supplies `onOpenThread` ONLY when both thread coords are present. Dead `<p>` label removed. |
| Catalog **`MessageSkeleton`** (new) | `src/renderer/slackCatalog/MessageSkeleton.tsx` — rendered by the three bound catalog lists while loading | House-style loading skeleton, shaped to match `SlackMessageRow`. |
| `MessageList` / `SearchResultList` / `ChannelList` shells (`components.tsx`) | Generated catalog lists | Width-clamp container fix (§4) + skeleton-vs-empty gating (§5). |

The shared row is purely presentational — no data fetching, no `useBound`, no SDK hooks. The catalog node
wraps it (supplying `onOpenThread`); the native row wraps it (supplying `onOpenThread` from its callback).

---

## 2. The unified `SlackMessageRow` — canonical anatomy

The canonical row is today's row, extracted verbatim. Reproduced here with exact Tailwind so the
developer builds one source of truth and BOTH surfaces inherit it.

```
Row (flex)
├─ Avatar (sm, initials fallback — NO remote image)
└─ Body column (min-w-0 flex-1)
   ├─ Header line: Name (truncate)  ·  Timestamp (shrink-0)
   ├─ Text (whitespace-pre-wrap break-words)
   └─ Replies affordance  (only when replyCount > 0)
```

### 2.1 Exact classes

- **Row container** — `flex gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0` **plus the new
  `w-full min-w-0`** (the wrap fix, §4). `border-border/60` = the cosmos `--border` (#333) at 60% — the
  established hairline between read rows across all panels.
- **Avatar** — `<Avatar size="sm" className="mt-0.5">` with `<AvatarFallback>{initials(name)}</AvatarFallback>`.
  `size="sm"` = `size-6`; the `mt-0.5` nudge aligns the avatar to the name baseline. Initials only — no
  remote images (consistent with §0 of the original Slack design; avoids token/network leakage).
- **Body column** — `min-w-0 flex-1`. The `min-w-0` is load-bearing: it lets the text column shrink below
  its intrinsic content width so `break-words` can take effect (a flex child defaults to `min-width:auto`).
- **Header line** — `flex items-baseline gap-2`:
  - Name — `truncate text-sm font-medium text-foreground` (`--foreground` #e0e0e0). `truncate` keeps a long
    display name on one line; the timestamp stays pinned.
  - Timestamp — `shrink-0 text-xs text-muted-foreground` (`--muted-foreground` #888). `formatTs` short
    form (`Jun 18, 02:30 PM`). `shrink-0` so it is never clipped by a long name.
- **Text body** — `<p className="whitespace-pre-wrap break-words text-sm text-card-foreground">`.
  `--card-foreground` is the body-text token used for read content across panels. `whitespace-pre-wrap`
  preserves the `\n`s `decodeSlackText` left in; `break-words` wraps long tokens *given a real containing
  width* (§4 guarantees that width).
- **Replies affordance** — see §3.

### 2.2 Shared-row props (presentation contract, not data)

`SlackMessageRow` takes a plain props object — NOT a `SlackMessage` and NOT `SdkProps`:

```
{ ts?, userId?, userName?, text?, replyCount?, onOpenThread?: () => void }
```

`onOpenThread` is the ONLY behavioral input. Its presence + a positive `replyCount` is what turns the
replies affordance interactive (§3). This is the maximal-sharing boundary the A2UI prop-injection model
allows; the per-surface wiring of `onOpenThread` is the one minimal piece that stays separate (FR-017).

### 2.3 The `SearchResultRow` shares the same body/wrap shell

`SearchResultRow` is NOT folded into `SlackMessageRow` (it has a `#channel` Badge and no reply affordance),
but it MUST use the identical body shell: `min-w-0 flex-1` column, same header line treatment, and the
same `whitespace-pre-wrap break-words text-sm text-card-foreground` text paragraph, plus the §4 row clamp.
This keeps wrap parity across every catalog message-style row (FR-003) without forcing a false merge.

---

## 3. The replies affordance — visual + all states

When `replyCount > 0`, the row's body column ends with a "N replies" affordance. Its interactivity is
gated by `onOpenThread`:

- **`onOpenThread` present** (thread coords carried, native drill-in wired) → an **interactive** control.
- **`onOpenThread` absent** (no `channelId`/`threadTs`, or native row without callback) → a
  **non-interactive label**.

### 3.1 Interactive variant (default)

Reuse the native row's existing control verbatim — no new primitive, no new variant:

```tsx
<Button
  type="button"
  variant="link"
  size="xs"
  className="px-0"
  onClick={onOpenThread}
>
  <MessageSquare aria-hidden="true" />
  {countLabel(replyCount, 'reply', 'replies')}
</Button>
```

- **Variant/size** — `variant="link"` (`text-primary underline-offset-4 hover:underline`,
  `--primary` #4a9eff) + `size="xs"` (`h-6 px-2 text-xs`, with icon auto-sized to `size-3`). `className="px-0"`
  strips the size's horizontal padding so the control left-aligns flush under the text (matches native today).
- **Icon** — lucide `MessageSquare` as a small leading glyph for the "open a thread" affordance, auto-sized
  to `size-3` by the `xs` button rule. This is a small enhancement over native's text-only control; apply
  it to native too so they stay identical (the whole point of the shared row). If the developer prefers
  zero icon for the very first cut, drop the glyph from BOTH surfaces together — never one only.
- **Count formatting** — use the existing `countLabel(replyCount, 'reply', 'replies')` helper
  (`logic.ts:53`) → `"1 reply"` / `"3 replies"`. This is English. The prompt mentions a Korean
  `"답글 N개"` form: cosmos has **no i18n layer today** and every existing surface string is English-only
  (`No messages.`, `Load more`, `formatTs` locale-aware but labels hardcoded). Therefore v1 ships the
  English `"N replies"` to stay consistent with the rest of the product; a Korean/localized form is an
  **open question for the architect** (§8 OQ-A), NOT a silent per-surface divergence.

**States of the interactive variant:**

| State | Trigger | Visual treatment |
|-------|---------|------------------|
| **Default** | `replyCount > 0`, `onOpenThread` present, idle | `--primary` (#4a9eff) link text + `MessageSquare`, no underline. Left-aligned flush under the body text (`px-0`), `text-xs`. |
| **Hover** | pointer over the control | `hover:underline` (from `variant="link"`) — underline appears; color unchanged. Cursor is the button default (pointer). |
| **Focus (keyboard)** | Tab focus | The button base supplies `focus-visible:ring-[3px] focus-visible:ring-ring/50` (`--ring` on #1e1e1e) — a visible focus ring, no reliance on color alone (a11y, §6). |
| **Active / pressed** | click/Enter/Space | Standard button press; on activation it drills the current tab into the native thread view (§3.3). The control itself does not enter a persistent "loading" state — the destination thread view owns the loading/error UI (reuse, FR-006/010/011). |
| **Disabled** | not applicable to this control | The affordance is never rendered in a disabled state. "Cannot open" = the non-interactive label variant (§3.2), not a disabled button. |

> Note: because OQ-1 resolved to **reuse the native thread view** (drill-in, not inline-expand), the
> affordance itself carries NO in-place spinner or inline error. The loading state, the not-connected
> message, the failed-read retry, and "no replies" all live in the native thread-view `MessageList`
> (`SlackPanel.tsx:460`) which already renders `MessageSkeletons` while loading, `ReconnectState` /
> `ErrorState` on failure, and `EmptyLine` for zero replies. The affordance is a pure navigation trigger.

### 3.2 Non-interactive label variant

When `onOpenThread` is absent (FR-012 — row lacks `channelId`/`threadTs`):

```tsx
<p className="text-xs text-muted-foreground">
  {countLabel(replyCount, 'reply', 'replies')}
</p>
```

- Plain `--muted-foreground` (#888) text, NOT link-colored, NO underline-on-hover, NOT focusable, no
  pointer cursor. It reads as metadata ("3 replies") rather than an actionable control, so a user is never
  invited to click something inert. This is exactly the catalog's current dead `<p>` — preserved as the
  graceful-degradation fallback.

### 3.3 Zero-replies = no affordance

When `replyCount` is `0`, absent, or non-numeric, render NOTHING (no control, no label, no empty gap).
The row collapses to avatar · name · timestamp · body. Same as both rows today.

### 3.4 Thread-view reuse (drill-in destination)

The interactive affordance does not render replies itself. On activation the catalog node dispatches the
renderer-local `SLACK_OPEN_THREAD_ACTION` (carrying non-secret `{ channelId, threadTs, ts, userId,
userName?, text, replyCount? }`); `SlackPanel`'s `handleSurfaceAction` intercepts it (never forwarded to
main), reconstructs `{ channel, parent }`, and `setView({ kind:'thread', channel, parent })` — landing on
the EXISTING native thread view (`SlackPanel.tsx:945`). Visual parity is automatic: the thread view header
renders the parent through the SAME `SlackMessageRow`, and each reply renders through the SAME
`SlackMessageRow`, with the duplicate root dropped and native "Load more" paging intact. A `← back`
(native `Button variant="ghost" size="icon-sm"` with `ChevronLeft`, as Confluence's detail back uses)
returns to the composed surface. No new thread visual is designed here — this is pure reuse.

---

## 4. Long-token wrap — intended behavior (fix is structural, developer-owned)

The wrap fix is a structural container change (the developer's job); this section states the intended
behavior so it can be verified.

**Intended behavior:**

- A long unbroken token (a URL/path/ID with no whitespace) in `SlackMessageRow` or `SearchResultRow`
  **wraps within the panel width**. No horizontal scrollbar appears solely because of message text width.
- At any panel width, the generated surface wraps a given message **identically to the native panel** at
  the same width (visual parity, SC-001). Embedded newlines are preserved (`whitespace-pre-wrap`), never
  collapsed by the wrap.
- This holds for EVERY catalog message-style row — `MessageRow`, `SearchResultRow`, and `ChannelRow` text
  — not just the history row (FR-003).

**Where the fix lives (for the developer, not this designer to apply):** the generated surface mounts in a
plain `overflow-auto` div (not a Radix `ScrollArea`), so a `flex`/block child sizes to intrinsic content
width and the per-`<p>` `break-words` cap has an already-over-wide containing block. The structural fix is
to clamp the catalog list ROOTS and ROWS so the cap has a real containing width:

- Catalog list roots (`MessageList`, `SearchResultList`, `ChannelList` containers) → add `w-full max-w-full min-w-0`.
- Each row container (`SlackMessageRow` / `SearchResultRow` / `ChannelRow`) → add `w-full min-w-0` (the
  `min-w-0` on the row, combined with the existing `min-w-0 flex-1` body column and `break-words`, makes
  the wrap deterministic).

The native ScrollArea `display:table` fix (`scroll-area.classes.ts`) is unrelated and unaffected.

---

## 5. The catalog refresh skeleton — `MessageSkeleton`

On an in-flight refresh the generated lists momentarily hold zero items with `loading=true`; today that
paints the "No messages." empty state. The fix shows a house-style skeleton instead.

### 5.1 Reuse the native `MessageSkeletons` treatment

The catalog skeleton is the **same shape** as native `MessageSkeletons` (`SlackPanel.tsx:97`), built from
the SAME `Skeleton` primitive — so generated and native loading states read identically:

```tsx
function MessageSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-3" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
```

- **Row count** — **4** rows (matches native `MessageSkeletons` exactly; enough to fill the typical panel
  without looking sparse or busy).
- **Shape per row** — `Skeleton size-6 shrink-0 rounded-full` (mirrors the `size-6` `sm` Avatar circle) +
  a `flex flex-1 flex-col gap-1.5` column of two bars: `h-3 w-24` (the name) and `h-3 w-full` (the body
  line). These match `SlackMessageRow`'s avatar + name + first body line so the skeleton "lands" into real
  rows without layout shift.
- **Animation** — the `Skeleton` primitive's built-in `animate-pulse` (opacity pulse on `bg-accent`). No
  custom animation, no shimmer — house style, identical to every other cosmos skeleton.
- **Color** — `bg-accent` (from the primitive) on the dark panel. No token added.
- **a11y** — `aria-busy="true"` on the wrapper (matches native).

> The catalog `SearchResultList` and `ChannelList` reuse the SAME `MessageSkeleton` (its avatar+line shape
> reads fine for any of the three lists; a `#channel` badge or a hash glyph on the skeleton would add
> noise). One skeleton component, three callers — minimal and uniform. If the developer wants a hash-tinted
> channel variant later it is optional polish, not required for v1.

### 5.2 Skeleton-vs-empty-vs-error gating (per list)

Each bound list resolves to exactly one state, in this precedence (mirroring the native `MessageList`
order and FR-016 error precedence):

1. **Error notice** — `showErrorNotice(error)` → render `BoundListError` (destructive `Alert`) ABOVE any
   kept rows; if rows are empty it stands alone. Error supersedes BOTH skeleton and empty.
2. **Skeleton** — `showSkeletonState(rowCount, loading, loaded, error)` (new pure helper) → render
   `<MessageSkeleton/>`. True when never-loaded first paint, or when `loading` with zero rows (the in-flight
   `replace-fresh` refresh). False once `loaded && !loading`, and false if an error is present.
3. **Empty** — tightened `showEmptyState` requiring `loaded && !loading` (mirrors native
   `loaded && items.length === 0`) → render the existing centered empty line ("No messages." /
   "No results." / "No channels.").
4. **Rows** — otherwise the list with its `aria-live` count header + rows + `LoadMoreButton`.

`aria-busy` continues to reflect `isLoading` on the list container regardless of which branch renders.

---

## 6. Interaction & accessibility

- **Focus order within a row** — avatar (non-focusable) → name/timestamp (non-focusable text) → body text
  (non-focusable) → replies affordance (focusable ONLY in the interactive variant). In `MessageList`,
  rows are not themselves focusable; the only tab stops are the per-row replies affordance and the tail
  `LoadMoreButton` (`ChannelList` rows remain `<button>`-wrapped as today; messages are not).
- **Keyboard** — the interactive replies affordance is a real `<button>`: Enter/Space activate it and trigger
  the native drill-in. The non-interactive label is not in the tab order.
- **Focus ring** — supplied by the `Button` base (`focus-visible:ring-[3px] focus-visible:ring-ring/50`),
  visible on the #1e1e1e/#1b1b1c panels; focus is communicated beyond color (WCAG).
- **Contrast (dark palette)** — name `--foreground` #e0e0e0 on `--card` #1b1b1c (high contrast); body
  `--card-foreground` (body token) on card; timestamp/label `--muted-foreground` #888 (metadata weight);
  the link affordance `--primary` #4a9eff on card passes AA for the small text size with the underline-on-
  hover/focus reinforcing it. All are existing, palette-vetted tokens (sibling designs confirm).
- **Loading announcement** — skeleton wrapper carries `aria-busy="true"`; the count header uses
  `aria-live="polite"` so a screen reader hears the count once rows arrive, not the transient skeleton.
- **Reduced motion** — `animate-pulse` is the house skeleton animation already used everywhere; no new
  motion is introduced. (A global `prefers-reduced-motion` policy, if desired, belongs to the design-system
  owner, not this feature — flagged, not solved here.)

---

## 7. Tokens & primitives — additions/changes

**Tokens used (all existing, none added/changed):** `--foreground`, `--card`, `--card-foreground`,
`--muted-foreground`, `--border` (via `border-border/60`), `--primary` (link affordance), `--ring` (focus),
`--accent` (skeleton via the `Skeleton` primitive), `--destructive` (error Notice).

**Primitives used (all existing, none added/changed):** `Avatar` / `AvatarFallback` (`size="sm"`),
`Button` (`variant="link" size="xs"`, and `variant="ghost" size="icon-sm"` for the thread-view back),
`Badge` (`variant="outline"` for `#channel` on search rows), `Skeleton`, `Alert`/`AlertDescription`
(error Notice). lucide `MessageSquare` (replies glyph) — an icon import, not a design-system primitive.

**New design-system token or primitive required: NONE.** This pass deliberately avoids editing
`index.css` and `components/ui/` (concurrent-edit coordination). The two new files
(`SlackMessageRow.tsx`, `MessageSkeleton.tsx`) live under `src/renderer/slackCatalog/`, are app components
(not design-system primitives), and compose only existing primitives + tokens. No serial design-system
change is needed before the developer can implement.

---

## 8. Open questions

- **OQ-A — Replies-count localization.** The prompt suggested a Korean `"답글 N개"` alternative to
  `"N replies"`. cosmos has no i18n layer today and every product string is English-only, so v1 ships the
  English `countLabel(replyCount, 'reply', 'replies')` for product consistency. Whether to introduce
  localization (and for which surfaces) is an architecture decision — flag to `architect`; do NOT add a
  one-off Korean string to this single affordance (that would itself be a divergence).
- **OQ-B — Replies glyph (icon vs text-only).** This design adds a small `MessageSquare` glyph to the
  replies affordance and asks it be applied to native too so the shared row stays identical. If the team
  prefers the current text-only control, drop the glyph from BOTH surfaces together. Non-blocking; either
  choice is uniform as long as it is applied to the one shared row.

---

## 9. Acceptance checklist (visual contract for the developer)

- [ ] One shared `SlackMessageRow` renders avatar · name(truncate) · timestamp(shrink-0) · body
      (`whitespace-pre-wrap break-words text-card-foreground`) · replies affordance; native + catalog both
      wrap it (no duplicated row JSX).
- [ ] Replies affordance interactive (`Button variant="link" size="xs" px-0`, `MessageSquare`, `countLabel`)
      when `onOpenThread` + `replyCount>0`; non-interactive `--muted-foreground` `<p>` label when no
      `onOpenThread`; nothing when `replyCount` ≤ 0.
- [ ] Interactive affordance shows hover underline + a focus-visible ring; activation drills into the native
      thread view (no inline spinner/error on the affordance itself).
- [ ] Catalog list roots + rows carry `w-full max-w-full min-w-0` / `w-full min-w-0`; a long unbroken token
      wraps in `MessageRow` AND `SearchResultRow`, matching native at the same width.
- [ ] `MessageSkeleton` = 4 rows, `size-6 rounded-full` circle + `h-3 w-24` / `h-3 w-full` bars, `gap-3 p-3`,
      `Skeleton` `animate-pulse`, `aria-busy`; reused by all three catalog lists.
- [ ] List gating order: error Notice > skeleton (`showSkeletonState`) > empty (`loaded && !loading`) > rows;
      a refresh shows the skeleton, a zero-result load shows the empty state, an error supersedes both.
- [ ] No edits to `src/renderer/index.css` or `src/renderer/components/ui/`; no new token/primitive.
