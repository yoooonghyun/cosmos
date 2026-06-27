# Design: Confluence Page Dock — View + Add Comments — v1

**Status**: Draft
**Created**: 2026-06-27
**Spec**: `.sdd/specs/confluence-dock-comments-v1.md`
**Plan**: `.sdd/plans/confluence-dock-comments-v1.md`
**Owner**: designer

> Sits between Plan (Step 2) and Interface (Step 3). The plan fixed the *mechanism* (new
> `getComments`/`addComment` renderer IPC; `getComments` returns top-level footer comments each with a
> one-level `replies[]`; `read:comment:confluence` scope gate → `comment_read_not_authorized`; post-add
> RE-FETCH; comment body = raw `view` HTML sanitized at the render site). This file fixes the *visual
> contract*: where the comments section sits in the dock, the comment + reply-tree anatomy, the compose
> affordance, and every state — entirely in existing tokens + `components/ui/` primitives, dark-only.

---

## Grounding (queries actually run this session)

**codegraph_explore:**

- `ConfluencePanel genUiPage PageDetail dock GlassDock confluence detail PageDetailSkeleton ReconnectState ErrorState`
  — returned the verbatim dock shell + `PageDetailSkeleton` + the shared `ErrorState`/`ReconnectState`
  (`src/renderer/atlassianPanelBits.tsx`). **Takeaway:** the dock body is the native `PageDetail` rendered
  inside `<ScrollArea className="h-full">`; the dock frame (header + X close) and `GlassDock` material are
  already in `ConfluencePanel.tsx` and stay UNCHANGED — comments mount INSIDE this body, not as new chrome.
- `jiraCatalog CommentList CommentRow AddCommentControl Textarea avatar timestamp` — the direct UI
  precedent: `CommentRow` (`Avatar size="sm"` + `initials` fallback, name + `formatTs`, body `<p>`) and
  `AddCommentControl` (`Textarea` `max-h-[12rem] min-h-[80px] resize-none` + `Button size="sm"`,
  disabled-until-non-empty, in-flight lock). **Takeaway:** reuse these idioms verbatim so the Confluence
  composer + comment row read identically to Jira's.
- `ConfluencePanel genUiPage dock GlassDock overlay w-1/2 PageDetail native render ConfluenceView ScrollArea`
  — confirmed the dock is `GlassDock` `absolute inset-y-0 right-0 z-20 w-1/2 flex flex-col`, header is
  `flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5` (BookText icon + `PageDetailTitle`
  + ghost `icon-sm` X), body is `<div className="min-h-0 flex-1"><PageDetail .../></div>`. The `PageDetail`
  `key={genUiPage.pageId}` already remounts the whole body on retarget — so a comments component keyed off
  `pageId` resets for free (FR-009).
- Read `src/renderer/ConfluencePanel.tsx:279-352` (native `PageDetail`) — body is
  `<ScrollArea className="h-full"><div className="flex flex-col gap-4 p-3"> …header… <PageDetailBody/></div></ScrollArea>`.
  **The comments section is the next sibling of `<PageDetailBody/>` inside that `gap-4 p-3` column.**
- Read `src/renderer/confluenceCatalog/components.tsx:66-86` — `PageDetailBody` is EXPORTED + reuses
  `PAGE_DETAIL_BODY_CLASS = 'prose prose-sm prose-cosmos max-w-none break-words'` + `sanitizeConfluenceHtml`
  (DOMPurify, the ONE sanctioned `dangerouslySetInnerHTML` site). **Takeaway:** comment + reply bodies
  reuse `PageDetailBody` directly (OQ-3) — no second sanitize/prose path.
- Grep `formatTs`/`initials` — both already exported from `src/renderer/atlassianPanelBits.tsx`
  (`formatTs` = ISO-8601 → short locale time; `initials` = avatar fallback). Reuse, do not re-implement.
- Glob `components/ui/{textarea,avatar,skeleton,button,alert,scroll-area}.tsx` — all six primitives exist.

**memory_recall / memory_smart_search:** `confluence dock comments design Tailwind shadcn reply tree composer`
— empty store for this feature (prior recalls confirmed only the system-level "design system = Tailwind +
shadcn" preference). Persisted this design's decisions via `memory_save` (mem_mqvt6z6q…) after authoring.

**Net:** fully expressible in existing tokens + `Avatar`/`Textarea`/`Button`/`Alert`/`Skeleton` +
`PageDetailBody`/`PAGE_DETAIL_BODY_CLASS` + the shared `ErrorState`/`ReconnectState`/`initials`/`formatTs`.
**No new theme token. No new `components/ui/` primitive.** The only net-new renderer artifact is the
`CommentsSection` dock-body component (it consumes the system; it does not extend it).

---

## 1. Decision summary (read this first)

| Decision | Choice | Why |
|----------|--------|-----|
| Placement | Comments are the **next sibling of `<PageDetailBody/>`** inside the existing `flex flex-col gap-4 p-3` column, separated by a `border-t border-border pt-4` rule. They scroll WITH the page body inside the dock's existing `<ScrollArea className="h-full">`. | The dock already scrolls the whole body; comments are page content, not chrome. One scroll region, not a nested one. |
| Composer | **Bottom-pinned** — a sticky composer bar OUTSIDE the `ScrollArea`, as a sibling under the dock-body div, with `border-t border-border`. | Mirrors a chat/thread dock (Slack): the write affordance is always reachable on a long page without scrolling to the bottom. The list scrolls; the composer stays. |
| Comment item | The **Jira `CommentRow` idiom** (`Avatar size="sm"` + `initials` + name + `formatTs`) but the **body rendered RICH** via the shared `PageDetailBody`. | Confluence footer comments are `view` HTML (links/emoji/formatting), unlike Jira's plain-text body. Reusing `PageDetailBody` keeps comment text identical to the page body it sits under (SC consistency, OQ-3). |
| Reply tree (one level) | Replies render as **indented child rows** under their parent (`pl-7 border-l border-border/60`), each a `CommentRow` at a slightly smaller avatar/quieter weight. | One nesting level only (plan §C OQ-1). The indent + left rule is the universal "this is a reply" signal; matches how Confluence renders footer threads. |
| New states | Reuse `ErrorState` + `ReconnectState` (atlassianPanelBits) verbatim for fetch-error / `reconnect_needed`. The new **`comment_read_not_authorized`** state = an inline `Alert` + a "Reconnect to view comments" `Button` calling `window.cosmos.confluence.connect()` (OQ-4). | One reconnect idiom across the app; the new scope-gap state branches distinctly from `reconnect_needed` but uses the SAME visual treatment. |

---

## 2. Surfaces & layout

ONE surface: the `CommentsSection` mounted inside the native `PageDetail` dock body. The dock SHELL
(`GlassDock` + header + X + the `ScrollArea`) is **unchanged** (FR-013) — comments live below the body.

```
GlassDock (absolute inset-y-0 right-0 z-20 w-1/2 flex flex-col)   ← UNCHANGED
├─ header (BookText + PageDetailTitle + X)                         ← UNCHANGED
└─ div.min-h-0.flex-1   ← the dock body slot (was just <PageDetail/>)
   └─ PageDetail
      ├─ ScrollArea (h-full)               ← scrolls page body + comments together
      │  └─ div.flex.flex-col.gap-4.p-3
      │     ├─ header (title + space Badge)            ← UNCHANGED
      │     ├─ <PageDetailBody/>                        ← UNCHANGED
      │     └─ <CommentsSection pageId=…/>   ← NEW (border-t pt-4 separator)
      │        ├─ section header  "Comments (n)"
      │        ├─ [loading | empty | error | reconnect | populated]
      │        └─ comment list  → CommentRow + indented reply rows
      └─ composer bar (sticky, OUTSIDE ScrollArea)      ← NEW (border-t)
         └─ Textarea + Comment Button   (disabled / in-flight / error)
```

**Layout notes:**

- **Section separator + header:** a `<div className="border-t border-border pt-4">` opens the comments
  region. Header row: `<div className="flex items-center justify-between">` → a count label
  `<span className="text-xs font-medium text-muted-foreground" aria-live="polite">Comments ({total})</span>`
  (counts top-level + replies, or top-level only — developer's choice; copy "Comments (n)"). Matches Jira
  `CommentList`'s `Comments (n)` label exactly.
- **Comment list:** `<div className="flex flex-col">` of `CommentRow`s. Each top-level row mirrors Jira's
  `CommentRow` shell: `flex gap-2.5 ... py-2.5`, but the bottom-border separators are softened to
  `border-b border-border/60 last:border-b-0` ONLY between top-level threads (a reply group sits inside its
  parent's row, above the divider).
- **Reply group:** rendered directly under a parent's body, indented:
  `<div className="mt-2 flex flex-col gap-2 border-l border-border/60 pl-3 ml-7">` containing the reply
  `CommentRow`s (no per-reply bottom border; `gap-2` separates them). The `ml-7` aligns the left rule under
  the parent avatar gutter (avatar `size-6`/`sm` + `gap-2.5`); replies use `Avatar size="sm"` too but the
  name weight stays `font-medium` so authorship is still clear.
- **Composer bar:** `<div className="shrink-0 border-t border-border p-3">` sibling AFTER the dock body's
  `<div className="min-h-0 flex-1">`. Because it is outside the `ScrollArea`, it stays pinned to the bottom
  of the dock at every page length. (The developer lifts the composer to the dock-frame level in
  `ConfluencePanel.tsx`, or `PageDetail` renders `<div className="flex h-full flex-col">` with the
  `ScrollArea` as `flex-1` and the composer as the pinned footer — either keeps the composer out of the
  scroll. Prefer the latter so `CommentsSection` owns both list + composer as one unit keyed by `pageId`.)

## 3. Comment item + reply tree anatomy (FR-002)

Reuse the Jira `CommentRow` structure, swapping the plain-text `<p>` body for the rich `PageDetailBody`:

```
CommentRow (top-level)
└─ div.flex.gap-2.5.py-2.5.border-b.border-border/60.last:border-b-0
   ├─ Avatar size="sm" (mt-0.5)  →  AvatarFallback initials(name)
   └─ div.min-w-0.flex-1
      ├─ div.flex.items-baseline.gap-2
      │  ├─ span.truncate.text-sm.font-medium.text-foreground   name
      │  └─ span.shrink-0.text-xs.text-muted-foreground          formatTs(created)  ← only when present
      ├─ PageDetailBody (the SAME prose-cosmos rich render as the page body)
      └─ [reply group]  ← indented child rows (one level)
```

- **Author name:** `comment.author.displayName ?? comment.author.accountId ?? 'Unknown'` (mirrors Jira's
  `commentAuthorName`). Avatar fallback = `initials(name)` from `atlassianPanelBits`. No remote avatar image
  (same auth limitation as page images — fallback initials only; no token-bearing fetch).
- **Timestamp:** `formatTs(comment.created)` ONLY when `created` is present (degrade-to-omit, FR-002).
- **Body:** `<PageDetailBody body={comment.body} />` — reuses `PAGE_DETAIL_BODY_CLASS` + DOMPurify. A
  comment whose sanitized body is empty falls to `PageDetailBody`'s own "This page has no readable body."
  guard — acceptable (never an empty prose container; never a crash). Long bodies wrap/break via
  `prose … break-words` exactly like the page body.
- **Replies (one level):** the parent's `replies[]` render as `CommentRow`s inside the indented group
  (§2). A top-level comment with `replies.length === 0` shows no group. A reply's own body also uses
  `PageDetailBody`. A failed children read yields `replies: []` (plan §C, best-effort) — the parent simply
  shows no replies; never an error on the whole section.

## 4. Compose affordance (FR-005 / FR-007 / FR-008)

Mirror Jira `AddCommentControl`, bottom-pinned in the composer bar:

```
div.shrink-0.border-t.border-border.p-3
└─ div.flex.flex-col.gap-2
   ├─ [inline error]  ← only on a failed submit (see States)
   ├─ Textarea  value=draft  placeholder="Write a comment…"  aria-label="Add a comment"
   │            className="max-h-[12rem] min-h-[72px] resize-none"  disabled={inFlight}
   └─ div.flex.justify-end
      └─ Button variant="default" size="sm"
                disabled={inFlight || draft.trim()===''}
                onClick={submit}
         {inFlight ? (<><Loader2 className="size-3.5 animate-spin" aria-hidden/>Posting…</>) : 'Comment'}
```

- **Empty / whitespace** → submit `disabled` (no request) — `draft.trim() === ''`, same predicate idiom as
  Jira's `isCommentSubmittable`.
- **In-flight** → `Textarea` + `Button` both `disabled`; the button shows `Loader2 animate-spin` + "Posting…"
  (the established cosmos busy idiom — `TransitionPicker`'s "Applying…", never color-only). No double-submit.
- **Success** → on the `addComment` `ok` result, **clear `draft`** and trigger a `getComments` RE-FETCH
  (OQ-2); the new comment appears when the re-fetch lands. The composer returns to idle.
- **Failure** → an inline error ABOVE the Textarea, reusing the calm chip idiom:
  `<p role="alert" className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-2 text-[13px] text-destructive">{message}</p>`.
  The typed text is **preserved** (`draft` unchanged); the composer re-enables for retry. Maps via
  `mapConfluenceError`; a `write_not_authorized` result reuses the "reconnect to comment" copy (see States),
  no token/stack in the message.
- **Composer visibility:** the composer is shown whenever the dock body is populated (page loaded). It is
  NOT hidden by a comment-READ failure — read and write capabilities are independent (FR-007): a
  read-not-authorized list can sit above a working composer.

## 5. States (all required)

The dock SHELL (header + X) is always present. The COMMENTS SECTION moves through these states; the page
body + composer above/below it are independent.

| State | Trigger | Treatment |
|-------|---------|-----------|
| **Loading** | `getComments` in flight (initial open / retarget) | A skeleton list reusing the `Skeleton` primitive — repeat 3×: `<div className="flex gap-2.5 py-2.5"><Skeleton className="size-6 shrink-0 rounded-full"/><div className="flex-1 flex flex-col gap-1.5"><Skeleton className="h-3 w-24"/><Skeleton className="h-3 w-full"/><Skeleton className="h-3 w-2/3"/></div></div>`, wrapped `aria-busy="true"`. Foreshadows the avatar+name+body row. The section header reads "Comments" (no count yet). |
| **Empty** | read ok, zero comments | A calm line, NOT an error: `<p className="py-2 text-sm text-muted-foreground">No comments yet.</p>` under the header (which reads "Comments (0)"). Mirrors Jira `CommentList`'s "No comments." |
| **Populated** | read ok, ≥1 comment | The comment list + reply tree (§3). |
| **Fetch error** (non-reconnect: network / 403 / 404 / 429) | `getComments` returns an error result other than reconnect/scope-gap | Reuse the shared **`ErrorState`** (`atlassianPanelBits`): `Alert variant="destructive"` + a `Retry` `Button` (size="sm") that re-calls `getComments`. Scoped to the comments section — the page body above is untouched. `rate_limited` shows the busy/cooldown copy `ErrorState` already implements. Never a crash, never a raw stack. |
| **Reconnect needed** | `getComments` (or `addComment`) returns `reconnect_needed` | Reuse the shared **`ReconnectState`** (`Alert` + `Reconnect` `Button` → `window.cosmos.confluence.connect()` via `onReconnect`). Same affordance the page detail already uses for a mid-read token rejection. |
| **Comment-read NOT authorized** (NEW) | `getComments` returns `comment_read_not_authorized` (the `read:comment:confluence` scope gap — the default for every pre-existing connection) | An inline, calm reconnect prompt IN the comments section — NOT an error tone, because nothing failed; the user just needs to grant a new scope. Treatment: `<Alert className="border-border bg-muted/40"><AlertTitle>Comments need a reconnect</AlertTitle><AlertDescription>Reconnect Confluence to view comments on this page.</AlertDescription></Alert>` + `<Button variant="default" size="sm" className="mt-2" onClick={onReconnect}>Reconnect to view comments</Button>` (calls the existing `window.cosmos.confluence.connect()`). The page detail ABOVE still renders; the composer BELOW still works if `write:comment:confluence` is granted (independent capability, FR-007). Use the neutral `border-border bg-muted/40` wash (not `destructive`) so it reads as "one-time setup," not "broken." |
| **Comment-write NOT authorized** | `addComment` returns `write_not_authorized` | The composer's inline error chip (§4 Failure) with the copy "Reconnect Confluence to comment." (recoverable, text preserved). No write attempted; reads/detail unaffected. Optionally render the same neutral reconnect `Button` beneath the chip; minimum is the recoverable notice. |
| **Not connected / connection dropped** | panel `confluence:statusChanged` → `!isConnected` | Handled at the PANEL level: the whole content region swaps to the existing Connect CTA and the `genUiPage` dock unmounts (existing behavior) — so the comments section is never left in a stuck spinner (FR-012). No new handling needed in `CommentsSection`. |
| **Retarget / close while loading** | `pageId` changes / dock closes | `CommentsSection` is keyed by `pageId` (the dock body already remounts via `PageDetail key={pageId}`), so an in-flight read for the old page is discarded and never rendered against the new page (FR-009). Mirror the `PageDetail` `run()` discipline: ignore a resolved result whose `pageId` no longer matches. |

## 6. Interaction & accessibility

- **Focus order (dock open):** header X → page-body links (existing) → comment-body links (in DOM order
  per comment/reply) → reconnect/retry `Button` if shown → composer `Textarea` → `Comment` `Button`. The
  dock is a side-dock, NOT a focus trap (consistent with the Jira/Slack/calendar docks) — a keyboard user
  can tab between body, comments, and composer.
- **Keyboard:** `Textarea` is a native multiline input (Enter inserts a newline — do NOT bind Enter to
  submit; the explicit `Comment` button is the submit, matching Jira). The `Comment`/`Retry`/`Reconnect`
  buttons are native `<button>`s (Enter/Space for free). Disabled states are real `disabled` attributes
  (not just styling) so they are skipped/announced correctly.
- **ARIA / live regions:** the count label is `aria-live="polite"` so a post-add re-fetch announces the new
  count. The loading skeleton wrapper is `aria-busy="true"`. The composer error + the fetch-error `Alert`
  are `role="alert"`. The in-flight button conveys state via the `Loader2` + "Posting…" text, never color
  alone.
- **Contrast (dark-only):** all text uses existing vetted pairings — names `--foreground` (#e0e0e0),
  timestamps/muted `--muted-foreground` (#888) on `--card` (#1b1b1c) seen through the glass-dock fill;
  comment bodies inherit the `prose-cosmos` token map (already contrast-checked in
  `confluence-detail-rich-render-v1`). The reconnect wash `bg-muted/40` keeps its `--foreground` title
  legible; the destructive chip is the established Confluence/Jira error idiom. The reply left-rule
  `border-border/60` is decorative (not the sole reply signal — the indent + author also carry it).
- **Reduced motion:** the only animation is the `Loader2` spinner (already `motion`-safe app-wide); no new
  transition introduced. The dock's own slide already honors `motion-reduce:transition-none`.

## 7. Tokens & primitives ledger

- **New theme tokens:** none. Reuses `--card`, `--card-foreground`, `--foreground`, `--muted-foreground`,
  `--muted`, `--border`, `--destructive`, `--primary` (via `prose-cosmos` links).
- **New `components/ui/` primitives:** none. Reuses `Avatar`/`AvatarFallback`, `Textarea`, `Button`
  (`variant="default" size="sm"` submit; `variant="ghost" size="icon-sm"` is the existing X), `Alert`/
  `AlertTitle`/`AlertDescription`, `Skeleton`, `ScrollArea` — all already in `src/renderer/components/ui/`.
- **Reused renderer helpers (not design-system files):** `PageDetailBody` + `PAGE_DETAIL_BODY_CLASS` +
  `sanitizeConfluenceHtml` (`confluenceCatalog`), `initials` + `formatTs` + `ErrorState` + `ReconnectState`
  (`atlassianPanelBits`), `Loader2` (lucide).
- **New renderer artifact (developer builds, consumes the system — NOT a design-system file):**
  `src/renderer/confluenceCatalog/CommentsSection.tsx` — the native dock-body comments list + reply tree +
  composer, keyed by `pageId`, calling `window.cosmos.confluence.getComments`/`addComment`. It is a
  panel-chrome sibling of `PageDetailBody`; it extends nothing in `components/ui/`.

## 8. Build wiring — HAND OFF TO DEVELOPER (designer has no Bash)

- **Nothing to install.** Every primitive (`Avatar`, `Textarea`, `Button`, `Alert`, `Skeleton`,
  `ScrollArea`) and every helper (`PageDetailBody`, `initials`, `formatTs`, `ErrorState`, `ReconnectState`,
  `sanitizeConfluenceHtml`) already exists. No shadcn CLI run, no npm install, no new token in `index.css`.
- **Reminder (developer):** the new `getComments`/`addComment` on `window.cosmos.confluence` are preload
  edits ⇒ a FULL `npm run dev` restart (HMR insufficient), per the plan/CLAUDE.md.

## 9. Open questions

- **None blocking.** All spec/plan OQs carry resolved defaults adopted here: reply tree = one level,
  indented (OQ-1); post-add = re-fetch (OQ-2); comment body = the shared `PageDetailBody` prose/sanitize
  path (OQ-3); re-auth = inline `Reconnect to view comments` button calling the existing
  `window.cosmos.confluence.connect()`, in-place (NOT a Settings deep-link) for the fewest clicks (OQ-4).
  Composer placement = bottom-pinned (a deliberate choice over inline, for reach on long pages); flag in
  review only if QA prefers an inline composer directly under the last comment.
